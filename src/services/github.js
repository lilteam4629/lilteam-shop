// Pushes your latest code out to every rented customer site in one click,
// by merging your dev branch into the release branch customer sites track
// (see src/services/railway.js for why they're separate branches).
//
// Requires a GitHub Personal Access Token with `repo` scope in GITHUB_TOKEN
// (Settings -> Developer settings -> Personal access tokens on github.com).
// Re-uses RAILWAY_TEMPLATE_REPO ("owner/repo") as the target repo.

const axios = require('axios');

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.RAILWAY_TEMPLATE_REPO;
const DEV_BRANCH = process.env.GITHUB_DEV_BRANCH || 'main';
const RELEASE_BRANCH = process.env.RAILWAY_RELEASE_BRANCH || 'release';

const isEnabled = () => Boolean(TOKEN && REPO);

/**
 * Merge DEV_BRANCH into RELEASE_BRANCH so every customer site tracking the
 * release branch auto-redeploys with the latest code.
 * @returns {Promise<{ ok: boolean, note?: string, error?: string }>}
 */
async function releaseUpdate() {
  if (!isEnabled()) {
    return { ok: false, error: 'ยังไม่ได้ตั้งค่า GITHUB_TOKEN ในร้าน' };
  }
  try {
    const res = await axios.post(
      `https://api.github.com/repos/${REPO}/merges`,
      { base: RELEASE_BRANCH, head: DEV_BRANCH, commit_message: 'Release update to rented sites' },
      { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' }, timeout: 20000 }
    );
    if (res.status === 204) return { ok: true, note: 'เว็บลูกค้าเป็นเวอร์ชันล่าสุดอยู่แล้ว ไม่มีอะไรใหม่ให้ปล่อย' };
    return { ok: true };
  } catch (err) {
    if (err.response && err.response.status === 204) {
      return { ok: true, note: 'เว็บลูกค้าเป็นเวอร์ชันล่าสุดอยู่แล้ว ไม่มีอะไรใหม่ให้ปล่อย' };
    }
    if (err.response && err.response.status === 409) {
      return { ok: false, error: `branch "${RELEASE_BRANCH}" กับ "${DEV_BRANCH}" ชนกัน (merge conflict) ต้องแก้ด้วยมือ` };
    }
    const message = err.response ? (err.response.data && err.response.data.message) || `HTTP ${err.response.status}` : err.message;
    return { ok: false, error: message };
  }
}

module.exports = { isEnabled, releaseUpdate };
