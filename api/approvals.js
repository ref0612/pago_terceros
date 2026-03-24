/**
 * GET  /api/approvals          → { ok:true, approvals: { "ENT-03041__2026-03-23": { status, by, at }, ... } }
 * POST /api/approvals          → body: { key:"ENT-03041__2026-03-23", action:"approved"|"rejected"|"pending" }
 *
 * key = ownerCode + "__" + isoDate (YYYY-MM-DD)
 * Solo supervisores pueden POST. Cualquier rol autenticado puede GET.
 */

const crypto = require('crypto');
const KV_KEY  = 'pullman_approvals_v2'; // v2 = por dia

/* ─── JWT verify ─────────────────────────────────────────── */
function b64url(s) {
  return Buffer.from(s).toString('base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function verifyJWT(token, secret) {
  try {
    const [h,p,s] = (token||'').split('.');
    if (!h||!p||!s) return null;
    const expected = b64url(crypto.createHmac('sha256',secret).update(`${h}.${p}`).digest());
    const n = Math.max(s.length,expected.length,1);
    const bs=Buffer.alloc(n), be=Buffer.alloc(n);
    Buffer.from(s).copy(bs); Buffer.from(expected).copy(be);
    if (!crypto.timingSafeEqual(bs,be)||s.length!==expected.length) return null;
    const payload = JSON.parse(Buffer.from(p,'base64').toString('utf8'));
    if (payload.exp && Math.floor(Date.now()/1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}

/* ─── KV (Upstash) ───────────────────────────────────────── */
function kvConfig() {
  return {
    url:   process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL   || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
  };
}
async function kvGet() {
  const { url, token } = kvConfig();
  const res  = await fetch(url+'/get/'+KV_KEY, { headers:{ Authorization:'Bearer '+token } });
  const json = await res.json();
  if (!json.result) return {};
  try { return JSON.parse(json.result); } catch { return {}; }
}
async function kvSet(data) {
  const { url, token } = kvConfig();
  const res = await fetch(url, {
    method:'POST',
    headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' },
    body: JSON.stringify(['SET', KV_KEY, JSON.stringify(data)]),
  });
  if (!res.ok) throw new Error('KV write failed: '+(await res.text()));
}

/* ─── Body parser ────────────────────────────────────────── */
async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(raw||'{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
    setTimeout(() => resolve({}), 1000);
  });
}

/* ─── Handler ────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SECRET  = process.env.APP_SECRET || '';
  const token   = (req.headers['x-session-token']||'').trim();
  const payload = verifyJWT(token, SECRET);
  if (!payload) return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });

  const kv = kvConfig();
  if (!kv.url || !kv.token)
    return res.status(500).json({ ok:false, error:'KV no configurado. Conecta Upstash en Vercel Storage.' });

  /* GET */
  if (req.method === 'GET') {
    try {
      return res.status(200).json({ ok:true, approvals: await kvGet() });
    } catch(e) {
      return res.status(502).json({ ok:false, error:'Error KV: '+e.message });
    }
  }

  /* POST — solo supervisor */
  if (req.method === 'POST') {
    if (payload.role !== 'supervisor')
      return res.status(403).json({ ok:false, error:'Solo supervisores pueden aprobar pagos' });

    const { key, action } = await getBody(req);

    // Validar formato: ENT-XXXXX__YYYY-MM-DD
    if (!key || !/^ENT-\d+__\d{4}-\d{2}-\d{2}$/.test(key))
      return res.status(400).json({ ok:false, error:'Formato de clave inválido. Esperado: ENT-XXXXX__YYYY-MM-DD' });

    if (!['approved','rejected','pending'].includes(action))
      return res.status(400).json({ ok:false, error:'Acción inválida' });

    try {
      const data  = await kvGet();
      data[key]   = { status:action, by:payload.sub, at:new Date().toISOString() };
      await kvSet(data);
      return res.status(200).json({ ok:true, key, action });
    } catch(e) {
      return res.status(502).json({ ok:false, error:'Error KV: '+e.message });
    }
  }

  return res.status(405).json({ ok:false, error:'Method not allowed' });
};