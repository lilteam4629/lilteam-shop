const express = require('express');
const router = express.Router();
const store = require('../data/store');
const byshop = require('../services/byshop');
const { requireLogin, currentUser } = require('../middleware/auth');
const { withEffectivePrice } = require('../services/pricing');

function getCart(req) {
  if (!req.session.cart) req.session.cart = [];
  return req.session.cart;
}

function availableStock(productId) {
  const localStock = store.data.stockItems.filter(s => s.productId === productId && s.status === 'available').length;
  if (localStock > 0) return localStock;
  const product = store.data.products.find(p => p.id === productId);
  if (product && product.apiProvider === 'byshop' && store.data.settings?.apiProviders?.byshop?.enabled) {
    return 999;
  }
  return 0;
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

function buildCartView(req) {
  const cart = getCart(req);
  const items = cart.map(ci => {
    const storedProduct = store.data.products.find(p => p.id === ci.productId);
    if (!isProductVisible(storedProduct)) return null;
    const product = withEffectivePrice(storedProduct);
    const stock = availableStock(product.id);
    if (stock <= 0) return null;
    const qty = Math.min(ci.qty, Math.max(stock, 0));
    if (qty <= 0) return null;
    const unitPrice = resolveUnitPrice(product, qty);
    return { product, qty, stock, unitPrice, subtotal: unitPrice * qty };
  }).filter(Boolean);
  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  return { items, total };
}

router.post('/add/:productId', (req, res) => {
  const product = store.data.products.find(p => p.id === req.params.productId);
  if (!isProductVisible(product)) {
    req.flash('error', 'ไม่พบสินค้า');
    return res.redirect('back');
  }
  const stock = availableStock(product.id);
  if (stock < 1) {
    req.flash('error', 'สินค้าหมดสต๊อก');
    return res.redirect('back');
  }
  if (product.purchaseApprovalEnabled) {
    if (req.body.purchaseConfirmed !== 'yes') {
      req.flash('error', 'กรุณาติ๊กยืนยันเงื่อนไขก่อนเพิ่มลงตะกร้า');
      return res.redirect(`/game/${product.slug}`);
    }
  }
  const requestedQty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const cart = getCart(req);
  const existing = cart.find(c => c.productId === product.id);
  if (existing) {
    existing.qty = Math.min(existing.qty + requestedQty, stock);
  } else {
    cart.push({ productId: product.id, qty: Math.min(requestedQty, stock) });
  }
  req.flash('success', `เพิ่ม "${product.title}" ลงตะกร้าแล้ว`);
  res.redirect('/cart');
});

router.post('/update/:productId', (req, res) => {
  const cart = getCart(req);
  const item = cart.find(c => c.productId === req.params.productId);
  const qty = parseInt(req.body.qty, 10);
  if (item && qty > 0) {
    const stock = availableStock(item.productId);
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

      const orderItems = [];
      for (const item of items) {
        const isByshop = item.product.apiProvider === 'byshop' && store.data.settings?.apiProviders?.byshop?.enabled;
        let stockPool = store.data.stockItems.filter(s => s.productId === item.product.id && s.status === 'available');

        // If BYSHOP auto-fulfillment is active and stock pool has fewer items than requested,
        // create instant stock items for this order.
        if (isByshop && stockPool.length < item.qty) {
          const needed = item.qty - stockPool.length;
          for (let k = 0; k < needed; k++) {
            const newStock = {
              id: store.genId(10),
              productId: item.product.id,
              username: '',
              password: '',
              extra: 'จัดส่งผ่านระบบ BYSHOP API',
              status: 'available',
              soldOrderId: null,
              addedAt: new Date().toISOString()
            };
            store.data.stockItems.push(newStock);
            stockPool.push(newStock);
          }
        }

        if (stockPool.length < item.qty) {
          req.flash('error', `สินค้า "${item.product.title}" มีไม่พอในสต๊อก กรุณาลองใหม่`);
          return res.redirect('/cart');
        }

        for (let i = 0; i < item.qty; i++) {
          const stockItem = stockPool[i];
          stockItem.status = 'reserved';
          reservedStockItems.push(stockItem);

          // Trigger BYSHOP API auto-order if enabled
          if (isByshop && store.data.settings?.apiProviders?.byshop?.autoFulfill) {
            const byshopKey = store.data.settings.apiProviders.byshop.apiKey;
            const byshopEndpoint = store.data.settings.apiProviders.byshop.endpoint;
            const byshopProductId = item.product.apiProductId || item.product.id;

            try {
              const apiRes = await byshop.placeOrder({
                apiKey: byshopKey,
                byshopProductId: byshopProductId,
                quantity: 1,
                customerInput: user.username,
                customEndpoint: byshopEndpoint
              });
              if (apiRes.ok && apiRes.deliveredCredentials) {
                stockItem.username = apiRes.deliveredCredentials.username || stockItem.username;
                stockItem.password = apiRes.deliveredCredentials.password || stockItem.password;
                stockItem.extra = apiRes.deliveredCredentials.extra || stockItem.extra;
              }
            } catch (apiErr) {
              console.error('[BYSHOP checkout fulfill error]:', apiErr.message);
            }
          }

          orderItems.push({
            productId: item.product.id,
            title: item.product.title,
            price: item.unitPrice,
            stockItemId: stockItem.id,
            fulfillmentMode: item.product.fulfillmentMode === 'contact' ? 'contact' : 'automatic',
            fulfillmentInstructions: item.product.fulfillmentInstructions || '',
            contactMessageIntro: item.product.contactMessageIntro || '',
            contactMessageOutro: item.product.contactMessageOutro || '',
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

      store.data.orders.push(order);
      await store.save();

      req.session.cart = [];
      req.session.coupon = null;
      req.flash('success', 'สั่งซื้อสำเร็จ! ตรวจสอบวิธีรับสินค้าได้ที่หน้าคำสั่งซื้อ');
      res.redirect(`/account/orders/${order.id}`);
    } catch (err) {
      reservedStockItems.forEach(s => {
        if (s.status === 'reserved') s.status = 'available';
      });
      console.error('[checkout] error:', err);
      req.flash('error', 'เกิดข้อผิดพลาดในการสั่งซื้อ กรุณาลองใหม่อีกครั้ง');
      res.redirect('/cart');
    } finally {
      checkoutLocks.delete(user.id);
    }
  });
});

module.exports = router;
