/* ══════════════════════════════════════════════════════════════
   PAGO EMPRESARIOS · PULLMAN BUS
   Aprobaciones y pagos por día — clave: ENT-XXXXX__YYYY-MM-DD
   ══════════════════════════════════════════════════════════════ */

const REPORT_ID = 1532;
const COL = {
  fecha:0, hora:1, origen:2, destino:3, ruta:4, servicio:5, estado:6,
  bus:7, patente:8, totalAsientos:9, rut:10, razonSocial:11,
  asientosSuc:12, recaudSuc:13, asientosCam:14, recaudCam:15,
  produccion:16, comision:17, totalNeto:18,
  // gastos: null, // ← TODO Konnect: agregar índice cuando esté disponible
};

/* ─── STATE ──────────────────────────────────────────────── */
var state = {
  sessionToken: '', role: '', username: '',
  ownerCode:    '',   // set for empresario role
  operatorName: '',   // display name for empresario
  dateFrom: todayStr(), dateTo: todayStr(),
  empresarios: [],
  services:    {},  // ownerCode → [rows]
  approvals:   {},  // "ENT-XXXXX__YYYY-MM-DD" → { status, by, at }
  payments:    {},  // localStorage — same key structure
  // Aramco: cargos por empresario por día
  // Clave: "ENT-XXXXX__YYYY-MM-DD", valor: monto numérico a descontar
  aramco:      {},
  filter: 'all', search: '', hideEmpty: false,
  expanded: new Set(),
};

/* ─── KEY HELPERS ────────────────────────────────────────── */
// Clave única por empresario + día
function approvalKey(code, isoDate) { return code + '__' + isoDate; }

// DD/MM/YYYY → YYYY-MM-DD
function ddToIso(ddmmyyyy) {
  var p = ddmmyyyy.split('/');
  if (p.length !== 3) return '';
  return p[2] + '-' + p[1] + '-' + p[0];
}

// YYYY-MM-DD → DD/MM/YYYY
function toDisplay(isoDate) { return isoDate.split('-').reverse().join('/'); }

// Estado de un día concreto (primero payments luego approvals)
function getDayStatus(code, isoDate) {
  var k = approvalKey(code, isoDate);
  var p = state.payments[k];
  if (p && p.status === 'paid') return 'paid';
  var a = state.approvals[k];
  if (a) return a.status; // approved | rejected | pending
  return 'pending';
}

// Agrupar servicios de un empresario por día ISO
function groupByDay(rows) {
  var days = {};
  (rows||[]).forEach(function(r) {
    var iso = ddToIso(r[COL.fecha]||'');
    if (!iso) return;
    if (!days[iso]) days[iso] = [];
    days[iso].push(r);
  });
  return days;
}

// Obtener cargo Aramco de un día (0 si no está configurado)
function getAramcoDay(code, isoDate) {
  return state.aramco[approvalKey(code, isoDate)] || 0;
}

// Stats de un array de filas
// gastos: placeholder en 0 hasta que Konnect lo envíe en data_body
function calcStats(rows) {
  var prod=0, com=0, gastos=0, neto=0;
  (rows||[]).forEach(function(r) {
    prod   += parseMoney(r[COL.produccion]);
    com    += parseMoney(r[COL.comision]);
    // gastos += parseMoney(r[COL.gastos]); // TODO: descomentar cuando Konnect agregue la columna
    neto   += parseMoney(r[COL.totalNeto]);
  });
  return { count:(rows||[]).length, prod:prod, com:com, gastos:gastos, neto:neto };
}

// Total final = totalNeto (Konnect, ya incluye gastos) - Aramco
function calcFinalNeto(netoKonnect, code, isoDate) {
  return netoKonnect - getAramcoDay(code, isoDate);
}

// Total final para todos los días de un empresario en el rango
function calcFinalNetoTotal(code) {
  var byDay = groupByDay(state.services[code]||[]);
  var total = 0;
  Object.keys(byDay).forEach(function(d) {
    var stats = calcStats(byDay[d]);
    total += calcFinalNeto(stats.neto, code, d);
  });
  return total;
}

// Estado resumen de un empresario (para badge colapsado)
// all paid → paid | all approved → approved | any rejected → rejected
// mixed approved+pending → parcial | all pending → pending
function getOverallStatus(code) {
  var rows = state.services[code] || [];
  if (!rows.length) return 'pending';
  var days = Object.keys(groupByDay(rows)).sort();
  var statuses = days.map(function(d){ return getDayStatus(code, d); });
  if (statuses.every(function(s){ return s==='paid'; })) return 'paid';
  if (statuses.every(function(s){ return s==='approved'||s==='paid'; })) return 'approved';
  if (statuses.some(function(s){ return s==='rejected'; })) {
    if (statuses.some(function(s){ return s==='approved'||s==='paid'; })) return 'parcial';
    return 'rejected';
  }
  if (statuses.some(function(s){ return s==='approved'; })) return 'parcial';
  return 'pending';
}

/* ─── HELPERS ────────────────────────────────────────────── */
function todayStr() { return new Date().toISOString().slice(0,10); }

function parseMoney(str) {
  if (typeof str==='number') return str;
  if (!str||str==='$0') return 0;
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
  var e = (estado||'').toLowerCase();
  if (e.includes('complet')) return 'svc-completado';
  if (e.includes('recaud'))  return 'svc-recaudado';
  if (e.includes('ruta'))    return 'svc-ruta';
  return 'svc-otro';
}

function toast(msg, ms) {
  ms = ms||2800;
  var el = document.createElement('div');
  el.className='toast'; el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, ms);
}

function toastError(msg) {
  var el = document.createElement('div');
  el.className='toast toast-error'; el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, 4000);
}

/* ─── MODAL ──────────────────────────────────────────────── */
function showModal(opts) {
  var overlay=$('confirm-overlay'), modal=$('confirm-modal');
  var iconEl=$('confirm-icon'), titleEl=$('confirm-title');
  var detailEl=$('confirm-detail'), inputWrap=$('confirm-input-wrap');
  var inputEl=$('confirm-input'), btnsEl=$('confirm-btns');

  iconEl.textContent = opts.icon||'?';
  iconEl.className   = 'confirm-icon '+(opts.iconClass||'');
  titleEl.textContent= opts.title||'';
  detailEl.innerHTML = opts.detail||'';
  modal.className    = 'confirm-modal'+(opts.danger?' modal-danger':opts.success?' modal-success':'');

  if (opts.inputLabel) {
    $('confirm-input-label').textContent = opts.inputLabel;
    inputEl.placeholder = opts.inputPlaceholder||'';
    inputEl.value=''; inputWrap.hidden=false;
    setTimeout(function(){ inputEl.focus(); }, 80);
  } else {
    inputWrap.hidden=true; inputEl.value='';
  }

  btnsEl.innerHTML =
    '<button class="confirm-btn-secondary" id="confirm-cancel">Cancelar</button>' +
    '<button class="confirm-btn-primary '+(opts.confirmClass||'btn-green')+'" id="confirm-ok">'+(opts.confirmText||'Confirmar')+'</button>';

  overlay.hidden=false;

  $('confirm-ok').onclick = function() {
    overlay.hidden=true;
    opts.onConfirm(opts.inputLabel ? inputEl.value.trim() : null);
  };
  $('confirm-cancel').onclick = function(){ overlay.hidden=true; };
  inputEl.onkeydown = function(e) {
    if (e.key==='Enter')  $('confirm-ok').click();
    if (e.key==='Escape') $('confirm-cancel').click();
  };
  overlay.onclick = function(e){ if(e.target===overlay) overlay.hidden=true; };
}

function showDetailModal(html) {
  $('detail-content').innerHTML = html;
  $('detail-overlay').hidden=false;
  $('detail-overlay').onclick = function(e){
    if(e.target===$('detail-overlay')) $('detail-overlay').hidden=true;
  };
}

function detailRow(label, value) {
  return '<tr>' +
    '<td style="padding:8px 12px 8px 0;color:var(--text3);font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap;vertical-align:top">'+label+'</td>' +
    '<td style="padding:8px 0;color:var(--text);font-size:13px">'+value+'</td>' +
    '</tr>';
}

/* ─── SESSION ────────────────────────────────────────────── */
function saveSession(token, role, username) {
  state.sessionToken=token; state.role=role; state.username=username;
  sessionStorage.setItem('pb_session',token);
  sessionStorage.setItem('pb_role',role);
  sessionStorage.setItem('pb_username',username||'');
}
function loadSession() {
  var t=sessionStorage.getItem('pb_session');
  var r=sessionStorage.getItem('pb_role');
  var u=sessionStorage.getItem('pb_username');
  if (t&&r){
    state.sessionToken=t; state.role=r; state.username=u||'';
    state.ownerCode    = sessionStorage.getItem('pb_ownerCode')    || '';
    state.operatorName = sessionStorage.getItem('pb_operatorName') || '';
    return true;
  }
  return false;
}
function clearSession() {
  state.sessionToken=''; state.role=''; state.username='';
  state.ownerCode=''; state.operatorName='';
  ['pb_session','pb_role','pb_username','pb_ownerCode','pb_operatorName']
    .forEach(function(k){ sessionStorage.removeItem(k); });
}

/* ─── API ────────────────────────────────────────────────── */
async function proxyFetch(konnectPath) {
  var res = await fetch('/api/proxy?path='+encodeURIComponent(konnectPath), {
    headers:{ 'Content-Type':'application/json', 'X-Session-Token':state.sessionToken },
  });
  if (res.status===401){ clearSession(); showLogin(); throw new Error('Sesión expirada.'); }
  if (!res.ok){ var e=await res.json().catch(function(){return{};}); throw new Error(e.error||'HTTP '+res.status); }
  var json=await res.json();
  if (!json.success) throw new Error(json.message||'API error');
  return json.data;
}

async function apiFetch(path, opts) {
  opts=opts||{};
  var res = await fetch(path, Object.assign({
    headers: Object.assign({ 'Content-Type':'application/json', 'X-Session-Token':state.sessionToken }, opts.headers||{})
  }, opts));
  if (res.status===401){ clearSession(); showLogin(); throw new Error('Sesión expirada.'); }
  var json=await res.json();
  if (!json.ok) throw new Error(json.error||'Error');
  return json;
}

async function fetchAllEmpresas() {
  var page=1, all=[];
  while(true) {
    var data=await proxyFetch('/api/v2/users?page='+page+'&items=25&filter_user_type=1&filter_user_type=3&locale=es');
    all=all.concat(data.users||[]);
    if (page>=(data.pages||1)) break;
    page++;
  }
  return all.filter(function(u){ return u.owner_code&&u.owner_code.startsWith('ENT-'); });
}

async function fetchAllServices(dateFrom, dateTo) {
  var fromDate=toDisplay(dateFrom), toDate=toDisplay(dateTo);
  var path='/api/v2/reports/render_report/'+REPORT_ID+
    '?page_limit=0-500&date_range=4&from_date='+fromDate+'&to_date='+toDate+
    '&date_wise=1&user=&status=&owner_id=&locale=es';
  var data=await proxyFetch(path);
  var rows=data.data_body||[];
  var total=data.total_records_count||data.total_count||rows.length;
  if (total>500) {
    var offset=500;
    while (rows.length<total) {
      var more=await proxyFetch('/api/v2/reports/render_report/'+REPORT_ID+
        '?page_limit='+offset+'-'+(offset+499)+'&date_range=4&from_date='+fromDate+'&to_date='+toDate+
        '&date_wise=1&user=&status=&owner_id=&locale=es');
      var mr=more.data_body||[];
      if (!mr.length) break;
      rows=rows.concat(mr);
      offset+=500;
      if (offset>=5000) break;
    }
  }
  var fromTs=new Date(dateFrom+'T00:00:00').getTime();
  var toTs  =new Date(dateTo  +'T23:59:59').getTime();
  return rows.filter(function(r) {
    var p=(r[0]||'').split('/');
    if (p.length!==3) return true;
    var ts=new Date(p[2]+'-'+p[1]+'-'+p[0]+'T12:00:00').getTime();
    return ts>=fromTs&&ts<=toTs;
  });
}

async function fetchApprovals() {
  try {
    var json=await apiFetch('/api/approvals');
    state.approvals=json.approvals||{};
  } catch(e) {
    console.warn('No se pudieron cargar aprobaciones:',e.message);
    state.approvals={};
  }
}

async function postApproval(key, action) {
  return apiFetch('/api/approvals',{ method:'POST', body:JSON.stringify({ key:key, action:action }) });
}

/* ─── ACTIVITY LOG ──────────────────────────────────────── */
async function logActivity(action, code, isoDate, amount, name) {
  try {
    await apiFetch('/api/activity', {
      method: 'POST',
      body: JSON.stringify({ action, code, isoDate, amount, name }),
    });
  } catch(e) {
    console.warn('[activity] log failed:', e.message);
  }
}

async function fetchActivity() {
  try {
    var json = await apiFetch('/api/activity?limit=100');
    return json.entries || [];
  } catch(e) {
    console.warn('[activity] fetch failed:', e.message);
    return [];
  }
}

/* ─── OPERATORS API ──────────────────────────────────────── */
async function fetchOperators() {
  return apiFetch('/api/operators');
}
async function createOperator(data) {
  return apiFetch('/api/operators', { method:'POST', body:JSON.stringify(data) });
}
async function deleteOperator(username) {
  return apiFetch('/api/operators?username='+encodeURIComponent(username), { method:'DELETE' });
}

async function fetchAramco() {
  try {
    var json = await apiFetch('/api/aramco?from='+state.dateFrom+'&to='+state.dateTo);
    state.aramco = json.data || {};
    if (json.source === 'stub') {
      console.info('[Aramco] Usando datos stub ($0). Configurar ARAMCO_API_URL para datos reales.');
    }
  } catch(e) {
    console.warn('[Aramco] No se pudieron cargar cargos:', e.message);
    state.aramco = {};
  }
}

/* ─── DOM ────────────────────────────────────────────────── */
var $ = function(id){ return document.getElementById(id); };
function show(id){ $(id).hidden=false; }
function hide(id){ $(id).hidden=true; }

/* ─── LANG ───────────────────────────────────────────────── */
function applyLang(lang) {
  setLang(lang);

  // Update toggle buttons
  document.querySelectorAll('.lang-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  // Update all data-i18n elements (labels)
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    el.textContent = t(el.dataset.i18n);
  });

  // Update all data-i18n-text elements (buttons etc)
  document.querySelectorAll('[data-i18n-text]').forEach(function(el) {
    el.textContent = t(el.dataset.i18nText);
  });

  // Update placeholders
  var searchEl = $('search-input');
  if (searchEl) searchEl.placeholder = t('search_placeholder');

  var loginUser = $('login-user');
  if (loginUser) loginUser.placeholder = t('login_user_ph');

  var loginPass = $('login-pass');
  if (loginPass) loginPass.placeholder = t('login_pass_ph');

  // Update login button text (if not loading)
  var loginBtnText = $('login-btn-text');
  if (loginBtnText && loginBtnText.textContent !== t('login_loading')) {
    loginBtnText.textContent = t('login_btn');
  }

  // Update load/logout buttons
  var btnLoad = $('btn-load');
  if (btnLoad) btnLoad.innerHTML = '<span class="btn-icon">⟳</span> ' + t('btn_load');

  var btnLogout = $('btn-logout');
  if (btnLogout) btnLogout.textContent = '⎋ ' + t('btn_logout');

  // Update placeholder attributes (data-i18n-ph)
  document.querySelectorAll('[data-i18n-ph]').forEach(function(el) {
    el.placeholder = t(el.dataset.i18nPh);
  });

  // Re-render cards if data is loaded (to update all dynamic strings)
  if (state.empresarios.length > 0) renderCards();

  // Re-render empresario view if active
  if (state.role === 'empresario' && evData.services && evData.services.length > 0) evRender();
}

/* ─── LOGIN ──────────────────────────────────────────────── */
function showLogin(){ hide('app'); show('login-screen'); $('login-user').focus(); }

function showApp() {
  hide('login-screen');

  if (state.role === 'empresario') {
    showEmpresarioView();
    return;
  }

  show('app');

  // Auto-set today's date
  var today = todayStr();
  state.dateFrom = today;
  state.dateTo   = today;
  $('date-from').value = today;
  $('date-to').value   = today;

  $('header-username').textContent = state.username;
  $('header-role').textContent     = state.role==='supervisor'?t('role_supervisor'):t('role_contable');
  $('header-role').className       = 'header-role-badge '+(state.role==='supervisor'?'role-supervisor':'role-contable');

  var btnApproveAll = $('btn-approve-all');
  var btnActivity   = $('btn-activity');
  if (btnApproveAll) btnApproveAll.hidden = (state.role !== 'supervisor');
  if (btnActivity)   btnActivity.hidden   = false;
  var btnOpsMain = $('btn-operators');
  if (btnOpsMain) btnOpsMain.hidden = (state.role !== 'supervisor');

  var defaultFilter = state.role === 'supervisor' ? 'pending' : 'approved';
  state.filter = defaultFilter;
  document.querySelectorAll('.filter-pill').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.filter === defaultFilter);
  });

  resetAppState();
  loadData();
}

function resetAppState() {
  hide('summary-bar'); hide('main-content'); hide('state-loading'); hide('state-error');
  show('state-empty');
  ['s-produccion','s-comision','s-neto'].forEach(function(id){ $(id).textContent='$0'; });
  ['s-gastos','s-aramco'].forEach(function(id){ $(id).textContent='—'; });
  ['s-count','s-services'].forEach(function(id){ $(id).textContent='0'; });
  $('s-period').textContent='—';
  $('empresarios-list').innerHTML='';
}

async function doLogin() {
  var username=$('login-user').value.trim(), password=$('login-pass').value;
  if (!username||!password){ showLoginError(t('login_err_empty')); return; }
  setLoginLoading(true); hide('login-error');
  try {
    var res=await fetch('/api/auth',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
    var json=await res.json();
    if (!res.ok||!json.ok) throw new Error(json.error||t('login_err_creds'));
    saveSession(json.token,json.role,username);
    state.ownerCode    = json.ownerCode    || '';
    state.operatorName = json.operatorName || '';
    sessionStorage.setItem('pb_ownerCode',    state.ownerCode);
    sessionStorage.setItem('pb_operatorName', state.operatorName);
    $('login-pass').value='';
    showApp();
  } catch(err){ showLoginError(err.message); }
  finally { setLoginLoading(false); }
}

function showLoginError(msg){ var el=$('login-error'); el.textContent=msg; el.hidden=false; }
function setLoginLoading(on) {
  $('login-btn').disabled=on;
  $('login-btn-text').textContent=on?'Verificando…':'Iniciar sesión';
  $('login-spinner').hidden=!on;
}

/* ─── ESTADOS ────────────────────────────────────────────── */
function setLoading(msg){ hide('state-empty');hide('state-error');hide('main-content');hide('summary-bar');show('state-loading');$('loading-msg').textContent=msg; }
function setError(msg)  { hide('state-loading');hide('main-content');show('state-error');$('error-msg').textContent=msg; }
function setReady()     { hide('state-loading');hide('state-empty');hide('state-error');show('summary-bar');show('main-content'); }

/* ─── FILTRADO ───────────────────────────────────────────── */
function getFiltered() {
  var s=state.search.toLowerCase().trim();
  return state.empresarios.filter(function(emp) {
    if (s) {
      var name=(emp.firstName+' '+emp.lastName).toLowerCase();
      if (!name.includes(s)&&!(emp.ownerCode||'').toLowerCase().includes(s)&&!(emp.rut||'').toLowerCase().includes(s)) return false;
    }
    if (state.hideEmpty&&!(state.services[emp.ownerCode]||[]).length) return false;
    var overall=getOverallStatus(emp.ownerCode);
    if (state.filter!=='all') {
      if (state.filter==='parcial' && overall!=='parcial') return false;
      if (state.filter!=='parcial' && overall!==state.filter) return false;
    }
    return true;
  });
}

/* ─── SUMMARY ────────────────────────────────────────────── */
function computeGlobalSummary() {
  var tp=0, tc=0, tg=0, ta=0, tn=0, ts=0;
  getFiltered().forEach(function(emp) {
    var byDay = groupByDay(state.services[emp.ownerCode]||[]);
    Object.keys(byDay).forEach(function(isoDate) {
      var rows  = byDay[isoDate];
      var stats = calcStats(rows);
      var aramco = getAramcoDay(emp.ownerCode, isoDate);
      tp += stats.prod;
      tc += stats.com;
      tg += stats.gastos;        // placeholder 0 hasta que llegue de Konnect
      ta += aramco;
      tn += calcFinalNeto(stats.neto, emp.ownerCode, isoDate);
      ts += stats.count;
    });
  });
  $('s-produccion').textContent = formatCLP(tp);
  $('s-comision').textContent   = formatCLP(tc);
  $('s-gastos').textContent     = formatCLP(tg);
  $('s-aramco').textContent     = formatCLP(ta);
  $('s-neto').textContent       = formatCLP(tn);
  $('s-count').textContent      = getFiltered().length;
  $('s-services').textContent   = ts;
  $('s-period').textContent     = toDisplay(state.dateFrom)+' → '+toDisplay(state.dateTo);
}

/* ─── RENDER CARDS ───────────────────────────────────────── */
function renderCards() {
  var list=  $('empresarios-list');
  var empresas=getFiltered();
  computeGlobalSummary();
  list.innerHTML='';

  if (!empresas.length) {
    list.innerHTML='<div class="state-box"><div class="state-icon">◎</div>'+
      '<div class="state-title">'+t('no_results_title')+'</div>'+
      '<div class="state-desc">No hay empresarios que coincidan con los filtros activos.</div></div>';
    return;
  }

  empresas.forEach(function(emp, idx) {
    var rows    = state.services[emp.ownerCode]||[];
    var hasRows = rows.length>0;
    var overall = getOverallStatus(emp.ownerCode);
    var totals  = calcStats(rows);
    var expanded= state.expanded.has(emp.ownerCode);

    var BADGE_MAP = {
      pending:'badge-pending', approved:'badge-approved',
      rejected:'badge-rejected', paid:'badge-paid', parcial:'badge-parcial'
    };
    var LABEL_MAP = {
      pending:t('badge_pending'), approved:t('badge_approved'),
      rejected:t('badge_rejected'), paid:t('badge_paid'), parcial:t('badge_parcial')
    };

    // Calcular días pendientes atrasados (anteriores a hoy)
    var today = todayStr();
    var overdueDays = (function() {
      var byDay = groupByDay(rows);
      return Object.keys(byDay).filter(function(d) {
        return d < today && getDayStatus(emp.ownerCode, d) === 'pending';
      }).length;
    })();

    // Calcular Aramco total del empresario en el rango visible
    var empAramcoTotal = (function() {
      var byDay = groupByDay(rows);
      var t = 0;
      Object.keys(byDay).forEach(function(d){ t += getAramcoDay(emp.ownerCode, d); });
      return t;
    })();

    var card=document.createElement('div');
    card.className='emp-card'+(expanded?' expanded':'')+(!hasRows?' no-services':'');
    card.dataset.code=emp.ownerCode;
    card.style.animationDelay=(idx*30)+'ms';

    // ── Acción rápida en header colapsado (contable: depositar todo aprobado)
    var quickAction='';
    if (state.role==='contable' && (overall==='approved'||overall==='parcial')) {
      var approvedNeto = calcApprovedNeto(emp.ownerCode);
      if (approvedNeto>0) {
        quickAction='<button class="btn-deposit btn-deposit-range" data-code="'+emp.ownerCode+'">Depositar aprobados</button>';
      }
    }

    card.innerHTML=
      '<div class="emp-header">'+
        '<div class="emp-avatar">'+initials(emp.firstName,emp.lastName)+'</div>'+
        '<div class="emp-info">'+
          '<div class="emp-name">'+emp.firstName+' '+emp.lastName+'</div>'+
          '<div class="emp-meta">'+
            '<span>'+emp.ownerCode+'</span>'+
            '<span>'+(emp.rut||'—')+'</span>'+
            '<span class="'+(hasRows?'meta-count-active':'')+'">'+rows.length+' '+( rows.length!==1?t('svc_plural'):t('svc_singular'))+'</span>'+
          '</div>'+
        (overdueDays>0?'<div class="overdue-badge">⚠ '+overdueDays+' día'+(overdueDays>1?'s':'')+(currentLang==='en'?' overdue':' atrasado'+(overdueDays>1?'s':''))+'</div>':'')+
        '</div>'+
        '<div class="emp-stats">'+
          '<div class="stat stat-w1"><div class="stat-label">Producción</div><div class="stat-value amber">'+formatCLP(totals.prod)+'</div></div>'+
          '<div class="stat-sep"></div>'+
          '<div class="stat stat-w2"><div class="stat-label">Comisión</div><div class="stat-value">'+formatCLP(totals.com)+'</div></div>'+
          '<div class="stat stat-w2"><div class="stat-label">Gastos</div><div class="stat-value stat-gastos">'+(totals.gastos>0?formatCLP(totals.gastos):'—')+'</div></div>'+
          '<div class="stat stat-w2"><div class="stat-label">Aramco</div><div class="stat-value stat-aramco">'+(empAramcoTotal>0?formatCLP(empAramcoTotal):'—')+'</div></div>'+
          '<div class="stat-sep"></div>'+
          '<div class="stat stat-w1"><div class="stat-label">Total a Pagar</div><div class="stat-value green">'+formatCLP(calcFinalNetoTotal(emp.ownerCode))+'</div></div>'+
          '<div class="stat stat-w3"><div class="stat-label">Servicios</div><div class="stat-value count">'+rows.length+'</div></div>'+
        '</div>'+
        '<div class="emp-status">'+
          '<div class="status-badge '+BADGE_MAP[overall]+'">'+LABEL_MAP[overall]+'</div>'+
          '<div class="emp-actions">'+quickAction+'</div>'+
        '</div>'+
        '<div class="emp-chevron">▼</div>'+
      '</div>'+
      '<div class="emp-services">'+renderDayBreakdown(emp)+'</div>';

    // Toggle expand
    card.querySelector('.emp-header').addEventListener('click', function(e) {
      if (e.target.closest('.btn-approve,.btn-reject,.btn-deposit')) return;
      if (state.expanded.has(emp.ownerCode)) { state.expanded.delete(emp.ownerCode); card.classList.remove('expanded'); }
      else { state.expanded.add(emp.ownerCode); card.classList.add('expanded'); }
    });

    // Depositar rango (botón en header colapsado)
    var btnRange=card.querySelector('.btn-deposit-range');
    if (btnRange) {
      btnRange.addEventListener('click', function(e) { e.stopPropagation(); handleDepositRange(emp.ownerCode); });
    }

    // Delegación de eventos en el breakdown por día
    card.querySelector('.emp-services').addEventListener('click', function(e) {
      var btn=e.target.closest('[data-day-action]');
      if (!btn) return;
      e.stopPropagation();
      var action   = btn.dataset.dayAction;
      var isoDate  = btn.dataset.isoDate;
      var code     = emp.ownerCode;
      if (action==='approve') handleApproveDay(code, isoDate);
      if (action==='reject')  handleRejectDay(code, isoDate);
      if (action==='deposit') handleDepositDay(code, isoDate);
      if (action==='detail')  showPaymentDetail(code, isoDate);
    });

    list.appendChild(card);
  });
}

/* ─── DAY BREAKDOWN ──────────────────────────────────────── */
function renderDayBreakdown(emp) {
  var rows=state.services[emp.ownerCode]||[];
  if (!rows.length) return '<div class="day-empty">'+t('table_empty')+'</div>';

  var byDay=groupByDay(rows);
  var sortedDays=Object.keys(byDay).sort();
  var html='';

  sortedDays.forEach(function(isoDate) {
    var dayRows = byDay[isoDate];
    var stats   = calcStats(dayRows);
    var status  = getDayStatus(emp.ownerCode, isoDate);
    var ap      = state.approvals[approvalKey(emp.ownerCode,isoDate)];
    var pm      = state.payments [approvalKey(emp.ownerCode,isoDate)];

    var BADGE = { pending:'badge-pending', approved:'badge-approved', rejected:'badge-rejected', paid:'badge-paid' };
    var LABEL = { pending:'Pendiente', approved:'Aprobado', rejected:'Rechazado', paid:'Pagado' };

    // Construir acciones del día
    var dayActions='';
    if (state.role==='supervisor') {
      if (status==='paid') {
        dayActions='<span class="day-paid-label">'+t('day_paid_label')+'</span>';
      } else if (status==='approved') {
        dayActions=
          '<span class="day-by">'+t('day_by_prefix')+' '+((ap&&ap.by)||'—')+'</span>'+
          '<button class="day-btn day-btn-reject" data-day-action="reject" data-iso-date="'+isoDate+'">'+t('day_actions_reject')+'</button>';
      } else if (status==='rejected') {
        dayActions=
          '<button class="day-btn day-btn-approve" data-day-action="approve" data-iso-date="'+isoDate+'">Aprobar</button>';
      } else {
        dayActions=
          '<button class="day-btn day-btn-approve" data-day-action="approve" data-iso-date="'+isoDate+'">'+t('day_actions_approve')+'</button>'+
          '<button class="day-btn day-btn-reject"  data-day-action="reject"  data-iso-date="'+isoDate+'">'+t('day_actions_reject')+'</button>';
      }
    } else { // contable
      if (status==='paid') {
        dayActions='<button class="day-btn day-btn-detail" data-day-action="detail" data-iso-date="'+isoDate+'">'+t('day_actions_detail')+'</button>';
      } else if (status==='approved') {
        dayActions=
          '<span class="day-by">'+t('day_approved_by')+' '+((ap&&ap.by)||'—')+'</span>'+
          '<button class="day-btn day-btn-deposit" data-day-action="deposit" data-iso-date="'+isoDate+'">'+t('day_actions_deposit')+'</button>';
      } else if (status==='rejected') {
        dayActions='<span class="day-rejected-label">'+t('day_rejected_label')+'</span>';
      } else {
        dayActions='<span class="day-pending-label">'+t('day_pending_label')+'</span>';
      }
    }

    var aramcoDay  = getAramcoDay(emp.ownerCode, isoDate);
    var finalNeto  = calcFinalNeto(stats.neto, emp.ownerCode, isoDate);

    html+=
      '<div class="day-section">'+
        '<div class="day-header">'+
          '<div class="day-date">'+toDisplay(isoDate)+'</div>'+
          '<div class="day-stats">'+
            '<span class="day-stat"><span class="day-stat-lbl">Prod.</span> '+formatCLP(stats.prod)+'</span>'+
            (stats.gastos>0?'<span class="day-stat orange"><span class="day-stat-lbl">Gastos</span> '+formatCLP(stats.gastos)+'</span>':'')+
            (aramcoDay>0?'<span class="day-stat red"><span class="day-stat-lbl">Aramco</span> −'+formatCLP(aramcoDay)+'</span>':'')+
            '<span class="day-stat green"><span class="day-stat-lbl">Total</span> '+formatCLP(finalNeto)+'</span>'+
            '<span class="day-stat blue"><span class="day-stat-lbl">Svc</span> '+stats.count+'</span>'+
          '</div>'+
          '<div class="day-badge-wrap">'+
            '<span class="status-badge status-badge-sm '+BADGE[status]+'">'+LABEL[status]+'</span>'+
          '</div>'+
          '<div class="day-actions">'+dayActions+'</div>'+
        '</div>'+
        renderDayTable(dayRows)+
      '</div>';
  });

  return '<div class="day-breakdown">'+html+'</div>';
}

function renderDayTable(rows) {
  var tProd=0,tCom=0,tNeto=0;
  var trs=rows.map(function(r) {
    var prod=parseMoney(r[COL.produccion]), com=parseMoney(r[COL.comision]), neto=parseMoney(r[COL.totalNeto]);
    tProd+=prod; tCom+=com; tNeto+=neto;
    return '<tr>'+
      '<td class="td-mono">'+r[COL.hora]+'</td>'+
      '<td class="td-route">'+r[COL.origen]+' → '+r[COL.destino]+'</td>'+
      '<td class="td-service">'+r[COL.servicio]+'</td>'+
      '<td class="td-mono">'+r[COL.bus]+' · '+r[COL.patente]+'</td>'+
      '<td><span class="svc-state '+svcStateClass(r[COL.estado])+'">'+r[COL.estado]+'</span></td>'+
      '<td class="td-amount num">'+r[COL.asientosSuc]+'</td>'+
      '<td class="td-amount num">'+r[COL.produccion]+'</td>'+
      '<td class="td-amount num">'+r[COL.comision]+'</td>'+
      '<td class="td-neto">'+r[COL.totalNeto]+'</td>'+
      '</tr>';
  }).join('');
  return '<table class="services-mini-table day-table">'+
    '<thead><tr>'+
      '<th>'+t('th_hora')+'</th><th>'+t('th_ruta')+'</th><th>'+t('th_servicio')+'</th><th>'+t('th_bus')+'</th><th>'+t('th_estado')+'</th>'+
      '<th class="num">'+t('th_asientos')+'</th><th class="num">'+t('th_produccion')+'</th><th class="num">'+t('th_comision')+'</th><th class="num">'+t('th_total_neto')+'</th>'+
    '</tr></thead>'+
    '<tbody>'+trs+
      '<tr class="subtotal-row">'+
        '<td colspan="6" style="text-align:right;color:var(--text3)">'+t('th_totales')+'</td>'+
        '<td class="td-amount num">'+formatCLP(tProd)+'</td>'+
        '<td class="td-amount num">'+formatCLP(tCom)+'</td>'+
        '<td class="td-neto">'+formatCLP(tNeto)+'</td>'+
      '</tr>'+
    '</tbody></table>';
}

/* ─── ACCIONES POR DÍA ───────────────────────────────────── */
async function handleApproveDay(code, isoDate) {
  var emp   = state.empresarios.find(function(e){ return e.ownerCode===code; });
  var rows  = (groupByDay(state.services[code]||[]))[isoDate]||[];
  var stats = calcStats(rows);
  showModal({
    icon:'✓', iconClass:'icon-approve',
    title:t('modal_approve_title')+' · '+toDisplay(isoDate),
    detail:t('modal_approve_detail')+' <strong>'+toDisplay(isoDate)+'</strong> a <strong>'+emp.firstName+' '+emp.lastName+'</strong> '+t('modal_approve_to')+' <strong>'+emp.firstName+' '+emp.lastName+'</strong>'+
           '<span class="amount">'+formatCLP(calcFinalNeto(stats.neto,code,isoDate))+'</span>'+
           (getAramcoDay(code,isoDate)>0?'<div style="font-size:11px;color:var(--text3);margin-top:2px">Neto Konnect: '+formatCLP(stats.neto)+' − Aramco: '+formatCLP(getAramcoDay(code,isoDate))+'</div>':''),
    confirmText:t('modal_approve_ok'), confirmClass:'btn-green',
    onConfirm: async function() {
      try {
        var key=approvalKey(code,isoDate);
        await postApproval(key,'approved');
        state.approvals[key]={ status:'approved', by:state.username, at:new Date().toISOString() };
        logActivity('approved', code, isoDate, formatCLP(calcFinalNeto(stats.neto,code,isoDate)), emp.firstName+' '+emp.lastName);
        renderCards();
        toast(toDisplay(isoDate)+' '+t('toast_approved')+' '+emp.firstName);
      } catch(err){ toastError(t('toast_error_approve')+' '+err.message); }
    }
  });
}

async function handleRejectDay(code, isoDate) {
  var emp=state.empresarios.find(function(e){ return e.ownerCode===code; });
  showModal({
    icon:'✕', iconClass:'icon-reject',
    title:t('modal_reject_title')+' · '+toDisplay(isoDate),
    detail:t('modal_reject_detail')+' <strong>'+toDisplay(isoDate)+'</strong> a <strong>'+emp.firstName+' '+emp.lastName+'</strong>?',
    confirmText:t('modal_reject_ok'), confirmClass:'btn-red', danger:true,
    onConfirm: async function() {
      try {
        var key=approvalKey(code,isoDate);
        await postApproval(key,'rejected');
        state.approvals[key]={ status:'rejected', by:state.username, at:new Date().toISOString() };
        logActivity('rejected', code, isoDate, '', emp.firstName+' '+emp.lastName);
        renderCards();
        toast(t('toast_rejected')+' '+toDisplay(isoDate)+' '+t('day_by_prefix')+' '+emp.firstName);
      } catch(err){ toastError(t('toast_error_reject')+' '+err.message); }
    }
  });
}

function handleDepositDay(code, isoDate) {
  var emp   = state.empresarios.find(function(e){ return e.ownerCode===code; });
  var rows  = (groupByDay(state.services[code]||[]))[isoDate]||[];
  var stats = calcStats(rows);
  var ap    = state.approvals[approvalKey(code,isoDate)];
  showModal({
    icon:'⬆', iconClass:'icon-deposit',
    title:t('modal_deposit_title')+' · '+toDisplay(isoDate),
    detail:t('modal_deposit_detail')+' <strong>'+toDisplay(isoDate)+'</strong> a <strong>'+emp.firstName+' '+emp.lastName+'</strong> '+t('modal_approve_to')+' <strong>'+emp.firstName+' '+emp.lastName+'</strong>'+
           '<span class="amount">'+formatCLP(calcFinalNeto(stats.neto,code,isoDate))+'</span>'+
           (getAramcoDay(code,isoDate)>0?'<div style="font-size:11px;color:var(--text3);margin-top:2px">Neto Konnect: '+formatCLP(stats.neto)+' − Aramco: '+formatCLP(getAramcoDay(code,isoDate))+'</div>':'')
           +(ap&&ap.by?'<div style="font-size:12px;color:var(--text2)">Aprobado por: '+ap.by+'</div>':''),
    inputLabel:t('modal_deposit_input'),
    inputPlaceholder:t('modal_deposit_ph'),
    confirmText:t('modal_deposit_ok'), confirmClass:'btn-blue',
    onConfirm: function(ref) {
      var key=approvalKey(code,isoDate);
      var finalAmt = calcFinalNeto(stats.neto, code, isoDate);
      state.payments[key]={ status:'paid', transferRef:ref||'(sin número)',
        name:emp.firstName+' '+emp.lastName,
        amount:formatCLP(finalAmt),
        amountKonnect:formatCLP(stats.neto),
        amountAramco: formatCLP(getAramcoDay(code,isoDate)),
        date:isoDate, by:state.username, approvedBy:ap&&ap.by?ap.by:'—',
        at:new Date().toISOString() };
      logActivity('paid', code, isoDate, formatCLP(finalAmt), emp.firstName+' '+emp.lastName);
      savePayments(); renderCards();
      toast(t('toast_deposited')+' '+toDisplay(isoDate)+' '+t('toast_deposited2')+' '+emp.firstName);
    }
  });
}

function handleDepositRange(code) {
  var emp   = state.empresarios.find(function(e){ return e.ownerCode===code; });
  var byDay = groupByDay(state.services[code]||[]);
  var approvedDays = Object.keys(byDay).sort().filter(function(d) {
    return getDayStatus(code,d)==='approved';
  });
  if (!approvedDays.length) return;
  var totalNeto=0;
  approvedDays.forEach(function(d){ totalNeto+=calcStats(byDay[d]).neto; });

  showModal({
    icon:'⬆', iconClass:'icon-deposit',
    title:t('modal_range_title'),
    detail:'Depositando <strong>'+approvedDays.length+' día'+(approvedDays.length>1?'s':'')+
           '</strong> aprobados a <strong>'+emp.firstName+' '+emp.lastName+'</strong> '+t('modal_approve_to')+' <strong>'+emp.firstName+' '+emp.lastName+'</strong>'+
           '<span class="amount">'+formatCLP(totalNeto)+'</span>'+
           '<div style="font-size:11px;color:var(--text3);margin-top:4px">Días: '+approvedDays.map(toDisplay).join(', ')+'</div>',
    inputLabel:t('modal_deposit_input'),
    inputPlaceholder:t('modal_deposit_ph'),
    confirmText:t('modal_deposit_ok'), confirmClass:'btn-blue',
    onConfirm: function(ref) {
      approvedDays.forEach(function(isoDate) {
        var key  = approvalKey(code,isoDate);
        var rows = byDay[isoDate];
        var st   = calcStats(rows);
        var ap   = state.approvals[key];
        state.payments[key]={ status:'paid', transferRef:ref||'(sin número)',
          name:emp.firstName+' '+emp.lastName, amount:formatCLP(st.neto),
          date:isoDate, by:state.username, approvedBy:ap&&ap.by?ap.by:'—',
          at:new Date().toISOString(), rangeDeposit:true };
      });
      savePayments(); renderCards();
      toast('✓ Depósito rango registrado para '+emp.firstName+' ('+approvedDays.length+' días)');
    }
  });
}

/* ─── NETO APROBADO (para botón rango) ──────────────────── */
function calcApprovedNeto(code) {
  var byDay=groupByDay(state.services[code]||[]);
  var total=0;
  Object.keys(byDay).forEach(function(d) {
    if (getDayStatus(code,d)==='approved') {
      total += calcFinalNeto(calcStats(byDay[d]).neto, code, d);
    }
  });
  return total;
}

/* ─── DETALLE DE PAGO ────────────────────────────────────── */
function showPaymentDetail(code, isoDate) {
  var key=approvalKey(code,isoDate);
  var p=state.payments[key];
  if (!p||typeof p!=='object') return;
  var atStr=p.at?new Date(p.at).toLocaleString('es-CL',{
    day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
  }):'—';
  showDetailModal(
    '<div style="text-align:left;width:100%">'+
    '<table style="width:100%;border-collapse:collapse">'+
    detailRow(t('detail_empresario'), p.name||'—')+
    detailRow(t('detail_date'), toDisplay(p.date||isoDate))+
    detailRow(t('detail_total'),'<span style="color:var(--green);font-family:var(--mono);font-size:18px;font-weight:700">'+(p.amount||'$0')+'</span>')+
    (p.amountKonnect&&p.amountKonnect!==p.amount?detailRow(t('detail_neto'), p.amountKonnect):'')+
    (p.amountAramco&&p.amountAramco!=='$0'?detailRow(t('detail_aramco'),'<span style="color:var(--red)">−'+p.amountAramco+'</span>'):'')+
    detailRow(t('detail_transfer'),'<span style="font-family:var(--mono);font-size:15px;color:var(--blue)">'+(p.transferRef||'—')+'</span>')+
    detailRow(t('detail_by'), p.by||'—')+
    detailRow(t('detail_approved_by'),   p.approvedBy||'—')+
    detailRow(t('detail_at'), atStr)+
    (p.rangeDeposit?detailRow(t('detail_range'),'—'):'')
    +'</table></div>'
  );
}

/* ─── EMPRESARIO VIEW ───────────────────────────────────── */
function showEmpresarioView() {
  hide('app');
  var el = $('empresario-view');
  if (el) {
    show('empresario-view');
    $('ev-name').textContent    = state.operatorName || state.username;
    $('ev-code').textContent    = state.ownerCode;
    $('ev-username').textContent= state.username;
    // set default dates
    var today = todayStr();
    $('ev-date-from').value = today;
    $('ev-date-to').value   = today;
    state.dateFrom = today;
    state.dateTo   = today;
    evLoadData();
  }
}

var evData = { services:[], approvals:{}, payments:{}, aramco:{} };

async function evLoadData() {
  var dateFrom = $('ev-date-from').value || todayStr();
  var dateTo   = $('ev-date-to').value   || todayStr();
  if (dateFrom > dateTo) { toast('⚠ FROM date cannot be greater than TO'); return; }
  state.dateFrom = dateFrom;
  state.dateTo   = dateTo;

  $('ev-loading').hidden = false;
  $('ev-content').hidden = true;

  try {
    // Load approvals, payments, aramco, services in parallel
    var [apResp, aramResp, svcRows] = await Promise.all([
      apiFetch('/api/approvals'),
      apiFetch('/api/aramco?from='+dateFrom+'&to='+dateTo),
      fetchAllServices(dateFrom, dateTo),
    ]);

    evData.approvals = apResp.approvals || {};
    evData.aramco    = aramResp.data    || {};
    evData.payments  = state.payments;

    // Filter services to this operator only
    evData.services  = svcRows.filter(function(r) {
      return (r[COL.razonSocial]||'').trim().toLowerCase() === state.operatorName.trim().toLowerCase()
        || (r[COL.razonSocial]||'').trim().toLowerCase().includes(state.operatorName.trim().toLowerCase());
    });

    // Also fetch previous period for comparison
    var msDay    = 86400000;
    var diffDays = Math.round((new Date(dateTo) - new Date(dateFrom)) / msDay) + 1;
    var prevTo   = new Date(new Date(dateFrom) - msDay).toISOString().slice(0,10);
    var prevFrom = new Date(new Date(prevTo) - (diffDays-1)*msDay).toISOString().slice(0,10);

    var prevRows = await fetchAllServices(prevFrom, prevTo);
    evData.prevServices = prevRows.filter(function(r) {
      return (r[COL.razonSocial]||'').trim().toLowerCase().includes(state.operatorName.trim().toLowerCase());
    });
    evData.prevFrom = prevFrom;
    evData.prevTo   = prevTo;

    evRender();
  } catch(e) {
    console.error(e);
    toast('Error: ' + e.message);
  } finally {
    $('ev-loading').hidden = true;
  }
}

function evToggleDay(dayId) {
  var section = document.getElementById(dayId);
  if (!section) return;
  var expanded = section.classList.toggle('ev-expanded');
  var chevron  = section.querySelector('.ev-day-chevron');
  if (chevron) chevron.textContent = expanded ? '▼' : '▶';
}

function evGetDayStatus(isoDate) {
  var k  = approvalKey(state.ownerCode, isoDate);
  var pm = evData.payments[k];
  if (pm && pm.status === 'paid') return 'paid';
  var ap = evData.approvals[k];
  if (ap) return ap.status;
  return 'pending';
}

function evRender() {
  var rows    = evData.services;
  var byDay   = groupByDay(rows);
  var days    = Object.keys(byDay).sort();

  // ── Totals
  var tProd=0, tCom=0, tNeto=0, tAramco=0, tSeats=0;
  rows.forEach(function(r) {
    tProd   += parseMoney(r[COL.produccion]);
    tCom    += parseMoney(r[COL.comision]);
    tNeto   += parseMoney(r[COL.totalNeto]);
    tSeats  += parseInt(r[COL.asientosSuc],10)||0;
  });
  days.forEach(function(d) {
    tAramco += evData.aramco[approvalKey(state.ownerCode,d)] || 0;
  });
  var tFinal = tNeto - tAramco;

  // Previous period totals for comparison
  var prevProd=0, prevNeto=0;
  (evData.prevServices||[]).forEach(function(r) {
    prevProd += parseMoney(r[COL.produccion]);
    prevNeto += parseMoney(r[COL.totalNeto]);
  });

  // ── Summary cards
  var prodDiff  = tProd>0&&prevProd>0 ? Math.round((tProd-prevProd)/prevProd*100) : null;
  var netoDiff  = tFinal>0&&prevNeto>0 ? Math.round((tFinal-prevNeto)/prevNeto*100) : null;

  $('ev-total-prod').textContent  = formatCLP(tProd);
  $('ev-total-com').textContent   = formatCLP(tCom);
  $('ev-total-aramco').textContent= tAramco>0 ? formatCLP(tAramco) : '$0';
  $('ev-total-final').textContent = formatCLP(tFinal);
  $('ev-total-svc').textContent   = rows.length;

  // Comparison badges
  function diffBadge(diff) {
    if (diff===null) return '<span class="ev-diff ev-diff-neutral">—</span>';
    var sign = diff>=0?'+':''; var vsText = t('ev_vs_prev');
    var cls  = diff>=0?'ev-diff-up':'ev-diff-down';
    return '<span class="ev-diff '+cls+'">'+sign+diff+'% '+vsText+'</span>';
  }
  $('ev-diff-prod').innerHTML  = diffBadge(prodDiff);
  $('ev-diff-final').innerHTML = diffBadge(netoDiff);

  // ── Status overview (per day)
  var statusHtml = '';
  if (!days.length) {
    statusHtml = '<div class="ev-empty">'+t('ev_no_services')+'</div>';
  } else {
    days.forEach(function(d) {
      var status = evGetDayStatus(d);
      var ap     = evData.approvals[approvalKey(state.ownerCode,d)];
      var pm     = evData.payments [approvalKey(state.ownerCode,d)];
      var dayRows= byDay[d];
      var ds     = calcStats(dayRows);
      var aramco = evData.aramco[approvalKey(state.ownerCode,d)] || 0;
      var final  = ds.neto - aramco;

      var BADGE = { pending:'badge-pending', approved:'badge-approved', rejected:'badge-rejected', paid:'badge-paid' };
      var LABEL = { pending:t('ev_status_pending'), approved:t('ev_status_approved'), rejected:t('ev_status_rejected'), paid:t('ev_status_paid') };

      // Build service rows for this day
      var svcRows = dayRows.map(function(r) {
        return '<tr>'+
          '<td class="td-mono">'+r[COL.hora]+'</td>'+
          '<td class="td-route">'+r[COL.origen]+' → '+r[COL.destino]+'</td>'+
          '<td class="td-service">'+r[COL.servicio]+'</td>'+
          '<td class="td-mono">'+r[COL.bus]+' · '+r[COL.patente].trim()+'</td>'+
          '<td><span class="svc-state '+svcStateClass(r[COL.estado])+'">'+r[COL.estado]+'</span></td>'+
          '<td class="td-amount num">'+r[COL.asientosSuc]+'</td>'+
          '<td class="td-amount num">'+r[COL.produccion]+'</td>'+
          '<td class="td-amount num">'+r[COL.comision]+'</td>'+
          '<td class="td-neto">'+r[COL.totalNeto]+'</td>'+
        '</tr>';
      }).join('');

      var tableHtml =
        '<div class="ev-svc-table">'+
          '<table class="services-mini-table">'+
            '<thead><tr>'+
              '<th>'+t('ev_th_time')+'</th><th>'+t('ev_th_route')+'</th><th>'+t('ev_th_service')+'</th><th>'+t('ev_th_bus')+'</th>'+
              '<th>'+t('ev_th_status')+'</th><th class="num">'+t('ev_th_seats')+'</th>'+
              '<th class="num">'+t('ev_th_production')+'</th><th class="num">'+t('ev_th_commission')+'</th><th class="num">'+t('ev_th_net')+'</th>'+
            '</tr></thead>'+
            '<tbody>'+svcRows+
              '<tr class="subtotal-row">'+
                '<td colspan="6" style="text-align:right;color:var(--text3)">'+t('ev_th_totals')+'</td>'+
                '<td class="td-amount num">'+formatCLP(ds.prod)+'</td>'+
                '<td class="td-amount num">'+formatCLP(ds.com)+'</td>'+
                '<td class="td-neto">'+formatCLP(final)+'</td>'+
              '</tr>'+
            '</tbody>'+
          '</table>'+
        '</div>';

      var dayId = 'ev-day-'+d.replace(/-/g,'');

      statusHtml +=
        '<div class="ev-day-section" id="'+dayId+'">'+
          '<div class="ev-day-row" data-dayid="'+dayId+'" onclick="evToggleDay(this.getAttribute(\'data-dayid\'))">'+
            '<div class="ev-day-chevron">▶</div>'+
            '<div class="ev-day-date">'+toDisplay(d)+'</div>'+
            '<div class="ev-day-stats">'+
              '<span><span class="ev-lbl">'+t('ev_lbl_prod')+'</span> '+formatCLP(ds.prod)+'</span>'+
              '<span class="ev-green"><span class="ev-lbl">'+t('ev_lbl_net')+'</span> '+formatCLP(final)+'</span>'+
              '<span class="ev-blue"><span class="ev-lbl">'+t('ev_lbl_svc')+'</span> '+ds.count+'</span>'+
            '</div>'+
            '<span class="status-badge status-badge-sm '+BADGE[status]+'">'+LABEL[status]+'</span>'+
            (status==='paid'&&pm?'<span class="ev-ref">'+t('ev_ref')+' '+pm.transferRef+'</span>':'')+(status==='approved'&&ap?'<span class="ev-approved-by">'+t('ev_approved_by')+' '+ap.by+'</span>':'')
          +'</div>'+
          tableHtml+
        '</div>';
    });
  }
  $('ev-status-list').innerHTML = statusHtml;

  // ── Metrics
  // Bus más utilizado
  var busCounts = {};
  rows.forEach(function(r) {
    var bus = (r[COL.bus]||'?')+' · '+(r[COL.patente]||'');
    busCounts[bus] = (busCounts[bus]||0)+1;
  });
  var topBus = Object.entries(busCounts).sort(function(a,b){ return b[1]-a[1]; })[0];
  $('ev-metric-bus').textContent = topBus ? topBus[0]+' ('+topBus[1]+' svc)' : '—';

  // Ruta más productiva
  var routeProd = {};
  rows.forEach(function(r) {
    var route = r[COL.origen]+' → '+r[COL.destino];
    routeProd[route] = (routeProd[route]||0) + parseMoney(r[COL.totalNeto]);
  });
  var topRoute = Object.entries(routeProd).sort(function(a,b){ return b[1]-a[1]; })[0];
  $('ev-metric-route').textContent = topRoute ? topRoute[0]+' ('+formatCLP(topRoute[1])+')' : '—';

  // Promedio asientos
  var avgSeats = rows.length ? Math.round(tSeats/rows.length) : 0;
  $('ev-metric-seats').textContent = avgSeats ? avgSeats+' '+t('ev_metric_seats').split('/')[1] : '—';

  // ── Daily evolution chart
  evRenderChart(byDay, days);

  $('ev-content').hidden = false;
}

function evRenderChart(byDay, days) {
  var canvas = $('ev-chart');
  if (!canvas || !days.length) return;
  var ctx    = canvas.getContext('2d');
  var w      = canvas.offsetWidth || 600;
  canvas.width  = w;
  canvas.height = 160;

  var values = days.map(function(d) { return calcStats(byDay[d]).neto; });
  var maxVal = Math.max.apply(null, values) || 1;
  var pad    = { t:16, r:16, b:32, l:64 };
  var cw     = w - pad.l - pad.r;
  var ch     = canvas.height - pad.t - pad.b;
  var step   = days.length > 1 ? cw / (days.length-1) : cw;

  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Grid lines
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth   = 1;
  [0,.25,.5,.75,1].forEach(function(f) {
    var y = pad.t + ch * (1-f);
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+cw,y); ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font      = '10px DM Sans, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatCLP(maxVal*f).replace('$','$'), pad.l-6, y+3);
  });

  // Area fill
  var pts = values.map(function(v,i) {
    return { x: pad.l + i*step, y: pad.t + ch*(1 - v/maxVal) };
  });
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pad.t+ch);
  pts.forEach(function(p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(pts[pts.length-1].x, pad.t+ch);
  ctx.closePath();
  var grad = ctx.createLinearGradient(0,pad.t,0,pad.t+ch);
  grad.addColorStop(0,'rgba(16,185,129,.25)');
  grad.addColorStop(1,'rgba(16,185,129,.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  pts.forEach(function(p,i){ i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y); });
  ctx.stroke();

  // Dots + labels
  pts.forEach(function(p,i) {
    ctx.beginPath();
    ctx.arc(p.x,p.y,3.5,0,Math.PI*2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    // X axis date label
    ctx.fillStyle = '#94a3b8';
    ctx.font      = '9px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(toDisplay(days[i]).slice(0,5), p.x, pad.t+ch+18);
  });
}

/* ─── OPERATOR MANAGEMENT PANEL ─────────────────────────── */
async function showOperatorPanel() {
  $('operator-panel').hidden    = false;
  $('operator-backdrop').hidden = false;
  $('op-list').innerHTML = '<div class="activity-loading">'+t('op_loading')+'</div>';
  $('op-error').hidden   = true;

  try {
    var json = await fetchOperators();
    var ops  = json.operators || [];
    if (!ops.length) {
      $('op-list').innerHTML = '<div class="activity-empty">'+t('op_empty')+'</div>';
      return;
    }
    $('op-list').innerHTML = ops.map(function(op) {
      return '<div class="op-row">'+
        '<div class="op-info">'+
          '<div class="op-name">'+op.name+'</div>'+
          '<div class="op-meta">'+
            '<span class="op-code">'+op.ownerCode+'</span>'+
            '<span class="op-user">@'+op.username+'</span>'+
          '</div>'+
        '</div>'+
        '<button class="op-del-btn" data-username="'+op.username+'">'+t('op_btn_remove')+'</button>'+
      '</div>';
    }).join('');

    // Delete handlers
    $('op-list').querySelectorAll('.op-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var uname = btn.dataset.username;
        showModal({
          icon:'✕', iconClass:'icon-reject',
          title:t('op_remove_title'),
          detail:t('op_remove_detail')+' <strong>@'+uname+'</strong>? '+t('op_remove_note'),
          confirmText:t('op_remove_ok'), confirmClass:'btn-red', danger:true,
          onConfirm: async function() {
            try {
              await deleteOperator(uname);
              showOperatorPanel();
              toast('✓ @'+uname+' '+t('op_toast_removed'));
            } catch(e) { toastError('Error: '+e.message); }
          }
        });
      });
    });
  } catch(e) {
    $('op-list').innerHTML = '';
    $('op-error').textContent = 'Error: '+e.message;
    $('op-error').hidden = false;
  }
}

async function handleCreateOperator() {
  var username  = $('op-new-user').value.trim();
  var password  = $('op-new-pass').value.trim();
  var ownerCode = $('op-new-code').value.trim().toUpperCase();
  var name      = $('op-new-name').value.trim();
  $('op-error').hidden = true;

  if (!username||!password||!ownerCode) {
    $('op-error').textContent = t('op_err_required');
    $('op-error').hidden = false;
    return;
  }
  if (!/^ENT-\d+$/.test(ownerCode)) {
    $('op-error').textContent = t('op_err_format');
    $('op-error').hidden = false;
    return;
  }
  try {
    await createOperator({ username, password, ownerCode, name });
    $('op-new-user').value=$('op-new-pass').value=$('op-new-code').value=$('op-new-name').value='';
    showOperatorPanel();
    toast('✓ @'+username+' '+t('op_toast_created'));
  } catch(e) {
    $('op-error').textContent = 'Error: '+e.message;
    $('op-error').hidden = false;
  }
}

/* ─── PERSIST ────────────────────────────────────────────── */
function savePayments() {
  try { localStorage.setItem('pb_payments_v2', JSON.stringify(state.payments)); } catch(e){}
}
function loadPayments() {
  try {
    var r=localStorage.getItem('pb_payments_v2');
    if (r) state.payments=JSON.parse(r);
  } catch(e){}
}

/* ─── LOAD DATA ──────────────────────────────────────────── */
async function loadData() {
  state.dateFrom=$('date-from').value||todayStr();
  state.dateTo  =$('date-to').value  ||todayStr();
  if (state.dateFrom>state.dateTo){ toast(t('toast_date_error')); return; }
  setLoading('Cargando '+toDisplay(state.dateFrom)+' → '+toDisplay(state.dateTo)+'…');
  try {
    $('loading-msg').textContent=t('loading_empresarios');
    var rawEmps=await fetchAllEmpresas();
    state.empresarios=rawEmps.map(function(u){
      return{ id:u.id, login:u.login, firstName:u.first_name||'', lastName:u.last_name||'',
              ownerCode:u.owner_code||'', rut:u.rut_number||'' };
    });

    $('loading-msg').textContent=t('loading_approvals');
    await fetchApprovals();

    $('loading-msg').textContent=t('loading_aramco');
    await fetchAramco();

    $('loading-msg').textContent=t('loading_services');
    var allRows=await fetchAllServices(state.dateFrom,state.dateTo);

    state.services={};
    var nameMap={};
    state.empresarios.forEach(function(emp){
      nameMap[(emp.firstName+' '+emp.lastName).trim().toLowerCase()]=emp.ownerCode;
    });
    allRows.forEach(function(row){
      var razon=(row[COL.razonSocial]||'').trim().toLowerCase();
      var code=nameMap[razon];
      if (!code){ Object.keys(nameMap).some(function(n){ if(razon.includes(n)||n.includes(razon)){code=nameMap[n];return true;} }); }
      code=code||'__unmatched__';
      if (!state.services[code]) state.services[code]=[];
      state.services[code].push(row);
    });

    setReady(); renderCards();
    var withSvc=state.empresarios.filter(function(e){ return (state.services[e.ownerCode]||[]).length>0; }).length;
    toast('✓ '+allRows.length+' '+t('s_services').toLowerCase()+' · '+withSvc+' '+t('s_count').toLowerCase()+' '+t('toast_loaded').split('·')[1].trim());
  } catch(err){ console.error(err); setError(err.message); }
}

/* ─── EVENTOS ────────────────────────────────────────────── */
$('login-btn').addEventListener('click', doLogin);
['login-user','login-pass'].forEach(function(id){
  $(id).addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });
});

$('btn-logout').addEventListener('click', function(){
  if (state.role === 'empresario') {
    // Empresario: simple logout, no summary
    clearSession();
    hide('empresario-view');
    showLogin();
  } else {
    showSessionSummary();
  }
});

function showSessionSummary() {
  // Build today's summary from payments and approvals
  var today = todayStr();
  var approved=[], rejected=[], paid=[];

  state.empresarios.forEach(function(emp) {
    var byDay = groupByDay(state.services[emp.ownerCode]||[]);
    Object.keys(byDay).forEach(function(d) {
      if (d !== today) return;
      var key = approvalKey(emp.ownerCode, d);
      var ap  = state.approvals[key];
      var pm  = state.payments[key];
      var name = emp.firstName+' '+emp.lastName;
      var stats = calcStats(byDay[d]);
      var final = calcFinalNeto(stats.neto, emp.ownerCode, d);
      if (pm && pm.status==='paid' && pm.by===state.username) paid.push({ name:name, amount:final, ref:pm.transferRef });
      else if (ap && ap.by===state.username) {
        if (ap.status==='approved') approved.push({ name:name, amount:final });
        if (ap.status==='rejected') rejected.push({ name:name });
      }
    });
  });

  var totalPaid     = paid.reduce(function(s,x){ return s+x.amount; }, 0);
  var totalApproved = approved.reduce(function(s,x){ return s+x.amount; }, 0);
  // Para supervisor: días que siguen pendientes (sin aprobar)
  var stillPendingCount = state.empresarios.filter(function(emp) {
    return Object.keys(groupByDay(state.services[emp.ownerCode]||[])).some(function(d) {
      return getDayStatus(emp.ownerCode, d) === 'pending';
    });
  }).length;

  // Para contable: días aprobados que aún no han sido depositados
  var approvedNotPaidCount = state.empresarios.filter(function(emp) {
    return Object.keys(groupByDay(state.services[emp.ownerCode]||[])).some(function(d) {
      return getDayStatus(emp.ownerCode, d) === 'approved';
    });
  }).length;

  var html = '<div style="width:100%">';

  if (state.role === 'supervisor') {
    html += summaryRow('✓ Aprobados hoy', approved.length+' empresarios · '+formatCLP(totalApproved), 'var(--green)');
    html += summaryRow('✕ Rechazados hoy', rejected.length+' empresarios', rejected.length>0?'var(--red)':'var(--text3)');
    if (stillPendingCount>0) html += summaryRow('⚠ Pendientes aún', stillPendingCount+' empresarios sin aprobar', 'var(--yellow)');
  } else {
    html += summaryRow('💳 Depositados hoy', paid.length+' pagos · '+formatCLP(totalPaid), paid.length>0?'var(--blue)':'var(--text3)');
    if (approvedNotPaidCount>0) html += summaryRow('⏳ Aprobados sin depositar', approvedNotPaidCount+' pendientes de depósito', 'var(--yellow)');
  }

  if (!approved.length && !paid.length && !rejected.length) {
    html += '<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">Sin actividad registrada hoy.</div>';
  }

  html += '</div>';

  $('ss-content').innerHTML = html;
  $('ss-title').textContent = 'Resumen de sesión — '+toDisplay(today);
  $('session-summary-overlay').hidden = false;

  $('ss-confirm').onclick = function() {
    $('session-summary-overlay').hidden = true;
    clearSession(); state.empresarios=[]; state.services={};
    state.approvals={}; state.aramco={}; state.expanded=new Set();
    resetAppState(); showLogin();
  };
  $('ss-cancel').onclick = function() {
    $('session-summary-overlay').hidden = true;
  };
}

function summaryRow(label, value, color) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">' +
    '<span style="font-size:13px;color:var(--text2)">'+label+'</span>' +
    '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:'+(color||'var(--text)')+'">'+value+'</span>' +
    '</div>';
}

$('btn-load').addEventListener('click', loadData);

$('date-from').addEventListener('change', function(){
  if ($('date-to').value && $('date-to').value<$('date-from').value) $('date-to').value=$('date-from').value;
  $('date-to').min=$('date-from').value;
});

document.querySelectorAll('.filter-pill').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.filter-pill').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    state.filter=btn.dataset.filter;
    renderCards();
  });
});

$('search-input').addEventListener('input', function(e){ state.search=e.target.value; renderCards(); });
$('hide-empty').addEventListener('change', function(e){ state.hideEmpty=e.target.checked; renderCards(); });

/* ─── APROBAR TODOS ─────────────────────────────────────── */
$('btn-approve-all').addEventListener('click', function() {
  var pending = [];
  state.empresarios.forEach(function(emp) {
    var byDay = groupByDay(state.services[emp.ownerCode]||[]);
    Object.keys(byDay).forEach(function(d) {
      if (getDayStatus(emp.ownerCode, d) === 'pending') {
        var stats = calcStats(byDay[d]);
        pending.push({ code: emp.ownerCode, isoDate: d, stats: stats,
          name: emp.firstName+' '+emp.lastName });
      }
    });
  });

  if (!pending.length) { toast('No hay pagos pendientes para aprobar.'); return; }

  var totalNeto = pending.reduce(function(s,x){ return s + calcFinalNeto(x.stats.neto, x.code, x.isoDate); }, 0);

  showModal({
    icon: '✓', iconClass: 'icon-approve',
    title: 'Aprobar todos los pendientes',
    detail: 'Se aprobarán <strong>'+pending.length+' pago'+(pending.length>1?'s':'')+'</strong> por un total de:'+
            '<span class="amount">'+formatCLP(totalNeto)+'</span>',
    confirmText: 'Aprobar todos', confirmClass: 'btn-green',
    onConfirm: async function() {
      var done = 0;
      for (var i=0; i<pending.length; i++) {
        var p   = pending[i];
        var key = approvalKey(p.code, p.isoDate);
        try {
          await postApproval(key, 'approved');
          state.approvals[key] = { status:'approved', by:state.username, at:new Date().toISOString() };
          logActivity('approved', p.code, p.isoDate, formatCLP(calcFinalNeto(p.stats.neto,p.code,p.isoDate)), p.name);
          done++;
        } catch(e) { console.warn('approve failed:', p.code, e.message); }
      }
      renderCards();
      toast('✓ '+done+' pago'+(done>1?'s':'')+' aprobados');
    }
  });
});

/* ─── HISTORIAL ──────────────────────────────────────────── */
$('btn-activity').addEventListener('click', function() {
  showActivityPanel();
});
$('activity-close').addEventListener('click', function() {
  $('activity-panel').hidden = true;
  $('activity-backdrop').hidden = true;
});
$('activity-backdrop').addEventListener('click', function() {
  $('activity-panel').hidden = true;
  $('activity-backdrop').hidden = true;
});

async function showActivityPanel() {
  $('activity-panel').hidden = false;
  $('activity-backdrop').hidden = false;
  $('activity-list').innerHTML = '<div class="activity-loading">Cargando…</div>';

  var entries = await fetchActivity();

  if (!entries.length) {
    $('activity-list').innerHTML = '<div class="activity-empty">Sin actividad registrada.</div>';
    return;
  }

  var ACTION_ICON  = { approved:'✓', rejected:'✕', paid:'💳' };
  var ACTION_CLASS = { approved:'act-approved', rejected:'act-rejected', paid:'act-paid' };
  var ACTION_LABEL = { approved:'Aprobado', rejected:'Rechazado', paid:'Depositado' };

  var html = entries.map(function(e) {
    var dt = e.at ? new Date(e.at).toLocaleString('es-CL',{
      day:'2-digit',month:'2-digit',year:'numeric',
      hour:'2-digit',minute:'2-digit'
    }) : '—';
    return '<div class="act-entry '+ACTION_CLASS[e.action]+'">' +
      '<div class="act-icon">'+ACTION_ICON[e.action]+'</div>' +
      '<div class="act-body">' +
        '<div class="act-name">'+e.name+'<span class="act-code">'+e.code+'</span></div>' +
        '<div class="act-meta">'+
          '<span class="act-badge act-badge-'+e.action+'">'+ACTION_LABEL[e.action]+'</span>'+
          (e.isoDate?'<span>'+toDisplay(e.isoDate)+'</span>':'')+
          (e.amount?'<span class="act-amount">'+e.amount+'</span>':'')+
        '</div>' +
      '</div>' +
      '<div class="act-right">' +
        '<div class="act-by">'+e.by+'</div>' +
        '<div class="act-time">'+dt+'</div>' +
      '</div>' +
    '</div>';
  }).join('');

  $('activity-list').innerHTML = html;
}

/* ─── OPERATOR PANEL BUTTON ─────────────────────────────── */
var btnOps = $('btn-operators');
if (btnOps) {
  btnOps.addEventListener('click', showOperatorPanel);
}
var opClose    = $('operator-close');
var opBackdrop = $('operator-backdrop');
if (opClose)    opClose.addEventListener('click',    function(){ $('operator-panel').hidden=true; $('operator-backdrop').hidden=true; });
if (opBackdrop) opBackdrop.addEventListener('click', function(){ $('operator-panel').hidden=true; $('operator-backdrop').hidden=true; });

// Show operators button for supervisor only
if (state.role === 'supervisor' && btnOps) btnOps.hidden = false;

/* ─── PDF DOWNLOAD ───────────────────────────────────────── */
function evDownloadPDF() {
  if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
    toast('PDF library not loaded. Try refreshing the page.'); return;
  }
  var { jsPDF } = window.jspdf || jspdf;
  var doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  var rows = evData.services;
  var byDay= groupByDay(rows);
  var days = Object.keys(byDay).sort();

  var tProd=0,tCom=0,tNeto=0,tAramco=0;
  rows.forEach(function(r){
    tProd  += parseMoney(r[COL.produccion]);
    tCom   += parseMoney(r[COL.comision]);
    tNeto  += parseMoney(r[COL.totalNeto]);
  });
  days.forEach(function(d){ tAramco += evData.aramco[approvalKey(state.ownerCode,d)]||0; });
  var tFinal = tNeto - tAramco;

  // ── Header
  doc.setFillColor(255,92,96);
  doc.rect(0,0,210,22,'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(14); doc.setFont('helvetica','bold');
  doc.text('PULLMAN BUS', 14, 10);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text('Operator Payment Statement', 14, 16);
  doc.text('Printed: '+new Date().toLocaleDateString('en-GB'), 196, 16, { align:'right' });

  // ── Operator info
  doc.setTextColor(15,23,42);
  doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text(state.operatorName || state.username, 14, 32);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.setTextColor(100,116,139);
  doc.text(state.ownerCode, 14, 37);
  doc.text('Period: '+toDisplay(state.dateFrom)+' → '+toDisplay(state.dateTo), 14, 42);

  // ── Financial summary box
  doc.setFillColor(248,250,252);
  doc.roundedRect(14,48,182,38,2,2,'F');
  doc.setDrawColor(229,231,235);
  doc.roundedRect(14,48,182,38,2,2,'S');

  var cols = [
    { label:'Gross Production', value:formatCLP(tProd), color:[15,23,42] },
    { label:'Commission',       value:formatCLP(tCom),  color:[239,68,68] },
    { label:'Fuel (Aramco)',    value:formatCLP(tAramco),color:[239,68,68] },
    { label:'TOTAL TO RECEIVE', value:formatCLP(tFinal),color:[16,185,129] },
  ];
  cols.forEach(function(col,i) {
    var x = 14 + i*46;
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(148,163,184);
    doc.text(col.label.toUpperCase(), x+2, 57);
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor.apply(doc, col.color);
    doc.text(col.value, x+2, 65);
    // Services count on last col
    if (i===3) {
      doc.setFontSize(7); doc.setTextColor(100,116,139);
      doc.text(rows.length+' services', x+2, 71);
    }
  });

  // ── Status by day
  doc.setTextColor(15,23,42);
  doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text('Payment Status', 14, 96);
  doc.setDrawColor(229,231,235); doc.line(14,99,196,99);

  var y = 105;
  var STATUS_COLORS = { paid:[59,130,246], approved:[16,185,129], rejected:[239,68,68], pending:[245,158,11] };
  days.forEach(function(d) {
    var status = evGetDayStatus(d);
    var pm     = evData.payments[approvalKey(state.ownerCode,d)];
    var ds     = calcStats(byDay[d]);
    var aramco = evData.aramco[approvalKey(state.ownerCode,d)]||0;
    var final  = ds.neto - aramco;

    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42);
    doc.text(toDisplay(d), 14, y);
    doc.text(ds.count+' svc', 60, y);
    doc.text('Prod: '+formatCLP(ds.prod), 80, y);
    doc.text('Net: '+formatCLP(final), 130, y);

    // Status pill
    var sc = STATUS_COLORS[status]||[100,116,139];
    doc.setFillColor(sc[0],sc[1],sc[2]);
    doc.roundedRect(168,y-5,24,7,1,1,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(7); doc.setFont('helvetica','bold');
    doc.text(status.charAt(0).toUpperCase()+status.slice(1), 180, y, { align:'center' });

    if (status==='paid'&&pm) {
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139);
      doc.text('Ref: '+pm.transferRef, 14, y+5);
      y += 5;
    }
    y += 8;
    if (y > 260) { doc.addPage(); y = 20; }
  });

  // ── Services table
  if (y > 230) { doc.addPage(); y = 20; }
  y += 4;
  doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42);
  doc.text('Service Detail', 14, y); y += 6;
  doc.setDrawColor(229,231,235); doc.line(14,y,196,y); y += 5;

  // Table header
  doc.setFillColor(248,250,252);
  doc.rect(14,y-4,182,7,'F');
  doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139);
  ['Date','Time','Origin → Dest','Bus','Status','Seats','Net Total'].forEach(function(h,i) {
    var xs = [14,34,50,106,126,146,162];
    doc.text(h, xs[i], y);
  });
  y += 6;
  doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42);

  rows.slice(0,40).forEach(function(r) { // max 40 rows in PDF
    if (y > 270) { doc.addPage(); y = 20; }
    doc.setFontSize(7);
    var dest = (r[COL.origen]||'')+'→'+(r[COL.destino]||'');
    doc.text(r[COL.fecha]||'', 14, y);
    doc.text(r[COL.hora]||'', 34, y);
    doc.text(dest.substring(0,24), 50, y);
    doc.text((r[COL.bus]||''), 106, y);
    doc.text((r[COL.estado]||'').substring(0,10), 126, y);
    doc.text(String(r[COL.asientosSuc]||0), 146, y);
    doc.text(r[COL.totalNeto]||'$0', 162, y);
    y += 5;
  });
  if (rows.length > 40) {
    doc.setFontSize(7); doc.setTextColor(100,116,139);
    doc.text('... and '+(rows.length-40)+' more services', 14, y+2);
  }

  // ── Footer
  var pages = doc.internal.getNumberOfPages();
  for (var i=1; i<=pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(148,163,184);
    doc.text('Pullman Bus · Confidential · Page '+i+'/'+pages, 105, 290, { align:'center' });
  }

  doc.save('PullmanBus_'+state.ownerCode+'_'+state.dateFrom+'_to_'+state.dateTo+'.pdf');
  toast('✓ PDF downloaded');
}

// Lang toggle
document.querySelectorAll('.lang-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    applyLang(btn.dataset.lang);
  });
});

/* ─── INIT ───────────────────────────────────────────────── */
(function init(){
  loadPayments();
  applyLang(currentLang); // apply saved language on load
  if (loadSession()) showApp(); else showLogin();
}());