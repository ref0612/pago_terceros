/**
 * GET /api/aramco?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Devuelve los cargos Aramco por empresario por día.
 * Estructura: { "ENT-03041__2026-03-23": 12500, "ENT-03041__2026-03-24": 8000, ... }
 *
 * ══════════════════════════════════════════════════════════
 * TODO DEV TEAM: reemplazar la sección "STUB" con la llamada
 * real a la API de Aramco cuando esté disponible.
 * El contrato de respuesta debe mantenerse igual:
 *   { ok: true, data: { "ENT-XXXXX__YYYY-MM-DD": <number>, ... } }
 * ══════════════════════════════════════════════════════════
 */

const crypto = require('crypto');

/* ─── JWT verify (mismo helper que proxy.js) ─────────────── */
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

/* ─── Handler ────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ ok:false, error:'Method not allowed' });

  // Verificar sesión
  const SECRET  = process.env.APP_SECRET || '';
  const token   = (req.headers['x-session-token']||'').trim();
  if (!verifyJWT(token, SECRET))
    return res.status(401).json({ ok:false, error:'Sesión inválida o expirada' });

  const { from, to } = req.query || {};
  if (!from || !to)
    return res.status(400).json({ ok:false, error:'Parámetros requeridos: from, to (YYYY-MM-DD)' });

  // ══════════════════════════════════════════════════════════
  // STUB — reemplazar con llamada real a la API de Aramco
  // ══════════════════════════════════════════════════════════
  const ARAMCO_API_URL   = process.env.ARAMCO_API_URL   || '';
  const ARAMCO_API_TOKEN = process.env.ARAMCO_API_TOKEN || '';

  if (ARAMCO_API_URL && ARAMCO_API_TOKEN) {
    // ── MODO REAL: llamar a la API de Aramco ────────────────
    // TODO: ajustar el formato de la petición y respuesta
    // según la documentación de Aramco cuando esté disponible.
    try {
      const { default: https } = await import('https');
      // Ejemplo de llamada — adaptar a la API real:
      // GET {ARAMCO_API_URL}/charges?from={from}&to={to}
      // Response esperada: [{ ownerCode:"ENT-XXXXX", date:"YYYY-MM-DD", amount:12500 }, ...]
      const response = await fetch(`${ARAMCO_API_URL}/charges?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${ARAMCO_API_TOKEN}` },
      });
      if (!response.ok) throw new Error(`Aramco API error: ${response.status}`);
      const items = await response.json();

      // Convertir al formato de clave ENT-XXXXX__YYYY-MM-DD
      const data = {};
      (items || []).forEach(item => {
        if (item.ownerCode && item.date && item.amount) {
          data[`${item.ownerCode}__${item.date}`] = item.amount;
        }
      });
      return res.status(200).json({ ok:true, data, source:'aramco_api' });
    } catch(err) {
      console.error('[aramco] Error API real:', err.message);
      // Si falla la API real, retornar vacío con advertencia
      return res.status(200).json({ ok:true, data:{}, source:'error', warning: err.message });
    }
  }

  // ── MODO STUB: API de Aramco no configurada aún ─────────
  // Retorna objeto vacío — el front mostrará $0 en Aramco
  // y usará totalNeto de Konnect como Total Final.
  console.log('[aramco] STUB activo — configurar ARAMCO_API_URL y ARAMCO_API_TOKEN para datos reales');
  return res.status(200).json({
    ok:     true,
    data:   {},   // Sin cargos Aramco por ahora
    source: 'stub',
    note:   'Configurar ARAMCO_API_URL y ARAMCO_API_TOKEN en variables de entorno',
  });
};