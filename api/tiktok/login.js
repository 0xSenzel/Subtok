const { randomBytes } = require('node:crypto');

const CALLBACK = 'https://tiktok-sound-player.vercel.app/api/tiktok/callback';

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') return res.status(405).end();
  const { TIKTOK_CLIENT_KEY: key, TIKTOK_CLIENT_SECRET: secret, TIKTOK_REDIRECT_URI: redirect } = process.env;
  if (!key || !secret || redirect !== CALLBACK) return res.redirect(303, '/?result=config');
  const state = randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', `tiktok_state=${state}; Max-Age=600; Path=/api/tiktok/callback; HttpOnly; Secure; SameSite=Lax`);
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.search = new URLSearchParams({ client_key: key, scope: 'user.info.basic', response_type: 'code', redirect_uri: redirect, state }).toString();
  return res.redirect(302, url.toString());
};
