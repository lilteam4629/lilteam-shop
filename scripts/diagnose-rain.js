// Read-only diagnostic for the rain delivery pipeline. Makes zero writes —
// connects directly with the Mongo driver and only ever calls findOne().
// Usage (run inside the app container so MONGODB_URI is set):
//   node scripts/diagnose-rain.js <shop-slug>
//   node scripts/diagnose-rain.js               (lists every shop + its rain state)
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'lilteam_shop';

async function main() {
  const slug = process.argv[2] || null;
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set in this shell — run this INSIDE the app container, e.g.:');
    console.error('  docker compose -f deploy/community/compose.yml exec app node scripts/diagnose-rain.js ' + (slug || '<shop-slug>'));
    process.exit(1);
  }
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const col = client.db(MONGODB_DB_NAME).collection('app_data');

  const main = await col.findOne({ _id: 'main' });
  if (!main) { console.error('No "main" document found'); process.exit(1); }

  const shops = main.shops || [];
  const rainReleases = (main.tenantFeatureReleases || []).filter(r => r.feature === 'rain');

  console.log('=== Rain releases on file ===');
  if (!rainReleases.length) console.log('  (none created yet)');
  for (const r of rainReleases) {
    console.log(`  [${r.id}] "${r.name}" v${r.version} action=${r.action} createdAt=${r.createdAt}`);
    if (!r.deployments || !r.deployments.length) {
      console.log('      no deployments recorded for this release');
    }
    for (const d of (r.deployments || [])) {
      console.log(`      deployment ${d.id} @ ${d.createdAt} scope=${d.scope} shopIds=[${(d.shopIds || []).join(', ')}]`);
    }
  }

  const targets = slug ? shops.filter(s => s.slug === slug) : shops;
  if (slug && !targets.length) {
    console.error(`\nNo shop with slug "${slug}". Known slugs: ${shops.map(s => s.slug).join(', ')}`);
    await client.close();
    process.exit(1);
  }

  console.log('\n=== Per-shop rain state ===');
  for (const shop of targets) {
    const tenantDoc = await col.findOne({ _id: `shop:${shop.id}` });
    if (!tenantDoc) {
      console.log(`  ${shop.slug} (id=${shop.id}, isSystemLab=${!!shop.isSystemLab}) — NO TENANT DOCUMENT FOUND`);
      continue;
    }
    const settings = tenantDoc.settings || {};
    console.log(`  ${shop.slug} (id=${shop.id}, isSystemLab=${!!shop.isSystemLab})`);
    console.log(`      settings.rain           = ${JSON.stringify(settings.rain ?? null)}`);
    console.log(`      settings.systemModules  = ${JSON.stringify(settings.systemModules ?? null)}`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
