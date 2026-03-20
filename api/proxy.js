/**
 * GET /api/proxy?path=<encoded_path>
 *
 * Verifica el JWT de sesión (header X-Session-Token),
 * luego hace forward a api-pullman.konnectpro.cl
 * inyectando Authorization y x-api-key desde env vars.
 *
 * El Bearer token de Konnect NUNCA llega al navegador.
 */

const crypto = require('crypto');
const https  = require('https');

// ─── JWT verify (mismo helper que auth.js, sin dependencias) ──
function verifyJWT(token, secret) {
  try {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64').toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// ─── Minimal HTTPS fetch (Node built-in, no dependencies) ──
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── Allowed paths whitelist (security: prevent SSRF) ──────
const ALLOWED_PREFIXES = [
  '/api/v2/users',
  '/api/v2/reports/render_report/',
];

function isAllowedPath(path) {
  return ALLOWED_PREFIXES.some(p => path.startsWith(p));
}

// ─── Handler ───────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS — solo permite el mismo origen (Vercel/Render domain)
  const origin = req.headers['origin'] || '';
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  // En desarrollo permitimos cualquier origen; en prod solo los registrados
  if (process.env.NODE_ENV === 'production' && allowedOrigins.length > 0) {
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      return res.status(403).json({ ok: false, error: 'Origin not allowed' });
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ── 1. Verificar sesión ──────────────────────────────────
  const APP_SECRET = process.env.APP_SECRET;
  if (!APP_SECRET) {
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  const sessionToken = req.headers['x-session-token'] || '';
  const payload = verifyJWT(sessionToken, APP_SECRET);
  if (!payload) {
    return res.status(401).json({ ok: false, error: 'Sesión inválida o expirada' });
  }

  // ── 2. Validar el path destino ───────────────────────────
  const targetPath = decodeURIComponent(req.query.path || '');
  if (!targetPath || !isAllowedPath(targetPath)) {
    return res.status(400).json({ ok: false, error: 'Path no permitido' });
  }

  // ── 3. Obtener credenciales del servidor ─────────────────
  const KONNECT_TOKEN = process.env.KONNECT_BEARER_TOKEN;
  const KONNECT_KEY   = process.env.KONNECT_API_KEY;

  if (!KONNECT_TOKEN || !KONNECT_KEY) {
    console.error('Missing env vars: KONNECT_BEARER_TOKEN / KONNECT_API_KEY');
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  // ── 4. Hacer la petición a Konnect ──────────────────────
  const targetURL = `https://api-pullman.konnectpro.cl${targetPath}`;

  try {
    const { status, body } = await httpsGet(targetURL, {
      'accept':          'application/json',
      'accept-language': 'es-ES,es;q=0.9',
      'authorization':   `Bearer ${KONNECT_TOKEN}`,
      'cache-control':   'no-store',
      'category_type':   '1',
      'x-api-key':       KONNECT_KEY,
      'origin':          'https://pullman.konnectpro.cl',
      'referer':         'https://pullman.konnectpro.cl/',
      'user-agent':      'PullmanDashboard/1.0',
    });

    // Reenviar la respuesta tal cual (el front espera el mismo JSON)
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).send(body);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(502).json({ ok: false, error: `Upstream error: ${err.message}` });
  }
};
