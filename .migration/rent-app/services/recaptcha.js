// Google reCAPTCHA v2 (checkbox) verification for signup forms — one
// platform-wide key pair shared by every shop, same as EASYSLIP_API_KEY.
const axios = require('axios');

const SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';
const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

const isConfigured = () => Boolean(SITE_KEY && SECRET_KEY);
const siteKey = () => SITE_KEY;

async function verify(token, remoteip) {
  if (!isConfigured()) return true;
  if (!token) return false;
  try {
    const res = await axios.post(VERIFY_URL, null, {
      params: { secret: SECRET_KEY, response: token, remoteip },
      timeout: 10000,
    });
    return Boolean(res.data && res.data.success);
  } catch (err) {
    return false;
  }
}

module.exports = { isConfigured, siteKey, verify };
