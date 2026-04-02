/**
 * GET    /api/operators          → list all operator accounts (supervisor only)
 * POST   /api/operators          → create operator account (supervisor only)
 *   body: { username, password, ownerCode, name }
 * DELETE /api/operators?username=X → remove operator account (supervisor only)
 *
 * Storage: Upstash Redis, key pullman_operators_v1
 * {
 *   "patricio.aguilera": { password, ownerCode, name, createdAt, createdBy }
 * }
 */

const crypto = require('crypto');
const KV_KEY = 'pullman_operators_v1';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SECRET  = process.env.APP_SECRET || '';
  const token   = (req.headers['x-session-token']||'').trim();
  const payload = verifyJWT(token, SECRET);
  if (!payload) return res.status(401).json({ ok:false, error:'Session invalid or expired' });
  if (payload.role !== 'supervisor')
    return res.status(403).json({ ok:false, error:'Supervisor access required' });

  const kv = kvConfig();
  if (!kv.url || !kv.token)
    return res.status(500).json({ ok:false, error:'KV not configured' });

  /* GET — list all operators (passwords omitted) */
  if (req.method === 'GET') {
    try {
      const data = await kvGet();
      const list = Object.entries(data).map(([username, op]) => ({
        username,
        ownerCode:  op.ownerCode,
        name:       op.name,
        createdAt:  op.createdAt,
        createdBy:  op.createdBy,
      }));
      return res.status(200).json({ ok:true, operators: list });
    } catch(e) {
      return res.status(502).json({ ok:false, error:e.message });
    }
  }

  /* POST — create / update operator */
  if (req.method === 'POST') {
    const { username, password, ownerCode, name } = await getBody(req);
    if (!username || !password || !ownerCode)
      return res.status(400).json({ ok:false, error:'username, password and ownerCode are required' });
    if (!/^ENT-\d+$/.test(ownerCode))
      return res.status(400).json({ ok:false, error:'ownerCode must match ENT-XXXXX format' });

    try {
      const data = await kvGet();
      data[username.toLowerCase().trim()] = {
        password,
        ownerCode: ownerCode.toUpperCase().trim(),
        name:      name || ownerCode,
        createdAt: new Date().toISOString(),
        createdBy: payload.sub,
      };
      await kvSet(data);
      return res.status(200).json({ ok:true, username, ownerCode });
    } catch(e) {
      return res.status(502).json({ ok:false, error:e.message });
    }
  }

  /* DELETE — remove operator */
  if (req.method === 'DELETE') {
    const username = (req.query?.username||'').toLowerCase().trim();
    if (!username) return res.status(400).json({ ok:false, error:'username required' });
    try {
      const data = await kvGet();
      if (!data[username]) return res.status(404).json({ ok:false, error:'Operator not found' });
      delete data[username];
      await kvSet(data);
      return res.status(200).json({ ok:true, deleted: username });
    } catch(e) {
      return res.status(502).json({ ok:false, error:e.message });
    }
  }

  return res.status(405).json({ ok:false, error:'Method not allowed' });
};
