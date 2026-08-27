// Automates provisioning a brand-new Railway deployment (a fresh copy of
// this shop, PLUS its own MongoDB database) for a customer who buys a
// "new site" plan at /rent-website.
//
// Two modes:
//  - Customer-funded (default, no cost to the seller): the buyer supplies
//    only their own Railway API token in the purchase form, and the new
//    project (app service + MongoDB service, in the same project) is
//    created on THEIR Railway account/billing.
//  - Seller-funded (optional fallback): if RAILWAY_API_TOKEN is set on the
//    seller's own shop, that token is used instead when the buyer doesn't
//    provide their own.
//
// The buyer never has to sign up for MongoDB Atlas separately — a MongoDB
// service is deployed (official `mongo` Docker image, with a persistent
// volume) inside the same Railway project as the app, and the app is
// pointed at it over Railway's private network
// (`<service-name>.railway.internal`), which never touches the public
// internet.
//
// IMPORTANT: this talks to Railway's public GraphQL API (v2). The exact
// field names below are a best-effort implementation based on Railway's
// documented schema and have NOT been tested against the live API from
// this environment (outbound calls carrying an API token are blocked by
// this session's safety sandbox). Every step logs the raw GraphQL
// response/error into the sale's `provisioning.log` so failures are
// diagnosable from the admin sales history.
//
// RAILWAY_TEMPLATE_REPO ("owner/repo" of this codebase, e.g.
// "lilteam4629/lilteam-shop") must be set on the seller's shop — it's the
// one thing that's the same regardless of whose token is used, since it's
// just a public GitHub repo URL to deploy from.
//
// Every rented site deploys from the repo's default branch, and Railway's
// own GitHub webhook auto-deploy keeps it updated automatically on every
// push — confirmed working in production. Earlier versions of this file
// tried to build custom update automation on top (a separate release
// branch, per-project tokens, admin "push update" buttons); all of that
// was guesswork against an API this session can't call live to verify, and
// it broke real purchases more than once. Removed in favor of just
// trusting Railway's own auto-deploy, which needs none of that.

const axios = require('axios');
const crypto = require('crypto');

const API_URL = 'https://backboard.railway.app/graphql/v2';
const SELLER_TOKEN = process.env.RAILWAY_API_TOKEN || null;
const TEMPLATE_REPO = process.env.RAILWAY_TEMPLATE_REPO;
const MONGO_SERVICE_NAME = 'mongodb';

// "Enabled" only means the template repo is configured — a per-request
// customer token is enough to provision on its own.
const isEnabled = () => Boolean(TEMPLATE_REPO);
const hasSellerToken = () => Boolean(SELLER_TOKEN);

function randomPassword(len) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

async function gqlRequest(headers, query, variables, log) {
  try {
    const res = await axios.post(
      API_URL,
      { query, variables },
      { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    if (res.data.errors && res.data.errors.length) {
      const message = res.data.errors.map(e => e.message).join('; ');
      log.push(`✕ GraphQL error: ${message}`);
      throw new Error(message);
    }
    return res.data.data;
  } catch (err) {
    if (err.response) {
      log.push(`✕ HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 500)}`);
    } else if (!err.message.startsWith('GraphQL')) {
      log.push(`✕ Request failed: ${err.message}`);
    }
    throw err;
  }
}

// A buyer's own Railway account token (or the seller's fallback token).
async function gql(token, query, variables, log) {
  return gqlRequest({ Authorization: `Bearer ${token}` }, query, variables, log);
}

/**
 * Provision a brand-new Railway deployment of this shop (with its own
 * MongoDB database, created automatically in the same project) for a buyer.
 * @param {{ projectName: string, envVars: Record<string,string>, railwayToken?: string }} opts
 *   envVars should NOT include MONGODB_URI - it's set automatically.
 *   railwayToken - the buyer's own Railway API token. Falls back to the
 *   seller's RAILWAY_API_TOKEN (if set) when omitted. Never persisted.
 * @returns {Promise<{ ok: boolean, url?: string, projectId?: string, log: string[], error?: string }>}
 */
async function provisionNewSite({ projectName, envVars, railwayToken }) {
  const log = [];
  const token = railwayToken || SELLER_TOKEN;

  if (!TEMPLATE_REPO) {
    return { ok: false, log, error: 'RAILWAY_TEMPLATE_REPO ยังไม่ได้ตั้งค่าในร้าน' };
  }
  if (!token) {
    return { ok: false, log, error: 'ไม่มี Railway API Token (ของลูกค้าหรือของร้าน)' };
  }

  try {
    log.push(`เริ่มสร้างโปรเจกต์ "${projectName}"...`);
    const created = await gql(
      token,
      `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }`,
      { input: { name: projectName } },
      log
    );
    const projectId = created.projectCreate.id;
    log.push(`✓ สร้างโปรเจกต์แล้ว (id: ${projectId})`);

    log.push('กำลังอ่าน environment เริ่มต้น...');
    const projectInfo = await gql(
      token,
      `query($id: String!) { project(id: $id) { environments { edges { node { id name } } } } }`,
      { id: projectId },
      log
    );
    const environmentId = projectInfo.project.environments.edges[0]?.node?.id;
    if (!environmentId) throw new Error('ไม่พบ environment เริ่มต้นของโปรเจกต์ใหม่');
    log.push(`✓ ใช้ environment: ${environmentId}`);

    // --- MongoDB service (own database, no Atlas signup needed) ---
    log.push('กำลังสร้างฐานข้อมูล MongoDB ในโปรเจกต์เดียวกัน...');
    const mongoCreated = await gql(
      token,
      `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
      { input: { projectId, name: MONGO_SERVICE_NAME, source: { image: 'mongo:7' } } },
      log
    );
    const mongoServiceId = mongoCreated.serviceCreate.id;
    log.push(`✓ สร้าง service ฐานข้อมูลแล้ว (id: ${mongoServiceId})`);

    const mongoUser = 'root';
    const mongoPassword = randomPassword(20);
    log.push('กำลังเพิ่มพื้นที่เก็บข้อมูลถาวร (volume)...');
    await gql(
      token,
      `mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`,
      { input: { projectId, environmentId, serviceId: mongoServiceId, mountPath: '/data/db' } },
      log
    );
    log.push('✓ เพิ่ม volume แล้ว');

    log.push('กำลังตั้งค่าฐานข้อมูล...');
    await gql(
      token,
      `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
      {
        input: {
          projectId, environmentId, serviceId: mongoServiceId,
          variables: { MONGO_INITDB_ROOT_USERNAME: mongoUser, MONGO_INITDB_ROOT_PASSWORD: mongoPassword },
        },
      },
      log
    );
    log.push('✓ ตั้งค่าฐานข้อมูลแล้ว');

    log.push('กำลังสั่ง deploy ฐานข้อมูล...');
    await gql(
      token,
      `mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
      { serviceId: mongoServiceId, environmentId },
      log
    );
    log.push('✓ ฐานข้อมูลกำลัง deploy');

    const mongoUri = `mongodb://${mongoUser}:${mongoPassword}@${MONGO_SERVICE_NAME}.railway.internal:27017/lilteam_shop?authSource=admin`;

    // --- App service ---
    // Deliberately no branch override here — this deploys from the repo's
    // default branch and Railway's own GitHub webhook auto-deploy keeps it
    // updated on every push automatically (confirmed working in
    // production), which is simpler and more reliable than anything we can
    // build on top of the (largely unverified-from-here) Railway API.
    log.push(`กำลังสร้าง service เว็บจาก repo ${TEMPLATE_REPO}...`);
    const serviceCreated = await gql(
      token,
      `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
      { input: { projectId, name: projectName, source: { repo: TEMPLATE_REPO } } },
      log
    );
    const serviceId = serviceCreated.serviceCreate.id;
    log.push(`✓ สร้าง service เว็บแล้ว (id: ${serviceId})`);

    log.push('กำลังตั้งค่า Environment Variables ของเว็บ...');
    await gql(
      token,
      `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
      { input: { projectId, environmentId, serviceId, variables: { ...envVars, MONGODB_URI: mongoUri } } },
      log
    );
    log.push('✓ ตั้งค่าตัวแปรแล้ว');

    log.push('กำลังสร้างโดเมนสาธารณะ...');
    const domainResult = await gql(
      token,
      `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
      { input: { environmentId, serviceId } },
      log
    );
    const domain = domainResult.serviceDomainCreate.domain;
    log.push(`✓ ได้โดเมน: ${domain}`);

    log.push('กำลังสั่ง deploy เว็บ...');
    await gql(
      token,
      `mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
      { serviceId, environmentId },
      log
    );
    log.push('✓ สั่ง deploy แล้ว — เว็บจะพร้อมใช้งานภายในไม่กี่นาที และจะอัพเดตเองอัตโนมัติทุกครั้งที่มีโค้ดใหม่');

    return { ok: true, url: `https://${domain}`, projectId, serviceId, mongoServiceId, environmentId, log };
  } catch (err) {
    return { ok: false, log, error: err.message };
  }
}

/**
 * Redeploy a single already-provisioned site's app service. Used for the
 * customer's own "sync ตอนนี้" self-service button (their real Railway
 * account token) — only touches that one project/service, never any other
 * rented site. In normal operation this shouldn't be needed at all, since
 * Railway's own GitHub auto-deploy already redeploys every rented site the
 * moment new code is pushed; this is just a manual fallback.
 * @param {{ railwayToken: string, serviceId: string, environmentId: string }} opts
 */
async function redeployService({ railwayToken, serviceId, environmentId }) {
  const log = [];
  if (!railwayToken) return { ok: false, log, error: 'ไม่มี Railway API Token' };
  if (!serviceId || !environmentId) return { ok: false, log, error: 'ไม่พบข้อมูลเว็บนี้ (serviceId/environmentId)' };
  try {
    log.push('กำลังสั่งอัพเดตเว็บเป็นเวอร์ชันล่าสุด...');
    await gql(
      railwayToken,
      `mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
      { serviceId, environmentId },
      log
    );
    log.push('✓ สั่งอัพเดตแล้ว — เว็บจะพร้อมใช้งานภายในไม่กี่นาที');
    return { ok: true, log };
  } catch (err) {
    return { ok: false, log, error: err.message };
  }
}

module.exports = { isEnabled, hasSellerToken, provisionNewSite, redeployService };
