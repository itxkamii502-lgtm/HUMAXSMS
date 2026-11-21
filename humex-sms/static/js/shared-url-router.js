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
      'bulk-range-import': 'BulkRangeImport',
      'blacklist-management': 'Blacklist',
      'revoke-numbers': 'RevokeNumbers',
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
      'system-health': 'SystemHealth'
    },
    agent: {
      'dashboard': 'SMSDashboard',
      'live-chat': 'LiveChat',
      'my-sms-numbers': 'MySMSNumbers',
      'bulk-add': 'BulkAllocation',
      'client-requests': 'NumberRequests',
      'sms-ranges': 'SMSRanges',
      'sms-overview': 'SMSRanges',
      'sms-ratecard': 'SMSRateCard',
      'client-rate-set': 'ClientRateSet',
      'transfer-history': 'TransferHistory',
      'my-clients': 'Clients',
      'notifications': 'Notifications',
      'news-clients': 'Notifications',
      'detailed-sms': 'DetailedSMSReports',
      'cdr2': 'CDR2',
      'payment-requests': 'MyPaymentRequests',
      'client-payment-requests': 'ClientPaymentRequests',
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
      'audit-logs': 'AuditLogs'
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
      'audit-logs': 'AuditLogs'
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
      notifications: 'notifications'
    },
    agent: {
      profile: 'my-profile',
      livechat: 'live-chat',
      smsranges: 'sms-ranges',
      clientrateset: 'client-rate-set',
      clientpaymentrequests: 'client-payment-requests',
      mypaymentrequests: 'payment-requests',
      notifications: 'notifications',
      bulkadd: 'bulk-add',
      assigntoclient: 'my-sms-numbers',
      summarysms: 'detailed-sms',
      clientsmsstats: 'detailed-sms',
      smsrangestats: 'detailed-sms',
      smsnumberstats: 'detailed-sms'
    },
    client: {
      profile: 'my-profile',
      livechat: 'live-chat',
      smsranges: 'sms-overview',
      notifications: 'news'
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

  let isNavigatingHistory = false;
  let first = true;
  const prev = window.loadPage;

  if (typeof prev === 'function') {
    window.loadPage = function (page) {
      if (first) {
        first = false;
        const want = pageFromUrl();
        if (want && want !== page) page = want;
      }

      // 1. Show smooth skeleton state before async fetch starts
      if (typeof window.zyShowSkeleton === 'function') {
        window.zyShowSkeleton(page);
      }

      // 2. Delegate to real page renderer
      prev(page);

      // 3. Sync canonical URL & <title> in-place (replaceState prevents browser Back-button history traps on logout/login)
      const label = resolveLabel(page);
      if (!isNavigatingHistory) {
        try {
          const targetUrl = urlFor(page);
          history.replaceState({ page, role }, '', targetUrl);
          document.title = formatTitle(page);
        } catch (e) {}
      } else {
        try { document.title = formatTitle(page); } catch (e) {}
      }

      // 4. Sync active accordion group & canonical breadcrumb label
      if (typeof window.zySyncAccordionActive === 'function') {
        window.zySyncAccordionActive(page);
      }
      if (typeof window.zyUpdateBreadcrumb === 'function') {
        window.zyUpdateBreadcrumb(page, label);
      }
    };
  }

  /* Browser back / forward buttons (popstate) */
  window.addEventListener('popstate', e => {
    const page = (e.state && e.state.page) || pageFromUrl() || 'dashboard';
    if (page && typeof prev === 'function') {
      isNavigatingHistory = true;
      try {
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
          history.replaceState({ page: curPage, role }, '', urlFor(curPage));
          document.title = formatTitle(curPage);
        } catch (e) {}
      } else if (page) {
        try { document.title = formatTitle(page); } catch (e) {}
      }
    }, 350);
  });
})();
