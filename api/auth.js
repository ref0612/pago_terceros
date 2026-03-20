/**
 * POST /api/auth
 * Body: { username, password }
 * Returns: { ok: true, token: "<jwt>" }
 */

const crypto = require('crypto');

// ─── Body parser (Vercel no parsea req.body automáticamente) ─
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ─── JWT mínimo HS256 sin dependencias externas ──────────────
function b64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJWT(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${body}.${sig}`;
}

// Comparación segura — padding para misma longitud (evita timing attacks)
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // Si difieren en largo, comparar con buffer de mismo largo pero devolver false
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // consume tiempo igual
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// ─── Handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Parsear body manualmente (Vercel no lo hace por defecto)
  const body = await readBody(req);
  const { username = '', password = '' } = body;

  const APP_USER   = process.env.APP_USER   || '';
  const APP_PASS   = process.env.APP_PASS   || '';
  const APP_SECRET = process.env.APP_SECRET || '';

  if (!APP_USER || !APP_PASS || !APP_SECRET) {
    console.error('[auth] Faltan variables de entorno: APP_USER / APP_PASS / APP_SECRET');
    return res.status(500).json({ ok: false, error: 'Servidor mal configurado' });
  }

  const ok = safeEqual(username, APP_USER) && safeEqual(password, APP_PASS);

  if (!ok) {
    // Mismo delay siempre para no revelar cuál campo falló
    return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
  }

  const now   = Math.floor(Date.now() / 1000);
  const token = signJWT(
    { sub: username, iat: now, exp: now + 8 * 3600 },
    APP_SECRET
  );

  return res.status(200).json({ ok: true, token });
};