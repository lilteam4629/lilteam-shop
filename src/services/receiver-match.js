const normalizeName = value => String(value || '').toLocaleLowerCase('th-TH')
  .replace(/(นาย|นางสาว|นาง|คุณ)/g, '').replace(/[^a-z0-9ก-๙]/g, '');
const digits = value => String(value || '').replace(/\D/g, '');

function textValues(...values) {
  return values.flat(Infinity).map(value => {
    if (value && typeof value === 'object') return value.th || value.en || value.full || value.display || '';
    return value;
  }).filter(value => typeof value === 'string' || typeof value === 'number');
}

function receiverMatches({ actualNames = [], actualNumbers = [], expectedNames = [], expectedNumbers = [] } = {}) {
  const names = textValues(actualNames).map(normalizeName).filter(Boolean);
  const wantedNames = textValues(expectedNames).map(normalizeName).filter(Boolean);
  const numbers = textValues(actualNumbers).map(digits).filter(value => value.length >= 6);
  const wantedNumbers = textValues(expectedNumbers).map(digits).filter(value => value.length >= 6);
  const nameMatched = names.some(actual => wantedNames.some(expected => actual === expected || actual.includes(expected) || expected.includes(actual)));
  const numberMatched = numbers.some(actual => wantedNumbers.some(expected => {
    const size = Math.min(actual.length, expected.length);
    return size >= 6 && actual.slice(-size) === expected.slice(-size);
  }));
  return { matched: nameMatched || numberMatched, hasEvidence: Boolean(names.length || numbers.length), nameMatched, numberMatched };
}

module.exports = { normalizeName, textValues, receiverMatches };
