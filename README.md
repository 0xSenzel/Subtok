# Subtok

Play your saved TikTok collections as playlists. The website in `web/` is the player. Any browser can play a public collection from its share link, through the function in `api/`. The browser extension in `extension/` also plays private collections, through your TikTok session.

The [Subtok landing page](https://0xsenzel.github.io/subtok/) explains how the player works and shows it with sample clips.

## Listen

1. Open the [Subtok player](https://subtok-player.vercel.app/). To play a public collection in any browser, including any iPhone or Android browser, paste its link into the field and select **Play**. In TikTok, open the collection, select Share, then Copy link. There is no extension and no sign-in. A private collection has no share link, so it needs the extension.
2. To listen before you paste anything, select **Play a sample**.
3. To hear your own collections, including private ones, use Chrome or Brave on a computer and select **Set up the extension** under the field. Once the extension is installed, the link reads **Open my collections**. If the extension is missing, the player shows the setup steps for your browser and checks again each time you return to the tab.
4. If you aren't signed in to TikTok in this browser, select **Open TikTok**, sign in, and return.
5. The website reopens your last collection on this browser. To switch, select **Change**. For a collection from a link, **Change** returns to the start screen, which lists your recent collections, up to eight. Select one to play it again without pasting, or select **×** to remove it. While the sample plays, select **Use my collections** instead.
6. To install Subtok, use **Add to Home Screen** in Safari on iPhone, or **Install app** in Chrome on Android. It then opens like an app.
7. To share a collection to someone else, select **Share** next to **Change** in the player. It sends a Subtok link that plays the same public collection. **Share** appears only for a collection opened from a link.
8. On Android, after you install Subtok, it appears in TikTok's Share menu. Share a collection to Subtok and it starts playing.
9. iPhone doesn't let websites appear in the Share menu. On iPhone, copy the link in TikTok and paste it into Subtok.
10. On iPhone, any browser plays a collection from a link. The extension needs Safari. While audio plays, you can lock the phone or switch apps. If iOS shows Now Playing controls, use them to pause or skip.

The player shows the clip video while the page is visible and falls back to cover art when the video is unavailable. A collection from a link shows cover art only, because TikTok's video addresses need a sign-in. On iPhone, Safari can send still artwork and playback commands to iOS. iOS chooses the Now Playing layout. The website can't put moving video in the Dynamic Island.

The player opens your last collection instantly from a saved copy and resumes where you stopped. It refreshes from TikTok in the background, so new saves appear on their own.

If the extension stops responding while you listen, the music keeps playing and a message appears under the controls. Select **Check connection** to find the cause. The player then tells you the fix, such as reloading the page, signing in to TikTok, or allowing Subtok on `tiktok.com`.

Below the controls:

- **Shuffle** and **Repeat** (off, all, one) apply to the lock screen buttons too and are remembered.
- **Sleep** pauses after 15, 30, or 60 minutes, or at the end of the clip.
- **Folders** sort clips your way, such as Drive or Gym. Select **+ New folder**, then use the folder button on a clip to add it; a clip can be in several folders. Choose a folder above the queue to play only its clips. Select **All** to play everything.
- **Hide** on a clip skips it without unsaving it on TikTok. Hidden clips are listed under **Hidden**, where you can unhide them.
- **Even volume** reduces loudness differences between clips. It starts off. Leave it off if audio stops when you lock your iPhone.

## Playback and storage

Sign-in stays on TikTok. The extension reads collections in a TikTok tab through internal endpoints that can change. For a link, the `api/collection.js` function on Vercel resolves the share link and reads the collection from the same endpoint without a session. It fetches only `vt.tiktok.com`, `vm.tiktok.com`, and `www.tiktok.com`, and returns only the clip details the player needs. It has no rate limit yet. The website streams audio from TikTok and tries a fresh address if playback fails or stalls. For the visible player, the extension fetches the current clip's video in pieces. The website plays it muted, in sync with the audio.

The browser saves the last loaded collection's details and links for up to 500 clips, plus resume positions, folders, hidden clips, and preferences. The open tab keeps up to three video clips, with a 20 MiB limit per clip. The player does not save media for offline playback.

## Run it locally

Serve the website and the link function on port 8790:

```sh
node scripts/dev-server.js
```

Open `http://127.0.0.1:8790/` to use the local player. The script uses only Node built-ins (Node 18 or later). `python3 -m http.server` serves the site but can't run the link function, so **Paste a collection link** fails with it. Set `PORT` to change the port. Set `HOST=0.0.0.0` to open the player from a phone on your network at `http://<your Mac's address>:8790/`. That also lets anyone on the network use the function, so use it only on a network you trust. The extension toolbar opens the hosted player. The extension accepts collection requests from the production domain and loopback development addresses. Any page at an allowed address can request collections through the extension.

### Desktop Chrome or Brave

1. Download `subtok-extension.zip` from the [latest release](https://github.com/0xSenzel/subtok/releases/latest) and unzip it. To work from this repository instead, use the `extension` folder.
2. Open `chrome://extensions` or `brave://extensions`.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the unzipped `subtok-extension` folder. Keep the folder; the browser loads the extension from it.

The extension opens the website after installation. If a player tab is already open, the extension reloads it so the tab finds the extension.

To publish a new version, raise `version` in `extension/manifest.json`, then build the zip and attach it to a release. Keep the asset name `subtok-extension.zip`; the player links to it through `releases/latest/download/`.

```sh
scripts/package-extension.sh
gh release create v0.3.1 dist/subtok-extension.zip --title "Subtok extension 0.3.1"
```

### iPhone

Any iPhone browser can play a public collection from a link, with no setup. To add the player to the Home Screen, use Safari's Share button, then **Add to Home Screen**. iPhone doesn't let websites appear in the Share menu, so copy the collection link in TikTok and paste it into Subtok. The extension, which plays private collections, needs Safari, even if Chrome or Brave is your default browser. Open the hosted player on a physical iPhone. In the simulator on the same Mac, you can also use the local address above.

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

The link flow played a public collection in a desktop browser and in the iPhone simulator, using the local server. It is not yet tested on Vercel's servers, where TikTok may treat the requests differently.
