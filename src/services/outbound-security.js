'use strict';
const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');
const ipaddr = require('ipaddr.js');
function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
function safeUrl(value) {
  try {
    const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '');
    return url.protocol === 'https:' && (!url.port || url.port === '443') && !url.username && !url.password &&
      !/^(?:localhost)$|\.(?:local|localhost|internal)$/i.test(host) && (!net.isIP(host) || publicAddress(host));
  } catch { return false; }
}
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {
      const denied = new Error('Private network destination is not allowed'); denied.code = 'ERR_PRIVATE_ADDRESS'; return callback(denied);
    }
    const selected = options?.family ? addresses.filter(item => item.family === options.family) : addresses;
    if (!selected.length) return callback(new Error('No permitted address family'));
    if (options?.all) return callback(null, selected);
    callback(null, selected[0].address, selected[0].family);
  });
}
const httpsAgent = new https.Agent({ lookup: safeLookup });
module.exports = { publicAddress, safeUrl, safeLookup, httpsAgent };
