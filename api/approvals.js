/**
 * GET  /api/approvals          → devuelve { ENT-XXXXX: 'approved'|'rejected', ... }
 * POST /api/approvals  body: { code, action: 'approved'|'rejected'|'pending' }
 *                             → actualiza el estado del empresario
 *
 * Solo supervisores pueden hacer POST.
 * Cualquier rol autenticado puede hacer GET.
 *
 * Storage: Vercel KV (Redis) vía REST API sin SDK.
 * Env vars requeridas: KV_REST_API_URL, KV_REST_API_TOKEN
 */

const crypto = require('crypto');
const KV_KEY = 'pullman_approvals';

/* ─── JWT verify ──────────────────────────────────────────── */
function b64url(s) {
  return Buffer.from(s).toString('base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function verifyJWT(token, secret) {
  try {
    const [h, p, s] = (token||'').split('.');
    if (!h||!p||!s) return null;
    const expected = b64url(
      crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest()
    );
    const n = Math.max(s.length, expected.length, 1);
    const bs = Buffer.alloc(n), be = Buffer.alloc(n);
    Buffer.from(s).copy(bs); Buffer.from(expected).copy(be);
    if (!crypto.timingSafeEqual(bs,be) || s.length !== expected.length) return null;
    const payload = JSON.parse(Buffer.from(p,'base64').toString('utf8'));
    if (payload.exp && Math.floor(Date.now()/1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}

/* ─── Vercel KV helpers ───────────────────────────────────── */
async function kvGet() {
  const url   = process.env.KV_REST_API_URL + '/get/' + KV_KEY;
  const token = process.env.KV_REST_API_TOKEN;
  const res   = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const json  = await res.json();
  if (!json.result) return {};
  try { return JSON.parse(json.result); } catch { return {}; }
}

async function kvSet(data) {
  const url   = process.env.KV_REST_API_URL + '/set/' + KV_KEY;
  const token = process.env.KV_REST_API_TOKEN;
  await fetch(url, {
    method:  'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ value: JSON.stringify(data) }),
  });
}

/* ─── Body parser ─────────────────────────────────────────── */
async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(raw||'{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
    setTimeout(() => resolve({}), 1000);
  });
}

/* ─── Handler ─────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verificar sesión
  const SECRET = process.env.APP_SECRET || '';
  const token  = (req.headers['x-session-token']||'').trim();
  const payload = verifyJWT(token, SECRET);
  if (!payload) return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });

  // Verificar KV disponible
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ ok:false, error:'KV no configurado. Ver README.' });
  }

  /* GET — devolver todas las aprobaciones */
  if (req.method === 'GET') {
    try {
      const data = await kvGet();
      return res.status(200).json({ ok:true, approvals: data });
    } catch(err) {
      return res.status(502).json({ ok:false, error:'Error al leer KV: ' + err.message });
    }
  }

  /* POST — actualizar una aprobación (solo supervisor) */
  if (req.method === 'POST') {
    if (payload.role !== 'supervisor') {
      return res.status(403).json({ ok:false, error:'Solo supervisores pueden aprobar pagos' });
    }

    const { code, action } = await getBody(req);
    if (!code) return res.status(400).json({ ok:false, error:'Falta el código del empresario' });

    const validActions = ['approved','rejected','pending'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ ok:false, error:'Acción inválida. Use: approved, rejected, pending' });
    }

    try {
      const data = await kvGet();
      data[code] = { status: action, by: payload.sub, at: new Date().toISOString() };
      await kvSet(data);
      return res.status(200).json({ ok:true, code, action });
    } catch(err) {
      return res.status(502).json({ ok:false, error:'Error al escribir KV: ' + err.message });
    }
  }

  return res.status(405).json({ ok:false, error:'Method not allowed' });
};
