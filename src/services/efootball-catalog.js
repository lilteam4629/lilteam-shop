const fallback = require('../catalog/efootball-source.json');

function normalize(value) { return String(value || '').trim().toLowerCase(); }

function queryCatalog(query = {}) {
  const search = normalize(query.search || query.q);
  const position = normalize(query.position);
  const minRating = Number(query.minRating || 0);
  const sort = normalize(query.sort || 'rating');
  let items = fallback.filter(item => {
    if (search && !normalize(`${item.name} ${item.id} ${item.position}`).includes(search)) return false;
    if (position && position !== 'all' && normalize(item.position) !== position) return false;
    return Number(item.rating) >= minRating;
  });
  items = [...items].sort((a, b) => sort === 'name'
    ? a.name.localeCompare(b.name, 'en')
    : Number(b.rating) - Number(a.rating));
  return { items, total: items.length, positions: [...new Set(fallback.map(item => item.position))].sort() };
}

function status() { return { count: fallback.length, source: 'eFHUB', sourceUrl: 'https://efhub.com/th' }; }

module.exports = { queryCatalog, status, get sourceCount() { return fallback.length; } };
