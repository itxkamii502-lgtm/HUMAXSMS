/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Agent panel shell + dashboard
   Identical sidebar & frame structure to the Owner panel with Agent-scoped folders.
   Loads AFTER agent-engine.js / agent-pages.js.
   ═══════════════════════════════════════════════════════════════ */

/* Theme engine & sidebar toggle are provided by shared-brand-theme.js & shared-ui-kit.js */
const ZY_LOGO_SRC = window.ZY_LOGO_SRC || '/static/img/humex-sms-logo.png';

/* ── Agent menu model (exact Owner folder structure) ───────── */
const ZY_AGENT_MENU = [
  { t: null, c: '#1d4ed8', items: [
      ['Dashboard', 'dashboard', 'fa-gauge-high'],
  ] },
  { t: null, c: '#059669', items: [
      ['Live Chat', 'live-chat', 'fa-comments'],
  ] },
  { t: null, c: '#0284c7', items: [
      ['Apps Links', 'app-links', 'fa-link'],
  ] },
  { t: null, c: '#10b981', items: [
      ['Live Access', 'live-access', 'fa-tower-broadcast'],
  ] },
  { t: "NUMBERS & INVENTORY", i: 'fa-sim-card', c: '#1d4ed8', items: [
      ['My Numbers', 'my-sms-numbers', 'fa-mobile-screen'],
      ['Ranges & Rate Card', 'sms-ranges', 'fa-table-list'],
      ['Client Rate Set', 'client-rate-set', 'fa-tags'],
      ['Bulk Allocation', 'bulk-add', 'fa-cloud-arrow-up'],
      ['Blocked Numbers', 'blocked-numbers', 'fa-ban'],
  ] },
  { t: "SMS & ANALYTICS", i: 'fa-chart-line', c: '#059669', items: [
      ['CDR & Statistics', 'detailed-sms', 'fa-comment-sms'],
      ['CDR 2 (Monthly)', 'cdr2', 'fa-tower-cell'],
  ] },
  { t: "USERS & NOTIFICATIONS", i: 'fa-users', c: '#0284c7', items: [
      ['Clients', 'my-clients', 'fa-users'],
      ['Notifications', 'notifications', 'fa-bell'],
  ] },
  { t: "PAYMENTS", i: 'fa-wallet', c: '#059669', items: [
      ['My Payment Requests', 'payment-requests', 'fa-hand-holding-dollar'],
      ['Client Payment Requests', 'client-payment-requests', 'fa-money-bill-transfer'],
      ['Credit Notes', 'credit-notes', 'fa-receipt'],
      ['Statements', 'usd-statements', 'fa-file-invoice-dollar'],
  ] },
  { t: "CLIENT REQUESTS", i: 'fa-inbox', c: '#0d9488', items: [
      ['Client Number Requests', 'client-requests', 'fa-sim-card'],
  ] },
  { t: null, c: '#1d4ed8', items: [
      ['My Profile', 'my-profile', 'fa-user'],
  ] }
];

const ZY_LABELS = {
  'dashboard': 'Dashboard',
  'live-chat': 'Live Chat',
  'app-links': 'Apps Links',
  'live-access': 'Live Access',
  'sms-ranges': 'Ranges & Rate Card',
  'sms-overview': 'Ranges & Rate Card',
  'sms-ratecard': 'Ranges & Rate Card',
  'client-rate-set': 'Client Rate Set',
  'my-sms-numbers': 'My Numbers',
  'bulk-add': 'Bulk Allocation',
  'blocked-numbers': 'Blocked Numbers',
  'client-requests': 'Client Number Requests',
  'client-payment-requests': 'Client Payment Requests',
  'my-clients': 'Clients',
  'notifications': 'Notifications',
  'news-clients': 'Notifications',
  'detailed-sms': 'CDR & Statistics',
  'cdr2': 'CDR 2 (Monthly)',
  'transfer-history': 'Transfer History',
  'credit-notes': 'Credit Notes',
  'payment-requests': 'My Payment Requests',
  'bank-accounts': 'Bank Accounts',
  'usd-statements': 'USD Statements',
  'eur-statements': 'EUR Statements',
  'gbp-statements': 'GBP Statements',
  'profile': 'My Profile',
  'my-profile': 'My Profile',
  'profile-security': 'My Profile',
  '2fa': 'My Profile',
  'audit-logs': 'My Profile'
};
window.ZY_LABELS = ZY_LABELS;

const AGENT_ROUTE_PARENT = {
  'sms-overview': 'sms-ranges',
  'sms-ratecard': 'sms-ranges',
  'assign-to-client': 'my-sms-numbers',
  'transfer-history': 'my-sms-numbers',
  'cdr2': 'detailed-sms',
  'news-clients': 'notifications',
  'bank-accounts': 'payment-requests',
  'eur-statements': 'usd-statements',
  'gbp-statements': 'usd-statements',
  'my-earnings': 'payment-requests',
  'profile': 'my-profile',
  'profile-security': 'my-profile',
  '2fa': 'my-profile',
  'audit-logs': 'my-profile'
};
window.AGENT_ROUTE_PARENT = AGENT_ROUTE_PARENT;

/* ── build the shell ───────────────────────────────────────── */
(function zyBuildShell() {
  const logo = document.getElementById('zy-logo');
  if (logo) {
    const siteName = (window.__BRAND_SETTINGS__ && window.__BRAND_SETTINGS__.site_name) || 'HUMAX SMS';
    const logoUrl = (window.__BRAND_SETTINGS__ && window.__BRAND_SETTINGS__.logo_url) || '/static/img/humex-sms-logo.png';
    logo.innerHTML = `<span class="zy-panel-badge"><img class="zy-badge-logo" src="${logoUrl}" alt="${siteName}" onerror="this.style.display='none';"> <span class="zy-badge-name">${siteName}</span></span>`;
    logo.onclick = null;
    logo.style.cursor = 'default';
  }

  const side = document.getElementById('zy-sidenav');
  if (side) {
    side.innerHTML = ZY_AGENT_MENU.map((g, gi) => {
      if (!g.t) {
        return g.items.map(([label, page, icon]) =>
          `<div class="zy-snav nav-item" id="nav-${page}" data-page="${page}" role="link" tabindex="0"
                ${(page === 'app-links' || page === 'live-access') ? 'style="display:none;"' : ''}
                onclick="loadPage('${page}')"
                onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();loadPage('${page}');}">
             <span class="zy-ic" style="--ic-accent:${g.c};"><i class="fas ${icon}" style="color:${g.c}"></i></span><span class="zy-snav-txt">${label}</span>
             <i class="fas fa-chevron-right zy-caret zy-caret-sm"></i>
           </div>`
        ).join('');
      }
      const subItems = g.items.map(([label, page, icon]) =>
        `<div class="zy-ssub-item" id="nav-${page}" data-page="${page}" role="link" tabindex="0"
              ${page === 'cdr2' ? 'style="display:none;"' : ''}
              onclick="loadPage('${page}')"
              onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();loadPage('${page}');}">
           <i class="fas ${icon || 'fa-circle-dot'} zy-sub-ic" aria-hidden="true"></i><span class="zy-sub-txt">${label}</span>
         </div>`
      ).join('');
      return `<div class="zy-snav" id="grp-agt-${gi}" role="button" tabindex="0" aria-expanded="false" aria-controls="sb-${gi}"
                   onclick="zyToggleGroup('sb-${gi}', this)"
                   onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();zyToggleGroup('sb-${gi}', this);}">
                <span class="zy-ic" style="--ic-accent:${g.c};"><i class="fas ${g.i || 'fa-layer-group'}" style="color:${g.c}"></i></span><span class="zy-snav-txt">${g.t}</span>
                <i class="fas fa-chevron-down zy-caret"></i>
              </div>
              <div class="zy-ssub" id="sb-${gi}" role="region">${subItems}</div>`;
    }).join('');
  }

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
  if (window._zyAgentClockTimer) clearInterval(window._zyAgentClockTimer);
  window._zyAgentClockTimer = setInterval(tick, 1000);

  let sess = {};
  try { sess = JSON.parse(sessionStorage.getItem('admin_user') || '{}'); } catch (e) {}
  const u = (window.AGENT_USER && AGENT_USER.username) || sess.username || 'Agent';
  ['panel-username-side', 'agent-username'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = u;
  });
  const sub = document.getElementById('agent-name-sub');
  if (sub) sub.textContent = 'Agent Panel';

  // Sync active accordion group on initial load
  setTimeout(() => {
    const initPage = sessionStorage.getItem('agent_current_page') || 'dashboard';
    if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(initPage);
  }, 100);
})();

window.ZY_WHITENOISE_ACCESS = false;
window.ZY_APP_LINKS_ACCESS = false;
window.ZY_LIVE_ACCESS_ENABLED = false;
window.zySyncLiveAccessNav = function(enabled) {
  window.ZY_LIVE_ACCESS_ENABLED = Boolean(enabled);
  const laEl = document.getElementById('nav-live-access');
  if (laEl) laEl.style.display = window.ZY_LIVE_ACCESS_ENABLED ? '' : 'none';
};
window.zyRefreshWhitenoiseNav = function(me) {
  const allowed = Boolean(me && me.whitenoise_access);
  window.ZY_WHITENOISE_ACCESS = allowed;
  const el = document.getElementById('nav-cdr2');
  if (el) el.style.display = allowed ? '' : 'none';
  const appAllowed = Boolean(me && me.app_links_access);
  window.ZY_APP_LINKS_ACCESS = appAllowed;
  const appEl = document.getElementById('nav-app-links');
  if (appEl) appEl.style.display = appAllowed ? '' : 'none';
  if (me && typeof me.live_access_enabled === 'boolean') {
    window.zySyncLiveAccessNav(me.live_access_enabled);
  }
};
if (typeof apiFetch === 'function') {
  apiFetch('/api/auth/me', { silent: true })
    .then(me => {
      if (!me) return;
      window.zyRefreshWhitenoiseNav(me);
      if (window.BrandTheme && typeof window.BrandTheme.setUserTheme === 'function') {
        window.BrandTheme.setUserTheme(me.theme_key, me.theme_mode);
      }
    })
    .catch(() => {});
}

const _zyPrevLoad = loadPage;
loadPage = function (page) {
  _zyPrevLoad(page);
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = ZY_LABELS[page] || page;
  if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(page);
  if (window.zyCloseSidebar) window.zyCloseSidebar();
  window.scrollTo({ top: 0 });
};

/* ═══ DASHBOARD (agent layout V4) ══════════════════════════ */
pgDashboard = async function () {
  const c = document.getElementById('page-content');
  if (typeof zyUpdateBreadcrumb === 'function') {
    zyUpdateBreadcrumb('dashboard', 'Dashboard');
  }
  try {
    const [clients, daily, periodStats, numbersRes, rangesRes, appLinksRes, earnRes, clientRatesRes, meRes] = await Promise.all([
      apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=200`).catch(() => ({ data: [] })),
      apiFetch(`/api/sms/daily-stats?agent_id=${AGENT_ID}`),
      apiFetch(`/api/sms/period-stats?agent_id=${AGENT_ID}`).catch(() => null),
      apiFetch(`/api/numbers?agent_id=${AGENT_ID}&limit=1`).catch(() => ({ total: 0, data: [] })),
      apiFetch('/api/numbers/sms-ranges').catch(() => []),
      apiFetch('/api/app-links?dashboard=1&limit=10', { silent: true }).catch(() => ({ data: [] })),
      apiFetch(`/api/agent/${AGENT_ID}/earnings`).catch(() => null),
      apiFetch('/api/agent/client-rates', { silent: true }).catch(() => null),
      apiFetch('/api/auth/me', { silent: true }).catch(() => null)
    ]);
    if (meRes && typeof window.zyRefreshWhitenoiseNav === 'function') {
      window.zyRefreshWhitenoiseNav(meRes);
    }
    const agentHasWn = Boolean((meRes && meRes.whitenoise_access) || window.ZY_WHITENOISE_ACCESS);
    const appLinks = Array.isArray(appLinksRes?.data) ? appLinksRes.data.slice(0, 10) : [];

    const d = daily || {};
    const p = periodStats || {};
    const earn = earnRes || {};
    const clientList = Array.isArray(clients) ? clients : ((clients && clients.data) || []);
    const numberCount = (numbersRes && typeof numbersRes.total === 'number')
      ? numbersRes.total
      : ((numbersRes && numbersRes.data && numbersRes.data.length) || 0);

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

    const apiTodaySms = Number(p.api_today != null ? p.api_today : (d.today || 0));
    const apiYestSms = Number(p.api_yesterday != null ? p.api_yesterday : (d.yesterday || 0));
    const wnTodaySms = Number(p.whitenoise_today || 0);
    const wnLast30Val = Number(p.whitenoise_last_30_days || 0);
    const totalTodaySms = Number(p.today != null ? p.today : (apiTodaySms + wnTodaySms));
    const yestSmsVal = Number(p.yesterday != null ? p.yesterday : (d.yesterday || 0));
    const last7Val = Number(p.last_7_days != null ? p.last_7_days : weeklyTraffic.reduce((a, b) => a + (Number(b) || 0), 0));
    const last30Val = Number(p.last_30_days != null ? p.last_30_days : (d.this_month || 0));
    const yearSmsVal = Number(p.year != null ? p.year : (d.this_year || 0));

    const rawRanges = Array.isArray(rangesRes) ? rangesRes : ((rangesRes && rangesRes.data) || []);
    const sortedRanges = rawRanges.slice().sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    const latestRanges = sortedRanges.slice(0, 5).map(r => {
      const pts = r.payterms || {};
      const wkRate = pts['Weekly'] !== undefined ? pts['Weekly'] : (pts['7/3'] !== undefined ? pts['7/3'] : (r.weekly_rate ?? r.agent_rate ?? r.rate ?? r.payout ?? 0.01));
      const curr = r.currency === 'EUR' ? '€' : (r.currency === 'GBP' ? '£' : '$');
      const rawDate = r.created_at || r.created || r.date_added || r.date || '';
      const dateAdded = rawDate ? String(rawDate).replace('T', ' ').slice(0, 10) : 'Active';
      const isWn = Boolean(
        r.is_whitenoise ||
        String(r.provider || '').toLowerCase().includes('whitenoise') ||
        String(r.payout_schedule || '').toLowerCase() === 'monthly30_5'
      );
      return {
        name: r.range_name || r.name || r.country || '—',
        rateFormatted: `${curr}${typeof zyFmtMoney === 'function' ? zyFmtMoney(wkRate, 4) : Number(wkRate).toFixed(4)}`,
        dateAdded,
        isWn
      };
    });

    const pendingRateCount = Number(clientRatesRes?.pending_count || 0);
    const dashFx = Number(clientRatesRes?.usd_to_pkr_rate || 280);
    const dashTarget = clientRatesRes?.weekly_target || null;
    const hasDashTarget = !!(dashTarget && Number(dashTarget.weekly_pkr_target || 0) > 0);
    let dashAlertHtml = '';
    if (pendingRateCount > 0 || hasDashTarget) {
      const targetPart = hasDashTarget
        ? `<span class="zy-crs-num" style="font-weight:700;color:var(--sp-text-secondary);">Weekly PKR Target: Rs. ${Number(dashTarget.weekly_pkr_used || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} / Rs. ${Number(dashTarget.weekly_pkr_target || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} (${Number(dashTarget.weekly_pkr_percent || 0)}%)</span>`
        : '';
      const pendingPart = pendingRateCount > 0
        ? `<span><strong style="color:#d97706;">${pendingRateCount} range(s)</strong> pending Client PKR rate configuration (FX: 1 USD = Rs. ${zyFmtMoney(dashFx, 2)} PKR)</span>`
        : `<span>All client ranges configured <span style="color:var(--sp-text-muted);">(FX: 1 USD = Rs. ${zyFmtMoney(dashFx, 2)} PKR)</span></span>`;
      dashAlertHtml = `
        <div class="zy-crs-alert-bar">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <i class="fas fa-tags" style="color:var(--sp-primary);"></i>
            ${pendingPart}
            ${targetPart ? `<span style="color:var(--sp-border);">|</span>${targetPart}` : ''}
          </div>
        </div>`;
    }

    if (typeof window.zyRenderUnifiedDashboard === 'function') {
      window.zyRenderUnifiedDashboard({
        containerId: 'page-content',
        roleLabel: 'Agent',
        alertHtml: dashAlertHtml,
        rangesRoute: 'sms-ranges',
        reportsRoute: 'detailed-sms',
        notificationsRoute: 'notifications',
        chartId: 'zy-agent-week-chart',
        chartTodayTotal: apiTodaySms,
        weeklyLabels,
        weeklyTraffic,
        hero: {
          label: 'Today SMS (API)',
          value: apiTodaySms,
          yesterday: apiYestSms,
          subtitle: 'API SMS on your numbers today (UTC)',
          icon: 'fa-check',
          page: 'detailed-sms'
        },
        moneyCards: [
          { label: 'Monthly {W} SMS', value: wnTodaySms.toLocaleString(), sub: 'Daily file update: 12:00 PM PKT', icon: 'fa-tower-cell', page: agentHasWn ? 'cdr2' : 'sms-ranges' }
        ],
        shortcuts: [
          { label: 'My Numbers', page: 'my-sms-numbers', icon: 'fa-mobile-screen', tone: 'blue' },
          { label: 'My Clients', page: 'my-clients', icon: 'fa-users', tone: 'green' },
          { label: 'Client Rate Set', page: 'client-rate-set', icon: 'fa-tags', tone: 'blue' },
          { label: 'CDR & Stats', page: 'detailed-sms', icon: 'fa-comment-sms', tone: 'green' },
          agentHasWn
            ? { label: 'CDR 2 (Monthly)', page: 'cdr2', icon: 'fa-tower-cell', tone: 'blue' }
            : { label: 'Live Chat', page: 'live-chat', icon: 'fa-comments', tone: 'blue' },
          { label: 'Client Payouts', page: 'client-payment-requests', icon: 'fa-money-bill-transfer', tone: 'green' }
        ],
        volumes: [
          { label: 'Yesterday SMS', value: yestSmsVal, page: 'detailed-sms' },
          { label: 'SMS Last 7 Days', value: last7Val, page: 'detailed-sms' },
          { label: 'SMS Last 30 Days', value: last30Val, page: 'detailed-sms' },
          { label: 'Yearly SMS', value: yearSmsVal, page: 'detailed-sms' }
        ],
        summaryTitle: 'Agent Snapshot',
        summaryRows: [
          { label: 'My Clients', value: clientList.length.toLocaleString(), icon: 'fa-users', page: 'my-clients' },
          { label: 'My Numbers', value: numberCount.toLocaleString(), icon: 'fa-mobile-screen', page: 'my-sms-numbers' },
          { label: 'Monthly {W} (30d)', value: wnLast30Val.toLocaleString(), icon: 'fa-tower-cell', page: agentHasWn ? 'cdr2' : 'detailed-sms' },
          { label: 'SMS Last 7 Days', value: last7Val.toLocaleString(), icon: 'fa-comment-sms', page: 'detailed-sms' }
        ],
        latestRanges,
        appLinks
      });
    }
  } catch (err) {
    console.error('Agent dashboard error:', err);
    c.innerHTML = `<div class="zy-panel"><div class="zy-panel-body" style="text-align:center;padding:30px;">
        Dashboard could not load. <button class="zy-gear" onclick="pgDashboard()">Retry</button></div></div>`;
  }
};
