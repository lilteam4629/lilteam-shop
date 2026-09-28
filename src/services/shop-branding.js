const PLATFORM_DEFAULT_NAMES = new Set(['lilteam shop']);

function requestShopSettings(settings = {}, tenantShop = null) {
  const resolved = { ...(settings && typeof settings === 'object' ? settings : {}) };
  if (!tenantShop) return resolved;

  const currentName = String(resolved.shopName || '').trim();
  const normalizedCurrentName = currentName.replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  const tenantName = String(tenantShop.name || tenantShop.slug || '').trim();
  if ((!currentName || PLATFORM_DEFAULT_NAMES.has(normalizedCurrentName)) && tenantName) {
    resolved.shopName = tenantName;
  }

  const existingBranding = resolved.branding && typeof resolved.branding === 'object'
    ? resolved.branding
    : {};
  const tenantLogo = [tenantShop.logoImage, tenantShop.logoUrl, tenantShop.branding?.logoImage]
    .map(value => String(value || '').trim())
    .find(Boolean);
  resolved.branding = {
    ...existingBranding,
    ...(existingBranding.logoImage || !tenantLogo ? {} : { logoImage: tenantLogo }),
  };
  return resolved;
}

module.exports = { requestShopSettings };
