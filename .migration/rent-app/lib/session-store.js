const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
class CloudSessionStore extends session.Store {
  constructor(directory) { super(); this.directory = directory; fs.mkdirSync(directory, { recursive: true }); }
  filename(id) { return path.join(this.directory, crypto.createHash('sha256').update(id).digest('hex') + '.json'); }
  get(id, cb) {
    fs.readFile(this.filename(id), 'utf8', (err, value) => {
      if (err) return cb(err.code === 'ENOENT' ? null : err, null);
      try {
        const data = JSON.parse(value);
        if (data.cookie?.expires && new Date(data.cookie.expires) <= new Date()) return this.destroy(id, error => cb(error, null));
        cb(null, data);
      } catch (error) { cb(error); }
    });
  }
  set(id, value, cb = () => {}) {
    const target = this.filename(id);
    const temporary = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }, error => {
      if (error) return cb(error);
      fs.rename(temporary, target, cb);
    });
  }
  destroy(id, cb = () => {}) { fs.unlink(this.filename(id), error => cb(error?.code === 'ENOENT' ? null : error)); }
}
module.exports = CloudSessionStore;
