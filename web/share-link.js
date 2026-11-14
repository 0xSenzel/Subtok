'use strict';

// Subtok share links. A link names a public collection by ID and can carry one folder's clips:
//   /?c=<collection id>&n=<collection name>[&f=<folder name>&clips=<id>.<id>]
// The values come from whoever sent the link, so parsing checks every one and never throws.
// The page renders names with textContent only.
(() => {
  const MAX_NAME = 100;
  const MAX_FOLDER = 30; // The folder form's limit.
  const MAX_CLIPS = 150; // Keeps a link near 3 KB.
  const PARAMS = ['c', 'n', 'f', 'clips'];

  const tidy = (text, max) => (typeof text === 'string' ? text.trim().replace(/\s+/g, ' ').slice(0, max) : '');

  function buildShareUrl(origin, { id, name, folder }) {
    const params = new URLSearchParams({ c: id, n: tidy(name, MAX_NAME) });
    if (folder) {
      params.set('f', tidy(folder.name, MAX_FOLDER));
      // `.` stays unencoded, which keeps the link short.
      params.set('clips', folder.clips.slice(0, MAX_CLIPS).join('.'));
    }
    return `${origin}/?${params}`;
  }

  // Returns null when the address has no share link, { error } when it is unusable, or { id, name, folder }.
  function parseShareParams(params) {
    if (!params.has('c')) return null;
    const id = params.get('c') || '';
    const name = tidy(params.get('n'), MAX_NAME);
    if (!/^\d{5,25}$/.test(id) || !name) return { error: true };
    const folderName = tidy(params.get('f'), MAX_FOLDER);
    const clips = [...new Set((params.get('clips') || '').split('.').filter(clip => /^\d{1,25}$/.test(clip)))].slice(0, MAX_CLIPS);
    return { id, name, folder: folderName && clips.length ? { name: folderName, clips } : null };
  }

  const api = { buildShareUrl, parseShareParams, PARAMS, MAX_CLIPS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.SubtokShareLink = api;
})();
