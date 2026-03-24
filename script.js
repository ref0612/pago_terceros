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
  if (t&&r){ state.sessionToken=t; state.role=r; state.username=u||''; return true; }
  return false;
}
function clearSession() {
  state.sessionToken=''; state.role=''; state.username='';
  ['pb_session','pb_role','pb_username'].forEach(function(k){ sessionStorage.removeItem(k); });
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

/* ─── LOGIN ──────────────────────────────────────────────── */
function showLogin(){ hide('app'); show('login-screen'); $('login-user').focus(); }

function showApp() {
  hide('login-screen'); show('app');
  $('date-from').value=state.dateFrom;
  $('date-to').value  =state.dateTo;
  $('header-username').textContent = state.username;
  $('header-role').textContent     = state.role==='supervisor'?'Supervisor':'Contable';
  $('header-role').className       = 'header-role-badge '+(state.role==='supervisor'?'role-supervisor':'role-contable');
  resetAppState();
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
  if (!username||!password){ showLoginError('Ingresa usuario y contraseña.'); return; }
  setLoginLoading(true); hide('login-error');
  try {
    var res=await fetch('/api/auth',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
    var json=await res.json();
    if (!res.ok||!json.ok) throw new Error(json.error||'Credenciales incorrectas');
    saveSession(json.token,json.role,username);
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
      '<div class="state-title">Sin resultados</div>'+
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
      pending:'Pendiente', approved:'Aprobado',
      rejected:'Rechazado', paid:'Pagado', parcial:'Parcial'
    };

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
            '<span class="'+(hasRows?'meta-count-active':'')+'">'+rows.length+' servicio'+(rows.length!==1?'s':'')+'</span>'+
          '</div>'+
        '</div>'+
        '<div class="emp-flow">'+
          /* Producción */
          '<div class="flow-block">'+
            '<div class="flow-label">PRODUCCIÓN</div>'+
            '<div class="flow-value flow-prod">'+formatCLP(totals.prod)+'</div>'+
            '<div class="flow-sub">'+rows.length+' servicio'+(rows.length!==1?'s':'')+'</div>'+
          '</div>'+
          /* Flecha + deducciones */
          '<div class="flow-arrow">→</div>'+
          '<div class="flow-block flow-deductions">'+
            '<div class="flow-label">DEDUCCIONES</div>'+
            '<div class="flow-ded-row"><span class="flow-ded-lbl">Comisión</span><span class="flow-ded-val">'+formatCLP(totals.com)+'</span></div>'+
            '<div class="flow-ded-row"><span class="flow-ded-lbl">Gastos</span><span class="flow-ded-val '+(totals.gastos>0?'flow-ded-yellow':'flow-ded-muted')+'">'+(totals.gastos>0?formatCLP(totals.gastos):'—')+'</span></div>'+
            '<div class="flow-ded-row"><span class="flow-ded-lbl">Aramco</span><span class="flow-ded-val '+(empAramcoTotal>0?'flow-ded-red':'flow-ded-muted')+'">'+(empAramcoTotal>0?'−'+formatCLP(empAramcoTotal):'—')+'</span></div>'+
          '</div>'+
          /* Flecha + Total */
          '<div class="flow-arrow flow-arrow-accent">→</div>'+
          '<div class="flow-block flow-total">'+
            '<div class="flow-label">TOTAL A PAGAR</div>'+
            '<div class="flow-value flow-neto">'+formatCLP(calcFinalNetoTotal(emp.ownerCode))+'</div>'+
          '</div>'+
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
  if (!rows.length) return '<div class="day-empty">Sin servicios en el período seleccionado</div>';

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
        dayActions='<span class="day-paid-label">✓ Depositado</span>';
      } else if (status==='approved') {
        dayActions=
          '<span class="day-by">por '+((ap&&ap.by)||'—')+'</span>'+
          '<button class="day-btn day-btn-reject" data-day-action="reject" data-iso-date="'+isoDate+'">Rechazar</button>';
      } else if (status==='rejected') {
        dayActions=
          '<button class="day-btn day-btn-approve" data-day-action="approve" data-iso-date="'+isoDate+'">Aprobar</button>';
      } else {
        dayActions=
          '<button class="day-btn day-btn-approve" data-day-action="approve" data-iso-date="'+isoDate+'">✓ Aprobar</button>'+
          '<button class="day-btn day-btn-reject"  data-day-action="reject"  data-iso-date="'+isoDate+'">✕ Rechazar</button>';
      }
    } else { // contable
      if (status==='paid') {
        dayActions='<button class="day-btn day-btn-detail" data-day-action="detail" data-iso-date="'+isoDate+'">Ver comprobante ↗</button>';
      } else if (status==='approved') {
        dayActions=
          '<span class="day-by">✓ '+((ap&&ap.by)||'—')+'</span>'+
          '<button class="day-btn day-btn-deposit" data-day-action="deposit" data-iso-date="'+isoDate+'">Depositar</button>';
      } else if (status==='rejected') {
        dayActions='<span class="day-rejected-label">✕ Rechazado</span>';
      } else {
        dayActions='<span class="day-pending-label">Pendiente aprobación</span>';
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
      '<th>Hora</th><th>Ruta</th><th>Servicio</th><th>Bus·Pat.</th><th>Estado</th>'+
      '<th class="num">Asientos</th><th class="num">Producción</th><th class="num">Comisión</th><th class="num">Total Neto</th>'+
    '</tr></thead>'+
    '<tbody>'+trs+
      '<tr class="subtotal-row">'+
        '<td colspan="6" style="text-align:right;color:var(--text3)">TOTALES</td>'+
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
    title:'Aprobar pago · '+toDisplay(isoDate),
    detail:'Aprobando pago del <strong>'+toDisplay(isoDate)+'</strong> a <strong>'+emp.firstName+' '+emp.lastName+'</strong>'+
           '<span class="amount">'+formatCLP(calcFinalNeto(stats.neto,code,isoDate))+'</span>'+
           (getAramcoDay(code,isoDate)>0?'<div style="font-size:11px;color:var(--text3);margin-top:2px">Neto Konnect: '+formatCLP(stats.neto)+' − Aramco: '+formatCLP(getAramcoDay(code,isoDate))+'</div>':''),
    confirmText:'Sí, aprobar', confirmClass:'btn-green',
    onConfirm: async function() {
      try {
        var key=approvalKey(code,isoDate);
        await postApproval(key,'approved');
        state.approvals[key]={ status:'approved', by:state.username, at:new Date().toISOString() };
        renderCards();
        toast('✓ '+toDisplay(isoDate)+' aprobado para '+emp.firstName);
      } catch(err){ toastError('Error: '+err.message); }
    }
  });
}

async function handleRejectDay(code, isoDate) {
  var emp=state.empresarios.find(function(e){ return e.ownerCode===code; });
  showModal({
    icon:'✕', iconClass:'icon-reject',
    title:'Rechazar pago · '+toDisplay(isoDate),
    detail:'¿Rechazar pago del <strong>'+toDisplay(isoDate)+'</strong> a <strong>'+emp.firstName+' '+emp.lastName+'</strong>?',
    confirmText:'Sí, rechazar', confirmClass:'btn-red', danger:true,
    onConfirm: async function() {
      try {
        var key=approvalKey(code,isoDate);
        await postApproval(key,'rejected');
        state.approvals[key]={ status:'rejected', by:state.username, at:new Date().toISOString() };
        renderCards();
        toast('Rechazado '+toDisplay(isoDate)+' para '+emp.firstName);
      } catch(err){ toastError('Error: '+err.message); }
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
    title:'Depositar · '+toDisplay(isoDate),
    detail:'Depósito del <strong>'+toDisplay(isoDate)+'</strong> a <strong>'+emp.firstName+' '+emp.lastName+'</strong>'+
           '<span class="amount">'+formatCLP(calcFinalNeto(stats.neto,code,isoDate))+'</span>'+
           (getAramcoDay(code,isoDate)>0?'<div style="font-size:11px;color:var(--text3);margin-top:2px">Neto Konnect: '+formatCLP(stats.neto)+' − Aramco: '+formatCLP(getAramcoDay(code,isoDate))+'</div>':'')
           +(ap&&ap.by?'<div style="font-size:12px;color:var(--text2)">Aprobado por: '+ap.by+'</div>':''),
    inputLabel:'N° DE TRANSFERENCIA / COMPROBANTE',
    inputPlaceholder:'Ej: 123456789',
    confirmText:'Confirmar depósito', confirmClass:'btn-blue',
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
      savePayments(); renderCards();
      toast('✓ Depósito '+toDisplay(isoDate)+' registrado para '+emp.firstName);
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
    title:'Depositar rango aprobado',
    detail:'Depositando <strong>'+approvedDays.length+' día'+(approvedDays.length>1?'s':'')+
           '</strong> aprobados a <strong>'+emp.firstName+' '+emp.lastName+'</strong>'+
           '<span class="amount">'+formatCLP(totalNeto)+'</span>'+
           '<div style="font-size:11px;color:var(--text3);margin-top:4px">Días: '+approvedDays.map(toDisplay).join(', ')+'</div>',
    inputLabel:'N° DE TRANSFERENCIA / COMPROBANTE',
    inputPlaceholder:'Ej: 123456789',
    confirmText:'Confirmar depósito', confirmClass:'btn-blue',
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
    detailRow('Empresario', p.name||'—')+
    detailRow('Fecha servicio', toDisplay(p.date||isoDate))+
    detailRow('Total pagado','<span style="color:var(--green);font-family:var(--mono);font-size:18px;font-weight:700">'+(p.amount||'$0')+'</span>')+
    (p.amountKonnect&&p.amountKonnect!==p.amount?detailRow('Neto Konnect', p.amountKonnect):'')+
    (p.amountAramco&&p.amountAramco!=='$0'?detailRow('Descuento Aramco','<span style="color:var(--red)">−'+p.amountAramco+'</span>'):'')+
    detailRow('N° Transferencia','<span style="font-family:var(--mono);font-size:15px;color:var(--blue)">'+(p.transferRef||'—')+'</span>')+
    detailRow('Depositado por', p.by||'—')+
    detailRow('Aprobado por',   p.approvedBy||'—')+
    detailRow('Fecha depósito', atStr)+
    (p.rangeDeposit?detailRow('Tipo','Depósito por rango'):'')
    +'</table></div>'
  );
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
  if (state.dateFrom>state.dateTo){ toast('⚠ DESDE no puede ser mayor que HASTA'); return; }
  setLoading('Cargando '+toDisplay(state.dateFrom)+' → '+toDisplay(state.dateTo)+'…');
  try {
    $('loading-msg').textContent='Obteniendo empresarios…';
    var rawEmps=await fetchAllEmpresas();
    state.empresarios=rawEmps.map(function(u){
      return{ id:u.id, login:u.login, firstName:u.first_name||'', lastName:u.last_name||'',
              ownerCode:u.owner_code||'', rut:u.rut_number||'' };
    });

    $('loading-msg').textContent='Cargando aprobaciones…';
    await fetchApprovals();

    $('loading-msg').textContent='Cargando cargos Aramco…';
    await fetchAramco();

    $('loading-msg').textContent='Cargando servicios…';
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
    toast('✓ '+allRows.length+' servicios · '+withSvc+' empresarios activos');
  } catch(err){ console.error(err); setError(err.message); }
}

/* ─── EVENTOS ────────────────────────────────────────────── */
$('login-btn').addEventListener('click', doLogin);
['login-user','login-pass'].forEach(function(id){
  $(id).addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });
});

$('btn-logout').addEventListener('click', function(){
  clearSession(); state.empresarios=[]; state.services={};
  state.approvals={}; state.aramco={}; state.expanded=new Set();
  resetAppState(); showLogin();
});

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

/* ─── INIT ───────────────────────────────────────────────── */
(function init(){
  loadPayments();
  if (loadSession()) showApp(); else showLogin();
}());