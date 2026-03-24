/**
 * GET  /api/activity?limit=50        → últimas N entradas del log
 * POST /api/activity                 → registrar una acción
 *   body: { action, code, isoDate, amount, name }
 *   action: 'approved' | 'rejected' | 'paid'
 *
 * Storage: Upstash Redis, clave pullman_activity_v1
 * Máximo 500 entradas (circular buffer)
 */
const crypto = require('crypto');
const KV_KEY  = 'pullman_activity_v1';
const MAX_ENTRIES = 500;

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
  if (!json.result) return [];
  try { return JSON.parse(json.result); } catch { return []; }
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SECRET  = process.env.APP_SECRET || '';
  const token   = (req.headers['x-session-token']||'').trim();
  const payload = verifyJWT(token, SECRET);
  if (!payload) return res.status(401).json({ ok:false, error:'Sesión inválida' });

  const kv = kvConfig();
  if (!kv.url || !kv.token)
    return res.status(200).json({ ok:true, entries:[], warning:'KV no configurado' });

  if (req.method === 'GET') {
    try {
      const limit  = Math.min(parseInt(req.query?.limit||'100',10), 500);
      const entries = await kvGet();
      return res.status(200).json({ ok:true, entries: entries.slice(-limit).reverse() });
    } catch(e) {
      return res.status(200).json({ ok:true, entries:[], warning:e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { action, code, isoDate, amount, name } = await getBody(req);
      if (!action || !code) return res.status(400).json({ ok:false, error:'Faltan campos' });

      const entry = {
        action,                          // approved | rejected | paid
        code,                            // ENT-XXXXX
        isoDate: isoDate || '',
        amount:  amount  || '',
        name:    name    || '',
        by:      payload.sub,
        role:    payload.role,
        at:      new Date().toISOString(),
      };

      const entries = await kvGet();
      entries.push(entry);
      // Mantener solo las últimas MAX_ENTRIES entradas
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      await kvSet(entries);
      return res.status(200).json({ ok:true, entry });
    } catch(e) {
      return res.status(502).json({ ok:false, error:e.message });
    }
  }

  return res.status(405).json({ ok:false, error:'Method not allowed' });
};
