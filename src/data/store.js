require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const bcrypt = require('bcryptjs');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');

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

  const sysReqTemplate = (tier) => ({
    os: 'Windows 10 / 11 (64-bit)',
    processor: tier === 'min' ? 'Intel Core i5-8400 / AMD Ryzen 5 1600' : 'Intel Core i7-10700K / AMD Ryzen 7 3700X',
    memory: tier === 'min' ? '8 GB RAM' : '16 GB RAM',
    graphics: tier === 'min' ? 'NVIDIA GTX 1060 (6GB) / AMD RX 580' : 'NVIDIA RTX 3070 / AMD RX 6800',
    directx: 'Version 12',
    storage: '50 GB available space',
  });

  const products = [
    {
      id: nanoid(8), title: 'Shadow Realm Chronicles', slug: 'shadow-realm-chronicles',
      type: 'offline', platform: 'Windows', genres: ['action', 'rpg', 'openworld'],
      filterTagIds: ['tag-recommended', 'tag-bestseller'],
      price: 60, originalPrice: 990,
      description: 'บัญชีเกม Steam Offline พร้อมตัวเกมครบ เล่นได้ทันทีหลังชำระเงิน',
      aboutText: 'ผจญภัยในโลกแฟนตาซีมืดมิด ต่อสู้กับเงาปีศาจเพื่อกอบกู้อาณาจักรที่ล่มสลาย พร้อมระบบต่อสู้ที่ลึกซึ้งและเนื้อเรื่องหลายแขนง เหมาะสำหรับผู้ที่ชื่นชอบเกม RPG โลกเปิดสไตล์มืดหม่น',
      images: [
        'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
        'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=800',
        'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800',
      ],
      sysReqMin: sysReqTemplate('min'), sysReqRec: sysReqTemplate('rec'),
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Nightfall Precinct', slug: 'nightfall-precinct',
      type: 'offline', platform: 'Windows', genres: ['horror', 'indie', 'adventure'],
      price: 30, originalPrice: 349,
      description: 'บัญชีเกม Steam Offline เกมสยองขวัญบรรยากาศหลอน',
      aboutText: 'สืบสวนคดีปริศนาในเมืองที่ปกคลุมด้วยความมืด ทุกการตัดสินใจส่งผลต่อตอนจบ เกมอินดี้สยองขวัญที่เน้นบรรยากาศและเรื่องราวสุดหลอน',
      images: [
        'https://images.unsplash.com/photo-1580327344181-c1163234e5a0?w=800',
        'https://images.unsplash.com/photo-1607853202273-797f1c22a38e?w=800',
      ],
      sysReqMin: sysReqTemplate('min'), sysReqRec: sysReqTemplate('rec'),
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Skyforge Tactics', slug: 'skyforge-tactics',
      type: 'offline', platform: 'Windows', genres: ['strategy', 'indie'],
      price: 75, originalPrice: 599,
      description: 'บัญชีเกม Steam Offline เกมวางแผนการรบเทิร์นเบส',
      aboutText: 'วางแผนกลยุทธ์ คุมทัพต่อสู้บนกระดานเทิร์นเบส สร้างอาณาจักรลอยฟ้าของคุณเองพร้อมตัวละครที่ปรับแต่งได้หลากหลาย',
      images: [
        'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800',
        'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
      ],
      sysReqMin: sysReqTemplate('min'), sysReqRec: sysReqTemplate('rec'),
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Ironclad Frontier', slug: 'ironclad-frontier',
      type: 'offline', platform: 'Windows', genres: ['simulation', 'openworld'],
      filterTagIds: ['tag-recommended'],
      price: 90, originalPrice: 2190,
      description: 'บัญชีเกม Steam Offline เกมจำลองสร้างอาณานิคมอวกาศ',
      aboutText: 'สร้างและบริหารอาณานิคมบนดาวเคราะห์ห่างไกล จัดการทรัพยากร ป้องกันภัยคุกคาม และขยายอาณาเขตของคุณให้เติบโต',
      images: [
        'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800',
        'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=800',
      ],
      sysReqMin: sysReqTemplate('min'), sysReqRec: sysReqTemplate('rec'),
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Velocity Drift Underground', slug: 'velocity-drift-underground',
      type: 'rental', platform: 'Windows', genres: ['simulation', 'action'],
      price: 15, originalPrice: 0,
      description: 'ไอดีเช่ารายวัน เกมแข่งรถดริฟท์ เริ่มต้นเพียงวันละ 15 บาท',
      aboutText: 'แข่งดริฟท์บนสนามใต้ดินยามค่ำคืน ปรับแต่งรถในสไตล์ของคุณ ท้าดวลกับผู้เล่นทั่วโลกแบบเรียลไทม์',
      images: ['https://images.unsplash.com/photo-1517994112540-009c47ea476b?w=800'],
      sysReqMin: sysReqTemplate('min'), sysReqRec: sysReqTemplate('rec'),
      status: 'active', createdAt: now,
    },
    {
      id: nanoid(8), title: 'Wraithhold Survival', slug: 'wraithhold-survival',
      type: 'rental', platform: 'Windows', genres: ['horror', 'openworld', 'indie'],
      price: 20, originalPrice: 0,
      description: 'ไอดีเช่ารายวัน เกมเอาตัวรอดโลกเปิด เริ่มต้นวันละ 20 บาท',
      aboutText: 'เอาตัวรอดในโลกที่เต็มไปด้วยสิ่งมีชีวิตวิญญาณร้าย สร้างที่พักพิง ล่าทรัพยากร และร่วมมือกับเพื่อนแบบผู้เล่นหลายคน',
      images: ['https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=800'],
      sysReqMin: sysReqTemplate('min'), sysReqRec: sysReqTemplate('rec'),
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
        username: `steam_${p.slug}_${i + 1}`,
        password: nanoid(10),
        extra: 'โหมด Offline เท่านั้น | บัญชีแชร์ร่วมกัน | ห้ามเปลี่ยนข้อมูลใดๆ',
        steamGuardRequests: 0,
        steamGuardCode: null,
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
      tagline: 'ไอดี Steam ออฟไลน์และเช่ารายวัน ราคาถูก ส่งอัตโนมัติ 24 ชั่วโมง',
      contactLine: '@lilteamshop',
      contactFacebook: 'https://facebook.com/lilteamshop',
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
        qrImage: null,
      },
      miniGame: {
        enabled: true,
        title: 'กล่องสุ่มลุ้นโชค',
        description: 'เสี่ยงดวงลุ้นรับเครดิตร้านค้าฟรี! เปิดเผยอัตราการออกรางวัลของทุกรายการอย่างโปร่งใส',
        costPerPlay: 20,
      },
    },
    users: [
      { id: nanoid(8), username: 'admin', email: 'admin@lilteam.shop', passwordHash: adminPasswordHash, role: 'admin', walletBalance: 0, status: 'active', createdAt: now },
      { id: nanoid(8), username: 'demo', email: 'demo@lilteam.shop', passwordHash: demoUserHash, role: 'customer', walletBalance: 500, status: 'active', createdAt: now },
    ],
    products,
    filterTags,
    stockItems,
    orders: [],
    coupons: [
      { id: nanoid(8), code: 'WELCOME10', type: 'percent', value: 10, active: true, usageLimit: 100, usedCount: 0, expiresAt: null, createdAt: now },
    ],
    announcements: [
      { id: nanoid(8), title: 'เปิดร้านใหม่!', body: 'ยินดีต้อนรับสู่ LilTeam Shop ไอดี Steam ออฟไลน์และเช่ารายวัน ส่งอัตโนมัติตลอด 24 ชั่วโมง', active: true, createdAt: now },
    ],
    reviews: [],
    walletTransactions: [],
    topupRequests: [],
    miniGamePrizes: [
      { id: nanoid(8), name: 'เครดิต 5 บาท', percent: 40, stock: null, rewardAmount: 5, image: null, active: true, createdAt: now },
      { id: nanoid(8), name: 'เครดิต 10 บาท', percent: 25, stock: 50, rewardAmount: 10, image: null, active: true, createdAt: now },
      { id: nanoid(8), name: 'เครดิต 20 บาท', percent: 15, stock: 20, rewardAmount: 20, image: null, active: true, createdAt: now },
      { id: nanoid(8), name: 'เครดิต 50 บาท', percent: 5, stock: 5, rewardAmount: 50, image: null, active: true, createdAt: now },
      { id: nanoid(8), name: 'เสียใจด้วย ลองใหม่ครั้งหน้า', percent: 15, stock: null, rewardAmount: 0, image: null, active: true, createdAt: now },
    ],
    miniGamePlays: [],
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
function migrate() {
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
  if (!db.settings.hero) {
    db.settings.hero = { mode: 'default', bannerImage: null, bannerLink: '' };
    changed = true;
  }
  if (!db.settings.branding) {
    db.settings.branding = { logoImage: null };
    changed = true;
  }
  if (!db.settings.payment) {
    db.settings.payment = {
      promptpayId: '', promptpayName: '', bankName: '', bankAccountNumber: '', bankAccountName: '',
    };
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
  if (!db.miniGamePrizes) { db.miniGamePrizes = []; changed = true; }
  if (!db.miniGamePlays) { db.miniGamePlays = []; changed = true; }
  if (changed) save();
}

function save() {
  if (mongoCollection) {
    mongoCollection.replaceOne({ _id: 'main' }, { _id: 'main', ...db }, { upsert: true })
      .catch((err) => console.error('[store] MongoDB save failed:', err.message));
  } else {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }
}

function reset() {
  db = defaultData();
  save();
  return db;
}

async function saveMedia(buffer, filename, contentType) {
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
  };
}

module.exports = {
  get data() { return db; },
  init,
  save,
  reset,
  saveMedia,
  getMedia,
  isPersistent: () => Boolean(mongoCollection),
  getSystemStatus,
  genId: (len) => nanoid(len || 8),
};
