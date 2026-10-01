const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ejs = require('ejs');
const { resolveStorefrontHero, newShopPresentation, DEFAULT_BANNER } = require('../src/services/storefront-presentation');

const platform = { mode: 'banner', bannerImage: '/media/main-banner.png', bannerLink: '/game/main-only' };
for (const own of [{}, { mode: 'default', bannerImage: null }, { mode: 'inherit', bannerImage: '/media/previous.png' }]) {
  const hero = resolveStorefrontHero(own, platform);
  assert.equal(hero.bannerImage, platform.bannerImage);
  assert.equal(hero.bannerLink, '/products');
  const rendered = ejs.render(fs.readFileSync(path.join(__dirname, '../src/views/partials/storefront-hero-banner.ejs'), 'utf8'), { settings: { shopName: 'Sheep shop' }, storefrontHero: hero });
  assert.match(rendered, /owner-home-v20-hero--banner-only/);
  assert.doesNotMatch(rendered, /spotlight|สินค้าเข้าใหม่|<h1/);
  assert.match(rendered, /\/media\/main-banner.png/);
}
const own = { mode: 'default', bannerImage: '/media/sheep-banner.png', bannerLink: '/products?tag=sheep' };
assert.equal(resolveStorefrontHero(own, platform).bannerImage, own.bannerImage);
assert.equal(resolveStorefrontHero(own, platform).bannerLink, own.bannerLink);
assert.equal(resolveStorefrontHero({}, {}).bannerImage, DEFAULT_BANNER);
assert.equal(resolveStorefrontHero(platform, {}, true).bannerImage, platform.bannerImage);
const theme = { accent: '#5073af', bgPreset: 'monochrome' };
const defaults = newShopPresentation({ theme });
defaults.theme.accent = '#ffffff';
assert.equal(theme.accent, '#5073af');

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
    assert.equal(fresh.settings.hero.mode, 'inherit');
    assert.equal(fresh.settings.theme.accent, theme.accent);
    assert.equal(resolveStorefrontHero(fresh.settings.hero, platform).bannerImage, platform.bannerImage);
    assert.equal(fresh.settings.shopName, 'Fresh rental');
    assert.equal(fresh.products.length, 0);
    assert.equal(fresh.orders.length, 0);
    assert.equal(fresh.users.length, 1);
    assert.equal(fresh.users[0].walletBalance, 0);
    console.log('PASS: legacy/new rental banners, own banner override, safe links, shared rendering and real isolated tenant creation');
  } finally {
    for (const file of [dbPath, tenantPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
