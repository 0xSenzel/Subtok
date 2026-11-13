# Plan: mobile fixes for the Subtok player

Audience: an implementing agent (Sonnet 5.5) with no prior context. Read this file, then `web/index.html`, `web/app.css`, and the setup code in `web/app.js` (`INSTALL_LINKS`, `platform()`, `showSetup()`), before editing. `plans/onboarding-flow.md` explains the onboarding flow these fixes change.

## Problems reported by the owner (iPhone, Safari)

1. On iPhone, **Install Subtok** opens the README. No public iPhone build exists (no TestFlight or App Store link), so `INSTALL_LINKS.ios` is empty and the button falls back to `SETUP_DOCS.ios`. A visitor can't do anything with the README.
2. The player header (**Sample playlist** and **Use my collections**, or the collection name and **Change**) is hidden behind the phone's status bar.
3. The owner wants the whole app to work well at phone size.

## What was observed (iPhone 16 Pro simulator, iOS 27.2, Safari tab, live site at `42b4896`+)

- At scroll top, the player header is below the status bar and readable.
- After scrolling, page content (the cover art, then the header) draws behind the status bar and the clock, with no backdrop. The header scrolls away, so the visitor must scroll back up to reach **Use my collections** or **Change**.
- Safari's floating bottom toolbar (back, address, tabs) covers the queue rows behind it.
- Inference, not verified: the owner saw the scrolled state, or the page in home-screen mode. `web/index.html` sets `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style: black-translucent`, so content can extend under the status bar. `main` pads its top with `max(16px, env(safe-area-inset-top))` (`web/app.css:27`). It is unknown whether `env(safe-area-inset-top)` is non-zero in a Safari tab on iOS 27. Measure it (task 2).

## Tasks

Keep the existing code style: plain JS and CSS, no build step, no new dependencies, sentence-case copy with curly quotes. Make the smallest change that meets the acceptance criteria.

### 1. iPhone setup screen without a public build

- When `INSTALL_LINKS.ios` is empty, the `ios` and `ios-other` kinds show one honest screen instead of install steps:
  - Heading: "Subtok isn’t on iPhone yet"
  - Body: "You can play the sample here. To play your TikTok collections, use Chrome or Brave on a computer."
  - Actions: **Play sample** (primary). No install button, no README link.
- When `INSTALL_LINKS.ios` has a link (TestFlight later), keep today's iPhone steps and the **Install Subtok** button. `ios-other` keeps its "Open this page in Safari" screen in that case.
- Remove `SETUP_DOCS` if nothing uses it after this change.
- A device that already has the extension never reaches setup, so the owner's own iPhone keeps working.

### 2. Keep the header clear of the status bar and reachable

- Measure first. Add a temporary probe on the local server that shows the computed `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` (for example, an element with `padding-top: env(safe-area-inset-top)` whose computed padding you render as text). Read the values in the simulator, in a Safari tab, at scroll top and after scrolling. Remove the probe before committing.
- Then make `#player header` stay visible while the page scrolls. Use `position: sticky`, with a top offset that clears the status bar, and an opaque background (`var(--bg)` or a matching gradient). Content then never shows through behind the header buttons.
- If the measured top inset is 0 while content still draws under the status bar, test removing `viewport-fit=cover`. Check whether Safari then keeps the page below the status bar. Choose the variant that passes the criteria with the least code, and record why in the commit message.
- Use the same rule for the notice and picker pages (`.page`), so no heading starts under the status bar.

### 3. Bottom toolbar and general phone layout

- Give the page enough bottom padding that the last queue row, the **Hidden** list, and **Even volume** can scroll fully above Safari's floating toolbar. Include `env(safe-area-inset-bottom)`.
- Check every screen at 320, 375, and 402 points wide: welcome, setup, unsupported, picker, player with the sample, the folder form, and the open folder picker on a queue row. Fix only real problems:
  - no horizontal page scroll;
  - text doesn't overlap or clip, except a deliberate ellipsis;
  - tap targets are at least 44 × 44 points;
  - queue row buttons (folder, **Hide**) don't overlap the title.
- Don't redesign the player. Keep the colors, type, and layout direction.

## Acceptance criteria

Record each result with a simulator screenshot.

1. On iPhone Safari without the extension, **Play my TikTok collections** shows "Subtok isn’t on iPhone yet" and **Play sample**. Nothing opens the README.
2. In the sample player at scroll top, the header text and button are fully below the status bar.
3. After scrolling to the end of the queue, the header is still visible below the status bar, and **Use my collections** still works. Nothing draws behind its text.
4. At the end of the queue, the last row and **Even volume** are fully visible above Safari's bottom toolbar.
5. No horizontal scroll and no overlapping controls at 320, 375, and 402 points wide on any screen.
6. The desktop layout in the built-in browser at desktop width looks the same as before, apart from the sticky header.
7. No console errors.

## Verification method

- Serve locally: `python3 -m http.server <port> --bind 127.0.0.1 --directory web`. Use a free port; 8790 may be taken. The iOS simulator reaches the host's `127.0.0.1`.
- Use the iOS Simulator tool on the booted iPhone 16 Pro (iOS 27.2, UDID `3C484D88-D336-4053-BE7C-8485490778DE`). Open your local URL with `open_url`. Take screenshots at scroll top and after scrolling to the end.
- That simulator has the owner's Safari extension and a saved collection on `127.0.0.1`. To see the welcome and setup screens there, use a Private Browsing tab, where extensions are usually off. If the extension still loads, verify criterion 1 another way and say how. Don't change the owner's extension settings or clear their site data.
- For widths 320 and 375, use the built-in browser's `resize_window` with custom sizes. Reset it to desktop afterwards.
- Pause any audio you start in the simulator before you finish.

## Out of scope

- Publishing an iPhone build (TestFlight or App Store).
- Changes to the extension, `docs/`, or playback logic.

## Delivery

- Commit on your branch with imperative subject lines, one commit for task 1 and one for tasks 2 and 3. Add the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Don't push, merge, or deploy. Report which criteria passed, with screenshot evidence, and which are unverified.
