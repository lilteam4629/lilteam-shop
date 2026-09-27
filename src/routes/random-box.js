const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { currentUser, requireLogin } = require('../middleware/auth');
const randomBox = require('../services/random-box');
const { runWithCheckoutQueue } = require('../services/checkout-queue');

router.post('/:productId/draw', requireLogin, async (req, res) => {
  if (!randomBox.supportsRandomBox(req)) return res.status(404).render('shop/404', { title: 'ไม่พบสินค้า' });

  const product = store.data.products.find(item => String(item.id) === String(req.params.productId));
  const returnPath = product?.slug ? `/game/${encodeURIComponent(product.slug)}` : '/products';
  const idempotencyKey = String(req.body.drawRequestId || '').trim();
  if (!/^[a-zA-Z0-9._:-]{16,100}$/.test(idempotencyKey)) {
    req.flash('error', 'คำขอสุ่มไม่ถูกต้อง กรุณาโหลดหน้าสินค้าใหม่');
    return res.redirect(returnPath);
  }

  try {
    const user = currentUser(req);
    const result = await runWithCheckoutQueue(() => store.transact(data => randomBox.drawRandomBox(data, {
      productId: req.params.productId,
      userId: user.id,
      idempotencyKey,
      drawCount: req.body.drawCount,
      now: Date.now(),
      randomInt: crypto.randomInt,
      genId: store.genId,
    })));
    const summary = result.result || {};
    const drawCount = Number(summary.drawCount) || 1;
    const total = Number(summary.total) || drawCount * randomBox.RANDOM_BOX_PRICE;
    const winCount = Number(summary.winCount) || (summary.isWin ? 1 : 0);
    const stockNote = summary.stockExhausted ? ' · สต็อกรางวัลหมด จึงหยุดสุ่มเท่านี้' : '';
    req.flash('success', winCount
      ? `ยินดีด้วย! ได้รับรางวัล ${winCount} ชิ้น · สุ่ม ${drawCount} ครั้ง ใช้เงิน ฿${total.toLocaleString('th-TH')}${stockNote}`
      : `สุ่ม ${drawCount} ครั้งเรียบร้อย · ใช้เงิน ฿${total.toLocaleString('th-TH')}${stockNote}`);
    return res.redirect(`/account/orders/${encodeURIComponent(result.orderId)}`);
  } catch (error) {
    const safeCodes = new Set(['PRODUCT_UNAVAILABLE', 'NOT_RANDOM_BOX', 'NO_PRIZES', 'USER_UNAVAILABLE', 'INSUFFICIENT_BALANCE', 'INVALID_DRAW_COUNT']);
    const safeMessage = error.code === 'INVALID_DRAW_COUNT'
      ? `เลือกจำนวนเปิดกล่องได้ตั้งแต่ 1 ถึง ${randomBox.MAX_RANDOM_BOX_DRAWS} ครั้ง`
      : error.message;
    req.flash('error', safeCodes.has(error.code) ? safeMessage : 'เปิดกล่องไม่สำเร็จ กรุณาลองอีกครั้ง');
    if (!safeCodes.has(error.code)) console.error('[random-box] draw failed:', error);
    return res.redirect(returnPath);
  }
});

module.exports = router;
