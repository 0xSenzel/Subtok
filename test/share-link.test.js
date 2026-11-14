'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildShareUrl, parseShareParams, MAX_CLIPS } = require('../web/share-link.js');

const parse = query => parseShareParams(new URLSearchParams(query));
const ID = '7707162500868999944';

test('a collection link round-trips', () => {
  const url = buildShareUrl('https://subtok.test', { id: ID, name: 'Music' });
  assert.deepStrictEqual(parseShareParams(new URL(url).searchParams), { id: ID, name: 'Music', folder: null });
});

test('a folder link round-trips and keeps the clip order', () => {
  const folder = { name: 'Drive · night', clips: ['7300000000000000002', '7300000000000000001'] };
  const url = buildShareUrl('https://subtok.test', { id: ID, name: 'Music & more', folder });
  assert.match(url, /clips=7300000000000000002\.7300000000000000001/);
  assert.deepStrictEqual(parseShareParams(new URL(url).searchParams), { id: ID, name: 'Music & more', folder });
});

test('no c means no share link', () => {
  assert.strictEqual(parse(''), null);
  assert.strictEqual(parse('link=https://vt.tiktok.com/x/'), null);
});

test('a bad collection ID or a missing name is an error', () => {
  for (const c of ['abc', '1234', '1'.repeat(26), '', '12345.6']) assert.deepStrictEqual(parse(`c=${c}&n=Music`), { error: true }, c);
  assert.deepStrictEqual(parse(`c=${ID}`), { error: true });
  assert.deepStrictEqual(parse(`c=${ID}&n=%20%20`), { error: true });
});

test('names are tidied and trimmed', () => {
  assert.strictEqual(parse(`c=${ID}&n=${'a'.repeat(300)}`).name.length, 100);
  assert.strictEqual(parse(`c=${ID}&n=%20My%20%20mix%20`).name, 'My mix');
  assert.strictEqual(parse(`c=${ID}&n=M&f=${'b'.repeat(40)}&clips=1`).folder.name.length, 30);
});

test('clips keep only valid unique IDs, up to the limit', () => {
  assert.deepStrictEqual(parse(`c=${ID}&n=M&f=Gym&clips=1.x.2..3.2.-4.${'9'.repeat(26)}`).folder.clips, ['1', '2', '3']);
  const many = Array.from({ length: 200 }, (_, n) => String(1000 + n)).join('.');
  assert.strictEqual(parse(`c=${ID}&n=M&f=Gym&clips=${many}`).folder.clips.length, MAX_CLIPS);
});

test('a folder needs both a name and clips', () => {
  assert.strictEqual(parse(`c=${ID}&n=M&f=Gym`).folder, null);
  assert.strictEqual(parse(`c=${ID}&n=M&clips=1.2`).folder, null);
  assert.strictEqual(parse(`c=${ID}&n=M&f=Gym&clips=x.y`).folder, null);
});

test('markup in names stays plain text', () => {
  const markup = '<img src=x onerror=alert(1)>';
  const result = parse(new URLSearchParams({ c: ID, n: markup, f: markup.slice(0, 30), clips: '1' }).toString());
  assert.strictEqual(result.name, markup);
  assert.strictEqual(result.folder.name, markup.slice(0, 30));
});
