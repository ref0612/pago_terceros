/* ══════════════════════════════════════════
   PAGO EMPRESARIOS · PULLMAN BUS
   script.js — versión segura (sin keys en front)
   ══════════════════════════════════════════ */

// ─── CONFIG ──────────────────────────────────────────────
// Sin ninguna key aquí. Todo va por el proxy del servidor.
const REPORT_ID = 1532;

const COL = {
  fecha:        0,  hora:      1,  origen:    2,  destino:   3,
  ruta:         4,  servicio:  5,  estado:    6,  bus:       7,
  patente:      8,  totalAsientos: 9,
  rut:         10,  razonSocial: 11,
  asientosSuc: 12,  recaudSuc:   13,
  asientosCam: 14,  recaudCam:   15,
  produccion:  16,  comision:    17,  totalNeto: 18,
};

// ─── STATE ───────────────────────────────────────────────
const state = {
  sessionToken: '',          // JWT emitido por /api/auth
  days:         3,
  baseDate:     todayStr(),
  empresarios:  [],
  services:     {},
  payments:     {},
  filter:       'all',
  search:       '',
  expanded:     new Set(),
};

// ─── HELPERS ─────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function parseMoney(str) {
  if (typeof str === 'number') return str;
  if (!str || str === '$0') return 0;
  return parseInt(str.replace(/[$.]/g, '').replace(/\./g, '').replace(',', ''), 10) || 0;
}

function formatCLP(n) {
  if (!n) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CL');
}

function initials(first, last) {
  return ((first || '').trim().charAt(0) + (last || '').trim().charAt(0)).toUpperCase() || '?';
}

function svcStateClass(estado) {
  const e = (estado || '').toLowerCase();
  if (e.includes('complet')) return 'svc-completado';
  if (e.includes('recaud'))  return 'svc-recaudado';
  if (e.includes('ruta'))    return 'svc-ruta';
  return 'svc-otro';
}

function toast(msg, duration = 2800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ─── SESSION ─────────────────────────────────────────────
function saveSession(token) {
  state.sessionToken = token;
  // sessionStorage: se borra al cerrar la pestaña
  sessionStorage.setItem('pb_session', token);
}

function loadSession() {
  const t = sessionStorage.getItem('pb_session');
  if (t) state.sessionToken = t;
  return !!t;
}

function clearSession() {
  state.sessionToken = '';
  sessionStorage.removeItem('pb_session');
}

// ─── API CALLS (todo pasa por /api/proxy) ────────────────
async function proxyFetch(konnectPath) {
  const url = `/api/proxy?path=${encodeURIComponent(konnectPath)}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type':    'application/json',
      'X-Session-Token': state.sessionToken,   // ← JWT de sesión, NO el Bearer de Konnect
    },
  });

  if (res.status === 401) {
    clearSession();
    showLogin();
    throw new Error('Sesión expirada. Por favor inicia sesión nuevamente.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'API error');
  return json.data;
}

async function fetchAllEmpresas() {
  let page = 1, all = [];
  while (true) {
    const data = await proxyFetch(
      `/api/v2/users?page=${page}&items=25&filter_user_type=1&filter_user_type=3&locale=es`
    );
    all = all.concat(data.users || []);
    if (page >= (data.pages || 1)) break;
    page++;
  }
  return all.filter(u => u.owner_code && u.owner_code.startsWith('ENT-'));
}

async function fetchAllServices(days) {
  const data = await proxyFetch(
    `/api/v2/reports/render_report/${REPORT_ID}?page_limit=0-100&date_range=${days}&date_wise=1&user=&status=&owner_id=&locale=es`
  );
  return data.data_body || [];
}

// ─── DOM ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function show(id) { $(id).hidden = false; }
function hide(id) { $(id).hidden = true; }

// ─── LOGIN ───────────────────────────────────────────────
function showLogin() {
  hide('app');
  show('login-screen');
  $('login-user').focus();
}

function showApp() {
  hide('login-screen');
  show('app');
  $('base-date').value = state.baseDate;
  show('state-empty');
}

async function doLogin() {
  const username = $('login-user').value.trim();
  const password = $('login-pass').value;

  if (!username || !password) {
    showLoginError('Ingresa usuario y contraseña.');
    return;
  }

  setLoginLoading(true);
  hide('login-error');

  try {
    const res = await fetch('/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Credenciales incorrectas');
    }

    saveSession(json.token);
    $('login-pass').value = '';
    showApp();

  } catch (err) {
    showLoginError(err.message);
  } finally {
    setLoginLoading(false);
  }
}

function showLoginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.hidden = false;
}

function setLoginLoading(on) {
  $('login-btn').disabled = on;
  $('login-btn-text').textContent = on ? 'Verificando…' : 'Iniciar sesión';
  $('login-spinner').hidden = !on;
}

// ─── STATES ──────────────────────────────────────────────
function setLoading(msg) {
  hide('state-empty'); hide('state-error'); hide('main-content'); hide('summary-bar');
  show('state-loading');
  $('loading-msg').textContent = msg;
}

function setError(msg) {
  hide('state-loading'); hide('main-content');
  show('state-error');
  $('error-msg').textContent = msg;
}

function setReady() {
  hide('state-loading'); hide('state-empty'); hide('state-error');
  show('summary-bar'); show('main-content');
}

// ─── SUMMARY ─────────────────────────────────────────────
function computeGlobalSummary() {
  let totalProd = 0, totalCom = 0, totalNeto = 0, totalSvc = 0;
  for (const rows of Object.values(state.services)) {
    totalSvc += rows.length;
    for (const row of rows) {
      totalProd += parseMoney(row[COL.produccion]);
      totalCom  += parseMoney(row[COL.comision]);
      totalNeto += parseMoney(row[COL.totalNeto]);
    }
  }
  $('s-produccion').textContent = formatCLP(totalProd);
  $('s-comision').textContent   = formatCLP(totalCom);
  $('s-neto').textContent       = formatCLP(totalNeto);
  $('s-count').textContent      = state.empresarios.length;
  $('s-services').textContent   = totalSvc;
}

// ─── CARDS ───────────────────────────────────────────────
function getFiltered() {
  const s = state.search.toLowerCase();
  return state.empresarios.filter(emp => {
    const name = `${emp.firstName} ${emp.lastName}`.toLowerCase();
    if (s && !name.includes(s) && !(emp.ownerCode || '').toLowerCase().includes(s)) return false;
    const status = state.payments[emp.ownerCode] || 'pending';
    if (state.filter !== 'all' && status !== state.filter) return false;
    return true;
  });
}

function empStats(emp) {
  let prod = 0, com = 0, neto = 0;
  for (const r of (state.services[emp.ownerCode] || [])) {
    prod += parseMoney(r[COL.produccion]);
    com  += parseMoney(r[COL.comision]);
    neto += parseMoney(r[COL.totalNeto]);
  }
  return { rows: (state.services[emp.ownerCode] || []).length, prod, com, neto };
}

function renderCards() {
  const list    = $('empresarios-list');
  const empresas = getFiltered();
  list.innerHTML = '';

  if (!empresas.length) {
    list.innerHTML = `<div class="state-box">
      <div class="state-icon">◎</div>
      <div class="state-title">Sin resultados</div>
      <div class="state-desc">No hay empresarios que coincidan con el filtro.</div>
    </div>`;
    return;
  }

  empresas.forEach((emp, idx) => {
    const { rows, prod, com, neto } = empStats(emp);
    const status   = state.payments[emp.ownerCode] || 'pending';
    const expanded = state.expanded.has(emp.ownerCode);

    const badgeClass = { pending:'badge-pending', approved:'badge-approved', paid:'badge-paid' }[status];
    const badgeLabel = { pending:'Pendiente',     approved:'Aprobado',       paid:'Pagado' }[status];
    const depositOk  = status === 'approved';

    const card = document.createElement('div');
    card.className = `emp-card${expanded ? ' expanded' : ''}`;
    card.dataset.code = emp.ownerCode;
    card.style.animationDelay = `${idx * 35}ms`;

    card.innerHTML = `
      <div class="emp-header">
        <div class="emp-avatar">${initials(emp.firstName, emp.lastName)}</div>
        <div class="emp-info">
          <div class="emp-name">${emp.firstName} ${emp.lastName}</div>
          <div class="emp-meta">
            <span>${emp.ownerCode}</span>
            <span>${emp.rut || '—'}</span>
            <span>${rows} servicio${rows !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div class="emp-stats">
          <div class="stat">
            <div class="stat-label">Producción</div>
            <div class="stat-value amber">${formatCLP(prod)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Comisión</div>
            <div class="stat-value">${formatCLP(com)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">A Pagar</div>
            <div class="stat-value green">${formatCLP(neto)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Servicios</div>
            <div class="stat-value count">${rows}</div>
          </div>
        </div>
        <div class="emp-status">
          <div class="status-badge ${badgeClass}">${badgeLabel}</div>
          <button class="btn-deposit" ${depositOk ? '' : 'disabled'}
            title="${status === 'pending' ? 'Esperando aprobación del cliente' : status === 'paid' ? 'Ya depositado' : ''}"
            data-code="${emp.ownerCode}">
            Depositar
          </button>
        </div>
        <div class="emp-chevron">▼</div>
      </div>
      <div class="emp-services">${renderMiniTable(emp)}</div>
    `;

    card.querySelector('.emp-header').addEventListener('click', e => {
      if (e.target.closest('.btn-deposit')) return;
      if (state.expanded.has(emp.ownerCode)) {
        state.expanded.delete(emp.ownerCode);
        card.classList.remove('expanded');
      } else {
        state.expanded.add(emp.ownerCode);
        card.classList.add('expanded');
      }
    });

    card.querySelector('.btn-deposit').addEventListener('click', e => {
      e.stopPropagation();
      handleDeposit(emp.ownerCode);
    });

    list.appendChild(card);
  });
}

function renderMiniTable(emp) {
  const rows = state.services[emp.ownerCode] || [];
  if (!rows.length) return `<table class="services-mini-table"><tbody>
    <tr><td colspan="10" class="empty-row">Sin servicios en el período</td></tr>
  </tbody></table>`;

  let tProd = 0, tCom = 0, tNeto = 0;
  const trs = rows.map(r => {
    const prod = parseMoney(r[COL.produccion]);
    const com  = parseMoney(r[COL.comision]);
    const neto = parseMoney(r[COL.totalNeto]);
    tProd += prod; tCom += com; tNeto += neto;
    return `<tr>
      <td class="td-mono">${r[COL.fecha]}</td>
      <td class="td-mono">${r[COL.hora]}</td>
      <td class="td-route">${r[COL.origen]} → ${r[COL.destino]}</td>
      <td class="td-service">${r[COL.servicio]}</td>
      <td class="td-mono">${r[COL.bus]} · ${r[COL.patente]}</td>
      <td><span class="svc-state ${svcStateClass(r[COL.estado])}">${r[COL.estado]}</span></td>
      <td class="td-amount num">${r[COL.asientosSuc]}</td>
      <td class="td-amount num">${r[COL.produccion]}</td>
      <td class="td-amount num">${r[COL.comision]}</td>
      <td class="td-neto">${r[COL.totalNeto]}</td>
    </tr>`;
  }).join('');

  return `<table class="services-mini-table">
    <thead><tr>
      <th>Fecha</th><th>Hora</th><th>Ruta</th><th>Servicio</th>
      <th>Bus · Patente</th><th>Estado</th>
      <th class="num">Asientos</th><th class="num">Producción</th>
      <th class="num">Comisión</th><th class="num">Total Neto</th>
    </tr></thead>
    <tbody>${trs}
      <tr class="subtotal-row">
        <td colspan="7" style="text-align:right;color:var(--text3)">TOTALES</td>
        <td class="td-amount num">${formatCLP(tProd)}</td>
        <td class="td-amount num">${formatCLP(tCom)}</td>
        <td class="td-neto">${formatCLP(tNeto)}</td>
      </tr>
    </tbody>
  </table>`;
}

// ─── DEPOSIT ─────────────────────────────────────────────
function handleDeposit(code) {
  const emp = state.empresarios.find(e => e.ownerCode === code);
  const { neto } = empStats(emp);
  if (!confirm(`¿Confirmar depósito a ${emp.firstName} ${emp.lastName}?\n\nMonto: ${formatCLP(neto)}`)) return;
  state.payments[code] = 'paid';
  savePayments();
  renderCards();
  computeGlobalSummary();
  toast(`✓ Pago a ${emp.firstName} ${emp.lastName} marcado como depositado`);
}

// ─── APPROVE (expuesto para que el equipo de dev lo conecte a su webhook) ──
window.approveEmpresario = function(code) {
  if ((state.payments[code] || 'pending') === 'pending') {
    state.payments[code] = 'approved';
    savePayments();
    renderCards();
    computeGlobalSummary();
    toast(`✓ ${code} aprobado — Depositar habilitado`);
  }
};

// ─── PERSIST PAYMENTS ────────────────────────────────────
function savePayments() {
  try { localStorage.setItem('pb_payments', JSON.stringify(state.payments)); } catch {}
}
function loadPayments() {
  try { const r = localStorage.getItem('pb_payments'); if (r) state.payments = JSON.parse(r); } catch {}
}

// ─── LOAD DATA ───────────────────────────────────────────
async function loadData() {
  state.baseDate = $('base-date').value || todayStr();
  setLoading('Obteniendo empresarios…');

  try {
    const rawEmps = await fetchAllEmpresas();
    state.empresarios = rawEmps.map(u => ({
      id: u.id, login: u.login,
      firstName: u.first_name || '', lastName: u.last_name || '',
      ownerCode: u.owner_code || '', rut: u.rut_number || '',
    }));

    $('loading-msg').textContent = `Cargando servicios (${state.days}d)…`;
    const allRows = await fetchAllServices(state.days);

    // Agrupar por Razón Social → ownerCode
    state.services = {};
    const nameMap = {};
    for (const emp of state.empresarios) {
      nameMap[`${emp.firstName} ${emp.lastName}`.trim().toLowerCase()] = emp.ownerCode;
    }

    for (const row of allRows) {
      const razon = (row[COL.razonSocial] || '').trim().toLowerCase();
      let code = nameMap[razon];
      if (!code) {
        for (const [name, c] of Object.entries(nameMap)) {
          if (razon.includes(name) || name.includes(razon)) { code = c; break; }
        }
      }
      code = code || '__unmatched__';
      if (!state.services[code]) state.services[code] = [];
      state.services[code].push(row);
    }

    setReady();
    computeGlobalSummary();
    renderCards();

  } catch (err) {
    console.error(err);
    setError(err.message);
  }
}

// ─── EVENTS ──────────────────────────────────────────────
// Login
$('login-btn').addEventListener('click', doLogin);
['login-user', 'login-pass'].forEach(id =>
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); })
);

// Logout
$('btn-logout').addEventListener('click', () => {
  clearSession();
  state.empresarios = []; state.services = {};
  showLogin();
});

// Controls
$('btn-load').addEventListener('click', loadData);

document.querySelectorAll('.pill').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.days = parseInt(btn.dataset.days, 10);
  })
);

document.querySelectorAll('.filter-pill').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderCards();
  })
);

$('search-input').addEventListener('input', e => {
  state.search = e.target.value;
  renderCards();
});

// ─── INIT ────────────────────────────────────────────────
(function init() {
  loadPayments();
  if (loadSession()) {
    showApp();
  } else {
    showLogin();
  }
})();