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

module.exports = { pickPrize };
