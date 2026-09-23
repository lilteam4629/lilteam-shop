// Weighted random pick among prizes that are active and still in stock.
// Odds are relative to each other, so the displayed public percentages stay
// meaningful even while some prizes are temporarily sold out.
function pickPrize(prizes) {
  const pool = prizes.filter(p => p.active && (p.stock === null || p.stock > 0) && Number(p.percent) > 0);
  const total = pool.reduce((sum, p) => sum + Number(p.percent), 0);
  if (total <= 0) return null;

  let roll = Math.random() * total;
  for (const prize of pool) {
    roll -= Number(prize.percent);
    if (roll <= 0) return prize;
  }
  return pool[pool.length - 1];
}

function normalizeProductName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function findProductForPrize(prize, products = []) {
  if (!prize || !Array.isArray(products)) return null;
  const productId = prize.productId === undefined || prize.productId === null ? '' : String(prize.productId);
  if (productId) {
    const linkedProduct = products.find(product => String(product.id) === productId);
    if (linkedProduct) return linkedProduct;
  }

  const prizeName = normalizeProductName(prize.name);
  if (!prizeName) return null;
  return products.find(product => normalizeProductName(product.title) === prizeName) || null;
}

function getPrizeImage(prize, products = []) {
  if (prize && prize.image) return prize.image;
  const product = findProductForPrize(prize, products);
  return product && Array.isArray(product.images) ? (product.images.find(Boolean) || null) : null;
}

function normalizeCatalogImage(value) {
  if (!value) return null;
  try {
    const imageUrl = new URL(String(value), 'https://www.lilteam.site');
    return imageUrl.protocol === 'https:' ? imageUrl.href : null;
  } catch {
    return null;
  }
}

// Build a read-only preview from the main shop's own data. Do not call the
// protected server-to-server internal API from this user-facing admin route:
// that endpoint correctly requires X-Internal-Secret and must stay private.
function buildLiveCatalogPreview(data = {}) {
  const productsSource = Array.isArray(data.products) ? data.products : [];
  const stockItems = Array.isArray(data.stockItems) ? data.stockItems : [];
  const availableByProduct = new Map();
  stockItems.forEach(item => {
    if (item?.status !== 'available') return;
    const productId = String(item.productId || '');
    if (productId) availableByProduct.set(productId, (availableByProduct.get(productId) || 0) + 1);
  });

  const products = productsSource.filter(product => product?.status === 'active').map(product => {
    const id = String(product.id || '').trim();
    const title = String(product.title || '').trim();
    const availableStock = availableByProduct.get(id) || 0;
    const images = Array.isArray(product.images) ? product.images : [];
    const image = normalizeCatalogImage(images.find(value => typeof value === 'string' && value.trim()));
    if (!id || !title || !image || availableStock < 1) return null;
    return {
      id,
      title,
      price: Math.max(0, Number(product.price) || 0),
      image,
      availableStock,
    };
  }).filter(Boolean);

  if (!products.length) throw new Error('เว็บจริงยังไม่มีสินค้าที่มีรูปและสต็อกพร้อมใช้ในการทดลอง');
  return {
    ok: true,
    source: 'lilteam.site',
    shopName: String(data.settings?.shopName || 'LILTeam Shop'),
    fetchedAt: new Date().toISOString(),
    products,
  };
}

module.exports = { pickPrize, findProductForPrize, getPrizeImage, buildLiveCatalogPreview };
