'use strict';

const test = require('node:test');
const assert = require('node:assert');
const handler = require('../api/collection.js');

const realFetch = global.fetch;
let calls;

function stub(responder) {
  calls = [];
  global.fetch = async url => {
    calls.push(String(url));
    return responder(new URL(url), calls.length);
  };
}
test.afterEach(() => { global.fetch = realFetch; });

async function run(query, method = 'GET') {
  const headers = {};
  const out = {};
  const res = {
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; }
  };
  await handler({ method, query }, res);
  return { ...out, headers };
}

const redirect = location => ({ status: 301, headers: { get: name => (name === 'location' ? location : null) } });
const page = (body, status = 200) => ({ status, headers: { get: () => null }, json: async () => body });
const item = (id, playUrl) => ({ id, desc: `clip ${id}`, music: { title: `Song ${id}`, authorName: 'A', playUrl } });
const COLLECTION = 'https://www.tiktok.com/@u/collection/Music-7707162500868999944';

const uncached = headers => {
  assert.strictEqual(headers['cache-control'], 'no-store');
  assert.strictEqual(headers['vercel-cdn-cache-control'], undefined);
  assert.strictEqual(headers['cdn-cache-control'], undefined);
};

test('rejects bad links with 400 and no fetch', async () => {
  const bad = [
    'http://vt.tiktok.com/x',
    'https://example.com/',
    'https://vt.tiktok.com.evil.com/',
    'https://user:pw@vt.tiktok.com/x',
    'https://vt.tiktok.com:8443/x',
    'https://vt.tiktok.com/' + 'a'.repeat(2100),
    'https://www.tiktok.com/@u/video/7707162500868999944',
    ''
  ];
  for (const url of bad) {
    stub(() => { throw new Error('unexpected fetch'); });
    const r = await run({ url });
    assert.strictEqual(r.status, 400, url.slice(0, 60));
    assert.strictEqual(calls.length, 0, url.slice(0, 60));
    uncached(r.headers);
  }
});

test('rejects a non-numeric id with 400 and no fetch', async () => {
  stub(() => { throw new Error('unexpected fetch'); });
  const r = await run({ id: 'abc123' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(calls.length, 0);
});

test('non-GET gets 405', async () => {
  stub(() => { throw new Error('unexpected fetch'); });
  const r = await run({ url: COLLECTION }, 'POST');
  assert.strictEqual(r.status, 405);
  assert.strictEqual(calls.length, 0);
  uncached(r.headers);
});

test('a www collection link resolves without a redirect fetch', async () => {
  stub(() => page({ itemList: [item('1', 'https://a/1.mp3')], hasMore: false }));
  const r = await run({ url: COLLECTION });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.id, '7707162500868999944');
  assert.strictEqual(r.body.name, 'Music');
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0], /\/api\/collection\/item_list\//);
});

test('a short link that redirects to a collection works', async () => {
  stub(url => (url.hostname === 'vt.tiktok.com' ? redirect(COLLECTION) : page({ itemList: [item('1', 'https://a/1.mp3')] })));
  const r = await run({ url: 'https://vt.tiktok.com/ZSabc/' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.name, 'Music');
  assert.strictEqual(calls.length, 2);
});

test('a redirect to a disallowed host is rejected', async () => {
  stub(() => redirect('https://evil.example.com/@u/collection/Music-7707162500868999944'));
  const r = await run({ url: 'https://vt.tiktok.com/ZSabc/' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(calls.length, 1);
});

test('more redirects than the limit are rejected', async () => {
  stub((url, n) => redirect(`https://vt.tiktok.com/hop${n}`));
  const r = await run({ url: 'https://vt.tiktok.com/start' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(calls.length, 5);
});

test('a non-zero TikTok statusCode gives 404', async () => {
  stub(() => page({ statusCode: 10222, itemList: [item('1', 'https://a/1.mp3')] }));
  const r = await run({ id: '7707162500868999944' });
  assert.strictEqual(r.status, 404);
  uncached(r.headers);
});

test('an empty first page gives 404', async () => {
  stub(() => page({ itemList: [], hasMore: false }));
  const r = await run({ id: '7707162500868999944' });
  assert.strictEqual(r.status, 404);
  uncached(r.headers);
});

test('a fetch that throws gives 502', async () => {
  stub(() => { throw new Error('network down'); });
  const r = await run({ id: '7707162500868999944' });
  assert.strictEqual(r.status, 502);
  uncached(r.headers);
});

test('tracks keep only https audio, video is empty, and skipped counts the rest', async () => {
  stub(() => page({
    itemList: [item('1', 'https://a/1.mp3'), item('2', 'http://a/2.mp3'), item('3', ''), item('4', 'https://a/4.mp3')],
    hasMore: false
  }));
  const r = await run({ id: '7707162500868999944' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.tracks.map(t => t.id), ['1', '4']);
  assert.ok(r.body.tracks.every(t => t.video === '' && t.audio.startsWith('https://')));
  assert.strictEqual(r.body.skipped, 2);
});

test('pagination follows hasMore and cursor', async () => {
  stub((url, n) => (n === 1
    ? page({ itemList: [item('1', 'https://a/1.mp3')], hasMore: true, cursor: '30' })
    : page({ itemList: [item('2', 'https://a/2.mp3')], hasMore: false })));
  const r = await run({ id: '7707162500868999944' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(new URL(calls[0]).searchParams.get('cursor'), '0');
  assert.strictEqual(new URL(calls[1]).searchParams.get('cursor'), '30');
  assert.deepStrictEqual(r.body.tracks.map(t => t.id), ['1', '2']);
});

test('?id= success is cached 60 seconds at the CDN and not in browsers', async () => {
  stub(() => page({ itemList: [item('1', 'https://a/1.mp3')], hasMore: false }));
  const r = await run({ id: '7707162500868999944' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  assert.strictEqual(r.headers['vercel-cdn-cache-control'], 'max-age=60');
});

test('?url= success stays uncached', async () => {
  stub(() => page({ itemList: [item('1', 'https://a/1.mp3')], hasMore: false }));
  const r = await run({ url: COLLECTION });
  assert.strictEqual(r.status, 200);
  uncached(r.headers);
});
