const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ejs = require('ejs');
const { resolveStorefrontHero, newShopPresentation } = require('../src/services/storefront-presentation');

const platform = { mode: 'banner', bannerImage: '/media/main-banner.png', bannerLink: '/game/main-only' };
const template = fs.readFileSync(path.join(__dirname, '../src/views/partials/storefront-hero-banner.ejs'), 'utf8');
for (const own of [{}, { mode: 'default', bannerImage: null }, { mode: 'inherit', bannerImage: null }, { mode: 'none', bannerImage: '/media/saved.png' }]) {
  const hero = resolveStorefrontHero(own, platform);
  assert.equal(hero.bannerImage, null);
  assert.equal(hero.bannerLink, '');
  assert.equal(hero.inherited, false);
  assert.doesNotMatch(ejs.render(template, { settings: { shopName: 'Sheep shop' }, storefrontHero: hero }), /<img|<section|main-banner|spotlight/);
}
for (const mode of ['banner', 'default', 'inherit']) {
  const own = { mode, bannerImage: '/media/sheep-banner.png', bannerLink: '/products?tag=sheep' };
  assert.equal(resolveStorefrontHero(own, platform).bannerImage, own.bannerImage);
  assert.equal(resolveStorefrontHero(own, platform).bannerLink, own.bannerLink);
}
assert.equal(resolveStorefrontHero(platform).bannerImage, platform.bannerImage);
const theme = { accent: '#5073af', bgPreset: 'monochrome' };
const defaults = newShopPresentation({ theme });
assert.equal(defaults.theme.accent, '#000000');
const { clearLegacyTenantSeeds } = require('../src/services/storefront-presentation');
const custom = { contactLine: '@sheep', contactFacebook: 'https://facebook.com/sheep', openHours: '17:00 - 00:00', tagline: 'Custom', hero: platform };
assert.deepEqual(clearLegacyTenantSeeds(structuredClone(custom)), custom);
assert.equal(clearLegacyTenantSeeds({ contactLine: '@lilteamshop' }).contactLine, '');

const contactTemplate = fs.readFileSync(path.join(__dirname, '../src/views/shop/contact.ejs'), 'utf8');
const emptyContact = ejs.render(contactTemplate, { settings: { ...defaults, shopName: 'Fresh rental' } });
assert.doesNotMatch(emptyContact, /href=""|lilteamshop|17:00/);
assert.match(emptyContact, /ร้านยังไม่ได้เพิ่มช่องทางติดต่อ/);
const serviceTemplate = fs.readFileSync(path.join(__dirname, '../src/views/partials/main-service-strip.ejs'), 'utf8');
assert.equal(ejs.render(serviceTemplate, { settings: defaults }).trim(), '');
assert.match(ejs.render(serviceTemplate, { settings: { ...defaults, shopName: 'Own shop', openHours: '08:00-22:00' } }), /08:00-22:00/);

(async () => {
  const id = `banner-check-${process.pid}`;
  const dbPath = path.join(os.tmpdir(), `${id}.json`);
  const tenantPath = path.join(__dirname, '../src/data', `db.shop.${id}.json`);
  process.env.NODE_ENV = 'test';
  process.env.TEST_DB_PATH = dbPath;
  process.env.MONGODB_URI = '';
  const store = require('../src/data/store');
  try {
    await store.init();
    store.platformData.settings.hero = platform;
    store.platformData.settings.theme = theme;
    const fresh = await store.createTenantDb(id, { shopName: 'Fresh rental', adminUsername: 'fixture', adminEmail: 'fixture@example.test', adminPasswordHash: 'fixture-hash' });
    assert.equal(fresh.settings.hero.mode, 'none');
    assert.equal(fresh.settings.theme.accent, '#000000');
    assert.equal(resolveStorefrontHero(fresh.settings.hero, platform).bannerImage, null);
    assert.equal(fresh.settings.shopName, 'Fresh rental');
    assert.equal(fresh.products.length, 0);
    assert.equal(fresh.orders.length, 0);
    assert.equal(fresh.users.length, 1);
    assert.equal(fresh.users[0].walletBalance, 0);
    for (const field of ['tagline', 'openHours', 'contactLine', 'contactFacebook', 'contactMessenger', 'contactFacebookName', 'contactResponseTime']) assert.equal(fresh.settings[field], '');
    for (const field of ['products', 'stockItems', 'orders', 'filterTags', 'homeSections', 'licensePlans', 'coupons', 'announcements', 'miniGamePrizes', 'reviews', 'walletTransactions', 'topupRequests']) assert.deepEqual(fresh[field], []);
    assert.equal(fresh.settings.catalogApi.enabled, false);
    assert.equal(fresh.settings.miniGame.enabled, false);
    assert.equal(fresh.settings.payment.bankAccountNumber, '');
    assert.equal(fresh.settings.branding.logoImage, null);
    assert.deepEqual(store.platformData.settings.hero, platform);
    console.log('PASS: empty rental content, no platform banner/theme fallback, own content preservation and real isolated tenant creation');
  } finally {
    for (const file of [dbPath, tenantPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
