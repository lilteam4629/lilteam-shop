function shouldRunStartupTenantRollouts(env = process.env) {
  if (env.SKIP_STARTUP_TENANT_ROLLOUTS === '1') return false;
  return env.NODE_ENV === 'production' || env.ENABLE_STARTUP_TENANT_ROLLOUTS === '1';
}

module.exports = { shouldRunStartupTenantRollouts };
