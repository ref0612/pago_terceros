const crypto = require('crypto');

async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
    setTimeout(() => resolve({}), 1000);
  });
}

function b64url(s) {
  return Buffer.from(s).toString('base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function signJWT(payload, secret) {
  const h = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const s = crypto.createHmac('sha256', secret)
    .update(`${h}.${p}`).digest('base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${h}.${p}.${s}`;
}

function safeCompare(a, b) {
  const sa = String(a || ''), sb = String(b || '');
  const n = Math.max(sa.length, sb.length, 1);
  const ba = Buffer.alloc(n), bb = Buffer.alloc(n);
  Buffer.from(sa).copy(ba); Buffer.from(sb).copy(bb);
  return crypto.timingSafeEqual(ba, bb) && sa.length === sb.length;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok:false, error:'Method not allowed' });

  const { username='', password='' } = await getBody(req);
  const USER   = process.env.APP_USER   || '';
  const PASS   = process.env.APP_PASS   || '';
  const SECRET = process.env.APP_SECRET || '';

  if (!USER || !PASS || !SECRET) {
    console.error('[auth] Faltan env vars');
    return res.status(500).json({ ok:false, error:'Servidor mal configurado' });
  }

  if (!safeCompare(username, USER) || !safeCompare(password, PASS))
    return res.status(401).json({ ok:false, error:'Credenciales incorrectas' });

  const now = Math.floor(Date.now()/1000);
  const token = signJWT({ sub:username, iat:now, exp:now+8*3600 }, SECRET);
  return res.status(200).json({ ok:true, token });
};