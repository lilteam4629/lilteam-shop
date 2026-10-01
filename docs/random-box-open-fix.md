# Random-box checkout repair

Affected surfaces: main and tenant product pages, random-box draw route, wallet/order/stock persistence, customer/admin order history, startup and tenant reload.

The reported product's read-only readiness check on the live VPS passed stock/accounting checks but failed the maximum 500-ticket persistence-size check with `STORE_SIZE_LIMIT`. Earlier inspection of a separate legacy hosted database was not evidence about this VPS and was discarded.

Random-box orders repeated product metadata and miss results in every ticket row. The repair stores their item arrays with lossless deflate compression and a SHA-256 checksum. Store readers restore the original arrays before migrations or routes use them. Prices, ticket order, prize IDs, wallet balances and non-box orders remain intact. Existing box histories are encoded on their next save; no history is deleted. The codec is used by both local JSON and server-database persistence.

Local file transactions also now mutate a private snapshot, atomically replace the saved file, and publish the snapshot only after saving succeeds. Failed mutation or disk writes cannot leave an in-memory deduction/order behind. Server-database revision filters match missing/null/string/numeric legacy versions exactly and reject stale writes.

Checks:

- `node scripts/test-store-order-codec.js`: history exceeding the 16 MiB document limit (30,327,396 bytes) becomes 338,496 bytes; all 30,000 ticket rows and normal orders round-trip exactly; corruption is rejected.
- `node scripts/test-local-store-transactions.js`: reproduced an in-memory wallet mutation after a failed checkout before the fix; rollback, simulated disk-full failure, successful commit, read-only preview and restart restoration pass after the fix.
- `node scripts/test-store-revision.js`: legacy versions, stale-write rejection and shop isolation pass.
- `node scripts/test-random-box.js`, main random-box HTTP smoke and `node scripts/test-random-box-tenant.js`: price/rate locks, shared pity, multiple rewards, stock/wallet/order integrity, replay and tenant isolation pass.
- Existing admin wallet adjustment and promotion checks pass.

Live checks use a discarded snapshot and synthetic buyer; they never buy from or deduct money on the production box. No claim is made that all future storage or service failures are impossible.
