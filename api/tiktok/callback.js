const { timingSafeEqual } = require('node:crypto');

const CALLBACK = 'https://tiktok-sound-player.vercel.app/api/tiktok/callback';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Set-Cookie', 'tiktok_state=; Max-Age=0; Path=/api/tiktok/callback; HttpOnly; Secure; SameSite=Lax');
  const finish = result => res.redirect(303, `/?result=${result}`);
  if (req.method !== 'GET') return res.status(405).end();
  const { TIKTOK_CLIENT_KEY: key, TIKTOK_CLIENT_SECRET: secret, TIKTOK_REDIRECT_URI: redirect } = process.env;
  if (!key || !secret || redirect !== CALLBACK) return finish('config');
  const query = new URL(req.url, 'https://localhost').searchParams;
  const cookies = (req.headers.cookie || '').split(';').map(part => part.trim().split('='));
  const states = cookies.filter(([name]) => name === 'tiktok_state');
  const state = query.get('state');
  const expected = states.length === 1 ? states[0][1] : '';
  if (query.getAll('state').length !== 1 || !/^[a-f0-9]{64}$/.test(state || '') || !/^[a-f0-9]{64}$/.test(expected || '') || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return finish('state');
  if (query.has('error')) return finish('denied');
  if (query.getAll('code').length !== 1 || !query.get('code')) return finish('failed');
  try {
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: key, client_secret: secret, code: query.get('code'), grant_type: 'authorization_code', redirect_uri: redirect }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok || data.error || typeof data.open_id !== 'string' || !data.open_id || typeof data.access_token !== 'string' || !data.access_token) return finish('failed');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TikTok sign-in test</title></head><body><main><h1>TikTok sign-in succeeded</h1><p>This test discarded the tokens and did not create a session.</p><p><a href="/">Return to the test</a></p></main><script>history.replaceState(null, '', '/')</script></body></html>`);
  } catch {
    return finish('failed');
  }
};
