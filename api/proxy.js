const crypto = require('crypto');
const https  = require('https');

const KONNECT_BASE = 'https://api-pullman.konnectpro.cl';
const REDIS_KEY    = 'pullman_konnect_token';
const ALLOWED      = ['/api/v2/users', '/api/v2/reports/render_report/'];
const isAllowed    = p => ALLOWED.some(a => p.startsWith(a));

/* ─── JWT verify ─────────────────────────────────────────── */
function verifyJWT(token, secret) {
  try {
    const [h,p,s] = (token||'').split('.');
    if (!h||!p||!s) return null;
    const expected = crypto.createHmac('sha256', secret)
      .update(`${h}.${p}`).digest('base64')
      .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    const n = Math.max(s.length, expected.length, 1);
    const bs = Buffer.alloc(n), be = Buffer.alloc(n);
    Buffer.from(s).copy(bs); Buffer.from(expected).copy(be);
    if (!crypto.timingSafeEqual(bs,be)||s.length!==expected.length) return null;
    const payload = JSON.parse(Buffer.from(p,'base64').toString('utf8'));
    if (payload.exp && Math.floor(Date.now()/1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}

/* ─── HTTPS helper ───────────────────────────────────────── */
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

/* ─── Redis token lookup ─────────────────────────────────── */
async function getTokenFromRedis() {
  const url   = process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL   || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  try {
    const res  = await fetch(url + '/get/' + REDIS_KEY, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const json = await res.json();
    return json.result || null;
  } catch(e) {
    console.warn('[proxy] Redis token lookup failed:', e.message);
    return null;
  }
}

/* ─── Handler ────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ ok:false, error:'Method not allowed' });

  // Verify session
  const SECRET = process.env.APP_SECRET || '';
  if (!SECRET) return res.status(500).json({ ok:false, error:'APP_SECRET not configured' });
  const sessionToken = (req.headers['x-session-token']||'').trim();
  if (!verifyJWT(sessionToken, SECRET))
    return res.status(401).json({ ok:false, error:'Session invalid or expired' });

  // Validate path
  const targetPath = decodeURIComponent((req.query&&req.query.path)||'');
  if (!targetPath || !isAllowed(targetPath))
    return res.status(400).json({ ok:false, error:'Path not allowed' });

  // Token priority:
  // 1. Redis (auto-refreshed by cron every 48h) ← preferred
  // 2. KONNECT_BEARER_TOKEN env var             ← manual fallback
  const KONNECT_KEY = process.env.KONNECT_API_KEY || '';
  if (!KONNECT_KEY) return res.status(500).json({ ok:false, error:'KONNECT_API_KEY not configured' });

  const redisToken = await getTokenFromRedis();
  const KONNECT_TOKEN = redisToken || process.env.KONNECT_BEARER_TOKEN || '';

  if (!KONNECT_TOKEN) {
    console.error('[proxy] No Konnect token available (Redis empty, env var missing)');
    return res.status(500).json({
      ok:    false,
      error: 'Konnect token unavailable. Run /api/refresh-token or set KONNECT_BEARER_TOKEN.',
    });
  }

  if (redisToken) {
    console.log('[proxy] Using token from Redis (auto-refreshed)');
  } else {
    console.warn('[proxy] Using token from env var (manual). Consider triggering /api/refresh-token.');
  }

  try {
    const { status, body } = await httpsGet(
      `${KONNECT_BASE}${targetPath}`,
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

    // If Konnect returns 401, the token expired mid-session — flag it clearly
    if (status === 401) {
      console.error('[proxy] Konnect returned 401 — token expired. Triggering refresh...');
      // Fire-and-forget refresh (don't await — let this request fail gracefully)
      fetch('https://pago-terceros.vercel.app/api/refresh-token', {
        headers: { Authorization: 'Bearer ' + (process.env.CRON_SECRET||'') }
      }).catch(() => {});
      return res.status(401).json({ ok:false, error:'Konnect session expired. Retrying in a moment...' });
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(body);
  } catch (err) {
    console.error('[proxy] Error:', err.message);
    return res.status(502).json({ ok:false, error:`Upstream error: ${err.message}` });
  }
};