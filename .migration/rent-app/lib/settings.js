const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function load() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

let cache = load();

function get() {
  return cache;
}

function update(patch) {
  cache = { ...cache, ...patch };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cache, null, 2));
  return cache;
}

module.exports = { get, update, UPLOADS_DIR, DATA_DIR };
