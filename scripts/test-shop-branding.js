const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requestShopSettings } = require('../src/services/shop-branding');

const tenantASettings = {
  shopName: 'LilTeam Shop',
  branding: { logoImage: '/media/tenant-a-logo.png' },
  tagline: 'ร้านของ A',
};
const tenantA = requestShopSettings(tenantASettings, { id: 'tenant-a', name: 'Mango Market', slug: 'mango' });
assert.equal(tenantA.shopName, 'Mango Market', 'old tenant defaults fall back to that tenant’s platform shop name');
assert.equal(tenantA.branding.logoImage, '/media/tenant-a-logo.png', 'use the tenant database logo');
assert.equal(tenantA.tagline, 'ร้านของ A');
assert.equal(tenantASettings.shopName, 'LilTeam Shop', 'render-time branding resolution must not mutate tenant data');

const tenantB = requestShopSettings(
  { shopName: 'LILTEAM SHOP', branding: { logoImage: null } },
  { id: 'tenant-b', name: 'Bank Market', logoImage: '/media/tenant-b-logo.png' },
);
assert.equal(tenantB.shopName, 'Bank Market');
assert.equal(tenantB.branding.logoImage, '/media/tenant-b-logo.png');

const renamedTenant = requestShopSettings(
  { shopName: 'My Updated Store', branding: { logoImage: '/media/custom-logo.png' } },
  { id: 'tenant-c', name: 'Original Rental Name', logoImage: '/media/metadata-logo.png' },
);
assert.equal(renamedTenant.shopName, 'My Updated Store', 'an owner-edited storefront name stays authoritative');
assert.equal(renamedTenant.branding.logoImage, '/media/custom-logo.png', 'an owner-uploaded logo stays authoritative');

const tenantWithoutLogo = requestShopSettings(
  { shopName: 'LilTeam Shop', branding: { logoImage: null } },
  { id: 'tenant-d', name: 'Store Without Logo' },
);
assert.equal(tenantWithoutLogo.shopName, 'Store Without Logo');
assert.equal(tenantWithoutLogo.branding.logoImage, null, 'never leak the platform logo into another shop');

const mainSettings = { shopName: 'LilTeam Shop', branding: { logoImage: '/media/platform-logo.png' } };
assert.deepEqual(requestShopSettings(mainSettings), mainSettings, 'platform branding remains unchanged');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'src/middleware/auth.js'), 'utf8');
const adminLayout = fs.readFileSync(path.join(root, 'src/views/layouts/admin.ejs'), 'utf8');
const experimentLayout = fs.readFileSync(path.join(root, 'src/views/layouts/admin-experiment.ejs'), 'utf8');
const experimentSidebar = fs.readFileSync(path.join(root, 'src/views/partials/admin-experiment-sidebar-effects.ejs'), 'utf8');
const adminViews = fs.readdirSync(path.join(root, 'src/views/admin'))
  .filter(file => file.endsWith('-experiment.ejs'))
  .map(file => fs.readFileSync(path.join(root, 'src/views/admin', file), 'utf8'));
assert.match(appSource, /requestShopSettings\(store\.data\.settings, req\.tenantShop\)/);
assert.match(authSource, /requestShopSettings\(store\.data\.settings, req\.tenantShop\)/);
assert.match(adminLayout, /<title>[^\n]*settings\.shopName/);
assert.match(adminLayout, /settings\.branding && settings\.branding\.logoImage/);
assert.match(adminLayout, /alt="โลโก้ <%= settings\.shopName/);
assert.match(experimentLayout, /<title>[^\n]*settings\.shopName/);
assert.match(experimentLayout, /settings\.branding && settings\.branding\.logoImage/);
assert.doesNotMatch(experimentLayout, /LILTeam Shop|LILTEAM SHOP/);
assert.match(experimentSidebar, /settings\.branding\.logoImage/);
assert.match(experimentSidebar, /settings\.shopName/);
for (const [index, view] of adminViews.entries()) {
  assert.doesNotMatch(view, /LILTeam Shop|LILTEAM SHOP/, `admin experiment view ${index} must not hardcode the platform brand`);
}

console.log('Shop branding checks passed: per-tenant names, isolated logos, owner overrides, admin titles, and both admin shells');
