function parseBangkokDateTime(value) {
  if (!value) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const parsed = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : `${text}:00+07:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function flashSaleState(product, now = Date.now()) {
  const salePrice = Number(product && product.flashSalePrice);
  const startsAt = parseBangkokDateTime(product && product.flashSaleStartAt);
  const endsAt = parseBangkokDateTime(product && product.flashSaleEndAt);
  const configured = salePrice >= 0 && salePrice < Number(product && product.price) && startsAt > 0 && endsAt > startsAt;
  const active = configured && now >= startsAt && now < endsAt;
  const upcoming = configured && now < startsAt;
  return { configured, active, upcoming, salePrice, startsAt, endsAt };
}

function effectivePrice(product, now = Date.now()) {
  const sale = flashSaleState(product, now);
  return sale.active ? sale.salePrice : Number(product.price) || 0;
}

function withEffectivePrice(product, now = Date.now()) {
  const sale = flashSaleState(product, now);
  const regularPrice = Number(product.price) || 0;
  return {
    ...product,
    regularPrice,
    price: sale.active ? sale.salePrice : regularPrice,
    flashSaleConfigured: sale.configured,
    flashSaleActive: sale.active,
    flashSaleUpcoming: sale.upcoming,
    flashSaleStartsAt: sale.startsAt,
    flashSaleEndsAt: sale.endsAt,
  };
}

module.exports = { parseBangkokDateTime, flashSaleState, effectivePrice, withEffectivePrice };
