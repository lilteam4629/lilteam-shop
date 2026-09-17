const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const FormData = require('form-data');
const bcrypt = require('bcryptjs');
const mainApi = require('./lib/mainApi');
const settings = require('./lib/settings');
const cloudStore = require('./lib/cloud-store');
const paymentService = require('./lib/payment');
const walletService = require('./lib/wallet');
const truemoney = require('./services/truemoney');
const recaptcha = require('./services/recaptcha');
const CloudSessionStore = require('./lib/session-store');
const { safeNext, establishLogin } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.get('/health', (req,res)=>res.status(200).json({ok:true}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(settings.UPLOADS_DIR));

// This app holds no sensitive data of its own — every real fact (users,
// shops, wallet balance) lives behind the internal API on the main app.
// A simple in-memory session store is enough; there's nothing here that
// needs to survive a restart beyond "please log in again".
app.use(session({
  name: 'cloud.sid',
  store: new CloudSessionStore(path.join(settings.DATA_DIR, 'sessions')),
  secret: process.env.SESSION_SECRET || 'rent-app-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(flash());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use((req, res, next) => {
  res.locals.messages = { success: req.flash('success'), error: req.flash('error') };
  res.locals.currentUser = req.session.user || null;
  res.locals.isAdmin = !!req.session.isAdmin;
  next();
});

async function requireLogin(req, res, next) {
  try {
    if (!req.session.userId && req.session.isAdmin) {
      let linked = cloudStore.data.users.find(u => u.cloudAdmin);
      if (!linked) { linked={id:cloudStore.id(),username:ADMIN_USERNAME||'cloud_admin',email:'',passwordHash:'',role:'customer',status:'active',walletBalance:0,cloudAdmin:true,createdAt:new Date().toISOString()};cloudStore.data.users.push(linked);cloudStore.save(); }
      req.session.userId = linked.id; req.session.user = cloudStore.publicUser(linked);
    }
    if (!req.session.userId) {
      req.session.returnTo = safeNext(req.originalUrl, '/my-shops');
      return res.redirect('/login');
    }
    const user = cloudStore.user(req.session.userId);
    if (!user) return req.session.destroy(() => res.redirect('/login'));
    req.session.user = cloudStore.publicUser(user); res.locals.currentUser = req.session.user;
    next();
  } catch (error) { next(error); }
}

// Keeps req.session.user (wallet balance especially) reasonably fresh —
// cheap enough to call on every protected page since it's one small GET.
async function refreshSessionUser(req) {
  if (!req.session.userId) return null;
  const user=cloudStore.user(req.session.userId); if(!user)return null; req.session.user=cloudStore.publicUser(user);return req.session.user;
}

const MAIN_SITE_URL = process.env.MAIN_SITE_URL || 'https://lilteam.site';
const MAIN_DOMAIN = MAIN_SITE_URL.replace(/^https?:\/\//, '');
const DEFAULT_SHOP_NAME = process.env.SHOP_NAME || 'LilTeam Shop';
const DEFAULT_LOGO_IMAGE = process.env.LOGO_IMAGE || null;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const DEFAULT_HERO_TITLE = 'เปิดร้านค้าออนไลน์ของคุณ\nใน 1 นาที';
const DEFAULT_HERO_SUBTITLE = 'เช่าเว็บร้านค้าพร้อมระบบขายอัตโนมัติ จัดการสต็อก กระเป๋าเงิน มินิเกมลุ้นรางวัล และตรวจสลิปอัตโนมัติ 24 ชั่วโมง — ติดตั้งพร้อมใช้งานทันทีหลังชำระเงิน ไม่ต้องเขียนโค้ดสักบรรทัด';

async function importLegacyPaymentOnce(){
  const p=cloudStore.payment();if(Number(p.legacyPaymentImportVersion||0)>=5)return;
  const result=await mainApi.legacyPaymentConfig();if(!result.ok||!result.body.payment)return;
  const allowed=['slipProvider','easyslipApiKey','slipokBranchId','slipokApiKey','slipcheckApiKey','slipcheckEndpoint','rdcwClientId','rdcwClientSecret','rdcwEndpoint','slip2goApiKey','slip2goEndpoint','promptpayId','promptpayName','promptpayQrImage','bankName','bankAccountNumber','bankAccountName','bankQrImage','truemoneyPhone'];
  for(const key of allowed)p[key]=result.body.payment[key]||'';
  if(!paymentService.PROVIDERS.has(p.slipProvider))p.slipProvider='easyslip';p.truemoneyEnabled=result.body.payment.truemoneyEnabled===true;p.truemoneyImported=true;p.legacyPaymentImported=true;p.legacyPaymentImportVersion=5;cloudStore.save();
}

function currentShopName() {
  return settings.get().shopName || DEFAULT_SHOP_NAME;
}
function currentLogoImage() {
  return settings.get().logoImage || DEFAULT_LOGO_IMAGE;
}
function currentHeroTitle() {
  return settings.get().heroTitle || DEFAULT_HERO_TITLE;
}
function currentHeroSubtitle() {
  return settings.get().heroSubtitle || DEFAULT_HERO_SUBTITLE;
}
function isHeroTitleCustomized() {
  return !!settings.get().heroTitle;
}

app.use((req, res, next) => {
  res.locals.mainDomain = MAIN_DOMAIN;
  res.locals.mainSiteUrl = MAIN_SITE_URL;
  res.locals.shopName = currentShopName();
  res.locals.logoImage = currentLogoImage();
  res.locals.heroTitle = currentHeroTitle();
  res.locals.heroSubtitle = currentHeroSubtitle();
  res.locals.heroCustomized = isHeroTitleCustomized();
  res.locals.siteEffects = {
    snowEnabled: settings.get().snowEnabled === true,
    musicEnabled: settings.get().musicEnabled === true,
    musicUrl: settings.get().musicUrl || '',
    musicVolume: Math.max(0, Math.min(100, Number(settings.get().musicVolume) || 35)),
    musicStartSeconds: Math.max(0, Number(settings.get().musicStartSeconds) || 0),
    musicEndSeconds: Math.max(0, Number(settings.get().musicEndSeconds) || 0),
  };
  next();
});

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    req.flash('error', 'กรุณาเข้าสู่ระบบผู้ดูแลก่อน');
    return res.redirect('/admin/login');
  }
  next();
}

app.get('/admin/login', (req, res) => res.render('admin-login', { title: 'เข้าสู่ระบบผู้ดูแล' }));

app.post('/admin/login', async (req, res, next) => {
  try {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || req.body.username !== ADMIN_USERNAME || req.body.password !== ADMIN_PASSWORD) {
      req.flash('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      return res.redirect('/admin/login');
    }
    let user=cloudStore.data.users.find(u=>u.cloudAdmin);
    if(!user){user={id:cloudStore.id(),username:ADMIN_USERNAME,email:'',passwordHash:'',role:'customer',status:'active',walletBalance:0,cloudAdmin:true,createdAt:new Date().toISOString()};cloudStore.data.users.push(user);cloudStore.save();}
    await establishLogin(req, cloudStore.publicUser(user), true);
    res.redirect('/admin');
  } catch (error) { next(error); }
});
app.post('/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/admin', requireAdmin, async (req, res) => {
  res.render('admin', {
    title: 'จัดการเว็บเช่าร้าน',
    showcaseImages: settings.get().showcaseImages || [],
    showcaseIsCustom: !!(settings.get().showcaseImages && settings.get().showcaseImages.length),
  });
});

app.post('/admin/settings', requireAdmin, (req, res) => {
  const parseTime = (value) => String(value || '').trim().split(':').reduce((total, part) => total * 60 + (parseInt(part, 10) || 0), 0);
  const musicStartSeconds = Math.max(0, parseTime(req.body.musicStartTime));
  const musicEndSeconds = Math.max(0, parseTime(req.body.musicEndTime));
  if (musicEndSeconds > 0 && musicEndSeconds <= musicStartSeconds) {
    req.flash('error', 'เวลาจบเพลงต้องมากกว่าเวลาเริ่มเพลง');
    return res.redirect('/admin');
  }
  settings.update({
    shopName: (req.body.shopName || '').trim() || undefined,
    snowEnabled: req.body.snowEnabled === 'on',
    musicEnabled: req.body.musicEnabled === 'on',
    musicUrl: (req.body.musicUrl || '').trim(),
    musicVolume: Math.max(0, Math.min(100, Number(req.body.musicVolume) || 35)),
    musicStartSeconds,
    musicEndSeconds,
  });
  req.flash('success', 'บันทึกการตั้งค่าแล้ว');
  res.redirect('/admin');
});

app.post('/admin/hero', requireAdmin, (req, res) => {
  settings.update({
    heroTitle: (req.body.heroTitle || '').trim() || undefined,
    heroSubtitle: (req.body.heroSubtitle || '').trim() || undefined,
  });
  req.flash('success', 'บันทึกข้อความหัวเว็บแล้ว');
  res.redirect('/admin');
});

app.post('/admin/hero/reset', requireAdmin, (req, res) => {
  settings.update({ heroTitle: undefined, heroSubtitle: undefined });
  req.flash('success', 'รีเซ็ตข้อความหัวเว็บเป็นค่าเริ่มต้นแล้ว');
  res.redirect('/admin');
});

app.post('/admin/showcase-images', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    req.flash('error', 'กรุณาเลือกไฟล์รูปภาพ');
    return res.redirect('/admin');
  }
  const ext = path.extname(req.file.originalname) || '.jpg';
  const filename = `showcase-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(settings.UPLOADS_DIR, filename), req.file.buffer);
  const current = settings.get().showcaseImages || [];
  settings.update({ showcaseImages: [...current, `/uploads/${filename}`].slice(-4) });
  req.flash('success', 'เพิ่มรูปตัวอย่างร้านค้าแล้ว');
  res.redirect('/admin');
});

app.post('/admin/showcase-images/:index/remove', requireAdmin, (req, res) => {
  const current = settings.get().showcaseImages || [];
  const next = current.filter((_, i) => i !== Number(req.params.index));
  settings.update({ showcaseImages: next });
  req.flash('success', 'ลบรูปแล้ว');
  res.redirect('/admin');
});

app.post('/admin/showcase-images/reset', requireAdmin, (req, res) => {
  settings.update({ showcaseImages: [] });
  req.flash('success', 'เปลี่ยนกลับเป็นดึงรูปอัตโนมัติจากเว็บหลักแล้ว');
  res.redirect('/admin');
});

app.post('/admin/logo', requireAdmin, upload.single('logo'), (req, res) => {
  if (!req.file) {
    req.flash('error', 'กรุณาเลือกไฟล์รูปภาพ');
    return res.redirect('/admin');
  }
  const ext = path.extname(req.file.originalname) || '.png';
  const filename = `logo-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(settings.UPLOADS_DIR, filename), req.file.buffer);
  settings.update({ logoImage: `/uploads/${filename}` });
  req.flash('success', 'อัปโหลดโลโก้ใหม่แล้ว');
  res.redirect('/admin');
});

// ---------- Admin: plans (proxies the main site's own plan store) ----------
app.get('/admin/plans', requireAdmin, async (req, res) => {
  const result = await mainApi.adminListPlans();
  if (!result.ok) {
    req.flash('error', (result.body && result.body.error) || 'โหลดแพ็กเกจไม่สำเร็จ');
    return res.render('admin-plans', { title: 'แพ็กเกจราคา', plans: [] });
  }
  res.render('admin-plans', { title: 'แพ็กเกจราคา', plans: result.body.plans });
});

app.post('/admin/plans', requireAdmin, async (req, res) => {
  const result = await mainApi.adminCreatePlan(req.body);
  if (!result.ok) req.flash('error', (result.body && result.body.error) || 'เพิ่มแพ็กเกจไม่สำเร็จ');
  else req.flash('success', 'เพิ่มแพ็กเกจแล้ว');
  res.redirect('/admin/plans');
});

app.post('/admin/plans/:id', requireAdmin, async (req, res) => {
  const result = await mainApi.adminEditPlan(req.params.id, req.body);
  if (!result.ok) req.flash('error', (result.body && result.body.error) || 'แก้ไขแพ็กเกจไม่สำเร็จ');
  else req.flash('success', 'บันทึกแพ็กเกจแล้ว');
  res.redirect('/admin/plans');
});

app.post('/admin/plans/:id/toggle', requireAdmin, async (req, res) => {
  await mainApi.adminTogglePlan(req.params.id);
  res.redirect('/admin/plans');
});

app.post('/admin/plans/:id/delete', requireAdmin, async (req, res) => {
  const result = await mainApi.adminDeletePlan(req.params.id);
  if (!result.ok) req.flash('error', (result.body && result.body.error) || 'ลบแพ็กเกจไม่สำเร็จ');
  else req.flash('success', 'ลบแพ็กเกจแล้ว');
  res.redirect('/admin/plans');
});

// ---------- Admin: topups / slip review ----------
app.get('/admin/topups', requireAdmin, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const q = String(req.query.q || '');
  const requests=cloudStore.data.topups.map(t=>({...t,buyerUsername:cloudStore.data.users.find(u=>u.id===t.userId)?.username,buyerEmail:cloudStore.data.users.find(u=>u.id===t.userId)?.email})).filter(t=>(!status||t.status===status)&&(!q||JSON.stringify(t).toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.render('admin-topups', {
    title: 'เติมเงิน/สลิป',
    requests,
    status,
    q,
  });
});

app.get('/admin/topups/:id/slip', requireAdmin, async (req, res) => {
  try {
    const item=cloudStore.data.topups.find(t=>t.id===req.params.id);if(!item?.slipFile)return res.sendStatus(404);res.sendFile(path.join(settings.UPLOADS_DIR,item.slipFile));
  } catch {
    res.sendStatus(404);
  }
});

app.post('/admin/topups/:id/approve', requireAdmin, async (req, res) => {
  const result = await walletService.review(req.params.id,true);
  if (!result.ok) req.flash('error', result.error || 'อนุมัติไม่สำเร็จ');
  else req.flash('success', 'อนุมัติคำขอเติมเงินแล้ว');
  res.redirect('/admin/topups');
});

app.post('/admin/topups/:id/reject', requireAdmin, async (req, res) => {
  const result = await walletService.review(req.params.id,false,req.body.reviewNote);
  if (!result.ok) req.flash('error', result.error || 'ปฏิเสธไม่สำเร็จ');
  else req.flash('success', 'ปฏิเสธคำขอแล้ว');
  res.redirect('/admin/topups');
});

// ---------- Admin: users ----------
app.get('/admin/users', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '');
  const users=cloudStore.data.users.filter(u=>!u.cloudAdmin&&(!q||(u.username||'').toLowerCase().includes(q.toLowerCase())||(u.email||'').toLowerCase().includes(q.toLowerCase()))).map(cloudStore.publicUser);
  res.render('admin-users', {
    title: 'บัญชีผู้ใช้',
    users,
    q,
  });
});
app.post('/admin/users/:id/balance',requireAdmin,async(req,res)=>{const newBalance=Number(req.body.amount);if(!Number.isFinite(newBalance)||newBalance<0){req.flash('error','ยอดเงินใหม่ไม่ถูกต้อง');return res.redirect('/admin/users')}await cloudStore.transact(d=>{const u=d.users.find(x=>x.id===req.params.id&&!x.cloudAdmin);if(!u)throw new Error('ไม่พบสมาชิก');const previous=Number(u.walletBalance)||0;u.walletBalance=Math.round(newBalance*100)/100;d.walletTransactions.push({id:cloudStore.id(),userId:u.id,type:'admin_adjustment',amount:Math.round((u.walletBalance-previous)*100)/100,note:`แอดมินกำหนดยอดเงินเป็น ฿${u.walletBalance.toLocaleString()}`,createdAt:new Date().toISOString()})});req.flash('success',`กำหนดยอดเงินเป็น ฿${newBalance.toLocaleString()} แล้ว`);res.redirect('/admin/users')});
app.post('/admin/users/:id/toggle',requireAdmin,async(req,res)=>{await cloudStore.transact(d=>{const u=d.users.find(x=>x.id===req.params.id&&!x.cloudAdmin);if(u)u.status=u.status==='banned'?'active':'banned'});res.redirect('/admin/users')});

app.get('/admin/payment', requireAdmin, (req,res)=>res.render('admin-payment',{title:'บัญชีรับเงินและตรวจสลิป',payment:cloudStore.payment()}));
function selectedPaymentProvider(body={}){const value=String(Array.isArray(body.slipProvider)?body.slipProvider.at(-1):body.slipProvider||'').trim().toLowerCase();if(paymentService.PROVIDERS.has(value))return value;if(body.rdcwClientId||body.rdcwClientSecret)return'rdcw';if(body.slipokBranchId||body.slipokApiKey)return'slipok';if(body.slipcheckApiKey)return'slipcheck';if(body.slip2goApiKey)return'slip2go';return'easyslip'}
app.post('/admin/payment', requireAdmin, (req,res)=>{
  const provider=selectedPaymentProvider(req.body);const p=cloudStore.payment();for(const key of ['easyslipApiKey','slipokBranchId','slipokApiKey','slipcheckApiKey','slipcheckEndpoint','rdcwClientId','rdcwClientSecret','rdcwEndpoint','slip2goApiKey','slip2goEndpoint','promptpayId','promptpayName','bankName','bankAccountNumber','bankAccountName','truemoneyPhone'])p[key]=String(req.body[key]||'').trim();p.slipProvider=provider;p.truemoneyEnabled=req.body.truemoneyEnabled==='on';cloudStore.save();req.flash('success','บันทึกระบบตรวจสลิปและบัญชีรับเงินแล้ว');res.redirect('/admin/payment');
});
app.post('/admin/payment/test', requireAdmin, async(req,res)=>res.json(await paymentService.test(selectedPaymentProvider(req.body),req.body)));

// ---------- Landing ----------
// Pulls a few real product image URLs straight from the live main site's
// homepage HTML so the "real shop" showcase never shows fake/mockup images.
// Cached briefly since it's just decorative and the main site is on a
// separate box — no need to hit it on every single landing-page view.
let showcaseImagesCache = { images: [], fetchedAt: 0 };
async function getShowcaseImages() {
  const custom = settings.get().showcaseImages;
  if (custom && custom.length) return custom;

  const CACHE_MS = 10 * 60 * 1000;
  if (Date.now() - showcaseImagesCache.fetchedAt < CACHE_MS) return showcaseImagesCache.images;
  try {
    const axios = require('axios');
    const res = await axios.get(MAIN_SITE_URL, { timeout: 5000 });
    const html = res.data;
    // Only real product photos (class="latest-order-image"), never the site logo.
    const imgTags = html.match(/<img[^>]+>/g) || [];
    const productSrcs = imgTags
      .filter((tag) => tag.includes('latest-order-image'))
      .map((tag) => (tag.match(/src="([^"]+)"/) || [])[1])
      .filter(Boolean);
    const unique = [...new Set(productSrcs)].slice(0, 4);
    if (unique.length) showcaseImagesCache = { images: unique, fetchedAt: Date.now() };
  } catch {
    // Keep serving whatever's cached (or empty) — the page still works fine without it.
  }
  return showcaseImagesCache.images;
}

app.get('/', async (req, res) => {
  const [plansRes, showcaseImages] = await Promise.all([mainApi.plans(), getShowcaseImages()]);
  res.render('home', {
    title: `เช่าเว็บร้านค้าออนไลน์ | ${currentShopName()} Cloud`,
    plans: plansRes.ok ? plansRes.body.plans : [],
    showcaseImages,
  });
});

// ---------- Auth ----------
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect(safeNext(req.query.next, '/my-shops'));
  if (req.query.next) req.session.returnTo = safeNext(req.query.next, '/my-shops');
  res.render('login', { title: 'เข้าสู่ระบบ LILTeam Shop' });
});
app.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const isAdmin = !!(ADMIN_USERNAME && ADMIN_PASSWORD && username === ADMIN_USERNAME.trim() && password === ADMIN_PASSWORD);
    let user=cloudStore.data.users.find(u=>(u.username||'').toLowerCase()===username.toLowerCase()||(u.email||'').toLowerCase()===username.toLowerCase());
    if(!user && !isAdmin){const legacy=await mainApi.login(username,password);if(legacy.ok){const allowed=await mainApi.legacyEligibility(legacy.body.user.id);if(allowed.ok&&allowed.body.eligible){user={...legacy.body.user,passwordHash:await bcrypt.hash(password,10),role:'customer',status:'active',migratedFromMain:true,createdAt:new Date().toISOString()};cloudStore.data.users.push(user);cloudStore.save();}}}
    if(!isAdmin&&(!user||user.status==='banned'||!await bcrypt.compare(password,user.passwordHash||''))){req.flash('error','ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');return res.redirect('/login');}
    if(isAdmin){user=cloudStore.data.users.find(u=>u.cloudAdmin)||{id:cloudStore.id(),username:ADMIN_USERNAME,email:'',passwordHash:'',role:'customer',status:'active',walletBalance:0,cloudAdmin:true,createdAt:new Date().toISOString()};if(!cloudStore.data.users.includes(user)){cloudStore.data.users.push(user);cloudStore.save();}}
    const target = safeNext(req.session.returnTo, isAdmin ? '/' : '/my-shops');
    await establishLogin(req, cloudStore.publicUser(user), isAdmin);
    res.redirect(target);
  } catch (error) { next(error); }
});

app.get('/register', async (req, res) => {
  // Site key is public by design (embedded in the widget) — fetched from
  // the main app so both apps always show the same recaptcha config.
  res.render('register', { title: 'สมัครสมาชิก', recaptchaSiteKey: recaptcha.siteKey() });
});

app.post('/register', async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;
  if (!username || !email || !password) {
    req.flash('error', 'กรุณากรอกข้อมูลให้ครบถ้วน');
    return res.redirect('/register');
  }
  if (password !== confirmPassword) {
    req.flash('error', 'รหัสผ่านไม่ตรงกัน');
    return res.redirect('/register');
  }
  if(!await recaptcha.verify(req.body['g-recaptcha-response'],req.ip)){req.flash('error','กรุณายืนยันแคปช่า');return res.redirect('/register');}
  if(cloudStore.data.users.some(u=>(u.username||'').toLowerCase()===username.trim().toLowerCase()||(u.email||'').toLowerCase()===email.trim().toLowerCase())){req.flash('error','ชื่อผู้ใช้หรืออีเมลถูกใช้แล้ว');return res.redirect('/register');}
  const user={id:cloudStore.id(),username:username.trim(),email:email.trim(),passwordHash:await bcrypt.hash(password,10),role:'customer',walletBalance:0,status:'active',createdAt:new Date().toISOString()};cloudStore.data.users.push(user);cloudStore.save();
  const returnTo = safeNext(req.session.returnTo, '/my-shops');
  await establishLogin(req, cloudStore.publicUser(user), false);
  req.flash('success', `สมัครสมาชิกสำเร็จ! ยินดีต้อนรับสู่ ${currentShopName()} Cloud`);
  res.redirect(returnTo);
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- Start a shop ----------
app.get('/start', requireLogin, async (req, res) => {
  const plansRes = await mainApi.plans();
  res.render('start', {
    title: 'เปิดร้านของคุณเอง',
    plans: plansRes.ok ? plansRes.body.plans : [],
    preselectedPlanId: String(req.query.plan || ''),
    recaptchaSiteKey: recaptcha.siteKey(),
  });
});

app.post('/start', requireLogin, async (req, res) => {
  const user=cloudStore.user(req.session.userId), plans=await mainApi.plans(), plan=plans.ok&&plans.body.plans.find(p=>p.id===req.body.planId);
  if(!plan){req.flash('error','ไม่พบแพ็กเกจ');return res.redirect('/start');}
  const charged=await cloudStore.transact(data=>{const u=data.users.find(x=>x.id===user.id);if(!u||u.walletBalance<plan.price)return false;u.walletBalance-=plan.price;data.walletTransactions.push({id:cloudStore.id(),userId:u.id,type:'shop_purchase',amount:-plan.price,note:`เปิดร้าน ${req.body.shopName}`,createdAt:new Date().toISOString()});return true});
  if(!charged){req.flash('error','ยอดเครดิตไม่พอ');return res.redirect('/start');}
  const result = await mainApi.createShop({
    cloudUser: cloudStore.publicUser(user),
    planId: req.body.planId,
    shopName: req.body.shopName,
    adminUsername: req.body.adminUsername,
    adminPassword: req.body.adminPassword,
    recaptchaResponse: req.body['g-recaptcha-response'],
  });
  if (!result.ok) {
    await cloudStore.transact(data=>{const u=data.users.find(x=>x.id===user.id);u.walletBalance+=plan.price;data.walletTransactions.push({id:cloudStore.id(),userId:u.id,type:'refund',amount:plan.price,note:'คืนเงินเนื่องจากเปิดร้านไม่สำเร็จ',createdAt:new Date().toISOString()})});
    req.flash('error', (result.body && result.body.error) || 'เปิดร้านไม่สำเร็จ');
    return res.redirect('/start');
  }
  await refreshSessionUser(req);
  req.flash('success', `เปิดร้าน "${result.body.shopName}" สำเร็จ! เข้าสู่ระบบร้านใหม่ด้วยชื่อผู้ใช้ ${result.body.adminUsername}`);
  res.redirect('/my-shops');
});

require('./lib/rental-admin')(app, { mainApi, requireAdmin, requireLogin });

// ---------- My shops ----------
app.get('/my-shops', requireLogin, async (req, res) => {
  const [shopsRes, plansRes] = await Promise.all([mainApi.myShops(req.session.userId), mainApi.plans()]);
  res.render('my-shops', {
    title: 'ร้านของฉัน',
    shops: shopsRes.ok ? shopsRes.body.shops : [],
    plans: plansRes.ok ? plansRes.body.plans : [],
  });
});

app.post('/my-shops/:id/renew', requireLogin, async (req, res) => {
  const user=cloudStore.user(req.session.userId),plans=await mainApi.plans(),plan=plans.ok&&plans.body.plans.find(p=>p.id===req.body.planId);
  if(!plan){req.flash('error','ไม่พบแพ็กเกจ');return res.redirect('/my-shops');}
  const charged=await cloudStore.transact(data=>{const u=data.users.find(x=>x.id===user.id);if(!u||u.walletBalance<plan.price)return false;u.walletBalance-=plan.price;data.walletTransactions.push({id:cloudStore.id(),userId:u.id,type:'shop_renewal',amount:-plan.price,note:`ต่ออายุร้าน ${req.params.id}`,createdAt:new Date().toISOString()});return true});
  if(!charged){req.flash('error','ยอดเครดิตไม่พอ');return res.redirect('/my-shops');}
  const result = await mainApi.renewShop(req.params.id, { cloudUser: cloudStore.publicUser(user), planId: req.body.planId });
  if (!result.ok) {
    await cloudStore.transact(data=>{const u=data.users.find(x=>x.id===user.id);u.walletBalance+=plan.price;data.walletTransactions.push({id:cloudStore.id(),userId:u.id,type:'refund',amount:plan.price,note:'คืนเงินเนื่องจากต่ออายุไม่สำเร็จ',createdAt:new Date().toISOString()})});
    req.flash('error', (result.body && result.body.error) || 'ต่ออายุไม่สำเร็จ');
    return res.redirect('/my-shops');
  }
  await refreshSessionUser(req);
  req.flash('success', `ต่ออายุร้าน "${result.body.shop.name}" สำเร็จ!`);
  res.redirect('/my-shops');
});

// ---------- Wallet / topup ----------
app.get('/wallet', requireLogin, async (req, res) => {
  const savedPayment=cloudStore.payment();const payment={...savedPayment,promptpayEnabled:savedPayment.slipProvider==='easyslip'&&Boolean(savedPayment.promptpayId)};
  res.render('wallet', {
    title: 'เติมเงิน',
    payment,
    topups: walletService.list(req.session.userId),
  });
});

app.post('/account/topup/truemoney', requireLogin, async (req, res) => {
  const result = await walletService.redeem(req.session.userId, req.body.voucherLink);
  if (!result.ok) { req.flash('error', result.error || 'เติมเงินไม่สำเร็จ'); return res.redirect('/wallet'); }
  await refreshSessionUser(req); req.flash('success', `🧧 เติมเงินสำเร็จ ฿${Number(result.item.amount).toLocaleString()}`);
  res.redirect('/account/topup/' + encodeURIComponent(result.item.id));
});
app.post('/account/topup', requireLogin, async (req, res) => {
  const result = await walletService.create(req.session.userId,req.body.amount,req.body.method||'bank_transfer');
  if (!result.ok) { req.flash('error', result.error || 'สร้างคำขอไม่สำเร็จ'); return res.redirect('/wallet'); }
  res.redirect('/account/topup/' + encodeURIComponent(result.item.id));
});
app.get('/account/topup/:id', requireLogin, async (req, res) => {
  const request=cloudStore.data.topups.find(t=>t.id===req.params.id&&t.userId===req.session.userId);if(!request)return res.status(404).send('ไม่พบคำขอเติมเงิน');
  const payment=cloudStore.payment();res.render('wallet-detail', { title: 'รายละเอียดเติมเงิน', request, payment, automaticSlipCheck:paymentService.configured(payment), qrDataUrl:null,settings:{shopName:currentShopName(),branding:{logoImage:currentLogoImage()}} });
});
app.post('/account/topup/:id/slip', requireLogin, upload.single('slip'), async (req, res) => {
  if (!req.file) { req.flash('error', 'กรุณาแนบรูปสลิป'); return res.redirect('/account/topup/' + encodeURIComponent(req.params.id)); }
  const result = await walletService.attach(req.session.userId,req.params.id,req.file);
  req.flash(result.ok ? 'success' : 'error', result.ok ? 'แนบสลิปแล้ว ระบบตรวจสอบเรียบร้อย' : (result.error || 'แนบสลิปไม่สำเร็จ'));
  res.redirect('/account/topup/' + encodeURIComponent(req.params.id));
});
app.get('/account/topup/:id/status', requireLogin, async (req, res) => {
  const request=cloudStore.data.topups.find(t=>t.id===req.params.id&&t.userId===req.session.userId);res.status(request?200:404).json(request?{status:request.status,slipCheck:request.slipCheck}:{error:'not found'});
});
app.get('/account/topup/:id/slip-file', requireLogin, async (req, res, next) => {
  try {const item=cloudStore.data.topups.find(t=>t.id===req.params.id&&t.userId===req.session.userId);if(!item?.slipFile)return res.sendStatus(404);res.sendFile(path.join(settings.UPLOADS_DIR,item.slipFile));}catch(error){next(error)}
});
app.get('/account', requireLogin, (req, res) => res.redirect('/'));

app.post('/wallet/topup', requireLogin, upload.single('slip'), async (req, res) => {
  const created=await walletService.create(req.session.userId,req.body.amount,req.body.method||'bank_transfer');
  if(!created.ok){req.flash('error',created.error);return res.redirect('/wallet')}
  if(req.file)await walletService.attach(req.session.userId,created.item.id,req.file);
  res.redirect('/account/topup/'+created.item.id);
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'ไม่พบหน้านี้' });
});

if (require.main === module) importLegacyPaymentOnce().catch(e=>console.error('[Payment import]',e.message)).finally(()=>app.listen(PORT, () => console.log(`Shop Cloud running on ${PORT}`)));
module.exports = app;
