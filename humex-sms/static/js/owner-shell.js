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
  { t: "NUMBERS & INVENTORY", c: '#e8a33d', items: [
      ['Numbers Pool Hub', 'my-numbers', 'fa-mobile-screen'],
      ['Ranges & Rate Card', 'sms-ranges', 'fa-table-list'],
      ['Upload & Blacklist', 'upload-numbers', 'fa-cloud-arrow-up'],
      ['Allocation & Transfer Log', 'allocation-history', 'fa-file-lines'],
  ] },
  { t: "SMS & ANALYTICS", c: '#2f7fc4', items: [
      ['SMS CDR Reports', 'my-sms', 'fa-comment-sms'],
      ['CDR 2 (Whitenoise)', 'cdr2', 'fa-tower-cell'],
      ['Failed SMS', 'failed-sms', 'fa-triangle-exclamation'],
      ['Live Monitor', 'live-otp-feed', 'fa-bell'],
      ['Analytics & Reports', 'sms-analytics', 'fa-chart-line'],
  ] },
  { t: "SMPP & PROVIDERS", c: '#5aa93f', items: [
      ['SMPP Monitor Hub', 'smpp-dashboard', 'fa-server'],
      ['Providers & Interconnects', 'smpp-accounts', 'fa-plug'],
  ] },
  { t: "PAYMENTS", c: '#10b981', items: [
      ['Agent Payment Requests', 'payout-requests', 'fa-hand-holding-dollar'],
      ['My Payouts', 'my-payouts', 'fa-sack-dollar'],
      ['Account Balances', 'account-balances', 'fa-wallet'],
      ['Statements', 'statements', 'fa-file-invoice-dollar'],
      ['Credit Notes', 'credit-notes', 'fa-receipt'],
  ] },
  { t: "ACCOUNTS & SECURITY", c: '#d94f4f', items: [
      ['Accounts & Hierarchy', 'agents', 'fa-user-secret'],
      ['Security & Firewall', 'firewall-dashboard', 'fa-shield-halved'],
      ['Audit Logs', 'audit-logs', 'fa-clipboard-list'],
  ] },
  { t: "PLATFORM & SUPPORT", c: '#f0862d', items: [
      ['General & Brand Settings', 'general-settings', 'fa-gear'],
      ['API & Webhooks', 'api-tokens', 'fa-code'],
      ['Notifications', 'notifications', 'fa-bell'],
      ['Communication Hub', 'announcements', 'fa-bullhorn'],
  ] },
  { t: "AGENT REQUESTS", c: '#4caf50', items: [
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
           <span class="zy-ic"><i class="fas ${icon}" style="color:${g.c}"></i></span><span>${label}</span>
           <i class="fas fa-chevron-right zy-caret" style="opacity:0.65;font-size:10px;"></i></div>`;
      }).join('');
    }
    const subItems = g.items.map(([label, page]) =>
      `<div class="zy-ssub-item" id="nav-${page}" data-page="${page}" role="link" tabindex="0"
            onclick="loadPage('${page}')"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();loadPage('${page}');}">${label}</div>`
    ).join('');
    return `<div class="zy-snav" id="grp-adm-${gi}" role="button" tabindex="0" aria-expanded="false" aria-controls="sb-${gi}"
                 onclick="zyToggleGroup('sb-${gi}', this)"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();zyToggleGroup('sb-${gi}', this);}">
              <span class="zy-ic"><i class="fas fa-folder" style="color:${g.c}"></i></span><span>${g.t}</span>
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
  'smpp-sessions': 'smpp-dashboard',
  'connected-clients': 'smpp-dashboard',
  'dlr-monitor': 'smpp-dashboard',
  'throughput-monitor': 'smpp-dashboard',
  'connection-logs': 'smpp-dashboard',
  'smpp-security': 'smpp-dashboard',
  'login-panels': 'smpp-accounts',
  'cr-api-panels': 'smpp-accounts',
  'whitenoise-panels': 'smpp-accounts',
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
  'smpp-settings': 'general-settings',
  'api-playground': 'api-tokens',
  'webhook-config': 'api-tokens',
  'standard-webhook': 'api-tokens',
  'custom-postback': 'api-tokens',
  'field-mapping': 'api-tokens',
  'test-endpoint': 'api-tokens',
  'http-overview': 'api-tokens',
  'live-test': 'api-tokens',
  'documentation': 'api-tokens',
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
  'smpp-sessions': 'SMPP Sessions',
  'connected-clients': 'Connected Clients',
  'dlr-monitor': 'DLR Monitor',
  'throughput-monitor': 'Throughput Monitor',
  'connection-logs': 'Connection Logs',
  'smpp-security': 'SMPP Security',
  'login-panels': 'Login Panels',
  'cr-api-panels': 'CR API Panels',
  'whitenoise-panels': 'Whitenoise API',
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
  'smpp-settings': 'SMPP Settings',
  'my-profile': 'My Profile',
  'profile': 'My Profile',
  'profile-security': 'Change Password',
  '2fa': '2FA Authenticator',
  'api-tokens': 'API & Webhooks',
  'audit-logs': 'Audit Logs',
  'payout-requests': 'Agent Payment Requests',
  'agent-requests': 'Agent Number Requests',
  'api-playground': 'API Playground',
  'webhook-config': 'Webhook Config',
  'standard-webhook': 'Standard Webhook',
  'custom-postback': 'Custom Postback',
  'field-mapping': 'Field Mapping',
  'test-endpoint': 'Test Endpoint',
  'http-overview': 'HTTP Overview',
  'live-test': 'Live Test Simulator',
  'documentation': 'API Documentation',
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

    const alertHtml = (s.down_connections && s.down_connections.length)
      ? `<div class="zy-alert">SMPP Connection Down — OTPs may be missed!<br>
          <small>${s.down_connections.map(x => `${zyEsc(x.company)} (${zyEsc(x.status)})`).join(', ')}</small></div>`
      : '';

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
        shortcuts: [
          { label: 'Dashboard', icon: 'fa-gauge-high', page: 'dashboard' },
          { label: 'Rate Card', icon: 'fa-tags', page: 'sms-ranges' },
          { label: 'Agents', icon: 'fa-user-tie', page: 'agents' },
          { label: 'SMS Reports', icon: 'fa-chart-column', page: 'my-sms' },
          { label: 'My Numbers', icon: 'fa-mobile-screen', page: 'my-numbers' },
          { label: 'API Usage', icon: 'fa-key', page: 'api-tokens' }
        ],
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

/* ═══ CDR 2 (WHITENOISE PROVIDER — MONTHLY10 FIXED) ═══════════════ */
async function renderOwnerCdr2() {
  const c = document.getElementById('page-content');
  if (typeof zyCrumb === 'function') {
    zyCrumb(['SMS Stats & Reports', 'CDR 2 (Whitenoise)']);
  }
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = 'CDR 2 (Whitenoise)';

  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const defaultFrom = `${today} 00:00:00`;
  const defaultTo = `${today} 23:59:59`;

  const groupChips = [
    { id: 'hour', label: 'Hour', val: 'hour' },
    { id: 'date', label: 'Date', val: 'date' },
    { id: 'month', label: 'Month', val: 'month' },
    { id: 'range', label: 'Range', val: 'range' },
    { id: 'agent', label: 'Agent', val: 'agent' },
    { id: 'number', label: 'Number', val: 'number' },
    { id: 'cli', label: 'CLI', val: 'cli' }
  ];

  const chipsHtml = groupChips.map(g => `
    <label class="zy-chip-pill" for="grp-cdr2-${g.id}">
      <input type="checkbox" id="grp-cdr2-${g.id}" class="cdr2-grp-chk" value="${g.val}" onchange="this.closest('.zy-chip-pill').classList.toggle('active', this.checked)">
      ${g.label}
    </label>
  `).join('');

  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-tower-cell" style="color:#4f46e5;"></i> CDR 2 — Whitenoise Provider</div>
        <div class="page-subtitle">Dedicated Whitenoise OTP &amp; SMS detail records · Locked to <b>Monthly (30/5) {W}</b> payout schedule (5-day hold).</div>
      </div>
      <div class="page-actions" style="display:flex;gap:8px;align-items:center;">
        <span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;padding:5px 10px;font-weight:700;"><i class="fas fa-calendar-check"></i> Monthly (30/5) {W} · 5d Hold</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="loadPage('whitenoise-panels')"><i class="fas fa-plug"></i> Whitenoise API</button>
      </div>
    </div>
    <div class="zy-filter-grid" data-apx="filter-bar" data-cdr-compact="1" style="margin-bottom:14px;">
      <div class="zy-cdr-head-row">
        <div style="display:flex;align-items:center;gap:7px;">
          <i class="fas fa-tower-cell" style="color:#4f46e5;"></i>
          <span>CDR 2 Filters &amp; Live Whitenoise Sync</span>
        </div>
        <div id="cdr2-sync-status" style="font-size:11.5px;font-weight:600;color:#64748b;"></div>
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
            <option value="">Filter Agent</option>
          </select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="cdr2-status">Cause</label>
          <select id="cdr2-status" class="zy-filter-input">
            <option value="All">All</option>
            <option value="1">Success</option>
            <option value="2">ScrubAg</option>
            <option value="3">Others</option>
          </select>
        </div>
      </div>

      <div class="zy-groupby-card zy-cdr2-special-bar">
        <div class="zy-groupby-title">
          <i class="fas fa-phone-volume" style="font-size:11px;color:#4f46e5;"></i>
          Special Number Sync :
        </div>
        <div class="zy-groupby-search-wrap">
          <input type="text" id="cdr2-sync-number" class="zy-groupby-search-input"
            placeholder="Number with/without + or country code (e.g. +447700100002)"
            autocomplete="off"
            oninput="var b=document.getElementById('cdr2-sync-number-clear');if(b)b.style.display=this.value.trim()?'inline-flex':'none';"
            onkeydown="if(event.key==='Enter'){event.preventDefault();zyOwnerSyncCdr2Number();}">
          <button type="button" id="cdr2-sync-number-clear" class="zy-groupby-search-clear" title="Clear number" aria-label="Clear number" style="display:none;" onclick="zyClearOwnerCdr2SyncNumber()">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <button type="button" class="zy-btn-blue-solid" id="btn-sync-cdr2-number" onclick="zyOwnerSyncCdr2Number()">
          <i class="fas fa-magnifying-glass"></i> Sync<span class="zy-hide-xs"> &amp; Search Number</span>
        </button>
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
            placeholder="Search Table (Date, Range, CLI, SMS, Agent, Payterm, Cause)..."
            autocomplete="off"
            oninput="zyHandleCdrSearchInput(this, 'cdr2-search-clear', () => renderOwnerCdr2Load(1, false))"
            onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._zyCdrSearchTimer){clearTimeout(window._zyCdrSearchTimer);}renderOwnerCdr2Load(1, false);}">
          <button type="button" id="cdr2-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearCdrSearch('cdr2-search', 'cdr2-search-clear', () => renderOwnerCdr2Load(1, false))">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="zy-table-toolbar zy-cdr-control-bar">
        <div class="zy-cdr-actions-left">
          <button type="button" class="zy-btn-blue-solid" id="btn-show-cdr2" onclick="renderOwnerCdr2Load(1, true)">
            <i class="fas fa-sync-alt"></i> Show Report &amp; Sync<span class="zy-hide-xs"> (Auto Pool)</span>
          </button>
        </div>
        <div class="zy-toolbar-right">
          <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('dt-cdr2', this)"><i class="fas fa-columns"></i> Columns</button>
          <div class="zy-toolbar-select-wrap">
            <label class="zy-toolbar-label" for="cdr2-limit">Show Records</label>
            <select id="cdr2-limit" class="zy-toolbar-select" onchange="renderOwnerCdr2Load(1, false)">
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
        <div class="zy-loading" style="padding:40px;text-align:center;color:var(--sp-text-muted,#64748b);">Loading CDR 2 records…</div>
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
      aEl.innerHTML = '<option value="">Filter Agent</option>' +
        agents.map(ag => `<option value="${ag.id}">${zyEsc(ag.username || ag.name || ag.id)}${ag.whitenoise_access ? ' (WN)' : ''}</option>`).join('');
    }
  } catch (err) {
    console.warn('Error populating CDR 2 filters:', err);
  }

  renderOwnerCdr2Load(1, false);
}
window.renderOwnerCdr2 = renderOwnerCdr2;

window.zyOwnerSyncCdr2Number = function () {
  const inp = document.getElementById('cdr2-sync-number');
  const raw = inp ? inp.value.trim() : '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 6) {
    if (typeof toast === 'function') toast('Please enter a phone number (with or without country code or +) to sync.', 'warning');
    const syncEl = document.getElementById('cdr2-sync-status');
    if (syncEl) syncEl.innerHTML = `<span style="color:#d97706;"><i class="fas fa-exclamation-circle"></i> Enter a phone number first to run Special Number Sync.</span>`;
    if (inp) {
      inp.focus();
      inp.style.borderColor = '#ef4444';
      setTimeout(() => { inp.style.borderColor = ''; }, 1800);
    }
    return;
  }
  renderOwnerCdr2Load(1, true);
};

window.zyClearOwnerCdr2SyncNumber = function () {
  const inp = document.getElementById('cdr2-sync-number');
  if (inp) inp.value = '';
  const clr = document.getElementById('cdr2-sync-number-clear');
  if (clr) clr.style.display = 'none';
  renderOwnerCdr2Load(1, false);
};

window.zyResetCdr2Filters = function () {
  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const f = document.getElementById('cdr2-from'); if (f) f.value = `${today} 00:00:00`;
  const t = document.getElementById('cdr2-to'); if (t) t.value = `${today} 23:59:59`;
  ['cdr2-range', 'cdr2-agent', 'cdr2-search', 'cdr2-sync-number'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const clr = document.getElementById('cdr2-search-clear'); if (clr) clr.style.display = 'none';
  const clrNum = document.getElementById('cdr2-sync-number-clear'); if (clrNum) clrNum.style.display = 'none';
  const st = document.getElementById('cdr2-status'); if (st) st.value = 'All';
  document.querySelectorAll('.cdr2-grp-chk').forEach(cb => {
    cb.checked = false;
    cb.closest('.zy-chip-pill')?.classList.remove('active');
  });
  renderOwnerCdr2Load(1, false);
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
    number: val('cdr2-sync-number').trim(),
    search: val('cdr2-search').trim(),
    status: val('cdr2-status') !== 'All' ? val('cdr2-status') : '',
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

async function renderOwnerCdr2Load(targetPage = 1, doSync = false) {
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
  const syncNumber = val('cdr2-sync-number').trim();
  const search = val('cdr2-search').trim();
  const status = val('cdr2-status');
  const syncEl = document.getElementById('cdr2-sync-status');

  body.innerHTML = `<div class="zy-loading" style="padding:40px;text-align:center;color:#64748b;">
    <div style="display:inline-block;margin-bottom:8px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:#4f46e5;"></i></div>
    <div>${doSync ? 'Syncing live Whitenoise OTPs &amp; loading CDR 2…' : 'Loading CDR 2 records…'}</div>
  </div>`;

  if (doSync) {
    const syncDigits = syncNumber.replace(/\D/g, '');
    const fallbackDigits = search.replace(/\D/g, '');
    const targetNum = syncDigits.length >= 6 ? syncNumber : (fallbackDigits.length >= 6 ? search : '');
    try {
      if (syncEl) syncEl.innerHTML = `<span style="color:#4f46e5;"><i class="fas fa-spinner fa-spin"></i> ${targetNum ? `Syncing number ${zyEsc(targetNum)}…` : 'Checking Whitenoise numbers…'}</span>`;
      const syncRes = await apiFetch('/api/cdr2/sync', {
        method: 'POST',
        body: JSON.stringify({ range, agent_id: agentId, number: targetNum }),
        signal: reqSignal
      });
      if (syncRes && syncEl) {
        const matchedNote = Array.isArray(syncRes.matched_numbers) && syncRes.matched_numbers.length === 1 ? ` (${zyEsc(syncRes.matched_numbers[0])})` : '';
        syncEl.innerHTML = `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;">Synced ${syncRes.checked || 0} num(s)${matchedNote} · ${syncRes.new_sms || 0} new SMS · ${syncRes.conversions || 0} conv.${syncRes.skipped_cooldown ? ` · ${syncRes.skipped_cooldown} cooldown` : ''}</span>`;
      }
    } catch (syncErr) {
      if (syncErr && syncErr.name === 'AbortError') return;
      if (syncEl) syncEl.innerHTML = `<span style="color:#d97706;">Sync warning: ${zyEsc(syncErr.message || 'Check Whitenoise connection')}</span>`;
    }
  }

  const checkedBoxes = Array.from(document.querySelectorAll('.cdr2-grp-chk:checked')).map(cb => cb.value);
  const params = new URLSearchParams();
  if (from) params.append('date_from', from);
  if (to) params.append('date_to', to);
  if (range) params.append('range', range);
  if (agentId) params.append('agent_id', agentId);
  if (syncNumber) params.append('number', syncNumber);
  if (search) params.append('search', search);
  if (status && status !== 'All') params.append('status', status);
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

    if (logs && logs.grouped && checkedBoxes.length) {
      const keyLabels = { hour: 'Hour', date: 'Date', month: 'Month', range: 'Range', agent: 'Agent', number: 'Number', cli: 'CLI' };
      const cols = [...checkedBoxes.map(k => keyLabels[k] || k), 'SMS Count', 'Payterm', 'Currency', 'My Payout', 'Agent Payout', 'Profit'];
      const rows = data.map(g => [
        ...checkedBoxes.map(k => (k === 'agent' || k === 'client') ? (g[k] || '') : (g[k] || '—')),
        g.sms_count || 0,
        { v: 'Monthly (30/5) {W}', h: typeof zyPaytermBadge === 'function' ? zyPaytermBadge('Monthly') : 'Monthly (30/5) {W}' },
        g.currency || '$',
        zyFmtMoney(Number(g.payout || 0), 4),
        zyFmtMoney(Number(g.agent_payout != null ? g.agent_payout : 0), 4),
        zyFmtMoney(Number(g.profit != null ? g.profit : Math.max(0, (g.payout || 0) - (g.agent_payout || 0))), 4)
      ]);

      const sum = logs.summary || {};
      const totalGroups = logs.total != null ? logs.total : (sum.total_groups != null ? sum.total_groups : data.length);
      const totalSms = sum.total_sms != null ? sum.total_sms : data.reduce((s, g) => s + (g.sms_count || 0), 0);
      const totalPayout = sum.payout != null ? Number(sum.payout) : data.reduce((s, g) => s + (parseFloat(g.payout) || 0), 0);
      const totalAgentPayout = sum.agent_payout != null ? Number(sum.agent_payout) : data.reduce((s, g) => s + (parseFloat(g.agent_payout) || 0), 0);
      const totalProfit = sum.profit != null ? Number(sum.profit) : Math.max(0, totalPayout - totalAgentPayout);

      const footRow = `<td><b>Total Groups: ${Number(totalGroups).toLocaleString()}</b><br><small>Total SMS: ${totalSms.toLocaleString()}</small></td>` +
        '<td></td>'.repeat(Math.max(0, checkedBoxes.length - 1)) +
        `<td><b>${totalSms.toLocaleString()}</b></td>` +
        `<td><b>Monthly (30/5) {W}</b></td>` +
        `<td><b>$</b></td>` +
        `<td><b>${zyFmtMoney(totalPayout, 4)}</b></td>` +
        `<td><b>${zyFmtMoney(totalAgentPayout, 4)}</b></td>` +
        `<td><b>${zyFmtMoney(totalProfit, 4)}</b></td>`;

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
        onPageChange: (p) => renderOwnerCdr2Load(p, false),
        onSizeChange: (s) => {
          const sel = document.getElementById('cdr2-limit');
          if (sel) sel.value = String(s);
          renderOwnerCdr2Load(1, false);
        },
        footRow
      });
      zy2Render('dt-cdr2');
    } else {
      const cols = ['Date', 'Provider', 'Range', 'Number', 'CLI', 'SMS', 'Agent', 'Payterm', 'Conv.', 'My Payout', 'Agent Payout', 'Profit', 'Cause'];
      const rows = data.map(s => {
        const dtCell = typeof zyFormatDateTimeStacked === 'function'
          ? zyFormatDateTimeStacked(s.timestamp || s.date)
          : { v: (s.timestamp || s.date || '').replace('T', ' ').slice(0, 19), h: (s.timestamp || s.date || '').replace('T', ' ').slice(0, 19) };
        const myPayoutVal = parseFloat(s.company_rate != null ? s.company_rate : (s.company_payout != null ? s.company_payout : (s.carrier_revenue != null ? s.carrier_revenue : (s.my_payout || 0)))) || 0;
        const agentPayoutVal = parseFloat(s.agent_payout != null ? s.agent_payout : (s.agent_rate || 0)) || 0;
        const profitVal = parseFloat(s.owner_amount != null ? s.owner_amount : (s.profit != null ? s.profit : Math.max(0, myPayoutVal - agentPayoutVal))) || 0;
        const numStr = String(s.number || '').trim();
        const cliStr = String(s.cli || s.app || '').trim();
        const msgRaw = String(s.message || '');
        const msgCellHtml = typeof zyRenderSmsCell === 'function' ? zyRenderSmsCell(msgRaw) : `<div class="zy-sms-cell">${zyEsc(msgRaw)}</div>`;
        const agentVal = String(s.agent || s.agent_username || s.agent_name || '').trim();
        const ptHtml = typeof zyPaytermBadge === 'function' ? zyPaytermBadge('Monthly') : '<span class="badge badge-purple">Monthly (30/5) {W}</span>';
        const convHtml = s.conversion_sent
          ? '<span class="badge badge-green" style="font-size:10px;"><i class="fas fa-check"></i> Sent</span>'
          : '<span class="text-muted" style="font-size:11px;">—</span>';
        const causeVal = s.cause || (s.status === 'delivered' || s.status === 'success' ? 'Success' : (s.status || '—'));

        return [
          dtCell,
          `<span class="badge" style="background:#eef2ff;color:#4338ca;">${zyEsc(s.provider || 'Whitenoise')}</span>`,
          zyEsc(s.range_name || s.range_label || s.range || s.country || '—'),
          { v: numStr, h: numStr ? `<span class="monospace" style="font-weight:600;">${zyEsc(numStr)}</span>` : '—' },
          { v: cliStr, h: cliStr ? `<span class="monospace" style="white-space:normal;word-break:break-word;">${zyEsc(cliStr)}</span>` : '—' },
          { v: msgRaw, h: msgCellHtml },
          { v: agentVal, h: agentVal ? zyEsc(agentVal) : '' },
          { v: 'Monthly (30/5) {W}', h: ptHtml },
          { v: s.conversion_sent ? 'sent' : '', h: convHtml },
          myPayoutVal ? zyFmtMoney(myPayoutVal, 4) : '0',
          agentPayoutVal ? zyFmtMoney(agentPayoutVal, 4) : '0',
          profitVal ? zyFmtMoney(profitVal, 4) : '0',
          zyEsc(causeVal)
        ];
      });

      const sum = logs.summary || {};
      const totalSms = (sum.total_sms != null) ? sum.total_sms : (logs.total != null ? logs.total : rows.length);
      const usdIn = sum.payout != null ? sum.payout : data.reduce((a, s) => a + (parseFloat(s.company_rate ?? s.company_payout ?? s.carrier_revenue ?? s.my_payout ?? 0) || 0), 0);
      const usdOut = sum.agent_payout != null ? sum.agent_payout : data.reduce((a, s) => a + (parseFloat(s.agent_payout ?? s.agent_rate ?? 0) || 0), 0);
      const usdPr = sum.profit != null ? sum.profit : Math.max(0, usdIn - usdOut);

      const footRow = `<td><b>Total SMS<br>${totalSms.toLocaleString()}</b></td>` +
        '<td></td>'.repeat(6) +
        `<td><b>Monthly (30/5) {W}</b></td><td></td>` +
        `<td><b>My Payout<br>$${zyFmtMoney(usdIn, 4)}</b></td>` +
        `<td><b>Agent Payout<br>$${zyFmtMoney(usdOut, 4)}</b></td>` +
        `<td><b>Profit<br>$${zyFmtMoney(usdPr, 4)}</b></td>` +
        '<td></td>';

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
        onPageChange: (p) => renderOwnerCdr2Load(p, false),
        onSizeChange: (s) => {
          const sel = document.getElementById('cdr2-limit');
          if (sel) sel.value = String(s);
          renderOwnerCdr2Load(1, false);
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



