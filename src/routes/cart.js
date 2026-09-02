const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { requireLogin, currentUser } = require('../middleware/auth');
const { withEffectivePrice } = require('../services/pricing');

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

function buildCartView(req) {
  const cart = getCart(req);
  const items = cart.map(ci => {
    const storedProduct = store.data.products.find(p => p.id === ci.productId);
    if (!isProductVisible(storedProduct)) return null;
    const product = withEffectivePrice(storedProduct);
    const stock = availableStock(product.id);
    const qty = Math.min(ci.qty, Math.max(stock, 0));
    return { product, qty, stock, subtotal: product.price * qty };
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
  const cart = getCart(req);
  const existing = cart.find(c => c.productId === product.id);
  if (existing) {
    existing.qty = Math.min(existing.qty + 1, stock);
  } else {
    cart.push({ productId: product.id, qty: 1 });
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

router.post('/checkout', requireLogin, async (req, res) => {
  const user = currentUser(req);
  const { items, total } = buildCartView(req);
  if (!items.length) {
    req.flash('error', 'ตะกร้าว่างเปล่า');
    return res.redirect('/cart');
  }
  let discount = 0;
  const coupon = req.session.coupon;
  if (coupon) {
    discount = coupon.type === 'percent' ? Math.round(total * (coupon.value / 100)) : coupon.value;
    discount = Math.min(discount, total);
  }
  const finalTotal = total - discount;

  if (user.walletBalance < finalTotal) {
    req.flash('error', 'ยอดเงินในกระเป๋าไม่เพียงพอ กรุณาเติมเงินก่อนทำการสั่งซื้อ');
    return res.redirect('/cart');
  }

  const orderItems = [];
  for (const item of items) {
    const stockPool = store.data.stockItems.filter(s => s.productId === item.product.id && s.status === 'available');
    if (stockPool.length < item.qty) {
      req.flash('error', `สินค้า "${item.product.title}" มีไม่พอในสต๊อก กรุณาลองใหม่`);
      return res.redirect('/cart');
    }
    for (let i = 0; i < item.qty; i++) {
      const stockItem = stockPool[i];
      orderItems.push({
        productId: item.product.id,
        title: item.product.title,
        price: item.product.price,
        stockItemId: stockItem.id,
        fulfillmentMode: item.product.fulfillmentMode === 'contact' ? 'contact' : 'automatic',
        fulfillmentInstructions: item.product.fulfillmentInstructions || '',
        contactMessageIntro: item.product.contactMessageIntro || '',
        contactMessageOutro: item.product.contactMessageOutro || '',
      });
    }
  }

  const order = {
    id: store.genId(10),
    userId: user.id,
    items: orderItems,
    subtotal: total,
    discount,
    total: finalTotal,
    couponCode: coupon ? coupon.code : null,
    status: orderItems.some(item => item.fulfillmentMode === 'contact') ? 'pending' : 'completed',
    paymentMethod: 'wallet',
    createdAt: new Date().toISOString(),
  };

  orderItems.forEach(oi => {
    const stockItem = store.data.stockItems.find(s => s.id === oi.stockItemId);
    stockItem.status = 'sold';
    stockItem.soldOrderId = order.id;
  });

  user.walletBalance -= finalTotal;
  store.data.walletTransactions.push({
    id: store.genId(10), userId: user.id, type: 'purchase', amount: -finalTotal,
    note: `สั่งซื้อ #${order.id}`, createdAt: new Date().toISOString(),
  });

  if (coupon) {
    const couponRecord = store.data.coupons.find(c => c.code === coupon.code);
    if (couponRecord) couponRecord.usedCount += 1;
  }

  store.data.orders.push(order);
  // Must finish persisting before redirecting — on a tenant shop, the very
  // next request (GET /account/orders/:id) reloads this tenant's db fresh
  // from MongoDB, so an unawaited save() here is a race: that request can
  // land before the write is committed and find no such order.
  await store.save();

  req.session.cart = [];
  req.session.coupon = null;
  req.flash('success', 'สั่งซื้อสำเร็จ! ตรวจสอบวิธีรับสินค้าได้ที่หน้าคำสั่งซื้อ');
  res.redirect(`/account/orders/${order.id}`);
});

module.exports = router;
