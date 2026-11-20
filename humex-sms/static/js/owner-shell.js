/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Owner panel shell
   Same shell/skin as the agent and client panels.
   Rebuilds the frame (header, menu, breadcrumb) and applies the skin.
   Loads AFTER owner-engine.js / owner-features.js.
   ═══════════════════════════════════════════════════════════════ */

/* Theme engine & sidebar toggle are provided by shared-brand-theme.js & shared-ui-kit.js */
const ZY_LOGO_SRC = window.ZY_LOGO_SRC || '/static/img/humex-sms-logo.png';

const ZY_ADMIN_MENU = [
  { t: null, c: '#e0a030', items: [
      ['Dashboard', 'dashboard', 'fa-gauge-high'],
  ] },
  { t: null, c: '#16a34a', items: [
      ['Live Chat', 'live-chat', 'fa-comments'],
  ] },
  { t: "NUMBERS & INVENTORY", i: 'fa-sim-card', c: '#d97706', items: [
      ['Numbers Pool Hub', 'my-numbers', 'fa-mobile-screen'],
      ['Ranges & Rate Card', 'sms-ranges', 'fa-table-list'],
      ['Upload & Blacklist', 'upload-numbers', 'fa-cloud-arrow-up'],
      ['Allocation & Transfer Log', 'allocation-history', 'fa-file-lines'],
  ] },
  { t: "SMS & ANALYTICS", i: 'fa-chart-line', c: '#2563eb', items: [
      ['SMS CDR Reports', 'my-sms', 'fa-comment-sms'],
      ['CDR 2 (Whitenoise)', 'cdr2', 'fa-tower-cell'],
      ['Failed SMS', 'failed-sms', 'fa-triangle-exclamation'],
      ['Live Monitor', 'live-otp-feed', 'fa-signal'],
      ['Analytics & Reports', 'sms-analytics', 'fa-chart-pie'],
  ] },
  { t: "PROVIDERS", i: 'fa-plug', c: '#16a34a', items: [
      ['CR API Panels', 'cr-api-panels', 'fa-link'],
      ['Web Scraping Panels', 'login-panels', 'fa-globe'],
      ['Whitenoise Excel Reports', 'whitenoise-panels', 'fa-file-excel'],
  ] },
  { t: "PAYMENTS", i: 'fa-wallet', c: '#059669', items: [
      ['Agent Payment Requests', 'payout-requests', 'fa-hand-holding-dollar'],
      ['My Payouts', 'my-payouts', 'fa-sack-dollar'],
      ['Account Balances', 'account-balances', 'fa-coins'],
      ['Statements', 'statements', 'fa-file-invoice-dollar'],
      ['Credit Notes', 'credit-notes', 'fa-receipt'],
  ] },
  { t: "ACCOUNTS & SECURITY", i: 'fa-shield-halved', c: '#dc2626', items: [
      ['Accounts & Hierarchy', 'agents', 'fa-user-secret'],
      ['Security & Firewall', 'firewall-dashboard', 'fa-shield-halved'],
      ['Audit Logs', 'audit-logs', 'fa-clipboard-list'],
  ] },
  { t: "PLATFORM & SUPPORT", i: 'fa-sliders', c: '#ea580c', items: [
      ['General & Brand Settings', 'general-settings', 'fa-gear'],
      ['Notifications', 'notifications', 'fa-bell'],
      ['Communication Hub', 'announcements', 'fa-bullhorn'],
  ] },
  { t: "AGENT REQUESTS", i: 'fa-inbox', c: '#0284c7', items: [
      ['Agent Number Requests', 'agent-requests', 'fa-sim-card'],
      ['Registration Requests', 'registration-requests', 'fa-user-plus'],
  ] },
  { t: null, c: '#0284c7', items: [
      ['My Profile', 'my-profile', 'fa-user'],
  ] }
];


/* ── chart fallback: the admin pages use Chart.js from a CDN; if that is blocked
      we draw a simple line/bar chart ourselves so no page can crash ────────── */
if (typeof window.Chart === 'undefined') {
  window.Chart = function (cv, cfg) {
    cv = (cv && cv.canvas) ? cv.canvas : cv;
    const ds = ((cfg.data || {}).datasets || [{}])[0] || {};
    const data = (ds.data || []).map(v => Number(v) || 0);
    const labels = (cfg.data || {}).labels || [];
    const type = cfg.type || 'line';
    const box = cv.getBoundingClientRect();
    const W = cv.width = Math.max(240, box.width || 320);
    const H = cv.height = Math.max(160, box.height || 200);
    const c = cv.getContext('2d');
    const L = 40, R = 10, T = 12, B = 28, w = W - L - R, h = H - T - B;
    const top = Math.max(1, ...data);
    c.clearRect(0, 0, W, H); c.font = '11px Roboto, Arial, sans-serif';
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(T + h - h * i / 4) + .5;
      c.strokeStyle = '#e2e2e2'; c.beginPath(); c.moveTo(L, y); c.lineTo(L + w, y); c.stroke();
      c.fillStyle = '#666'; c.textAlign = 'right'; c.textBaseline = 'middle';
      c.fillText(String(Math.round(top * i / 4)), L - 6, y);
    }
    const n = Math.max(1, data.length - (type === 'bar' ? 0 : 1));
    const colour = ds.borderColor || ds.backgroundColor || '#659A00';
    if (type === 'bar') {
      const bw = w / Math.max(1, data.length) * .6;
      data.forEach((v, i) => {
        const x = L + w * (i + .5) / data.length, y = T + h - h * v / top;
        c.fillStyle = typeof colour === 'string' ? colour : '#659A00';
        c.fillRect(x - bw / 2, y, bw, T + h - y);
      });
    } else {
      c.strokeStyle = typeof colour === 'string' ? colour : '#659A00';
      c.lineWidth = 2; c.beginPath();
      data.forEach((v, i) => { const x = L + w * i / n, y = T + h - h * v / top; i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    }
    c.fillStyle = '#666'; c.textAlign = 'center'; c.textBaseline = 'top';
    labels.forEach((lb, i) => {
      if (labels.length > 8 && i % Math.ceil(labels.length / 6)) return;
      c.fillText(String(lb), L + w * i / n, T + h + 8);
    });
    this.destroy = function () { c.clearRect(0, 0, W, H); };
    this.update = function () {};
    this.data = cfg.data;
  };
  window.Chart.register = function () {};
}

/* ── build the shell from the menu model ───────────────────── */
(function zyBuildAdminShell() {
  const logo = document.getElementById('zy-logo');
  if (logo) {
    const siteName = (window.__BRAND_SETTINGS__ && window.__BRAND_SETTINGS__.site_name) || 'HUMAX SMS';
    const logoUrl = (window.__BRAND_SETTINGS__ && window.__BRAND_SETTINGS__.logo_url) || '/static/img/humex-sms-logo.png';
    logo.innerHTML = `<span class="zy-panel-badge"><img class="zy-badge-logo" src="${logoUrl}" alt="${siteName}" onerror="this.style.display='none';"> <span class="zy-badge-name">${siteName}</span></span>`;
    logo.onclick = null;
    logo.style.cursor = 'default';
  }

  const side = document.getElementById('zy-sidenav');
  if (side) side.innerHTML = ZY_ADMIN_MENU.map((g, gi) => {
    if (!g.t) {
      return g.items.map(([label, page, icon]) => {
        return `<div class="zy-snav nav-item" id="nav-${page}" data-page="${page}" role="link" tabindex="0"
                     onclick="loadPage('${page}')"
                     onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();loadPage('${page}');}">
           <span class="zy-ic" style="--ic-accent:${g.c};"><i class="fas ${icon}" style="color:${g.c}"></i></span><span class="zy-snav-txt">${label}</span>
           <i class="fas fa-chevron-right zy-caret zy-caret-sm"></i></div>`;
      }).join('');
    }
    const subItems = g.items.map(([label, page, icon]) =>
      `<div class="zy-ssub-item" id="nav-${page}" data-page="${page}" role="link" tabindex="0"
            onclick="loadPage('${page}')"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();loadPage('${page}');}">
         <i class="fas ${icon || 'fa-circle-dot'} zy-sub-ic" aria-hidden="true"></i><span class="zy-sub-txt">${label}</span>
       </div>`
    ).join('');
    return `<div class="zy-snav" id="grp-adm-${gi}" role="button" tabindex="0" aria-expanded="false" aria-controls="sb-${gi}"
                 onclick="zyToggleGroup('sb-${gi}', this)"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();zyToggleGroup('sb-${gi}', this);}">
              <span class="zy-ic" style="--ic-accent:${g.c};"><i class="fas ${g.i || 'fa-layer-group'}" style="color:${g.c}"></i></span><span class="zy-snav-txt">${g.t}</span>
              <i class="fas fa-chevron-down zy-caret"></i></div>
            <div class="zy-ssub" id="sb-${gi}" role="region">${subItems}</div>`;
  }).join('');

  const foot = document.querySelector('.zy-side-foot');
  if (foot) {
    foot.innerHTML = `<button type="button" class="zy-side-logout" onclick="doLogout()" aria-label="Logout"><i class="fas fa-arrow-right-from-bracket"></i><span>Logout</span></button>`;
  }

  function tick() {
    const el = document.getElementById('zy-clock'); if (!el) return;
    if (typeof window.zyFormatUtc === 'function') {
      el.textContent = window.zyFormatUtc(new Date());
    } else {
      const d = new Date(), p = n => String(n).padStart(2, '0');
      el.textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
  }
  tick(); setInterval(tick, 1000);

  let u = 'Owner';
  try {
    const au = JSON.parse(sessionStorage.getItem('admin_user')) || {};
    if (au.username) u = au.username;
  } catch (e) {}
  const sideUserEl = document.getElementById('panel-username-side');
  if (sideUserEl) sideUserEl.textContent = u;
  const roleEl = document.getElementById('brand-role');
  if (roleEl) roleEl.textContent = 'Owner Panel';

  if (typeof apiFetch === 'function') {
    apiFetch('/api/auth/me', { silent: true })
      .then(me => {
        if (me && window.BrandTheme && typeof window.BrandTheme.setUserTheme === 'function') {
          window.BrandTheme.setUserTheme(me.theme_key, me.theme_mode);
        }
      })
      .catch(() => {});
  }
})();

/* breadcrumb + close the sidebar drawer after navigating */
const OWNER_ROUTE_PARENT = {
  'bulk-allocation': 'my-numbers',
  'revoke-numbers': 'my-numbers',
  'sms-rate-card': 'sms-ranges',
  'bulk-range-import': 'upload-numbers',
  'blacklist-management': 'upload-numbers',
  'number-transfers-log': 'allocation-history',
  'live-traffic': 'live-otp-feed',
  'profit-stats': 'sms-analytics',
  'business-reports': 'sms-analytics',
  'number-requests': 'agent-requests',
  'usd-statements': 'statements',
  'eur-statements': 'statements',
  'gbp-statements': 'statements',
  'clients': 'agents',
  'hierarchy': 'agents',
  'users': 'agents',
  'login-activity': 'firewall-dashboard',
  'blocked-ips': 'firewall-dashboard',
  'firewall-events': 'firewall-dashboard',
  'rate-limits': 'firewall-dashboard',
  'permissions': 'firewall-dashboard',
  'security-settings': 'general-settings',
  'cli-manager': 'general-settings',
  'services-manager': 'general-settings',
  'backup-restore': 'general-settings',
  'profile': 'my-profile',
  'profile-security': 'my-profile',
  '2fa': 'my-profile',
  'support-tickets': 'announcements'
};
window.OWNER_ROUTE_PARENT = OWNER_ROUTE_PARENT;

const ZY_ADMIN_LABELS = {
  'live-chat': 'Live Chat',
  'bulk-allocation': 'Bulk Allocation',
  'revoke-numbers': 'Revoke Numbers',
  'sms-rate-card': 'Rate Card',
  'bulk-range-import': 'Bulk Range Import',
  'blacklist-management': 'Blacklist Management',
  'number-transfers-log': 'Transfer Log',
  'failed-sms': 'Failed SMS',
  'cdr2': 'CDR 2 (Whitenoise)',
  'live-traffic': 'Live Traffic',
  'profit-stats': 'Profit Stats',
  'business-reports': 'Business Reports',
  'login-panels': 'Web Scraping Panels',
  'cr-api-panels': 'CR API Panels',
  'whitenoise-panels': 'Whitenoise Excel Reports',
  'number-requests': 'Number Requests',
  'my-payouts': 'My Payouts',
  'account-balances': 'Account Balances',
  'statements': 'Statements',
  'usd-statements': 'USD Statements',
  'eur-statements': 'EUR Statements',
  'gbp-statements': 'GBP Statements',
  'credit-notes': 'Credit Notes',
  'clients': 'Clients',
  'hierarchy': 'Hierarchy Tree',
  'users': 'All Accounts',
  'login-activity': 'Login Activity',
  'firewall-dashboard': 'Security & Firewall',
  'blocked-ips': 'Blocked IPs',
  'firewall-events': 'Firewall Events',
  'rate-limits': 'Rate Limits',
  'permissions': 'Permissions',
  'security-settings': 'Security Settings',
  'my-profile': 'My Profile',
  'profile': 'My Profile',
  'profile-security': 'Change Password',
  '2fa': '2FA Authenticator',
  'audit-logs': 'Audit Logs',
  'payout-requests': 'Agent Payment Requests',
  'agent-requests': 'Agent Number Requests',
  'cli-manager': 'CLI Manager',
  'services-manager': 'Services Manager',
  'backup-restore': 'Backup & Restore',
  'support-tickets': 'Support Tickets'
};
ZY_ADMIN_MENU.forEach(g => g.items.forEach(([label, page]) => { ZY_ADMIN_LABELS[page] = label; }));
window.ZY_ADMIN_LABELS = ZY_ADMIN_LABELS;

if (typeof window.zySyncAccordionActive === 'function') {
  const _origSyncAcc = window.zySyncAccordionActive;
  window.zySyncAccordionActive = function (page) {
    return _origSyncAcc(OWNER_ROUTE_PARENT[page] || page);
  };
}

const _zyPrevLoad = loadPage;
loadPage = function (page) {
  _zyPrevLoad(page);
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = ZY_ADMIN_LABELS[page] || bc.textContent || page;
  if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(OWNER_ROUTE_PARENT[page] || page);
  if (window.zyCloseSidebar) window.zyCloseSidebar();
  window.scrollTo({ top: 0 });
};
setTimeout(() => {
  const initPage = sessionStorage.getItem('admin_current_page') || 'dashboard';
  if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(OWNER_ROUTE_PARENT[initPage] || initPage);
}, 100);

renderDashboard = async function () {
  if (typeof window !== 'undefined' && (window.__AUTH_BLOCKED__ || (window.HumexAuth && !window.HumexAuth.isLoggedIn()))) {
    return;
  }
  const c = document.getElementById('page-content');
  if (typeof zyUpdateBreadcrumb === 'function') {
    zyUpdateBreadcrumb('dashboard', 'Dashboard');
  }
  try {
    const [stats, daily, periodStats, ranges, agents, newsRes] = await Promise.all([
      apiFetch('/api/dashboard/stats'),
      apiFetch('/api/sms/daily-stats'),
      apiFetch('/api/sms/period-stats').catch(() => null),
      apiFetch('/api/numbers/sms-ranges'),
      apiFetch('/api/agents?limit=200').catch(() => ({ data: [] })),
      apiFetch('/api/notifications?limit=5').catch(() => ({ data: [] }))
    ]);
    if (!stats && !daily && !ranges && !agents) {
      return;
    }
    const s = stats || {};
    const d = daily || {};
    const p = periodStats || {};

    const weeklyTraffic = (p.weekly_traffic && p.weekly_traffic.length === 7)
      ? p.weekly_traffic
      : (d.weekly_traffic && d.weekly_traffic.length === 7 ? d.weekly_traffic : [0, 0, 0, 0, 0, 0, 0]);
    const weeklyLabels = (p.weekly_labels && p.weekly_labels.length === 7)
      ? p.weekly_labels
      : Array.from({ length: 7 }, (_, i) => {
          const dt = new Date(Date.now() - (6 - i) * 86400000);
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return `${days[dt.getUTCDay()]} ${dt.getUTCDate()}`;
        });

    const todaySmsVal = Number(p.today != null ? p.today : (d.today != null ? d.today : (s.total_sms_today || 0)));
    const yestSmsVal = Number(p.yesterday != null ? p.yesterday : (d.yesterday || s.yesterday || 0));
    const last7Val = Number(p.last_7_days != null ? p.last_7_days : weeklyTraffic.reduce((a, b) => a + (Number(b) || 0), 0));
    const last30Val = Number(p.last_30_days != null ? p.last_30_days : (d.this_month || s.this_month || 0));

    const profitToday = Number(p.profit_today != null ? p.profit_today : (s.revenue_today || 0));
    const profitWeek = Number(p.profit_week != null ? p.profit_week : 0);

    const agentList = Array.isArray(agents) ? agents : ((agents && agents.data) || []);
    const activeAgents = agentList.filter(a => String(a.status || 'active').toLowerCase() === 'active').length || agentList.length;

    const rawRanges = Array.isArray(ranges) ? ranges : ((ranges && ranges.data) || []);
    const sortedRanges = rawRanges.slice().sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    const latestRanges = sortedRanges.slice(0, 5).map(r => {
      const pts = r.payterms || {};
      const wkRate = pts['Weekly'] !== undefined ? pts['Weekly'] : (pts['7/3'] !== undefined ? pts['7/3'] : (r.weekly_rate ?? r.payout ?? r.rate ?? 0.01));
      const curr = r.currency === 'EUR' ? '€' : (r.currency === 'GBP' ? '£' : '$');
      const rawDate = r.created_at || r.created || r.date_added || r.date || '';
      const dateAdded = rawDate ? String(rawDate).replace('T', ' ').slice(0, 10) : 'Active';
      return {
        name: r.range_name || r.name || r.country || '—',
        rateFormatted: `${curr}${typeof zyFmtMoney === 'function' ? zyFmtMoney(wkRate, 4) : Number(wkRate).toFixed(4)}`,
        dateAdded
      };
    });

    const newsList = Array.isArray(newsRes) ? newsRes : ((newsRes && newsRes.data) || []);
    const notifications = newsList.slice(0, 5).map(n => ({
      date: String(n.created || n.created_at || n.date || '').replace('T', ' ').slice(0, 10) || '—',
      title: n.title || n.headline || n.message || 'Announcement'
    }));

    const alertHtml = '';

    const fmtM = typeof window.zyDashMoney === 'function' ? window.zyDashMoney : (v => `$${Number(v || 0).toFixed(2)}`);

    if (typeof window.zyRenderUnifiedDashboard === 'function') {
      window.zyRenderUnifiedDashboard({
        containerId: 'page-content',
        roleLabel: 'Owner',
        alertHtml,
        rangesRoute: 'sms-ranges',
        reportsRoute: 'my-sms',
        notificationsRoute: 'notifications',
        chartId: 'zy-owner-week-chart',
        weeklyLabels,
        weeklyTraffic,
        hero: {
          label: 'Today SMS',
          value: todaySmsVal,
          yesterday: yestSmsVal,
          subtitle: 'System traffic today',
          icon: 'fa-check',
          page: 'my-sms'
        },
        moneyCards: [
          { label: 'Profit Today', value: fmtM(profitToday, '$'), sub: 'Net system margin today', icon: 'fa-sack-dollar', page: 'profit-stats' },
          { label: 'Profit Week', value: fmtM(profitWeek, '$'), sub: 'Current week (Mon–Sun)', icon: 'fa-chart-line', page: 'my-sms' }
        ],
        shortcuts: [],
        volumes: [
          { label: 'Today SMS', value: todaySmsVal, page: 'my-sms' },
          { label: 'Yesterday SMS', value: yestSmsVal, page: 'my-sms' },
          { label: 'SMS Last 7 Days', value: last7Val, page: 'my-sms' },
          { label: 'SMS Last 30 Days', value: last30Val, page: 'my-sms' }
        ],
        summaryTitle: 'System Snapshot',
        summaryRows: [
          { label: 'Active Agents', value: activeAgents.toLocaleString(), icon: 'fa-user-tie', page: 'agents' },
          { label: 'Total Numbers', value: Number(s.total_numbers ?? s.active_numbers ?? 0).toLocaleString(), icon: 'fa-mobile-screen', page: 'my-numbers' },
          { label: 'Profit Today', value: fmtM(profitToday, '$'), icon: 'fa-dollar-sign', page: 'profit-stats' },
          { label: 'SMS Last 7 Days', value: last7Val.toLocaleString(), icon: 'fa-comment-sms', page: 'my-sms' }
        ],
        latestRanges,
        topAccess: (p.top_access_today || []).slice(0, 5),
        notifications
      });
    }
  } catch (err) {
    console.error('Owner dashboard error:', err);
    c.innerHTML = `<div class="zy-panel"><div class="zy-panel-body" style="text-align:center;padding:30px;">
        Dashboard could not load. <button class="zy-gear" onclick="renderDashboard()">Retry</button></div></div>`;
  }
};

/* ═══ SMS CDR STATS (My SMS) — HUMEX SMS layout ═════════════════ */
renderMySms = async function (summary = false) {
  const c = document.getElementById('page-content');
  if (typeof zyCrumb === 'function') {
    zyCrumb(['SMS Stats & Reports']);
  }
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = 'SMS Stats & Reports';

  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const defaultFrom = `${today} 00:00:00`;
  const defaultTo = `${today} 23:59:59`;

  const groupChips = [
    { id: 'hour', label: 'Hour', val: 'hour' },
    { id: 'date', label: 'Date', val: 'date' },
    { id: 'month', label: 'Month', val: 'month' },
    { id: 'provider', label: 'Provider', val: 'provider' },
    { id: 'range', label: 'Range', val: 'range' },
    { id: 'agent', label: 'Agent', val: 'agent' },
    { id: 'number', label: 'Number', val: 'number' },
    { id: 'cli', label: 'CLI', val: 'cli' }
  ];

  const chipsHtml = groupChips.map(g => `
    <label class="zy-chip-pill" for="grp-adm-${g.id}">
      <input type="checkbox" id="grp-adm-${g.id}" class="grp-chk" value="${g.val}" onchange="this.closest('.zy-chip-pill').classList.toggle('active', this.checked)">
      ${g.label}
    </label>
  `).join('');

  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-file-invoice" style="color:#2563eb;"></i> SMS Stats &amp; Reports</div>
        <div class="page-subtitle">Here you can view all call detail records, system traffic, and export reports.</div>
      </div>
    </div>
    <!-- UNIFIED CONTINUOUS SMS REPORTS CARD -->
    <div class="zy-filter-grid" data-apx="filter-bar" data-cdr-compact="1" style="margin-bottom:14px;">
      <div class="zy-cdr-head-row">
        <div style="display:flex;align-items:center;gap:7px;">
          <i class="fas fa-file-invoice" style="color:#0ea5e9;"></i>
          <span>SMS Reports</span>
        </div>
      </div>
      <div class="zy-filter-grid-fields">
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-from">From</label>
          <input type="text" id="rp-from" class="zy-filter-input" value="${defaultFrom}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-to">To</label>
          <input type="text" id="rp-to" class="zy-filter-input" value="${defaultTo}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-provider">Provider</label>
          <select id="rp-provider" class="zy-filter-input">
            <option value="">Filter Provider</option>
          </select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-range">Range</label>
          <select id="rp-range" class="zy-filter-input">
            <option value="">Filter Range</option>
          </select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-agent">Agent</label>
          <select id="rp-agent" class="zy-filter-input">
            <option value="">Filter Agent</option>
          </select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-status">Cause</label>
          <select id="rp-status" class="zy-filter-input">
            <option value="All">All</option>
            <option value="1">Success</option>
            <option value="2">ScrubAg</option>
            <option value="3">Others</option>
          </select>
        </div>
      </div>

      <div class="zy-groupby-card">
        <div class="zy-groupby-title">
          <i class="fas fa-layer-group" style="font-size:11px;color:var(--sp-text-muted,#64748b);"></i>
          Group By :
        </div>
        <div class="zy-groupby-chips">
          ${chipsHtml}
        </div>
        <div class="zy-groupby-search-wrap">
          <input type="text" id="rp-search" class="zy-groupby-search-input"
            placeholder="Search Date, Provider, Range, Number, CLI, SMS, Agent, Cause..."
            autocomplete="off"
            oninput="zyOnOwnerCdrSearchInput(this)"
            onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._ownerCdrSearchTimer){clearTimeout(window._ownerCdrSearchTimer);}renderMySmsLoad(1);}">
          <button type="button" id="rp-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearOwnerCdrSearch()">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="zy-table-toolbar zy-cdr-control-bar">
        <div class="zy-cdr-actions-left">
          <button type="button" class="zy-btn-blue-solid" id="btn-show-report" onclick="renderMySmsLoad(1)">
            <i class="fas fa-chart-column"></i> Show Report
          </button>
        </div>
        <div class="zy-toolbar-right">
          <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('dt-cdr', this)"><i class="fas fa-columns"></i> Columns</button>
          <div class="zy-toolbar-select-wrap">
            <label class="zy-toolbar-label" for="rp-limit">Show Records</label>
            <select id="rp-limit" class="zy-toolbar-select" onchange="window._ownerCdrLimit=this.value;renderMySmsLoad(1)">
              <option value="10">10</option>
              <option value="25" selected>25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
              <option value="5000">5000</option>
              <option value="10000">10000</option>
              <option value="15000">15000</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Results Table: seamless unified report body inside the single card -->
      <div class="zy-panel-body" id="rp-body" style="padding:0;margin-top:12px;">
        <div class="zy-loading" style="padding:40px;text-align:center;color:var(--sp-text-muted,#64748b);">Loading CDR records…</div>
      </div>
    </div>
  `;

  // Populate Dropdowns from APIs
  try {
    const [rangesRes, agentsRes, providersRes] = await Promise.all([
      apiFetch('/api/numbers/sms-ranges').catch(() => []),
      apiFetch('/api/agents?limit=1000').catch(() => ({ data: [] })),
      apiFetch('/api/providers?limit=1000').catch(() => ({ data: [] }))
    ]);

    const ranges = (Array.isArray(rangesRes) ? rangesRes : (rangesRes && rangesRes.data)) || [];
    const agents = (agentsRes && agentsRes.data) || [];
    const providers = (providersRes && providersRes.data) || [];

    const pEl = document.getElementById('rp-provider');
    if (pEl) {
      pEl.innerHTML = '<option value="">Filter Provider</option>' +
        providers.map(p => {
          const pName = p.name || p.provider_name || p.id;
          return `<option value="${zyEsc(pName)}">${zyEsc(pName)}</option>`;
        }).join('');
    }

    const rEl = document.getElementById('rp-range');
    if (rEl) {
      rEl.innerHTML = '<option value="">Filter Range</option>' +
        ranges.map(r => {
          const rName = r.range_name || r.name || r.country || r.id;
          return `<option value="${zyEsc(rName)}">${zyEsc(rName)}</option>`;
        }).join('');
    }

    const aEl = document.getElementById('rp-agent');
    if (aEl) {
      aEl.innerHTML = '<option value="">Filter Agent</option>' +
        agents.map(ag => `<option value="${ag.id}">${zyEsc(ag.username || ag.name || ag.id)}</option>`).join('');
    }
  } catch (err) {
    console.warn('Error populating filters:', err);
  }

  // Load initial report
  renderMySmsLoad(summary);
};

// Debounced unified search helpers for Owner SMS CDR
window.zyOnOwnerCdrSearchInput = function (inputEl) {
  const clearBtn = document.getElementById('rp-search-clear');
  if (clearBtn) clearBtn.style.display = (inputEl && inputEl.value.trim()) ? 'inline-flex' : 'none';
  if (window._ownerCdrSearchTimer) clearTimeout(window._ownerCdrSearchTimer);
  window._ownerCdrSearchTimer = setTimeout(() => {
    renderMySmsLoad(1);
  }, 350);
};

window.zyClearOwnerCdrSearch = function () {
  if (window._ownerCdrSearchTimer) clearTimeout(window._ownerCdrSearchTimer);
  const inp = document.getElementById('rp-search');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  const clearBtn = document.getElementById('rp-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderMySmsLoad(1);
};

// Helper for Export Report stream
window.zyExportCdrAdminStream = function() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const checkedBoxes = Array.from(document.querySelectorAll('.grp-chk:checked')).map(cb => cb.value);
  zyExportCdrStream({
    date_from: val('rp-from'),
    date_to: val('rp-to'),
    provider: val('rp-provider'),
    range: val('rp-range'),
    agent_id: val('rp-agent'),
    status: val('rp-status'),
    search: val('rp-search').trim(),
    group_by: checkedBoxes.join(',')
  });
};
window.zyExportCdrVideoFormat = window.zyExportCdrAdminStream;

async function renderMySmsLoad(pageOrSummary = 1) {
  const targetPage = typeof pageOrSummary === 'number' ? pageOrSummary : 1;
  const isSummaryMode = typeof pageOrSummary === 'boolean' ? pageOrSummary : false;

  const body = document.getElementById('rp-body');
  if (!body) return;

  if (window._adminCdrAbortController) {
    try { window._adminCdrAbortController.abort(); } catch (_) {}
  }
  window._adminCdrAbortController = new AbortController();
  const reqSignal = window._adminCdrAbortController.signal;

  body.innerHTML = `<div class="zy-loading" style="padding:40px;text-align:center;color:#64748b;">
    <div style="display:inline-block;margin-bottom:8px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:#0ea5e9;"></i></div>
    <div>Loading CDR records…</div>
  </div>`;

  const val = id => (document.getElementById(id) || {}).value || '';
  const from = val('rp-from'), to = val('rp-to');
  const provider = val('rp-provider');
  const range = val('rp-range');
  const agentId = val('rp-agent');
  const search = val('rp-search').trim();
  const status = val('rp-status');

  const checkedBoxes = Array.from(document.querySelectorAll('.grp-chk:checked')).map(cb => cb.value);

  const params = new URLSearchParams();
  if (from) params.append('date_from', from);
  if (to) params.append('date_to', to);
  if (provider) params.append('provider', provider);
  if (range) params.append('range', range);
  if (agentId) params.append('agent_id', agentId);
  if (search) params.append('search', search);
  if (status && status !== 'All') params.append('status', status);
  if (checkedBoxes.length) params.append('group_by', checkedBoxes.join(','));

  const limitVal = val('rp-limit') || String(window._ownerCdrLimit || '25');
  window._ownerCdrLimit = limitVal;
  params.append('limit', limitVal);
  params.append('page', String(targetPage));

  try {
    const logs = await apiFetch(`/api/sms/logs?${params.toString()}`, { signal: reqSignal });
    if (!logs) return;
    const data = (logs && logs.data) || [];
    const effectiveLimit = limitVal === 'all'
      ? Math.max(1, Number(logs.limit) || data.length || Number(logs.total) || 25)
      : (parseInt(limitVal, 10) || 25);

    if (logs && logs.grouped && checkedBoxes.length) {
      // ── Grouped Mode ──
      const keyLabels = {
        hour: 'Hour',
        date: 'Date',
        daily: 'Date',
        month: 'Month',
        year: 'Year',
        provider: 'Provider',
        range: 'Range',
        agent: 'Agent',
        client: 'Client',
        number: 'Number',
        cli: 'CLI'
      };
      const cols = [
        ...checkedBoxes.map(k => keyLabels[k] || k),
        'SMS Count',
        'Currency',
        'My Payout',
        'Agent Payout',
        'Profit'
      ];
      const rows = data.map(g => [
        ...checkedBoxes.map(k => (k === 'agent' || k === 'client') ? (g[k] || '') : (g[k] || '—')),
        g.sms_count || 0,
        g.currency || '$',
        zyFmtMoney(Number(g.payout || 0), 4),
        zyFmtMoney(Number(g.agent_payout != null ? g.agent_payout : 0), 4),
        zyFmtMoney(Number(g.profit != null ? g.profit : Math.max(0, (g.payout || 0) - (g.agent_payout || 0))), 4)
      ]);

      const sumTotals = typeof zyBuildCdrTotalRow === 'function' ? zyBuildCdrTotalRow(data, true, { summary: logs.summary }) : null;
      const totalGroups = logs.total != null ? logs.total : (sumTotals ? sumTotals.count : data.length);
      const totalSms = sumTotals ? sumTotals.totalSms : (logs.summary && logs.summary.total_sms != null ? logs.summary.total_sms : data.reduce((s, g) => s + (g.sms_count || 0), 0));
      const totalPayout = sumTotals ? sumTotals.totalPayout : (logs.summary && logs.summary.payout != null ? logs.summary.payout : data.reduce((s, g) => s + (parseFloat(g.payout) || 0), 0));
      const totalAgentPayout = (logs.summary && logs.summary.agent_payout != null) ? Number(logs.summary.agent_payout) : data.reduce((s, g) => s + (parseFloat(g.agent_payout) || 0), 0);
      const totalProfit = sumTotals ? sumTotals.totalProfit : (logs.summary && logs.summary.profit != null ? logs.summary.profit : Math.max(0, totalPayout - totalAgentPayout));

      const footRow = `<td><b>Total Groups: ${Number(totalGroups).toLocaleString()}</b><br><small>Total SMS: ${totalSms.toLocaleString()}</small></td>` +
        '<td></td>'.repeat(Math.max(0, checkedBoxes.length - 1)) +
        `<td><b>${totalSms.toLocaleString()}</b></td>` +
        `<td><b>$</b></td>` +
        `<td><b>${zyFmtMoney(totalPayout, 4)}</b></td>` +
        `<td><b>${zyFmtMoney(totalAgentPayout, 4)}</b></td>` +
        `<td><b>${zyFmtMoney(totalProfit, 4)}</b></td>`;

      body.innerHTML = zyDT2('dt-cdr', {
        cols,
        rows,
        sort: checkedBoxes.length,
        dir: -1,
        perPage: effectiveLimit,
        serverMode: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || targetPage,
        onPageChange: (p) => renderMySmsLoad(p),
        onSizeChange: (s) => {
          window._ownerCdrLimit = String(s);
          const sel = document.getElementById('rp-limit');
          if (sel) sel.value = String(s);
          renderMySmsLoad(1);
        },
        footRow
      });
      zy2Render('dt-cdr');
    } else {
      // ── Detailed Ungrouped Mode ──
      const cols = [
        'Date',
        'Provider',
        'Range',
        'Number',
        'CLI',
        'SMS',
        'Agent',
        'Currency',
        'My Payout',
        'Agent Payout',
        'Profit',
        'Cause'
      ];

      const cleanOrg = (v) => {
        const s = String(v || '').trim();
        if (!s) return '';
        return ['—', '-', 'direct', 'general', 'unallocated', 'unassigned', 'unknown', 'none', 'null'].includes(s.toLowerCase()) ? '' : s;
      };

      const rows = data.map(s => {
        const dtCell = typeof zyFormatDateTimeStacked === 'function'
          ? zyFormatDateTimeStacked(s.timestamp || s.date)
          : { v: (s.timestamp || s.date || '').replace('T', ' ').slice(0, 19), h: (s.timestamp || s.date || '').replace('T', ' ').slice(0, 19) };
        const myPayoutVal = parseFloat(s.company_rate != null ? s.company_rate : (s.company_payout != null ? s.company_payout : (s.carrier_revenue != null ? s.carrier_revenue : (s.my_payout || 0)))) || 0;
        const agentPayoutVal = parseFloat(s.agent_payout != null ? s.agent_payout : (s.agent_rate || 0)) || 0;
        const profitVal = parseFloat(s.owner_amount != null ? s.owner_amount : (s.profit != null ? s.profit : Math.max(0, myPayoutVal - agentPayoutVal))) || 0;
        const causeVal = (s.cause || (s.status === 'delivered' || s.status === 'success' ? 'Success' : (s.status || '—')));

        const numStr = String(s.number || '').trim();
        const numberHtml = numStr ? `<span class="monospace" style="font-weight:600;">${zyEsc(numStr)}</span>` : '—';
        const cliStr = String(s.cli || s.app || '').trim();
        const cliHtml = cliStr ? `<span class="monospace" style="white-space:normal;word-break:break-word;">${zyEsc(cliStr)}</span>` : '—';
        const msgRaw = String(s.message || '');
        const msgCellHtml = typeof zyRenderSmsCell === 'function'
          ? zyRenderSmsCell(msgRaw)
          : `<div class="zy-sms-cell">${zyEsc(msgRaw)}</div>`;

        const agentVal = cleanOrg(s.agent || s.agent_username || s.agent_name);

        return [
          dtCell,
          zyEsc(s.provider || '—'),
          zyEsc(s.range_name || s.range_label || s.range || s.country || '—'),
          { v: numStr, h: numberHtml },
          { v: cliStr, h: cliHtml },
          { v: msgRaw, h: msgCellHtml },
          { v: agentVal, h: agentVal ? zyEsc(agentVal) : '' },
          zyEsc(s.currency || '$'),
          myPayoutVal ? zyFmtMoney(myPayoutVal, 4) : '0',
          agentPayoutVal ? zyFmtMoney(agentPayoutVal, 4) : '0',
          profitVal ? zyFmtMoney(profitVal, 4) : '0',
          zyEsc(causeVal)
        ];
      });

      const sum = logs.summary || {};
      const totalSms = (sum.total_sms != null) ? sum.total_sms : (logs.total != null ? logs.total : rows.length);

      let sumMyPayout = 0;
      let sumAgentPayout = 0;
      let sumProfit = 0;
      rows.forEach(r => {
        sumMyPayout += parseFloat(zyCell2(r[8]).v) || 0;
        sumAgentPayout += parseFloat(zyCell2(r[9]).v) || 0;
        sumProfit += parseFloat(zyCell2(r[10]).v) || 0;
      });

      const usdIn = (sum.payout != null ? sum.payout : sumMyPayout);
      const usdOut = (sum.agent_payout != null ? sum.agent_payout : sumAgentPayout);
      const usdPr = (sum.profit != null ? sum.profit : sumProfit);

      const footRow = `<td><b>Total SMS<br>${totalSms.toLocaleString()}</b></td>` +
        '<td></td>'.repeat(6) +
        `<td><b>USD</b></td>` +
        `<td><b>My Payout<br>$${zyFmtMoney(usdIn, 4)}</b></td>` +
        `<td><b>Agent Payout<br>$${zyFmtMoney(usdOut, 4)}</b></td>` +
        `<td><b>Profit<br>$${zyFmtMoney(usdPr, 4)}</b></td>` +
        '<td></td>';

      body.innerHTML = zyDT2('dt-cdr', {
        cols,
        rows,
        sort: 0,
        dir: -1,
        perPage: effectiveLimit,
        serverMode: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || targetPage,
        onPageChange: (p) => renderMySmsLoad(p),
        onSizeChange: (s) => {
          window._ownerCdrLimit = String(s);
          const sel = document.getElementById('rp-limit');
          if (sel) sel.value = String(s);
          renderMySmsLoad(1);
        },
        footRow
      });
      zy2Render('dt-cdr');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('SMS CDR Stats load error:', err);
    body.innerHTML = '<div class="zy-empty" style="padding:40px;text-align:center;color:#ef4444;">Failed to load SMS CDR stats. Please try again.</div>';
  }
}

/* ═══ CDR 2 (WHITENOISE EXCEL-ONLY DAILY STATS · MONTHLY 30/5 {W}) ═══ */
window._wnCdr2Tab = 'stats';
window._wnPreviewState = null;

function zyMonthStartYmd() {
  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  return `${today.slice(0, 7)}-01`;
}

async function renderOwnerCdr2() {
  const c = document.getElementById('page-content');
  if (typeof zyCrumb === 'function') {
    zyCrumb(['SMS Stats & Reports', 'CDR 2 (Whitenoise)']);
  }
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = 'CDR 2 (Whitenoise)';

  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const defaultFrom = `${zyMonthStartYmd()} 00:00:00`;
  const defaultTo = `${today} 23:59:59`;
  window._wnCdr2Tab = 'stats';

  const groupChips = [
    { id: 'date', label: 'Date', val: 'date' },
    { id: 'month', label: 'Month', val: 'month' },
    { id: 'range', label: 'Range', val: 'range' },
    { id: 'agent', label: 'Agent', val: 'agent' },
    { id: 'client', label: 'Client', val: 'client' },
    { id: 'number', label: 'Number', val: 'number' },
    { id: 'cli', label: 'Service / CLI', val: 'cli' }
  ];

  const chipsHtml = groupChips.map(g => `
    <label class="zy-chip-pill" for="grp-cdr2-${g.id}">
      <input type="checkbox" id="grp-cdr2-${g.id}" class="cdr2-grp-chk" value="${g.val}" onchange="this.closest('.zy-chip-pill').classList.toggle('active', this.checked)">
      ${g.label}
    </label>
  `).join('');

  c.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
      <div>
        <div class="page-title" style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-file-excel" style="color:#2563eb;"></i>
          <span>CDR 2 — Whitenoise Daily Stats</span>
        </div>
        <div class="page-subtitle" style="margin-top:4px;">
          Excel-Only Daily Stats · Monthly (30/5) {W} · 5-day hold · Date-locked historical ownership
        </div>
      </div>
      <div class="page-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm" id="btn-wn-upload-excel" onclick="openWhitenoiseExcelUploadModal()">
          <i class="fas fa-cloud-arrow-up"></i> Upload Excel Stats
        </button>
        <button type="button" class="btn btn-outline btn-sm" onclick="zyExportCdr2AdminStream()">
          <i class="fas fa-download"></i> Export CSV
        </button>
      </div>
    </div>

    <div style="display:flex;gap:0;border-bottom:1px solid var(--border,#e2e8f0);margin-bottom:14px;">
      <button type="button" id="cdr2-tab-stats" onclick="zyOwnerCdr2SwitchTab('stats')"
        style="padding:9px 16px;font-size:13px;font-weight:600;border:none;background:transparent;cursor:pointer;border-bottom:2px solid #2563eb;color:#2563eb;">
        Daily Stats Ledger
      </button>
      <button type="button" id="cdr2-tab-history" onclick="zyOwnerCdr2SwitchTab('history')"
        style="padding:9px 16px;font-size:13px;font-weight:600;border:none;background:transparent;cursor:pointer;border-bottom:2px solid transparent;color:#64748b;">
        Upload History &amp; Rollback
      </button>
    </div>

    <div id="cdr2-panel-stats">
      <div class="zy-filter-grid" data-apx="filter-bar" data-cdr-compact="1" style="margin-bottom:14px;">
        <div class="zy-cdr-head-row">
          <div style="display:flex;align-items:center;gap:7px;">
            <i class="fas fa-sliders" style="color:#2563eb;"></i>
            <span>Whitenoise Excel Stats Filters</span>
          </div>
          <div id="cdr2-sync-status" style="font-size:12px;color:#64748b;font-variant-numeric:tabular-nums;">
            Background polling disabled · Powered by daily Excel reports
          </div>
        </div>
        <div class="zy-filter-grid-fields">
          <div class="zy-filter-field">
            <label class="zy-filter-label" for="cdr2-from">From</label>
            <input type="text" id="cdr2-from" class="zy-filter-input" value="${defaultFrom}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
          </div>
          <div class="zy-filter-field">
            <label class="zy-filter-label" for="cdr2-to">To</label>
            <input type="text" id="cdr2-to" class="zy-filter-input" value="${defaultTo}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
          </div>
          <div class="zy-filter-field">
            <label class="zy-filter-label" for="cdr2-range">Whitenoise Range</label>
            <select id="cdr2-range" class="zy-filter-input">
              <option value="">All Whitenoise Ranges</option>
            </select>
          </div>
          <div class="zy-filter-field">
            <label class="zy-filter-label" for="cdr2-agent">Agent</label>
            <select id="cdr2-agent" class="zy-filter-input">
              <option value="">All Agents</option>
            </select>
          </div>
        </div>

        <div class="zy-groupby-card">
          <div class="zy-groupby-title">
            <i class="fas fa-layer-group" style="font-size:11px;color:var(--sp-text-muted,#64748b);"></i>
            Group By :
          </div>
          <div class="zy-groupby-chips">
            ${chipsHtml}
          </div>
          <div class="zy-groupby-search-wrap">
            <input type="text" id="cdr2-search" class="zy-groupby-search-input"
              placeholder="Search Date, Range, Number, Service, Agent, Client..."
              autocomplete="off"
              oninput="zyHandleCdrSearchInput(this, 'cdr2-search-clear', () => renderOwnerCdr2Load(1))"
              onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._zyCdrSearchTimer){clearTimeout(window._zyCdrSearchTimer);}renderOwnerCdr2Load(1);}">
            <button type="button" id="cdr2-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearCdrSearch('cdr2-search', 'cdr2-search-clear', () => renderOwnerCdr2Load(1))">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>

        <div class="zy-table-toolbar zy-cdr-control-bar">
          <div class="zy-cdr-actions-left" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="zy-btn-blue-solid" id="btn-show-cdr2" onclick="renderOwnerCdr2Load(1)">
              <i class="fas fa-chart-column"></i> Show Report
            </button>
            <button type="button" class="btn btn-outline btn-sm" onclick="zyResetCdr2Filters()">
              <i class="fas fa-rotate-left"></i> Reset
            </button>
          </div>
          <div class="zy-toolbar-right">
            <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('dt-cdr2', this)"><i class="fas fa-columns"></i> Columns</button>
            <div class="zy-toolbar-select-wrap">
              <label class="zy-toolbar-label" for="cdr2-limit">Show Records</label>
              <select id="cdr2-limit" class="zy-toolbar-select" onchange="renderOwnerCdr2Load(1)">
                <option value="10">10</option>
                <option value="25" selected>25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
                <option value="5000">5000</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>
        </div>

        <div class="zy-panel-body" id="cdr2-body" style="padding:0;margin-top:12px;">
          <div class="zy-loading" style="padding:40px;text-align:center;color:var(--sp-text-muted,#64748b);">Loading CDR 2 daily stats…</div>
        </div>
      </div>
    </div>

    <div id="cdr2-panel-history" style="display:none;">
      <div class="card" style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
          <div>
            <div style="font-size:15px;font-weight:700;color:var(--text,#0f172a);">Excel Upload Batch History</div>
            <div style="font-size:12.5px;color:#64748b;">Every cumulative report sync is audited with pre-batch snapshots for safe 1-click rollback.</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="openWhitenoiseExcelUploadModal()">
            <i class="fas fa-cloud-arrow-up"></i> Upload New Sheet
          </button>
        </div>
        <div id="cdr2-batches-body">
          <div class="zy-loading" style="padding:32px;text-align:center;color:#64748b;">Loading upload batches…</div>
        </div>
      </div>
    </div>
  `;

  try {
    const [rangesRes, agentsRes] = await Promise.all([
      apiFetch('/api/numbers/sms-ranges').catch(() => []),
      apiFetch('/api/agents?limit=1000').catch(() => ({ data: [] }))
    ]);
    const ranges = ((Array.isArray(rangesRes) ? rangesRes : (rangesRes && rangesRes.data)) || [])
      .filter(r => r.is_whitenoise || String(r.provider || '').toLowerCase().includes('whitenoise') || String(r.payout_schedule || '').toLowerCase() === 'monthly30_5');
    const agents = (agentsRes && agentsRes.data) || [];

    const rEl = document.getElementById('cdr2-range');
    if (rEl) {
      rEl.innerHTML = '<option value="">All Whitenoise Ranges</option>' +
        ranges.map(r => {
          const rName = r.range_name || r.name || r.country || r.id;
          return `<option value="${zyEsc(rName)}">${zyEsc(rName)}</option>`;
        }).join('');
    }
    const aEl = document.getElementById('cdr2-agent');
    if (aEl) {
      aEl.innerHTML = '<option value="">All Agents</option>' +
        agents.map(ag => `<option value="${ag.id}">${zyEsc(ag.username || ag.name || ag.id)}${ag.whitenoise_access ? ' (WN)' : ''}</option>`).join('');
    }
  } catch (err) {
    console.warn('Error populating CDR 2 filters:', err);
  }

  renderOwnerCdr2Load(1);
}
window.renderOwnerCdr2 = renderOwnerCdr2;

window.zyOwnerCdr2SwitchTab = function (tab) {
  window._wnCdr2Tab = tab === 'history' ? 'history' : 'stats';
  const pStats = document.getElementById('cdr2-panel-stats');
  const pHist = document.getElementById('cdr2-panel-history');
  const tStats = document.getElementById('cdr2-tab-stats');
  const tHist = document.getElementById('cdr2-tab-history');
  if (pStats) pStats.style.display = window._wnCdr2Tab === 'stats' ? 'block' : 'none';
  if (pHist) pHist.style.display = window._wnCdr2Tab === 'history' ? 'block' : 'none';
  if (tStats) {
    tStats.style.borderBottomColor = window._wnCdr2Tab === 'stats' ? '#2563eb' : 'transparent';
    tStats.style.color = window._wnCdr2Tab === 'stats' ? '#2563eb' : '#64748b';
  }
  if (tHist) {
    tHist.style.borderBottomColor = window._wnCdr2Tab === 'history' ? '#2563eb' : 'transparent';
    tHist.style.color = window._wnCdr2Tab === 'history' ? '#2563eb' : '#64748b';
  }
  if (window._wnCdr2Tab === 'history') {
    zyLoadWhitenoiseBatches('cdr2-batches-body');
  }
};

window.zyResetCdr2Filters = function () {
  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const f = document.getElementById('cdr2-from'); if (f) f.value = `${zyMonthStartYmd()} 00:00:00`;
  const t = document.getElementById('cdr2-to'); if (t) t.value = `${today} 23:59:59`;
  ['cdr2-range', 'cdr2-agent', 'cdr2-search'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const clr = document.getElementById('cdr2-search-clear'); if (clr) clr.style.display = 'none';
  document.querySelectorAll('.cdr2-grp-chk').forEach(cb => {
    cb.checked = false;
    cb.closest('.zy-chip-pill')?.classList.remove('active');
  });
  renderOwnerCdr2Load(1);
};

window.zyExportCdr2AdminStream = function () {
  const val = id => (document.getElementById(id) || {}).value || '';
  const checkedBoxes = Array.from(document.querySelectorAll('.cdr2-grp-chk:checked')).map(cb => cb.value);
  const params = new URLSearchParams();
  const map = {
    date_from: val('cdr2-from'),
    date_to: val('cdr2-to'),
    range: val('cdr2-range'),
    agent_id: val('cdr2-agent'),
    search: val('cdr2-search').trim(),
    group_by: checkedBoxes.join(',')
  };
  Object.entries(map).forEach(([k, v]) => { if (v != null && v !== '') params.append(k, v); });
  params.append('export', 'csv');
  const a = document.createElement('a');
  a.href = `/api/cdr2/export?${params.toString()}`;
  a.download = `cdr2_whitenoise_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

async function renderOwnerCdr2Load(targetPage = 1) {
  const pageNum = typeof targetPage === 'number' ? targetPage : 1;
  const body = document.getElementById('cdr2-body');
  if (!body) return;

  if (window._adminCdr2AbortController) {
    try { window._adminCdr2AbortController.abort(); } catch (_) {}
  }
  window._adminCdr2AbortController = new AbortController();
  const reqSignal = window._adminCdr2AbortController.signal;

  const val = id => (document.getElementById(id) || {}).value || '';
  const from = val('cdr2-from'), to = val('cdr2-to');
  const range = val('cdr2-range');
  const agentId = val('cdr2-agent');
  const search = val('cdr2-search').trim();

  body.innerHTML = `<div class="zy-loading" style="padding:36px;text-align:center;color:#64748b;">
    <i class="fas fa-spinner fa-spin fa-lg" style="color:#2563eb;"></i>
    <div style="margin-top:8px;font-size:13px;">Loading Whitenoise daily stats…</div>
  </div>`;

  const checkedBoxes = Array.from(document.querySelectorAll('.cdr2-grp-chk:checked')).map(cb => cb.value);
  const params = new URLSearchParams();
  if (from) params.append('date_from', from);
  if (to) params.append('date_to', to);
  if (range) params.append('range', range);
  if (agentId) params.append('agent_id', agentId);
  if (search) params.append('search', search);
  if (checkedBoxes.length) params.append('group_by', checkedBoxes.join(','));

  const limitVal = val('cdr2-limit') || '25';
  params.append('limit', limitVal);
  params.append('page', String(pageNum));

  try {
    const logs = await apiFetch(`/api/cdr2/logs?${params.toString()}`, { signal: reqSignal });
    if (!logs) return;
    const data = (logs && logs.data) || [];
    const effectiveLimit = limitVal === 'all'
      ? Math.max(1, Number(logs.limit) || data.length || Number(logs.total) || 25)
      : (parseInt(limitVal, 10) || 25);

    if (!data.length) {
      body.innerHTML = `
        <div style="padding:44px 24px;text-align:center;border:1px solid var(--border,#e2e8f0);border-radius:8px;background:var(--surface,#fff);">
          <i class="fas fa-file-excel" style="font-size:28px;color:#94a3b8;margin-bottom:10px;"></i>
          <div style="font-size:15px;font-weight:700;color:var(--text,#0f172a);margin-bottom:4px;">No Whitenoise Daily Stats Found</div>
          <div style="font-size:13px;color:#64748b;max-width:460px;margin:0 auto 14px;">
            Upload today's company cumulative Excel report (.xlsx / .csv) to populate Date × Number × Service counts and Monthly (30/5) {W} balances.
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="openWhitenoiseExcelUploadModal()">
            <i class="fas fa-cloud-arrow-up"></i> Upload First Excel Sheet
          </button>
        </div>`;
      return;
    }

    if (logs && logs.grouped && checkedBoxes.length) {
      const keyLabels = { date: 'Date', month: 'Month', range: 'Range', agent: 'Agent', client: 'Client', number: 'Number', cli: 'Service / CLI' };
      const cols = [...checkedBoxes.map(k => keyLabels[k] || k), 'SMS Count', 'Cycle', 'Owner Rev (USD)', 'Agent Pay (USD)', 'Owner Profit (USD)'];
      const rows = data.map(g => [
        ...checkedBoxes.map(k => (k === 'agent' || k === 'client') ? (g[k] || '—') : (g[k] || '—')),
        { v: g.sms_count || 0, h: `<span class="monospace" style="font-weight:700;">${Number(g.sms_count || 0).toLocaleString()}</span>` },
        'Monthly (30/5) {W}',
        { v: Number(g.payout || 0), h: `<span class="monospace">$${zyFmtMoney(Number(g.payout || 0), 4)}</span>` },
        { v: Number(g.agent_payout || 0), h: `<span class="monospace">$${zyFmtMoney(Number(g.agent_payout || 0), 4)}</span>` },
        { v: Number(g.profit || 0), h: `<span class="monospace" style="color:#059669;font-weight:700;">$${zyFmtMoney(Number(g.profit != null ? g.profit : Math.max(0, (g.payout || 0) - (g.agent_payout || 0))), 4)}</span>` }
      ]);

      const sum = logs.summary || {};
      const totalGroups = logs.total != null ? logs.total : (sum.total_groups != null ? sum.total_groups : data.length);
      const totalSms = sum.total_sms != null ? sum.total_sms : data.reduce((s, g) => s + (g.sms_count || 0), 0);
      const totalPayout = sum.payout != null ? Number(sum.payout) : data.reduce((s, g) => s + (parseFloat(g.payout) || 0), 0);
      const totalAgentPayout = sum.agent_payout != null ? Number(sum.agent_payout) : data.reduce((s, g) => s + (parseFloat(g.agent_payout) || 0), 0);
      const totalProfit = sum.profit != null ? Number(sum.profit) : Math.max(0, totalPayout - totalAgentPayout);

      const footRow = `<td><b>Total Groups: ${Number(totalGroups).toLocaleString()}</b></td>` +
        '<td></td>'.repeat(Math.max(0, checkedBoxes.length - 1)) +
        `<td class="monospace"><b>${totalSms.toLocaleString()}</b></td>` +
        `<td><b>Monthly (30/5) {W}</b></td>` +
        `<td class="monospace"><b>$${zyFmtMoney(totalPayout, 4)}</b></td>` +
        `<td class="monospace"><b>$${zyFmtMoney(totalAgentPayout, 4)}</b></td>` +
        `<td class="monospace" style="color:#059669;"><b>$${zyFmtMoney(totalProfit, 4)}</b></td>`;

      body.innerHTML = zyDT2('dt-cdr2', {
        cols,
        rows,
        sort: checkedBoxes.length,
        dir: -1,
        perPage: effectiveLimit,
        serverMode: true,
        hideToolbar: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || pageNum,
        onPageChange: (p) => renderOwnerCdr2Load(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('cdr2-limit');
          if (sel) sel.value = String(s);
          renderOwnerCdr2Load(1);
        },
        footRow
      });
      zy2Render('dt-cdr2');
    } else {
      const cols = ['Date', 'Range', 'Number', 'Service / CLI', 'Agent', 'Client', 'SMS Count', 'Unit Rate', 'Owner Rev', 'Agent Pay', 'Owner Profit', 'Cycle'];
      const rows = data.map(s => {
        const dStr = s.date_ymd || String(s.date || s.timestamp || '').replace('T', ' ').slice(0, 10);
        const smsCnt = Number(s.sms_count) > 0 ? Math.round(Number(s.sms_count)) : 1;
        const unitRate = Number(s.unit_owner_rate_usd != null ? s.unit_owner_rate_usd : (smsCnt > 0 ? (Number(s.company_rate || 0) / smsCnt) : 0));
        const myPayoutVal = parseFloat(s.company_rate ?? s.owner_revenue_usd ?? s.my_payout ?? 0) || 0;
        const agentPayoutVal = parseFloat(s.agent_payout ?? s.agent_rate ?? 0) || 0;
        const profitVal = parseFloat(s.owner_amount ?? s.profit ?? Math.max(0, myPayoutVal - agentPayoutVal)) || 0;
        const numStr = String(s.number || '').trim();
        const cliStr = String(s.cli || s.service || s.app || 'General').trim();
        const agentVal = String(s.agent || s.agent_username || s.agent_name || '').trim();
        const clientVal = String(s.client || s.client_username || s.client_name || '').trim();
        const clearLabel = s.clears_at ? `Clears ${String(s.clears_at).slice(0, 10)}` : 'Monthly (30/5) {W}';

        return [
          { v: dStr, h: `<span class="monospace" style="font-weight:600;">${zyEsc(dStr)}</span>` },
          zyEsc(s.range_name || s.range_label || s.range || s.country || '—'),
          { v: numStr, h: numStr ? `<span class="monospace" style="font-weight:600;">${zyEsc(numStr)}</span>` : '—' },
          { v: cliStr, h: `<span class="monospace">${zyEsc(cliStr)}</span>` },
          agentVal ? zyEsc(agentVal) : '<span style="color:#94a3b8;">Unassigned</span>',
          clientVal ? zyEsc(clientVal) : '<span style="color:#94a3b8;">Pool</span>',
          { v: smsCnt, h: `<span class="monospace" style="font-weight:700;">${smsCnt.toLocaleString()}</span>` },
          { v: unitRate, h: `<span class="monospace" style="color:#64748b;">$${zyFmtMoney(unitRate, 4)}</span>` },
          { v: myPayoutVal, h: `<span class="monospace">$${zyFmtMoney(myPayoutVal, 4)}</span>` },
          { v: agentPayoutVal, h: `<span class="monospace">$${zyFmtMoney(agentPayoutVal, 4)}</span>` },
          { v: profitVal, h: `<span class="monospace" style="color:#059669;font-weight:700;">$${zyFmtMoney(profitVal, 4)}</span>` },
          `<span style="font-size:11.5px;color:#4338ca;font-weight:600;">${zyEsc(clearLabel)}</span>`
        ];
      });

      const sum = logs.summary || {};
      const totalSms = (sum.total_sms != null) ? sum.total_sms : data.reduce((a, s) => a + (Number(s.sms_count) || 1), 0);
      const usdIn = sum.payout != null ? sum.payout : data.reduce((a, s) => a + (parseFloat(s.company_rate ?? s.my_payout ?? 0) || 0), 0);
      const usdOut = sum.agent_payout != null ? sum.agent_payout : data.reduce((a, s) => a + (parseFloat(s.agent_payout ?? s.agent_rate ?? 0) || 0), 0);
      const usdPr = sum.profit != null ? sum.profit : Math.max(0, usdIn - usdOut);

      const footRow = `<td><b>Rows: ${Number(logs.total || data.length).toLocaleString()}</b></td>` +
        '<td></td>'.repeat(5) +
        `<td class="monospace"><b>${totalSms.toLocaleString()}</b></td>` +
        '<td></td>' +
        `<td class="monospace"><b>$${zyFmtMoney(usdIn, 4)}</b></td>` +
        `<td class="monospace"><b>$${zyFmtMoney(usdOut, 4)}</b></td>` +
        `<td class="monospace" style="color:#059669;"><b>$${zyFmtMoney(usdPr, 4)}</b></td>` +
        `<td><b>Monthly (30/5) {W}</b></td>`;

      body.innerHTML = zyDT2('dt-cdr2', {
        cols,
        rows,
        sort: 0,
        dir: -1,
        perPage: effectiveLimit,
        serverMode: true,
        hideToolbar: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || pageNum,
        onPageChange: (p) => renderOwnerCdr2Load(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('cdr2-limit');
          if (sel) sel.value = String(s);
          renderOwnerCdr2Load(1);
        },
        footRow
      });
      zy2Render('dt-cdr2');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('CDR 2 load error:', err);
    body.innerHTML = '<div class="zy-empty" style="padding:40px;text-align:center;color:#ef4444;">Failed to load CDR 2 records. Please try again.</div>';
  }
}
window.renderOwnerCdr2Load = renderOwnerCdr2Load;

// ── Owner Excel Upload Dropzone & Dry-Run Preview Modal ─────────────────────
window.openWhitenoiseExcelUploadModal = function () {
  window._wnPreviewState = null;
  const html = `
    <div id="wn-excel-modal-root" style="min-width:min(820px,88vw);">
      <div id="wn-dropzone"
        onclick="document.getElementById('wn-excel-file-input')?.click()"
        ondragover="event.preventDefault();this.style.borderColor='#2563eb';this.style.background='#eff6ff';"
        ondragleave="this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';"
        ondrop="event.preventDefault();this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';if(event.dataTransfer?.files?.[0])zyWnHandleFileUpload(event.dataTransfer.files[0]);"
        style="border:1.5px dashed #cbd5e1;border-radius:8px;padding:22px 16px;text-align:center;background:#f8fafc;cursor:pointer;transition:all 0.15s;">
        <input type="file" id="wn-excel-file-input" accept=".xlsx,.xls,.csv" style="display:none;"
          onchange="if(this.files && this.files[0]) zyWnHandleFileUpload(this.files[0]);">
        <i class="fas fa-file-excel" style="font-size:26px;color:#2563eb;margin-bottom:6px;"></i>
        <div style="font-size:14px;font-weight:700;color:#0f172a;">Drop company Excel file here or click to browse</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px;">Supports cumulative .xlsx, .xls, .csv (e.g. sms_stats_15-19.11.2026.xlsx) · Date-wise upsert · Zero duplicates</div>
      </div>

      <div id="wn-preview-status" style="margin-top:10px;"></div>
      <div id="wn-preview-container" style="display:none;margin-top:12px;"></div>
    </div>
  `;
  if (typeof openModal === 'function') {
    openModal('Upload Whitenoise Daily Excel Stats', html);
  }
};

window.zyWnHandleFileUpload = async function (file) {
  const statusEl = document.getElementById('wn-preview-status');
  const contEl = document.getElementById('wn-preview-container');
  if (!file) return;
  if (statusEl) {
    statusEl.innerHTML = `<div style="padding:10px 12px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:6px;font-size:12.5px;color:#1d4ed8;">
      <i class="fas fa-spinner fa-spin"></i> Parsing <b>${zyEsc(file.name)}</b> and resolving historical date-based ownership…
    </div>`;
  }
  if (contEl) contEl.style.display = 'none';

  try {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch('/api/whitenoise-excel/preview', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'Preview failed');
    window._wnPreviewState = { ...data, filterTab: 'all' };
    if (statusEl) statusEl.innerHTML = '';
    zyRenderWhitenoisePreview();
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<div style="padding:10px 12px;border:1px solid #fecaca;background:#fef2f2;border-radius:6px;font-size:12.5px;color:#b91c1c;">
        <i class="fas fa-triangle-exclamation"></i> ${zyEsc(err.message || 'Could not parse Excel workbook.')}
      </div>`;
    }
  }
};

window.zyWnReevaluatePreview = async function (sheetChanged = false) {
  const st = window._wnPreviewState;
  if (!st || !st.preview_token) return;
  const sheetName = document.getElementById('wn-map-sheet')?.value || st.selected_sheet;
  const payload = { preview_token: st.preview_token, sheet_name: sheetName };
  if (!sheetChanged) {
    payload.col_map = {
      date: Number(document.getElementById('wn-map-date')?.value ?? -1),
      number: Number(document.getElementById('wn-map-number')?.value ?? -1),
      service: Number(document.getElementById('wn-map-service')?.value ?? -1),
      sms_count: Number(document.getElementById('wn-map-count')?.value ?? -1),
      range: Number(document.getElementById('wn-map-range')?.value ?? -1)
    };
  }
  const statusEl = document.getElementById('wn-preview-status');
  if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:#2563eb;"><i class="fas fa-spinner fa-spin"></i> Re-evaluating sheet mapping…</div>`;
  try {
    const res = await apiFetch('/api/whitenoise-excel/preview', { method: 'POST', body: JSON.stringify(payload) });
    window._wnPreviewState = { ...res, filterTab: st.filterTab || 'all' };
    if (statusEl) statusEl.innerHTML = '';
    zyRenderWhitenoisePreview();
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<div style="font-size:12px;color:#dc2626;">${zyEsc(err.message || 'Mapping failed')}</div>`;
  }
};

window.zyWnSetPreviewTab = function (tab) {
  if (!window._wnPreviewState) return;
  window._wnPreviewState.filterTab = tab;
  zyRenderWhitenoisePreview();
};

function zyRenderWhitenoisePreview() {
  const st = window._wnPreviewState;
  const cont = document.getElementById('wn-preview-container');
  if (!st || !cont) return;
  cont.style.display = 'block';

  const s = st.summary || {};
  const headers = st.headers || [];
  const colMap = st.col_map || {};
  const optsHtml = (selectedIdx, allowAutoPivot = false) => {
    let out = `<option value="-1" ${Number(selectedIdx) === -1 ? 'selected' : ''}>${allowAutoPivot ? '— Auto / Date Columns —' : '— Not Mapped —'}</option>`;
    headers.forEach((h, i) => {
      out += `<option value="${i}" ${Number(selectedIdx) === i ? 'selected' : ''}>${zyEsc(h)} (Col ${i + 1})</option>`;
    });
    return out;
  };

  const tab = st.filterTab || 'all';
  const allRows = st.rows || [];
  const filteredRows = allRows.filter(r => {
    if (tab === 'new') return r.action === 'new';
    if (tab === 'updated') return r.action === 'updated';
    if (tab === 'unassigned') return r.match_status === 'unassigned' || r.match_status === 'unknown_number';
    return true;
  });

  const actionTag = (a) => {
    if (a === 'new') return '<span style="color:#059669;font-weight:700;">NEW</span>';
    if (a === 'updated') return '<span style="color:#d97706;font-weight:700;">UPD</span>';
    return '<span style="color:#94a3b8;font-weight:600;">SAME</span>';
  };
  const ownerCell = (r) => {
    if (r.client_name) return `<span style="font-weight:600;color:#0f172a;">${zyEsc(r.client_name)}</span> <span style="color:#64748b;font-size:11px;">(${zyEsc(r.agent_name || 'Agent')})</span>`;
    if (r.agent_name) return `<span style="color:#2563eb;font-weight:600;">${zyEsc(r.agent_name)}</span> <span style="color:#64748b;font-size:11px;">(Pool)</span>`;
    return `<span style="color:#dc2626;font-weight:600;">${r.match_status === 'unknown_number' ? 'Unknown #' : 'Unassigned'}</span>`;
  };

  const warningsHtml = (st.warnings || []).length
    ? `<div style="margin-bottom:10px;padding:8px 10px;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;font-size:12px;color:#92400e;">
        ${(st.warnings || []).map(w => `<div><i class="fas fa-circle-info"></i> ${zyEsc(w)}</div>`).join('')}
      </div>`
    : '';

  const canCommit = Number(s.new_rows || 0) + Number(s.updated_rows || 0) > 0;

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;font-size:12.5px;color:#334155;">
      <div>
        <b>${zyEsc(st.filename)}</b> · Dates: <span class="monospace">${zyEsc(st.date_min || '—')} → ${zyEsc(st.date_max || '—')}</span> · Layout: <b>${st.layout === 'date_pivot' ? 'Date Matrix' : 'Tabular'}</b>
      </div>
      <div style="color:#64748b;">Parsed ${Number(s.total_rows || 0).toLocaleString()} row(s) · ${Number(s.total_sms_in_file || 0).toLocaleString()} total SMS</div>
    </div>

    ${warningsHtml}

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;margin:10px 0;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
      <div>
        <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px;">Sheet (${(st.sheets || []).length})</label>
        <select id="wn-map-sheet" onchange="zyWnReevaluatePreview(true)" style="width:100%;height:30px;font-size:12px;border:1px solid #cbd5e1;border-radius:4px;padding:0 6px;">
          ${(st.sheets || []).map(sh => `<option value="${zyEsc(sh.name)}" ${sh.name === st.selected_sheet ? 'selected' : ''}>${zyEsc(sh.name)} (${sh.row_count})</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px;">Date Column</label>
        <select id="wn-map-date" onchange="zyWnReevaluatePreview(false)" style="width:100%;height:30px;font-size:12px;border:1px solid #cbd5e1;border-radius:4px;padding:0 6px;">${optsHtml(colMap.date, true)}</select>
      </div>
      <div>
        <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px;">Number Column *</label>
        <select id="wn-map-number" onchange="zyWnReevaluatePreview(false)" style="width:100%;height:30px;font-size:12px;border:1px solid #cbd5e1;border-radius:4px;padding:0 6px;">${optsHtml(colMap.number)}</select>
      </div>
      <div>
        <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px;">Service / CLI</label>
        <select id="wn-map-service" onchange="zyWnReevaluatePreview(false)" style="width:100%;height:30px;font-size:12px;border:1px solid #cbd5e1;border-radius:4px;padding:0 6px;">${optsHtml(colMap.service)}</select>
      </div>
      <div>
        <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px;">SMS Count</label>
        <select id="wn-map-count" onchange="zyWnReevaluatePreview(false)" style="width:100%;height:30px;font-size:12px;border:1px solid #cbd5e1;border-radius:4px;padding:0 6px;">${optsHtml(colMap.sms_count)}</select>
      </div>
      <div>
        <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:3px;">Range (Optional)</label>
        <select id="wn-map-range" onchange="zyWnReevaluatePreview(false)" style="width:100%;height:30px;font-size:12px;border:1px solid #cbd5e1;border-radius:4px;padding:0 6px;">${optsHtml(colMap.range)}</select>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px;">
      <div style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;">
        <div style="font-size:11px;color:#64748b;">New / Updated / Same</div>
        <div class="monospace" style="font-size:14px;font-weight:700;margin-top:2px;">
          <span style="color:#059669;">+${s.new_rows || 0}</span> / <span style="color:#d97706;">${s.updated_rows || 0}</span> / <span style="color:#94a3b8;">${s.unchanged_rows || 0}</span>
        </div>
      </div>
      <div style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;">
        <div style="font-size:11px;color:#64748b;">Net SMS Delta</div>
        <div class="monospace" style="font-size:14px;font-weight:700;margin-top:2px;color:#0f172a;">${(s.net_sms_delta || 0) >= 0 ? '+' : ''}${Number(s.net_sms_delta || 0).toLocaleString()}</div>
      </div>
      <div style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;">
        <div style="font-size:11px;color:#64748b;">Matched Client / Pool</div>
        <div class="monospace" style="font-size:14px;font-weight:700;margin-top:2px;">${s.matched_client || 0} / ${s.agent_pool || 0}</div>
      </div>
      <div style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;">
        <div style="font-size:11px;color:#64748b;">Unassigned / Unknown</div>
        <div class="monospace" style="font-size:14px;font-weight:700;margin-top:2px;color:${(s.unassigned || 0) > 0 ? '#dc2626' : '#059669'};">${s.unassigned || 0}</div>
      </div>
      <div style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;">
        <div style="font-size:11px;color:#64748b;">Owner Profit Delta</div>
        <div class="monospace" style="font-size:14px;font-weight:700;margin-top:2px;color:#059669;">$${zyFmtMoney(Number(s.net_owner_profit_delta_usd || 0), 4)}</div>
      </div>
      <div style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;">
        <div style="font-size:11px;color:#64748b;">Client PKR Delta</div>
        <div class="monospace" style="font-size:14px;font-weight:700;margin-top:2px;color:#2563eb;">Rs. ${zyFmtMoney(Number(s.net_client_payout_delta_pkr || 0), 2)}</div>
      </div>
    </div>

    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
      ${[
        ['all', `All (${allRows.length})`],
        ['new', `New (${s.new_rows || 0})`],
        ['updated', `Updated (${s.updated_rows || 0})`],
        ['unassigned', `Unassigned (${s.unassigned || 0})`]
      ].map(([k, lbl]) => `
        <button type="button" onclick="zyWnSetPreviewTab('${k}')"
          style="padding:4px 10px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid ${tab === k ? '#2563eb' : '#cbd5e1'};background:${tab === k ? '#eff6ff' : '#fff'};color:${tab === k ? '#1d4ed8' : '#475569'};">
          ${lbl}
        </button>
      `).join('')}
    </div>

    <div style="max-height:260px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
            <th style="padding:6px 8px;">Sync</th>
            <th style="padding:6px 8px;">Date</th>
            <th style="padding:6px 8px;">Number</th>
            <th style="padding:6px 8px;">Service</th>
            <th style="padding:6px 8px;">Date-Locked Owner</th>
            <th style="padding:6px 8px;text-align:right;">SMS</th>
            <th style="padding:6px 8px;text-align:right;">Owner Rev</th>
            <th style="padding:6px 8px;text-align:right;">Client PKR</th>
          </tr>
        </thead>
        <tbody>
          ${filteredRows.length ? filteredRows.slice(0, 150).map(r => `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:5px 8px;">${actionTag(r.action)}</td>
              <td class="monospace" style="padding:5px 8px;">${zyEsc(r.date_ymd)}</td>
              <td class="monospace" style="padding:5px 8px;font-weight:600;">${zyEsc(r.number)}</td>
              <td style="padding:5px 8px;">${zyEsc(r.service)}</td>
              <td style="padding:5px 8px;">${ownerCell(r)}</td>
              <td class="monospace" style="padding:5px 8px;text-align:right;font-weight:700;">
                ${r.action === 'updated' ? `<span style="color:#94a3b8;text-decoration:line-through;margin-right:4px;">${r.prev_sms_count}</span>` : ''}${r.sms_count}
              </td>
              <td class="monospace" style="padding:5px 8px;text-align:right;">$${zyFmtMoney(Number(r.owner_revenue_usd || 0), 4)}</td>
              <td class="monospace" style="padding:5px 8px;text-align:right;">Rs. ${zyFmtMoney(Number(r.client_payout_pkr || 0), 2)}</td>
            </tr>
          `).join('') : `<tr><td colspan="8" style="padding:18px;text-align:center;color:#94a3b8;">No rows in this filter tab.</td></tr>`}
        </tbody>
      </table>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px;flex-wrap:wrap;">
      <div style="font-size:12px;color:#64748b;">
        ${canCommit ? 'Existing identical rows are automatically skipped (0 double billing).' : 'All rows already match current database (0 changes to commit).'}
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-outline btn-sm" onclick="if(typeof closeModal==='function')closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" id="btn-wn-commit-excel" ${canCommit ? '' : 'disabled'} onclick="zyWnCommitExcelUpload()">
          <i class="fas fa-check-circle"></i> Confirm &amp; Sync Stats
        </button>
      </div>
    </div>
  `;
}

window.zyWnCommitExcelUpload = async function () {
  const st = window._wnPreviewState;
  if (!st || !st.preview_token) return;
  const btn = document.getElementById('btn-wn-commit-excel');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing…'; }
  try {
    const res = await apiFetch('/api/whitenoise-excel/commit', {
      method: 'POST',
      body: JSON.stringify({
        preview_token: st.preview_token,
        sheet_name: st.selected_sheet,
        col_map: st.col_map
      })
    });
    if (!res || !res.success) throw new Error(res?.error || 'Commit failed');
    const b = res.batch || {};
    if (typeof toast === 'function') {
      toast(`Synced ${b.batch_id}: +${b.rows_inserted || 0} new, ${b.rows_updated || 0} updated, ${b.rows_unchanged || 0} skipped (${(b.net_sms_delta || 0) >= 0 ? '+' : ''}${b.net_sms_delta || 0} SMS)`, 'success');
    }
    window._wnPreviewState = null;
    if (typeof closeModal === 'function') closeModal();
    if (document.getElementById('cdr2-body')) renderOwnerCdr2Load(1);
    if (document.getElementById('cdr2-batches-body')) zyLoadWhitenoiseBatches('cdr2-batches-body');
    if (document.getElementById('wn-panel-batches-body')) zyLoadWhitenoiseBatches('wn-panel-batches-body');
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to sync Excel stats', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm &amp; Sync Stats'; }
  }
};

window.zyLoadWhitenoiseBatches = async function (targetContainerId = 'cdr2-batches-body') {
  const el = document.getElementById(targetContainerId);
  if (!el) return;
  el.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Loading upload history…</div>';
  try {
    const res = await apiFetch('/api/whitenoise-excel/batches');
    const list = (res && res.data) || [];
    if (!list.length) {
      el.innerHTML = `<div style="padding:28px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:6px;">
        No Excel reports uploaded yet. Upload your first cumulative daily report to see audit history here.
      </div>`;
      return;
    }
    el.innerHTML = `
      <div style="overflow:auto;border:1px solid #e2e8f0;border-radius:6px;">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
              <th style="padding:8px 10px;">Batch ID</th>
              <th style="padding:8px 10px;">Filename &amp; Sheet</th>
              <th style="padding:8px 10px;">Date Span</th>
              <th style="padding:8px 10px;text-align:right;">New / Upd / Skip</th>
              <th style="padding:8px 10px;text-align:right;">SMS Delta</th>
              <th style="padding:8px 10px;text-align:right;">Profit Delta</th>
              <th style="padding:8px 10px;">Uploaded</th>
              <th style="padding:8px 10px;text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(b => `
              <tr style="border-bottom:1px solid #f1f5f9;${b.rolled_back ? 'opacity:0.6;' : ''}">
                <td class="monospace" style="padding:8px 10px;font-weight:700;">${zyEsc(b.batch_id)}</td>
                <td style="padding:8px 10px;">
                  <div style="font-weight:600;color:#0f172a;">${zyEsc(b.filename)}</div>
                  <div style="font-size:11px;color:#64748b;">Sheet: ${zyEsc(b.sheet_name || 'Default')} · Matched: ${b.matched_client || 0} · Unassigned: ${b.unassigned || 0}</div>
                </td>
                <td class="monospace" style="padding:8px 10px;">${zyEsc(b.date_min || '—')} → ${zyEsc(b.date_max || '—')}</td>
                <td class="monospace" style="padding:8px 10px;text-align:right;">+${b.rows_inserted || 0} / ${b.rows_updated || 0} / ${b.rows_unchanged || 0}</td>
                <td class="monospace" style="padding:8px 10px;text-align:right;font-weight:700;">${(b.net_sms_delta || 0) >= 0 ? '+' : ''}${Number(b.net_sms_delta || 0).toLocaleString()}</td>
                <td class="monospace" style="padding:8px 10px;text-align:right;color:#059669;font-weight:700;">$${zyFmtMoney(Number(b.net_owner_profit_delta_usd || 0), 4)}</td>
                <td style="padding:8px 10px;font-size:11.5px;color:#64748b;">${zyEsc(String(b.uploaded_at || '').replace('T', ' ').slice(0, 16))}<br>by ${zyEsc(b.uploaded_by || 'Owner')}</td>
                <td style="padding:8px 10px;text-align:right;">
                  ${b.rolled_back
                    ? `<span style="font-size:11.5px;color:#94a3b8;font-weight:600;">Rolled Back</span>`
                    : `<button type="button" class="btn btn-outline btn-sm" style="color:#dc2626;border-color:#fecaca;" onclick="zyWnRollbackBatch(${b.id}, '${zyEsc(b.batch_id)}', '${targetContainerId}')"><i class="fas fa-rotate-left"></i> Rollback</button>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:#dc2626;">${zyEsc(err.message || 'Failed to load batch history')}</div>`;
  }
};

window.zyWnRollbackBatch = async function (id, batchCode, containerId) {
  const ok = typeof confirmAction === 'function'
    ? await confirmAction(`Rollback Batch ${batchCode}?`, 'This will remove rows inserted by this batch and restore exact pre-batch counts & balances.')
    : window.confirm(`Rollback batch ${batchCode}? This will revert its changes cleanly.`);
  if (!ok) return;
  try {
    const res = await apiFetch(`/api/whitenoise-excel/batches/${id}/rollback`, { method: 'POST', body: JSON.stringify({}) });
    if (typeof toast === 'function') {
      toast(`Rolled back ${batchCode}: removed ${res.removed_rows || 0}, restored ${res.restored_rows || 0} row(s).`, 'success');
    }
    if (containerId) zyLoadWhitenoiseBatches(containerId);
    if (document.getElementById('cdr2-body')) renderOwnerCdr2Load(1);
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Rollback failed', 'error');
  }
};




