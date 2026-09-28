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

function makeHarness(defaultVolume) {
  const elements = new Map();
  const scripts = [];
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
        videoId: 'abcdefghijk', defaultVolume: String(defaultVolume), startSeconds: '0', endSeconds: '0',
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
      contains() { return true; },
      focus() {},
      remove() { this.removed = true; },
    };
  }
  const document = {
    hidden: false,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    createElement() { return element('youtube-api-script'); },
    head: { appendChild(item) { scripts.push(item); } },
    addEventListener() {},
  };
  const window = {
    location: { search: '', pathname: '/', hash: '' },
    history: { replaceState() {} },
    addEventListener() {},
    requestIdleCallback() {},
  };
  Object.defineProperty(window, 'localStorage', {
    get() { throw new Error('storage blocked'); },
  });
  const context = {
    window,
    document,
    URLSearchParams,
    fetch: () => Promise.reject(new Error('metadata unavailable')),
    requestIdleCallback() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    console,
    Number,
    Math,
    Date,
    parseInt,
    parseFloat,
  };
  vm.runInNewContext(script, context, { filename: 'storefront-music-widget.ejs' });
  return { context, elements, scripts, window };
}

const harness = makeHarness('145');
assert.equal(harness.elements.get('music-volume').value, 100, 'volume is clamped to the slider range');
assert.equal(harness.elements.get('music-toggle-btn').hidden, false, 'music control initializes without storage');
harness.elements.get('music-minimize-btn').listeners.click();
assert.equal(harness.elements.get('music-expand-btn').hidden, false, 'minimize works when storage is blocked');
harness.elements.get('music-expand-btn').listeners.click();
assert.equal(harness.elements.get('music-toggle-btn').hidden, false, 'restore works when storage is blocked');

harness.elements.get('music-toggle-btn').listeners.click();
assert.equal(harness.scripts.length, 1, 'first tap requests YouTube');
harness.scripts[0].onerror();
assert.equal(harness.scripts[0].removed, true, 'failed script is removed');
assert.match(harness.elements.get('music-state-label').textContent, /แตะเพื่อลองใหม่/);
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
harness.elements.get('music-toggle-btn').listeners.click();
assert.equal(playerCalls.pauses, 1);
assert.equal(harness.elements.get('music-widget').classList.contains('is-playing'), false);

assert.equal((script.match(/localStorage\.(?:getItem|setItem)\(/g) || []).length, 2,
  'all persistence access must go through the guarded helpers');
const fallbackHarness = makeHarness('not-a-number');
assert.equal(fallbackHarness.elements.get('music-volume').value, 50, 'invalid volume falls back to a safe default');

console.log('Music widget checks passed: blocked storage, safe volume, retry, playback, and pause');
