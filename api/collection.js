'use strict';

// Vercel function. Reads a public TikTok collection with no TikTok session and returns the player's track list.
//   GET /api/collection?url=<share link>   resolves the link, then lists the collection.
//   GET /api/collection?id=<digits>        lists the collection. The player uses this to refresh.
// TikTok sends no CORS headers, so the browser cannot call it directly.
//
// This is a public endpoint that fetches remote URLs, so it is strict:
// - It fetches only the TikTok hosts below, never follows a redirect on its own, and never forwards client headers or cookies.
// - Every TikTok request has a timeout.
// - It returns only the fields the player needs, never TikTok's response body or user IDs.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SHORT_HOSTS = new Set(['vt.tiktok.com', 'vm.tiktok.com']); // Share links. Only these redirect to the collection page.
const HOSTS = new Set([...SHORT_HOSTS, 'www.tiktok.com']);
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const MAX_LINK = 2048;
const PAGE = 30;
const MAX_ITEMS = 600;

const COPY = {
  notCollection: 'That link isn’t a TikTok collection. In TikTok, open the collection, tap Share, then Copy link.',
  refused: 'TikTok didn’t share this collection. Make sure it’s public.',
  unreachable: 'TikTok didn’t respond. Try again.'
};

const fail = (status, message) => Object.assign(new Error(message), { status });

// Wraps fetch: only an allow-listed host, a timeout, no cookies, and no automatic redirects. Network errors become 502.
async function tiktok(url) {
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) throw fail(400, COPY.notCollection);
  try {
    return await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw fail(502, COPY.unreachable);
  }
}

function parseLink(text) {
  let url;
  try { url = new URL(text); } catch { throw fail(400, COPY.notCollection); }
  const plain = url.protocol === 'https:' && HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;
  if (!plain) throw fail(400, COPY.notCollection);
  return url;
}

// A collection page path looks like /@user/collection/Name-123. Returns null for any other path.
function collectionIn(url) {
  const match = url.pathname.match(/\/collection\/(?:(.*)-)?(\d{5,25})\/?$/);
  if (!match) return null;
  let name = match[1] || '';
  try { name = decodeURIComponent(name); } catch { /* Keep the raw slug. */ }
  name = name.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return { id: match[2], name: name || 'TikTok collection' };
}

async function resolveLink(text) {
  if (!text || text.length > MAX_LINK) throw fail(400, COPY.notCollection);
  let url = parseLink(text);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const found = collectionIn(url);
    if (found) return found;
    // Only a share link redirects. Any other page is not worth a request.
    if (!SHORT_HOSTS.has(url.hostname) || hop === MAX_REDIRECTS) throw fail(400, COPY.notCollection);
    const response = await tiktok(url);
    response.body?.cancel().catch(() => {});
    const next = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!next) throw fail(400, COPY.notCollection);
    try { url = new URL(next, url); } catch { throw fail(400, COPY.notCollection); }
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) throw fail(400, COPY.notCollection);
  }
  throw fail(400, COPY.notCollection);
}

// The next two functions match `cleanCaption()`, `firstUrl()`, and `track()` in extension/tiktok.js. They run in
// different runtimes, so they are copies. Keep the two in sync. Differences: `video` is empty because TikTok's video
// addresses need a session, and addresses must be https.
const firstUrl = value => (typeof value === 'string' ? value : value?.urlList?.[0] || value?.url_list?.[0] || '');
const cleanCaption = text => text.replace(/(^|\s)[#@][^\s#@]+/g, ' ').replace(/\s+/g, ' ').trim();
const secure = value => (typeof value === 'string' && /^https:\/\//.test(value) ? value : '');
const str = value => (typeof value === 'string' ? value : '');

function track(item) {
  const music = item.music || {};
  const author = str(item.author?.uniqueId || item.author?.unique_id);
  const caption = cleanCaption(str(item.desc));
  const useCaption = music.original || !music.title;
  const duration = Number(item.video?.duration || music.duration);
  return {
    id: String(item.id),
    title: (useCaption ? caption || str(music.title) : str(music.title)) || 'Untitled clip',
    artist: useCaption ? (author ? `@${author}` : str(music.authorName)) : str(music.authorName) || (author ? `@${author}` : ''),
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    artwork: secure(item.video?.cover || item.video?.originCover || firstUrl(music.coverLarge) || music.coverMedium),
    motion: secure(item.video?.dynamicCover),
    video: '',
    audio: secure(music.playUrl)
  };
}

async function listPage(id, cursor) {
  const api = new URL('https://www.tiktok.com/api/collection/item_list/');
  api.search = new URLSearchParams({ aid: '1988', collectionId: id, count: String(PAGE), cursor: String(cursor), sourceType: '113' }).toString();
  const response = await tiktok(api);
  if (response.status >= 500) throw fail(502, COPY.unreachable);
  if (response.status !== 200) throw fail(404, COPY.refused);
  let body;
  try { body = await response.json(); } catch { throw fail(404, COPY.refused); }
  const code = body?.statusCode ?? body?.status_code ?? 0;
  if (code !== 0) throw fail(404, COPY.refused);
  return body;
}

async function listTracks(id) {
  const items = [];
  for (let cursor = 0, more = true; more && items.length < MAX_ITEMS;) {
    const body = await listPage(id, cursor);
    const page = Array.isArray(body.itemList) ? body.itemList : [];
    // A collection that exists but returns nothing on the first page is private or gone.
    if (!items.length && !page.length) throw fail(404, COPY.refused);
    items.push(...page);
    more = !!body.hasMore && page.length > 0;
    cursor = Number(body.cursor) || cursor + PAGE;
  }
  const all = items.filter(item => item && item.id != null).map(track);
  const playable = all.filter(clip => clip.audio);
  return { tracks: playable, skipped: all.length - playable.length };
}

const one = value => (typeof value === 'string' ? value : '');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); // Audio links expire.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method && req.method !== 'GET') throw fail(405, 'Use GET.');
    const query = req.query || {};
    let found;
    if (one(query.id)) {
      if (!/^\d{5,25}$/.test(one(query.id))) throw fail(400, COPY.notCollection);
      found = { id: one(query.id), name: 'TikTok collection' };
    } else {
      found = await resolveLink(one(query.url).trim());
    }
    const { tracks, skipped } = await listTracks(found.id);
    res.status(200).json({ id: found.id, name: found.name, tracks, skipped });
  } catch (error) {
    const status = error.status || 502;
    res.status(status).json({ error: error.status ? error.message : COPY.unreachable });
  }
};
