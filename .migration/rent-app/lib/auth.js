function safeNext(value, fallback = '/my-shops') {
  if (typeof value !== 'string' || !/^\/(?:start|my-shops|wallet|sales)(?:[/?]|$)/.test(value) || /[\\\r\n]/.test(value)) return fallback;
  return value;
}
async function establishLogin(req, user, isAdmin) {
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.user = user;
  req.session.isAdmin = isAdmin;
  await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}
module.exports = { safeNext, establishLogin };
