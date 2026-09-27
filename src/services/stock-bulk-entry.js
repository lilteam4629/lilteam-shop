function parseBulkStockEntries(input) {
  return String(input ?? '')
    .split(/\r\n?|\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      if (!line.includes(':')) return { username: line, password: '', extra: '' };

      const [username, password = '', ...rest] = line.split(':').map(value => value.trim());
      return { username, password, extra: rest.join(':') };
    })
    .filter(entry => entry.username);
}

module.exports = { parseBulkStockEntries };
