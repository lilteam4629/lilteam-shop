'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
function writeJson(file, value) {
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    if (fs.existsSync(file)) {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      const backupTemp = `${temporary}.bak`;
      try { fs.copyFileSync(file, backupTemp); fs.chmodSync(backupTemp, 0o600); fs.renameSync(backupTemp, file + '.bak'); }
      finally { try { fs.unlinkSync(backupTemp); } catch {} }
    }
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch {}
  }
}
function readJson(file, defaults) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return defaults();
    throw new Error('Cannot read saved data; restore a verified backup before restarting', { cause: error });
  }
}
module.exports = { writeJson, readJson };
