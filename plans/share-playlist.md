# Plan: share any playlist, including a folder, with another person

Audience: an implementing agent (Sonnet 5.5) with no prior context. Read this file, then `README.md`, `web/app.js`, `web/index.html`, `web/app.css`, `api/collection.js`, and `test/collection.test.js` before editing.

## Goal

A listener selects **Share** in the player and sends a link. The person who opens it hears the same playlist in any browser, with no extension and no sign-in:

- a whole collection, whether the sender opened it from a link or through the extension;
- one folder, such as Drive or Gym, which plays only that folder's clips.

## Current state (inspected 2026-11-14, commit `60063e9`)

- **Share** exists in the player header (`#share`, `web/index.html`). It shows only for a collection opened from a link (`shareButton.hidden = !(fromLink(choice) && choice.link)`, `web/app.js:569`).
- The handler (`web/app.js:1355-1368`) sends `${origin}/?link=<TikTok share link>`. It uses `navigator.share`, or else copies to the clipboard.
- On open, `takeSharedLink()` (`web/app.js:408-419`) reads `url`, `text`, `title`, or `link`, removes them from the address, puts the TikTok link in the field, and submits it. Android's Share menu uses the same path (`share_target` in `web/manifest.webmanifest`).
- Collections opened through the extension have no TikTok link, so they can't be shared.
- Folders live only in the sender's `localStorage` (`mcq.folders`, keyed by collection ID, `{ folders: [{ id, name, clips }], active }`). They can't be shared.
- `GET /api/collection?id=<digits>` already lists a public collection by ID with no session. The response name is always "TikTok collection" for this path.

## Design

No server changes. The share link names the collection by ID and carries the folder's clip IDs. The recipient's player loads the collection through the existing `?id=` call and rebuilds the folder in its own storage.

Rejected alternatives:
- Storing playlists on a server: the project has no database, and this would add one.
- Putting audio URLs in the link: TikTok's audio URLs expire.
- Private collections: the recipient has no TikTok session for them. The sender gets a clear message instead (see **Sender**).

### Link format

```
https://<origin>/?c=<collection id>&n=<collection name>[&f=<folder name>&clips=<id>.<id>.<id>]
```

- `c`: digits, 5-25 characters, the same rule as `api/collection.js`.
- `n`: the collection name, 1-100 characters after trimming. It is display text only.
- `f`: the folder name, 1-30 characters after trimming, the same limit as the folder form.
- `clips`: clip IDs joined with `.`, which `URLSearchParams` doesn't percent-encode. Each ID is 1-25 digits. At most 150 IDs keeps the link near 3 KB. Drop duplicates.
- `f` and `clips` come together. If only one is present, or `clips` has no valid ID, treat the link as a whole-collection share.
- Old `?link=` links keep working through `takeSharedLink()`. Don't change that function's parameters, because Android's share target uses them.

### Shared helper: `web/share-link.js` (new)

These two functions parse untrusted input, so put them in a small file that `node --test` can load:

- `buildShareUrl(origin, { id, name, folder })` returns the URL string. `folder` is `{ name, clips }` or absent.
- `parseShareParams(searchParams)` returns `null` when `c` is absent, `{ error }` when `c` is invalid, or `{ id, name, folder }`. It applies every rule in **Link format**. It never throws.

Export with `if (typeof module === 'object') module.exports = api; else globalThis.SubtokShareLink = api;`. Load it in `web/index.html` with `<script defer src="share-link.js"></script>` before `app.js`. The CSP already allows `script-src 'self'`.

### Sender: `web/app.js`

- Show **Share** for every collection except the sample: `shareButton.hidden = !!choice.sample`.
- Share what plays now. If a folder is active, share that folder; otherwise share the whole collection. Set the button's `aria-label` to `Share <folder name>` or `Share <collection name>` in `renderFolders()` and `open()`, so it stays current when the folder changes.
- For a folder, share `playableIn(folder)` clip IDs, which excludes the sender's hidden clips. If more than 150 clips remain, don't share. Put this in `#status`: "Folders with more than 150 clips can't be shared yet. Select All to share the whole collection."
- For a collection opened through the extension (`!fromLink(collection)`), check that it is public before sharing. Call `linkRequest(\`id=${collection.id}\`)`.
  - On a `404` error, don't share. Put this in `#status`: "This collection is private, so the link won't play for anyone else. In TikTok, make it public, then share again."
  - On any other error, put the error message in `#status` and don't share.
  - Disable the button while the check runs.
  - `linkRequest()` throws `failure(message)` without the HTTP status today. Add the status to the thrown error (`failure(message, response.status)`), and test `error.code === 404`.
  - Skip the check for link collections. They are public already.
- `navigator.share({ title, url })`: the title is `<collection name>` or `<collection name> · <folder name>`. Keep the clipboard fallback. The copy message is "Link to <folder or collection name> copied."
- The check runs before `navigator.share`, so the click's user activation can expire on some browsers, and `navigator.share` then throws `NotAllowedError`. On that error, copy to the clipboard instead. If the clipboard also fails, show the URL in `#status` as selectable text. Don't add a dialog.

### Recipient: `web/app.js`

In `start()`, before `takeSharedLink()`:

1. Call `SubtokShareLink.parseShareParams(new URLSearchParams(location.search))`. If it returns `null`, continue as today.
2. Remove `c`, `n`, `f`, and `clips` from the address with `history.replaceState`, as `takeSharedLink()` does.
3. On `{ error }`, call `showWelcome()` and `setLinkError('This Subtok link is incomplete. Ask for the link again.')`.
4. Otherwise call a new `openShared(shared)`:
   - `working(\`Loading ${folder?.name || name}…\`)`.
   - `linkRequest(\`id=${id}\`)`. On error, `showError(error, () => openShared(shared))`. The server's `404` copy already tells the visitor the collection must be public.
   - Build `choice = { id, name, source: 'link', link: '' }`. Call `saved.set(choice)` and `cacheTracks(id, result)`.
   - For a folder, write it into `folderStore` for this collection before `open()`, so `loadFolders()` picks it up:
     - Keep only shared clip IDs that are in `result.tracks`.
     - If no clip is left, skip the folder. After `open()`, put this in `#status`: "The shared clips aren't in this collection anymore. Playing all clips."
     - If a folder with the same name (case-insensitive) has the same clips, reuse it. If the name is taken by other clips, add " (shared)" and trim to 30 characters. Don't overwrite the recipient's own folders.
     - Set `active` to that folder's ID.
   - Call `open(choice, result.tracks)`, then `announceSkipped(result)`. Then put "Playing <folder name> from <collection name>." in `#status`, or leave it as is for a whole collection.
5. `open()` already adds link collections to the recent list. With `link: ''`, `openRecent()` still works, because it refreshes by ID.

Escape nothing by hand: `element()` and `.textContent` already treat `n` and `f` as text. Never put them in `innerHTML`.

### Styles: `web/app.css`

The button already has styles. Add a style only if the URL fallback in `#status` needs `overflow-wrap: anywhere`.

### Tests: `test/share-link.test.js` (new)

Use `node:test`, like `test/collection.test.js`. Cover:

- A round trip: `parseShareParams(new URL(buildShareUrl(...)).searchParams)` returns the same ID, name, folder name, and clips.
- `c` missing → `null`. `c` set to `abc`, `1234`, or 26 digits → `{ error }`.
- `n` empty or whitespace → `{ error }`. A 300-character name is trimmed to 100.
- `clips` with junk (`1.x.2..3`), duplicates, and 200 IDs → only valid unique IDs, at most 150.
- `f` without `clips`, or `clips` without `f` → whole-collection share.
- `<img src=x onerror=alert(1)>` as `n` or `f` is returned unchanged as a string. Rendering safety comes from `textContent`.

## Acceptance criteria

1. In the player, a public collection opened from a link shows **Share**. With **All** selected, the shared link opens the whole collection on a different origin (see **Verification**).
2. With a folder active, **Share** sends a link that opens only that folder's clips, with the folder selected, on the other origin. The recipient's existing folders are unchanged.
3. Opening the same folder link twice creates one folder, not two.
4. The sample playlist shows no **Share**.
5. A collection opened through the extension that is private shows the private message and shares nothing. A public one shares a working link.
6. A link with a bad `c` shows the incomplete-link error on the welcome screen. A link to a private or deleted collection shows the server's message and **Try again**.
7. Old `/?link=<TikTok link>` URLs and Android share-target URLs still play.
8. `node --test` passes, including the new tests. `node --check` passes for every changed JS file. The console shows no errors.

## Verification

- Run `node scripts/dev-server.js`. Use the built-in browser.
- To act as a second person, open the shared link on the other loopback name. `localStorage` is separate per origin. If the sender uses `http://127.0.0.1:8790/`, the recipient uses `http://localhost:8790/`. Replace the origin in the copied link by hand.
- Use the public test collection `https://vt.tiktok.com/ZS9fX48dsQpbB-7v8WM/` ("Music", 7 clips, ID `7707162500868999944`). Create a folder with 2 clips and share it.
- `navigator.share` may not exist in the built-in browser. In that case the clipboard path runs. Read the copied URL from `#status`, or call the click handler and log the URL.
- Criterion 5 needs the extension and a signed-in TikTok session in Chrome or Brave. You probably can't test it. Say so in the report. The owner verifies it.
- Don't clear the owner's saved data on either origin. Pause any audio you start.

## Out of scope

- Private collections for recipients without the extension.
- Sharing hidden-clip lists, resume positions, or shuffle and repeat settings.
- Server changes, a database, or short links.
- Changes to the extension or `docs/`.

## Docs

Update `README.md`:
- **Listen** item 7: **Share** works for any collection and for the active folder. It says that the collection must be public in TikTok.
- **Verification**: add what you checked and what remains for the owner (criterion 5 and the native share sheet on phones).

## Delivery

- Work on a branch. Use one commit for the helper and its tests, one for the player, and one for the README. Add the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Don't push, merge, or deploy.
