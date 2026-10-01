// Share the storefront components, never another shop's content.
function resolveStorefrontHero(ownHero = {}) {
  const own = ownHero && typeof ownHero === 'object' ? ownHero : {};
  const image = own.mode === 'none' ? '' : String(own.bannerImage || '').trim();
  return { mode: image ? 'banner' : 'none', bannerImage: image || null,
    bannerLink: image ? String(own.bannerLink || '') : '', inherited: false };
}

const LEGACY_TENANT_SEEDS = {
  tagline: 'สินค้าเกมราคาดี พร้อมส่งอัตโนมัติตลอด 24 ชั่วโมง',
  contactLine: '@lilteamshop', contactFacebook: 'https://facebook.com/lilteamshop',
  contactMessenger: 'https://m.me/lilteamshop', contactFacebookName: 'LilTeam Shop',
  contactResponseTime: '5–15 นาที', openHours: '17:00 - 00:00',
};

// Only remove known bootstrap text from older tenants. Keep their own content.
function clearLegacyTenantSeeds(settings) {
  for (const [key, value] of Object.entries(LEGACY_TENANT_SEEDS)) {
    if (key.startsWith('contact') && key !== 'contactResponseTime' && settings[key] === value) settings[key] = '';
    if (key === 'contactMessenger' && settings[key] === LEGACY_TENANT_SEEDS.contactFacebook) settings[key] = '';
  }
  return settings;
}

function newShopPresentation() {
  return {
    ...Object.fromEntries(Object.keys(LEGACY_TENANT_SEEDS).map(key => [key, ''])),
    hero: { mode: 'none', bannerImage: null, bannerLink: '' },
    storefrontModel: 'classic', genres: {},
    theme: { accent: '#000000', bgPreset: 'monochrome', bgColor: null, style: 'normal' },
  };
}
module.exports = { resolveStorefrontHero, newShopPresentation, clearLegacyTenantSeeds };
