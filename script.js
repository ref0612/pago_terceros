/* ══════════════════════════════════════════════════════════════
   PAGO EMPRESARIOS · PULLMAN BUS
   script.js — sin keys en front, proxy seguro
   ══════════════════════════════════════════════════════════════ */

const REPORT_ID = 1532;

const COL = {
  fecha:        0,  hora:        1,  origen:      2,  destino:     3,
  ruta:         4,  servicio:    5,  estado:      6,  bus:         7,
  patente:      8,  totalAsientos: 9,
  rut:         10,  razonSocial: 11,
  asientosSuc: 12,  recaudSuc:   13,
  asientosCam: 14,  recaudCam:   15,
  produccion:  16,  comision:    17,  totalNeto:   18,
};

/* ─── STATE ──────────────────────────────────────────────── */
const state = {
  sessionToken: '',
  days:         3,
  baseDate:     todayStr(),
  empresarios:  [],
  services:     {},
  payments:     {},
  filter:       'all',
  search:       '',
  hideEmpty:    false,
  expanded:     new Set(),
};

/* ─── HELPERS ────────────────────────────────────────────── */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// base=2026-03-19, days=3 → {start:'2026-03-17', end:'2026-03-19'}
function dateRange(baseDate, days) {
  const end   = new Date(baseDate + 'T00:00:00');
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const fmt = d => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

// YYYY-MM-DD → DD/MM/YYYY
function toDisplay(s) { return s.split('-').reverse().join('/'); }

function parseMoney(str) {
  if (typeof str === 'number') return str;
  if (!str || str === '$0') return 0;
  return parseInt(str.replace(/\$/g,'').replace(/\./g,'').replace(/,/g,''), 10) || 0;
}

function formatCLP(n) {
  if (!n) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CL');
}

function initials(first, last) {
  return ((first||'').trim().charAt(0) + (last||'').trim().charAt(0)).toUpperCase() || '?';
}

function svcStateClass(estado) {
  const e = (estado||'').toLowerCase();
  if (e.includes('complet')) return 'svc-completado';
  if (e.includes('recaud'))  return 'svc-recaudado';
  if (e.includes('ruta'))    return 'svc-ruta';
  return 'svc-otro';
}

function toast(msg, ms) {
  ms = ms || 2800;
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, ms);
}

/* ─── SESSION ────────────────────────────────────────────── */
function saveSession(token) {
  state.sessionToken = token;
  sessionStorage.setItem('pb_session', token);
}
function loadSession() {
  var t = sessionStorage.getItem('pb_session');
  if (t) state.sessionToken = t;
  return !!t;
}
function clearSession() {
  state.sessionToken = '';
  sessionStorage.removeItem('pb_session');
}

/* ─── API ────────────────────────────────────────────────── */
async function proxyFetch(konnectPath) {
  var url = '/api/proxy?path=' + encodeURIComponent(konnectPath);
  var res = await fetch(url, {
    headers: {
      'Content-Type':    'application/json',
      'X-Session-Token': state.sessionToken,
    },
  });
  if (res.status === 401) { clearSession(); showLogin(); throw new Error('Sesión expirada.'); }
  if (!res.ok) {
    var err = await res.json().catch(function(){ return {}; });
    throw new Error(err.error || 'HTTP ' + res.status);
  }
  var json = await res.json();
  if (!json.success) throw new Error(json.message || 'API error');
  return json.data;
}

async function fetchAllEmpresas() {
  var page = 1, all = [];
  while (true) {
    var data = await proxyFetch(
      '/api/v2/users?page=' + page + '&items=25&filter_user_type=1&filter_user_type=3&locale=es'
    );
    all = all.concat(data.users || []);
    if (page >= (data.pages || 1)) break;
    page++;
  }
  return all.filter(function(u){ return u.owner_code && u.owner_code.startsWith('ENT-'); });
}

async function fetchAllServices(baseDate, days) {
  var range    = dateRange(baseDate, days);
  var fromDate = encodeURIComponent(toDisplay(range.start)); // DD%2FMM%2FYYYY
  var toDate   = encodeURIComponent(toDisplay(range.end));
  var pageSize = 50;
  var offset   = 0;
  var all      = [];

  while (true) {
    var pageLimit = offset + '-' + (offset + pageSize - 1);
    var path = '/api/v2/reports/render_report/' + REPORT_ID +
      '?page_limit=' + pageLimit +
      '&date_range=' + days +
      '&from_date='  + fromDate +
      '&to_date='    + toDate +
      '&date_wise=1' +
      '&user=&status=&owner_id=&locale=es';

    var data = await proxyFetch(path);
    var rows = data.data_body || [];
    all = all.concat(rows);

    // Menos de pageSize = ultima pagina
    if (rows.length < pageSize) break;
    offset += pageSize;
    // Techo de seguridad: 1000 registros max
    if (offset >= 1000) break;
  }

  return all;
}

/* ─── DOM ────────────────────────────────────────────────── */
var $ = function(id){ return document.getElementById(id); };
function show(id) { $(id).hidden = false; }
function hide(id) { $(id).hidden = true; }

/* ─── LOGIN ──────────────────────────────────────────────── */
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
  var username = $('login-user').value.trim();
  var password = $('login-pass').value;
  if (!username || !password) { showLoginError('Ingresa usuario y contraseña.'); return; }
  setLoginLoading(true);
  hide('login-error');
  try {
    var res  = await fetch('/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: username, password: password }),
    });
    var json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || 'Credenciales incorrectas');
    saveSession(json.token);
    $('login-pass').value = '';
    showApp();
  } catch(err) {
    showLoginError(err.message);
  } finally {
    setLoginLoading(false);
  }
}

function showLoginError(msg) {
  var el = $('login-error');
  el.textContent = msg;
  el.hidden = false;
}

function setLoginLoading(on) {
  $('login-btn').disabled = on;
  $('login-btn-text').textContent = on ? 'Verificando…' : 'Iniciar sesión';
  $('login-spinner').hidden = !on;
}

/* ─── ESTADOS ────────────────────────────────────────────── */
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

/* ─── SUMMARY ────────────────────────────────────────────── */
function computeGlobalSummary() {
  var totalProd = 0, totalCom = 0, totalNeto = 0, totalSvc = 0;
  var empresas  = getFiltered();
  for (var i = 0; i < empresas.length; i++) {
    var rows = state.services[empresas[i].ownerCode] || [];
    for (var j = 0; j < rows.length; j++) {
      totalProd += parseMoney(rows[j][COL.produccion]);
      totalCom  += parseMoney(rows[j][COL.comision]);
      totalNeto += parseMoney(rows[j][COL.totalNeto]);
      totalSvc++;
    }
  }
  $('s-produccion').textContent = formatCLP(totalProd);
  $('s-comision').textContent   = formatCLP(totalCom);
  $('s-neto').textContent       = formatCLP(totalNeto);
  $('s-count').textContent      = empresas.length;
  $('s-services').textContent   = totalSvc;
  var range = dateRange(state.baseDate, state.days);
  $('s-period').textContent = toDisplay(range.start) + ' → ' + toDisplay(range.end);
}

/* ─── FILTRADO ───────────────────────────────────────────── */
function getFiltered() {
  var s = state.search.toLowerCase().trim();
  return state.empresarios.filter(function(emp) {
    if (s) {
      var name = (emp.firstName + ' ' + emp.lastName).toLowerCase();
      var code = (emp.ownerCode || '').toLowerCase();
      var rut  = (emp.rut || '').toLowerCase();
      if (!name.includes(s) && !code.includes(s) && !rut.includes(s)) return false;
    }
    if (state.hideEmpty && !(state.services[emp.ownerCode] || []).length) return false;
    var status = state.payments[emp.ownerCode] || 'pending';
    if (state.filter !== 'all' && status !== state.filter) return false;
    return true;
  });
}

function empStats(emp) {
  var prod = 0, com = 0, neto = 0;
  var rows = state.services[emp.ownerCode] || [];
  for (var i = 0; i < rows.length; i++) {
    prod += parseMoney(rows[i][COL.produccion]);
    com  += parseMoney(rows[i][COL.comision]);
    neto += parseMoney(rows[i][COL.totalNeto]);
  }
  return { rows: rows.length, prod: prod, com: com, neto: neto };
}

/* ─── RENDER CARDS ───────────────────────────────────────── */
function renderCards() {
  var list     = $('empresarios-list');
  var empresas = getFiltered();
  computeGlobalSummary();
  list.innerHTML = '';

  if (!empresas.length) {
    list.innerHTML = '<div class="state-box">' +
      '<div class="state-icon">◎</div>' +
      '<div class="state-title">Sin resultados</div>' +
      '<div class="state-desc">No hay empresarios que coincidan con los filtros activos.</div>' +
      '</div>';
    return;
  }

  empresas.forEach(function(emp, idx) {
    var stats    = empStats(emp);
    var rows     = stats.rows;
    var prod     = stats.prod;
    var com      = stats.com;
    var neto     = stats.neto;
    var status   = state.payments[emp.ownerCode] || 'pending';
    var expanded = state.expanded.has(emp.ownerCode);
    var hasRows  = rows > 0;

    var badgeClass = { pending:'badge-pending', approved:'badge-approved', paid:'badge-paid' }[status];
    var badgeLabel = { pending:'Pendiente',     approved:'Aprobado',       paid:'Pagado'    }[status];
    var depositOk  = status === 'approved';
    var depositTitle = status === 'pending' ? 'Esperando aprobación del cliente' :
                       status === 'paid'    ? 'Ya depositado' : '';

    var card = document.createElement('div');
    card.className = 'emp-card' + (expanded ? ' expanded' : '') + (!hasRows ? ' no-services' : '');
    card.dataset.code = emp.ownerCode;
    card.style.animationDelay = (idx * 30) + 'ms';

    card.innerHTML =
      '<div class="emp-header">' +
        '<div class="emp-avatar">' + initials(emp.firstName, emp.lastName) + '</div>' +
        '<div class="emp-info">' +
          '<div class="emp-name">' + emp.firstName + ' ' + emp.lastName + '</div>' +
          '<div class="emp-meta">' +
            '<span>' + emp.ownerCode + '</span>' +
            '<span>' + (emp.rut || '—') + '</span>' +
            '<span class="' + (hasRows ? 'meta-count-active' : '') + '">' + rows + ' servicio' + (rows !== 1 ? 's' : '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="emp-stats">' +
          '<div class="stat"><div class="stat-label">Producción</div><div class="stat-value amber">' + formatCLP(prod) + '</div></div>' +
          '<div class="stat"><div class="stat-label">Comisión</div><div class="stat-value">' + formatCLP(com) + '</div></div>' +
          '<div class="stat"><div class="stat-label">A Pagar</div><div class="stat-value green">' + formatCLP(neto) + '</div></div>' +
          '<div class="stat"><div class="stat-label">Servicios</div><div class="stat-value count">' + rows + '</div></div>' +
        '</div>' +
        '<div class="emp-status">' +
          '<div class="status-badge ' + badgeClass + '">' + badgeLabel + '</div>' +
          '<button class="btn-deposit" ' + (depositOk ? '' : 'disabled') + ' title="' + depositTitle + '" data-code="' + emp.ownerCode + '">Depositar</button>' +
        '</div>' +
        '<div class="emp-chevron">▼</div>' +
      '</div>' +
      '<div class="emp-services">' + renderMiniTable(emp) + '</div>';

    card.querySelector('.emp-header').addEventListener('click', function(e) {
      if (e.target.closest('.btn-deposit')) return;
      if (state.expanded.has(emp.ownerCode)) {
        state.expanded.delete(emp.ownerCode);
        card.classList.remove('expanded');
      } else {
        state.expanded.add(emp.ownerCode);
        card.classList.add('expanded');
      }
    });

    card.querySelector('.btn-deposit').addEventListener('click', function(e) {
      e.stopPropagation();
      handleDeposit(emp.ownerCode);
    });

    list.appendChild(card);
  });
}

function renderMiniTable(emp) {
  var rows = state.services[emp.ownerCode] || [];
  if (!rows.length) {
    return '<table class="services-mini-table"><tbody>' +
      '<tr><td colspan="10" class="empty-row">Sin servicios en el período seleccionado</td></tr>' +
      '</tbody></table>';
  }

  var tProd = 0, tCom = 0, tNeto = 0;
  var trs = rows.map(function(r) {
    var prod = parseMoney(r[COL.produccion]);
    var com  = parseMoney(r[COL.comision]);
    var neto = parseMoney(r[COL.totalNeto]);
    tProd += prod; tCom += com; tNeto += neto;
    return '<tr>' +
      '<td class="td-mono">'   + r[COL.fecha]    + '</td>' +
      '<td class="td-mono">'   + r[COL.hora]     + '</td>' +
      '<td class="td-route">'  + r[COL.origen]   + ' → ' + r[COL.destino] + '</td>' +
      '<td class="td-service">'+ r[COL.servicio] + '</td>' +
      '<td class="td-mono">'   + r[COL.bus]      + ' · ' + r[COL.patente] + '</td>' +
      '<td><span class="svc-state ' + svcStateClass(r[COL.estado]) + '">' + r[COL.estado] + '</span></td>' +
      '<td class="td-amount num">' + r[COL.asientosSuc] + '</td>' +
      '<td class="td-amount num">' + r[COL.produccion]  + '</td>' +
      '<td class="td-amount num">' + r[COL.comision]    + '</td>' +
      '<td class="td-neto">'       + r[COL.totalNeto]   + '</td>' +
      '</tr>';
  }).join('');

  return '<table class="services-mini-table">' +
    '<thead><tr>' +
      '<th>Fecha</th><th>Hora</th><th>Ruta</th><th>Servicio</th>' +
      '<th>Bus · Patente</th><th>Estado</th>' +
      '<th class="num">Asientos</th><th class="num">Producción</th>' +
      '<th class="num">Comisión</th><th class="num">Total Neto</th>' +
    '</tr></thead>' +
    '<tbody>' + trs +
      '<tr class="subtotal-row">' +
        '<td colspan="7" style="text-align:right;color:var(--text3)">TOTALES</td>' +
        '<td class="td-amount num">' + formatCLP(tProd) + '</td>' +
        '<td class="td-amount num">' + formatCLP(tCom)  + '</td>' +
        '<td class="td-neto">'       + formatCLP(tNeto) + '</td>' +
      '</tr>' +
    '</tbody></table>';
}

/* ─── DEPOSIT ────────────────────────────────────────────── */
function handleDeposit(code) {
  var emp = state.empresarios.find(function(e){ return e.ownerCode === code; });
  var stats = empStats(emp);
  if (!confirm('¿Confirmar depósito a ' + emp.firstName + ' ' + emp.lastName + '?\n\nMonto: ' + formatCLP(stats.neto))) return;
  state.payments[code] = 'paid';
  savePayments();
  renderCards();
  toast('✓ Pago a ' + emp.firstName + ' ' + emp.lastName + ' marcado como depositado');
}

window.approveEmpresario = function(code) {
  if ((state.payments[code] || 'pending') === 'pending') {
    state.payments[code] = 'approved';
    savePayments();
    renderCards();
    toast('✓ ' + code + ' aprobado — Depositar habilitado');
  }
};

/* ─── PERSIST ────────────────────────────────────────────── */
function savePayments() {
  try { localStorage.setItem('pb_payments', JSON.stringify(state.payments)); } catch(e) {}
}
function loadPayments() {
  try {
    var r = localStorage.getItem('pb_payments');
    if (r) state.payments = JSON.parse(r);
  } catch(e) {}
}

/* ─── LOAD DATA ──────────────────────────────────────────── */
async function loadData() {
  state.baseDate = $('base-date').value || todayStr();
  var range = dateRange(state.baseDate, state.days);
  setLoading('Cargando ' + state.days + 'd: ' + toDisplay(range.start) + ' → ' + toDisplay(range.end) + '…');

  try {
    $('loading-msg').textContent = 'Obteniendo empresarios…';
    var rawEmps = await fetchAllEmpresas();
    state.empresarios = rawEmps.map(function(u) {
      return {
        id:        u.id,
        login:     u.login,
        firstName: u.first_name  || '',
        lastName:  u.last_name   || '',
        ownerCode: u.owner_code  || '',
        rut:       u.rut_number  || '',
      };
    });

    $('loading-msg').textContent = 'Cargando servicios ' + toDisplay(range.start) + ' → ' + toDisplay(range.end) + '…';
    var allRows = await fetchAllServices(state.baseDate, state.days);

    state.services = {};
    var nameMap = {};
    state.empresarios.forEach(function(emp) {
      nameMap[(emp.firstName + ' ' + emp.lastName).trim().toLowerCase()] = emp.ownerCode;
    });

    allRows.forEach(function(row) {
      var razon = (row[COL.razonSocial] || '').trim().toLowerCase();
      var code  = nameMap[razon];
      if (!code) {
        var keys = Object.keys(nameMap);
        for (var i = 0; i < keys.length; i++) {
          if (razon.includes(keys[i]) || keys[i].includes(razon)) { code = nameMap[keys[i]]; break; }
        }
      }
      code = code || '__unmatched__';
      if (!state.services[code]) state.services[code] = [];
      state.services[code].push(row);
    });

    setReady();
    renderCards();

    var withSvc = state.empresarios.filter(function(e){ return (state.services[e.ownerCode]||[]).length > 0; }).length;
    toast('✓ ' + allRows.length + ' servicios · ' + withSvc + ' empresarios activos');

  } catch(err) {
    console.error(err);
    setError(err.message);
  }
}

/* ─── EVENTOS ────────────────────────────────────────────── */
$('login-btn').addEventListener('click', doLogin);
['login-user','login-pass'].forEach(function(id) {
  $(id).addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
});

$('btn-logout').addEventListener('click', function() {
  clearSession();
  state.empresarios = [];
  state.services    = {};
  showLogin();
});

$('btn-load').addEventListener('click', loadData);

document.querySelectorAll('.pill').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.pill').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    state.days = parseInt(btn.dataset.days, 10);
  });
});

document.querySelectorAll('.filter-pill').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.filter-pill').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderCards();
  });
});

$('search-input').addEventListener('input', function(e) {
  state.search = e.target.value;
  renderCards();
});

$('hide-empty').addEventListener('change', function(e) {
  state.hideEmpty = e.target.checked;
  renderCards();
});

/* ─── INIT ───────────────────────────────────────────────── */
(function init() {
  loadPayments();
  if (loadSession()) {
    showApp();
  } else {
    showLogin();
  }
}());
