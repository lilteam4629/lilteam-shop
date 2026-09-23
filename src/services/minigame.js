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

const LIVE_CATALOG_URL = 'https://www.lilteam.site/internal/api/catalog/products';
const LIVE_CATALOG_CACHE_MS = 30_000;
let liveCatalogCache = null;

function normalizeCatalogImage(value) {
  if (!value) return null;
  try {
    const imageUrl = new URL(String(value), 'https://www.lilteam.site');
    return imageUrl.protocol === 'https:' ? imageUrl.href : null;
  } catch {
    return null;
  }
}

// Fetch only the real shop's public catalog feed. The source API deliberately
// excludes stock credentials and returns products that currently have stock.
// This preview cache is in-memory only; it never writes the source or local DB.
async function fetchLiveCatalogPreview() {
  if (liveCatalogCache && liveCatalogCache.expiresAt > Date.now()) return liveCatalogCache.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(LIVE_CATALOG_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`เว็บจริงตอบกลับสถานะ ${response.status}`);

    const payload = await response.json();
    if (!payload || payload.ok !== true || !Array.isArray(payload.products)) {
      throw new Error('รูปแบบข้อมูลจากแค็ตตาล็อกเว็บจริงไม่ถูกต้อง');
    }

    const products = payload.products.map(product => {
      const id = String(product?.id || '').trim();
      const title = String(product?.title || '').trim();
      const availableStock = Math.max(0, Math.floor(Number(product?.availableStock) || 0));
      const images = Array.isArray(product?.images) ? product.images : [];
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

    if (!products.length) throw new Error('เว็บจริงยังไม่มีสินค้าที่พร้อมใช้ในการทดลอง');
    const data = {
      ok: true,
      source: 'lilteam.site',
      shopName: String(payload.shopName || 'LILTeam Shop'),
      fetchedAt: new Date().toISOString(),
      products,
    };
    liveCatalogCache = { expiresAt: Date.now() + LIVE_CATALOG_CACHE_MS, data };
    return data;
  } catch (error) {
    liveCatalogCache = null;
    if (error?.name === 'AbortError') throw new Error('เชื่อมเว็บจริงไม่ทันเวลา กรุณาลองใหม่');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { pickPrize, findProductForPrize, getPrizeImage, fetchLiveCatalogPreview };
