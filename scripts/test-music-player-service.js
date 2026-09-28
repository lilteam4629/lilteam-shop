'use strict';

const assert = require('node:assert/strict');
const { parseTimeToSeconds, extractYouTubeVideoId } = require('../src/services/music-player');

assert.equal(parseTimeToSeconds(''), 0);
assert.equal(parseTimeToSeconds('95'), 95);
assert.equal(parseTimeToSeconds('1:35'), 95);
assert.equal(parseTimeToSeconds('1:02:03'), 3723);
assert.equal(parseTimeToSeconds('60:00'), 3600, 'long tracks can be entered as total minutes');
for (const invalid of ['-1', '1:60', '1:2:60', '1:2:3:4', '1:abc', '9007199254740992']) {
  assert.equal(parseTimeToSeconds(invalid), null, `${invalid} must be rejected`);
}

assert.equal(extractYouTubeVideoId('abcdefghijk'), 'abcdefghijk');
assert.equal(extractYouTubeVideoId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=abcdefghijk&t=30'), 'abcdefghijk');
assert.equal(extractYouTubeVideoId('https://music.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
assert.equal(extractYouTubeVideoId('https://youtube.com.evil.test/watch?v=abcdefghijk'), null);
assert.equal(extractYouTubeVideoId('ftp://youtube.com/watch?v=abcdefghijk'), null);
assert.equal(extractYouTubeVideoId('https://youtube.com/playlist?list=abcdefghijk'), null);

console.log('Music settings checks passed: strict time parsing and supported YouTube URL validation');
