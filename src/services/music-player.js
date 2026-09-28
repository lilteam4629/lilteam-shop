'use strict';

function parseTimeToSeconds(value) {
  const input = String(value ?? '').trim();
  if (!input) return 0;
  if (!/^\d+(?::\d+){0,2}$/.test(input)) return null;

  const parts = input.split(':').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) return null;
  if (parts.length > 1 && parts[parts.length - 1] > 59) return null;
  if (parts.length === 3 && parts[1] > 59) return null;

  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function extractYouTubeVideoId(input) {
  const value = String(input ?? '').trim();
  const validId = id => (/^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null);
  if (validId(value)) return value;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, '').replace(/^music\./, '');
    if (host === 'youtu.be') return validId(url.pathname.split('/').filter(Boolean)[0]);
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const queryId = url.searchParams.get('v');
      if (queryId) return validId(queryId);
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) return validId(parts[1]);
    }
  } catch (error) {
    return null;
  }
  return null;
}

module.exports = { parseTimeToSeconds, extractYouTubeVideoId };
