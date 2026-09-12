function cleanupLegacyLabRain(db) {
  const settings = db?.settings;
  const rainModule = settings?.systemModules?.rain;
  if (rainModule?.version !== 'lab' || rainModule.releaseId) return false;
  delete settings.systemModules.rain;
  if (Object.keys(settings.systemModules).length === 0) delete settings.systemModules;
  delete settings.rain;
  return true;
}

module.exports = { cleanupLegacyLabRain };
