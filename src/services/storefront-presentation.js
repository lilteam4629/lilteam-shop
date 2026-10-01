const DEFAULT_BANNER = '/images/storefront-default-banner.svg';

// Presentation defaults are shared; catalog, accounts and wallets stay tenant scoped.
function resolveStorefrontHero(ownHero = {}, platformHero = {}, isMainSite = false) {
  const own = ownHero && typeof ownHero === 'object' ? ownHero : {};
  const platform = platformHero && typeof platformHero === 'object' ? platformHero : {};
  const useOwn = own.mode !== 'inherit' && String(own.bannerImage || '').trim();
  const image = useOwn || (!isMainSite && String(platform.bannerImage || '').trim()) || DEFAULT_BANNER;
  return {
    mode: 'banner',
    bannerImage: image,
    // A platform campaign link must not send a rental customer to another shop's checkout.
    bannerLink: useOwn ? String(own.bannerLink || '') : '/products',
    inherited: !useOwn,
  };
}

function newShopPresentation(platformSettings = {}) {
  return {
    hero: { mode: 'inherit', bannerImage: null, bannerLink: '' },
    storefrontModel: 'classic',
    theme: JSON.parse(JSON.stringify(platformSettings.theme || {
      accent: '#000000', bgPreset: 'monochrome', bgColor: null, style: 'normal',
    })),
  };
}

module.exports = { DEFAULT_BANNER, resolveStorefrontHero, newShopPresentation };
