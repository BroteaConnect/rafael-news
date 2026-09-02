// The YouTube link parser is the only thing standing between what a journalist
// pastes into a form and a string that ends up inside an iframe `src`. So most
// of this file is rejections, not happy paths: the property that matters is
// that everything it returns matches VIDEO_ID, and that everything else is
// null rather than a throw.
//
// Lives in src/locales/ because that is the only directory `npm test` runs
// (`node --test src/locales/*.test.mjs`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../lib/load-ts.mjs';

const { VIDEO_ID, parseYouTubeId, embedUrl, watchUrl } =
  await loadTs(new URL('../lib/youtube.ts', import.meta.url));

const ID = 'dQw4w9WgXcQ';

/** Every accepted input must yield an id of the exact shape: that is what
 *  makes the value safe to interpolate into an attribute later. */
const accepts = (input, expected = ID) => {
  const got = parseYouTubeId(input);
  assert.equal(got, expected, `${input} → ${got}`);
  assert.ok(VIDEO_ID.test(got), `${input} produced something that is not an id`);
};
const rejects = (input) => assert.equal(parseYouTubeId(input), null, `${input} should be rejected`);

// -- The shapes the desk will actually paste ---------------------------------
test('the four common link shapes', () => {
  accepts(`https://www.youtube.com/watch?v=${ID}`);
  accepts(`https://youtu.be/${ID}`);
  accepts(`https://www.youtube.com/embed/${ID}`);
  accepts(`https://www.youtube.com/shorts/${ID}`);
});

test('live, /v/ and a bare id', () => {
  accepts(`https://www.youtube.com/live/${ID}`);
  accepts(`https://www.youtube.com/v/${ID}`);
  accepts(ID);
});

test('mobile, music, the no-cookie domain and a shouty host', () => {
  accepts(`https://m.youtube.com/watch?v=${ID}`);
  accepts(`https://music.youtube.com/watch?v=${ID}`);
  accepts(`https://www.youtube-nocookie.com/embed/${ID}`);
  accepts(`https://WWW.YouTube.COM/watch?v=${ID}`);
  accepts(`http://youtube.com/watch?v=${ID}`);
});

test('the extra parameters are read and dropped', () => {
  accepts(`https://youtu.be/${ID}?si=8Kj3nX0pQ2`);
  accepts(`https://www.youtube.com/watch?v=${ID}&t=90&list=PLabcdefghij`);
  accepts(`https://www.youtube.com/watch?app=desktop&v=${ID}`);
});

test('surrounding whitespace is the copy-paste norm, not an error', () => {
  accepts(`  https://youtu.be/${ID}\n`);
  accepts(`\t${ID} `);
});

// -- What must never get through ----------------------------------------------
test('a host that merely CONTAINS youtube.com is not youtube.com', () => {
  rejects(`https://youtube.com.evil.tld/watch?v=${ID}`);
  rejects(`https://notyoutube.com/watch?v=${ID}`);
  rejects(`https://youtube.com.evil.tld/embed/${ID}`);
  rejects(`https://evil.tld/?x=https://youtube.com/watch?v=${ID}`);
});

test('other sites and other schemes', () => {
  rejects('https://vimeo.com/123456789');
  rejects('javascript:alert(1)');
  rejects(`javascript:https://youtube.com/watch?v=${ID}`);
  rejects(`data:text/html,<iframe src=https://youtube.com/embed/${ID}>`);
});

test('anything that is not a URL at all', () => {
  rejects('not a url at all');
  rejects('');
  rejects('   ');
  rejects(null);
  rejects(undefined);
});

test('an id of the wrong length or the wrong alphabet', () => {
  rejects('dQw4w9WgXc');          // 10
  rejects('dQw4w9WgXcQ1');        // 12
  rejects('dQw4w9WgX+Q');
  rejects('dQw4w9WgX/Q');
  rejects(`https://youtu.be/${'dQw4w9WgXc'}`);
  rejects('https://www.youtube.com/watch?v=short');
  rejects('https://www.youtube.com/watch');
  rejects('https://www.youtube.com/');
  rejects('https://www.youtube.com/feed/subscriptions');
});

// -- The URLs built back from an id -------------------------------------------
test('playback goes to the no-cookie domain, verification to the normal one', () => {
  assert.equal(embedUrl(ID), `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0`);
  assert.equal(watchUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
  // No cookie is written before the reader presses play, which is the whole
  // point of the facade: the poster panel must never reach youtube.com.
  assert.ok(!embedUrl(ID).includes('//www.youtube.com/'));
});
