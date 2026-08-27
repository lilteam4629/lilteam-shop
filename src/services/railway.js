// Automates provisioning a brand-new Railway deployment (a fresh copy of
// this shop) for a customer who buys a "new site" plan at /rent-website.
//
// Two modes:
//  - Customer-funded (default, no cost to the seller): the buyer supplies
//    their own Railway API token + MongoDB URI in the purchase form, and
//    the new project is created on THEIR Railway account/billing.
//  - Seller-funded (optional fallback): if RAILWAY_API_TOKEN is set on the
//    seller's own shop, that token is used instead when the buyer doesn't
//    provide their own.
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

const axios = require('axios');

const API_URL = 'https://backboard.railway.app/graphql/v2';
const SELLER_TOKEN = process.env.RAILWAY_API_TOKEN || null;
const TEMPLATE_REPO = process.env.RAILWAY_TEMPLATE_REPO;

// "Enabled" only means the template repo is configured — a per-request
// customer token is enough to provision on its own.
const isEnabled = () => Boolean(TEMPLATE_REPO);
const hasSellerToken = () => Boolean(SELLER_TOKEN);

async function gql(token, query, variables, log) {
  try {
    const res = await axios.post(
      API_URL,
      { query, variables },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 30000 }
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

/**
 * Provision a brand-new Railway deployment of this shop for a buyer.
 * @param {{ projectName: string, envVars: Record<string,string>, railwayToken?: string }} opts
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

    log.push(`กำลังสร้าง service จาก repo ${TEMPLATE_REPO}...`);
    const serviceCreated = await gql(
      token,
      `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
      { input: { projectId, name: projectName, source: { repo: TEMPLATE_REPO } } },
      log
    );
    const serviceId = serviceCreated.serviceCreate.id;
    log.push(`✓ สร้าง service แล้ว (id: ${serviceId})`);

    log.push('กำลังตั้งค่า Environment Variables...');
    await gql(
      token,
      `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
      { input: { projectId, environmentId, serviceId, variables: envVars } },
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

    log.push('กำลังสั่ง deploy...');
    await gql(
      token,
      `mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
      { serviceId, environmentId },
      log
    );
    log.push('✓ สั่ง deploy แล้ว — เว็บจะพร้อมใช้งานภายในไม่กี่นาที');

    return { ok: true, url: `https://${domain}`, projectId, serviceId, environmentId, log };
  } catch (err) {
    return { ok: false, log, error: err.message };
  }
}

module.exports = { isEnabled, hasSellerToken, provisionNewSite };
