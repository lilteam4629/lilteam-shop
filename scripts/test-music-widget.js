'use strict';

// Exercise the live music widget with blocked storage and a mocked YouTube API.
// This is intentionally an in-memory browser fixture; it never plays real audio.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const layoutPath = path.join(__dirname, '..', 'src/views/layouts/main.ejs');
const layout = fs.readFileSync(layoutPath, 'utf8');
const script = [...layout.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1])
  .find(source => source.includes("const STORAGE_PLAYING = 'lilteam_music_playing'"));
assert.ok(script, 'storefront music script should exist');
const widgetMarkup = layout.slice(layout.indexOf('<div id="music-widget"'), layout.indexOf('<div id="music-yt-player"'));
const compactMusicCss = fs.readFileSync(path.join(__dirname, '..', 'public/css/storefront-music-unified-v1.css'), 'utf8');
assert.equal((layout.match(/id="music-widget"/g) || []).length, 1, 'one shared player must be rendered by the public layout');
assert.match(layout, /<link rel="stylesheet" href="<%= asset\('css\/storefront-music-unified-v1\.css'\) %>&amp;rev=2" \/>/,
  'the unified music skin must load across every storefront');
assert.doesNotMatch(widgetMarkup, /storefrontOwnerHomeV7|music-minimize-btn|music-expand-btn/,
  'music markup must not switch structure on the homepage');
assert.match(widgetMarkup, /music-widget__artwork[\s\S]*music-collapsed-title[\s\S]*music-collapsed-state[\s\S]*music-widget__expand/,
  'every shop must use the shared player controls');
assert.match(compactMusicCss, /#music-widget\s*\{[^}]*width:\s*104px;[^}]*height:\s*54px;/s,
  'the minimized owner music dock should stay compact instead of showing a wide title bar');
assert.match(compactMusicCss, /#music-widget \.music-widget__copy\s*\{\s*display:\s*none;/,
  'the compact dock should keep track copy inside the expanded player panel');
assert.match(compactMusicCss, /#music-widget \.music-widget__expand\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
  'the compact dock should retain an accessible, separate control to open the player panel');
assert.match(compactMusicCss, /#music-widget \.music-widget__expand::before\s*\{[^}]*width:\s*27px;[^}]*height:\s*27px;/s,
  'the player-panel control should look small while keeping an accessible tap target');
assert.match(widgetMarkup, /class="music-panel__media[\s\S]*?id="music-title"[\s\S]*?id="music-state-label"[\s\S]*?id="music-play-btn"[\s\S]*?id="music-volume"/,
  'the expanded panel should keep its artwork, live state, playback, and volume controls');
assert.match(widgetMarkup, /id="music-collapse-btn"[^>]*aria-label="ปิดแผงควบคุมเพลง"[\s\S]*?<svg[\s\S]*?id="music-state-label"/,
  'the redesigned close control should stay accessible and drawn with the shop icon style');
assert.match(compactMusicCss, /#music-widget #music-panel\s*\{[^}]*width:\s*min\(320px, calc\(100vw - 24px\)\)[^}]*border:\s*0/s,
  'the expanded panel should use the redesigned responsive width and clean surface');
assert.match(compactMusicCss, /#music-widget \.music-panel__state\s*\{[^}]*font-size:\s*10px;/s,
  'the expanded player should show a readable playback status');
assert.doesNotMatch(widgetMarkup, /typeof isMainSite|class="relative z-10">🎵/,
  'rental storefronts must not fall back to the old player markup');

function makeHarness(defaultVolume, options = {}) {
  const elements = new Map();
  const scripts = [];
  const intervals = new Map();
  let nextIntervalId = 0;
  const storage = new Map(Object.entries(options.storage || {}));
  function element(id) {
    const classes = new Set(id === 'music-panel' ? ['hidden'] : []);
    const classList = {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        next ? classes.add(name) : classes.delete(name);
        return next;
      },
    };
    return {
      id,
      dataset: id === 'music-widget' ? {
        videoId: options.videoId || 'abcdefghijk', defaultVolume: String(defaultVolume),
        startSeconds: String(options.startSeconds ?? 0), endSeconds: String(options.endSeconds ?? 0),
      } : {},
      listeners: {},
      attributes: {},
      classList,
      hidden: false,
      value: '',
      textContent: '',
      title: '',
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      querySelector(selector) {
        return selector === 'svg' && id === 'music-icon'
          ? { classList: { toggle() {} } }
          : null;
      },
      contains(target) { return Boolean(target && target.insideWidget); },
      focus() {},
      remove() { this.removed = true; },
    };
  }
  const document = {
    hidden: false,
    listeners: {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    createElement() { return element('youtube-api-script'); },
    head: { appendChild(item) { scripts.push(item); } },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    querySelector() { return null; },
  };
  const window = {
    location: { search: '', pathname: '/', hash: '' },
    history: { replaceState() {} },
    addEventListener() {},
    requestIdleCallback() {},
    YT: options.preloadedYT || undefined,
  };
  Object.defineProperty(window, 'localStorage', {
    get() {
      if (options.blockStorage !== false) throw new Error('storage blocked');
      return {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); },
      };
    },
  });
  const context = {
    window,
    document,
    URLSearchParams,
    fetch: () => Promise.reject(new Error('metadata unavailable')),
    requestIdleCallback() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval(callback) { const id = ++nextIntervalId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    console,
    Number,
    Math,
    Date,
    parseInt,
    parseFloat,
  };
  vm.runInNewContext(script, context, { filename: 'storefront-music-widget.ejs' });
  return { context, elements, scripts, window, storage, intervals };
}

const harness = makeHarness('145');
assert.equal(harness.elements.get('music-volume').value, 100, 'volume is clamped to the slider range');
assert.equal(harness.elements.get('music-toggle-btn').hidden, false, 'music control initializes without storage');
harness.elements.get('music-settings-btn').listeners.click();
assert.equal(harness.elements.get('music-panel').classList.contains('hidden'), false, 'settings opens without storage');
assert.equal(harness.elements.get('music-settings-btn').attributes['aria-expanded'], 'true');
assert.equal(harness.elements.get('music-settings-btn').attributes['aria-label'], 'ปิดแผงควบคุมเพลง');
harness.elements.get('music-collapse-btn').listeners.click();
assert.equal(harness.elements.get('music-panel').classList.contains('hidden'), true, 'close hides the settings panel');
assert.equal(harness.elements.get('music-settings-btn').attributes['aria-expanded'], 'false');
harness.elements.get('music-settings-btn').listeners.click();
assert.equal(harness.elements.get('music-panel').classList.contains('hidden'), false);
harness.context.document.listeners.click({ target: {} });
assert.equal(harness.elements.get('music-panel').classList.contains('hidden'), true, 'outside click closes the panel');
assert.equal(harness.elements.get('music-settings-btn').attributes['aria-expanded'], 'false');

harness.elements.get('music-toggle-btn').listeners.click();
assert.equal(harness.scripts.length, 1, 'first tap requests YouTube');
assert.equal(harness.elements.get('music-collapsed-state').textContent, 'กำลังโหลดเพลง…', 'loading state is visible');
harness.elements.get('music-toggle-btn').listeners.click();
assert.equal(harness.elements.get('music-toggle-btn').attributes['aria-label'], 'เล่นเพลง', 'a second tap cancels pending playback');
assert.equal(harness.scripts.length, 1, 'cancelling does not inject duplicate API scripts');
harness.scripts[0].onerror();
assert.equal(harness.scripts[0].removed, true, 'failed script is removed');
assert.match(harness.elements.get('music-collapsed-state').textContent, /แตะเพื่อลองใหม่/);
harness.elements.get('music-toggle-btn').listeners.click();
assert.equal(harness.scripts.length, 2, 'next tap retries YouTube');

const playerCalls = { volume: null, unmuted: 0, plays: 0, pauses: 0 };
let playerConfig;
harness.context.YT = {
  PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
  Player: function (_id, options) {
    playerConfig = options;
    const player = {
      setVolume(value) { playerCalls.volume = value; },
      unMute() { playerCalls.unmuted++; },
      playVideo() { playerCalls.plays++; },
      pauseVideo() { playerCalls.pauses++; },
      getCurrentTime() { return 0; },
      seekTo() {},
    };
    options.events.onReady({ target: player });
    return player;
  },
};
harness.window.YT = harness.context.YT;
harness.window.onYouTubeIframeAPIReady();
playerConfig.events.onStateChange({ data: harness.context.YT.PlayerState.PLAYING });
assert.equal(playerCalls.volume, 100);
assert.equal(playerCalls.unmuted, 1);
assert.equal(playerCalls.plays, 1);
assert.equal(harness.elements.get('music-widget').classList.contains('is-playing'), true);
assert.equal(harness.elements.get('music-state-label').textContent, 'กำลังเล่น', 'the expanded panel reports active playback');
harness.elements.get('music-toggle-btn').listeners.click();
assert.equal(playerCalls.pauses, 1);
assert.equal(harness.elements.get('music-widget').classList.contains('is-playing'), false);
assert.equal(harness.elements.get('music-state-label').textContent, 'แตะเพื่อเล่น', 'the expanded panel reports the paused state');
// A browser policy block must be visible and leave the next direct tap able to retry.
harness.elements.get('music-toggle-btn').listeners.click();
playerConfig.events.onAutoplayBlocked({ target: {} });
assert.match(harness.elements.get('music-collapsed-state').textContent, /เบราว์เซอร์บล็อกเพลง/);
harness.elements.get('music-toggle-btn').listeners.click();
assert.equal(playerCalls.plays, 3, 'a tap retries after the browser blocks autoplay');
playerConfig.events.onError({ data: 100 });
assert.match(harness.elements.get('music-collapsed-state').textContent, /ตรวจลิงก์ YouTube/);

const loadingHarness = makeHarness('40');
loadingHarness.elements.get('music-volume').value = '73';
loadingHarness.elements.get('music-volume').listeners.input();
loadingHarness.context.YT = {
  PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
  Player: function (_id, options) {
    options.events.onReady({ target: {
      setVolume(value) { playerCalls.volume = value; },
      unMute() {},
      playVideo() {},
    } });
  },
};
loadingHarness.window.YT = loadingHarness.context.YT;
loadingHarness.window.onYouTubeIframeAPIReady();
assert.equal(playerCalls.volume, 73, 'volume changes made during player loading are applied on ready');

assert.equal((script.match(/localStorage\.(?:getItem|setItem)\(/g) || []).length, 2,
  'all persistence access must go through the guarded helpers');
const fallbackHarness = makeHarness('not-a-number');
assert.equal(fallbackHarness.elements.get('music-volume').value, 50, 'invalid volume falls back to a safe default');

function mockYouTubeApi() {
  let config;
  const api = {
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
    Player: function (_id, options) {
      config = options;
      options.events.onReady({ target: {
        setVolume() {}, unMute() {}, playVideo() {}, pauseVideo() {},
      } });
    },
  };
  return { api, getConfig: () => config };
}

const trackStorage = {
  lilteam_music_time_abcdefghijk: '84',
  lilteam_music_time_lmnopqrstuv: '19',
  lilteam_music_time: '999', // Legacy global playhead must not leak into either song.
};
const firstTrackHarness = makeHarness(50, { blockStorage: false, storage: trackStorage });
const firstTrackApi = mockYouTubeApi();
firstTrackHarness.window.YT = firstTrackApi.api;
firstTrackHarness.context.YT = firstTrackApi.api;
firstTrackHarness.window.onYouTubeIframeAPIReady();
assert.equal(firstTrackApi.getConfig().playerVars.start, 84, 'the saved playhead is restored for its own video');
const secondTrackHarness = makeHarness(50, { blockStorage: false, storage: trackStorage, videoId: 'lmnopqrstuv' });
const secondTrackApi = mockYouTubeApi();
secondTrackHarness.window.YT = secondTrackApi.api;
secondTrackHarness.context.YT = secondTrackApi.api;
secondTrackHarness.window.onYouTubeIframeAPIReady();
assert.equal(secondTrackApi.getConfig().playerVars.start, 19, 'a different configured video uses only its own playhead');

const preloadedApi = mockYouTubeApi();
const preloadedHarness = makeHarness(50, { preloadedYT: preloadedApi.api });
assert.ok(preloadedApi.getConfig(), 'an already-ready YouTube API initializes the player without waiting for its callback');
assert.equal(preloadedHarness.scripts.length, 0, 'an already-ready API does not load a duplicate script');

const segmentHarness = makeHarness(50, { blockStorage: false, startSeconds: 5, endSeconds: 10 });
const segmentCalls = { plays: 0, pauses: 0, seeks: [] };
let segmentPlayerConfig;
const segmentApi = {
  PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 },
  Player: function (_id, options) {
    segmentPlayerConfig = options;
    let time = 12;
    const player = {
      setVolume() {}, unMute() {}, playVideo() { segmentCalls.plays++; },
      pauseVideo() { segmentCalls.pauses++; }, getCurrentTime() { return time; },
      seekTo(value) { segmentCalls.seeks.push(value); time = value; },
    };
    options.events.onReady({ target: player });
    return player;
  },
};
segmentHarness.context.YT = segmentApi;
segmentHarness.window.YT = segmentApi;
segmentHarness.window.onYouTubeIframeAPIReady();
segmentPlayerConfig.events.onStateChange({ data: segmentApi.PlayerState.PLAYING });
assert.equal(segmentHarness.intervals.size, 1, 'segment watcher starts when playback begins');
for (const callback of segmentHarness.intervals.values()) callback();
assert.deepEqual(segmentCalls.seeks, [5], 'playback seeks back when it passes the segment end');
assert.equal(segmentHarness.storage.get('lilteam_music_time_abcdefghijk'), '5', 'the saved playhead matches the loop point');
segmentPlayerConfig.events.onStateChange({ data: segmentApi.PlayerState.ENDED });
assert.equal(segmentCalls.seeks.at(-1), 5, 'the configured segment restarts when the video ends');
assert.equal(segmentHarness.storage.get('lilteam_music_time_abcdefghijk'), '5', 'video end stores the configured segment start');
segmentPlayerConfig.events.onStateChange({ data: segmentApi.PlayerState.BUFFERING });
assert.equal(segmentHarness.elements.get('music-collapsed-state').textContent, 'กำลังโหลดเพลง…', 'buffering is not shown as active playback');
segmentHarness.elements.get('music-toggle-btn').listeners.click();
assert.equal(segmentCalls.pauses, 1, 'pending or buffering playback can be cancelled');

console.log('Music widget checks passed: shared page markup, cancellation, API retry/readiness, autoplay errors, track-specific resume, storage, volume, playback, and pause');
