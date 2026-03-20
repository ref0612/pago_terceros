const crypto = require('crypto');
const https  = require('https');

function verifyJWT(token, secret) {
  try {
    const [h, p, s] = (token||'').split('.');
    if (!h||!p||!s) return null;
    const expected = crypto.createHmac('sha256', secret)
      .update(`${h}.${p}`).digest('base64')
      .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    const n = Math.max(s.length, expected.length, 1);
    const bs = Buffer.alloc(n), be = Buffer.alloc(n);
    Buffer.from(s).copy(bs); Buffer.from(expected).copy(be);
    if (!crypto.timingSafeEqual(bs, be) || s.length !== expected.length) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
    if (payload.exp && Math.floor(Date.now()/1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status:res.statusCode, body:Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

const ALLOWED = ['/api/v2/users', '/api/v2/reports/render_report/'];
const isAllowed = p => ALLOWED.some(a => p.startsWith(a));

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ ok:false, error:'Method not allowed' });

  const SECRET = process.env.APP_SECRET || '';
  if (!SECRET) return res.status(500).json({ ok:false, error:'Servidor mal configurado' });

  const sessionToken = (req.headers['x-session-token']||'').trim();
  if (!verifyJWT(sessionToken, SECRET))
    return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });

  const targetPath = decodeURIComponent((req.query&&req.query.path)||'');
  if (!targetPath || !isAllowed(targetPath))
    return res.status(400).json({ ok:false, error:'Path no permitido' });

  const KONNECT_TOKEN = process.env.KONNECT_BEARER_TOKEN || '';
  const KONNECT_KEY   = process.env.KONNECT_API_KEY      || '';
  if (!KONNECT_TOKEN || !KONNECT_KEY) {
    console.error('[proxy] Faltan KONNECT_BEARER_TOKEN o KONNECT_API_KEY');
    return res.status(500).json({ ok:false, error:'Servidor mal configurado' });
  }

  try {
    const { status, body } = await httpsGet(
      `https://api-pullman.konnectpro.cl${targetPath}`,
      {
        'accept':          'application/json',
        'accept-language': 'es-ES,es;q=0.9',
        'authorization':   `Bearer ${KONNECT_TOKEN}`,
        'cache-control':   'no-store',
        'category_type':   '1',
        'x-api-key':       KONNECT_KEY,
        'origin':          'https://pullman.konnectpro.cl',
        'referer':         'https://pullman.konnectpro.cl/',
        'user-agent':      'PullmanDashboard/1.0',
      }
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(body);
  } catch (err) {
    console.error('[proxy] Error:', err.message);
    return res.status(502).json({ ok:false, error:`Error upstream: ${err.message}` });
  }
};