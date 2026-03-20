/**
 * GET /api/proxy?path=<encoded_path>
 *
 * Verifica el JWT de sesión (header X-Session-Token),
 * luego hace forward a api-pullman.konnectpro.cl
 * inyectando Authorization y x-api-key desde env vars.
 * Las keys de Konnect NUNCA llegan al navegador.
 */

const crypto = require('crypto');
const https  = require('https');

// ─── JWT verify ──────────────────────────────────────────────
function b64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function verifyJWT(token, secret) {
  try {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;
    const expected = b64url(
      crypto.createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest()
        .toString('binary')
    );

    // Comparación segura de longitud fija
    const bSig = Buffer.from(sig      + '='.repeat((4 - sig.length      % 4) % 4), 'base64');
    const bExp = Buffer.from(expected + '='.repeat((4 - expected.length % 4) % 4), 'base64');

    if (bSig.length !== bExp.length) return null;
    if (!crypto.timingSafeEqual(bSig, bExp)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ─── HTTPS GET sin dependencias externas ────────────────────
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body:   Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout upstream')); });
  });
}

// ─── Whitelist de paths (anti-SSRF) ─────────────────────────
const ALLOWED = [
  '/api/v2/users',
  '/api/v2/reports/render_report/',
];
const isAllowed = p => ALLOWED.some(a => p.startsWith(a));

// ─── Handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // 1. Verificar sesión
  const APP_SECRET = process.env.APP_SECRET || '';
  if (!APP_SECRET) {
    console.error('[proxy] Falta APP_SECRET');
    return res.status(500).json({ ok: false, error: 'Servidor mal configurado' });
  }

  const sessionToken = req.headers['x-session-token'] || '';
  if (!verifyJWT(sessionToken, APP_SECRET)) {
    return res.status(401).json({ ok: false, error: 'Sesión inválida o expirada. Inicia sesión nuevamente.' });
  }

  // 2. Validar path destino
  const rawPath = req.query && req.query.path ? req.query.path : '';
  const targetPath = decodeURIComponent(rawPath);

  if (!targetPath || !isAllowed(targetPath)) {
    return res.status(400).json({ ok: false, error: 'Path no permitido' });
  }

  // 3. Credenciales del servidor
  const KONNECT_TOKEN = process.env.KONNECT_BEARER_TOKEN || '';
  const KONNECT_KEY   = process.env.KONNECT_API_KEY      || '';

  if (!KONNECT_TOKEN || !KONNECT_KEY) {
    console.error('[proxy] Faltan KONNECT_BEARER_TOKEN o KONNECT_API_KEY');
    return res.status(500).json({ ok: false, error: 'Servidor mal configurado' });
  }

  // 4. Forward a Konnect
  const targetURL = `https://api-pullman.konnectpro.cl${targetPath}`;
  console.log('[proxy] →', targetURL);

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

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(body);

  } catch (err) {
    console.error('[proxy] Error upstream:', err.message);
    return res.status(502).json({ ok: false, error: `Error upstream: ${err.message}` });
  }
};