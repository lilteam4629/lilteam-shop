const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { currentUser } = require('../middleware/auth');
const { pickPrize } = require('../services/minigame');

router.post('/play', (req, res) => {
  const game = store.data.settings.miniGame;
  const user = currentUser(req);

  if (!user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนเล่น' });
  }
  if (!game || !game.enabled) {
    return res.status(400).json({ error: 'มินิเกมนี้ปิดใช้งานอยู่ในขณะนี้' });
  }

  const cost = Number(game.costPerPlay) || 0;
  if (user.walletBalance < cost) {
    return res.status(400).json({ error: 'ยอดเครดิตไม่พอ กรุณาเติมเงินก่อนเล่น' });
  }

  const prize = pickPrize(store.data.miniGamePrizes);
  if (!prize) {
    return res.status(400).json({ error: 'ของรางวัลหมดชั่วคราว กรุณาลองใหม่ภายหลัง' });
  }

  user.walletBalance -= cost;
  store.data.walletTransactions.push({
    id: store.genId(10), userId: user.id, type: 'minigame_play', amount: -cost,
    note: `เล่น ${game.title}`, createdAt: new Date().toISOString(),
  });

  if (prize.stock !== null) prize.stock = Math.max(0, prize.stock - 1);

  const isWin = Boolean(prize.isPrize);
  const claimCode = isWin ? store.genId(6).toUpperCase() : null;

  store.data.miniGamePlays.unshift({
    id: store.genId(10), userId: user.id, username: user.username,
    prizeName: prize.name, isWin, claimCode,
    status: isWin ? 'pending' : 'none', cost, createdAt: new Date().toISOString(),
  });
  store.data.miniGamePlays = store.data.miniGamePlays.slice(0, 200);

  store.save();
  res.json({
    ok: true,
    prizeName: prize.name,
    image: prize.image || null,
    isWin,
    claimCode,
    walletBalance: user.walletBalance,
  });
});

module.exports = router;
