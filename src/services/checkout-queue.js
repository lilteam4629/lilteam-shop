let checkoutQueue = Promise.resolve();

function runWithCheckoutQueue(work) {
  const result = checkoutQueue.then(work, work);
  checkoutQueue = result.catch(() => {});
  return result;
}

module.exports = { runWithCheckoutQueue };
