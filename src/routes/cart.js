const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { requireLogin, currentUser } = require('../middleware/auth');
const { withEffectivePrice } = require('../services/pricing');
const catalogSyndication = require('../services/catalog-syndication');
const { MAIN_SITE_URL } = require('../middleware/tenant');

function getCart(req) {
  if (!req.session.cart) req.session.cart = [];
  return req.session.cart;
}

function availableStock(productId) {
  return store.data.stockItems.filter(s => s.productId === productId && s.status === 'available').length;
}

function isProductVisible(product) {
  if (!product || product.status !== 'active') return false;
  if (!product.publishAt) return true;
  const value = String(product.publishAt);
  const time = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}:00+07:00`);
  return time <= Date.now();
}

// A product with priceOptions gets cheaper per unit past certain quantity
// thresholds (e.g. 5+ units = ฿50/unit instead of ฿60/unit) — this picks the
// highest threshold the given quantity qualifies for, or the base price if
// none do. All tiers share the same stock pool and deliver the same thing.
function resolveUnitPrice(product, qty) {
  let price = product.price;
  if (product.priceOptions && product.priceOptions.length) {
    product.priceOptions.forEach(tier => { if (qty >= tier.minQty) price = tier.price; });
  }
  return price;
}

function tenantRemoteProduct(req, slug) {
  if (!req?.tenantShop) return null;
  return catalogSyndication.findTenantProduct(
    store.platformData,
    store.data,
    slug,
    MAIN_SITE_URL || `${req.protocol}://${req.get('host')}`,
    req.tenantShop,
  );
}

function buildCartView(req) {
  const cart = getCart(req);
  const items = cart.map(ci => {
    const remote = ci.sourceProductId ? tenantRemoteProduct(req, ci.productId) : null;
    const storedProduct = remote || store.data.products.find(p => p.id === ci.productId);
    if (!isProductVisible(storedProduct)) return null;
    const product = remote ? { ...remote, federatedCheckout: true } : withEffectivePrice(storedProduct);
    if (ci.federatedPrice !== undefined && Number.isFinite(Number(ci.federatedPrice)) && Number(ci.federatedPrice) >= 0) {
      product.price = Math.round(Number(ci.federatedPrice) * 100) / 100;
      product.federatedCheckout = true;
    }
    const stock = remote ? remote.stockCount : availableStock(product.id);
    if (stock <= 0) return null;
    const qty = Math.min(ci.qty, Math.max(stock, 0));
    if (qty <= 0) return null;
    const unitPrice = resolveUnitPrice(product, qty);
    return {
      product, qty, stock, unitPrice, subtotal: unitPrice * qty,
      federatedTenantId: ci.federatedTenantId || null,
      sourceProductId: ci.sourceProductId || null,
      sourcePrice: Number(ci.sourcePrice || product.sourcePrice || product.price) || 0,
    };
  }).filter(Boolean);
  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  return { items, total };
}

router.post('/add/:productId', (req, res) => {
  const localProduct = store.data.products.find(p => p.id === req.params.productId);
  const remoteProduct = localProduct ? null : tenantRemoteProduct(req, req.params.productId);
  const product = remoteProduct || localProduct;
  if (!isProductVisible(product)) {
    req.flash('error', 'ไม่พบสินค้า');
    return res.redirect('back');
  }
  const stock = remoteProduct ? remoteProduct.stockCount : availableStock(product.id);
  if (stock < 1) {
    req.flash('error', 'สินค้าหมดสต๊อก');
    return res.redirect('back');
  }
  if (!remoteProduct && product.purchaseApprovalEnabled && req.body.purchaseConfirmed !== 'yes') {
    req.flash('error', 'กรุณาติ๊กยืนยันเงื่อนไขก่อนเพิ่มลงตะกร้า');
    return res.redirect(`/game/${product.slug}`);
  }
  const requestedQty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const federated = Boolean(remoteProduct) || (req.query.federated === '1' && req.session.federatedCatalog &&
    String(req.session.federatedCatalog.sourceProductId) === String(product.id) &&
    Number(req.session.federatedCatalog.expiresAt) > Date.now());
  const cart = getCart(req);
  const cartProductId = remoteProduct ? remoteProduct.slug : product.id;
  const existing = cart.find(c => c.productId === cartProductId);
  if (existing) {
    existing.qty = Math.min(existing.qty + requestedQty, stock);
  } else {
    cart.push({ productId: cartProductId, qty: Math.min(requestedQty, stock), ...(federated ? {
      sourceProductId: remoteProduct?.sourceProductId || String(req.session.federatedCatalog.sourceProductId),
      sourcePrice: Number(remoteProduct?.sourcePrice || req.session.federatedCatalog.sourcePrice || product.price),
      federatedPrice: Number(remoteProduct?.price || req.session.federatedCatalog.price || product.price),
      federatedTenantId: String(remoteProduct ? req.tenantShop.id : req.session.federatedCatalog.tenantId),
    } : {}) });
  }
  req.flash('success', `เพิ่ม "${product.title}" ลงตะกร้าแล้ว`);
  res.redirect('/cart');
});

router.post('/update/:productId', (req, res) => {
  const cart = getCart(req);
  const item = cart.find(c => c.productId === req.params.productId);
  const qty = parseInt(req.body.qty, 10);
  if (item && qty > 0) {
    const remote = item.sourceProductId ? tenantRemoteProduct(req, item.productId) : null;
    const stock = remote ? remote.stockCount : availableStock(item.productId);
    item.qty = Math.min(qty, stock);
  }
  res.redirect('/cart');
});

router.post('/remove/:productId', (req, res) => {
  req.session.cart = getCart(req).filter(c => c.productId !== req.params.productId);
  res.redirect('/cart');
});

router.get('/', (req, res) => {
  const { items, total } = buildCartView(req);
  res.render('shop/cart', { title: 'ตะกร้าสินค้า', items, total, coupon: req.session.coupon || null });
});

router.post('/coupon', (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  const coupon = store.data.coupons.find(c => c.code === code && c.active);
  if (!coupon) {
    req.flash('error', 'โค้ดส่วนลดไม่ถูกต้องหรือหมดอายุ');
    return res.redirect('/cart');
  }
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    req.flash('error', 'โค้ดส่วนลดถูกใช้ครบจำนวนแล้ว');
    return res.redirect('/cart');
  }
  req.session.coupon = { code: coupon.code, type: coupon.type, value: coupon.value };
  req.flash('success', `ใช้โค้ดส่วนลด "${coupon.code}" แล้ว`);
  res.redirect('/cart');
});

router.post('/coupon/remove', (req, res) => {
  req.session.coupon = null;
  res.redirect('/cart');
});

let checkoutQueue = Promise.resolve();
function runWithCheckoutQueue(fn) {
  const result = checkoutQueue.then(fn, fn);
  checkoutQueue = result.catch(() => {});
  return result;
}

const checkoutLocks = new Set();

// A tenant can complete a syndicated purchase in its own storefront. The
// tenant wallet is funded through the platform receiver (see account.js),
// while the source stock is reserved on the main shop and the order remains a
// contact/pickup order so credentials never leak into the tenant database.
async function completeTenantFederatedCheckout({ req, user, items, total, discount, finalTotal, validCoupon }) {
  if (!req.tenantShop || items.some(item => !item.federatedTenantId)) {
    throw new Error('กรุณาแยกซื้อสินค้าร้านหลักและสินค้าจาก API คนละรายการ');
  }
  const orderId = store.genId(10);
  const now = new Date().toISOString();
  const sourceItems = [];
  const tenantId = String(req.tenantShop.id);
  let tenantRevenue = 0;

  await store.runOnPlatform(() => store.transact(data => {
    const sourceProducts = new Map((data.products || []).map(product => [String(product.id), product]));
    for (const item of items) {
      const source = sourceProducts.get(String(item.sourceProductId));
      if (!source || source.status !== 'active') throw new Error(`สินค้า "${item.product.title}" ไม่พร้อมขาย`);
      const pool = data.stockItems.filter(stock => stock.productId === source.id && stock.status === 'available');
      if (pool.length < item.qty) throw new Error(`สินค้า "${item.product.title}" มีสต็อกไม่พอ`);
      for (let index = 0; index < item.qty; index += 1) {
        const stock = pool[index];
        stock.status = 'sold';
        stock.soldOrderId = orderId;
        sourceItems.push({ item, source, stock });
      }
    }
    const sourceTotal = sourceItems.reduce((sum, row) => sum + (Number(row.item.sourcePrice) || Number(row.source.price) || 0), 0);
    tenantRevenue = Math.max(0, Math.round((finalTotal - sourceTotal) * 100) / 100);
    data.settings.catalogApi ||= { enabled: true, source: 'main-store', markupMode: 'percent', markupValue: 0, settlementMode: 'platform', ownerRevenue: 0, tenantRevenue: 0, transactions: [] };
    data.settings.catalogApi.ownerRevenue = Math.round((Number(data.settings.catalogApi.ownerRevenue || 0) + finalTotal) * 100) / 100;
    data.settings.catalogApi.tenantRevenue = Math.round((Number(data.settings.catalogApi.tenantRevenue || 0) + tenantRevenue) * 100) / 100;
    data.settings.catalogApi.transactions ||= [];
    data.settings.catalogApi.transactions.push({
      orderId,
      type: 'manual-payout',
      tenantIds: [tenantId],
      tenantRevenueByTenant: { [tenantId]: tenantRevenue },
      total: finalTotal,
      ownerRevenue: finalTotal,
      tenantRevenue,
      createdAt: now,
    });
    // Keep a fulfillment copy in the main shop so the owner can open the
    // order and see the reserved credentials. This shadow order is excluded
    // from revenue totals to avoid counting the tenant sale twice.
    data.orders.push({
      id: orderId,
      userId: null,
      tenantOrderId: orderId,
      tenantShopId: tenantId,
      tenantShopName: req.tenantShop.name || req.tenantShop.slug || tenantId,
      items: sourceItems.map(({ item, source, stock }) => ({
        productId: source.id,
        title: source.title,
        price: item.unitPrice,
        sourcePrice: Number(item.sourcePrice) || Number(source.price) || 0,
        productImage: source.images?.[0] || '',
        importedFileCode: source.internalNote || '',
        stockItemId: stock.id,
        fulfillmentMode: 'automatic',
        federatedTenantId: tenantId,
      })),
      subtotal: total,
      discount,
      total: finalTotal,
      couponCode: validCoupon ? validCoupon.code : null,
      status: 'pending',
      paymentMethod: 'wallet',
      salesChannel: 'catalog-api-fulfillment',
      federatedTenantIds: [tenantId],
      createdAt: now,
    });
  }));

  try {
    await store.transact(data => {
      const freshUser = data.users.find(candidate => candidate.id === user.id);
      if (!freshUser || Number(freshUser.walletBalance) < finalTotal) throw new Error('ยอดเงินในกระเป๋าไม่เพียงพอ กรุณาเติมเงินก่อนทำรายการ');
      const orderItems = sourceItems.map(({ item, source }) => ({
        productId: source.id,
        title: source.title,
        price: item.unitPrice,
        sourcePrice: Number(item.sourcePrice) || Number(source.price) || 0,
        productImage: source.images?.[0] || '',
        stockItemId: null,
        fulfillmentMode: 'contact',
        fulfillmentInstructions: 'ชำระเงินผ่านร้านนี้แล้ว เงินเข้าบัญชีร้านหลัก กรุณากดติดต่อร้านหลักจากหน้านี้เพื่อรับไอดี ณ ร้านหลักเท่านั้น',
        contactMessageIntro: 'สวัสดีครับ ผมสั่งซื้อสินค้าจากร้านเช่าแล้ว ขอรับไอดีที่ร้านหลักครับ',
        contactMessageOutro: 'กรุณาตรวจสอบยอดชำระและแจ้งขั้นตอนรับสินค้าที่ร้านหลักให้ด้วยครับ',
        federatedTenantId: tenantId,
      }));
      freshUser.walletBalance = Math.round((Number(freshUser.walletBalance) - finalTotal) * 100) / 100;
      data.walletTransactions.push({ id: store.genId(10), userId: freshUser.id, type: 'purchase', amount: -finalTotal, note: `สั่งซื้อสินค้าร้านหลักผ่านร้านเช่า #${orderId}`, createdAt: now });
      if (validCoupon) {
        const coupon = data.coupons.find(candidate => candidate.code === validCoupon.code && candidate.active);
        if (coupon) coupon.usedCount = (coupon.usedCount || 0) + 1;
      }
      data.settings.catalogApi ||= {};
      data.settings.catalogApi.tenantRevenue = Math.round((Number(data.settings.catalogApi.tenantRevenue || 0) + tenantRevenue) * 100) / 100;
      data.settings.catalogApi.transactions ||= [];
      data.settings.catalogApi.transactions.push({ orderId, type: 'markup', amount: tenantRevenue, createdAt: now });
      data.orders.push({ id: orderId, userId: freshUser.id, items: orderItems, subtotal: total, discount, total: finalTotal, couponCode: validCoupon ? validCoupon.code : null, status: 'pending', paymentMethod: 'wallet', salesChannel: 'catalog-api', federatedTenantIds: [tenantId], createdAt: now });
    });
  } catch (error) {
    await store.runOnPlatform(() => store.transact(data => {
      data.stockItems.filter(stock => stock.soldOrderId === orderId).forEach(stock => { stock.status = 'available'; stock.soldOrderId = null; });
      if (data.settings.catalogApi) {
        data.settings.catalogApi.ownerRevenue = Math.max(0, Math.round((Number(data.settings.catalogApi.ownerRevenue || 0) - finalTotal) * 100) / 100);
        data.settings.catalogApi.tenantRevenue = Math.max(0, Math.round((Number(data.settings.catalogApi.tenantRevenue || 0) - tenantRevenue) * 100) / 100);
        data.settings.catalogApi.transactions = (data.settings.catalogApi.transactions || []).filter(entry => entry.orderId !== orderId);
      }
      data.orders = (data.orders || []).filter(order => order.id !== orderId);
    }));
    throw error;
  }
  return { orderId, tenantRevenue, ownerRevenue: finalTotal };
}

router.post('/checkout', requireLogin, (req, res) => {
  const user = currentUser(req);
  if (!user) {
    req.flash('error', 'กรุณาเข้าสู่ระบบก่อน');
    return res.redirect('/login');
  }

  if (checkoutLocks.has(user.id)) {
    req.flash('error', 'ระบบกำลังดำเนินการสั่งซื้อก่อนหน้า กรุณารอสักครู่');
    return res.redirect('/cart');
  }

  checkoutLocks.add(user.id);

  return runWithCheckoutQueue(async () => {
    const reservedStockItems = [];
    try {
      const { items, total } = buildCartView(req);
      if (!items.length) {
        req.flash('error', 'ตะกร้าว่างเปล่า');
        return res.redirect('/cart');
      }

      let discount = 0;
      let validCoupon = null;
      const sessionCoupon = req.session.coupon;
      if (sessionCoupon) {
        const couponRecord = store.data.coupons.find(c => c.code === sessionCoupon.code && c.active);
        if (couponRecord && (!couponRecord.usageLimit || couponRecord.usedCount < couponRecord.usageLimit)) {
          validCoupon = couponRecord;
          discount = couponRecord.type === 'percent' ? Math.round(total * (couponRecord.value / 100)) : couponRecord.value;
          discount = Math.min(discount, total);
        } else {
          req.session.coupon = null;
        }
      }
      const finalTotal = Math.round(Math.max(0, total - discount) * 100) / 100;

      if (user.walletBalance < finalTotal) {
        req.flash('error', 'ยอดเงินในกระเป๋าไม่เพียงพอ กรุณาเติมเงินก่อนทำการสั่งซื้อ');
        return res.redirect('/cart');
      }

      if (req.tenantShop && items.some(item => item.federatedTenantId)) {
        if (user.role === 'admin') {
          req.flash('error', 'บัญชีเจ้าของร้านเช่าไม่สามารถใช้เงินของร้านเช่าซื้อสินค้าจากร้านหลักได้');
          return res.redirect('/cart');
        }
        if (items.some(item => !item.federatedTenantId)) {
          req.flash('error', 'กรุณาแยกซื้อสินค้าร้านนี้และสินค้าจากร้านหลักคนละรายการ');
          return res.redirect('/cart');
        }
        const completed = await completeTenantFederatedCheckout({ req, user, items, total, discount, finalTotal, validCoupon });
        req.session.cart = [];
        req.session.coupon = null;
        req.session.federatedCatalog = null;
        req.flash('success', `สั่งซื้อสำเร็จ! กรุณากดติดต่อร้านหลักจากหน้าออเดอร์เพื่อรับไอดี (ยอดส่วนต่าง ฿${completed.tenantRevenue.toLocaleString()} บันทึกไว้แล้ว)`);
        return res.redirect(`/account/orders/${completed.orderId}`);
      }

      const orderItems = [];
      for (const item of items) {
        let stockPool = store.data.stockItems.filter(s => s.productId === item.product.id && s.status === 'available');

        if (stockPool.length < item.qty) {
          req.flash('error', `สินค้า "${item.product.title}" มีไม่พอในสต๊อก กรุณาลองใหม่`);
          return res.redirect('/cart');
        }

        for (let i = 0; i < item.qty; i++) {
          const stockItem = stockPool[i];
          stockItem.status = 'reserved';
          reservedStockItems.push(stockItem);

          orderItems.push({
            productId: item.product.id,
            title: item.product.title,
            price: item.unitPrice,
            sourcePrice: Number(item.sourcePrice || item.unitPrice) || item.unitPrice,
            productImage: item.product.images?.[0] || '',
            importedFileCode: item.product.internalNote || '',
            stockItemId: stockItem.id,
            fulfillmentMode: (item.federatedTenantId || item.product.fulfillmentMode === 'contact') ? 'contact' : 'automatic',
            fulfillmentInstructions: item.federatedTenantId
              ? 'ชำระเงินเข้าร้านหลักแล้ว กรุณาติดต่อร้านหลักเพื่อรับไอดีและรับสินค้า ณ ร้านหลักเท่านั้น'
              : (item.product.fulfillmentInstructions || ''),
            contactMessageIntro: item.federatedTenantId
              ? 'สวัสดีครับ ผมชำระเงินสำหรับสินค้าที่มาจากร้านเช่าแล้ว ขอรับไอดีที่ร้านหลักครับ'
              : (item.product.contactMessageIntro || ''),
            contactMessageOutro: item.federatedTenantId
              ? 'กรุณาตรวจสอบยอดชำระและแจ้งจุดรับสินค้าที่ร้านหลักให้ด้วยครับ'
              : (item.product.contactMessageOutro || ''),
            federatedTenantId: item.federatedTenantId || null,
          });
        }
      }

      if (!orderItems.length) {
        req.flash('error', 'สินค้าในตะกร้าหมดสต๊อกแล้ว');
        return res.redirect('/cart');
      }

      const order = {
        id: store.genId(10),
        userId: user.id,
        items: orderItems,
        subtotal: total,
        discount,
        total: finalTotal,
        couponCode: validCoupon ? validCoupon.code : null,
        status: orderItems.some(item => item.fulfillmentMode === 'contact') ? 'pending' : 'completed',
        paymentMethod: 'wallet',
        createdAt: new Date().toISOString(),
        salesChannel: orderItems.some(item => item.federatedTenantId) ? 'catalog-api' : 'direct',
        federatedTenantIds: [...new Set(orderItems.map(item => item.federatedTenantId).filter(Boolean))],
      };

      reservedStockItems.forEach(stockItem => {
        stockItem.status = 'sold';
        stockItem.soldOrderId = order.id;
      });

      user.walletBalance = Math.round((user.walletBalance - finalTotal) * 100) / 100;
      store.data.walletTransactions.push({
        id: store.genId(10), userId: user.id, type: 'purchase', amount: -finalTotal,
        note: `สั่งซื้อ #${order.id}`, createdAt: new Date().toISOString(),
      });

      if (validCoupon) {
        validCoupon.usedCount = (validCoupon.usedCount || 0) + 1;
      }

      // Federated purchases are paid into the main shop. Keep the tenant's
      // markup in the platform ledger so the owner can transfer it manually.
      if (orderItems.some(item => item.federatedTenantId)) {
        const sourceTotal = Math.round(orderItems.reduce((sum, item) => sum + (Number(item.sourcePrice) || Number(item.price) || 0), 0) * 100) / 100;
        const tenantRevenue = Math.max(0, Math.round((finalTotal - sourceTotal) * 100) / 100);
        const rawMarkupByTenant = {};
        orderItems.forEach(item => {
          if (!item.federatedTenantId) return;
          const rawMarkup = Math.max(0, (Number(item.price) || 0) - (Number(item.sourcePrice) || Number(item.price) || 0));
          rawMarkupByTenant[item.federatedTenantId] = (rawMarkupByTenant[item.federatedTenantId] || 0) + rawMarkup;
        });
        const rawMarkupTotal = Object.values(rawMarkupByTenant).reduce((sum, amount) => sum + amount, 0);
        const tenantRevenueByTenant = Object.fromEntries(Object.entries(rawMarkupByTenant).map(([tenantId, amount]) => [
          tenantId,
          Math.round((rawMarkupTotal > 0 ? tenantRevenue * (amount / rawMarkupTotal) : 0) * 100) / 100,
        ]));
        const catalogApi = store.data.settings.catalogApi ||= {
          enabled: true,
          source: 'main-store',
          markupMode: 'percent',
          markupValue: 0,
          settlementMode: 'platform',
          ownerRevenue: 0,
          tenantRevenue: 0,
          transactions: [],
        };
        catalogApi.ownerRevenue = Math.round((Number(catalogApi.ownerRevenue || 0) + finalTotal) * 100) / 100;
        catalogApi.tenantRevenue = Math.round((Number(catalogApi.tenantRevenue || 0) + tenantRevenue) * 100) / 100;
        catalogApi.transactions ||= [];
        catalogApi.transactions.push({
          orderId: order.id,
          type: 'manual-payout',
          tenantIds: [...new Set(orderItems.map(item => item.federatedTenantId).filter(Boolean))],
          total: finalTotal,
          ownerRevenue: finalTotal,
          tenantRevenue,
          tenantRevenueByTenant,
          createdAt: order.createdAt,
        });
      }

      store.data.orders.push(order);
      await store.save();

      req.session.cart = [];
      req.session.coupon = null;
      req.session.federatedCatalog = null;
      req.flash('success', 'สั่งซื้อสำเร็จ! ตรวจสอบวิธีรับสินค้าได้ที่หน้าคำสั่งซื้อ');
      res.redirect(`/account/orders/${order.id}`);
    } catch (err) {
      reservedStockItems.forEach(s => {
        if (s.status === 'reserved') s.status = 'available';
      });
      console.error('[checkout] error:', err);
      const userMessage = /^(กรุณาแยก|สินค้า .*ไม่พร้อมขาย|สินค้า .*มีสต็อกไม่พอ|ยอดเงินในกระเป๋า)/.test(String(err.message || ''))
        ? err.message
        : 'เกิดข้อผิดพลาดในการสั่งซื้อ กรุณาลองใหม่อีกครั้ง';
      req.flash('error', userMessage);
      res.redirect('/cart');
    } finally {
      checkoutLocks.delete(user.id);
    }
  });
});

module.exports = router;
