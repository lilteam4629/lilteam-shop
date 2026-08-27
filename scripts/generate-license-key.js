#!/usr/bin/env node
// Generates a signed license key for a rented deployment.
// Usage: LICENSE_SECRET=xxxxx node scripts/generate-license-key.js "ชื่อผู้เช่า" 30
//
// The same LICENSE_SECRET must be set as an environment variable on the
// rented deployment that will verify this key (Railway → Variables).

const { generateKey, isEnabled } = require('../src/services/license');

const [label, daysArg] = process.argv.slice(2);
const days = Number(daysArg);

if (!isEnabled()) {
  console.error('Error: LICENSE_SECRET is not set. Run with:\n  LICENSE_SECRET=your-secret node scripts/generate-license-key.js "label" 30');
  process.exit(1);
}
if (!label || !days || days <= 0) {
  console.error('Usage: node scripts/generate-license-key.js "<label>" <days>');
  process.exit(1);
}

const key = generateKey(label, days);
const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleString('th-TH');

console.log('License key:', key);
console.log('Label:', label);
console.log('Expires:', expiresAt);
