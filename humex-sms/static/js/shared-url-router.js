/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Universal SPA Router, Deep Links & History Sync (V4)
   - Zero full-page reloads
   - 1:1 Canonical URL /ints/:role/:CanonicalSlug for every sidebar route
   - Preserves human-readable breadcrumb & <title> labels across all roles
   - Synchronizes active sidebar item, accordion group & Back/Forward state
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const MAPS = {
    owner: {
      'dashboard': 'SMSDashboard',
      'live-chat': 'LiveChat',
      'my-numbers': 'SMSNumbers',
      'bulk-allocation': 'SMSBulkAllocations',
      'allocation-history': 'AllocationHistory',
      'sms-ranges': 'SMSRanges',
      'sms-rate-card': 'SMSRateCard',
      'upload-numbers': 'UploadNumbers',
      'smart-sheet-import': 'SmartSheetImport',
      'bulk-range-import': 'BulkRangeImport',
      'blacklist-management': 'Blacklist',
      'revoke-numbers': 'BlockedNumbers',
      'blocked-numbers': 'BlockedNumbers',
      'number-transfers-log': 'TransferHistory',
      'my-sms': 'SMSReports',
      'cdr2': 'CDR2',
      'profit-stats': 'ProfitStats',
      'live-otp-feed': 'LiveOtpFeed',
      'sms-analytics': 'SMSAnalytics',
      'failed-sms': 'FailedSMS',
      'live-traffic': 'LiveTraffic',
      'login-panels': 'LoginPanels',
      'cr-api-panels': 'CRAPIPanels',
      'whitenoise-panels': 'WhitenoiseReports',
      'registration-requests': 'RegistrationRequests',
      'agent-requests': 'NumberRequests',
      'number-requests': 'AgentNumberRequests',
      'payout-requests': 'PaymentRequests',
      'my-payouts': 'MyPayouts',
      'statements': 'Statements',
      'usd-statements': 'USDStatements',
      'eur-statements': 'EURStatements',
      'gbp-statements': 'GBPStatements',
      'credit-notes': 'CreditNotes',
      'users': 'Users',
      'agents': 'Agents',
      'clients': 'Clients',
      'hierarchy': 'Hierarchy',
      'account-balances': 'AccountBalances',
      'audit-logs': 'AuditLogs',
      'login-activity': 'LoginActivity',
      'firewall-dashboard': 'FirewallDashboard',
      'blocked-ips': 'BlockedIPs',
      'firewall-events': 'FirewallEvents',
      'rate-limits': 'RateLimits',
      'firewall-rates': 'FirewallRates',
      'business-reports': 'BusinessReports',
      'permissions': 'Permissions',
      'services-cli': 'ServicesCLI',
      'cli-manager': 'CLIManager',
      'services-manager': 'ServicesManager',
      'backup-restore': 'BackupRestore',
      'announcements': 'Announcements',
      'notifications': 'Notifications',
      'support-tickets': 'SupportTickets',
      'my-profile': 'Profile',
      'profile': 'Profile',
      'profile-security': 'ProfileSecurity',
      '2fa': 'TwoFactorAuth',
      'general-settings': 'GeneralSettings',
      'security-settings': 'SecuritySettings',
      'system-health': 'SystemHealth',
      'app-links': 'AppsLinks'
    },
    agent: {
      'dashboard': 'SMSDashboard',
      'live-chat': 'LiveChat',
      'my-sms-numbers': 'MySMSNumbers',
      'blocked-numbers': 'BlockedNumbers',
      'bulk-add': 'BulkAllocation',
      'client-requests': 'NumberRequests',
      'sms-ranges': 'SMSRanges',
      'sms-overview': 'SMSRanges',
      'sms-ratecard': 'SMSRateCard',
      'client-rate-set': 'ClientRateSet',
      'transfer-history': 'TransferHistory',
      'allocation-history': 'AllocationHistory',
      'my-clients': 'Clients',
      'notifications': 'Notifications',
      'news-clients': 'Notifications',
      'detailed-sms': 'DetailedSMSReports',
      'cdr2': 'CDR2',
      'payment-requests': 'MyPaymentRequests',
      'client-payment-requests': 'ClientPaymentRequests',
      'client-payment-tracker': 'ClientPaymentTracker',
      'credit-notes': 'CreditNotes',
      'usd-statements': 'USDStatements',
      'eur-statements': 'EURStatements',
      'gbp-statements': 'GBPStatements',
      'bank-accounts': 'BankAccounts',
      'my-earnings': 'PaymentRequests',
      'profile': 'Profile',
      'my-profile': 'Profile',
      'profile-security': 'ProfileSecurity',
      '2fa': 'TwoFactorAuth',
      'audit-logs': 'AuditLogs',
      'app-links': 'AppsLinks',
      'method-vault': 'MethodVault',
      'live-access': 'LiveAccess'
    },
    client: {
      'dashboard': 'SMSDashboard',
      'live-chat': 'LiveChat',
      'my-numbers': 'MySMSNumbers',
      'sms-overview': 'SMSRanges',
      'sms-ranges': 'SMSRanges',
      'sms-ratecard': 'SMSRateCard',
      'news': 'Notifications',
      'notifications': 'Notifications',
      'my-sms': 'SMSCDRStats',
      'cdr2': 'CDR2',
      'payout-requests': 'PaymentRequests',
      'my-balance': 'MyBalance',
      'my-earnings': 'CreditNotes',
      'my-profile': 'Profile',
      'profile': 'Profile',
      'profile-security': 'ProfileSecurity',
      '2fa': 'TwoFactorAuth',
      'audit-logs': 'AuditLogs',
      'app-links': 'AppsLinks',
      'live-access': 'LiveAccess'
    }
  };
  MAPS.admin = MAPS.owner;

  const CANONICAL_URL_TO_PAGE = {
    owner: {
      profile: 'my-profile',
      livechat: 'live-chat',
      numberrequests: 'agent-requests',
      agentpaymentrequests: 'payout-requests',
      searchsms: 'my-sms',
      deliverylogs: 'my-sms',
      liveaccess: 'live-otp-feed',
      notifications: 'notifications',
      appslinks: 'app-links',
      smartsheetimport: 'smart-sheet-import'
    },
    agent: {
      profile: 'my-profile',
      livechat: 'live-chat',
      appslinks: 'app-links',
      smsranges: 'sms-ranges',
      clientrateset: 'client-rate-set',
      clientpaymentrequests: 'client-payment-requests',
      clientpaymenttracker: 'client-payment-tracker',
      mypaymentrequests: 'payment-requests',
      notifications: 'notifications',
      bulkadd: 'bulk-add',
      assigntoclient: 'my-sms-numbers',
      summarysms: 'detailed-sms',
      clientsmsstats: 'detailed-sms',
      smsrangestats: 'detailed-sms',
      smsnumberstats: 'detailed-sms',
      allocationhistory: 'allocation-history',
      methodvault: 'method-vault',
      liveaccess: 'live-access'
    },
    client: {
      profile: 'my-profile',
      livechat: 'live-chat',
      appslinks: 'app-links',
      smsranges: 'sms-overview',
      notifications: 'news',
      liveaccess: 'live-access'
    }
  };

  const parts = location.pathname.split('/').filter(Boolean);
  let role = parts[0] === 'ints' ? parts[1] : null;
  if (!role) {
    const p = location.pathname.toLowerCase();
    if (p.includes('client')) role = 'client';
    else if (p.includes('agent')) role = 'agent';
    else role = 'owner';
  }
  role = role.toLowerCase();
  if (role === 'admin') role = 'owner';
  const map = MAPS[role] || MAPS.owner;

  const reverse = {};
  Object.keys(map).forEach(k => {
    const segKey = map[k].toLowerCase();
    if (!reverse[segKey]) reverse[segKey] = k;
  });
  const overrides = CANONICAL_URL_TO_PAGE[role] || {};
  Object.keys(overrides).forEach(segKey => {
    reverse[segKey] = overrides[segKey];
  });

  function fallbackSlug(page) {
    return String(page || 'dashboard')
      .split(/[-_]+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('') || 'SMSDashboard';
  }

  function slugFor(page) {
    return map[page] || fallbackSlug(page);
  }

  function urlFor(page) {
    return `/ints/${role}/${slugFor(page)}`;
  }

  function syncAllNavHrefs(root) {
    try {
      const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
      scope.querySelectorAll('a[data-page]').forEach(a => {
        const p = a.getAttribute('data-page');
        if (p) a.setAttribute('href', urlFor(p));
      });
    } catch (e) {}
  }

  window.zyPageUrl = urlFor;
  window.zySyncNavHrefs = syncAllNavHrefs;
  window.zyNavClick = function (e, page) {
    if (page === 'apps-method') {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (!window.ZY_METHOD_VAULT_ACCESS) return false;
      if (typeof window.zyCloseSidebar === 'function') window.zyCloseSidebar();
      if (typeof window.zyOpenClientAppsMethodDrawer === 'function') {
        window.zyOpenClientAppsMethodDrawer();
      }
      return false;
    }
    // Allow native browser new-tab / new-window actions (Ctrl+Click, Cmd+Click, Shift+Click, Middle-Click)
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1)) {
      return true;
    }
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof window.loadPage === 'function') window.loadPage(page);
    return false;
  };
  syncAllNavHrefs();

  function resolveLabel(page) {
    if (!page || page === 'dashboard') return 'Dashboard';
    if (window.ZY_ADMIN_LABELS && window.ZY_ADMIN_LABELS[page]) return window.ZY_ADMIN_LABELS[page];
    if (window.ZY_LABELS && window.ZY_LABELS[page]) return window.ZY_LABELS[page];
    const navEl = document.getElementById(`nav-${page}`) || document.querySelector(`[data-page="${page}"]`);
    const navText = navEl && (navEl.querySelector('span')?.textContent || navEl.textContent);
    if (navText && navText.trim()) return navText.trim();
    const rawCode = slugFor(page);
    return rawCode
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .trim() || page;
  }

  function formatTitle(page) {
    const label = resolveLabel(page);
    const roleTitle = role.charAt(0).toUpperCase() + role.slice(1);
    const siteName = (window.__BRAND_SETTINGS__ && window.__BRAND_SETTINGS__.site_name) || 'HUMAX SMS';
    return `${label} — ${roleTitle} Panel | ${siteName}`;
  }

  function pageFromUrl() {
    const seg = (location.pathname.split('/').filter(Boolean)[2] || '').toLowerCase();
    if (!seg) return null;
    if (reverse[seg]) return reverse[seg];
    // Kebab-case fallback for any non-map PascalCase deep link
    const rawSeg = location.pathname.split('/').filter(Boolean)[2] || '';
    const kebab = rawSeg.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return kebab || null;
  }

  function syncBodyPageClass(page) {
    try {
      const p = String(page || 'dashboard').toLowerCase().trim();
      const isDash = (!p || p === 'dashboard' || p === 'overview');
      const isLiveChat = (p === 'live-chat');
      if (document.body) {
        document.body.classList.toggle('zy-is-dashboard', isDash);
        document.body.classList.toggle('zy-is-subpage', !isDash);
        document.body.classList.toggle('zy-is-live-chat', isLiveChat);
        document.body.dataset.zyPage = p || 'dashboard';
      }
    } catch (e) {}
  }
  window.zySyncBodyPageClass = syncBodyPageClass;
  syncBodyPageClass(pageFromUrl() || 'dashboard');

  let isNavigatingHistory = false;
  let first = true;
  let historyInitialized = false;
  let activeRouterPage = pageFromUrl() || 'dashboard';
  const prev = window.loadPage;

  function currentUrlKey() {
    return `${location.pathname}${location.search || ''}`;
  }

  function closeOpenOverlaysForBackNav() {
    let closedAny = false;
    try {
      const player = document.getElementById('zy-mv-player-backdrop');
      if (player && typeof window.zyCloseSecureMethodPlayer === 'function') {
        window.zyCloseSecureMethodPlayer();
        closedAny = true;
      }
      const drawer = document.getElementById('zy-mv-client-drawer-wrap');
      if (drawer && drawer.classList.contains('is-open') && typeof window.zyCloseClientAppsMethodDrawer === 'function') {
        window.zyCloseClientAppsMethodDrawer(true);
        closedAny = true;
      }
      const chatLb = document.getElementById('zy-chat-lightbox');
      if (chatLb) {
        chatLb.remove();
        closedAny = true;
      }
      if (typeof window.zyCloseSidebar === 'function') {
        window.zyCloseSidebar();
      }
    } catch (_) {}
    return closedAny;
  }

  if (typeof prev === 'function') {
    window.loadPage = function (page) {
      if (page === 'apps-method') {
        if (!window.ZY_METHOD_VAULT_ACCESS) return;
        if (typeof window.zyCloseSidebar === 'function') window.zyCloseSidebar();
        if (typeof window.zyOpenClientAppsMethodDrawer === 'function') {
          window.zyOpenClientAppsMethodDrawer();
        }
        return;
      }
      const isInitialCall = first;
      if (first) {
        first = false;
        const want = pageFromUrl();
        if (want && want !== page) page = want;
      }

      const prevActivePage = activeRouterPage;
      activeRouterPage = page;

      if (prevActivePage === 'live-chat' && page !== 'live-chat' && window.HumexLiveChat && typeof window.HumexLiveChat.unmount === 'function') {
        try { window.HumexLiveChat.unmount(); } catch (_) {}
      }

      syncBodyPageClass(page);

      // 1. Show smooth skeleton state before async fetch starts
      if (typeof window.zyShowSkeleton === 'function') {
        window.zyShowSkeleton(page);
      }

      // 2. Delegate to real page renderer
      prev(page);

      // 3. Push browser history entries for real in-app navigation so Back button steps back through pages
      const label = resolveLabel(page);
      if (!isNavigatingHistory) {
        try {
          let targetUrl = urlFor(page);
          if (String(page || '').toLowerCase() === 'live-chat') {
            const chatMatch = String(location.search || '').match(/[?&]chat=(\d+)/);
            if (chatMatch) targetUrl = `${targetUrl}?chat=${chatMatch[1]}`;
          }
          const curKey = currentUrlKey();
          if (isInitialCall || !historyInitialized) {
            historyInitialized = true;
            // If user landed directly on a deep subpage (not dashboard), seed Dashboard behind it so Back returns to Dashboard instead of Chrome New Tab
            if (page && page !== 'dashboard' && (!history.state || !history.state.zySpa)) {
              history.replaceState({ page: 'dashboard', role, zySpa: true }, '', urlFor('dashboard'));
              history.pushState({ page, role, zySpa: true }, '', targetUrl);
            } else {
              history.replaceState({ page, role, zySpa: true }, '', targetUrl);
            }
          } else if (targetUrl !== curKey || (history.state && history.state.page !== page)) {
            history.pushState({ page, role, zySpa: true }, '', targetUrl);
          } else {
            history.replaceState({ page, role, zySpa: true }, '', targetUrl);
          }
          document.title = formatTitle(page);
        } catch (e) {}
      } else {
        try { document.title = formatTitle(page); } catch (e) {}
      }

      // 4. Sync active accordion group, canonical breadcrumb label & link hrefs
      if (typeof window.zySyncAccordionActive === 'function') {
        window.zySyncAccordionActive(page);
      }
      if (typeof window.zyUpdateBreadcrumb === 'function') {
        window.zyUpdateBreadcrumb(page, label);
      }
      setTimeout(() => syncAllNavHrefs(), 0);
    };
  }

  /* Browser / Mobile Back & Forward buttons (popstate) */
  window.addEventListener('popstate', e => {
    const st = e.state || {};
    // Close any open slide-over drawer / video player / lightbox cleanly on Back
    const closedOverlay = closeOpenOverlaysForBackNav();
    const page = st.page || pageFromUrl() || 'dashboard';

    // If Back merely dismissed the Apps Method overlay while staying on the same page, don't reload the page
    if (closedOverlay && page === activeRouterPage && !st.chatId && page !== 'live-chat') {
      return;
    }

    // Smooth in-place Back navigation inside Live Chat (e.g. from open group/client thread back to Chats list)
    if (activeRouterPage === 'live-chat' && page === 'live-chat' && window.HumexLiveChat && typeof window.HumexLiveChat.handleHistoryPop === 'function') {
      const m = String(location.search || '').match(/[?&]chat=(\d+)/);
      const nextChatId = st.chatId ? Number(st.chatId) : (m ? Number(m[1]) : null);
      window.HumexLiveChat.handleHistoryPop(nextChatId);
      try { document.title = formatTitle('live-chat'); } catch (_) {}
      return;
    }

    if (page && typeof prev === 'function') {
      isNavigatingHistory = true;
      try {
        if (activeRouterPage === 'live-chat' && page !== 'live-chat' && window.HumexLiveChat && typeof window.HumexLiveChat.unmount === 'function') {
          try { window.HumexLiveChat.unmount(); } catch (_) {}
        }
        activeRouterPage = page;
        syncBodyPageClass(page);
        if (typeof window.zyShowSkeleton === 'function') {
          window.zyShowSkeleton(page);
        }
        prev(page);
        const label = resolveLabel(page);
        document.title = formatTitle(page);
        if (typeof window.zySyncAccordionActive === 'function') {
          window.zySyncAccordionActive(page);
        }
        if (typeof window.zyUpdateBreadcrumb === 'function') {
          window.zyUpdateBreadcrumb(page, label);
        }
      } finally {
        isNavigatingHistory = false;
      }
    }
  });

  /* Open the deep-linked page or normalize initial URL on load */
  window.addEventListener('load', () => {
    setTimeout(() => {
      const page = pageFromUrl();
      if (first && page && typeof window.loadPage === 'function') {
        window.loadPage(page);
      } else if (!page && typeof history.replaceState === 'function') {
        try {
          const curPage = sessionStorage.getItem(
            role === 'owner' ? 'admin_current_page' : `${role}_current_page`
          ) || 'dashboard';
          activeRouterPage = curPage;
          historyInitialized = true;
          syncBodyPageClass(curPage);
          history.replaceState({ page: curPage, role, zySpa: true }, '', urlFor(curPage));
          document.title = formatTitle(curPage);
        } catch (e) {}
      } else if (page) {
        activeRouterPage = page;
        historyInitialized = true;
        syncBodyPageClass(page);
        try {
          if (!history.state || !history.state.zySpa) {
            history.replaceState({ page, role, zySpa: true }, '', currentUrlKey());
          }
          document.title = formatTitle(page);
        } catch (e) {}
      }
    }, 350);
  });
})();
