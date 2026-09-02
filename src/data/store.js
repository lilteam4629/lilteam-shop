require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const bcrypt = require('bcryptjs');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const { AsyncLocalStorage } = require('async_hooks');
const r2 = require('../services/r2');

// Multi-tenant support: each rented "shop" (see src/routes/tenant.js) gets
// its OWN full copy of this exact data shape (products, orders, users,
// wallet, settings — everything), reusing every existing route/view
// unmodified. A request handled under a shop's subdomain runs inside
// tenantContext.run({shopId, db}, ...) so `store.data` below transparently
// resolves to THAT shop's db instead of the main site's — no route file
// needed to know or care which one it's operating on. Outside that
// context (the main site, on its own domain), `store.data` behaves
// exactly as it always has.
const tenantContext = new AsyncLocalStorage();

const DB_PATH = path.join(__dirname, 'db.json');
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'lilteam_shop';

function defaultData() {
  const now = new Date().toISOString();

  const genres = {
    action: 'Action', adventure: 'Adventure', indie: 'Indie', rpg: 'RPG',
    simulation: 'Simulation', strategy: 'Strategy', horror: 'Horror', openworld: 'Open World',
  };

  const filterTags = [
    { id: 'tag-recommended', name: 'แนะนำ', image: 'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=200', createdAt: now },
    { id: 'tag-bestseller', name: 'ขายดี', image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=200', createdAt: now },
  ];

  const products = [
    {
      id: nanoid(8), title: 'Shadow Realm Chronicles', slug: 'shadow-realm-chronicles',
      type: 'game', genres: ['action', 'rpg', 'openworld'],
      filterTagIds: ['tag-recommended', 'tag-bestseller'],
      price: 60, originalPrice: 990,
      description: 'สินค้าเกมพร้อมส่ง รับข้อมูลทันทีหลังชำระเงิน',
      aboutText: 'ผจญภัยในโลกแฟนตาซีมืดมิด ต่อสู้กับเงาปีศาจเพื่อกอบกู้อาณาจักรที่ล่มสลาย พร้อมระบบต่อสู้ที่ลึกซึ้งและเนื้อเรื่องหลายแขนง เหมาะสำหรับผู้ที่ชื่นชอบเกม RPG โลกเปิดสไตล์มืดหม่น',
      images: [
        'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
        'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=800',
        'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800',
      ],
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Nightfall Precinct', slug: 'nightfall-precinct',
      type: 'game', genres: ['horror', 'indie', 'adventure'],
      price: 30, originalPrice: 349,
      description: 'สินค้าเกมสยองขวัญบรรยากาศหลอน พร้อมส่งทันที',
      aboutText: 'สืบสวนคดีปริศนาในเมืองที่ปกคลุมด้วยความมืด ทุกการตัดสินใจส่งผลต่อตอนจบ เกมอินดี้สยองขวัญที่เน้นบรรยากาศและเรื่องราวสุดหลอน',
      images: [
        'https://images.unsplash.com/photo-1580327344181-c1163234e5a0?w=800',
        'https://images.unsplash.com/photo-1607853202273-797f1c22a38e?w=800',
      ],
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Skyforge Tactics', slug: 'skyforge-tactics',
      type: 'game', genres: ['strategy', 'indie'],
      price: 75, originalPrice: 599,
      description: 'สินค้าเกมวางแผนการรบเทิร์นเบส พร้อมส่งทันที',
      aboutText: 'วางแผนกลยุทธ์ คุมทัพต่อสู้บนกระดานเทิร์นเบส สร้างอาณาจักรลอยฟ้าของคุณเองพร้อมตัวละครที่ปรับแต่งได้หลากหลาย',
      images: [
        'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800',
        'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
      ],
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Ironclad Frontier', slug: 'ironclad-frontier',
      type: 'game', genres: ['simulation', 'openworld'],
      filterTagIds: ['tag-recommended'],
      price: 90, originalPrice: 2190,
      description: 'สินค้าเกมจำลองสร้างอาณานิคมอวกาศ พร้อมส่งทันที',
      aboutText: 'สร้างและบริหารอาณานิคมบนดาวเคราะห์ห่างไกล จัดการทรัพยากร ป้องกันภัยคุกคาม และขยายอาณาเขตของคุณให้เติบโต',
      images: [
        'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800',
        'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=800',
      ],
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Velocity Drift Underground', slug: 'velocity-drift-underground',
      type: 'game', genres: ['simulation', 'action'],
      price: 15, originalPrice: 0,
      description: 'สินค้าเกมแข่งรถดริฟท์ พร้อมส่งทันที',
      aboutText: 'แข่งดริฟท์บนสนามใต้ดินยามค่ำคืน ปรับแต่งรถในสไตล์ของคุณ ท้าดวลกับผู้เล่นทั่วโลกแบบเรียลไทม์',
      images: ['https://images.unsplash.com/photo-1517994112540-009c47ea476b?w=800'],
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Wraithhold Survival', slug: 'wraithhold-survival',
      type: 'game', genres: ['horror', 'openworld', 'indie'],
      price: 20, originalPrice: 0,
      description: 'สินค้าเกมเอาตัวรอดโลกเปิด พร้อมส่งทันที',
      aboutText: 'เอาตัวรอดในโลกที่เต็มไปด้วยสิ่งมีชีวิตวิญญาณร้าย สร้างที่พักพิง ล่าทรัพยากร และร่วมมือกับเพื่อนแบบผู้เล่นหลายคน',
      images: ['https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=800'],
      status: 'active', createdAt: now,
    },
  ];

  const stockItems = [];
  products.forEach((p, idx) => {
    const count = idx % 3 === 0 ? 2 : 0;
    for (let i = 0; i < count; i++) {
      stockItems.push({
        id: nanoid(10),
        productId: p.id,
        username: `item_${p.slug}_${i + 1}`,
        password: nanoid(10),
        extra: 'กรุณาเก็บข้อมูลสินค้าไว้เป็นความลับ',
        status: 'available',
        soldOrderId: null,
        addedAt: now,
      });
    }
  });

  const adminPasswordHash = bcrypt.hashSync('admin1234', 10);
  const demoUserHash = bcrypt.hashSync('demo1234', 10);

  return {
    settings: {
      shopName: 'LilTeam Shop',
      tagline: 'สินค้าเกมราคาดี พร้อมส่งอัตโนมัติตลอด 24 ชั่วโมง',
      contactLine: '@lilteamshop',
      contactFacebook: 'https://facebook.com/lilteamshop',
      contactMessenger: 'https://m.me/lilteamshop',
      contactFacebookName: 'LilTeam Shop',
      contactResponseTime: '5–15 นาที',
      openHours: '17:00 - 00:00',
      customerCount: 0,
      reviewCount: 0,
      banners: [],
      genres,
      hero: {
        mode: 'default', // 'default' = fanned card-stack hero, 'banner' = custom image
        bannerImage: null,
        bannerLink: '',
      },
      branding: {
        logoImage: null,
      },
      theme: {
        accent: '#c8a63f',
        bgPreset: 'warmDark',
        bgColor: null,
        style: 'normal',
      },
      productCardStyle: 'natural', // 'natural' = full uncropped image, price below; 'classic' = cropped cover photo with price overlaid
      music: {
        enabled: false,
        youtubeUrl: '',
        defaultVolume: 50,
        startSeconds: 0,
        endSeconds: 0,
      },
      snow: {
        enabled: false,
      },
      payment: {
        promptpayId: '081-234-5678',
        promptpayName: 'LilTeam Shop (Demo)',
        bankName: 'ธนาคารกสิกรไทย',
        bankAccountNumber: '123-4-56789-0',
        bankAccountName: 'LilTeam Shop (Demo)',
        promptpayQrImage: null,
        bankQrImage: null,
        // Optional per-shop SlipOK credentials (see /admin/topups). When set,
        // this shop's own slip checks use these instead of the global
        // SLIPOK_BRANCH_ID/SLIPOK_API_KEY env vars — lets each tenant shop
        // auto-verify against its own bank account.
        slipokBranchId: '',
        slipokApiKey: '',
        // EasySlip: this shop's own receiving bank account, auto-registered
        // with the PLATFORM's single central EasySlip API key (see
        // src/services/easyslip.js) when saved at /admin/topups — the shop
        // owner never touches EasySlip directly. Registered under EVERY bank
        // code the shop selects (its own bank AND/OR PromptPay etc) because
        // an interbank PromptPay transfer's slip can report the receiver's
        // bank as the generic "PromptPay" entry rather than the shop's real
        // bank — matching only the real bank would miss those slips.
        // easyslipAccounts: { [bankCode]: { accountId, status, bankNumber } }
        // — bankNumber is per-channel because PromptPay identifies by
        // phone/ID number, not the underlying bank account number.
        easyslipAccounts: {},
        easyslipStatus: '',
      },
      miniGame: {
        enabled: true,
        title: 'กล่องสุ่มลุ้นโชค',
        description: 'เสี่ยงดวงลุ้นรับของรางวัลฟรี! เปิดเผยอัตราการออกรางวัลของทุกรายการอย่างโปร่งใส ถูกรางวัลแล้วทักแชทมารับได้เลย',
        costPerPlay: 20,
      },
      license: {
        key: null,
        label: null,
        expiresAt: null,
      },
    },
    users: [
      { id: nanoid(8), username: 'admin', email: 'admin@lilteam.shop', passwordHash: adminPasswordHash, role: 'admin', walletBalance: 0, status: 'active', createdAt: now },
      { id: nanoid(8), username: 'demo', email: 'demo@lilteam.shop', passwordHash: demoUserHash, role: 'customer', walletBalance: 500, status: 'active', createdAt: now },
    ],
    products,
    filterTags,
    homeSections: [
      { id: nanoid(8), title: 'เกมมาใหม่', mode: 'newest', limit: 5, productIds: [] },
    ],
    stockItems,
    orders: [],
    coupons: [
      { id: nanoid(8), code: 'WELCOME10', type: 'percent', value: 10, active: true, usageLimit: 100, usedCount: 0, expiresAt: null, createdAt: now },
    ],
    announcements: [
      { id: nanoid(8), title: 'เปิดร้านใหม่!', body: 'ยินดีต้อนรับสู่ LilTeam Shop สินค้าเกมราคาดี พร้อมส่งอัตโนมัติตลอด 24 ชั่วโมง', active: true, createdAt: now },
    ],
    reviews: [],
    walletTransactions: [],
    topupRequests: [],
    miniGamePrizes: [
      { id: nanoid(8), name: 'ไอดีเกมมือสอง (สุ่ม 1 ไอดี)', percent: 10, stock: 5, isPrize: true, image: null, active: true, createdAt: now },
      { id: nanoid(8), name: 'ส่วนลด 20 บาท (แจ้งแอดมิน)', percent: 20, stock: 20, isPrize: true, image: null, active: true, createdAt: now },
      { id: nanoid(8), name: 'สติกเกอร์ที่ระลึก', percent: 30, stock: 50, isPrize: true, image: null, active: true, createdAt: now },
      { id: nanoid(8), name: 'เสียใจด้วย ลองใหม่ครั้งหน้า', percent: 40, stock: null, isPrize: false, image: null, active: true, createdAt: now },
    ],
    miniGamePlays: [],
    licensePlans: [
      { id: nanoid(8), days: 7, price: 199, active: true, createdAt: now },
      { id: nanoid(8), days: 30, price: 599, active: true, createdAt: now },
      { id: nanoid(8), days: 90, price: 1499, active: true, createdAt: now },
    ],
    licenseSales: [],
    // Multi-tenant SaaS: a lightweight directory (slug -> shop id) used to
    // resolve a subdomain to that shop's own separately-stored full
    // dataset (see loadTenantDb/createTenantDb below). This directory
    // itself only ever lives in the MAIN site's db, never a tenant's.
    shops: [],
  };
}

let db = null;
let mongoCollection = null;
let mongoClient = null;
let mediaBucket = null;

async function init() {
  if (MONGODB_URI) {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    const mongoDb = mongoClient.db(MONGODB_DB_NAME);
    mongoCollection = mongoDb.collection('app_data');
    mediaBucket = new GridFSBucket(mongoDb, { bucketName: 'media' });

    const existing = await mongoCollection.findOne({ _id: 'main' });
    if (existing) {
      delete existing._id;
      db = existing;
    } else {
      db = defaultData();
      await mongoCollection.insertOne({ _id: 'main', ...db });
    }
    console.log('[store] Connected to MongoDB Atlas — data persists permanently.');
  } else {
    if (!fs.existsSync(DB_PATH)) {
      db = defaultData();
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    } else {
      db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
    console.log('[store] MONGODB_URI not set — using local db.json (data will reset on redeploy).');
  }

  migrate();
}

// Fills in fields added after a DB was first created, without touching existing data.
// Runs against the main site's db at startup. Tenant dbs are migrated
// separately (schema-only, no admin-recovery) the moment they're loaded —
// see migrateSchema()/loadTenantDb() below — since each tenant's dataset can
// have been created at an arbitrarily older point in this app's history and
// is never touched by this startup-only pass otherwise.
function migrate() {
  let changed = migrateAdminRecovery(db);
  if (migrateSchema(db)) changed = true;
  if (changed) save();
}

function migrateAdminRecovery(db) {
  let changed = false;
  const normalizeEnvironmentValue = (value) => {
    const trimmed = String(value || '').trim();
    if (trimmed.length >= 2) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return trimmed.slice(1, -1).trim();
      }
    }
    return trimmed;
  };
  const managedAdminPassword = normalizeEnvironmentValue(process.env.ADMIN_PASSWORD);
  const managedAdminUsername = normalizeEnvironmentValue(process.env.ADMIN_USERNAME || 'admin');

  // Safe admin recovery for hosted deployments. Setting ADMIN_PASSWORD restores
  // access without resetting products, users, orders, settings, or uploaded media.
  if (managedAdminPassword) {
    const usernameLower = managedAdminUsername.toLowerCase();
    let managedAdmins = db.users.filter(user => (user.username || '').toLowerCase() === usernameLower);
    if (!managedAdmins.length) {
      const admin = {
        id: nanoid(8), username: managedAdminUsername,
        email: `${managedAdminUsername.toLowerCase()}@admin.local`,
        passwordHash: bcrypt.hashSync(managedAdminPassword, 10), role: 'admin',
        walletBalance: 0, status: 'active', createdAt: new Date().toISOString(),
      };
      db.users.push(admin);
      managedAdmins = [admin];
      changed = true;
    }
    managedAdmins.forEach(admin => {
      if (admin.username !== managedAdminUsername) { admin.username = managedAdminUsername; changed = true; }
      if (admin.role !== 'admin') { admin.role = 'admin'; changed = true; }
      if (admin.status !== 'active') { admin.status = 'active'; changed = true; }
    });
  }
  return changed;
}

// Generic schema backfill — safe to run against any db, main or tenant.
function migrateSchema(db) {
  let changed = false;
  if (!db.settings.hero) {
    db.settings.hero = { mode: 'default', bannerImage: null, bannerLink: '' };
    changed = true;
  }
  if (!db.settings.branding) {
    db.settings.branding = { logoImage: null };
    changed = true;
  }
  if (!db.settings.theme) {
    db.settings.theme = { accent: '#c8a63f', bgPreset: 'warmDark', bgColor: null, style: 'normal' };
    changed = true;
  }
  if (db.settings.theme.bgColor === undefined) {
    db.settings.theme.bgColor = null;
    changed = true;
  }
  if (db.settings.theme.style === undefined) {
    db.settings.theme.style = 'normal';
    changed = true;
  }
  if (!db.settings.productCardStyle) {
    db.settings.productCardStyle = 'natural';
    changed = true;
  }
  if (!db.settings.payment) {
    db.settings.payment = {
      promptpayId: '', promptpayName: '', bankName: '', bankAccountNumber: '', bankAccountName: '',
      promptpayQrImage: null, bankQrImage: null,
    };
    changed = true;
  }
  if (db.settings.contactMessenger === undefined) {
    db.settings.contactMessenger = db.settings.contactFacebook || '';
    changed = true;
  }
  if (db.settings.contactFacebookName === undefined) {
    db.settings.contactFacebookName = db.settings.shopName || 'Facebook Page';
    changed = true;
  }
  if (db.settings.contactResponseTime === undefined) {
    db.settings.contactResponseTime = '5–15 นาที';
    changed = true;
  }
  if (db.settings.payment.promptpayQrImage === undefined) {
    db.settings.payment.promptpayQrImage = db.settings.payment.qrImage || null;
    changed = true;
  }
  if (db.settings.payment.bankQrImage === undefined) {
    db.settings.payment.bankQrImage = db.settings.payment.qrImage || null;
    changed = true;
  }
  if (db.settings.payment.slipokBranchId === undefined) {
    db.settings.payment.slipokBranchId = '';
    db.settings.payment.slipokApiKey = '';
    changed = true;
  }
  if (db.settings.payment.topupWebhookUrl === undefined) {
    // Each shop pastes its own Discord/Slack-compatible incoming webhook URL
    // here — never shared or mixed across shops (it's a per-tenant db field
    // like everything else in settings.payment).
    db.settings.payment.topupWebhookUrl = '';
    changed = true;
  }
  if (db.settings.payment.easyslipAccounts === undefined) {
    // Migrate the old single-bank shape (easyslipBankCode/easyslipAccountId)
    // into the new multi-select map, if it was ever set.
    const oldCode = db.settings.payment.easyslipBankCode;
    const oldId = db.settings.payment.easyslipAccountId;
    db.settings.payment.easyslipAccounts = (oldCode && oldId) ? { [oldCode]: { accountId: oldId, status: 'ok' } } : {};
    delete db.settings.payment.easyslipBankCode;
    delete db.settings.payment.easyslipAccountId;
    delete db.settings.payment.easyslipAccountType;
    if (db.settings.payment.easyslipStatus === undefined) db.settings.payment.easyslipStatus = '';
    changed = true;
  }
  if (!db.topupRequests) { db.topupRequests = []; changed = true; }
  if (!db.settings.music) {
    db.settings.music = { enabled: false, youtubeUrl: '', defaultVolume: 50, startSeconds: 0, endSeconds: 0 };
    changed = true;
  }
  if (db.settings.music && db.settings.music.startSeconds === undefined) {
    db.settings.music.startSeconds = 0;
    db.settings.music.endSeconds = 0;
    changed = true;
  }
  if (!db.settings.snow) {
    db.settings.snow = { enabled: false };
    changed = true;
  }
  if (!db.settings.miniGame) {
    db.settings.miniGame = {
      enabled: false,
      title: 'กล่องสุ่มลุ้นโชค',
      description: 'เสี่ยงดวงลุ้นรับเครดิตร้านค้าฟรี! เปิดเผยอัตราการออกรางวัลของทุกรายการอย่างโปร่งใส',
      costPerPlay: 20,
    };
    changed = true;
  }
  if (!db.settings.license) {
    db.settings.license = { key: null, label: null, expiresAt: null };
    changed = true;
  }
  if (!db.settings.discord) {
    // Bot token itself lives in the DISCORD_BOT_TOKEN env var (same pattern
    // as RECAPTCHA_SECRET_KEY) — only non-secret IDs are admin-configurable.
    db.settings.discord = {
      enabled: false,
      notifyChannelId: '',
      ticketPanelChannelId: '',
      ticketCategoryId: '',
      ticketLogChannelId: '',
      supportRoleId: '',
    };
    changed = true;
  }
  if (!db.miniGamePrizes) { db.miniGamePrizes = []; changed = true; }
  if (!db.miniGamePlays) { db.miniGamePlays = []; changed = true; }
  if (!db.licensePlans) { db.licensePlans = []; changed = true; }
  if (!db.licenseSales) { db.licenseSales = []; changed = true; }
  if (!db.shops) { db.shops = []; changed = true; }
  db.licensePlans.forEach(plan => {
    if (plan.promoUsedCount === undefined) {
      plan.promo = Boolean(plan.promo);
      plan.promoLimit = plan.promoLimit || null;
      plan.promoExpiresAt = plan.promoExpiresAt || null;
      plan.promoUsedCount = 0;
      changed = true;
    }
  });
  if (!db.homeSections) {
    // Migrates every existing shop onto the new admin-configurable
    // homepage-sections system, seeded with one section that reproduces
    // the old hardcoded "เกมมาใหม่" behavior (newest 5 products) so nothing
    // visibly changes until the admin edits/adds sections.
    db.homeSections = [{ id: nanoid(8), title: 'เกมมาใหม่', mode: 'newest', limit: 5, productIds: [] }];
    changed = true;
  }
  db.products.forEach(product => {
    if (product.purchaseApprovalEnabled === undefined) {
      product.purchaseApprovalEnabled = false;
      product.purchaseConfirmationText = '';
      changed = true;
    }
    if (product.purchaseActionUrl === undefined) {
      product.purchaseActionLabel = '';
      product.purchaseActionUrl = '';
      changed = true;
    }
    if (!product.fulfillmentMode) {
      product.fulfillmentMode = 'automatic';
      changed = true;
    }
    if (product.fulfillmentInstructions === undefined) {
      product.fulfillmentInstructions = '';
      changed = true;
    }
    if (product.howToReceiveText === undefined) {
      product.howToReceiveEnabled = true;
      product.howToReceiveText = 'รับข้อมูลสินค้าทันทีหลังชำระเงินสำเร็จ ตรวจสอบได้ที่หน้าคำสั่งซื้อของคุณ\nระบบส่งมอบอัตโนมัติตลอด 24 ชั่วโมง\nหากติดปัญหาแจ้งทางร้านได้ที่หน้าติดต่อร้าน';
      changed = true;
    }
    if (product.termsBeforeOrderText === undefined) {
      product.termsBeforeOrderEnabled = true;
      product.termsBeforeOrderText = 'กรุณาตรวจสอบชื่อสินค้า รายละเอียด และราคาก่อนยืนยันคำสั่งซื้อ\nข้อมูลสินค้าจะปรากฏในหน้าคำสั่งซื้อหลังชำระเงินสำเร็จ\nห้ามเผยแพร่หรือส่งต่อข้อมูลสินค้าที่ได้รับจากร้าน\nหากพบปัญหา กรุณาติดต่อร้านพร้อมหมายเลขคำสั่งซื้อ';
      changed = true;
    }
    if (product.warrantyText === undefined) {
      product.warrantyEnabled = true;
      product.warrantyText = 'รับประกันสินค้า 90 วันนับจากวันสั่งซื้อ\nการรับประกันเป็นไปตามรายละเอียดที่ระบุไว้ในสินค้านั้น\nกรุณาเก็บหลักฐานและหมายเลขคำสั่งซื้อไว้สำหรับติดต่อร้าน';
      changed = true;
    }
    // The opening/closing lines of the "copy message & open Messenger"
    // button on the order-detail page (fulfillmentMode: 'contact'). The
    // middle block (order number, product, customer name, prep info) is
    // always generated by the template itself, never editable here, so it
    // can never be edited away by accident.
    if (product.contactMessageIntro === undefined) {
      product.contactMessageIntro = 'สวัสดีครับ ต้องการติดต่อรับสินค้า';
      product.contactMessageOutro = 'กรุณาตรวจสอบออเดอร์และแจ้งขั้นตอนรับสินค้าให้ด้วยครับ';
      changed = true;
    }
  });
  db.miniGamePrizes.forEach(prize => {
    if (prize.isPrize === undefined) {
      prize.isPrize = (Number(prize.rewardAmount) || 0) > 0;
      changed = true;
    }
  });
  return changed;
}

function tenantDbPath(shopId) {
  return path.join(__dirname, `db.shop.${shopId}.json`);
}

function save() {
  const ctx = tenantContext.getStore();
  if (ctx) return saveTenantDb(ctx.shopId, ctx.db);
  if (mongoCollection) {
    mongoCollection.replaceOne({ _id: 'main' }, { _id: 'main', ...db }, { upsert: true })
      .catch((err) => console.error('[store] MongoDB save failed:', err.message));
  } else {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }
}

function saveTenantDb(shopId, tenantDb) {
  if (mongoCollection) {
    // Returned (not fire-and-forget) so createTenantDb can await it — a
    // shop created and then immediately redirected to must already be
    // readable by loadTenantDb on the very next request, or that request
    // sees no data yet and shows "ร้านนี้ยังไม่พร้อมใช้งาน".
    return mongoCollection.replaceOne({ _id: `shop:${shopId}` }, { _id: `shop:${shopId}`, ...tenantDb }, { upsert: true })
      .catch((err) => console.error(`[store] MongoDB save failed for shop ${shopId}:`, err.message));
  }
  fs.writeFileSync(tenantDbPath(shopId), JSON.stringify(tenantDb, null, 2));
  return Promise.resolve();
}

/**
 * Permanently deletes a tenant's entire dataset (products, orders, users,
 * wallet, settings — everything). Irreversible; callers must confirm with
 * the admin before calling this. Does not touch the main site's own db or
 * any other tenant.
 */
async function deleteTenantDb(shopId) {
  if (mongoCollection) {
    await mongoCollection.deleteOne({ _id: `shop:${shopId}` });
    return;
  }
  const file = tenantDbPath(shopId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * Load an existing tenant's full dataset, or null if that shop has none yet.
 */
async function loadTenantDb(shopId) {
  let tenantDb;
  if (mongoCollection) {
    const existing = await mongoCollection.findOne({ _id: `shop:${shopId}` });
    if (!existing) return null;
    delete existing._id;
    tenantDb = existing;
  } else {
    const file = tenantDbPath(shopId);
    if (!fs.existsSync(file)) return null;
    tenantDb = JSON.parse(fs.readFileSync(file, 'utf-8'));
  }
  // A tenant's dataset can have been created at an arbitrarily older point
  // in this app's history — fields added since (theme, homeSections, etc.)
  // are otherwise never backfilled onto it, unlike the main site's db which
  // gets migrate() at every startup. Backfill it here, in memory, on every
  // load so pages don't crash reading a missing field.
  //
  // Deliberately NOT persisted back to storage here: loadTenantDb runs on
  // every request to the shop, so writing back a full-document replaceOne
  // from here would race any concurrent request that is itself in the
  // middle of saving a real change (e.g. an admin adding a product) — an
  // older snapshot's write-back could land after and silently revert that
  // change. The backfilled fields get persisted safely the normal way, the
  // next time this tenant's own request path calls store.save().
  migrateSchema(tenantDb);
  return tenantDb;
}

/**
 * Create a brand-new tenant dataset (same shape as the main site's,
 * customized with the shop's own name and first admin account) and
 * persist it immediately.
 */
async function createTenantDb(shopId, { shopName, adminUsername, adminEmail, adminPasswordHash }) {
  const tenantDb = defaultData();
  tenantDb.settings.shopName = shopName;
  tenantDb.users = [
    {
      id: nanoid(8), username: adminUsername, email: adminEmail, passwordHash: adminPasswordHash,
      role: 'admin', walletBalance: 0, status: 'active', createdAt: new Date().toISOString(),
    },
  ];
  // A fresh shop starts with an empty catalog — the sample products are only
  // useful for the seller's own demo/main site.
  tenantDb.products = [];
  tenantDb.stockItems = [];
  tenantDb.orders = [];
  tenantDb.filterTags = [];
  tenantDb.coupons = [];
  tenantDb.announcements = [];
  tenantDb.miniGamePrizes = [];
  await saveTenantDb(shopId, tenantDb);
  return tenantDb;
}

/**
 * Run `fn` with `store.data` resolving to the given shop's own dataset for
 * the duration of the call (and anything awaited inside it) — used by the
 * subdomain-resolution middleware so every existing route works unmodified
 * against a specific tenant's data.
 */
function runInTenant(shopId, tenantDb, fn) {
  return tenantContext.run({ shopId, db: tenantDb }, fn);
}

function reset() {
  db = defaultData();
  save();
  return db;
}

async function saveMedia(buffer, filename, contentType) {
  if (r2.isEnabled()) {
    try {
      const uploaded = await r2.uploadMedia(buffer, filename, contentType);
      if (uploaded) return uploaded.url;
    } catch (err) {
      // A temporary R2 outage must not make an admin lose an upload. Keep the
      // existing GridFS/local path as a safe fallback and make the issue visible.
      console.error('[media] R2 upload failed; falling back to existing storage:', err.message);
    }
  }
  if (mediaBucket) {
    const upload = mediaBucket.openUploadStream(filename, { metadata: { contentType } });
    await new Promise((resolve, reject) => {
      upload.on('finish', resolve);
      upload.on('error', reject);
      upload.end(buffer);
    });
    return `/media/${upload.id.toString()}/${encodeURIComponent(filename)}`;
  }

  const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'media');
  fs.mkdirSync(uploadDir, { recursive: true });
  const safeName = `${Date.now()}-${nanoid(6)}-${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  fs.writeFileSync(path.join(uploadDir, safeName), buffer);
  return `/uploads/media/${safeName}`;
}

async function getMedia(id) {
  if (!mediaBucket || !ObjectId.isValid(id)) return null;
  const objectId = new ObjectId(id);
  const file = await mediaBucket.find({ _id: objectId }).next();
  if (!file) return null;
  return { file, stream: mediaBucket.openDownloadStream(objectId) };
}

function getSystemStatus() {
  const managedUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const managedAccount = db && db.users.find(user => (user.username || '').toLowerCase() === managedUsername);
  return {
    persistentStorage: Boolean(mongoCollection),
    adminRecoveryConfigured: Boolean(process.env.ADMIN_PASSWORD),
    managedAdminReady: Boolean(managedAccount && managedAccount.role === 'admin' && managedAccount.status === 'active'),
    r2Storage: r2.isEnabled(),
  };
}

module.exports = {
  get data() { return tenantContext.getStore()?.db || db; },
  init,
  save,
  reset,
  saveMedia,
  getMedia,
  isPersistent: () => Boolean(mongoCollection),
  getSystemStatus,
  genId: (len) => nanoid(len || 8),
  loadTenantDb,
  createTenantDb,
  deleteTenantDb,
  runInTenant,
  // Wrap a callback with the CURRENT tenant context so it still resolves
  // the right shop's data even if invoked later through a non-Express
  // callback API (e.g. multer's manual upload.single(...)(req, res, cb)
  // form) whose internal event/stream plumbing can lose AsyncLocalStorage
  // continuity and silently fall back to the main site's db.
  bindTenantContext: (fn) => AsyncLocalStorage.bind(fn),
};
