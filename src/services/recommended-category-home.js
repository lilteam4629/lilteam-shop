const CATEGORY_HOME_TENANTS = new Set(['bank-shop']);

function shouldGroupRecommendedProductsOnHome(req) {
  if (!req) return false;
  if (!req.tenantShop) return true;
  return CATEGORY_HOME_TENANTS.has(String(req.tenantShop.slug || '').trim().toLowerCase());
}

function shouldShowFullRecommendedCategoryImages(req) {
  return String(req?.tenantShop?.slug || '').trim().toLowerCase() === 'nwgamer';
}

function shouldUseModernRecommendedCategoryAdmin(req) {
  return shouldShowFullRecommendedCategoryImages(req);
}

function getEnabledRecommendedProductIds(categories = []) {
  const productIds = new Set();
  for (const category of categories) {
    if (!category || category.enabled === false || !Array.isArray(category.productIds)) continue;
    for (const id of category.productIds) {
      if (id !== null && id !== undefined && String(id).trim()) productIds.add(String(id));
    }
  }
  return productIds;
}

function filterHomeProductsByRecommendedCategory(products, categories, req) {
  if (!Array.isArray(products) || !shouldGroupRecommendedProductsOnHome(req)) return products;
  const assignedIds = getEnabledRecommendedProductIds(categories);
  return products.filter(product => !assignedIds.has(String(product.id)));
}

module.exports = {
  filterHomeProductsByRecommendedCategory,
  getEnabledRecommendedProductIds,
  shouldGroupRecommendedProductsOnHome,
  shouldShowFullRecommendedCategoryImages,
  shouldUseModernRecommendedCategoryAdmin,
};
