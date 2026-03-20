/* ══════════════════════════════════════════════════════════════
   PAGO EMPRESARIOS · PULLMAN BUS
   Roles: supervisor (aprueba) | contable (deposita)
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
  role:         '',       // 'supervisor' | 'contable'
  username:     '',
  dateFrom:     todayStr(),
  dateTo:       todayStr(),
  empresarios:  [],
  services:     {},
  approvals:    {},       // { 'ENT-XXXXX': { status, by, at } }
  payments:     {},       // localStorage: { 'ENT-XXXXX': 'paid' }
  filter:       'all',
  search:       '',
  hideEmpty:    false,
  expanded:     new Set(),
};

/* ─── HELPERS ────────────────────────────────────────────── */
function todayStr() {
  return new Date().toISOString().slice(0,10);
}

function toDisplay(s) {
  return s.split('-').reverse().join('/');
}

function parseMoney(str) {
  if (typeof str === 'number') return str;
  if (!str || str === '$0') return 0;
  return parseInt(str.replace(/\$/g,'').replace(/\./g,'').replace(/,/g,''),10)||0;
}

function formatCLP(n) {
  if (!n) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CL');
}

function initials(first, last) {
  return ((first||'').trim().charAt(0)+(last||'').trim().charAt(0)).toUpperCase()||'?';
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

function toastError(msg) {
  var el = document.createElement('div');
  el.className = 'toast toast-error';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, 4000);
}

/* ─── SESSION ────────────────────────────────────────────── */
function saveSession(token, role, username) {
  state.sessionToken = token;
  state.role         = role;
  state.username     = username;
  sessionStorage.setItem('pb_session',  token);
  sessionStorage.setItem('pb_role',     role);
  sessionStorage.setItem('pb_username', username);
}

function loadSession() {
  var t = sessionStorage.getItem('pb_session');
  var r = sessionStorage.getItem('pb_role');
  var u = sessionStorage.getItem('pb_username');
  if (t && r) {
    state.sessionToken = t;
    state.role         = r;
    state.username     = u || '';
    return true;
  }
  return false;
}

function clearSession() {
  state.sessionToken = '';
  state.role         = '';
  state.username     = '';
  sessionStorage.removeItem('pb_session');
  sessionStorage.removeItem('pb_role');
  sessionStorage.removeItem('pb_username');
}

/* ─── API ────────────────────────────────────────────────── */
async function proxyFetch(konnectPath) {
  var url = '/api/proxy?path=' + encodeURIComponent(konnectPath);
  var res = await fetch(url, {
    headers: { 'Content-Type':'application/json', 'X-Session-Token': state.sessionToken },
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

async function apiFetch(path, opts) {
  opts = opts || {};
  var res = await fetch(path, Object.assign({
    headers: Object.assign({
      'Content-Type':    'application/json',
      'X-Session-Token': state.sessionToken,
    }, opts.headers || {}),
  }, opts));
  if (res.status === 401) { clearSession(); showLogin(); throw new Error('Sesión expirada.'); }
  var json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error');
  return json;
}

async function fetchAllEmpresas() {
  var page = 1, all = [];
  while (true) {
    var data = await proxyFetch(
      '/api/v2/users?page='+page+'&items=25&filter_user_type=1&filter_user_type=3&locale=es'
    );
    all = all.concat(data.users||[]);
    if (page >= (data.pages||1)) break;
    page++;
  }
  return all.filter(function(u){ return u.owner_code && u.owner_code.startsWith('ENT-'); });
}

async function fetchAllServices(dateFrom, dateTo) {
  var fromDate = toDisplay(dateFrom);
  var toDate   = toDisplay(dateTo);

  var path = '/api/v2/reports/render_report/' + REPORT_ID +
    '?page_limit=0-500&date_range=4' +
    '&from_date=' + fromDate +
    '&to_date='   + toDate +
    '&date_wise=1&user=&status=&owner_id=&locale=es';

  var data = await proxyFetch(path);
  var rows = data.data_body || [];

  var total = data.total_records_count || data.total_count || rows.length;
  if (total > 500) {
    var offset = 500;
    while (rows.length < total) {
      var more = await proxyFetch(
        '/api/v2/reports/render_report/' + REPORT_ID +
        '?page_limit=' + offset + '-' + (offset+499) + '&date_range=4' +
        '&from_date=' + fromDate + '&to_date=' + toDate +
        '&date_wise=1&user=&status=&owner_id=&locale=es'
      );
      var moreRows = more.data_body || [];
      if (!moreRows.length) break;
      rows = rows.concat(moreRows);
      offset += 500;
      if (offset >= 5000) break;
    }
  }

  // Filtro de seguridad: solo fechas dentro del rango
  var fromTs = new Date(dateFrom+'T00:00:00').getTime();
  var toTs   = new Date(dateTo  +'T23:59:59').getTime();
  rows = rows.filter(function(r) {
    var p = (r[0]||'').split('/');
    if (p.length !== 3) return true;
    var ts = new Date(p[2]+'-'+p[1]+'-'+p[0]+'T12:00:00').getTime();
    return ts >= fromTs && ts <= toTs;
  });

  return rows;
}

async function fetchApprovals() {
  try {
    var json = await apiFetch('/api/approvals');
    state.approvals = json.approvals || {};
  } catch(e) {
    console.warn('No se pudieron cargar aprobaciones:', e.message);
    state.approvals = {};
  }
}

async function postApproval(code, action) {
  return apiFetch('/api/approvals', {
    method: 'POST',
    body:   JSON.stringify({ code: code, action: action }),
  });
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
  $('date-from').value = state.dateFrom;
  $('date-to').value   = state.dateTo;

  // Mostrar nombre y rol en header
  $('header-username').textContent = state.username;
  $('header-role').textContent     = state.role === 'supervisor' ? 'Supervisor' : 'Contable';
  $('header-role').className       = 'header-role-badge ' + (state.role === 'supervisor' ? 'role-supervisor' : 'role-contable');

  // Resetear DOM a estado limpio — evita que datos del render anterior persistan
  resetAppState();
}

function resetAppState() {
  hide('summary-bar');
  hide('main-content');
  hide('state-loading');
  hide('state-error');
  show('state-empty');

  // Limpiar resumen
  $('s-produccion').textContent = '$0';
  $('s-comision').textContent   = '$0';
  $('s-neto').textContent       = '$0';
  $('s-count').textContent      = '0';
  $('s-services').textContent   = '0';
  $('s-period').textContent     = '—';

  // Limpiar lista de cards
  $('empresarios-list').innerHTML = '';
}

async function doLogin() {
  var username = $('login-user').value.trim();
  var password = $('login-pass').value;
  if (!username || !password) { showLoginError('Ingresa usuario y contraseña.'); return; }
  setLoginLoading(true);
  hide('login-error');
  try {
    var res  = await fetch('/api/auth', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username:username, password:password }),
    });
    var json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error||'Credenciales incorrectas');
    saveSession(json.token, json.role, username);
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
    var rows = state.services[empresas[i].ownerCode]||[];
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
  $('s-period').textContent     = toDisplay(state.dateFrom) + ' → ' + toDisplay(state.dateTo);
}

/* ─── ESTADO PAGO ────────────────────────────────────────── */
// Estado final = approval (del servidor) + paid (localStorage)
function getPaymentStatus(code) {
  if (state.payments[code] === 'paid') return 'paid';
  var ap = state.approvals[code];
  if (ap) return ap.status; // 'approved' | 'rejected' | 'pending'
  return 'pending';
}

/* ─── FILTRADO ───────────────────────────────────────────── */
function getFiltered() {
  var s = state.search.toLowerCase().trim();
  return state.empresarios.filter(function(emp) {
    if (s) {
      var name = (emp.firstName+' '+emp.lastName).toLowerCase();
      var code = (emp.ownerCode||'').toLowerCase();
      var rut  = (emp.rut||'').toLowerCase();
      if (!name.includes(s) && !code.includes(s) && !rut.includes(s)) return false;
    }
    if (state.hideEmpty && !(state.services[emp.ownerCode]||[]).length) return false;
    var status = getPaymentStatus(emp.ownerCode);
    if (state.filter !== 'all' && status !== state.filter) return false;
    return true;
  });
}

function empStats(emp) {
  var prod=0, com=0, neto=0;
  var rows = state.services[emp.ownerCode]||[];
  for (var i=0;i<rows.length;i++) {
    prod += parseMoney(rows[i][COL.produccion]);
    com  += parseMoney(rows[i][COL.comision]);
    neto += parseMoney(rows[i][COL.totalNeto]);
  }
  return { rows:rows.length, prod:prod, com:com, neto:neto };
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
    var stats   = empStats(emp);
    var status  = getPaymentStatus(emp.ownerCode);
    var ap      = state.approvals[emp.ownerCode];
    var hasRows = stats.rows > 0;
    var expanded = state.expanded.has(emp.ownerCode);

    var badgeClass = {
      pending:'badge-pending', approved:'badge-approved',
      rejected:'badge-rejected', paid:'badge-paid'
    }[status] || 'badge-pending';
    var badgeLabel = {
      pending:'Pendiente', approved:'Aprobado',
      rejected:'Rechazado', paid:'Pagado'
    }[status] || 'Pendiente';

    var card = document.createElement('div');
    card.className = 'emp-card'+(expanded?' expanded':'')+(!hasRows?' no-services':'');
    card.dataset.code = emp.ownerCode;
    card.style.animationDelay = (idx*30)+'ms';

    // Construir acciones según rol
    var actionsHtml = '';

    if (state.role === 'supervisor') {
      // SUPERVISOR: puede aprobar o rechazar (si no está pagado)
      if (status === 'paid') {
        actionsHtml = '<div class="action-paid">✓ Pagado</div>';
      } else if (status === 'approved') {
        actionsHtml =
          '<div class="approval-info">Aprobado por ' + (ap && ap.by ? ap.by : '—') + '</div>' +
          '<button class="btn-reject" data-code="'+emp.ownerCode+'">Rechazar</button>';
      } else if (status === 'rejected') {
        actionsHtml =
          '<div class="rejection-info">Rechazado</div>' +
          '<button class="btn-approve" data-code="'+emp.ownerCode+'">Aprobar</button>';
      } else {
        // pending
        actionsHtml =
          '<button class="btn-approve" data-code="'+emp.ownerCode+'">✓ Aprobar</button>' +
          '<button class="btn-reject"  data-code="'+emp.ownerCode+'">✕ Rechazar</button>';
      }
    } else {
      // CONTABLE: solo puede depositar si está aprobado
      var depositOk   = status === 'approved';
      var depositTitle = status === 'pending'  ? 'Esperando aprobación del supervisor'
                       : status === 'rejected' ? 'Rechazado por el supervisor'
                       : status === 'paid'     ? 'Ya depositado' : '';
      actionsHtml = '<button class="btn-deposit" '+(depositOk?'':'disabled')+
        ' title="'+depositTitle+'" data-code="'+emp.ownerCode+'">Depositar</button>';
      if (status === 'approved' && ap && ap.by) {
        actionsHtml += '<div class="approval-info">Aprobado por ' + ap.by + '</div>';
      }
    }

    card.innerHTML =
      '<div class="emp-header">' +
        '<div class="emp-avatar">'+initials(emp.firstName,emp.lastName)+'</div>' +
        '<div class="emp-info">' +
          '<div class="emp-name">'+emp.firstName+' '+emp.lastName+'</div>' +
          '<div class="emp-meta">' +
            '<span>'+emp.ownerCode+'</span>' +
            '<span>'+(emp.rut||'—')+'</span>' +
            '<span class="'+(hasRows?'meta-count-active':'')+'">'+stats.rows+' servicio'+(stats.rows!==1?'s':'')+'</span>' +
          '</div>' +
        '</div>' +
        '<div class="emp-stats">' +
          '<div class="stat"><div class="stat-label">Producción</div><div class="stat-value amber">'+formatCLP(stats.prod)+'</div></div>' +
          '<div class="stat"><div class="stat-label">Comisión</div><div class="stat-value">'+formatCLP(stats.com)+'</div></div>' +
          '<div class="stat"><div class="stat-label">A Pagar</div><div class="stat-value green">'+formatCLP(stats.neto)+'</div></div>' +
          '<div class="stat"><div class="stat-label">Servicios</div><div class="stat-value count">'+stats.rows+'</div></div>' +
        '</div>' +
        '<div class="emp-status">' +
          '<div class="status-badge '+badgeClass+'">'+badgeLabel+'</div>' +
          '<div class="emp-actions">'+actionsHtml+'</div>' +
        '</div>' +
        '<div class="emp-chevron">▼</div>' +
      '</div>' +
      '<div class="emp-services">'+renderMiniTable(emp)+'</div>';

    // Toggle expand
    card.querySelector('.emp-header').addEventListener('click', function(e) {
      if (e.target.closest('.btn-approve,.btn-reject,.btn-deposit')) return;
      if (state.expanded.has(emp.ownerCode)) {
        state.expanded.delete(emp.ownerCode);
        card.classList.remove('expanded');
      } else {
        state.expanded.add(emp.ownerCode);
        card.classList.add('expanded');
      }
    });

    // Botón aprobar (supervisor)
    var btnApprove = card.querySelector('.btn-approve');
    if (btnApprove) {
      btnApprove.addEventListener('click', function(e) {
        e.stopPropagation();
        handleApprove(emp.ownerCode);
      });
    }

    // Botón rechazar (supervisor)
    var btnReject = card.querySelector('.btn-reject');
    if (btnReject) {
      btnReject.addEventListener('click', function(e) {
        e.stopPropagation();
        handleReject(emp.ownerCode);
      });
    }

    // Botón depositar (contable)
    var btnDeposit = card.querySelector('.btn-deposit');
    if (btnDeposit) {
      btnDeposit.addEventListener('click', function(e) {
        e.stopPropagation();
        handleDeposit(emp.ownerCode);
      });
    }

    list.appendChild(card);
  });
}

function renderMiniTable(emp) {
  var rows = state.services[emp.ownerCode]||[];
  if (!rows.length) return '<table class="services-mini-table"><tbody>' +
    '<tr><td colspan="10" class="empty-row">Sin servicios en el período seleccionado</td></tr>' +
    '</tbody></table>';

  var tProd=0, tCom=0, tNeto=0;
  var trs = rows.map(function(r) {
    var prod=parseMoney(r[COL.produccion]);
    var com =parseMoney(r[COL.comision]);
    var neto=parseMoney(r[COL.totalNeto]);
    tProd+=prod; tCom+=com; tNeto+=neto;
    return '<tr>' +
      '<td class="td-mono">'+r[COL.fecha]+'</td>' +
      '<td class="td-mono">'+r[COL.hora]+'</td>' +
      '<td class="td-route">'+r[COL.origen]+' → '+r[COL.destino]+'</td>' +
      '<td class="td-service">'+r[COL.servicio]+'</td>' +
      '<td class="td-mono">'+r[COL.bus]+' · '+r[COL.patente]+'</td>' +
      '<td><span class="svc-state '+svcStateClass(r[COL.estado])+'">'+r[COL.estado]+'</span></td>' +
      '<td class="td-amount num">'+r[COL.asientosSuc]+'</td>' +
      '<td class="td-amount num">'+r[COL.produccion]+'</td>' +
      '<td class="td-amount num">'+r[COL.comision]+'</td>' +
      '<td class="td-neto">'+r[COL.totalNeto]+'</td>' +
      '</tr>';
  }).join('');

  return '<table class="services-mini-table">' +
    '<thead><tr>' +
      '<th>Fecha</th><th>Hora</th><th>Ruta</th><th>Servicio</th>' +
      '<th>Bus · Patente</th><th>Estado</th>' +
      '<th class="num">Asientos</th><th class="num">Producción</th>' +
      '<th class="num">Comisión</th><th class="num">Total Neto</th>' +
    '</tr></thead>' +
    '<tbody>'+trs+
      '<tr class="subtotal-row">' +
        '<td colspan="7" style="text-align:right;color:var(--text3)">TOTALES</td>' +
        '<td class="td-amount num">'+formatCLP(tProd)+'</td>' +
        '<td class="td-amount num">'+formatCLP(tCom)+'</td>' +
        '<td class="td-neto">'+formatCLP(tNeto)+'</td>' +
      '</tr>' +
    '</tbody></table>';
}

/* ─── ACCIONES ───────────────────────────────────────────── */
async function handleApprove(code) {
  var emp  = state.empresarios.find(function(e){ return e.ownerCode===code; });
  var name = emp.firstName+' '+emp.lastName;
  var stats = empStats(emp);
  if (!confirm('¿Aprobar pago a '+name+'?\n\nMonto a pagar: '+formatCLP(stats.neto))) return;
  try {
    await postApproval(code, 'approved');
    state.approvals[code] = { status:'approved', by: state.username, at: new Date().toISOString() };
    renderCards();
    toast('✓ Pago de '+name+' aprobado');
  } catch(err) {
    toastError('Error al aprobar: '+err.message);
  }
}

async function handleReject(code) {
  var emp  = state.empresarios.find(function(e){ return e.ownerCode===code; });
  var name = emp.firstName+' '+emp.lastName;
  if (!confirm('¿Rechazar pago a '+name+'?')) return;
  try {
    await postApproval(code, 'rejected');
    state.approvals[code] = { status:'rejected', by: state.username, at: new Date().toISOString() };
    renderCards();
    toast('Pago de '+name+' rechazado');
  } catch(err) {
    toastError('Error al rechazar: '+err.message);
  }
}

function handleDeposit(code) {
  var emp   = state.empresarios.find(function(e){ return e.ownerCode===code; });
  var stats = empStats(emp);
  var name  = emp.firstName+' '+emp.lastName;
  if (!confirm('¿Confirmar depósito a '+name+'?\n\nMonto: '+formatCLP(stats.neto))) return;
  state.payments[code] = 'paid';
  savePayments();
  renderCards();
  toast('✓ Pago a '+name+' marcado como depositado');
}

/* ─── PERSIST ────────────────────────────────────────────── */
function savePayments() {
  try { localStorage.setItem('pb_payments', JSON.stringify(state.payments)); } catch(e){}
}
function loadPayments() {
  try {
    var r = localStorage.getItem('pb_payments');
    if (r) state.payments = JSON.parse(r);
  } catch(e){}
}

/* ─── LOAD DATA ──────────────────────────────────────────── */
async function loadData() {
  state.dateFrom = $('date-from').value || todayStr();
  state.dateTo   = $('date-to').value   || todayStr();

  if (state.dateFrom > state.dateTo) {
    toast('⚠ La fecha DESDE no puede ser mayor que HASTA');
    return;
  }

  setLoading('Cargando '+toDisplay(state.dateFrom)+' → '+toDisplay(state.dateTo)+'…');

  try {
    $('loading-msg').textContent = 'Obteniendo empresarios…';
    var rawEmps = await fetchAllEmpresas();
    state.empresarios = rawEmps.map(function(u) {
      return { id:u.id, login:u.login,
        firstName:u.first_name||'', lastName:u.last_name||'',
        ownerCode:u.owner_code||'',  rut:u.rut_number||'' };
    });

    $('loading-msg').textContent = 'Cargando aprobaciones…';
    await fetchApprovals();

    $('loading-msg').textContent = 'Cargando servicios '+toDisplay(state.dateFrom)+' → '+toDisplay(state.dateTo)+'…';
    var allRows = await fetchAllServices(state.dateFrom, state.dateTo);

    // Agrupar por Razón Social
    state.services = {};
    var nameMap = {};
    state.empresarios.forEach(function(emp) {
      nameMap[(emp.firstName+' '+emp.lastName).trim().toLowerCase()] = emp.ownerCode;
    });

    allRows.forEach(function(row) {
      var razon = (row[COL.razonSocial]||'').trim().toLowerCase();
      var code  = nameMap[razon];
      if (!code) {
        var keys = Object.keys(nameMap);
        for (var i=0;i<keys.length;i++) {
          if (razon.includes(keys[i])||keys[i].includes(razon)) { code=nameMap[keys[i]]; break; }
        }
      }
      code = code||'__unmatched__';
      if (!state.services[code]) state.services[code]=[];
      state.services[code].push(row);
    });

    setReady();
    renderCards();

    var withSvc = state.empresarios.filter(function(e){ return (state.services[e.ownerCode]||[]).length>0; }).length;
    toast('✓ '+allRows.length+' servicios · '+withSvc+' empresarios activos');

  } catch(err) {
    console.error(err);
    setError(err.message);
  }
}

/* ─── EVENTOS ────────────────────────────────────────────── */
$('login-btn').addEventListener('click', doLogin);
['login-user','login-pass'].forEach(function(id) {
  $(id).addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });
});

$('btn-logout').addEventListener('click', function() {
  clearSession();
  state.empresarios=[]; state.services={}; state.approvals={};
  state.expanded = new Set();
  resetAppState();
  showLogin();
});

$('btn-load').addEventListener('click', loadData);

$('date-from').addEventListener('change', function() {
  if ($('date-to').value && $('date-to').value < $('date-from').value) {
    $('date-to').value = $('date-from').value;
  }
  $('date-to').min = $('date-from').value;
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