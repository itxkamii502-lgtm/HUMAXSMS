/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Owner panel shell
   Same shell/skin as the agent and client panels.
   Rebuilds the frame (header, menu, breadcrumb) and applies the skin.
   Loads AFTER owner-engine.js / owner-features.js.
   ═══════════════════════════════════════════════════════════════ */

/* Theme engine & sidebar toggle are provided by shared-brand-theme.js & shared-ui-kit.js */
const ZY_LOGO_SRC = window.ZY_LOGO_SRC || '/static/img/humex-sms-logo.png';

const ZY_ADMIN_MENU = [
  { t: null, c: '#1d4ed8', items: [
      ['Dashboard', 'dashboard', 'fa-gauge-high'],
  ] },
  { t: null, c: '#0284c7', items: [
      ['Apps Links', 'app-links', 'fa-link'],
  ] },
  { t: null, c: '#10b981', items: [
      ['Live Access', 'live-access', 'fa-tower-broadcast'],
  ] },
  { t: null, c: '#0f766e', items: [
      ['VPS Health', 'vps-health', 'fa-server'],
  ] },
  { t: "NUMBERS & INVENTORY", i: 'fa-sim-card', c: '#1d4ed8', items: [
      ['Numbers Pool Hub', 'my-numbers', 'fa-mobile-screen'],
      ['Blocked Numbers', 'blocked-numbers', 'fa-ban'],
      ['Ranges Add', 'sms-ranges', 'fa-table-list'],
      ['Smart Excel Import', 'smart-sheet-import', 'fa-file-excel'],
      ['Upload & Blacklist', 'upload-numbers', 'fa-cloud-arrow-up'],
      ['Allocation & Transfer Log', 'allocation-history', 'fa-file-lines'],
  ] },
  { t: "SMS & ANALYTICS", i: 'fa-chart-line', c: '#059669', items: [
      ['Show Report', 'my-sms', 'fa-comment-sms'],
      ['Whitenoise Reports', 'cdr2', 'fa-tower-cell'],
      ['Failed SMS', 'failed-sms', 'fa-triangle-exclamation'],
      ['Live Monitor', 'live-otp-feed', 'fa-signal'],
      ['Analytics & Reports', 'sms-analytics', 'fa-chart-pie'],
  ] },
  { t: "PROVIDERS", i: 'fa-plug', c: '#0284c7', items: [
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
  { t: "ACCOUNTS & SECURITY", i: 'fa-shield-halved', c: '#1d4ed8', items: [
      ['Agents & Accounts', 'agents', 'fa-user-secret'],
      ['Security & Firewall', 'firewall-dashboard', 'fa-shield-halved'],
      ['Audit Logs', 'audit-logs', 'fa-clipboard-list'],
  ] },
  { t: "PLATFORM & SUPPORT", i: 'fa-sliders', c: '#0d9488', items: [
      ['General & Brand Settings', 'general-settings', 'fa-gear'],
      ['Notifications', 'notifications', 'fa-bell'],
      ['Communication Hub', 'announcements', 'fa-bullhorn'],
  ] },
  { t: "AGENT REQUESTS", i: 'fa-inbox', c: '#0284c7', items: [
      ['Agent Number Requests', 'agent-requests', 'fa-sim-card'],
      ['Registration Requests', 'registration-requests', 'fa-user-plus'],
  ] },
  { t: null, c: '#1d4ed8', items: [
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
        const href = (typeof window.zyPageUrl === 'function') ? window.zyPageUrl(page) : `/ints/owner/${page}`;
        return `<a class="zy-snav nav-item" id="nav-${page}" data-page="${page}" href="${href}"
                     onclick="return window.zyNavClick ? window.zyNavClick(event, '${page}') : (event.preventDefault(), loadPage('${page}'), false)">
           <span class="zy-ic" style="--ic-accent:${g.c};"><i class="fas ${icon}" style="color:${g.c}"></i></span><span class="zy-snav-txt">${label}</span>
           <i class="fas fa-chevron-right zy-caret zy-caret-sm"></i></a>`;
      }).join('');
    }
    const subItems = g.items.map(([label, page, icon]) => {
      const href = (typeof window.zyPageUrl === 'function') ? window.zyPageUrl(page) : `/ints/owner/${page}`;
      return `<a class="zy-ssub-item" id="nav-${page}" data-page="${page}" href="${href}"
            onclick="return window.zyNavClick ? window.zyNavClick(event, '${page}') : (event.preventDefault(), loadPage('${page}'), false)">
         <i class="fas ${icon || 'fa-circle-dot'} zy-sub-ic" aria-hidden="true"></i><span class="zy-sub-txt">${label}</span>
       </a>`;
    }).join('');
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
  tick();
  if (window._zyOwnerClockTimer) clearInterval(window._zyOwnerClockTimer);
  window._zyOwnerClockTimer = setInterval(tick, 1000);

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
  'blocked-numbers': 'my-numbers',
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
  'app-links': 'Apps Links',
  'live-access': 'Live Access',
  'vps-health': 'VPS & Server Health',
  'smart-sheet-import': 'Smart Excel Import',
  'bulk-allocation': 'Bulk Allocation',
  'revoke-numbers': 'Blocked Numbers',
  'blocked-numbers': 'Blocked Numbers',
  'sms-ranges': 'Ranges Add',
  'sms-rate-card': 'Ranges Add',
  'bulk-range-import': 'Bulk Range Import',
  'blacklist-management': 'Blacklist Management',
  'number-transfers-log': 'Transfer Log',
  'my-sms': 'Show Report',
  'failed-sms': 'Failed SMS',
  'cdr2': 'Whitenoise Reports',
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
  'agents': 'Agents',
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
    const [stats, daily, periodStats, ranges, agents, appLinksRes] = await Promise.all([
      apiFetch('/api/dashboard/stats'),
      apiFetch('/api/sms/daily-stats'),
      apiFetch('/api/sms/period-stats').catch(() => null),
      apiFetch('/api/numbers/sms-ranges'),
      apiFetch('/api/agents?limit=200').catch(() => ({ data: [] })),
      apiFetch('/api/app-links?dashboard=1&limit=10', { silent: true }).catch(() => ({ data: [] }))
    ]);
    const appLinks = Array.isArray(appLinksRes?.data) ? appLinksRes.data.slice(0, 10) : [];
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

    const apiTodaySms = Number(p.api_today != null ? p.api_today : (s.api_today_sms != null ? s.api_today_sms : (d.today != null ? d.today : 0)));
    const apiYestSms = Number(p.api_yesterday != null ? p.api_yesterday : (s.api_yesterday_sms != null ? s.api_yesterday_sms : (d.yesterday || 0)));
    const wnTodaySms = Number(p.whitenoise_today != null ? p.whitenoise_today : (s.whitenoise_today_sms || 0));
    const wnLast30Val = Number(p.whitenoise_last_30_days != null ? p.whitenoise_last_30_days : (s.whitenoise_month_sms || 0));
    const totalTodaySms = Number(p.today != null ? p.today : (apiTodaySms + wnTodaySms));
    const yestSmsVal = Number(p.yesterday != null ? p.yesterday : (d.yesterday || s.yesterday || 0));
    const last7Val = Number(p.last_7_days != null ? p.last_7_days : weeklyTraffic.reduce((a, b) => a + (Number(b) || 0), 0));
    const last30Val = Number(p.last_30_days != null ? p.last_30_days : (d.this_month || s.this_month || 0));
    const yearSmsVal = Number(p.year != null ? p.year : (s.this_year || 0));

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
      const isWn = Boolean(
        r.is_whitenoise ||
        String(r.provider || '').toLowerCase().includes('whitenoise') ||
        String(r.payout_schedule || '').toLowerCase() === 'monthly30_5' ||
        String(r.range_name || r.name || '').toLowerCase().includes('whitenoise')
      );
      return {
        name: r.range_name || r.name || r.country || '—',
        rateFormatted: `${curr}${typeof zyFmtMoney === 'function' ? zyFmtMoney(wkRate, 4) : Number(wkRate).toFixed(4)}`,
        dateAdded,
        isWn
      };
    });

    const alertHtml = '';

    if (typeof window.zyRenderUnifiedDashboard === 'function') {
      window.zyRenderUnifiedDashboard({
        containerId: 'page-content',
        roleLabel: 'Owner',
        alertHtml,
        rangesRoute: 'sms-ranges',
        reportsRoute: 'my-sms',
        notificationsRoute: 'notifications',
        chartId: 'zy-owner-week-chart',
        chartTodayTotal: apiTodaySms,
        weeklyLabels,
        weeklyTraffic,
        hero: {
          label: 'Today SMS',
          value: apiTodaySms,
          yesterday: apiYestSms,
          subtitle: 'SMS traffic today (UTC)',
          icon: 'fa-check',
          page: 'my-sms'
        },
        moneyCards: [],
        shortcuts: [
          { label: 'Show Report', page: 'my-sms', icon: 'fa-comment-sms', tone: 'blue' },
          { label: 'Whitenoise Reports', page: 'cdr2', icon: 'fa-tower-cell', tone: 'green' },
          { label: 'Numbers Pool', page: 'my-numbers', icon: 'fa-mobile-screen', tone: 'blue' },
          { label: 'Ranges Add', page: 'sms-ranges', icon: 'fa-table-list', tone: 'green' },
          { label: 'Agent Requests', page: 'agent-requests', icon: 'fa-sim-card', tone: 'blue' },
          { label: 'VPS Health', page: 'vps-health', icon: 'fa-server', tone: 'green' }
        ],
        volumes: [
          { label: 'Yesterday SMS', value: yestSmsVal, page: 'my-sms' },
          { label: 'SMS Last 7 Days', value: last7Val, page: 'my-sms' },
          { label: 'SMS Last 30 Days', value: last30Val, page: 'my-sms' },
          { label: 'Yearly SMS', value: yearSmsVal, page: 'my-sms' }
        ],
        summaryTitle: 'System Snapshot',
        summaryRows: [
          { label: 'Active Agents', value: activeAgents.toLocaleString(), icon: 'fa-user-tie', page: 'agents' },
          { label: 'Total Numbers', value: Number(s.total_numbers ?? s.active_numbers ?? 0).toLocaleString(), icon: 'fa-mobile-screen', page: 'my-numbers' },
          { label: 'Whitenoise (30d)', value: wnLast30Val.toLocaleString(), icon: 'fa-tower-cell', page: 'cdr2' },
          { label: 'SMS Last 7 Days', value: last7Val.toLocaleString(), icon: 'fa-comment-sms', page: 'my-sms' }
        ],
        latestRanges,
        appLinks
      });
    }
  } catch (err) {
    console.error('Owner dashboard error:', err);
    c.innerHTML = `<div class="zy-panel"><div class="zy-panel-body" style="text-align:center;padding:30px;">
        Dashboard could not load. <button class="zy-gear" onclick="renderDashboard()">Retry</button></div></div>`;
  }
};

/* ═══ OWNER-ONLY VPS & SERVER HEALTH DASHBOARD ═════════════════ */
window._vpsHealthTimer = null;
window._vpsHealthAuto = true;
window._vpsHealthHistory = [];

window.zyVpsFmtBytes = function(bytes) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = b, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : (v >= 10 ? v.toFixed(1) : v.toFixed(2))} ${units[i]}`;
};

window.zyVpsFmtUptime = function(secs) {
  const s = Math.max(0, Math.floor(Number(secs || 0)));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
};

window.zyVpsToggleAuto = function(btn) {
  window._vpsHealthAuto = !window._vpsHealthAuto;
  if (btn) {
    btn.classList.toggle('is-active', window._vpsHealthAuto);
    btn.innerHTML = `<i class="fas fa-${window._vpsHealthAuto ? 'pause' : 'play'}"></i> Auto 5s: ${window._vpsHealthAuto ? 'ON' : 'OFF'}`;
  }
  if (window._vpsHealthAuto) {
    window.zyVpsRefreshNow(true);
  }
};

window.zyVpsClearCache = async function(btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch('/api/owner/vps-health/clear-cache', { method: 'POST', body: JSON.stringify({}) });
    if (res && res.success) {
      if (typeof toast === 'function') toast(res.message || 'Runtime caches cleared safely.', 'success');
      window.zyVpsRefreshNow(true);
    } else if (typeof toast === 'function') {
      toast((res && res.error) || 'Failed to clear caches', 'error');
    }
  } catch (e) {
    if (typeof toast === 'function') toast('Cache clear failed: ' + (e.message || 'error'), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.zyVpsTriggerBackup = async function(btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch('/api/backup/create', { method: 'POST', body: JSON.stringify({}) });
    if (res && (res.success || res.file || res.filename)) {
      if (typeof toast === 'function') toast('Manual backup created safely.', 'success');
      window.zyVpsRefreshNow(true);
    } else if (typeof toast === 'function') {
      toast((res && res.error) || 'Backup could not be created', 'warning');
    }
  } catch (e) {
    if (typeof toast === 'function') toast('Backup error: ' + (e.message || 'error'), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

function zyVpsRenderTrendSvg(history) {
  if (!history || history.length < 2) {
    return `<div style="text-align:center;padding:28px 12px;color:var(--sp-text-muted);font-size:12.5px;font-weight:700;">Collecting live CPU &amp; RAM samples… (updates every 5 seconds)</div>`;
  }
  const W = 560, H = 135, L = 34, R = 12, T = 10, B = 22;
  const cw = W - L - R, ch = H - T - B;
  const n = history.length;
  const pt = (idx, val) => {
    const x = L + (cw * idx) / Math.max(1, n - 1);
    const y = T + ch - (ch * Math.max(0, Math.min(100, Number(val) || 0))) / 100;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const cpuPts = history.map((h, i) => pt(i, h.cpu)).join(' ');
  const ramPts = history.map((h, i) => pt(i, h.ram)).join(' ');
  const cpuArea = `${L},${T + ch} ${cpuPts} ${L + cw},${T + ch}`;
  const gridLines = [0, 25, 50, 75, 100].map(p => {
    const y = (T + ch - (ch * p) / 100).toFixed(1);
    return `<line x1="${L}" y1="${y}" x2="${L + cw}" y2="${y}" stroke="rgba(148,163,184,0.22)" stroke-dasharray="3,3"/>
            <text x="${L - 6}" y="${Number(y) + 3}" text-anchor="end" font-size="9.5" fill="#64748b" font-weight="700">${p}%</text>`;
  }).join('');
  const lastSample = history[history.length - 1];
  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:145px;display:block;" role="img" aria-label="Live CPU and RAM usage chart">
      ${gridLines}
      <polygon points="${cpuArea}" fill="rgba(37,99,235,0.12)" />
      <polyline points="${cpuPts}" fill="none" stroke="#2563eb" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      <polyline points="${ramPts}" fill="none" stroke="#059669" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      <text x="${L}" y="${H - 4}" font-size="9.5" fill="#64748b" font-weight="700">${zyEsc(history[0].time || '')}</text>
      <text x="${L + cw}" y="${H - 4}" text-anchor="end" font-size="9.5" fill="#64748b" font-weight="700">${zyEsc(lastSample.time || '')}</text>
    </svg>
    <div style="display:flex;gap:16px;align-items:center;justify-content:flex-end;font-size:11.5px;font-weight:700;margin-top:4px;">
      <span style="color:#2563eb;"><i class="fas fa-circle" style="font-size:8px;margin-right:4px;"></i>CPU ${lastSample.cpu}%</span>
      <span style="color:#059669;"><i class="fas fa-circle" style="font-size:8px;margin-right:4px;"></i>RAM ${lastSample.ram}%</span>
    </div>
  `;
}

window.zyVpsRefreshNow = async function(silent = false) {
  const host = document.getElementById('vps-health-body');
  if (!host) {
    if (window._vpsHealthTimer) { clearInterval(window._vpsHealthTimer); window._vpsHealthTimer = null; }
    return;
  }
  try {
    const data = await apiFetch('/api/owner/vps-health', { silent: true });
    if (!data || !document.getElementById('vps-health-body')) return;

    const nowTime = String(data.timestamp_utc || new Date().toISOString()).slice(11, 19);
    window._vpsHealthHistory.push({
      time: nowTime,
      cpu: Number(data.cpu?.usage_pct || 0),
      ram: Number(data.memory?.used_pct || 0)
    });
    if (window._vpsHealthHistory.length > 30) window._vpsHealthHistory.shift();

    const pctTone = (p) => p >= 85 ? 'crit' : (p >= 70 ? 'warn' : 'ok');
    const st = data.status || 'healthy';
    const stLabel = st === 'critical' ? 'Critical Load' : (st === 'warning' ? 'Warning' : 'All Systems Healthy');

    const badgeEl = document.getElementById('vps-status-badge');
    if (badgeEl) {
      badgeEl.className = `zy-vps-status-pill is-${st}`;
      badgeEl.innerHTML = `<span class="zy-live-pulse-dot"></span> ${zyEsc(stLabel)}`;
    }
    const tsEl = document.getElementById('vps-last-sync');
    if (tsEl) tsEl.textContent = `Updated ${nowTime} UTC`;

    const cpuPct = Number(data.cpu?.usage_pct || 0);
    const ramPct = Number(data.memory?.used_pct || 0);
    const diskPct = Number(data.disk?.used_pct || 0);
    const lagMs = Number(data.process?.event_loop_lag_ms || 0);

    const alertsHtml = (data.alerts || []).length ? `
      <div class="zy-vps-alerts">
        ${data.alerts.map(a => `
          <div class="zy-vps-alert is-${zyEsc(a.level || 'warning')}">
            <i class="fas fa-${a.level === 'critical' ? 'circle-exclamation' : 'triangle-exclamation'}"></i>
            <span>${zyEsc(a.message)}</span>
          </div>
        `).join('')}
      </div>` : '';

    const folders = data.disk?.folders || {};
    const sess = data.runtime?.sessions || {};
    const cr = data.services?.cr_api || {};
    const web = data.services?.web_panels || {};
    const wn = data.services?.whitenoise || {};
    const db = data.database || {};

    host.innerHTML = `
      ${alertsHtml}

      <!-- Server Info Strip -->
      <div class="zy-vps-meta-strip">
        <div><span class="zy-vps-meta-k">Host</span><strong>${zyEsc(data.system?.hostname || '—')}</strong></div>
        <div><span class="zy-vps-meta-k">OS / Arch</span><strong>${zyEsc(data.system?.platform || '')} ${zyEsc(data.system?.arch || '')} (${zyEsc(data.system?.release || '')})</strong></div>
        <div><span class="zy-vps-meta-k">CPU</span><strong>${zyEsc(data.cpu?.cores || 0)} Cores · ${zyEsc(String(data.cpu?.model || '').slice(0, 38))}</strong></div>
        <div><span class="zy-vps-meta-k">Node / PID</span><strong>${zyEsc(data.system?.node_version || '')} · PID ${zyEsc(data.process?.pid || 0)}</strong></div>
        <div><span class="zy-vps-meta-k">Server Uptime</span><strong>${zyVpsFmtUptime(data.system?.os_uptime_sec)}</strong></div>
        <div><span class="zy-vps-meta-k">App Uptime</span><strong>${zyVpsFmtUptime(data.process?.uptime_sec)}</strong></div>
      </div>

      <!-- 4 Resource Cards -->
      <div class="zy-vps-kpi-grid">
        <div class="zy-vps-card">
          <div class="zy-vps-card-head">
            <span><i class="fas fa-microchip" style="color:#2563eb;"></i> CPU Usage</span>
            <span class="zy-vps-pct is-${pctTone(cpuPct)}">${cpuPct}%</span>
          </div>
          <div class="zy-vps-bar"><div class="zy-vps-bar-fill is-${pctTone(cpuPct)}" style="width:${Math.min(100, cpuPct)}%;"></div></div>
          <div class="zy-vps-sub-grid">
            <span>Cores: <b>${data.cpu?.cores || 0}</b></span>
            <span>Load 1m/5m/15m: <b>${(data.cpu?.load_avg || [0,0,0]).join(' / ')}</b></span>
          </div>
        </div>

        <div class="zy-vps-card">
          <div class="zy-vps-card-head">
            <span><i class="fas fa-memory" style="color:#059669;"></i> RAM Memory</span>
            <span class="zy-vps-pct is-${pctTone(ramPct)}">${ramPct}%</span>
          </div>
          <div class="zy-vps-bar"><div class="zy-vps-bar-fill is-${pctTone(ramPct)}" style="width:${Math.min(100, ramPct)}%;"></div></div>
          <div class="zy-vps-sub-grid">
            <span>Used: <b>${zyVpsFmtBytes(data.memory?.used_bytes)} / ${zyVpsFmtBytes(data.memory?.total_bytes)}</b></span>
            <span>Free: <b>${zyVpsFmtBytes(data.memory?.free_bytes)}</b> · Node RSS: <b>${zyVpsFmtBytes(data.process?.rss_bytes)}</b></span>
          </div>
        </div>

        <div class="zy-vps-card">
          <div class="zy-vps-card-head">
            <span><i class="fas fa-hard-drive" style="color:#0284c7;"></i> Disk Storage</span>
            <span class="zy-vps-pct is-${pctTone(diskPct)}">${diskPct}%</span>
          </div>
          <div class="zy-vps-bar"><div class="zy-vps-bar-fill is-${pctTone(diskPct)}" style="width:${Math.min(100, diskPct)}%;"></div></div>
          <div class="zy-vps-sub-grid">
            <span>Used: <b>${zyVpsFmtBytes(data.disk?.used_bytes)} / ${zyVpsFmtBytes(data.disk?.total_bytes)}</b></span>
            <span>Free: <b>${zyVpsFmtBytes(data.disk?.free_bytes)}</b></span>
          </div>
        </div>

        <div class="zy-vps-card">
          <div class="zy-vps-card-head">
            <span><i class="fas fa-bolt" style="color:#7c3aed;"></i> Live Traffic &amp; Runtime</span>
            <span class="zy-vps-pct is-${lagMs > 150 ? 'warn' : 'ok'}">${lagMs} ms lag</span>
          </div>
          <div class="zy-vps-mini-stats">
            <div><small>Sessions</small><b>${Number(sess.total || 0)}</b></div>
            <div><small>WebSockets</small><b>${Number(data.runtime?.ws_clients || 0)}</b></div>
            <div><small>Heap Used</small><b>${zyVpsFmtBytes(data.process?.heap_used_bytes)}</b></div>
          </div>
          <div class="zy-vps-sub-grid">
            <span>Owner: <b>${sess.owner || 0}</b> · Agents: <b>${sess.agent || 0}</b> · Clients: <b>${sess.client || 0}</b></span>
          </div>
        </div>
      </div>

      <!-- Row 2: Live CPU/RAM Chart + Folder Storage Breakdown -->
      <div class="zy-vps-two-col">
        <div class="zy-vps-card">
          <div class="zy-vps-card-head">
            <span><i class="fas fa-chart-line" style="color:#2563eb;"></i> Live CPU &amp; RAM Telemetry</span>
            <span style="font-size:11px;color:var(--sp-text-muted);font-weight:700;">Last ${window._vpsHealthHistory.length} samples</span>
          </div>
          ${zyVpsRenderTrendSvg(window._vpsHealthHistory)}
        </div>

        <div class="zy-vps-card">
          <div class="zy-vps-card-head">
            <span><i class="fas fa-hard-drive" style="color:#0284c7;"></i> Project Data &amp; Storage Breakdown</span>
            <span style="font-size:11px;color:var(--sp-text-muted);font-weight:700;">Safe Persistent Storage</span>
          </div>
          <table class="zy-ud-table">
            <tbody>
              <tr><td><b>DATA_DIR (Database &amp; State)</b></td><td class="r zy-ud-num"><b>${zyVpsFmtBytes(folders.data_dir_bytes)}</b></td></tr>
              <tr><td><b>SMS Archives</b></td><td class="r zy-ud-num"><b>${zyVpsFmtBytes(folders.archive_dir_bytes)}</b></td></tr>
              <tr><td><b>Chat Media Uploads</b></td><td class="r zy-ud-num"><b>${zyVpsFmtBytes(folders.chat_media_bytes)}</b></td></tr>
              <tr><td><b>Backups Folder</b></td><td class="r zy-ud-num"><b>${zyVpsFmtBytes(folders.backup_dir_bytes)}</b></td></tr>
              <tr><td><b>Last Backup</b></td><td class="r" style="font-size:11.5px;"><b>${data.disk?.last_backup ? zyEsc(data.disk.last_backup.name) + ' (' + zyVpsFmtBytes(data.disk.last_backup.size_bytes) + ')' : 'None yet'}</b></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Row 3: Pollers/Services Health + Database Inventory -->
      <div class="zy-vps-two-col">
        <div class="zy-vps-card">
          <div class="zy-vps-card-head">
            <span><i class="fas fa-plug-circle-bolt" style="color:#059669;"></i> Providers &amp; Background Services</span>
            <span style="font-size:11px;color:var(--sp-text-muted);font-weight:700;">Pollers Status</span>
          </div>
          <table class="zy-ud-table">
            <thead><tr><th>Service</th><th>Active / Total</th><th>Total Pulled</th><th class="r">Status</th></tr></thead>
            <tbody>
              <tr>
                <td><b>CR API Poller</b></td>
                <td><b>${cr.active || 0} / ${cr.total || 0}</b></td>
                <td class="zy-ud-num"><b>${Number(cr.total_pulled || 0).toLocaleString()}</b></td>
                <td class="r">${cr.errors > 0 ? `<span class="badge badge-red">${cr.errors} Error(s)</span>` : `<span class="badge badge-green">Healthy</span>`}</td>
              </tr>
              <tr>
                <td><b>Web Scraping Panels</b></td>
                <td><b>${web.active || 0} / ${web.total || 0}</b></td>
                <td class="zy-ud-num">—</td>
                <td class="r"><span class="badge badge-green">Active</span></td>
              </tr>
              <tr>
                <td><b>Whitenoise {W} Engine</b></td>
                <td><b>${wn.active || 0} / ${wn.total || 0}</b></td>
                <td class="zy-ud-num"><b>${Number(wn.ledger_rows || 0).toLocaleString()} rows</b></td>
                <td class="r"><span class="badge badge-green">Ready</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="zy-vps-card">
          <div class="zy-vps-card-head">
            <span><i class="fas fa-database" style="color:#7c3aed;"></i> Live Database Inventory</span>
            <span style="font-size:11px;color:var(--sp-text-muted);font-weight:700;">In-Memory + Disk Sync</span>
          </div>
          <div class="zy-vps-db-grid">
            <div><small>Hot SMS Logs</small><b>${Number(db.hot_sms_logs || 0).toLocaleString()}</b></div>
            <div><small>Total Numbers</small><b>${Number(db.total_numbers || 0).toLocaleString()}</b></div>
            <div><small>Blocked Numbers</small><b style="color:#dc2626;">${Number(db.blocked_numbers || 0).toLocaleString()}</b></div>
            <div><small>SMS Ranges</small><b>${Number(db.total_ranges || 0).toLocaleString()}</b></div>
            <div><small>Agents</small><b>${Number(db.total_agents || 0).toLocaleString()}</b></div>
            <div><small>Clients</small><b>${Number(db.total_clients || 0).toLocaleString()}</b></div>
            <div><small>Chat Messages</small><b>${Number(db.chat_messages || 0).toLocaleString()}</b></div>
            <div><small>Pending Requests</small><b>${Number(db.pending_number_requests || 0).toLocaleString()}</b></div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    if (!silent) {
      host.innerHTML = `<div class="zy-empty" style="padding:32px;color:#dc2626;">Failed to load VPS health telemetry: ${zyEsc(err.message || 'error')}</div>`;
    }
  }
};

window.renderVpsHealth = async function() {
  const c = document.getElementById('page-content');
  if (!c) return;
  if (window._vpsHealthTimer) { clearInterval(window._vpsHealthTimer); window._vpsHealthTimer = null; }
  if (typeof zyCrumb === 'function') zyCrumb(['System', 'VPS & Server Health']);
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = 'VPS & Server Health';

  c.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <div>
        <div class="page-title" style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-server" style="color:#0f766e;"></i>
          <span>VPS &amp; Server Health Monitor</span>
          <span id="vps-status-badge" class="zy-vps-status-pill is-healthy"><span class="zy-live-pulse-dot"></span> Checking…</span>
        </div>
        <div class="page-subtitle" style="margin-top:3px;">
          Real-time server CPU, RAM, Disk, Folder Storage, Active Sessions, WebSockets &amp; Pollers telemetry · <span id="vps-last-sync">Syncing…</span>
        </div>
      </div>
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button type="button" class="btn btn-outline btn-sm zy-vps-auto-btn ${window._vpsHealthAuto ? 'is-active' : ''}" onclick="zyVpsToggleAuto(this)">
          <i class="fas fa-${window._vpsHealthAuto ? 'pause' : 'play'}"></i> Auto 5s: ${window._vpsHealthAuto ? 'ON' : 'OFF'}
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="zyVpsRefreshNow(false)">
          <i class="fas fa-rotate"></i> Refresh Now
        </button>
        <button type="button" class="btn btn-outline btn-sm" onclick="zyVpsClearCache(this)">
          <i class="fas fa-broom"></i> Clear Cache
        </button>
        <button type="button" class="btn btn-outline btn-sm" onclick="zyVpsTriggerBackup(this)">
          <i class="fas fa-cloud-arrow-up"></i> Backup Now
        </button>
      </div>
    </div>
    <div id="vps-health-body">
      <div class="zy-loading" style="padding:40px;text-align:center;">Loading live VPS telemetry…</div>
    </div>
  `;

  await window.zyVpsRefreshNow(false);
  window._vpsHealthTimer = setInterval(() => {
    if (!document.getElementById('vps-health-body')) {
      clearInterval(window._vpsHealthTimer);
      window._vpsHealthTimer = null;
      return;
    }
    if (window._vpsHealthAuto) window.zyVpsRefreshNow(true);
  }, 5000);
};

/* ═══ SMS CDR STATS (My SMS) — HUMEX SMS layout ═════════════════ */
renderMySms = async function (summary = false) {
  const c = document.getElementById('page-content');
  if (typeof zyCrumb === 'function') {
    zyCrumb(['Show Report']);
  }
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = 'Show Report';

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
        <div class="page-title"><i class="fas fa-file-invoice" style="color:#2563eb;"></i> Show Report</div>
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

    const ranges = ((Array.isArray(rangesRes) ? rangesRes : (rangesRes && rangesRes.data)) || [])
      .slice().sort((a, b) => String(a.range_name || a.name || a.country || '').localeCompare(String(b.range_name || b.name || b.country || ''), undefined, { sensitivity: 'base' }));
    const agents = ((agentsRes && agentsRes.data) || [])
      .slice().sort((a, b) => String(a.username || a.name || '').localeCompare(String(b.username || b.name || ''), undefined, { sensitivity: 'base' }));
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
    zyCrumb(['Show Report', 'Whitenoise Reports']);
  }
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = 'Whitenoise Reports';

  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const defaultFrom = `${zyMonthStartYmd()} 00:00:00`;
  const defaultTo = `${today} 23:59:59`;
  window._wnCdr2Tab = 'stats';

  const groupChips = [
    { id: 'date', label: 'Date', val: 'date' },
    { id: 'month', label: 'Month', val: 'month' },
    { id: 'range', label: 'Range', val: 'range' },
    { id: 'agent', label: 'Agent', val: 'agent' },
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
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
      <div>
        <div class="page-title" style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-file-excel" style="color:#2563eb;"></i>
          <span>Whitenoise Reports</span>
        </div>
        <div class="page-subtitle" style="margin-top:3px;">
          Excel-Only Daily Stats · Monthly (30/5) {W} · 5-day hold · Cumulative 1–15 &amp; 16–End reconciliation
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

    <div id="cdr2-owner-portal-bar" style="margin-bottom:10px;"></div>

    <div style="display:flex;gap:0;border-bottom:1px solid var(--border,#e2e8f0);margin-bottom:10px;">
      <button type="button" id="cdr2-tab-stats" onclick="zyOwnerCdr2SwitchTab('stats')"
        style="padding:7px 14px;font-size:12.5px;font-weight:600;border:none;background:transparent;cursor:pointer;border-bottom:2px solid #2563eb;color:#2563eb;">
        Daily Stats Ledger
      </button>
      <button type="button" id="cdr2-tab-history" onclick="zyOwnerCdr2SwitchTab('history')"
        style="padding:7px 14px;font-size:12.5px;font-weight:600;border:none;background:transparent;cursor:pointer;border-bottom:2px solid transparent;color:#64748b;">
        Upload History &amp; Rollback
      </button>
    </div>

    <div id="cdr2-panel-stats">
      <div id="cdr2-coverage-strip" class="zy-wn-cov-strip" style="margin-bottom:10px;"></div>

      <div class="zy-filter-grid zy-owner-cdr2-compact" data-apx="filter-bar" data-cdr-compact="1" style="margin-bottom:12px;">
        <div class="zy-cdr-head-row">
          <div style="display:flex;align-items:center;gap:6px;">
            <i class="fas fa-sliders" style="color:#2563eb;"></i>
            <span>Whitenoise Excel Stats Filters</span>
          </div>
          <div id="cdr2-sync-status" style="font-size:11px;color:#64748b;font-variant-numeric:tabular-nums;">
            Daily Excel Reconciliation · 0 Duplicates
          </div>
        </div>
        <div class="zy-filter-grid-fields zy-cdr2-fields-compact">
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

        <div class="zy-groupby-card zy-cdr2-groupby-compact">
          <div class="zy-groupby-title">
            <i class="fas fa-layer-group" style="font-size:10px;color:var(--sp-text-muted,#64748b);"></i>
            Group By :
          </div>
          <div class="zy-groupby-chips">
            ${chipsHtml}
          </div>
          <div class="zy-groupby-search-wrap">
            <input type="text" id="cdr2-search" class="zy-groupby-search-input"
              placeholder="Search Date, Range, Number, Service, Agent..."
              autocomplete="off"
              oninput="zyHandleCdrSearchInput(this, 'cdr2-search-clear', () => renderOwnerCdr2Load(1))"
              onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._zyCdrSearchTimer){clearTimeout(window._zyCdrSearchTimer);}renderOwnerCdr2Load(1);}">
            <button type="button" id="cdr2-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearCdrSearch('cdr2-search', 'cdr2-search-clear', () => renderOwnerCdr2Load(1))">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>

        <div class="zy-table-toolbar zy-cdr-control-bar">
          <div class="zy-cdr-actions-left" style="display:flex;gap:6px;flex-wrap:wrap;">
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
              <label class="zy-toolbar-label" for="cdr2-limit">Show</label>
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

        <div class="zy-panel-body" id="cdr2-body" style="padding:0;margin-top:10px;">
          <div class="zy-loading" style="padding:32px;text-align:center;color:var(--sp-text-muted,#64748b);">Loading CDR 2 daily stats…</div>
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

  zyLoadOwnerWhitenoisePortalBar();
  zyLoadWhitenoiseCoverageStrip(today.slice(0, 7));
  renderOwnerCdr2Load(1);
}
window.renderOwnerCdr2 = renderOwnerCdr2;

window._zyOwnerWnPortalCache = window._zyOwnerWnPortalCache || null;
window._zyOwnerWnPwdVisible = false;

window.zyLoadOwnerWhitenoisePortalBar = async function () {
  const host = document.getElementById('cdr2-owner-portal-bar');
  if (!host) return;
  try {
    const res = await apiFetch('/api/owner/whitenoise-portal', { silent: true });
    const portal = (res && res.portal) || { url: '', username: '', password: '', notes: '' };
    window._zyOwnerWnPortalCache = portal;
    window.zyRenderOwnerWhitenoisePortalBar(portal);
  } catch (_) {
    host.innerHTML = '';
  }
};

window.zyRenderOwnerWhitenoisePortalBar = function (portal) {
  const host = document.getElementById('cdr2-owner-portal-bar');
  if (!host) return;
  const p = portal || window._zyOwnerWnPortalCache || {};
  const hasUrl = Boolean(p.url && /^https?:\/\//i.test(p.url));
  const hasUser = Boolean(p.username);
  const hasPwd = Boolean(p.password);
  const configured = hasUrl || hasUser || hasPwd;
  const pwdDisplay = hasPwd ? (window._zyOwnerWnPwdVisible ? zyEsc(p.password) : '••••••••••') : '<span style="opacity:.6;">Not set</span>';

  host.innerHTML = `
    <div class="zy-wn-portal-bar">
      <div class="zy-wn-portal-head">
        <div class="zy-wn-portal-title">
          <i class="fas fa-key" style="color:#2563eb;"></i>
          <span>Original Whitenoise Portal Access</span>
          <span class="zy-wn-portal-badge">Owner Only</span>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="window.zyOpenOwnerWnPortalModal()">
          <i class="fas fa-pen-to-square"></i> ${configured ? 'Edit Credentials' : 'Add Portal Credentials'}
        </button>
      </div>
      ${configured ? `
        <div class="zy-wn-portal-grid">
          <div class="zy-wn-portal-field">
            <span class="zy-wn-portal-lbl">Portal Link</span>
            <div class="zy-wn-portal-val-row">
              ${hasUrl
                ? `<a href="${zyEsc(p.url)}" target="_blank" rel="noopener noreferrer" class="zy-wn-portal-link" title="${zyEsc(p.url)}"><i class="fas fa-arrow-up-right-from-square"></i> ${zyEsc(p.url)}</a>`
                : `<span class="zy-wn-portal-empty">Not set</span>`}
              ${hasUrl ? `<button type="button" class="zy-wn-copy-btn" onclick="window.zyCopyTextSafe((window._zyOwnerWnPortalCache||{}).url, 'Portal link')" title="Copy Portal Link"><i class="far fa-copy"></i> Copy</button>` : ''}
            </div>
          </div>

          <div class="zy-wn-portal-field">
            <span class="zy-wn-portal-lbl">Username</span>
            <div class="zy-wn-portal-val-row">
              <span class="zy-wn-portal-mono">${hasUser ? zyEsc(p.username) : '<span style="opacity:.6;">Not set</span>'}</span>
              ${hasUser ? `<button type="button" class="zy-wn-copy-btn" onclick="window.zyCopyTextSafe((window._zyOwnerWnPortalCache||{}).username, 'Username')" title="Copy Username"><i class="far fa-copy"></i> Copy</button>` : ''}
            </div>
          </div>

          <div class="zy-wn-portal-field">
            <span class="zy-wn-portal-lbl">Password</span>
            <div class="zy-wn-portal-val-row">
              <span class="zy-wn-portal-mono" id="zy-wn-portal-pwd-val">${pwdDisplay}</span>
              ${hasPwd ? `
                <button type="button" class="zy-wn-copy-btn" onclick="window._zyOwnerWnPwdVisible=!window._zyOwnerWnPwdVisible;window.zyRenderOwnerWhitenoisePortalBar();" title="${window._zyOwnerWnPwdVisible ? 'Hide password' : 'Show password'}">
                  <i class="far ${window._zyOwnerWnPwdVisible ? 'fa-eye-slash' : 'fa-eye'}"></i>
                </button>
                <button type="button" class="zy-wn-copy-btn is-accent" onclick="window.zyCopyTextSafe((window._zyOwnerWnPortalCache||{}).password, 'Password')" title="1-Click Copy Password">
                  <i class="far fa-copy"></i> Copy
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      ` : `
        <div class="zy-wn-portal-empty-hint">
          Save your original Whitenoise portal link, username, and password here for instant 1-click copy &amp; quick login.
        </div>
      `}
    </div>
  `;
};

window.zyOpenOwnerWnPortalModal = function () {
  const p = window._zyOwnerWnPortalCache || { url: '', username: '', password: '', notes: '' };
  const bodyHtml = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="font-size:12.5px;color:var(--text-muted,#64748b);line-height:1.5;">
        Store your original Whitenoise portal URL and login details for quick 1-click copy from CDR 2. This is strictly visible only to Owner.
      </div>
      <div>
        <label class="form-label" for="wn-portal-url">Original Portal Link (URL)</label>
        <input type="url" id="wn-portal-url" class="form-input" placeholder="https://portal.example.com/login" value="${zyEsc(p.url || '')}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label class="form-label" for="wn-portal-user">Username / Email</label>
          <input type="text" id="wn-portal-user" class="form-input" autocomplete="off" placeholder="Enter username" value="${zyEsc(p.username || '')}">
        </div>
        <div>
          <label class="form-label" for="wn-portal-pass">Password</label>
          <input type="text" id="wn-portal-pass" class="form-input" autocomplete="off" placeholder="Enter password" value="${zyEsc(p.password || '')}">
        </div>
      </div>
      <div id="wn-portal-modal-alert" class="zy-modal-alert" style="display:none;"></div>
    </div>
  `;
  const footHtml = `
    <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button type="button" class="btn btn-primary" id="btn-save-wn-portal" onclick="window.zySaveOwnerWnPortal()">
      <i class="fas fa-save"></i> Save Credentials
    </button>
  `;
  if (typeof zyModal === 'function') {
    zyModal('Original Whitenoise Portal Credentials', bodyHtml, footHtml);
  }
};

window.zySaveOwnerWnPortal = async function () {
  const btn = document.getElementById('btn-save-wn-portal');
  const url = (document.getElementById('wn-portal-url')?.value || '').trim();
  const username = (document.getElementById('wn-portal-user')?.value || '').trim();
  const password = (document.getElementById('wn-portal-pass')?.value || '');
  if (url && !/^https?:\/\//i.test(url)) {
    if (typeof window.zySetModalAlert === 'function') {
      window.zySetModalAlert('wn-portal-modal-alert', 'Portal link must start with https:// or http://', 'error');
    }
    return;
  }
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
  try {
    const res = await apiFetch('/api/owner/whitenoise-portal', {
      method: 'PUT',
      body: JSON.stringify({ url, username, password })
    });
    window._zyOwnerWnPortalCache = (res && res.portal) || { url, username, password };
    window.zyRenderOwnerWhitenoisePortalBar(window._zyOwnerWnPortalCache);
    if (typeof closeModal === 'function') closeModal();
    if (typeof toast === 'function') toast('Portal credentials saved', 'success');
  } catch (err) {
    const msg = typeof window.zyHumanizeError === 'function' ? window.zyHumanizeError(err) : (err.message || 'Failed to save credentials');
    if (typeof window.zySetModalAlert === 'function') {
      window.zySetModalAlert('wn-portal-modal-alert', msg, 'error');
    } else if (typeof toast === 'function') {
      toast(msg, 'error');
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Credentials'; }
  }
};

window.zyLoadWhitenoiseCoverageStrip = async function (monthYm) {
  const host = document.getElementById('cdr2-coverage-strip');
  if (!host) return;
  const ym = (monthYm && /^\d{4}-\d{2}$/.test(monthYm))
    ? monthYm
    : (new Date().toISOString().slice(0, 7));
  try {
    const cov = await apiFetch(`/api/whitenoise-excel/coverage?month=${encodeURIComponent(ym)}`, { silent: true });
    if (!cov || !cov.success) return;
    const p1 = cov.period_1_15 || { label: '1–15', covered_days: 0, total_days: 15, missing_dates: [], sms_total: 0, day_list: [] };
    const p2 = cov.period_16_end || { label: '16–End', covered_days: 0, total_days: 15, missing_dates: [], sms_total: 0, day_list: [] };

    const renderHalfCard = (title, p) => {
      const days = p.day_list || [];
      const pills = days.map(d => {
        const cls = d.uploaded ? 'is-ok' : 'is-miss';
        const tip = `${d.date}: ${d.uploaded ? (Number(d.sms_total || 0).toLocaleString() + ' SMS') : 'Missing — upload cumulative sheet to fill'}`;
        return `<button type="button" class="zy-wn-day-pill ${cls}" title="${zyEsc(tip)}" onclick="zyFilterCdr2ByDate('${zyEsc(d.date)}')">${d.day}</button>`;
      }).join('');
      const missCount = (p.missing_dates || []).length;
      return `
        <div class="zy-wn-half-card">
          <div class="zy-wn-half-head">
            <span class="zy-wn-half-title"><i class="fas fa-calendar-days"></i> ${zyEsc(title)}</span>
            <span class="zy-wn-half-meta">
              <b>${p.covered_days}/${p.total_days}d</b> ·
              <span class="monospace">${Number(p.sms_total || 0).toLocaleString()} SMS</span>
              ${missCount > 0 ? `<span class="zy-wn-miss-badge">${missCount} missing</span>` : `<span class="zy-wn-ok-badge">Complete</span>`}
            </span>
          </div>
          <div class="zy-wn-day-grid">${pills}</div>
        </div>
      `;
    };

    host.innerHTML = `
      <div class="zy-wn-cov-bar">
        <div class="zy-wn-cov-top">
          <div class="zy-wn-cov-heading">
            <i class="fas fa-calendar-check" style="color:#4f46e5;"></i>
            <span>Monthly Reconciliation Coverage</span>
            <span class="zy-wn-cov-sub">Click any day to filter · Upload 1–15 or 16–End sheet to auto-fill missing dates without duplicates</span>
          </div>
          <div class="zy-wn-cov-controls">
            <input type="month" id="cdr2-cov-month" class="zy-wn-month-input" value="${zyEsc(cov.month || ym)}" onchange="zyLoadWhitenoiseCoverageStrip(this.value)">
          </div>
        </div>
        <div class="zy-wn-half-wrap">
          ${renderHalfCard('Cycle 1–15', p1)}
          ${renderHalfCard(`Cycle ${p2.label || '16–End'}`, p2)}
        </div>
      </div>
    `;
  } catch (e) {
    host.innerHTML = '';
  }
};

window.zyFilterCdr2ByDate = function (ymd) {
  if (!ymd) return;
  const f = document.getElementById('cdr2-from');
  const t = document.getElementById('cdr2-to');
  if (f) f.value = `${ymd} 00:00:00`;
  if (t) t.value = `${ymd} 23:59:59`;
  renderOwnerCdr2Load(1);
};

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
        ...checkedBoxes.map(k => {
          if (k === 'range') return { v: g[k] || '—', h: `<span class="zy-wn-range-name">${zyEsc(g[k] || '—')}</span>` };
          if (k === 'number') return { v: g[k] || '—', h: g[k] ? `<span class="monospace zy-wn-number">${zyEsc(g[k])}</span>` : '—' };
          return g[k] || '—';
        }),
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
      const cols = ['Date', 'Range', 'Number', 'Service / CLI', 'Agent', 'SMS Count', 'Unit Rate', 'Owner Rev', 'Agent Pay', 'Owner Profit', 'Cycle'];
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
        const clearLabel = s.clears_at ? `Clears ${String(s.clears_at).slice(0, 10)}` : 'Monthly (30/5) {W}';

        const rngLbl = s.range_name || s.range_label || s.range || s.country || '—';
        return [
          { v: dStr, h: `<span class="monospace" style="font-weight:600;">${zyEsc(dStr)}</span>` },
          { v: rngLbl, h: `<span class="zy-wn-range-name">${zyEsc(rngLbl)}</span>` },
          { v: numStr, h: numStr ? `<span class="monospace zy-wn-number">${zyEsc(numStr)}</span>` : '—' },
          { v: cliStr, h: `<span class="monospace">${zyEsc(cliStr)}</span>` },
          agentVal ? zyEsc(agentVal) : '<span style="color:#94a3b8;">Unassigned</span>',
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
        '<td></td>'.repeat(4) +
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
    if (r.agent_name) {
      const sub = r.client_name ? 'Allocated' : 'Agent Pool';
      return `<span style="color:#2563eb;font-weight:600;">${zyEsc(r.agent_name)}</span> <span style="color:#64748b;font-size:11px;">(${sub})</span>`;
    }
    return `<span style="color:#dc2626;font-weight:600;">${r.match_status === 'unknown_number' ? 'Unknown #' : 'Unassigned'}</span>`;
  };

  const distinctDates = Array.isArray(st.distinct_dates) ? st.distinct_dates : [];
  const perDate = Array.isArray(st.per_date_summary) ? st.per_date_summary : [];
  const missingFilled = Array.isArray(st.missing_days_filled) ? st.missing_days_filled : [];
  const missingRemaining = Array.isArray(st.missing_dates_remaining) ? st.missing_dates_remaining : [];

  const gapBannerHtml = (missingFilled.length || missingRemaining.length || st.date_range_collapsed_warning)
    ? `<div class="zy-wn-gap-banner">
        ${st.date_range_collapsed_warning ? `<div class="zy-wn-gap-warn"><i class="fas fa-triangle-exclamation"></i> ${zyEsc(st.date_range_collapsed_warning)}</div>` : ''}
        ${missingFilled.length ? `<div class="zy-wn-gap-filled"><i class="fas fa-circle-check"></i> <b>Missing Day(s) Auto-Filled (${missingFilled.length}):</b> <span class="monospace">${zyEsc(missingFilled.join(', '))}</span> — only missing/changed days are credited (0 duplicates on already-uploaded dates).</div>` : ''}
        ${missingRemaining.length ? `<div class="zy-wn-gap-miss"><i class="fas fa-calendar-xmark"></i> <b>Still Missing in Span (${missingRemaining.length}):</b> <span class="monospace">${zyEsc(missingRemaining.slice(0, 12).join(', '))}${missingRemaining.length > 12 ? '…' : ''}</span></div>` : ''}
      </div>`
    : '';

  const perDateMatrixHtml = perDate.length
    ? `<div class="zy-wn-day-matrix-wrap">
        <div class="zy-wn-day-matrix-head">
          <span><i class="fas fa-table"></i> Day-by-Day Verification Matrix (${perDate.length} day${perDate.length === 1 ? '' : 's'} detected)</span>
          <span style="font-size:11px;color:#64748b;">Cumulative reconciliation across 1–15 &amp; 16–End cycles</span>
        </div>
        <div style="max-height:155px;overflow:auto;">
          <table class="zy-wn-day-matrix-tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Cycle</th>
                <th style="text-align:right;">DB SMS</th>
                <th style="text-align:right;">Sheet SMS</th>
                <th style="text-align:right;">Delta</th>
                <th>Reconciliation Status</th>
              </tr>
            </thead>
            <tbody>
              ${perDate.map(d => {
                let stBadge = '<span class="zy-wn-st-match">Verified Match</span>';
                if (d.status === 'missing_day_filled') stBadge = '<span class="zy-wn-st-filled">Missing Day Filled</span>';
                else if (d.status === 'new_day') stBadge = '<span class="zy-wn-st-new">New Day</span>';
                else if (d.status === 'updated') stBadge = '<span class="zy-wn-st-upd">Updated Delta</span>';
                const deltaStr = `${d.delta_sms >= 0 ? '+' : ''}${Number(d.delta_sms || 0).toLocaleString()}`;
                return `<tr>
                  <td class="monospace" style="font-weight:700;">${zyEsc(d.date_ymd)}</td>
                  <td><span class="zy-wn-cycle-tag">${zyEsc(d.half_period || '—')}</span></td>
                  <td class="monospace" style="text-align:right;">${Number(d.existing_sms || 0).toLocaleString()}</td>
                  <td class="monospace" style="text-align:right;font-weight:700;">${Number(d.file_sms || 0).toLocaleString()}</td>
                  <td class="monospace" style="text-align:right;font-weight:700;color:${d.delta_sms > 0 ? '#059669' : (d.delta_sms < 0 ? '#dc2626' : '#64748b')};">${deltaStr}</td>
                  <td>${stBadge}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`
    : '';

  const warningsHtml = (st.warnings || []).length
    ? `<div style="margin-bottom:10px;padding:8px 10px;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;font-size:12px;color:#92400e;">
        ${(st.warnings || []).map(w => `<div><i class="fas fa-circle-info"></i> ${zyEsc(w)}</div>`).join('')}
      </div>`
    : '';

  const canCommit = Number(s.new_rows || 0) + Number(s.updated_rows || 0) > 0;
  const layoutLabel = st.layout === 'date_pivot' ? 'Date Matrix' : (st.layout === 'multi_sheet_dates' ? 'Multi-Sheet Daily' : 'Tabular');

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;font-size:12.5px;color:#334155;">
      <div>
        <b>${zyEsc(st.filename)}</b> · Dates: <span class="monospace">${zyEsc(st.date_min || '—')} → ${zyEsc(st.date_max || '—')}</span>
        <span class="zy-wn-cycle-tag" style="margin-left:4px;">${distinctDates.length || perDate.length} day(s)</span>
        · Layout: <b>${layoutLabel}</b>
      </div>
      <div style="color:#64748b;">Parsed ${Number(s.total_rows || 0).toLocaleString()} row(s) · ${Number(s.total_sms_in_file || 0).toLocaleString()} total SMS</div>
    </div>

    ${gapBannerHtml}
    ${warningsHtml}
    ${perDateMatrixHtml}

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
        <div style="font-size:11px;color:#64748b;">Allocated / Pool</div>
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
        <div style="font-size:11px;color:#64748b;">Agent Payout Delta</div>
        <div class="monospace" style="font-size:14px;font-weight:700;margin-top:2px;color:#2563eb;">$${zyFmtMoney(Number(s.net_agent_payout_delta_usd || 0), 4)}</div>
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

    <div style="max-height:240px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
            <th style="padding:6px 8px;">Sync</th>
            <th style="padding:6px 8px;">Date</th>
            <th style="padding:6px 8px;">Number</th>
            <th style="padding:6px 8px;">Service</th>
            <th style="padding:6px 8px;">Date-Locked Agent</th>
            <th style="padding:6px 8px;text-align:right;">SMS</th>
            <th style="padding:6px 8px;text-align:right;">Owner Rev</th>
            <th style="padding:6px 8px;text-align:right;">Agent Pay</th>
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
              <td class="monospace" style="padding:5px 8px;text-align:right;">$${zyFmtMoney(Number(r.agent_payout_usd || 0), 4)}</td>
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
    if (document.getElementById('cdr2-coverage-strip')) {
      const m = document.getElementById('cdr2-cov-month')?.value || (b.date_max ? String(b.date_max).slice(0, 7) : undefined);
      zyLoadWhitenoiseCoverageStrip(m);
    }
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
    : await zyConfirm(`Rollback batch ${batchCode}? This will revert its changes cleanly.`, { title: 'Rollback Batch' });
  if (!ok) return;
  try {
    const res = await apiFetch(`/api/whitenoise-excel/batches/${id}/rollback`, { method: 'POST', body: JSON.stringify({}) });
    if (typeof toast === 'function') {
      toast(`Rolled back ${batchCode}: removed ${res.removed_rows || 0}, restored ${res.restored_rows || 0} row(s).`, 'success');
    }
    if (containerId) zyLoadWhitenoiseBatches(containerId);
    if (document.getElementById('cdr2-body')) renderOwnerCdr2Load(1);
    if (document.getElementById('cdr2-coverage-strip')) {
      const m = document.getElementById('cdr2-cov-month')?.value;
      zyLoadWhitenoiseCoverageStrip(m);
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Rollback failed', 'error');
  }
};




