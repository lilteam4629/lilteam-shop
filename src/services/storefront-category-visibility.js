// Storefront-only visibility rules. These helpers never mutate persisted categories or product assignments.
const CATEGORY_FIELDS = ['id', 'name', 'title', 'slug', 'key', 'label'];

function isMiniGameCategory(category) {
  if (!category || typeof category !== 'object') return false;
  return CATEGORY_FIELDS.some(field => {
    const value = String(category[field] || '').normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, '');
    return /minigames?/.test(value) || /มินิเกม(?:ส์)?/.test(value);
  });
}

function visibleStorefrontCategories(categories) {
  return (Array.isArray(categories) ? categories : []).filter(category => !isMiniGameCategory(category));
}

module.exports = { isMiniGameCategory, visibleStorefrontCategories };
