'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const audio = $('#audio');
  const notice = $('#notice');
  const picker = $('#picker');
  const collectionList = $('#collections');
  const player = $('#player');
  const collectionName = player.querySelector('.collection');
  const art = player.querySelector('.art img');
  const title = $('#title');
  const artist = $('#artist');
  const seek = $('#seek');
  const elapsed = $('#elapsed');
  const remaining = $('#remaining');
  const toggle = $('#toggle');
  const next = $('#next');
  const status = $('#status');
  const queueList = $('#queue');
  const changeButton = $('#change');
  const storageKey = 'mcq.collection';
  const icons = {
    Play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    Pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3z"/></svg>'
  };

  let collection = null;
  let queue = [];
  let all = []; // Every clip in the collection, hidden ones included. `queue` is `all` minus hidden clips.
  let hidden = new Set();
  let index = 0;
  let failures = 0;
  let refreshedAt = 0;
  let dragging = false;
  let selection = 0;
  let playbackTimer = 0;
  let playbackPosition = 0;
  let recovering = null;

  // Sample playlist. It plays from this site, so it needs no extension and never touches TikTok.
  const sampleUrl = file => new URL(`samples/${file}`, location.href).href;
  const SAMPLE = { id: 'sample', name: 'Sample playlist', sample: true };
  const SAMPLE_TRACKS = [
    ['instrumental', 'Sample instrumental', 'TikTok sound'],
    ['sunrise', 'Sunrise'],
    ['night-drive', 'Night drive'],
    ['slow-tide', 'Slow tide'],
    ['city-lights', 'City lights']
  ].map(([file, name, by = 'Subtok sample']) => ({
    id: `sample-${file}`,
    title: name,
    artist: by,
    duration: 24,
    artwork: new URL('cover.png', location.href).href,
    motion: '',
    video: '',
    audio: sampleUrl(`${file}.m4a`)
  }));

  const saved = {
    get() { try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; } },
    set(value) { try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Keep it for this visit only. */ } }
  };

  // Extension bridge. The extension's content script answers window messages on this page.

  let requestId = 0;
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'mcq-ext' || !pending.has(event.data.id)) return;
    pending.get(event.data.id)(event.data);
    pending.delete(event.data.id);
  });
  // A failed request carries `error.code` when the cause is known: missing, reload, or timeout.
  const failure = (message, code) => Object.assign(new Error(message), { code });
  const quickTypes = new Set(['hello', 'account']); // These answer fast, so a silent extension shows up sooner.
  function ask(type, payload) {
    if (!document.documentElement.dataset.mcqExtension) return Promise.reject(failure('The Subtok extension is not turned on.', 'missing'));
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(failure('The extension took too long to answer. Try again.', 'timeout'));
      }, quickTypes.has(type) ? 8000 : 60000);
      pending.set(id, reply => {
        clearTimeout(timer);
        if (reply.error) reject(failure(reply.error, reply.code));
        else resolve(reply.result);
      });
      window.postMessage({ source: 'mcq-page', id, type, payload }, location.origin);
    });
  }
  async function extensionInstalled() {
    for (let waited = 0; waited < 1500; waited += 100) {
      if (document.documentElement.dataset.mcqExtension) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  // Pages

  function show(page) {
    stopReturnCheck();
    for (const section of [notice, picker, player]) section.hidden = section !== page;
    if (page !== player) {
      if (audio.hasAttribute('src')) {
        saveResume();
        stopPlayback();
        audio.removeAttribute('src');
        audio.load();
        clearVisual();
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
          navigator.mediaSession.setPositionState?.();
        }
      }
      document.title = 'Subtok';
    }
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  // `body` is a list of paragraphs, headings ({ heading }), and numbered steps ({ steps }).
  function showNotice({ heading, body = [], actions = [], busy = false }) {
    $('#notice-title').textContent = heading;
    const content = notice.querySelector('.body');
    content.replaceChildren(...body.map(part => {
      if (typeof part === 'string') return element('p', part);
      if (part.heading) return element('h2', part.heading);
      if (part.error) return element('p', part.error, 'error');
      const list = element('ol');
      list.append(...part.steps.map(step => element('li', step)));
      return list;
    }));
    if (busy) content.append(element('div', '', 'spinner'));
    notice.querySelector('.actions').replaceChildren(...actions.map(({ label, primary, run }) => {
      const button = element('button', label, primary ? 'primary' : '');
      button.type = 'button';
      button.addEventListener('click', run);
      return button;
    }));
    show(notice);
  }

  const working = heading => showNotice({ heading, busy: true });

  function showWelcome() {
    showNotice({
      heading: 'Play your TikTok collections',
      body: ['Try a short sample playlist now. To play your saved collections, you add a browser extension once.'],
      actions: [
        { label: 'Play sample', primary: true, run: playSample },
        { label: 'Play my TikTok collections', run: startMine }
      ]
    });
  }

  // Where the install button goes. Chrome and Brave get the latest GitHub release zip. iPhone has no public build yet, so its link is empty. Add the TestFlight or App Store link there when one exists.
  const INSTALL_LINKS = { ios: '', chromium: 'https://github.com/0xSenzel/subtok/releases/latest/download/subtok-extension.zip' };

  function platform() {
    const agent = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) {
      return /CriOS|FxiOS|EdgiOS|OPiOS/.test(agent) ? 'ios-other' : 'ios'; // Only Safari runs the extension on iOS.
    }
    if (/Android|Firefox/.test(agent) || (/Safari/.test(agent) && !/Chrome|Chromium|Edg/.test(agent))) return 'unsupported';
    return 'chromium';
  }

  // The bridge is injected only when a page loads, so a missing extension needs a reload to be found.
  // The flag tells the next load to go on with "my collections" instead of the welcome screen.
  const intent = {
    set() { try { sessionStorage.setItem('mcq.intent', 'mine'); } catch { /* The next load shows the welcome screen. */ } },
    take() {
      try {
        const mine = sessionStorage.getItem('mcq.intent') === 'mine';
        sessionStorage.removeItem('mcq.intent');
        return mine;
      } catch { return false; }
    }
  };
  const recheck = () => { intent.set(); location.reload(); };
  // The setup screen sets the flag, so leaving it for the sample also clears the flag. Otherwise every reload returns to setup.
  const playSample = () => { intent.take(); open(SAMPLE, SAMPLE_TRACKS); };

  // Run `check` each time the visitor comes back to this tab, until another page shows.
  let returnCheck = null;
  function checkOnReturn(check) {
    returnCheck = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', returnCheck);
  }
  function stopReturnCheck() {
    if (returnCheck) document.removeEventListener('visibilitychange', returnCheck);
    returnCheck = null;
  }

  function showSetup() {
    const kind = platform();
    if ((kind === 'ios' || kind === 'ios-other') && !INSTALL_LINKS.ios) {
      return showNotice({
        heading: 'Subtok isn’t on iPhone yet',
        body: ['You can play the sample here. To play your TikTok collections, use Chrome or Brave on a computer.'],
        actions: [{ label: 'Play sample', primary: true, run: playSample }]
      });
    }
    if (kind === 'ios-other') {
      return showNotice({
        heading: 'Open this page in Safari',
        body: ['Open this page in Safari to play your TikTok collections. Safari is the only iPhone browser that runs Subtok.'],
        actions: [{ label: 'Play sample', primary: true, run: playSample }]
      });
    }
    if (kind === 'unsupported') {
      return showNotice({
        heading: 'Subtok doesn’t work in this browser yet',
        body: ['Use Chrome or Brave on a computer, or Safari on iPhone, to play your TikTok collections.'],
        actions: [{ label: 'Play sample', primary: true, run: playSample }]
      });
    }
    const steps = kind === 'ios'
      ? [
        'Install the Subtok app.',
        'Open Settings › Apps › Safari › Extensions, and turn on Subtok.',
        'Come back here. In Safari’s page menu, select Subtok › Always Allow on This Website.'
      ]
      : [
        'Select Download extension, then unzip subtok-extension.zip.',
        'Open chrome://extensions (in Brave, brave://extensions) in a new tab, and turn on Developer mode.',
        'Select Load unpacked and choose the unzipped subtok-extension folder. Keep the folder; the browser loads Subtok from it.',
        'Come back to this tab. The page checks again by itself.'
      ];
    intent.set(); // If the extension reloads this tab after installing, go on to the collections.
    showNotice({
      heading: 'Set up the Subtok extension',
      body: [
        'Subtok uses your TikTok sign-in to read your saved collections, including private ones.',
        { heading: kind === 'ios' ? 'iPhone and iPad' : 'Chrome or Brave on a computer' },
        { steps }
      ],
      actions: [
        { label: kind === 'ios' ? 'Install Subtok' : 'Download extension', primary: true, run: () => window.open(INSTALL_LINKS[kind], '_blank', 'noopener') },
        { label: 'Check again', run: recheck },
        { label: 'Play sample', run: playSample }
      ]
    });
    checkOnReturn(recheck);
  }

  function showSignIn() {
    showNotice({
      heading: 'Sign in to TikTok',
      body: ['Sign in to TikTok in this browser so the player can read your collections. Then come back here.'],
      actions: [
        { label: 'Open TikTok', primary: true, run: () => window.open('https://www.tiktok.com/login', '_blank', 'noopener') },
        { label: 'I’ve signed in', run: startMine }
      ]
    });
    checkOnReturn(startMine);
  }

  function showError(error, retry) {
    showNotice({
      heading: 'Something went wrong',
      body: [{ error: error.message }],
      actions: [{ label: 'Try again', primary: true, run: retry }]
    });
  }

  function start() {
    const cached = saved.get();
    if (cached?.id && openFromCache(cached)) return checkInBackground();
    if (intent.take()) return startMine();
    showWelcome();
  }

  async function startMine() {
    if (!await extensionInstalled()) return showSetup();
    working('Connecting to TikTok…');
    try {
      const account = await ask('account');
      if (!account.signedIn) return showSignIn();
      const choice = saved.get();
      if (choice?.id) return await load(choice);
      await showPicker();
    } catch (error) {
      showError(error, startMine);
    }
  }

  async function showPicker() {
    working('Finding your collections…');
    let result;
    try {
      result = await ask('collections');
    } catch (error) {
      return showError(error, showPicker);
    }
    if (!result.signedIn) return showSignIn();
    if (!result.collections.length) {
      return showNotice({
        heading: 'No collections yet',
        body: ['In TikTok, save clips to a collection under Profile › Favorites › Collections. Then come back here.'],
        actions: [{ label: 'Check again', primary: true, run: showPicker }]
      });
    }
    collectionList.replaceChildren(...result.collections.map(item => {
      const row = element('li');
      const button = element('button');
      button.type = 'button';
      const text = element('span');
      text.append(element('span', item.name, 'name'),
        element('span', item.count == null ? '' : `${item.count} ${item.count === 1 ? 'clip' : 'clips'}`, 'by'));
      button.append(thumbnail(item.cover), text);
      button.addEventListener('click', () => {
        const choice = { id: item.id, name: item.name };
        saved.set(choice);
        load(choice);
      });
      row.append(button);
      return row;
    }));
    show(picker);
  }

  async function load(choice) {
    working(`Loading ${choice.name}…`);
    let result;
    try {
      result = await fetchTracks(choice.id);
    } catch (error) {
      return showError(error, () => load(choice));
    }
    if (!result.tracks.length) {
      return showNotice({
        heading: `${choice.name} has nothing to play`,
        body: ['None of the clips in this collection have audio the player can use.'],
        actions: [{ label: 'Choose another collection', primary: true, run: showPicker }]
      });
    }
    open(choice, result.tracks);
    if (result.skipped) status.textContent = `${result.skipped} ${result.skipped === 1 ? 'clip has' : 'clips have'} no playable audio and ${result.skipped === 1 ? 'is' : 'are'} left out.`;
  }

  // Player

  function time(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
  function setArtwork(img, url) {
    img.hidden = !url;
    if (url) img.src = url;
    else img.removeAttribute('src');
  }
  function thumbnail(url) {
    const box = element('span', '', 'thumb');
    const img = element('img');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { img.hidden = true; });
    setArtwork(img, url);
    box.append(img);
    return box;
  }

  function open(choice, tracks) {
    collection = choice;
    all = tracks;
    loadHidden();
    loadFolders();
    queue = visibleTracks();
    failures = 0;
    show(player);
    hideConnection();
    collectionName.textContent = choice.name;
    changeButton.textContent = choice.sample ? 'Use my collections' : 'Change';
    renderQueue();
    if (!queue.length) return showAllHidden();
    const first = resumeIndex(choice, queue);
    buildOrder(first);
    select(first, true);
  }

  function renderQueue() {
    queueList.replaceChildren(...queue.map((track, i) => {
      const row = element('li');
      row.dataset.clip = track.id;
      const button = element('button');
      button.type = 'button';
      const text = element('span');
      text.append(element('span', track.title, 'name'), element('span', track.artist, 'by'));
      button.append(thumbnail(track.artwork), text, element('span', track.duration ? time(track.duration) : '', 'length'));
      button.addEventListener('click', () => select(i, true));
      row.append(button, folderControl(track), hideControl(track));
      if (openPicker === track.id) row.append(folderPicker(track));
      return row;
    }));
    renderHidden();
    renderFolders();
  }

  function select(i, autoplay) {
    selection += 1;
    recovering = null;
    clearTimeout(playbackTimer);
    playbackPosition = 0;
    index = i;
    const track = queue[i];
    if (resumeAt?.id !== track.id) resumeAt = null;
    title.textContent = track.title;
    artist.textContent = track.artist;
    showVisual(track);
    document.title = `${track.title} · Subtok`;
    queueList.querySelectorAll(':scope > li > button:first-child').forEach((button, n) => button.setAttribute('aria-current', String(n === i)));
    seek.max = track.duration || 0;
    showPosition(0, track.duration || 0);
    refreshNext();
    status.textContent = '';
    prepareLeveling(track.audio);
    audio.src = track.audio;
    if ('mediaSession' in navigator) navigator.mediaSession.setPositionState?.();
    sessionCover = fallbackArtwork;
    setNowPlaying(track);
    if (track.artwork && 'mediaSession' in navigator) {
      const selected = selection;
      const cover = new Image();
      cover.referrerPolicy = 'no-referrer';
      cover.onload = () => {
        if (selected !== selection || player.hidden) return;
        sessionCover = [{ src: cover.src }];
        setNowPlaying(track);
      };
      cover.src = track.artwork;
    }
    if (autoplay) play();
    else renderToggle();
  }

  // Lock screen, Control Center, and Dynamic Island details. Use the bundled cover when TikTok's is missing or fails.
  const fallbackArtwork = [{ src: new URL('cover.png', location.href).href, sizes: '512x512', type: 'image/png' }];
  let sessionCover = fallbackArtwork;
  function setNowPlaying(track) {
    if (!track || player.hidden || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: folderById(activeFolder) ? `${collection.name} · ${folderById(activeFolder).name}` : collection.name,
      artwork: sessionCover
    });
  }

  function play() {
    if (player.hidden || !audio.hasAttribute('src')) return;
    const selected = selection;
    renderToggle(true);
    watchPlayback();
    audio.play().catch(error => {
      if (selected !== selection || player.hidden || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        clearTimeout(playbackTimer);
        status.textContent = 'Tap play to start listening.';
      }
      renderToggle();
    });
  }

  function stopPlayback() {
    recovering = null;
    clearTimeout(playbackTimer);
    audio.pause();
  }

  function watchPlayback() {
    clearTimeout(playbackTimer);
    const selected = selection;
    const position = audio.currentTime;
    playbackTimer = setTimeout(() => {
      if (selected !== selection || player.hidden || audio.paused || audio.ended) return;
      // A background tab can miss timeupdate events while the audio keeps playing.
      if (audio.currentTime !== position) watchPlayback();
      else recover();
    }, 8000);
  }

  function renderToggle(starting = false) {
    const label = !audio.paused || starting ? 'Pause' : 'Play';
    toggle.setAttribute('aria-label', label);
    toggle.innerHTML = icons[label];
  }

  function showPosition(current, duration) {
    if (!dragging) seek.value = current;
    elapsed.textContent = time(current);
    remaining.textContent = `-${time(duration - current)}`;
    seek.setAttribute('aria-valuetext', `${time(current)} of ${time(duration)}`);
  }
  const duration = () => (Number.isFinite(audio.duration) ? audio.duration : queue[index]?.duration || 0);

  function updateSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    if (Number.isFinite(audio.duration) && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate });
      } catch { /* Some browsers reject a position while metadata loads. */ }
    }
  }

  function goNext() {
    if (!queue.length) return;
    const n = stepNext();
    if (n >= 0) select(n, true);
  }
  function goPrevious() {
    if (!queue.length) return;
    const pos = order.indexOf(index);
    if (audio.currentTime > 3 || pos <= 0) { audio.currentTime = 0; return; }
    select(order[pos - 1], true);
  }

  // Shuffle, repeat, and sleep timer
  // `order` lists queue indexes in play order. It is the collection order unless shuffle is on.

  const prefs = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* Keep it for this visit only. */ } }
  };
  const repeatModes = ['off', 'all', 'one'];
  const sleepOptions = [0, 15, 30, 60, 'clip'];
  const shuffleButton = $('#shuffle');
  const repeatButton = $('#repeat');
  const sleepButton = $('#sleep');
  let shuffleOn = prefs.get('mcq.shuffle') === '1';
  let repeat = repeatModes.includes(prefs.get('mcq.repeat')) ? prefs.get('mcq.repeat') : 'off';
  let order = [];
  let sleepMode = 0;
  let sleepAt = 0;
  let sleepTimer = 0;
  let sleepLabel = '';

  // Put `first` at the front of a fresh random order. Pass -1 to shuffle every clip.
  function buildOrder(first = index) {
    order = queue.map((_, i) => i);
    if (!shuffleOn) return;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (first >= 0) order = [first, ...order.filter(i => i !== first)];
  }
  const atEnd = () => order.indexOf(index) >= order.length - 1;
  // The queue index that plays after the current clip, or -1. After the last clip, repeat all starts a new round.
  function stepNext() {
    const pos = order.indexOf(index);
    if (pos < order.length - 1) return order[pos + 1];
    if (repeat !== 'all') return -1;
    buildOrder(-1);
    if (order.length > 1 && order[0] === index) [order[0], order[1]] = [order[1], order[0]];
    return order[0];
  }
  const refreshNext = () => { next.disabled = atEnd() && repeat !== 'all'; };

  function renderModes() {
    shuffleButton.setAttribute('aria-pressed', String(shuffleOn));
    shuffleButton.querySelector('.state').textContent = shuffleOn ? 'Shuffle on' : 'Shuffle';
    repeatButton.setAttribute('aria-pressed', String(repeat !== 'off'));
    repeatButton.setAttribute('aria-label', `Repeat: ${repeat}`);
    repeatButton.querySelector('.state').textContent = repeat === 'off' ? 'Repeat' : `Repeat ${repeat}`;
    repeatButton.querySelector('.one').toggleAttribute('hidden', repeat !== 'one');
    if (queue.length) refreshNext();
  }
  shuffleButton.addEventListener('click', () => {
    shuffleOn = !shuffleOn;
    prefs.set('mcq.shuffle', shuffleOn ? '1' : '0');
    buildOrder();
    renderModes();
  });
  repeatButton.addEventListener('click', () => {
    repeat = repeatModes[(repeatModes.indexOf(repeat) + 1) % repeatModes.length];
    prefs.set('mcq.repeat', repeat);
    renderModes();
  });

  // The timer compares timestamps on timeupdate and ended, because a locked phone can delay timeouts.
  function renderSleep() {
    const minutes = sleepMode && sleepMode !== 'clip' ? Math.max(1, Math.ceil((sleepAt - Date.now()) / 60000)) : 0;
    const text = sleepMode === 'clip' ? 'End of clip' : minutes ? `${minutes} min left` : 'Sleep';
    if (text === sleepLabel) return;
    sleepLabel = text;
    sleepButton.setAttribute('aria-pressed', String(!!sleepMode));
    sleepButton.setAttribute('aria-label', `Sleep timer: ${sleepMode ? text : 'off'}`);
    sleepButton.querySelector('.state').textContent = text;
  }
  function setSleep(mode) {
    sleepMode = mode;
    sleepAt = typeof mode === 'number' && mode ? Date.now() + mode * 60000 : 0;
    clearInterval(sleepTimer);
    sleepTimer = sleepAt ? setInterval(() => { renderSleep(); checkSleep(false); }, 1000) : 0;
    renderSleep();
  }
  // Returns true when the timer fired. At the end of a clip, line up the next clip but do not play it.
  function checkSleep(ended) {
    if (!sleepMode || !(sleepMode === 'clip' ? ended : Date.now() >= sleepAt)) return false;
    setSleep(0);
    if (ended) {
      const n = repeat === 'one' ? index : stepNext();
      if (n >= 0) select(n, false);
    } else stopPlayback();
    status.textContent = 'Sleep timer ended. Playback paused.';
    return true;
  }
  sleepButton.addEventListener('click', () => {
    setSleep(sleepOptions[(sleepOptions.indexOf(sleepMode) + 1) % sleepOptions.length]);
    status.textContent = sleepMode === 'clip' ? 'Sleep timer: pause at the end of this clip.'
      : sleepMode ? `Sleep timer: pause in ${sleepMode} minutes.` : 'Sleep timer off.';
  });
  audio.addEventListener('timeupdate', () => checkSleep(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderSleep(); checkSleep(false); } });
  renderModes();

  // Keep the play order when clips are hidden, unhidden, merged, or refreshed: same clips in the same order, new ones last.
  function remapOrder(previous) {
    if (!shuffleOn) { order = queue.map((_, i) => i); return; }
    const at = new Map(queue.map((track, i) => [track.id, i]));
    const kept = order.map(i => at.get(previous[i]?.id)).filter(i => i !== undefined);
    order = [...kept, ...queue.map((_, i) => i).filter(i => !kept.includes(i))];
  }

  // TikTok's audio addresses expire. Fetch fresh ones once, then skip clips that still fail.
  async function recover() {
    const failed = queue[index];
    if (!failed || player.hidden || recovering === selection) return;
    const selected = selection;
    const position = audio.currentTime;
    recovering = selected;
    clearTimeout(playbackTimer);
    if (!collection.sample && Date.now() - refreshedAt > 60000) {
      refreshedAt = Date.now();
      status.textContent = 'Reconnecting to TikTok…';
      try {
        const result = await fetchTracks(collection.id);
        if (recovering !== selected || selection !== selected || player.hidden) return;
        if (result.tracks.length) {
          const previous = queue;
          all = result.tracks;
          queue = visibleTracks();
          remapOrder(previous);
          renderQueue();
          const same = queue.findIndex(track => track.id === failed.id);
          if (!queue.length) return showAllHidden();
          if (same >= 0) {
            if (!resumeAt && position > 0) resumeAt = { id: failed.id, t: position };
            return select(same, true);
          }
          return select(Math.min(index, queue.length - 1), true);
        }
      } catch {
        showConnection(); // Playback goes on; the clip may be skipped below.
      }
    }
    if (recovering !== selected || selection !== selected || player.hidden) return;
    recovering = null;
    failures += 1;
    if (failures >= queue.length || (atEnd() && repeat !== 'all')) {
      audio.pause();
      status.textContent = failures >= queue.length ? 'None of these clips could play. Try again later.' : `“${failed.title}” could not play.`;
      renderToggle();
      return;
    }
    select(stepNext(), true);
    status.textContent = `Skipped “${failed.title}” because it could not play.`;
  }

  // Hidden clips. Listeners hide clips they are tired of without unsaving them on TikTok.
  // Ids are stored per collection id, and `queue` is always `all` without them.

  const hiddenKey = 'mcq.hidden';
  const hiddenList = $('#hidden-list');
  const hiddenBox = $('#hidden');
  const hiddenStore = {
    get() { try { return JSON.parse(localStorage.getItem(hiddenKey)) || {}; } catch { return {}; } },
    set(value) { try { localStorage.setItem(hiddenKey, JSON.stringify(value)); } catch { /* Keep it for this visit only. */ } }
  };
  let undoTimer = 0;

  // Every queue change goes through here: hidden clips are left out, and so are clips outside the chosen folder.
  const visibleTracks = () => {
    const shown = all.filter(track => !hidden.has(track.id));
    const folder = folderById(activeFolder);
    if (!folder) return shown;
    const inside = shown.filter(track => inFolder(folder, track));
    if (inside.length) return inside;
    // Nothing playable is left in this folder, so play every clip rather than stopping.
    activeFolder = null;
    saveFolders();
    return shown;
  };

  function saveHidden() {
    const store = hiddenStore.get();
    if (hidden.size) store[collection.id] = [...hidden];
    else delete store[collection.id];
    hiddenStore.set(store);
  }

  // Read this collection's ids, keeping only clips still in it so the list cannot grow forever.
  function loadHidden() {
    const stored = hiddenStore.get()[collection.id];
    const ids = new Set(all.map(track => track.id));
    hidden = new Set(Array.isArray(stored) ? stored.filter(id => ids.has(id)) : []);
    if (Array.isArray(stored) && hidden.size !== stored.length) saveHidden();
  }

  function hideControl(track) {
    const button = element('button', 'Hide', 'row-action');
    button.type = 'button';
    button.setAttribute('aria-label', `Hide ${track.title}`);
    button.addEventListener('click', () => hideTrack(track));
    return button;
  }

  function renderHidden() {
    const clips = all.filter(track => hidden.has(track.id));
    hiddenBox.hidden = !clips.length;
    $('#hidden-summary').textContent = `Hidden (${clips.length})`;
    hiddenList.replaceChildren(...clips.map(track => {
      const row = element('li');
      const text = element('span', '', 'text');
      text.append(element('span', track.title, 'name'), element('span', track.artist, 'by'));
      const button = element('button', 'Unhide', 'row-action');
      button.type = 'button';
      button.setAttribute('aria-label', `Unhide ${track.title}`);
      button.addEventListener('click', () => unhideTrack(track));
      row.append(thumbnail(track.artwork), text, button);
      return row;
    }));
  }

  // Even volume (experimental, off by default).
  // Normal path: no crossOrigin attribute and no Web Audio. Leveling runs only when the listener turns it on and
  // the clip's host answers a CORS probe. A MediaElementAudioSourceNode cannot be undone, so turning it off sets
  // unity gain and a neutral compressor. After the graph exists, every clip keeps crossOrigin set.

  const evenKey = 'mcq.evenVolume';
  const evenButton = $('#even');
  const evenState = $('#even-state');
  const corsHosts = new Map(); // host -> { ok, at }. A failed probe is retried after two minutes.
  let evenOn = false;
  try { evenOn = localStorage.getItem(evenKey) === '1'; } catch { /* Off for this visit. */ }
  let ctx = null;
  let graph = null;
  let leveled = false;
  let probing = 0;
  let toldUnavailable = false;

  const hostOf = url => { try { return new URL(url).host; } catch { return ''; } };

  function ensureContext() { // Call from a user gesture so iOS lets it run.
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      ctx.addEventListener('statechange', renderEven);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }

  function levelNodes() {
    if (!graph) {
      const source = ctx.createMediaElementSource(audio);
      const compressor = ctx.createDynamicsCompressor();
      const makeup = ctx.createGain();
      source.connect(compressor).connect(makeup).connect(ctx.destination);
      graph = { compressor, makeup };
    }
    const { compressor, makeup } = graph;
    // Gentle leveler: quiet clips pass through, loud peaks are squeezed, makeup gain (+4 dB) restores level.
    // Off: ratio 1 and unity gain leave the signal unchanged.
    const set = (param, value) => { param.value = value; };
    set(compressor.threshold, evenOn ? -30 : 0);
    set(compressor.knee, evenOn ? 24 : 0);
    set(compressor.ratio, evenOn ? 3 : 1);
    set(compressor.attack, 0.01);
    set(compressor.release, 0.25);
    set(makeup.gain, evenOn ? 1.6 : 1);
  }

  async function probeCors(url) {
    const host = hostOf(url);
    probing += 1;
    renderEven();
    let ok = false;
    try {
      const response = await fetch(url, { mode: 'cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Range: 'bytes=0-1' } });
      response.body?.cancel();
      ok = true;
    } catch { /* No CORS headers, or the address failed. */ }
    probing -= 1;
    corsHosts.set(host, { ok, at: Date.now() });
    if (!ok && evenOn && !toldUnavailable) {
      toldUnavailable = true;
      status.textContent = 'Even volume isn’t available for these clips.';
    }
    renderEven();
    return ok;
  }

  // Runs in select() before audio.src is set. Synchronous, so playback never waits on the probe.
  function prepareLeveling(url) {
    const known = corsHosts.get(hostOf(url));
    if (evenOn && (!known || (!known.ok && Date.now() - known.at > 120000)) && !probing) probeCors(url).then(() => renderEven());
    if (graph || (evenOn && ctx && known?.ok)) {
      audio.crossOrigin = 'anonymous';
      levelNodes();
      leveled = known?.ok !== false;
    } else {
      audio.removeAttribute('crossorigin');
      leveled = false;
    }
    renderEven();
  }

  function renderEven() {
    let text = 'Off';
    if (evenOn) {
      const known = corsHosts.get(hostOf(queue[index]?.audio));
      if (leveled && ctx?.state === 'running') text = 'On';
      else if (leveled) text = 'On, waiting for audio to resume';
      else if (probing) text = 'Checking…';
      else if (known && !known.ok) text = 'Unavailable';
      else text = 'Starts with the next clip';
    }
    evenState.textContent = text;
    evenButton.setAttribute('aria-pressed', String(evenOn));
  }

  async function setEven(on) {
    evenOn = on;
    try { localStorage.setItem(evenKey, on ? '1' : '0'); } catch { /* Keep it for this visit only. */ }
    if (graph) levelNodes();
    if (on) ensureContext();
    renderEven();
    const track = queue[index];
    if (!on || !track || !ctx || graph) return; // With a graph, the gain change above already applies to this clip.
    if (!await probeCors(track.audio) || !evenOn) return;
    // Reload this clip through the graph at the same position.
    const wasPlaying = !audio.paused;
    const position = audio.currentTime;
    prepareLeveling(track.audio);
    audio.src = track.audio;
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = position; }, { once: true });
    if (wasPlaying) play();
  }

  evenButton.addEventListener('click', () => setEven(!evenOn));
  // Saved "on" has no gesture yet. The first tap anywhere lets the audio context run.
  document.addEventListener('pointerdown', () => { if (evenOn && !ctx) ensureContext(); }, { once: true });
  audio.addEventListener('play', () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); });
  renderEven();

  // Keep the playing clip when the queue changes around it.
  function resync() {
    const current = queue[index];
    const previous = queue;
    queue = visibleTracks();
    remapOrder(previous);
    const at = current ? queue.findIndex(track => track.id === current.id) : -1;
    if (at >= 0) index = at;
    renderQueue();
    if (at >= 0) {
      queueList.querySelectorAll(':scope > li > button:first-child').forEach((button, n) => button.setAttribute('aria-current', String(n === at)));
      refreshNext();
    }
    return at;
  }

  function hideTrack(track) {
    const wasCurrent = queue[index]?.id === track.id;
    const wasPlaying = !audio.paused;
    const folder = folderById(activeFolder);
    const successor = wasCurrent ? all.slice(all.indexOf(track) + 1).find(clip => !hidden.has(clip.id) && (!folder || inFolder(folder, clip))) : null;
    if (hidden.has(track.id)) return;
    const position = queue.indexOf(track);
    hidden.add(track.id);
    saveHidden();
    if (wasCurrent) {
      const previous = queue;
      queue = visibleTracks();
      remapOrder(previous);
      renderQueue();
      if (!queue.length) return showAllHidden();
      const at = successor ? queue.indexOf(successor) : queue.length - 1;
      select(at, wasPlaying && !!successor);
    } else resync();
    announceHidden(track);
    // Focus the next row's Hide button, since the one just used is gone.
    const buttons = queueList.querySelectorAll('.row-action');
    (buttons[Math.min(position, buttons.length - 1)] || hiddenBox.querySelector('summary')).focus();
  }

  function announceHidden(track) {
    clearTimeout(undoTimer);
    const undo = element('button', 'Undo', 'undo');
    undo.type = 'button';
    undo.addEventListener('click', () => unhideTrack(track, true));
    status.replaceChildren(`Hidden “${track.title}”. `, undo);
    undoTimer = setTimeout(() => { if (undo.isConnected) status.textContent = ''; }, 8000);
  }

  function unhideTrack(track, fromUndo = false) {
    hidden.delete(track.id);
    saveHidden();
    clearTimeout(undoTimer);
    if (!queue.length) return restoreAll();
    resync();
    status.textContent = fromUndo ? '' : `Unhid “${track.title}”.`;
    const at = queue.findIndex(clip => clip.id === track.id);
    // The clip may be outside the chosen folder, so it may have no row.
    queueList.querySelectorAll(':scope > li > button:first-child')[at]?.focus();
  }

  function showAllHidden() {
    showNotice({
      heading: 'Every clip is hidden',
      body: [`You have hidden all the clips in ${collection.name}. Unhide them to keep listening.`],
      actions: [
        { label: 'Unhide all', primary: true, run: () => { hidden.clear(); saveHidden(); restoreAll(); } },
        { label: 'Choose another collection', run: showPicker }
      ]
    });
  }

  function restoreAll() {
    queue = visibleTracks();
    show(player);
    renderQueue();
    buildOrder(0);
    select(0, true);
  }

  // Folders. Listeners sort clips into their own folders, such as Drive or Gym, and play one folder at a time.
  // A clip can be in several folders. Stored per collection id as { folders: [{ id, name, clips }], active }.
  // The filter itself lives in visibleTracks(), so hiding, shuffle, refresh, and the lock screen follow it.

  const folderKey = 'mcq.folders';
  const folderChips = $('#folder-chips');
  const folderForm = $('#folder-form');
  const folderInput = $('#folder-name');
  const folderManage = $('#folder-manage');
  const folderIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const folderStore = {
    get() { try { return JSON.parse(localStorage.getItem(folderKey)) || {}; } catch { return {}; } },
    set(value) { try { localStorage.setItem(folderKey, JSON.stringify(value)); } catch { /* Keep it for this visit only. */ } }
  };
  let folders = [];
  let activeFolder = null;
  let formMode = null; // { kind: 'new', clip? } or { kind: 'rename' }
  let openPicker = null; // Id of the clip whose folder list is open.
  let editFolder = null; // An empty folder tapped so it can be renamed or deleted without changing playback.

  const folderById = id => folders.find(folder => folder.id === id);
  const inFolder = (folder, track) => folder.clips.includes(track.id);
  const playableIn = folder => all.filter(track => !hidden.has(track.id) && inFolder(folder, track));
  const markCurrent = () => queueList.querySelectorAll(':scope > li > button:first-child')
    .forEach((button, n) => button.setAttribute('aria-current', String(n === index)));

  // Keep only clips still in the collection, so folders cannot grow forever.
  function loadFolders() {
    const stored = folderStore.get()[collection.id] || {};
    const ids = new Set(all.map(track => track.id));
    folders = (Array.isArray(stored.folders) ? stored.folders : [])
      .filter(folder => typeof folder?.id === 'string' && typeof folder.name === 'string')
      .map(folder => ({ id: folder.id, name: folder.name.slice(0, 30), clips: Array.isArray(folder.clips) ? folder.clips.filter(id => ids.has(id)) : [] }));
    activeFolder = folderById(stored.active) ? stored.active : null;
    openPicker = null;
    editFolder = null;
    closeForm();
  }

  function saveFolders() {
    if (!collection) return;
    const store = folderStore.get();
    if (folders.length) store[collection.id] = { folders, active: activeFolder };
    else delete store[collection.id];
    folderStore.set(store);
  }

  function renderFolders() {
    const shown = all.filter(track => !hidden.has(track.id));
    const chip = (label, id, count) => {
      const button = element('button', `${label} ${count}`, 'chip');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(activeFolder === id));
      button.setAttribute('aria-label', `${label}, ${count} ${count === 1 ? 'clip' : 'clips'}`);
      button.addEventListener('click', () => chooseFolder(id));
      return button;
    };
    const add = element('button', '+ New folder', 'chip chip-add');
    add.type = 'button';
    add.addEventListener('click', () => openForm({ kind: 'new' }));
    folderChips.replaceChildren(chip('All', null, shown.length),
      ...folders.map(folder => chip(folder.name, folder.id, shown.filter(track => inFolder(folder, track)).length)), add);
    renderManage();
  }

  const manageTarget = () => folderById(editFolder) || folderById(activeFolder);
  function renderManage() {
    const target = manageTarget();
    folderManage.hidden = !target || !folderForm.hidden;
    if (!target) return;
    $('#folder-rename').textContent = `Rename “${target.name}”`;
    $('#folder-delete').textContent = `Delete “${target.name}”`;
  }

  function chooseFolder(id) {
    closeForm();
    editFolder = null;
    if (id === activeFolder) return renderFolders();
    const folder = folderById(id);
    if (folder && !playableIn(folder).length) {
      editFolder = id;
      renderFolders();
      status.textContent = `${folder.name} is empty. Use the folder button on a clip to add it.`;
      return;
    }
    const current = queue[index];
    const wasPlaying = !audio.paused;
    activeFolder = id;
    saveFolders();
    queue = visibleTracks();
    const at = current ? queue.findIndex(track => track.id === current.id) : -1;
    if (at >= 0) {
      // The playing clip is in this folder: keep it and continue with the folder.
      index = at;
      buildOrder(at);
      renderQueue();
      markCurrent();
      refreshNext();
      setNowPlaying(current);
    } else {
      buildOrder(-1);
      renderQueue();
      select(order[0], wasPlaying);
    }
    status.textContent = folder ? `Playing ${folder.name}.` : 'Playing all clips.';
  }

  function folderControl(track) {
    const button = element('button', '', 'folder-action');
    button.type = 'button';
    button.innerHTML = folderIcon;
    const names = folders.filter(folder => inFolder(folder, track)).map(folder => folder.name);
    button.classList.toggle('filed', names.length > 0);
    button.setAttribute('aria-label', `Folders for ${track.title}${names.length ? `: ${names.join(', ')}` : ''}`);
    button.setAttribute('aria-expanded', String(openPicker === track.id));
    button.addEventListener('click', () => {
      openPicker = openPicker === track.id ? null : track.id;
      renderQueue();
      queueList.querySelector(`[data-clip="${CSS.escape(track.id)}"] .folder-action`)?.focus();
    });
    return button;
  }

  function folderPicker(track) {
    const panel = element('div', '', 'folder-pick');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `Folders for ${track.title}`);
    for (const folder of folders) {
      const label = element('label');
      const box = element('input');
      box.type = 'checkbox';
      box.checked = inFolder(folder, track);
      box.addEventListener('change', () => setMembership(folder, track, box.checked));
      label.append(box, document.createTextNode(folder.name));
      panel.append(label);
    }
    const add = element('button', folders.length ? 'New folder…' : 'Create a folder for this clip', 'folder-new');
    add.type = 'button';
    add.addEventListener('click', () => openForm({ kind: 'new', clip: track.id }));
    panel.append(add);
    return panel;
  }

  function setMembership(folder, track, on) {
    folder.clips = on ? [...new Set([...folder.clips, track.id])] : folder.clips.filter(id => id !== track.id);
    saveFolders();
    status.textContent = on ? `Added to ${folder.name}.` : `Removed from ${folder.name}.`;
    if (folder.id !== activeFolder) {
      // Only counts and the folder icon change; leave the list open.
      renderFolders();
      const row = queueList.querySelector(`[data-clip="${CSS.escape(track.id)}"]`);
      row?.querySelector('.folder-action')?.replaceWith(folderControl(track));
      return;
    }
    // The playing list changes. If the current clip left the folder, move on to the clip in its place.
    const wasPlaying = !audio.paused;
    const position = index;
    const fellBack = !playableIn(folder).length;
    if (resync() < 0 && queue.length) select(Math.min(position, queue.length - 1), wasPlaying);
    if (fellBack) status.textContent = `${folder.name} is empty now. Playing all clips.`;
    queueList.querySelector(`[data-clip="${CSS.escape(track.id)}"] input`)?.focus();
  }

  function openForm(mode) {
    formMode = mode;
    folderForm.hidden = false;
    folderInput.value = mode.kind === 'rename' ? folderById(mode.folder)?.name || '' : '';
    folderForm.querySelector('.folder-save').textContent = mode.kind === 'rename' ? 'Rename' : 'Create';
    folderManage.hidden = true;
    folderInput.focus();
  }
  function closeForm() {
    formMode = null;
    folderForm.hidden = true;
    renderManage();
  }

  folderForm.addEventListener('submit', event => {
    event.preventDefault();
    const mode = formMode;
    const name = folderInput.value.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!mode || !name) return folderInput.focus();
    const renaming = mode.kind === 'rename' ? folderById(mode.folder) : null;
    if (folders.some(folder => folder !== renaming && folder.name.toLowerCase() === name.toLowerCase())) {
      status.textContent = `You already have a folder called ${name}.`;
      return folderInput.focus();
    }
    if (renaming) renaming.name = name;
    else folders.push({ id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, clips: mode.clip ? [mode.clip] : [] });
    saveFolders();
    closeForm();
    renderQueue();
    if (renaming) setNowPlaying(queue[index]);
    status.textContent = renaming ? `Renamed to ${name}.` : mode.clip ? `Created ${name} and added the clip.` : `Created ${name}. Add clips with the folder button on each clip.`;
  });
  folderForm.addEventListener('keydown', event => { if (event.key === 'Escape') { closeForm(); renderFolders(); } });
  $('#folder-cancel').addEventListener('click', () => { closeForm(); renderFolders(); });
  $('#folder-rename').addEventListener('click', () => openForm({ kind: 'rename', folder: manageTarget()?.id }));
  $('#folder-delete').addEventListener('click', () => {
    const folder = manageTarget();
    if (!folder || !confirm(`Delete the folder “${folder.name}”? Its clips stay in your collection.`)) return;
    folders = folders.filter(item => item !== folder);
    if (folder.id === activeFolder) chooseFolder(null);
    else { editFolder = null; saveFolders(); renderQueue(); }
    status.textContent = `Deleted ${folder.name}.`;
  });

  toggle.addEventListener('click', () => {
    if (!queue.length) return;
    if (!audio.paused) stopPlayback();
    else if (audio.ended && atEnd()) select(order[0], true);
    else play();
  });
  $('#prev').addEventListener('click', goPrevious);
  next.addEventListener('click', goNext);
  changeButton.addEventListener('click', () => (collection?.sample ? startMine() : showPicker()));

  seek.addEventListener('pointerdown', () => { dragging = true; });
  seek.addEventListener('input', () => { elapsed.textContent = time(Number(seek.value)); });
  seek.addEventListener('change', () => {
    dragging = false;
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value);
  });

  audio.addEventListener('loadedmetadata', () => {
    seek.max = audio.duration;
    showPosition(audio.currentTime, audio.duration);
    updateSession();
  });
  audio.addEventListener('timeupdate', () => {
    if (player.hidden) return;
    showPosition(audio.currentTime, duration());
    if (audio.currentTime === playbackPosition) return;
    playbackPosition = audio.currentTime;
    if (!audio.paused && recovering !== selection) {
      if (!audio.seeking) failures = 0;
      watchPlayback();
    }
  });
  audio.addEventListener('playing', () => {
    if (player.hidden) return;
    watchPlayback();
    if (status.textContent.startsWith('Reconnecting') || status.textContent.startsWith('Tap play')) status.textContent = '';
    renderToggle();
    updateSession();
  });
  audio.addEventListener('pause', () => {
    if (!audio.paused) return;
    clearTimeout(playbackTimer);
    if (player.hidden) return;
    renderToggle();
    updateSession();
  });
  audio.addEventListener('seeked', updateSession);
  audio.addEventListener('ended', () => {
    clearTimeout(playbackTimer);
    if (checkSleep(true)) return;
    if (repeat === 'one') { audio.currentTime = 0; play(); return; }
    const n = stepNext();
    if (n >= 0) select(n, true);
    else { status.textContent = 'End of queue.'; renderToggle(); updateSession(); }
  });
  audio.addEventListener('error', () => {
    if (queue.length && audio.getAttribute('src')) recover();
  });
  art.addEventListener('error', () => {
    // An animated cover that fails falls back to the still cover first.
    const current = queue[index];
    if (current?.motion && current.artwork && current.motion !== current.artwork && art.getAttribute('src') === current.motion) return setArtwork(art, current.artwork);
    art.hidden = true;
  });

  if ('mediaSession' in navigator) {
    const handlers = {
      play,
      pause: stopPlayback,
      previoustrack: () => { if (!player.hidden) goPrevious(); },
      nexttrack: () => { if (!player.hidden) goNext(); },
      seekto: details => { if (!player.hidden && Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime; }
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
    }
  }

  // Clip visuals. The animated cover shows at once, then the clip's own video replaces it.
  // The video is muted and follows the audio element, which alone carries sound and lock screen playback.
  // TikTok's video addresses need the listener's session, so the extension fetches the video in pieces.
  // Videos load only while the page is visible, and larger ones keep the animated cover.

  const clipVideo = player.querySelector('.art video');
  const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
  const videoUrls = new Map(); // Clip id to object URL, oldest first.
  let videoFor = null;
  let videoJob = 0;
  let loadingVideo = null;
  clipVideo.loop = true;

  function clearVisual() {
    videoJob += 1;
    videoFor = null;
    clipVideo.classList.remove('ready');
    clipVideo.pause();
    clipVideo.hidden = true;
    if (clipVideo.hasAttribute('src')) {
      clipVideo.removeAttribute('src');
      clipVideo.load();
    }
  }

  function showVisual(track) {
    clearVisual();
    videoFor = track.id;
    setArtwork(art, track.motion || track.artwork);
    loadVideo(track);
  }

  async function loadVideo(track) {
    if (player.hidden || document.hidden || !track.video || videoFor !== track.id ||
        clipVideo.hasAttribute('src') || loadingVideo === videoJob) return;
    const job = videoJob;
    let url = videoUrls.get(track.id);
    if (url) videoUrls.delete(track.id);
    else {
      loadingVideo = job;
      try {
        const parts = [];
        let start = 0;
        let total = Infinity;
        let type = 'video/mp4';
        while (start < total) {
          const piece = await ask('video', { url: track.video, start });
          if (job !== videoJob || document.hidden) return;
          if (piece.total > MAX_VIDEO_BYTES) return;
          const text = atob(piece.data);
          const bytes = new Uint8Array(text.length);
          for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
          parts.push(bytes);
          ({ total, type } = piece);
          start += bytes.length;
          if (piece.whole || !bytes.length) break;
        }
        url = URL.createObjectURL(new Blob(parts, { type }));
      } catch {
        return; // The animated or still cover stays.
      } finally {
        if (loadingVideo === job) loadingVideo = null;
      }
    }
    videoUrls.set(track.id, url);
    for (const [id, old] of videoUrls) {
      if (videoUrls.size <= 3) break;
      videoUrls.delete(id);
      URL.revokeObjectURL(old);
    }
    if (job !== videoJob) return;
    clipVideo.addEventListener('loadeddata', () => {
      if (job !== videoJob) return;
      clipVideo.classList.add('ready');
      syncVideo(true);
    }, { once: true });
    clipVideo.src = url;
    clipVideo.hidden = false;
  }

  // Keep the picture with the sound. The video loops when the sound runs longer than the clip.
  function syncVideo(force = false) {
    if (!clipVideo.classList.contains('ready') || videoFor !== queue[index]?.id) return;
    const length = clipVideo.duration;
    if (!Number.isFinite(length) || !length) return;
    const target = audio.currentTime % length;
    if (force || Math.abs(clipVideo.currentTime - target) > 0.35) clipVideo.currentTime = target;
    if (audio.paused || document.visibilityState !== 'visible') clipVideo.pause();
    else if (clipVideo.paused) clipVideo.play().catch(() => {});
  }

  for (const event of ['playing', 'pause', 'seeked']) audio.addEventListener(event, () => syncVideo(true));
  audio.addEventListener('timeupdate', () => syncVideo());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return clipVideo.pause();
    const current = queue[index];
    if (current && !clipVideo.getAttribute('src')) loadVideo(current);
    else syncVideo(true);
  });

  // Instant start, resume, and live updates

  const CACHE_KEY = 'mcq.cache.';
  const RESUME_KEY = 'mcq.resume.';
  const MAX_CACHED = 500;
  let resumeAt = null; // { id, t }: seek here once that clip starts playing.
  let refreshing = false;
  let lastFresh = Date.now();

  function readStore(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is full or blocked. */ } }

  // Every fresh list comes through here, so the cache stays current. Keep only the chosen collection's list.
  async function fetchTracks(collectionId) {
    const result = await ask('tracks', { collectionId });
    lastFresh = Date.now();
    if (result.tracks.length) {
      try {
        for (let n = localStorage.length - 1; n >= 0; n--) {
          const key = localStorage.key(n);
          if (key?.startsWith(CACHE_KEY)) localStorage.removeItem(key);
        }
      } catch { /* Ignore. */ }
      writeStore(CACHE_KEY + collectionId, { at: Date.now(), skipped: result.skipped || 0, tracks: result.tracks.slice(0, MAX_CACHED) });
    }
    return result;
  }

  function openFromCache(choice) {
    const entry = readStore(CACHE_KEY + choice.id);
    const tracks = Array.isArray(entry?.tracks) ? entry.tracks.filter(t => t && typeof t.id === 'string' && typeof t.audio === 'string') : [];
    if (!tracks.length) return false;
    open(choice, tracks);
    return true;
  }

  function saveResume() {
    if (!collection || collection.sample || !queue[index]) return;
    if (resumeAt?.id === queue[index].id) return; // Not sought yet; keep the earlier position.
    writeStore(RESUME_KEY + collection.id, { id: queue[index].id, t: audio.currentTime || 0 });
  }

  function resumeIndex(choice, tracks) {
    resumeAt = null;
    const last = readStore(RESUME_KEY + choice.id);
    const found = last ? tracks.findIndex(track => track.id === last.id) : -1;
    if (found < 0) return 0;
    if (last.t > 0) resumeAt = { id: last.id, t: last.t };
    return found;
  }

  // Merge fresh tracks into the queue without touching the playing clip or what plays next.
  function mergeTracks(fresh) {
    const current = queue[index];
    const freshById = new Map(fresh.map(track => [track.id, track]));
    // Merge into every clip (`all`); hidden clips stay hidden because `queue` is rebuilt from it.
    const known = new Set(all.map(track => track.id));
    const merged = all.filter(track => track.id === current.id || freshById.has(track.id))
      .map(track => freshById.get(track.id) || track);
    const currentAt = () => merged.findIndex(track => track.id === current.id);
    let added = 0;
    let anchor = -1;
    for (const track of fresh) {
      if (known.has(track.id)) { anchor = merged.findIndex(item => item.id === track.id); continue; }
      let at = anchor + 1;
      if (at === currentAt() + 1 && at < merged.length) at += 1; // Keep the next clip next.
      merged.splice(at, 0, track);
      anchor = merged.indexOf(track);
      added += 1;
    }
    const sig = track => [track.id, track.audio, track.title, track.artist, track.artwork, track.duration, track.motion, track.video].join('|');
    if (merged.map(sig).join('\n') === all.map(sig).join('\n')) return 0;
    all = merged;
    const previous = queue;
    queue = visibleTracks();
    remapOrder(previous);
    index = queue.findIndex(track => track.id === current.id);
    renderQueue();
    queueList.querySelectorAll(':scope > li > button:first-child').forEach((button, n) => button.setAttribute('aria-current', String(n === index)));
    refreshNext();
    return added;
  }

  async function refresh() {
    if (refreshing || !collection || collection.sample || player.hidden) return;
    refreshing = true;
    const choice = collection;
    try {
      const account = await ask('account');
      if (!account.signedIn) return showConnectionFix('signed-out');
      const result = await fetchTracks(choice.id);
      if (collection !== choice || player.hidden) return;
      hideConnection();
      if (!result.tracks.length || !queue[index]) return;
      const added = mergeTracks(result.tracks);
      if (added) status.textContent = `${added} new ${added === 1 ? 'clip' : 'clips'} added.`;
    } catch {
      if (collection === choice && !player.hidden) showConnection(); // The cached list keeps playing.
    } finally { refreshing = false; }
  }

  // Connection banner. It sits under the player, so a lost connection never stops the music.

  const connection = $('#connection');
  const connectionMessage = $('#connection-message');
  const connectionActions = $('#connection-actions');

  function hideConnection() { connection.hidden = true; }

  function showBanner(message, ...buttons) {
    connectionMessage.textContent = message;
    connectionActions.replaceChildren(...buttons.map(({ label, primary, run }) => {
      const button = element('button', label, primary ? 'primary' : '');
      button.type = 'button';
      button.addEventListener('click', run);
      return button;
    }));
    connection.hidden = false;
  }

  const checkButton = () => ({ label: 'Check connection', run: runCheck });
  const reloadButton = () => ({ label: 'Reload', primary: true, run: () => { saveResume(); location.reload(); } });

  // The first message, before the visitor chooses to check.
  function showConnection() {
    showBanner('Subtok lost its connection to TikTok. Your music keeps playing.', checkButton());
  }

  function showConnectionFix(result) {
    switch (result) {
      case 'missing':
        return showBanner('Turn on the Subtok extension, then reload this page.', reloadButton(), checkButton());
      case 'reload':
        return showBanner('Subtok was updated or turned off. Reload this page to reconnect.', reloadButton(), checkButton());
      case 'signed-out':
        return showBanner('Sign in to TikTok in this browser.',
          { label: 'Open TikTok', primary: true, run: () => window.open('https://www.tiktok.com/login', '_blank', 'noopener') }, checkButton());
      case 'tiktok':
        return showBanner('The extension can’t reach TikTok. Allow Subtok on tiktok.com in your extension settings.', checkButton());
      default:
        hideConnection();
        return refresh();
    }
  }

  // Tell the visitor which part of the chain is broken: the extension, the sign-in, or TikTok itself.
  async function checkConnection() {
    try {
      await ask('hello');
    } catch (error) {
      return error.code === 'reload' ? 'reload' : 'missing';
    }
    try {
      return (await ask('account')).signedIn ? 'ok' : 'signed-out';
    } catch (error) {
      return ['missing', 'reload'].includes(error.code) ? error.code : 'tiktok';
    }
  }

  async function runCheck() {
    connectionMessage.textContent = 'Checking…';
    connectionActions.replaceChildren();
    showConnectionFix(await checkConnection());
  }

  async function checkInBackground() {
    const result = await checkConnection();
    if (collection && !player.hidden) showConnectionFix(result);
  }

  audio.addEventListener('playing', () => {
    const target = resumeAt;
    resumeAt = null;
    if (!target || target.id !== queue[index]?.id) return;
    if (target.t < audio.duration - 3) audio.currentTime = target.t; // Near the end: start the clip over.
  });
  audio.addEventListener('pause', () => { if (!player.hidden) saveResume(); });
  setInterval(() => { if (!audio.paused) saveResume(); }, 5000);
  setInterval(refresh, 30 * 60 * 1000);
  addEventListener('pagehide', saveResume);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return saveResume();
    if (Date.now() - lastFresh >= 10 * 60 * 1000) refresh();
  });

  start();
})();
