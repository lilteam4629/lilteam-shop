const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { currentUser } = require('../middleware/auth');

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

  const rewardAmount = Number(prize.rewardAmount) || 0;
  if (rewardAmount > 0) {
    user.walletBalance += rewardAmount;
    store.data.walletTransactions.push({
      id: store.genId(10), userId: user.id, type: 'minigame_win', amount: rewardAmount,
      note: `ถูกรางวัล "${prize.name}" จาก ${game.title}`, createdAt: new Date().toISOString(),
    });
  }

  store.data.miniGamePlays.unshift({
    id: store.genId(10), userId: user.id, username: user.username,
    prizeName: prize.name, rewardAmount, cost, createdAt: new Date().toISOString(),
  });
  store.data.miniGamePlays = store.data.miniGamePlays.slice(0, 100);

  store.save();
  res.json({
    ok: true,
    prizeName: prize.name,
    rewardAmount,
    walletBalance: user.walletBalance,
    isWin: rewardAmount > 0,
  });
});

module.exports = router;
