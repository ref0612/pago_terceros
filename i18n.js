/* ══════════════════════════════════════════════════════════════
   PAGO EMPRESARIOS · PULLMAN BUS
   Internacionalización — ES / EN
   ══════════════════════════════════════════════════════════════ */

var TRANSLATIONS = {
  es: {
    // Header
    brand_sub:      'Pago a Empresarios',
    label_from:     'DESDE',
    label_to:       'HASTA',
    btn_load:       'Cargar',
    btn_logout:     'Salir',

    // Summary bar
    s_produccion:   'PRODUCCIÓN TOTAL',
    s_comision:     'COMISIÓN',
    s_gastos:       'GASTOS',
    s_aramco:       'ARAMCO',
    s_neto:         'TOTAL A PAGAR',
    s_count:        'EMPRESARIOS',
    s_services:     'SERVICIOS',
    s_period:       'PERÍODO',

    // Estado vacío
    state_empty_title: 'Seleccione el período',
    state_empty_desc:  'Elija el rango de días y haga click en Cargar.',
    state_error_title: 'Error al cargar',
    btn_retry:         'Reintentar',

    // Toolbar
    search_placeholder: 'Buscar por nombre, código o RUT…',
    filter_all:       'Todos',
    filter_pending:   'Pendiente',
    filter_approved:  'Aprobado',
    filter_parcial:   'Parcial',
    filter_rejected:  'Rechazado',
    filter_paid:      'Pagado',
    toggle_hide:      'Ocultar sin viajes',

    // Login
    login_title:    'Pullman Bus',
    login_sub:      'Sistema de Pago a Empresarios',
    login_user_lbl: 'USUARIO',
    login_pass_lbl: 'CONTRASEÑA',
    login_user_ph:  'usuario',
    login_pass_ph:  '••••••••',
    login_btn:      'Iniciar sesión',
    login_loading:  'Verificando…',
    login_note:     'Acceso restringido · Solo personal autorizado',
    login_err_empty:'Ingresa usuario y contraseña.',
    login_err_creds:'Credenciales incorrectas',

    // Roles
    role_supervisor: 'Supervisor',
    role_contable:   'Contable',

    // Badges
    badge_pending:  'Pendiente',
    badge_approved: 'Aprobado',
    badge_rejected: 'Rechazado',
    badge_paid:     'Pagado',
    badge_parcial:  'Parcial',

    // Card stats
    stat_produccion: 'Producción',
    stat_comision:   'Comisión',
    stat_gastos:     'Gastos',
    stat_aramco:     'Aramco',
    stat_total:      'Total a Pagar',
    stat_services:   'Servicios',
    stat_svc:        'svc',

    // Card meta
    svc_singular: 'servicio',
    svc_plural:   'servicios',

    // Day breakdown
    day_actions_deposit:   'Depositar',
    day_actions_approve:   '✓ Aprobar',
    day_actions_reject:    '✕ Rechazar',
    day_actions_detail:    'Ver comprobante ↗',
    day_paid_label:        '✓ Depositado',
    day_rejected_label:    '✕ Rechazado',
    day_pending_label:     'Pendiente aprobación',
    day_by_prefix:         'por',
    day_approved_by:       '✓',

    // Table headers
    th_hora:        'Hora',
    th_ruta:        'Ruta',
    th_servicio:    'Servicio',
    th_bus:         'Bus·Pat.',
    th_estado:      'Estado',
    th_asientos:    'Asientos',
    th_produccion:  'Producción',
    th_comision:    'Comisión',
    th_total_neto:  'Total Neto',
    th_totales:     'TOTALES',

    // Table empty
    table_empty: 'Sin servicios en el período seleccionado',
    no_results_title: 'Sin resultados',
    no_results_desc:  'No hay empresarios que coincidan con los filtros activos.',

    // Modals — Aprobar
    modal_approve_title:  'Aprobar pago',
    modal_approve_detail: 'Estás aprobando el pago del',
    modal_approve_to:     'a',
    modal_approve_note:   'El contable podrá proceder con el depósito.',
    modal_approve_ok:     'Sí, aprobar',

    // Modals — Rechazar
    modal_reject_title:   'Rechazar pago',
    modal_reject_detail:  '¿Rechazar pago del',
    modal_reject_note:    'El contable no podrá depositar hasta que se apruebe nuevamente.',
    modal_reject_ok:      'Sí, rechazar',

    // Modals — Depositar
    modal_deposit_title:  'Depositar',
    modal_deposit_detail: 'Depósito del',
    modal_deposit_approved_by: 'Aprobado por:',
    modal_deposit_input:  'N° DE TRANSFERENCIA / COMPROBANTE',
    modal_deposit_ph:     'Ej: 123456789',
    modal_deposit_ok:     'Confirmar depósito',

    // Modals — Rango
    modal_range_title:    'Depositar rango aprobado',
    modal_range_days:     'día',
    modal_range_days_pl:  'días',
    modal_range_approved: 'aprobados a',
    modal_range_list:     'Días:',

    // Modals — Cancelar
    modal_cancel: 'Cancelar',

    // Detail modal
    detail_empresario:  'Empresario',
    detail_date:        'Fecha servicio',
    detail_total:       'Total pagado',
    detail_neto:        'Neto Konnect',
    detail_aramco:      'Descuento Aramco',
    detail_transfer:    'N° Transferencia',
    detail_by:          'Depositado por',
    detail_approved_by: 'Aprobado por',
    detail_at:          'Fecha depósito',
    detail_range:       'Depósito por rango',
    detail_close:       'Cerrar',

    // Toasts
    toast_approved:  '✓ aprobado para',
    toast_rejected:  'Rechazado',
    toast_deposited: '✓ Depósito',
    toast_deposited2:'registrado para',
    toast_range:     '✓ Depósito rango registrado para',
    toast_days_suffix: 'días)',
    toast_error_approve: 'Error al aprobar:',
    toast_error_reject:  'Error al rechazar:',
    toast_date_error: '⚠ DESDE no puede ser mayor que HASTA',
    toast_loaded:     'servicios · empresarios activos',

    // Loading
    loading_empresarios: 'Obteniendo empresarios…',
    loading_approvals:   'Cargando aprobaciones…',
    loading_aramco:      'Cargando cargos Aramco…',
    loading_services:    'Cargando servicios…',
  },

  en: {
    // Header
    brand_sub:      'Operator Payments',
    label_from:     'FROM',
    label_to:       'TO',
    btn_load:       'Load',
    btn_logout:     'Sign out',

    // Summary bar
    s_produccion:   'TOTAL PRODUCTION',
    s_comision:     'COMMISSION',
    s_gastos:       'EXPENSES',
    s_aramco:       'ARAMCO',
    s_neto:         'TOTAL TO PAY',
    s_count:        'OPERATORS',
    s_services:     'SERVICES',
    s_period:       'PERIOD',

    // Estado vacío
    state_empty_title: 'Select a date range',
    state_empty_desc:  'Choose the date range and click Load.',
    state_error_title: 'Failed to load',
    btn_retry:         'Retry',

    // Toolbar
    search_placeholder: 'Search by name, code or ID…',
    filter_all:       'All',
    filter_pending:   'Pending',
    filter_approved:  'Approved',
    filter_parcial:   'Partial',
    filter_rejected:  'Rejected',
    filter_paid:      'Paid',
    toggle_hide:      'Hide without trips',

    // Login
    login_title:    'Pullman Bus',
    login_sub:      'Operator Payment System',
    login_user_lbl: 'USERNAME',
    login_pass_lbl: 'PASSWORD',
    login_user_ph:  'username',
    login_pass_ph:  '••••••••',
    login_btn:      'Sign in',
    login_loading:  'Verifying…',
    login_note:     'Restricted access · Authorized personnel only',
    login_err_empty:'Please enter username and password.',
    login_err_creds:'Incorrect credentials',

    // Roles
    role_supervisor: 'Supervisor',
    role_contable:   'Accountant',

    // Badges
    badge_pending:  'Pending',
    badge_approved: 'Approved',
    badge_rejected: 'Rejected',
    badge_paid:     'Paid',
    badge_parcial:  'Partial',

    // Card stats
    stat_produccion: 'Production',
    stat_comision:   'Commission',
    stat_gastos:     'Expenses',
    stat_aramco:     'Aramco',
    stat_total:      'Total to Pay',
    stat_services:   'Services',
    stat_svc:        'svc',

    // Card meta
    svc_singular: 'service',
    svc_plural:   'services',

    // Day breakdown
    day_actions_deposit:   'Deposit',
    day_actions_approve:   '✓ Approve',
    day_actions_reject:    '✕ Reject',
    day_actions_detail:    'View receipt ↗',
    day_paid_label:        '✓ Deposited',
    day_rejected_label:    '✕ Rejected',
    day_pending_label:     'Awaiting approval',
    day_by_prefix:         'by',
    day_approved_by:       '✓',

    // Table headers
    th_hora:        'Time',
    th_ruta:        'Route',
    th_servicio:    'Service',
    th_bus:         'Bus·Plate',
    th_estado:      'Status',
    th_asientos:    'Seats',
    th_produccion:  'Production',
    th_comision:    'Commission',
    th_total_neto:  'Net Total',
    th_totales:     'TOTALS',

    // Table empty
    table_empty: 'No services in the selected period',
    no_results_title: 'No results',
    no_results_desc:  'No operators match the active filters.',

    // Modals — Approve
    modal_approve_title:  'Approve payment',
    modal_approve_detail: 'Approving payment for',
    modal_approve_to:     'to',
    modal_approve_note:   'The accountant will be able to proceed with the deposit.',
    modal_approve_ok:     'Yes, approve',

    // Modals — Reject
    modal_reject_title:   'Reject payment',
    modal_reject_detail:  'Reject payment for',
    modal_reject_note:    'The accountant cannot deposit until re-approved.',
    modal_reject_ok:      'Yes, reject',

    // Modals — Deposit
    modal_deposit_title:  'Deposit',
    modal_deposit_detail: 'Deposit for',
    modal_deposit_approved_by: 'Approved by:',
    modal_deposit_input:  'TRANSFER / REFERENCE NUMBER',
    modal_deposit_ph:     'e.g. 123456789',
    modal_deposit_ok:     'Confirm deposit',

    // Modals — Range
    modal_range_title:    'Deposit approved range',
    modal_range_days:     'day',
    modal_range_days_pl:  'days',
    modal_range_approved: 'approved for',
    modal_range_list:     'Days:',

    // Modals — Cancel
    modal_cancel: 'Cancel',

    // Detail modal
    detail_empresario:  'Operator',
    detail_date:        'Service date',
    detail_total:       'Total paid',
    detail_neto:        'Konnect net',
    detail_aramco:      'Aramco deduction',
    detail_transfer:    'Transfer No.',
    detail_by:          'Deposited by',
    detail_approved_by: 'Approved by',
    detail_at:          'Deposit date',
    detail_range:       'Range deposit',
    detail_close:       'Close',

    // Toasts
    toast_approved:  '✓ approved for',
    toast_rejected:  'Rejected',
    toast_deposited: '✓ Deposit',
    toast_deposited2:'registered for',
    toast_range:     '✓ Range deposit registered for',
    toast_days_suffix: 'days)',
    toast_error_approve: 'Error approving:',
    toast_error_reject:  'Error rejecting:',
    toast_date_error: '⚠ FROM date cannot be greater than TO',
    toast_loaded:     'services · active operators',

    // Loading
    loading_empresarios: 'Fetching operators…',
    loading_approvals:   'Loading approvals…',
    loading_aramco:      'Loading Aramco charges…',
    loading_services:    'Loading services…',
  }
};

/* ─── Lang state ─────────────────────────────────────────── */
var currentLang = localStorage.getItem('pb_lang') || 'es';

function t(key) {
  return (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key])
    || TRANSLATIONS['es'][key]
    || key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('pb_lang', lang);
}
