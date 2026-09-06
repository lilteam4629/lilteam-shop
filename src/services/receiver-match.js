const normalizeName = value => String(value || '').toLocaleLowerCase('th-TH')
  .replace(/(นาย|นางสาว|นาง|คุณ)/g, '').replace(/[^a-z0-9ก-๙]/g, '');
const digits = value => String(value || '').replace(/\D/g, '');
const nameTokens = value => String(value || '').toLocaleLowerCase('th-TH')
  .replace(/(นาย|นางสาว|นาง|คุณ)/g, ' ').replace(/[^a-z0-9ก-๙]+/g, ' ').trim().split(/\s+/).filter(Boolean);

function textValues(...values) {
  return values.flat(Infinity).map(value => {
    if (value && typeof value === 'object') return value.th || value.en || value.full || value.display || '';
    return value;
  }).filter(value => typeof value === 'string' || typeof value === 'number');
}

function receiverMatches({ actualNames = [], actualNumbers = [], expectedNames = [], expectedNumbers = [] } = {}) {
  const actualNameValues = textValues(actualNames);
  const expectedNameValues = textValues(expectedNames);
  const names = actualNameValues.map(normalizeName).filter(Boolean);
  const wantedNames = expectedNameValues.map(normalizeName).filter(Boolean);
  const allNumbers = textValues(actualNumbers).map(digits).filter(value => value.length >= 4);
  const allWantedNumbers = textValues(expectedNumbers).map(digits).filter(value => value.length >= 4);
  const numbers = allNumbers.filter(value => value.length >= 6);
  const wantedNumbers = allWantedNumbers.filter(value => value.length >= 6);
  const nameMatched = names.some(actual => wantedNames.some(expected => actual === expected || actual.includes(expected) || expected.includes(actual)));
  const numberMatched = numbers.some(actual => wantedNumbers.some(expected => {
    const size = Math.min(actual.length, expected.length);
    return size >= 6 && actual.slice(-size) === expected.slice(-size);
  }));
  const partialNameMatched = actualNameValues.some(actual => expectedNameValues.some(expected => {
    const left = nameTokens(actual), right = nameTokens(expected);
    if (!left[0] || !right[0] || left[0].length < 3 || left[0] !== right[0]) return false;
    if (!left[1] || !right[1]) return true;
    return left[1] === right[1] || left[1][0] === right[1][0];
  }));
  const lastFourMatched = allNumbers.some(actual => allWantedNumbers.some(expected => actual.slice(-4) === expected.slice(-4)));
  const combinedMaskedMatch = partialNameMatched && lastFourMatched;
  return { matched: nameMatched || numberMatched || combinedMaskedMatch, hasEvidence: Boolean(names.length || allNumbers.length), nameMatched, numberMatched, combinedMaskedMatch };
}

function extractReceiverEvidence(payload) {
  const names = [], numbers = [], seen = new Set();
  function walk(value, inReceiver = false, depth = 0) {
    if (!value || depth > 7 || seen.has(value)) return;
    if (typeof value !== 'object') return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
      const receiverBranch = inReceiver || /(receiver|recipient|receiving|payee|destination|toaccount)/.test(normalizedKey);
      if (receiverBranch && /(name|display|holder|owner)/.test(normalizedKey)) names.push(child);
      if (receiverBranch && /(account|number|proxy|phone|mobile|wallet|id)/.test(normalizedKey)) numbers.push(child);
      if (child && typeof child === 'object') walk(child, receiverBranch, depth + 1);
    }
  }
  walk(payload);
  return { names: textValues(names), numbers: textValues(numbers) };
}

module.exports = { normalizeName, textValues, receiverMatches, extractReceiverEvidence };
