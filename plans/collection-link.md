# Plan: play a public TikTok collection from its share link

Audience: an implementing agent (Sonnet 5.5) with no prior context. Read this file, then `README.md`, `web/app.js`, `web/index.html`, `extension/tiktok.js`, and the spike function `api/collection.js` on branch `spike/collection-link` (`git show origin/spike/collection-link:api/collection.js`).

## Goal

A visitor on any browser (Brave or Safari on iPhone, Samsung Internet or Chrome on Android, any desktop browser) pastes a public collection's share link and the player plays it. There's no extension and no sign-in. The extension path stays for private collections on Chrome and Brave.

## Evidence from the spike (2026-11-13)

Tested from the owner's Mac with no TikTok cookies, using share link `https://vt.tiktok.com/ZS9fX48dsQpbB-7v8WM/` (a public collection named "Music"):

- The short link returns `301` to `https://www.tiktok.com/@disappearinggen/collection/Music-7707162500868999944?...`.
- `GET https://www.tiktok.com/api/collection/item_list/?aid=1988&collectionId=<id>&count=30&cursor=0&sourceType=113` with only a browser `User-Agent` returned `200`, `statusCode: 0`, and 7 items. This is the same endpoint `extension/tiktok.js` uses.
- All 7 `music.playUrl` values returned `206` without cookies (`audio/mpeg`, once `video/mp4`).
- `video.playAddr` returned `403` without a session. Link-sourced clips show cover art only.
- TikTok sends no `Access-Control-Allow-Origin`, so the browser can't call TikTok directly. A server function must.
- Not verified: the same calls from Vercel's servers. The preview deployment is behind Vercel Authentication. The first production deploy is the real test (see Verification).

Private collections have no share link, so they stay extension-only.

## Design

### Server: `api/collection.js` (Vercel Node function, CommonJS like the spike)

- `GET /api/collection?url=<share link>` resolves the link. `GET /api/collection?id=<digits>` skips resolving; use it for refreshes.
- Link resolving:
  - Accept only `https:` URLs on `vt.tiktok.com`, `vm.tiktok.com`, or `www.tiktok.com`.
  - Follow at most 5 redirects manually (`redirect: 'manual'`), checking the host at each hop.
  - Extract the ID from `/collection/<slug>-<digits>`. Take the name from the slug: decode it and turn hyphens into spaces, so "Music" stays "Music". Fall back to "TikTok collection".
- List:
  - Page through `item_list` with `cursor`, as `tracks()` in `extension/tiktok.js` does, up to 600 items.
  - Map each item to the player's track shape. Copy the logic of `track()` and `cleanCaption()` from `extension/tiktok.js` into the function, with a comment that the two must stay in sync. They run in different runtimes, so don't build a shared module.
  - Set `video: ''`, because the video needs a session. Keep `motion` and `artwork`.
  - Return `{ id, name, tracks, skipped }`, with only playable tracks (`https://` audio), like the extension.
- Errors return JSON `{ error }` with a status and plain copy:
  - not a TikTok collection link → `400` "That link isn’t a TikTok collection. In TikTok, open the collection, tap Share, then Copy link."
  - TikTok refuses, or returns a non-zero `statusCode` or an empty list for a collection that exists → `404` "TikTok didn’t share this collection. Make sure it’s public."
  - network failure or timeout → `502` "TikTok didn’t respond. Try again."
- Hardening (security-sensitive: a public endpoint that fetches remote URLs):
  - Never fetch a host outside the allow-list. Never forward client headers or cookies.
  - Use `AbortSignal.timeout(10000)` on each TikTok request.
  - Return only the fields the player needs. Don't return TikTok user IDs or the raw body.
  - Send `Cache-Control: no-store`, because audio links expire.
- Remove the spike's diagnostics (`audioCheck`, `region`, `bodyStart`).

### Player: `web/app.js`, `web/index.html`, `web/app.css`

- Saved choice gains a source: `{ id, name, source: 'link' }`. Choices saved by the extension picker stay as they are (no `source`) and mean `'extension'`. Don't migrate stored data.
- Route list fetches by source. Change `fetchTracks(collectionId)` to `fetchTracks(choice)`:
  - `link` calls `fetch('/api/collection?id=…')`;
  - otherwise it calls `ask('tracks')`.
  - Update every caller: `load`, `recover`, `refresh`. Keep the cache and resume logic unchanged.
- `refresh()` and `checkInBackground()` for a link source: skip the extension `account` check and `checkConnection()`. On failure, put a quiet line in `#status` ("Couldn’t refresh from TikTok. Your saved list keeps playing."). Don't show the extension banner.
- New screen `showLinkForm()`, using the existing notice page plus one form:
  - heading "Play a TikTok collection";
  - one sentence: "In TikTok, open a public collection, tap Share, then Copy link. Paste it here.";
  - a URL input (`type="url"`, `inputmode="url"`, `autocomplete="off"`, a visible label, 16px font so iOS doesn't zoom), a **Play** submit button, and **Back**.
  - On submit, show `working('Loading collection…')`. Call `?url=`. On success, `saved.set({ id, name, source: 'link' })` and `open()` the tracks. On error, show the form again with the server's message, keeping the pasted text.
  - Reuse the `.folder-form` input styles where they fit. Don't create a parallel style set.
- Entry points:
  - Welcome screen: add **Paste a collection link** on every platform. On phones and unsupported browsers it replaces **Play my TikTok collections**, which leads to a dead end there. Also update the welcome copy for those platforms, which today tells them to use a computer. On Chrome and Brave, keep the extension actions as well. Keep at most 3 buttons. If a 4th is needed, make **Download extension** a text link inside the body copy instead.
  - The "isn’t on iPhone yet", "Open this page in Safari", and unsupported screens get **Paste a collection link** next to **Play sample**. Their copy says that public collections play from a link, and private ones need the extension on a computer.
  - Player header: for a link source, **Change** opens `showLinkForm()`. Sample mode on phones: **Use my collections** opens `showLinkForm()`. On Chrome and Brave it keeps `startMine()`.
- `loadVideo` already skips tracks without `video`, so nothing changes there.

### Local development

`python3 -m http.server` can't run `api/`. Add `scripts/dev-server.js` (Node built-ins only, about 40 lines): it serves `web/` statically and routes `/api/collection` to `require('../api/collection.js')`, with a small shim for `req.query`, `res.status().json()`, and `res.setHeader`. Document `node scripts/dev-server.js` in the README's **Run it locally**.

### Docs

Update the README:
- **Listen** gets the link path.
- A note says link-sourced clips show cover art, not video.
- The iPhone section notes that any iPhone browser can play public collections from a link.

## Acceptance criteria

1. With the dev server, pasting `https://vt.tiktok.com/ZS9fX48dsQpbB-7v8WM/` plays the "Music" collection (7 clips). **Next** and **Previous** work, and cover art shows.
2. A reload opens the same collection from the cache at the saved clip and time, with no extension.
3. Pasting `https://www.tiktok.com/@x/video/123`, `https://example.com/`, or empty text shows the right error and keeps the input. The function makes no request to `example.com` (check with a log line or a unit call).
4. `GET /api/collection?url=http://169.254.169.254/` and `?url=https://vt.tiktok.com.evil.com/` return `400` without fetching.
5. In the iPhone simulator (Safari), the welcome screen offers **Paste a collection link**, and criterion 1 passes there.
6. The extension path is unchanged on desktop Chrome: welcome, setup, and download still behave as before. A saved extension collection still refreshes through the extension.
7. No console errors. `node --check` passes for every changed JS file.

## Verification

- Use the dev server for criteria 1-4 and 6-7, and the built-in browser for desktop.
- For criterion 5, use the booted iPhone 16 Pro simulator (UDID `3C484D88-D336-4053-BE7C-8485490778DE`). The simulator reaches the host at `127.0.0.1`. That origin has the owner's extension and saved data, so serve on the Mac's LAN address (`ipconfig getifaddr en0`), which the extension doesn't match. Type the address into Safari's address bar if `open_url` doesn't show the tab. Pause any audio you start, and don't clear the owner's data.
- Vercel itself is unverified (preview protection). Say so in the report. The owner verifies after deploy by pasting the link on the live site.

## Out of scope

- Private collections without the extension.
- Clip video for link sources.
- Changes to the extension or to `docs/`.
- Rate limiting. Mention it in the report as a follow-up risk: anyone can call the endpoint.

## Delivery

- Work on your branch. Use one commit for the function and dev server, one for the player, and one for the docs. Add the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Don't push, merge, or deploy.
