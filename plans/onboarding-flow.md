# Plan: sample-first onboarding for the Subtok player

Audience: an implementing agent (Sonnet 5.5) with no prior context. Read this file, then `README.md`, `web/app.js`, `web/index.html`, `web/app.css`, and `extension/*.js` before editing.

## Goal

A first-time visitor to https://subtok-player.vercel.app/ can hear a sample playlist and skip tracks before installing anything. Installing the extension becomes an opt-in step that starts only when the visitor selects **Play my TikTok collections**.

Today `start()` in `web/app.js:169` calls `showInstall()` when the extension is missing. Every new visitor therefore sees an install wall first.

## Target flow

| Visitor state | First screen | Next step |
|---|---|---|
| No saved collection | Welcome: **Play sample** (primary) and **Play my TikTok collections** | See rows below |
| Selects **Play sample** | Player with the sample playlist, playing | Header button **Use my collections** starts the "mine" flow |
| Selects **Play my TikTok collections**, extension ready, signed in | Collection picker (no setup screen) | Existing picker flow |
| Same, extension missing, supported browser | Setup screen for this browser only | Auto-check when the visitor returns to the tab |
| Same, extension ready, signed out | Existing sign-in screen | Auto-check when the visitor returns to the tab |
| Same, unsupported browser | "Not supported in this browser yet" + **Play sample** | None |
| Saved collection with a cached list | Player opens that collection at the saved position (already works) | Connection check runs in the background |
| Extension stops answering during playback | Player keeps playing; inline banner with **Check connection** | Guided fix, no restart |

Setup copy must include this sentence verbatim: "Subtok uses your TikTok sign-in to read your saved collections, including private ones."

## Current state (inspected 2026-11-13, commit `4ffb186`)

Already done, keep it working:

- Extension ready and signed in goes straight to the picker or the saved collection (`start()`, `web/app.js:169-183`).
- Returning visitors reopen the last collection from the cache and resume at the saved clip and time (`openFromCache`, `resumeIndex`, `web/app.js:1248-1269`).

Missing:

1. No sample playlist and no welcome screen.
2. The install screen lists both iPhone and desktop steps, has no install link, and the only action is a manual reload (`showInstall`, `web/app.js:129-148`).
3. No automatic re-check when the visitor returns from installing or signing in.
4. A cached collection opens only after the extension check passes, so a returning visitor with a broken extension sees the install screen.
5. Connection failures during playback are silent (`refresh()` swallows errors, `web/app.js:1318`) or replace the player (`showError` calls `show(notice)`, which stops audio, `web/app.js:79-96`).
6. `ask()` waits 60 s before failing when the bridge is absent or orphaned (`web/app.js:54-68`).
7. After install, `openSite()` in `extension/background.js:71-75` focuses an already-open player tab. That tab has no bridge content script, because Chrome injects content scripts only on page load. The visitor still sees the install screen.

## Decisions (defaults chosen; the owner can override)

| Decision | Default | Alternative |
|---|---|---|
| Sample audio source | Generate 4 original 20-30 s instrumental loops with `ffmpeg` (installed at `/opt/homebrew/bin/ffmpeg`). No licensing risk. | Owner supplies CC0 tracks |
| Install link | No store listing exists. Use one constant per platform, empty for now. When empty, link to the README section (`#desktop-chrome-or-brave`, `#iphone`) on GitHub. | Fill the constant when a Chrome Web Store or TestFlight link exists |
| Welcome when extension is already ready | Still show the welcome screen; **Play my TikTok collections** skips setup | Skip welcome and open the picker |

## Tasks

Do them in order. Keep each change small and in the existing code style: plain JavaScript in one IIFE, no build step, no new dependencies, sentence-case UI copy, curly quotes in copy.

### 1. Sample playlist assets

- Add `web/samples/` with 4 clips (`.m4a`, AAC, about 96 kbps, under 400 KB each) and one square cover PNG per clip, or reuse `web/cover.png`.
- Generate the clips with `ffmpeg` synthesis (for example `aevalsrc` chord progressions with a simple beat). Keep each clip musically distinct so skipping is audible.
- Add a `SAMPLE` constant in `web/app.js`: `{ id: 'sample', name: 'Sample playlist', sample: true }` and a `SAMPLE_TRACKS` array in the existing track shape (`id`, `title`, `artist`, `duration`, `artwork`, `motion: ''`, `video: ''`, `audio`). Build URLs with `new URL('samples/…', location.href).href`.
- In `web/index.html:9`, change `media-src https: blob:` to `media-src 'self' https: blob:`. Without `'self'`, the local `http://127.0.0.1:8790` server cannot play the samples.

### 2. Welcome screen and sample mode

- Add `showWelcome()` that uses `showNotice()`. Heading: "Play your TikTok collections". One line of body copy. Actions: **Play sample** (primary) and **Play my TikTok collections**.
- **Play sample** calls `open(SAMPLE, SAMPLE_TRACKS)`. The click is the user gesture iOS needs for audio.
- Guard every extension call when `collection?.sample` is true:
  - `refresh()` (`web/app.js:1303`): return early.
  - `recover()` (`web/app.js:525`): skip the `fetchTracks` branch and go straight to the skip-clip branch.
  - `loadVideo()` already returns when `track.video` is empty. Confirm it.
- In sample mode, the header button `#change` reads **Use my collections** and runs the "mine" flow. Otherwise it reads **Change** and runs `showPicker`. Set the label in `open()`.
- Never call `saved.set()` for the sample. A visitor who only played the sample must see the welcome screen on the next visit.

### 3. Rework `start()` and add the "mine" flow

New `start()` order:

1. If `saved.get()` has an id and `openFromCache()` succeeds, then run a background connection check (task 5) and return.
2. If `sessionStorage['mcq.intent'] === 'mine'`, remove it and run `startMine()`.
3. Otherwise call `showWelcome()`.

New `startMine()` holds today's logic from `start()` lines 170-182: extension check, then `account`, then saved collection or picker. Replace the `showInstall()` call with `showSetup()` from task 4.

Wrap `sessionStorage` access in `try/catch`, like the existing `localStorage` helpers.

### 4. Browser-specific setup screen with auto-check

- Add `platform()`, which returns `'ios'`, `'chromium'`, or `'unsupported'`:
  - `ios`: `/iPhone|iPad|iPod/` in the user agent, or `Macintosh` with `navigator.maxTouchPoints > 1` (iPadOS).
  - `unsupported`: Android, Firefox, desktop Safari (`Safari` without `Chrome|Chromium|Edg`).
  - `chromium`: all others.
- Replace `showInstall()` with `showSetup()`:
  - Body: the required sentence, then the steps for this platform only. Reuse the existing step text from `web/app.js:135-144`.
  - Primary action: **Install Subtok**, which opens the store link or the README section in a new tab.
  - Secondary action: **Check again**, which sets `mcq.intent` to `'mine'` and reloads the page.
  - `unsupported`: heading "Subtok doesn’t work in this browser yet", one line naming the supported browsers (Chrome or Brave on a computer, Safari on iPhone), and **Play sample**.
- Auto-check on return: while the setup screen shows, listen for `visibilitychange` to `visible`. Then set the intent flag and reload. A reload is required because the bridge is injected only at page load. Remove the listener when another page shows.
- On the sign-in screen (`showSignIn`, `web/app.js:150`), add the same return listener, but call `startMine()` instead of reloading. The bridge is already present there.
- `extension/background.js`: in the `onInstalled` path only, reload the existing player tab (`api.tabs.reload(existing.id)`) before focusing it. Keep the toolbar click behavior. Have `openSite()` take a `reload` argument.

### 5. Connection check without starting over

- `ask()` fails fast: if `document.documentElement.dataset.mcqExtension` is unset, reject at once with a typed error (for example `error.code = 'missing'`).
- Lower the `ask()` timeout for `hello` and `account` to 8 s. Keep 60 s for `collections`, `tracks`, and `video`.
- `extension/bridge.js`: wrap `api.runtime.sendMessage` in `try/catch`. An orphaned content script (extension updated or reloaded) throws synchronously and today never replies. Reply `{ error: '…', code: 'reload' }`. Bump `extension/manifest.json` to `0.3.1`.
- Add `checkConnection()`. It returns one of `'ok'`, `'missing'`, `'reload'`, `'signed-out'`, or `'tiktok'` (TikTok tab unreachable or request refused), using `hello` then `account`.
- Add a `#connection` element below `#status` in `web/index.html`. It is hidden by default and has `role="status"`, a message, and a **Check connection** button. Keep it separate from `#status`, which other features overwrite.
- Show the banner, and never call `show(notice)` while the player is open, when:
  - the background check after a cache open (task 3, step 1) is not `'ok'`;
  - `refresh()` catches an error (replace the empty `catch` at `web/app.js:1318`);
  - `recover()` fails to fetch fresh tracks.
- **Check connection** runs `checkConnection()` and replaces the banner text with one fix:
  - `missing`: "Turn on the Subtok extension, then reload this page." plus a **Reload** button. Before the reload, call `saveResume()`.
  - `reload`: "Subtok was updated or turned off. Reload this page to reconnect." plus **Reload**. A turned-off extension also leaves an orphaned bridge, so this case covers it. After the reload, it falls into `missing`.
  - `signed-out`: "Sign in to TikTok in this browser." plus **Open TikTok**.
  - `tiktok`: "The extension can’t reach TikTok. Allow Subtok on tiktok.com in your extension settings."
  - `ok`: hide the banner and call `refresh()`.
- In `refresh()`, signed-out while paused currently calls `showSignIn()`, which replaces the player. Use the banner instead.

### 6. Copy and docs

- Update `README.md` under **Listen**: the player opens with a sample, and extension setup starts from **Play my TikTok collections**. Mention **Check connection**.
- Use the `google-dev-style` skill for README changes. Use the `design:ux-copy` skill to review new UI strings.

## Acceptance criteria

Verify each one in a browser and record the result.

1. With a fresh profile and no extension, the page loads to the welcome screen. **Play sample** plays audio within 2 s. **Next** and **Previous** change the clip. No request goes to `tiktok.com`.
2. Reload after only playing the sample. The welcome screen shows again.
3. With no extension in Chrome, **Play my TikTok collections** shows only the desktop steps and the required sentence.
4. Load the unpacked extension while the player tab is open. The tab reloads by itself and continues to the picker or sign-in screen without a click on the welcome screen.
5. With the extension and TikTok signed in, **Play my TikTok collections** goes straight to the picker.
6. Choose a collection, play to the middle of clip 2, and reload. The player opens clip 2 at the saved time.
7. With a collection playing, disable the extension in `chrome://extensions`. The next `refresh()` or a manual **Check connection** shows the banner. Audio keeps playing. The page still has an orphaned bridge, so the fix text matches the `reload` case. After a page reload, the banner shows the `missing` case.
8. Reload the extension in `chrome://extensions` while the player is open. **Check connection** shows the `reload` case within 8 s, not 60 s.
9. With a mobile Safari user agent, setup shows only the iPhone steps. With a Firefox user agent, the unsupported screen shows.
10. Everything in this list also works at `http://127.0.0.1:8790/` (CSP check for the samples).
11. No console errors on any screen.

## Verification method

- Serve locally: `python3 -m http.server 8790 --bind 127.0.0.1 --directory web`.
- Use the built-in browser pane for the no-extension cases (1, 2, 3, 9, 10). It has no extension, which is the target case.
- Cases 4-8 need Chrome or Brave with the unpacked `extension/` folder and a signed-in TikTok session. If you can't drive that browser, list these cases as unverified in the report. Don't mark them passed.
- Spoof user agents for case 9 with `resize_window` (mobile preset) or a DevTools override.

## Out of scope

- Publishing to the Chrome Web Store or TestFlight.
- Firefox, Android, and desktop Safari support.
- Changes to `docs/` (the landing page).
- Refactoring unrelated player code.

## Delivery

- Work on a branch, for example `onboarding-sample-first`. Don't push or deploy without the owner's approval.
- Use one commit per task group (assets and sample mode; start flow and setup; connection check; docs). Use imperative subject lines that match the repo history.
- The extension change (task 4 reload, task 5 bridge) needs the owner to reload the unpacked extension and, on iPhone, rebuild the Safari app. Say this in the report.
