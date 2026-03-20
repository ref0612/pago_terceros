/* ══════════════════════════════════════════
   PAGO EMPRESARIOS · PULLMAN BUS
   script.js
   ══════════════════════════════════════════ */

// ─── CONFIG ──────────────────────────────────────────────
const API_BASE   = 'https://api-pullman.konnectpro.cl';
const API_KEY    = 'QHH79qF2fsWEx98pvNeZpQ';
const REPORT_ID  = 1532;

// Índices de columna en data_body del reporte
const COL = {
  fecha:        0,
  hora:         1,
  origen:       2,
  destino:      3,
  ruta:         4,
  servicio:     5,
  estado:       6,
  bus:          7,
  patente:      8,
  totalAsientos:9,
  rut:          10,
  razonSocial:  11,
  asientosSuc:  12,
  recaudSuc:    13,
  asientosCam:  14,
  recaudCam:    15,
  produccion:   16,
  comision:     17,
  totalNeto:    18,
};

// ─── STATE ───────────────────────────────────────────────
const state = {
  token:      '',
  days:       3,
  baseDate:   today(),
  empresarios: [],  // { id, login, firstName, lastName, ownerCode, rut }
  services:   {},   // ownerCode → [row, ...]
  payments:   {},   // ownerCode → 'pending' | 'approved' | 'paid'
  filter:     'all',
  search:     '',
  expanded:   new Set(),
};

// ─── HELPERS ─────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

function subtractDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - n + 1);
  return d.toISOString().slice(0, 10);
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
  const f = (first || '').trim().charAt(0).toUpperCase();
  const l = (last  || '').trim().charAt(0).toUpperCase();
  return (f + l) || '?';
}

function svcStateClass(estado) {
  const e = (estado || '').toLowerCase();
  if (e.includes('complet')) return 'svc-completado';
  if (e.includes('recaud'))  return 'svc-recaudado';
  if (e.includes('ruta'))    return 'svc-ruta';
  return 'svc-otro';
}

function dateRangeParam(baseDate, days) {
  // API recibe date_range=N donde N = days-ago offset (6 means "last 6 items" style)
  // Pero también acepta date_wise=1 y filtra by fecha
  // Calculamos start_date y end_date y enviamos como date_range flexible
  // En la API observada usan date_range=6 → usamos days directamente
  return days;
}

function toast(msg, duration = 2500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ─── API ─────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const url = API_BASE + path;
  const headers = {
    'accept':          'application/json',
    'accept-language': 'es-ES,es;q=0.9',
    'authorization':   `Bearer ${state.token}`,
    'cache-control':   'no-store',
    'category_type':   '1',
    'x-api-key':       API_KEY,
    'origin':          'https://pullman.konnectpro.cl',
    'referer':         'https://pullman.konnectpro.cl/',
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'API error');
  return json.data;
}

async function fetchAllEmpresas() {
  // Paginamos hasta obtener todos (page size 25)
  let page = 1;
  let all  = [];
  while (true) {
    const data = await apiFetch(
      `/api/v2/users?page=${page}&items=25&filter_user_type=1&filter_user_type=3&locale=es`
    );
    const users = data.users || [];
    all = all.concat(users);
    if (page >= (data.pages || 1)) break;
    page++;
  }
  // Filtrar solo los que tienen owner_code (son empresarios)
  return all.filter(u => u.owner_code && u.owner_code.startsWith('ENT-'));
}

async function fetchServicesForOwner(ownerCode, days, baseDate) {
  const pageRange = `0-100`;
  const path = `/api/v2/reports/render_report/${REPORT_ID}` +
    `?page_limit=${pageRange}&date_range=${days}&date_wise=1` +
    `&user=&status=&owner_id=&locale=es`;

  // El API no filtra por empresario directamente en este endpoint,
  // filtramos por razonSocial después (col 11 = Razon Social)
  const data = await apiFetch(path);
  return data.data_body || [];
}

// ─── DOM HELPERS ─────────────────────────────────────────
const $ = id => document.getElementById(id);

function show(id)  { $(id).hidden = false; }
function hide(id)  { $(id).hidden = true; }

function setLoading(msg) {
  hide('state-empty');
  hide('state-error');
  hide('main-content');
  hide('summary-bar');
  show('state-loading');
  $('loading-msg').textContent = msg;
}

function setError(msg) {
  hide('state-loading');
  hide('main-content');
  show('state-error');
  $('error-msg').textContent = msg;
}

function setReady() {
  hide('state-loading');
  hide('state-empty');
  hide('state-error');
  show('summary-bar');
  show('main-content');
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

// ─── CARDS RENDER ────────────────────────────────────────
function getFilteredEmpresas() {
  const search  = state.search.toLowerCase();
  const filter  = state.filter;

  return state.empresarios.filter(emp => {
    const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase();
    const code     = (emp.ownerCode || '').toLowerCase();
    if (search && !fullName.includes(search) && !code.includes(search)) return false;

    const status = state.payments[emp.ownerCode] || 'pending';
    if (filter === 'pending'  && status !== 'pending')  return false;
    if (filter === 'approved' && status !== 'approved') return false;
    if (filter === 'paid'     && status !== 'paid')     return false;
    return true;
  });
}

function empStats(emp) {
  const rows = state.services[emp.ownerCode] || [];
  let prod = 0, com = 0, neto = 0;
  for (const r of rows) {
    prod += parseMoney(r[COL.produccion]);
    com  += parseMoney(r[COL.comision]);
    neto += parseMoney(r[COL.totalNeto]);
  }
  return { rows: rows.length, prod, com, neto };
}

function renderCards() {
  const list      = $('empresarios-list');
  const empresas  = getFilteredEmpresas();

  list.innerHTML = '';

  if (empresas.length === 0) {
    list.innerHTML = `<div class="state-box">
      <div class="state-icon">◎</div>
      <div class="state-title">Sin resultados</div>
      <div class="state-desc">No hay empresarios que coincidan con el filtro.</div>
    </div>`;
    return;
  }

  empresas.forEach((emp, idx) => {
    const { rows, prod, com, neto } = empStats(emp);
    const status    = state.payments[emp.ownerCode] || 'pending';
    const expanded  = state.expanded.has(emp.ownerCode);

    const card = document.createElement('div');
    card.className = `emp-card${expanded ? ' expanded' : ''}`;
    card.dataset.code = emp.ownerCode;
    card.style.animationDelay = `${idx * 40}ms`;

    const badgeClass = { pending: 'badge-pending', approved: 'badge-approved', paid: 'badge-paid' }[status];
    const badgeLabel = { pending: 'Pendiente', approved: 'Aprobado', paid: 'Pagado' }[status];

    const depositDisabled = status !== 'approved' ? 'disabled' : '';
    const depositTitle = status === 'pending'
      ? 'Esperando aprobación del cliente'
      : status === 'paid'
      ? 'Ya fue depositado'
      : '';

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
          <button class="btn-deposit" ${depositDisabled} title="${depositTitle}"
            data-code="${emp.ownerCode}">
            Depositar
          </button>
        </div>
        <div class="emp-chevron">▼</div>
      </div>
      <div class="emp-services">
        ${renderMiniTable(emp)}
      </div>
    `;

    // Toggle expand
    card.querySelector('.emp-header').addEventListener('click', e => {
      if (e.target.closest('.btn-deposit')) return;
      toggleExpand(emp.ownerCode, card);
    });

    // Deposit button
    card.querySelector('.btn-deposit').addEventListener('click', e => {
      e.stopPropagation();
      handleDeposit(emp.ownerCode);
    });

    list.appendChild(card);
  });
}

function renderMiniTable(emp) {
  const rows = state.services[emp.ownerCode] || [];

  if (rows.length === 0) {
    return `<table class="services-mini-table"><tbody>
      <tr><td colspan="8" class="empty-row">Sin servicios en el período</td></tr>
    </tbody></table>`;
  }

  let totalProd = 0, totalCom = 0, totalNeto = 0;
  const trs = rows.map(r => {
    const prod  = parseMoney(r[COL.produccion]);
    const com   = parseMoney(r[COL.comision]);
    const neto  = parseMoney(r[COL.totalNeto]);
    totalProd += prod;
    totalCom  += com;
    totalNeto += neto;

    const stateClass = svcStateClass(r[COL.estado]);
    return `<tr>
      <td class="td-mono">${r[COL.fecha]}</td>
      <td class="td-mono">${r[COL.hora]}</td>
      <td class="td-route">${r[COL.origen]} → ${r[COL.destino]}</td>
      <td class="td-service">${r[COL.servicio]}</td>
      <td class="td-mono">${r[COL.bus]} · ${r[COL.patente]}</td>
      <td><span class="svc-state ${stateClass}">${r[COL.estado]}</span></td>
      <td class="td-amount num">${r[COL.asientosSuc]}</td>
      <td class="td-amount num">${r[COL.produccion]}</td>
      <td class="td-amount num">${r[COL.comision]}</td>
      <td class="td-neto">${r[COL.totalNeto]}</td>
    </tr>`;
  }).join('');

  return `<table class="services-mini-table">
    <thead>
      <tr>
        <th>Fecha</th><th>Hora</th><th>Ruta</th><th>Servicio</th>
        <th>Bus · Patente</th><th>Estado</th>
        <th class="num">Asientos</th><th class="num">Producción</th>
        <th class="num">Comisión</th><th class="num">Total Neto</th>
      </tr>
    </thead>
    <tbody>
      ${trs}
      <tr class="subtotal-row">
        <td colspan="7" style="text-align:right;color:var(--text3)">TOTALES</td>
        <td class="td-amount num">${formatCLP(totalProd)}</td>
        <td class="td-amount num">${formatCLP(totalCom)}</td>
        <td class="td-neto">${formatCLP(totalNeto)}</td>
      </tr>
    </tbody>
  </table>`;
}

function toggleExpand(code, card) {
  if (state.expanded.has(code)) {
    state.expanded.delete(code);
    card.classList.remove('expanded');
  } else {
    state.expanded.add(code);
    card.classList.add('expanded');
  }
}

// ─── DEPOSIT ─────────────────────────────────────────────
function handleDeposit(code) {
  const emp    = state.empresarios.find(e => e.ownerCode === code);
  const { neto } = empStats(emp);
  const name   = `${emp.firstName} ${emp.lastName}`;
  const ok     = confirm(
    `¿Confirmar depósito a ${name}?\n\nMonto: ${formatCLP(neto)}\n\nEsta acción marcará el pago como realizado.`
  );
  if (!ok) return;
  state.payments[code] = 'paid';
  savePayments();
  renderCards();
  computeGlobalSummary();
  toast(`✓ Pago a ${name} marcado como depositado`);
}

// ─── APPROVE (simulate client approval) ──────────────────
// En producción esto vendría de la API del cliente.
// Aquí exponemos un método de simulación via consola: window.approveEmpresario('ENT-03041')
window.approveEmpresario = function(code) {
  if (!state.payments[code] || state.payments[code] === 'pending') {
    state.payments[code] = 'approved';
    savePayments();
    renderCards();
    computeGlobalSummary();
    toast(`✓ Empresario ${code} aprobado — botón Depositar habilitado`);
  }
};

// ─── PERSIST PAYMENTS ────────────────────────────────────
function savePayments() {
  try { localStorage.setItem('pb_payments', JSON.stringify(state.payments)); } catch {}
}

function loadPayments() {
  try {
    const raw = localStorage.getItem('pb_payments');
    if (raw) state.payments = JSON.parse(raw);
  } catch {}
}

// ─── LOAD DATA ───────────────────────────────────────────
async function loadData() {
  state.token    = $('api-token').value.trim();
  state.baseDate = $('base-date').value || today();

  if (!state.token) {
    toast('⚠ Ingrese el token de autorización');
    return;
  }

  setLoading('Obteniendo empresarios…');

  try {
    // 1. Traer todos los empresarios
    const rawEmps = await fetchAllEmpresas();
    state.empresarios = rawEmps.map(u => ({
      id:         u.id,
      login:      u.login,
      firstName:  u.first_name  || '',
      lastName:   u.last_name   || '',
      ownerCode:  u.owner_code  || '',
      rut:        u.rut_number  || '',
    }));

    $('loading-msg').textContent = `Cargando servicios del período (${state.days}d)…`;

    // 2. Traer todos los servicios del período (1 sola llamada, sin filtro por owner)
    const allRows = await fetchServicesForOwner(null, state.days, state.baseDate);

    // 3. Agrupar servicios por Razon Social (col 11)
    //    Los empresarios en la respuesta vienen con first_name + last_name
    //    El reporte tiene col 11 = Razon Social (e.g. "Marcelo Andres Calbucura Alvarado")
    state.services = {};

    // Crear mapa razonSocial → ownerCode
    const nameToCode = {};
    for (const emp of state.empresarios) {
      const fullName = `${emp.firstName} ${emp.lastName}`.trim().toLowerCase();
      nameToCode[fullName] = emp.ownerCode;
    }

    for (const row of allRows) {
      const razon = (row[COL.razonSocial] || '').trim().toLowerCase();
      // buscar coincidencia exacta o parcial
      let code = nameToCode[razon];
      if (!code) {
        // búsqueda parcial
        for (const [name, c] of Object.entries(nameToCode)) {
          if (razon.includes(name) || name.includes(razon)) { code = c; break; }
        }
      }
      if (!code) code = '__unmatched__';
      if (!state.services[code]) state.services[code] = [];
      state.services[code].push(row);
    }

    setReady();
    computeGlobalSummary();
    renderCards();

  } catch (err) {
    console.error(err);
    setError(err.message || 'Error desconocido al cargar datos');
  }
}

// ─── EVENTS ──────────────────────────────────────────────
$('btn-load').addEventListener('click', loadData);

// Period pills
document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.days = parseInt(btn.dataset.days, 10);
  });
});

// Filter pills
document.querySelectorAll('.filter-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderCards();
  });
});

// Search
$('search-input').addEventListener('input', e => {
  state.search = e.target.value;
  renderCards();
});

// Modal close
$('modal-close').addEventListener('click', () => { $('modal-overlay').hidden = true; });
$('modal-overlay').addEventListener('click', e => {
  if (e.target === $('modal-overlay')) $('modal-overlay').hidden = true;
});

// Keyboard ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $('modal-overlay').hidden = true;
});

// Enter en token input
$('api-token').addEventListener('keydown', e => {
  if (e.key === 'Enter') loadData();
});

// ─── INIT ────────────────────────────────────────────────
(function init() {
  // Set today as default
  $('base-date').value = today();
  loadPayments();

  // Restaurar token desde sessionStorage (por comodidad)
  const saved = sessionStorage.getItem('pb_token');
  if (saved) $('api-token').value = saved;

  // Guardar token al cambiar
  $('api-token').addEventListener('change', () => {
    sessionStorage.setItem('pb_token', $('api-token').value);
  });

  show('state-empty');
})();