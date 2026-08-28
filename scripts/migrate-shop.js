// One-off: copy a single tenant shop's data out of the shared multi-tenant
// database into its own standalone database (same MongoDB cluster, a
// different db name), so a new single-tenant Railway deployment pointed at
// that db name serves that shop as an ordinary (non-tenant) site.
//
// Run from the EXISTING shared deployment's Railway Console (it already has
// MONGODB_URI for the shared cluster and the `mongodb` package installed):
//
//   node scripts/migrate-shop.js <shop-slug> <destination-db-name>
//
// Example:
//   node scripts/migrate-shop.js gazyteam lilteam_shop_gazyteam
//
// Does NOT delete anything from the shared database or touch DNS/domains —
// purely copies data. Safe to re-run (overwrites the destination each time).
const { MongoClient } = require('mongodb');

async function main() {
  const [, , slug, destDbName] = process.argv;
  if (!slug || !destDbName) {
    console.error('Usage: node scripts/migrate-shop.js <shop-slug> <destination-db-name>');
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in this environment.');
    process.exit(1);
  }
  const sourceDbName = process.env.MONGODB_DB_NAME || 'lilteam_shop';
  if (destDbName === sourceDbName) {
    console.error('Destination db name must differ from the source db name.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const sourceCollection = client.db(sourceDbName).collection('app_data');

    const shopRecord = await sourceCollection.findOne({ _id: 'main' });
    const shop = (shopRecord?.shops || []).find(s => s.slug === slug);
    if (!shop) {
      console.error(`No shop with slug "${slug}" found in the shared shops list.`);
      process.exit(1);
    }

    const tenantDoc = await sourceCollection.findOne({ _id: `shop:${shop.id}` });
    if (!tenantDoc) {
      console.error(`Shop "${slug}" (id ${shop.id}) has no tenant data document.`);
      process.exit(1);
    }
    delete tenantDoc._id;

    const destCollection = client.db(destDbName).collection('app_data');
    await destCollection.replaceOne({ _id: 'main' }, { _id: 'main', ...tenantDoc }, { upsert: true });

    console.log(`✓ Copied shop "${slug}" (${shop.name}) into database "${destDbName}" as the standalone site's main data.`);
    console.log('Next: point the new deployment\'s MONGODB_DB_NAME at', destDbName, 'and its domain at this shop.');
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
