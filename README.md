# Subtok

Play your saved TikTok collections as playlists, including private ones. The website in `web/` is the player. The browser extension in `extension/` reads your collections through your TikTok session.

The [interview portfolio page](docs/index.html) explains how Subtok works and shows the player with sample clips.

## Listen

1. Open the website. If the extension is missing, the website shows how to install it.
2. If you aren't signed in to TikTok in this browser, select **Open TikTok**, sign in, and return.
3. Choose a collection. The website remembers it on this browser. To switch, select **Change**.
4. On iPhone, use Safari. While audio plays, you can lock the phone or switch apps. If iOS shows Now Playing controls, use them to pause or skip.

The player shows the clip video while the page is visible and falls back to cover art when the video is unavailable. On iPhone, Safari can send still artwork and playback commands to iOS. iOS chooses the Now Playing layout. The website can't put moving video in the Dynamic Island.

The player opens your last collection instantly from a saved copy and resumes where you stopped. It refreshes from TikTok in the background, so new saves appear on their own. Below the controls:

- **Shuffle** and **Repeat** (off, all, one) apply to the lock screen buttons too and are remembered.
- **Sleep** pauses after 15, 30, or 60 minutes, or at the end of the clip.
- **Folders** sort clips your way, such as Drive or Gym. Select **+ New folder**, then use the folder button on a clip to add it; a clip can be in several folders. Choose a folder above the queue to play only its clips. Select **All** to play everything.
- **Hide** on a clip skips it without unsaving it on TikTok. Hidden clips are listed under **Hidden**, where you can unhide them.
- **Even volume** reduces loudness differences between clips. It starts off. Leave it off if audio stops when you lock your iPhone.

## Playback and storage

Sign-in stays on TikTok. The extension reads collections in a TikTok tab through internal endpoints that can change. The website streams audio from TikTok and tries a fresh address if playback fails or stalls. For the visible player, the extension fetches the current clip's video in pieces. The website plays it muted, in sync with the audio.

The browser saves the last loaded collection's details and links for up to 500 clips, plus resume positions, folders, hidden clips, and preferences. The open tab keeps up to three video clips, with a 20 MiB limit per clip. The player does not save media for offline playback.

## Run it locally

Serve the website on port 8790:

```sh
python3 -m http.server 8790 --bind 127.0.0.1 --directory web
```

The extension runs its bridge only on `127.0.0.1` and `localhost`, and its toolbar button opens `http://127.0.0.1:8790/`. Before you host the website, add its address to `content_scripts` in `extension/manifest.json` and to `SITE_URL` and `SITE_ORIGIN` in `extension/background.js`. Any page on an allowed address can ask the extension for your collections, so list only addresses you control.

### Desktop Chrome or Brave

1. Open `chrome://extensions` or `brave://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the `extension` folder.

The extension opens the website after installation.

### iPhone

Use Safari on iPhone, even if Chrome or Brave is your default browser. For the simulator on the same Mac, use the local address above. A physical iPhone needs a website address it can reach. Add that address to the extension's allowed origins as described above.

Generate a Safari extension app in Xcode from the repository root. [Apple's Safari extension guide](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)

```sh
xcrun safari-web-extension-packager extension --ios-only --swift --app-name Subtok --bundle-identifier com.senzel.Subtok
```

1. Connect your iPhone, select it as the run destination, and choose your team for both targets in **Signing & Capabilities**. A free Personal Team works for personal testing; its profile expires after seven days.
2. Run the app. If iOS asks for Developer Mode, follow [Apple's steps](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
3. In **Settings > Apps > Safari > Extensions**, turn on **Subtok**.
4. Open the website in Safari. In the page menu, select **Subtok** and allow it on the website. Allow it on `tiktok.com` the same way.

For other people, distribute the app through TestFlight or the App Store. [Safari distribution](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)

Firefox isn't supported yet because it runs extension background scripts differently.

## Verification

Chromium and desktop Brave passed the video and queue fixture with simulated TikTok responses. The signed-in iPhone simulator played a private collection and showed live video in sync with audio. The lock screen showed the title, artist, and progress. Artwork, transport controls, and sound output still need a physical iPhone check.
