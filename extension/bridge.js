'use strict';

// Runs on the player website. Relays the page's requests to the extension background.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const reply = (id, body) => window.postMessage({ source: 'mcq-ext', id, ...body }, window.location.origin);

  document.documentElement.dataset.mcqExtension = api.runtime.getManifest().version;
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'mcq-page' || typeof data.type !== 'string') return;
    // After the extension updates or reloads, this script is orphaned. Its calls throw or fail, and the page needs a reload.
    const orphaned = { error: 'The extension was updated. Reload this page to reconnect.', code: 'reload' };
    let sent;
    try {
      sent = Promise.resolve(api.runtime.sendMessage({ type: data.type, payload: data.payload }));
    } catch {
      return reply(data.id, orphaned);
    }
    sent.then(response => reply(data.id, response || { error: 'The extension did not respond.' }),
      error => reply(data.id, /invalidated|receiving end/i.test(String(error?.message)) ? orphaned : { error: String(error?.message || error) }));
  });
  window.postMessage({ source: 'mcq-ext', type: 'ready' }, window.location.origin);
})();
