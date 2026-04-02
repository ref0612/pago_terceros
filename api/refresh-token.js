/**
 * GET /api/refresh-token
 *
 * Llamado por Vercel Cron Job cada 48h.
 * También puede llamarse manualmente desde el panel de Vercel.
 *
 * Flujo:
 * 1. POST a Konnect Pro /api/v2/users/signin con credenciales
 * 2. Extrae el Bearer token de la respuesta (header Authorization)
 * 3. Guarda el token en Upstash Redis con TTL de 72h
 * 4. proxy.js lo lee desde Redis en cada request
 *
 * Seguridad: requiere CRON_SECRET en el header Authorization
 * para evitar que cualquiera pueda forzar un refresh.
 */

const KONNECT_BASE   = 'https://api-pullman.konnectpro.cl';
const REDIS_KEY      = 'pullman_konnect_token';
const TOKEN_TTL_SEC  = 72 * 3600; // 72h TTL en Redis (token dura 60h)

function kvConfig() {
  return {
    url:   process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL   || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
  };
}

async function saveTokenToRedis(bearerToken) {
  const { url, token } = kvConfig();
  // SET key value EX seconds
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', REDIS_KEY, bearerToken, 'EX', TOKEN_TTL_SEC]),
  });
  if (!res.ok) throw new Error('Redis write failed: ' + (await res.text()));
  return true;
}

async function fetchNewToken() {
  const login    = process.env.KONNECT_LOGIN    || '';
  const password = process.env.KONNECT_PASSWORD || '';
  const apiKey   = process.env.KONNECT_API_KEY  || '';

  if (!login || !password) {
    throw new Error('KONNECT_LOGIN and KONNECT_PASSWORD must be set');
  }

  const res = await fetch(
    KONNECT_BASE + '/api/v2/users/signin?is_system_side=false&locale=es',
    {
      method: 'POST',
      headers: {
        'accept':        'application/json',
        'content-type':  'application/json; charset=UTF-8',
        'x-api-key':     apiKey,
        'cache-control': 'no-store',
        'category_type': '1',
      },
      body: JSON.stringify({ user: { login, password } }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error('Konnect login failed (' + res.status + '): ' + body.slice(0, 200));
  }

  // Token comes in Authorization response header: "Bearer eyJ..."
  const authHeader = res.headers.get('authorization') || res.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7); // strip "Bearer " prefix
  }

  // Fallback: check JSON body
  const json = await res.json();
  if (json.data && json.data.token)    return json.data.token;
  if (json.token)                       return json.token;
  if (json.access_token)                return json.access_token;

  throw new Error('Token not found in Konnect response. Headers: ' + JSON.stringify([...res.headers.entries()]));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Security: only allow GET (Vercel Cron sends GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Verify cron secret to prevent unauthorized refresh
  const cronSecret  = process.env.CRON_SECRET || '';
  const authHeader  = (req.headers['authorization'] || '').replace('Bearer ', '');
  const isVercelCron = req.headers['x-vercel-cron'] === '1'; // Vercel sets this automatically

  if (cronSecret && !isVercelCron && authHeader !== cronSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const kv = kvConfig();
  if (!kv.url || !kv.token) {
    return res.status(500).json({ ok: false, error: 'Redis not configured' });
  }

  try {
    console.log('[refresh-token] Fetching new Konnect token...');
    const newToken = await fetchNewToken();
    await saveTokenToRedis(newToken);

    // Log to activity if needed (silent success)
    const preview = newToken.slice(0, 20) + '...';
    console.log('[refresh-token] ✓ Token refreshed and saved to Redis. Preview:', preview);

    return res.status(200).json({
      ok:        true,
      refreshed: new Date().toISOString(),
      preview:   preview,
    });
  } catch (err) {
    console.error('[refresh-token] FAILED:', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
};
