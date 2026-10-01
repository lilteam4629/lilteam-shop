const { getStockPrizeName } = require('./random-box');

// Read-only display data: deliberately excludes stock credentials and login details.
function summarizeOrders(orders, data) {
  const products = new Map((data.products || []).map(p => [String(p.id), p]));
  const stocks = new Map((data.stockItems || []).map(s => [String(s.id), s]));
  return orders.map(order => {
    const purchased = new Map(), received = new Map();
    let misses = 0, awaiting = 0;
    function add(map, id, title, image, count = 1) {
      const key = JSON.stringify([String(id || ''), title, image || '']);
      const row = map.get(key);
      if (row) row.count += count;
      else map.set(key, { title, image: image || '', count });
    }
    for (const item of order.items || []) {
      const product = products.get(String(item.productId));
      const title = item.title || product?.title || 'สินค้าที่ซื้อ';
      const image = item.productImage || product?.images?.[0] || '';
      const count = Math.max(1, Number(item.qty) || 1);
      add(purchased, item.productId, title, image, count);
      if (item.randomBoxDraw) {
        const draw = item.randomBoxDraw;
        if (!draw.isWin) { misses += count; continue; }
        const prizes = draw.prizeItems || item.prizeItems || [];
        if (prizes.length) for (const prize of prizes) {
          const stock = stocks.get(String(prize.stockItemId));
          const name = prize.productTitle && prize.productTitle !== 'รางวัลกล่องสุ่ม'
            ? prize.productTitle : getStockPrizeName(stock, 'รางวัลจากรายการนี้');
          add(received, prize.productId, name, prize.productImage || '');
        }
        else add(received, item.productId, getStockPrizeName(stocks.get(String(item.stockItemId)), draw.prizeName || 'รางวัลจากรายการนี้'), '', Math.max(1, Number(draw.prizeCount) || 1));
      } else if (order.status === 'completed' && order.salesChannel !== 'catalog-api' && item.fulfillmentMode !== 'contact') {
        add(received, item.productId, title, image, count);
      } else awaiting += count;
    }
    return { id: order.id, createdAt: order.createdAt, status: order.status,
      total: Number(order.total) || 0, itemCount: (order.items || []).reduce((n, i) => n + Math.max(1, Number(i.qty) || 1), 0),
      purchased: [...purchased.values()], received: [...received.values()], misses, awaiting,
      receivedCount: [...received.values()].reduce((n, row) => n + row.count, 0) };
  });
}
module.exports = { summarizeOrders };
