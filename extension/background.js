'use strict';

// Answers the player website's requests. TikTok only honors the listener's session for
// requests made from a TikTok page, so this reuses an open TikTok tab or opens a hidden one.
const api = globalThis.browser || globalThis.chrome;
const SITE_URL = 'https://subtok-player.vercel.app/';
const SITE_ORIGIN = /^(https:\/\/subtok-player\.vercel\.app|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\//;
const TIKTOK_URL = 'https://www.tiktok.com/';
const IDLE_CLOSE_MS = 30000;
let readerTabId = null;
let closeTimer;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ask(tabId, message, timeout = 20000) {
  return Promise.race([
    api.tabs.sendMessage(tabId, message),
    wait(timeout).then(() => { throw new Error('TikTok did not respond.'); })
  ]);
}
async function ready(tabId) {
  try { return (await ask(tabId, { type: 'ping' }, 1500)) === true; } catch { return false; }
}

async function readerTab() {
  clearTimeout(closeTimer);
  const open = (await api.tabs.query({ url: 'https://www.tiktok.com/*' })).map(tab => tab.id);
  const candidates = readerTabId !== null ? [readerTabId, ...open.filter(id => id !== readerTabId)] : open;
  for (const id of candidates) if (await ready(id)) return id;

  const tab = await api.tabs.create({ url: TIKTOK_URL, active: false });
  readerTabId = tab.id;
  for (let attempt = 0; attempt < 60; attempt++) {
    await wait(250);
    if (await ready(tab.id)) return tab.id;
  }
  throw new Error('The extension can’t read TikTok. Allow it on tiktok.com in your browser’s extension settings.');
}

function closeReaderLater() {
  clearTimeout(closeTimer);
  if (readerTabId === null) return;
  closeTimer = setTimeout(() => {
    api.tabs.remove(readerTabId).catch(() => {});
    readerTabId = null;
  }, IDLE_CLOSE_MS);
}
api.tabs.onRemoved.addListener(id => { if (id === readerTabId) readerTabId = null; });

async function handle(type, payload) {
  if (type === 'hello') return { version: api.runtime.getManifest().version };
  if (!['account', 'collections', 'tracks', 'video'].includes(type)) throw new Error('Unknown request.');
  const tabId = await readerTab();
  try {
    const reply = await ask(tabId, type === 'video'
      ? { type, url: String(payload?.url || ''), start: Number(payload?.start) }
      : { type, collectionId: payload?.collectionId ? String(payload.collectionId) : undefined });
    if (reply?.error) throw new Error(reply.error);
    return reply;
  } finally {
    closeReaderLater();
  }
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Answer only the bridge, in a top-level tab on the player website.
  if (sender.id !== api.runtime.id || !sender.tab || (sender.frameId !== undefined && sender.frameId !== 0) || !SITE_ORIGIN.test(sender.url || '')) return false;
  handle(message?.type, message?.payload)
    .then(result => sendResponse({ result }), error => sendResponse({ error: String(error?.message || error) }));
  return true;
});

// After a fresh install, an open player tab has no bridge, because content scripts load only with a page.
// Reload it so it finds the extension.
async function openSite(reload = false) {
  const [existing] = await api.tabs.query({ url: `${SITE_URL}*` });
  if (existing) {
    if (reload) await api.tabs.reload(existing.id);
    await api.tabs.update(existing.id, { active: true });
  } else await api.tabs.create({ url: SITE_URL });
}
api.action.onClicked.addListener(() => { openSite().catch(() => {}); });
api.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') openSite(true).catch(() => {});
});
