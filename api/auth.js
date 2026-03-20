/**
 * POST /api/auth
 * Body: { username, password }
 * Returns: { ok: true, token: "<jwt>" }
 *
 * El JWT se firma con APP_SECRET (env var).
 * No depende de librerías externas — usa crypto nativo de Node.
 */

const crypto = require('crypto');

// ─── JWT mínimo (HS256) sin dependencias ──────────────────
function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJWT(payload, secret) {
  const header  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = base64url(JSON.stringify(payload));
  const data    = `${header}.${body}`;
  const sig     = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64').toString());
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

// ─── Handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};

  const APP_USER   = process.env.APP_USER;
  const APP_PASS   = process.env.APP_PASS;
  const APP_SECRET = process.env.APP_SECRET;

  if (!APP_USER || !APP_PASS || !APP_SECRET) {
    console.error('Missing env vars: APP_USER / APP_PASS / APP_SECRET');
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  // Comparación segura contra timing attacks
  const userMatch = crypto.timingSafeEqual(
    Buffer.from(username  || ''),
    Buffer.from(APP_USER)
  );
  const passMatch = crypto.timingSafeEqual(
    Buffer.from(password  || ''),
    Buffer.from(APP_PASS)
  );

  if (!userMatch || !passMatch) {
    return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
  }

  const token = signJWT(
    { sub: username, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 8 * 3600 },
    APP_SECRET
  );

  return res.status(200).json({ ok: true, token });
};
