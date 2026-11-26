/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Client panel (shell + dashboard)
   Identical sidebar & frame structure to the Owner panel with Client-scoped folders.
   Loads AFTER client-engine.js / client-pages.js.
   ═══════════════════════════════════════════════════════════════ */

/* Theme engine & sidebar toggle are provided by shared-brand-theme.js & shared-ui-kit.js */
/* ── Client flat menu model (direct links with custom colorful pictograms) ── */
const ZY_CLIENT_ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="8" height="9" rx="2.5" fill="currentColor" opacity="0.28"/>
    <rect x="3" y="3" width="8" height="9" rx="2.5" stroke="currentColor" stroke-width="1.8"/>
    <rect x="13" y="3" width="8" height="5.5" rx="2.2" fill="currentColor" opacity="0.88"/>
    <rect x="13" y="11" width="8" height="10" rx="2.5" fill="currentColor" opacity="0.28"/>
    <rect x="13" y="11" width="8" height="10" rx="2.5" stroke="currentColor" stroke-width="1.8"/>
    <rect x="3" y="14.5" width="8" height="6.5" rx="2.2" fill="currentColor" opacity="0.88"/>
  </svg>`,
  'live-chat': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4.5 6.5A3 3 0 0 1 7.5 3.5h9a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H10l-4.2 3.2c-.5.38-1.3.03-1.3-.62V6.5Z" fill="currentColor" opacity="0.22" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="9.2" cy="10" r="1.15" fill="currentColor"/>
    <circle cx="12.2" cy="10" r="1.15" fill="currentColor"/>
    <circle cx="15.2" cy="10" r="1.15" fill="currentColor"/>
  </svg>`,
  'app-links': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3.5" y="3.5" width="7.2" height="7.2" rx="2" fill="currentColor" opacity="0.26" stroke="currentColor" stroke-width="1.7"/>
    <rect x="13.3" y="3.5" width="7.2" height="7.2" rx="2" fill="currentColor" opacity="0.88"/>
    <rect x="3.5" y="13.3" width="7.2" height="7.2" rx="2" fill="currentColor" opacity="0.88"/>
    <path d="M14 17h6m-3-3 3 3-3 3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  'apps-method': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4.5" width="18" height="15" rx="3" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M10 9.2 15.5 12 10 14.8V9.2Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M7 4.5v3M17 4.5v3M7 16.5v3M17 16.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
  </svg>`,
  'live-access': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="2.6" fill="currentColor"/>
    <path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M5.2 18.8a9.6 9.6 0 0 1 0-13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.55"/>
  </svg>`,
  'my-numbers': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5.5" y="2.5" width="13" height="19" rx="3" fill="currentColor" opacity="0.22" stroke="currentColor" stroke-width="1.8"/>
    <rect x="8.5" y="6" width="7" height="5.5" rx="1.2" fill="currentColor" opacity="0.88"/>
    <circle cx="9.2" cy="15" r="1" fill="currentColor"/>
    <circle cx="12" cy="15" r="1" fill="currentColor"/>
    <circle cx="14.8" cy="15" r="1" fill="currentColor"/>
    <path d="M10 18.2h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  'sms-overview': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11C18.88 4 20 5.12 20 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 20 4 18.88 4 17.5v-11Z" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M4 9.5h16" stroke="currentColor" stroke-width="1.8"/>
    <rect x="7" y="12.2" width="4.5" height="2" rx="1" fill="currentColor"/>
    <rect x="13.5" y="12.2" width="3.5" height="2" rx="1" fill="currentColor" opacity="0.7"/>
    <rect x="7" y="15.8" width="6.5" height="2" rx="1" fill="currentColor" opacity="0.7"/>
    <circle cx="15.8" cy="16.8" r="1.2" fill="currentColor"/>
  </svg>`,
  'my-sms': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8.5a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.3c-.5.4-1.3.05-1.3-.6V16.5H6.5A2.5 2.5 0 0 1 4 14V5.5Z" fill="currentColor" opacity="0.22" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M8 12.2V9.8M11.8 12.2V7.2M15.6 12.2V8.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  cdr2: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="10" r="2.4" fill="currentColor"/>
    <path d="M8.3 13.7a5.2 5.2 0 0 1 0-7.4M15.7 6.3a5.2 5.2 0 0 1 0 7.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M5.6 16.4a9 9 0 0 1 0-12.8M18.4 3.6a9 9 0 0 1 0 12.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.55"/>
    <path d="M12 12.5 9.2 21h5.6L12 12.5Z" fill="currentColor" opacity="0.28" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  </svg>`,
  news: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3.5a5.8 5.8 0 0 0-5.8 5.8v3.1c0 .9-.36 1.76-1 2.4l-.7.7c-.45.45-.13 1.2.5 1.2h14c.63 0 .95-.75.5-1.2l-.7-.7a3.4 3.4 0 0 1-1-2.4V9.3A5.8 5.8 0 0 0 12 3.5Z" fill="currentColor" opacity="0.24" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M9.6 18.8a2.5 2.5 0 0 0 4.8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="17.8" cy="6.2" r="2.2" fill="currentColor"/>
  </svg>`,
  'payout-requests': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="6" width="18" height="13" rx="3" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M15 11.2h6v3.6h-6a1.8 1.8 0 1 1 0-3.6Z" fill="currentColor" opacity="0.88"/>
    <path d="M6.5 6V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="16.8" cy="13" r="0.9" fill="#ffffff"/>
  </svg>`,
  'my-earnings': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5.5 3.5h13v17l-2.6-1.7-2.6 1.7-2.6-1.7-2.6 1.7-2.6-1.7v-17Z" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M8.8 8.2h6.4M8.8 11.7h6.4M8.8 15.1h3.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  'my-profile': `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="8.2" r="3.8" fill="currentColor" opacity="0.28" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 19.8c.7-3.4 3.4-5.3 7-5.3s6.3 1.9 7 5.3" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`
};

const ZY_CLIENT_MENU = [
  { label: 'Dashboard', page: 'dashboard', color: '#1d4ed8', tint: 'rgba(29, 78, 216, 0.11)' },
  { label: 'Ranges Add', page: 'sms-overview', color: '#059669', tint: 'rgba(5, 150, 105, 0.11)' },
  { label: 'My Numbers', page: 'my-numbers', color: '#0284c7', tint: 'rgba(2, 132, 199, 0.11)' },
  { label: 'Show Report', page: 'my-sms', color: '#1d4ed8', tint: 'rgba(29, 78, 216, 0.11)' },
  { label: 'Whitenoise Reports', page: 'cdr2', color: '#0d9488', tint: 'rgba(13, 148, 136, 0.11)', hiddenByDefault: true },
  { label: 'Live Access', page: 'live-access', color: '#10b981', tint: 'rgba(16, 185, 129, 0.12)', hiddenByDefault: true },
  { label: 'Apps Links', page: 'app-links', color: '#0284c7', tint: 'rgba(2, 132, 199, 0.11)', hiddenByDefault: true },
  { label: 'Apps Method', page: 'apps-method', color: '#7c3aed', tint: 'rgba(124, 58, 237, 0.12)', hiddenByDefault: true },
  { label: 'Notifications', page: 'news', color: '#0284c7', tint: 'rgba(2, 132, 199, 0.11)' },
  { label: 'Payment Requests', page: 'payout-requests', color: '#059669', tint: 'rgba(5, 150, 105, 0.11)' },
  { label: 'Credit Notes', page: 'my-earnings', color: '#0d9488', tint: 'rgba(13, 148, 136, 0.11)' },
  { label: 'My Profile', page: 'my-profile', color: '#1d4ed8', tint: 'rgba(29, 78, 216, 0.11)' }
];
const ZY_LABELS = {
  'dashboard': 'Dashboard',
  'live-chat': 'Live Chat',
  'app-links': 'Apps Links',
  'apps-method': 'Apps Method',
  'live-access': 'Live Access',
  'my-numbers': 'My Numbers',
  'sms-overview': 'Ranges Add',
  'sms-ranges': 'Ranges Add',
  'sms-ratecard': 'Ranges Add',
  'news': 'Notifications',
  'notifications': 'Notifications',
  'my-sms': 'Show Report',
  'cdr2': 'Whitenoise Reports',
  'my-earnings': 'Credit Notes',
  'payout-requests': 'Payment Requests',
  'profile': 'My Profile',
  'my-profile': 'My Profile',
  'profile-security': 'My Profile',
  '2fa': 'My Profile',
  'audit-logs': 'My Profile'
};
window.ZY_LABELS = ZY_LABELS;

const CLIENT_ROUTE_PARENT = {
  'sms-ranges': 'sms-overview',
  'sms-ratecard': 'sms-overview',
  'cdr2': 'my-sms',
  'notifications': 'news',
  'my-balance': 'payout-requests',
  'profile': 'my-profile',
  'profile-security': 'my-profile',
  '2fa': 'my-profile',
  'audit-logs': 'my-profile'
};
window.CLIENT_ROUTE_PARENT = CLIENT_ROUTE_PARENT;

/* ── shell ─────────────────────────────────────────────────── */
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
    side.classList.add('zy-sidenav-flat');
    side.innerHTML = ZY_CLIENT_MENU.map((item) => {
      const svg = ZY_CLIENT_ICONS[item.page] || ZY_CLIENT_ICONS.dashboard;
      const href = (typeof window.zyPageUrl === 'function') ? window.zyPageUrl(item.page) : `/ints/client/${item.page}`;
      return `<a class="zy-snav nav-item zy-snav-direct${item.hiddenByDefault ? ' zy-nav-hidden' : ''}" id="nav-${item.page}" data-page="${item.page}" href="${href}"
            ${item.hiddenByDefault ? 'hidden style="display:none !important;"' : ''}
            onclick="return window.zyNavClick ? window.zyNavClick(event, '${item.page}') : (event.preventDefault(), loadPage('${item.page}'), false)">
         <span class="zy-ic zy-cl-ic-box" style="--ic-fg:${item.color};--ic-bg:${item.tint};">${svg}</span>
         <span class="zy-snav-lbl">${item.label}</span>
         <i class="fas fa-chevron-right zy-caret zy-caret-direct" aria-hidden="true"></i>
       </a>`;
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
  if (window._zyClientClockTimer) clearInterval(window._zyClientClockTimer);
  window._zyClientClockTimer = setInterval(tick, 1000);

  let sess = {};
  try { sess = JSON.parse(sessionStorage.getItem('admin_user') || '{}'); } catch (e) {}
  const u = (window.CLIENT_USER && CLIENT_USER.username) || sess.username || 'Client';
  ['panel-username-side', 'client-username'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = u;
  });
  const sub = document.getElementById('client-name-sub');
  if (sub) sub.textContent = 'Client Panel';

  setTimeout(() => {
    const initPage = sessionStorage.getItem('client_current_page') || 'dashboard';
    if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(initPage);
  }, 100);
})();

window.ZY_WHITENOISE_ACCESS = false;
window.ZY_APP_LINKS_ACCESS = false;
window.ZY_LIVE_ACCESS_ENABLED = false;
window.ZY_METHOD_VAULT_ACCESS = false;
function _zySetClientNavVisible(el, visible) {
  if (!el) return;
  const show = Boolean(visible);
  el.classList.toggle('zy-nav-hidden', !show);
  el.hidden = !show;
  if (show) {
    el.style.removeProperty('display');
  } else {
    el.style.setProperty('display', 'none', 'important');
  }
}
window.zySyncLiveAccessNav = function(enabled) {
  window.ZY_LIVE_ACCESS_ENABLED = Boolean(enabled);
  _zySetClientNavVisible(document.getElementById('nav-live-access'), window.ZY_LIVE_ACCESS_ENABLED);
};
window.zyRefreshWhitenoiseNav = function(me) {
  const allowed = Boolean(me && me.whitenoise_access);
  window.ZY_WHITENOISE_ACCESS = allowed;
  _zySetClientNavVisible(document.getElementById('nav-cdr2'), allowed);
  const appAllowed = Boolean(me && me.app_links_access);
  window.ZY_APP_LINKS_ACCESS = appAllowed;
  _zySetClientNavVisible(document.getElementById('nav-app-links'), appAllowed);
  const mvAllowed = Boolean(me && me.method_vault_access);
  window.ZY_METHOD_VAULT_ACCESS = mvAllowed;
  _zySetClientNavVisible(document.getElementById('nav-apps-method'), mvAllowed);
  if (me && typeof me.live_access_enabled === 'boolean') {
    window.zySyncLiveAccessNav(me.live_access_enabled);
  }
};
if (typeof apiFetch === 'function') {
  apiFetch('/api/auth/me', { silent: true })
    .then(me => {
      if (!me) return;
      if (me.id != null) {
        CLIENT_ID = me.id;
        CLIENT_USER = Object.assign({}, CLIENT_USER || {}, me);
        try { sessionStorage.setItem('admin_user', JSON.stringify(CLIENT_USER)); } catch (_) {}
      }
      window.zyRefreshWhitenoiseNav(me);
      if (window.BrandTheme && typeof window.BrandTheme.setUserTheme === 'function') {
        window.BrandTheme.setUserTheme(me.theme_key, me.theme_mode);
      }
    })
    .catch(() => {});
}

const _zyPrevLoad = loadPage;
loadPage = function (page) {
  if (page === 'apps-method') {
    if (window.zyCloseSidebar) window.zyCloseSidebar();
    if (typeof window.zyOpenClientAppsMethodDrawer === 'function') {
      window.zyOpenClientAppsMethodDrawer();
    }
    return;
  }
  _zyPrevLoad(page);
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = ZY_LABELS[page] || page;
  if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(page);
  if (window.zyCloseSidebar) window.zyCloseSidebar();
  window.scrollTo({ top: 0 });
};

/* ═══ DASHBOARD (client layout V4) ═════════════════════════ */
pgDashboard = async function () {
  const c = document.getElementById('page-content');
  if (typeof zyUpdateBreadcrumb === 'function') {
    zyUpdateBreadcrumb('dashboard', 'Dashboard');
  }
  try {
    if (!CLIENT_ID) {
      const me = await apiFetch('/api/auth/me', { silent: true }).catch(() => null);
      if (me && me.id != null) {
        CLIENT_ID = me.id;
        CLIENT_USER = Object.assign({}, CLIENT_USER || {}, me);
      }
    }
    const [numbersRes, blockedRes, daily, periodStats, rateCardRes, appLinksRes, earnRes, meRes] = await Promise.all([
      apiFetch(CLIENT_ID ? `/api/numbers?client_id=${encodeURIComponent(CLIENT_ID)}&limit=1` : '/api/numbers?limit=1', { silent: true }).catch(() => ({ total: 0, data: [] })),
      apiFetch('/api/numbers/blocked', { silent: true }).catch(() => ({ count: 0, data: [] })),
      apiFetch(`/api/sms/daily-stats?client_id=${CLIENT_ID}`, { silent: true }),
      apiFetch(`/api/sms/period-stats?client_id=${CLIENT_ID}`, { silent: true }).catch(() => null),
      apiFetch('/api/client/rate-card', { silent: true }).catch(() => ({ ranges: [] })),
      apiFetch('/api/app-links?dashboard=1&limit=10', { silent: true }).catch(() => ({ data: [] })),
      CLIENT_ID ? apiFetch(`/api/client/${CLIENT_ID}/earnings`, { silent: true }).catch(() => null) : Promise.resolve(null),
      apiFetch('/api/auth/me', { silent: true }).catch(() => null)
    ]);
    if (meRes && typeof window.zyRefreshWhitenoiseNav === 'function') {
      window.zyRefreshWhitenoiseNav(meRes);
    }
    const clientHasWn = Boolean((meRes && meRes.whitenoise_access) || window.ZY_WHITENOISE_ACCESS || (window.CLIENT_USER && CLIENT_USER.whitenoise_access));
    const blockedCount = Number(
      (blockedRes && blockedRes.count != null)
        ? blockedRes.count
        : (Array.isArray(blockedRes?.data) ? blockedRes.data.length : 0)
    );
    const appLinks = Array.isArray(appLinksRes?.data) ? appLinksRes.data.slice(0, 10) : [];

    const d = daily || {};
    const p = periodStats || {};
    const earn = earnRes || {};
    const fx = Number(p.usd_to_pkr_rate || rateCardRes?.usd_to_pkr_rate || earn.usd_to_pkr_rate || 280);
    window._zyClientFx = fx;

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
    const totalTodaySms = Number(p.today != null ? p.today : (apiTodaySms + wnTodaySms));
    const yestSmsVal = Number(p.yesterday != null ? p.yesterday : (d.yesterday || 0));
    const last7Val = Number(p.last_7_days != null ? p.last_7_days : weeklyTraffic.reduce((a, b) => a + (Number(b) || 0), 0));
    const last30Val = Number(p.last_30_days != null ? p.last_30_days : (d.this_month || 0));
    const yearSmsVal = Number(p.year != null ? p.year : (d.this_year || 0));

    const earnToday = Number(
      p.profit_today_pkr != null
        ? p.profit_today_pkr
        : (earn.today_pkr != null ? earn.today_pkr : ((p.profit_today != null ? p.profit_today : (earn.today || 0)) * fx))
    );
    const mainBalance = Number(
      earn.main_balance_pkr != null
        ? earn.main_balance_pkr
        : ((window.CLIENT_USER && CLIENT_USER.balance_pkr != null)
            ? CLIENT_USER.balance_pkr
            : ((earn.main_balance ?? earn.balance ?? (window.CLIENT_USER && CLIENT_USER.balance) ?? 0) * fx))
    );

    const rawRanges = Array.isArray(rateCardRes?.ranges) ? rateCardRes.ranges : [];
    const sortedRanges = rawRanges.slice().sort((a, b) => Number(b.range_id || b.id || 0) - Number(a.range_id || a.id || 0));
    const latestRanges = sortedRanges.slice(0, 5).map(r => {
      const ratePkr = Number(r.client_rate_pkr ?? r.rate ?? r.payout ?? 0);
      const batchStr = Array.isArray(r.allowed_quantities) && r.allowed_quantities.length
        ? r.allowed_quantities.join(' / ')
        : '25 / 50';
      const isWn = Boolean(
        r.is_whitenoise ||
        String(r.provider || '').toLowerCase().includes('whitenoise') ||
        String(r.payout_schedule || '').toLowerCase() === 'monthly30_5'
      );
      return {
        name: r.range_name || r.name || r.country || '—',
        rateFormatted: `Rs. ${zyFmtMoney(ratePkr, 4)}`,
        dateAdded: r.requested_today ? 'Requested Today' : `Batch ${batchStr}`,
        isWn
      };
    });

    const fmtPkr = v => `Rs. ${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

    if (typeof window.zyRenderUnifiedDashboard === 'function') {
      window.zyRenderUnifiedDashboard({
        containerId: 'page-content',
        roleLabel: 'Client',
        rangesRoute: 'sms-overview',
        reportsRoute: 'my-sms',
        notificationsRoute: 'news',
        chartId: 'zy-client-week-chart',
        chartTodayTotal: apiTodaySms,
        weeklyLabels,
        weeklyTraffic,
        hero: {
          label: 'Today SMS',
          value: apiTodaySms,
          yesterday: apiYestSms,
          subtitle: 'SMS on your numbers today (UTC)',
          icon: 'fa-check',
          page: 'my-sms'
        },
        moneyCards: [],
        shortcuts: [
          { label: 'My Numbers', page: 'my-numbers', icon: 'fa-mobile-screen', tone: 'blue' },
          { label: 'Ranges Add', page: 'sms-overview', icon: 'fa-table-list', tone: 'green' },
          { label: 'Show Report', page: 'my-sms', icon: 'fa-comment-sms', tone: 'blue' },
          clientHasWn
            ? { label: 'Whitenoise Reports', page: 'cdr2', icon: 'fa-tower-cell', tone: 'green' }
            : { label: 'Live Chat', page: 'live-chat', icon: 'fa-comments', tone: 'green' },
          { label: 'Payment Requests', page: 'payout-requests', icon: 'fa-wallet', tone: 'blue' },
          { label: 'Credit Notes', page: 'my-earnings', icon: 'fa-receipt', tone: 'green' }
        ],
        volumes: [
          { label: 'Yesterday SMS', value: yestSmsVal, page: 'my-sms' },
          { label: 'SMS Last 7 Days', value: last7Val, page: 'my-sms' },
          { label: 'SMS Last 30 Days', value: last30Val, page: 'my-sms' },
          { label: 'Yearly SMS', value: yearSmsVal, page: 'my-sms' }
        ],
        summaryTitle: 'Account Snapshot (PKR)',
        summaryRows: [
          { label: 'My Balance (PKR)', value: fmtPkr(mainBalance), icon: 'fa-wallet', page: 'my-balance' },
          { label: 'My Numbers', value: numberCount.toLocaleString(), icon: 'fa-mobile-screen', page: 'my-numbers' },
          { label: 'Blocked Numbers', value: blockedCount.toLocaleString(), icon: 'fa-ban', tone: 'red', page: 'my-numbers' },
          { label: 'SMS Last 7 Days', value: last7Val.toLocaleString(), icon: 'fa-comment-sms', page: 'my-sms' }
        ],
        latestRanges,
        appLinks
      });
    }
  } catch (err) {
    console.error('Client dashboard error:', err);
    c.innerHTML = `<div class="zy-panel"><div class="zy-panel-body" style="text-align:center;padding:30px;">
        Dashboard could not load. <button class="zy-gear" onclick="pgDashboard()">Retry</button></div></div>`;
  }
};
