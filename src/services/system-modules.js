function ensureLabRainModule(db) {
  const settings = db.settings ||= {};
  const modules = settings.systemModules ||= {};
  if (modules.rain) return false;
  settings.rain ||= { color: '#78c8ff', intensity: 'medium' };
  settings.rain.enabled = true;
  modules.rain = {
    name: 'ระบบฝนตกหน้าเว็บ', version: 'lab', enabled: true,
    deployedAt: new Date().toISOString(),
  };
  return true;
}

module.exports = { ensureLabRainModule };
