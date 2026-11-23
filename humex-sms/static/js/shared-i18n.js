/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Header Quick Theme Toggle & Live Roman Urdu Engine
   - Half-Moon Light/Dark (White/Black) instant toggle + per-user save
   - Compact Language Switcher: English (EN) <-> Roman Urdu (UR)
   - Per-user persistence (Owner, Agent, Client independent)
   - Reversible live DOM translator with MutationObserver (never alters
     usernames, numbers, amounts, dates, codes, or user chat messages)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.HumexI18n) return;

  // ── Comprehensive English -> Roman Urdu UI Dictionary ─────────
  // Keys are lowercase-normalized for fast O(1) lookup
  const EXACT_DICT = {
    // Common Navigation & Breadcrumb
    'home': 'Home',
    'dashboard': 'Dashboard',
    'live chat': 'Live Chat',
    'logout': 'Logout',
    'sign out': 'Logout',
    'my profile': 'Meri Profile',
    'profile': 'Profile',
    'profile & security': 'Profile aur Security',
    'owner panel': 'Owner Panel',
    'agent panel': 'Agent Panel',
    'client panel': 'Client Panel',
    'notifications': 'Notifications',
    'announcements': 'Elanaat',
    'communication hub': 'Elanaat aur Rabta',
    'general & brand settings': 'General aur Brand Settings',
    'general settings': 'General Settings',
    'security & firewall': 'Security aur Firewall',
    'audit logs': 'Audit Logs',
    'login activity': 'Login Activity',
    'backup & restore': 'Backup aur Restore',
    'system health': 'System Health',
    'support tickets': 'Support Tickets',

    // Sidebar Section Headers
    'numbers & inventory': 'NUMBERS AUR STOCK',
    'sms & analytics': 'SMS AUR REPORTS',
    'providers': 'PROVIDERS',
    'payments': 'PAYMENTS AUR HISAAB',
    'accounts & security': 'ACCOUNTS AUR SECURITY',
    'platform & support': 'SETTINGS AUR SUPPORT',
    'agent requests': 'AGENT REQUESTS',
    'users & notifications': 'CLIENTS AUR NOTIFICATIONS',
    'client requests': 'CLIENT REQUESTS',

    // Sidebar Menu Items (Owner / Agent / Client)
    'numbers pool hub': 'Numbers Pool',
    'numbers pool': 'Numbers Pool',
    'my numbers': 'Mere Numbers',
    'ranges & rate card': 'Ranges Add',
    'ranges & rates': 'Ranges Add',
    'ranges rate card': 'Ranges Add',
    'ranges add': 'Ranges Add',
    'client rate set': 'Client Rate Set',
    'upload & blacklist': 'Upload aur Blacklist',
    'upload numbers': 'Numbers Upload Karein',
    'bulk allocation': 'Bulk Allocation',
    'allocation & transfer log': 'Allocation aur Transfer Log',
    'transfer history': 'Transfer History',
    'sms cdr reports': 'Show Report',
    'cdr reports': 'Show Report',
    'cdr & statistics': 'Show Report',
    'cdr & stats': 'Show Report',
    'show report': 'Show Report',
    'cdr 2 (whitenoise)': 'Whitenoise Reports',
    'cdr 2 (excel)': 'Whitenoise Reports',
    'cdr 2 (monthly)': 'Whitenoise Reports',
    'whitenoise reports': 'Whitenoise Reports',
    'failed sms': 'Failed SMS',
    'live monitor': 'Live Monitor',
    'live otp feed': 'Live OTP Feed',
    'analytics & reports': 'Analytics aur Reports',
    'cr api panels': 'CR API Panels',
    'web scraping panels': 'Web Scraping Panels',
    'whitenoise excel reports': 'Whitenoise Excel Reports',
    'agent payment requests': 'Agent Payment Requests',
    'my payment requests': 'Meri Payment Requests',
    'client payment requests': 'Client Payment Requests',
    'payment requests': 'Payment Requests',
    'payout requests': 'Payout Requests',
    'client payouts': 'Client Payouts',
    'my payouts': 'Mere Payouts',
    'account balances': 'Account Balances',
    'my balance': 'Mera Balance',
    'my balance (pkr)': 'Mera Balance (PKR)',
    'statements': 'Statements',
    'usd statements': 'USD Statements',
    'eur statements': 'EUR Statements',
    'gbp statements': 'GBP Statements',
    'credit notes': 'Credit Notes',
    'accounts & hierarchy': 'Accounts aur Hierarchy',
    'agents': 'Agents',
    'clients': 'Clients',
    'my clients': 'Mere Clients',
    'users': 'Users',
    'hierarchy': 'Hierarchy',
    'agent number requests': 'Agent Number Requests',
    'client number requests': 'Client Number Requests',
    'registration requests': 'Registration Requests',
    'number requests': 'Number Requests',
    'bank accounts': 'Bank Accounts',
    'revoke numbers': 'Numbers Wapas Lein',
    'blacklist management': 'Blacklist Management',
    'services & cli': 'Services aur CLI',
    'cli manager': 'CLI Manager',
    'services manager': 'Services Manager',

    // Dashboard Hero, KPIs & Cards
    'today sms': 'Aaj ke SMS',
    'yesterday sms': 'Kal ke SMS',
    'sms last 7 days': 'Pichle 7 Din ke SMS',
    'sms last 30 days': 'Pichle 30 Din ke SMS',
    'last 7 days': 'Pichle 7 Din',
    'last 30 days': 'Pichle 30 Din',
    'this week': 'Is Hafte',
    'this month': 'Is Mahine',
    'today': 'Aaj',
    'yesterday': 'Kal',
    'on your agent numbers today': 'Aaj aapke agent numbers par',
    'on your numbers today': 'Aaj aapke numbers par',
    'across all active routes today': 'Aaj tamam active routes par',
    'across all platform numbers today': 'Aaj poore platform ke numbers par',
    'profit today': 'Aaj ka Munafa',
    'profit week': 'Hafte ka Munafa',
    'revenue today': 'Aaj ki Kamai',
    'revenue week': 'Hafte ki Kamai',
    'net profit today': 'Aaj ka Net Munafa',
    'net profit week': 'Hafte ka Net Munafa',
    'net agent commission today': 'Aaj ka net agent commission',
    'current week (mon–sun)': 'Is hafte (Peer–Itwar)',
    'current week (mon-sun)': 'Is hafte (Peer-Itwar)',
    'current week (mon–sun pkr)': 'Is hafte (Peer–Itwar PKR)',
    'my earnings today': 'Aaj ki Kamai',
    'my earnings week': 'Is Hafte ki Kamai',
    'earnings today (pkr)': 'Aaj ki Kamai (PKR)',
    'earned today (pkr)': 'Aaj kamaye (PKR)',
    'quick access': 'Fori Shortcuts',
    'weekly sms traffic': 'Haftawar SMS Traffic',
    '7-day sms trend': '7-Din ka SMS Trend',
    'sms volume (7 days)': '7 Din ka SMS Volume',
    'top ranges': 'Top Ranges',
    'top active ranges': 'Top Active Ranges',
    'top performing ranges': 'Sab se Behtar Ranges',
    'latest announcements': 'Taza Elanaat',
    'recent announcements': 'Haaliya Elanaat',
    'no announcements yet': 'Abhi koi elaan nahi hai',
    'no announcements': 'Koi elaan nahi hai',
    'no data available': 'Koi data mojood nahi',
    'no records found': 'Koi record nahi mila',
    'no data yet': 'Abhi koi data nahi hai',
    'no ranges active yet': 'Abhi koi range active nahi hai',
    'total sms': 'Kul SMS',
    'total numbers': 'Kul Numbers',
    'active numbers': 'Active Numbers',
    'available numbers': 'Available Numbers',
    'assigned numbers': 'Assigned Numbers',
    'total agents': 'Kul Agents',
    'total clients': 'Kul Clients',
    'active clients': 'Active Clients',
    'active agents': 'Active Agents',
    'total ranges': 'Kul Ranges',
    'active ranges': 'Active Ranges',
    'total revenue': 'Kul Kamai',
    'total payout': 'Kul Payout',
    'total profit': 'Kul Munafa',
    'net profit': 'Net Munafa',
    'gross payout': 'Gross Payout',
    'net balance': 'Net Balance',
    'available balance': 'Available Balance',
    'pending balance': 'Pending Balance',
    'held balance': 'Hold Balance',
    'total balance': 'Kul Balance',
    'withdrawable balance': 'Nikalne Qabil Balance',
    'pending requests': 'Pending Requests',
    'approved requests': 'Manzoor Shuda Requests',
    'rejected requests': 'Mustarad Requests',
    'pending payouts': 'Pending Payouts',
    'paid payouts': 'Ada Shuda Payouts',
    'total paid': 'Kul Ada Shuda',
    'fx rate': 'Dollar Rate (FX)',
    'usd to pkr': 'USD se PKR',

    // Filters, Search, Group By & Table Controls
    'from date': 'Shuru Tareekh',
    'to date': 'Aakhri Tareekh',
    'date from': 'Shuru Tareekh',
    'date to': 'Aakhri Tareekh',
    'start date': 'Shuru Tareekh',
    'end date': 'Aakhri Tareekh',
    'date range': 'Tareekh ki Hadd',
    'group by': 'Group Karein',
    'show report': 'Report Dekhein',
    'show records': 'Records Dekhein',
    'filter': 'Filter',
    'apply filter': 'Filter Lagayein',
    'reset': 'Reset',
    'clear': 'Saaf Karein',
    'clear filters': 'Filters Saaf Karein',
    'search': 'Talash',
    'columns': 'Columns',
    'copy': 'Copy',
    'print': 'Print',
    'export': 'Export',
    'export csv': 'CSV Export',
    'export excel': 'Excel Export',
    'download': 'Download',
    'download pdf': 'PDF Download',
    'upload': 'Upload',
    'upload excel stats': 'Excel Sheet Upload Karein',
    'upload excel': 'Excel Upload Karein',
    'batch history': 'Upload History',
    'refresh': 'Refresh',
    'reload': 'Dobara Load Karein',
    'save': 'Save Karein',
    'save changes': 'Tabdeelian Save Karein',
    'save settings': 'Settings Save Karein',
    'update': 'Update Karein',
    'submit': 'Submit Karein',
    'confirm': 'Tasdeeq Karein',
    'cancel': 'Cancel',
    'close': 'Band Karein',
    'delete': 'Delete Karein',
    'remove': 'Hatayein',
    'edit': 'Edit Karein',
    'view': 'Dekhein',
    'details': 'Tafseelat',
    'manage': 'Manage Karein',
    'info': 'Maloomat',
    'add': 'Shamil Karein',
    'add new': 'Naya Shamil Karein',
    'create': 'Banayein',
    'approve': 'Manzoor Karein',
    'reject': 'Mustarad Karein',
    'mark paid': 'Paid Mark Karein',
    'pay now': 'Abhi Ada Karein',
    'request numbers': 'Numbers Request Karein',
    'request payout': 'Payout Request Karein',
    'request payment': 'Payment Request Karein',
    'allocate': 'Assign Karein',
    'assign': 'Assign Karein',
    'assign to client': 'Client ko Dein',
    'revoke': 'Wapas Lein',
    'return': 'Wapas Karein',
    'return number': 'Number Wapas Karein',
    'copy all': 'Sab Copy Karein',
    'copy selected': 'Chune Hue Copy Karein',
    'select all': 'Sab Chunein',
    'actions': 'Amal',
    'action': 'Amal',
    'status': 'Haalat',
    'all': 'Tamam',
    'active': 'Active',
    'inactive': 'Band',
    'pending': 'Intezar Mein',
    'approved': 'Manzoor',
    'rejected': 'Mustarad',
    'paid': 'Ada Shuda',
    'completed': 'Mukammal',
    'failed': 'Nakaam',
    'delivered': 'Pohnch Gaya',
    'sent': 'Bheja Gaya',
    'blocked': 'Block Shuda',
    'suspended': 'Moattal',
    'available': 'Dastiyab',
    'assigned': 'Assign Shuda',
    'held': 'Hold Par',
    'enabled': 'Chalu',
    'disabled': 'Band',
    'on': 'Chalu',
    'off': 'Band',
    'yes': 'Haan',
    'no': 'Nahi',

    // Table Column Headers & Common Field Labels
    'date': 'Tareekh',
    'time': 'Waqt',
    'hour': 'Ghanta',
    'month': 'Mahina',
    'day': 'Din',
    'provider': 'Provider',
    'range': 'Range',
    'range name': 'Range ka Naam',
    'prefix': 'Prefix',
    'country': 'Mulk',
    'agent': 'Agent',
    'client': 'Client',
    'owner': 'Owner',
    'number': 'Number',
    'numbers': 'Numbers',
    'phone number': 'Phone Number',
    'cli': 'CLI',
    'service': 'Service',
    'service / cli': 'Service / CLI',
    'message': 'Message',
    'sms': 'SMS',
    'sms count': 'SMS Tadaad',
    'count': 'Tadaad',
    'quantity': 'Tadaad',
    'qty': 'Tadaad',
    'rate': 'Rate',
    'my rate': 'Mera Rate',
    'base rate': 'Base Rate',
    'agent rate': 'Agent Rate',
    'client rate': 'Client Rate',
    'your rate': 'Aapka Rate',
    'payout': 'Payout',
    'payout (pkr)': 'Payout (PKR)',
    'payout (usd)': 'Payout (USD)',
    'revenue': 'Kamai',
    'profit': 'Munafa',
    'amount': 'Raqam',
    'amount (pkr)': 'Raqam (PKR)',
    'amount (usd)': 'Raqam (USD)',
    'balance': 'Balance',
    'payterm': 'Payterm',
    'pay term': 'Payterm',
    'payment term': 'Payment Term',
    'payment method': 'Payment Tareeqa',
    'account title': 'Account Title',
    'account number': 'Account Number',
    'bank name': 'Bank ka Naam',
    'notes': 'Notes',
    'note': 'Note',
    'reason': 'Wajah',
    'description': 'Tafseel',
    'type': 'Qism',
    'role': 'Ohda',
    'username': 'Username',
    'full name': 'Poora Naam',
    'name': 'Naam',
    'email': 'Email',
    'phone': 'Phone',
    'password': 'Password',
    'new password': 'Naya Password',
    'current password': 'Mojooda Password',
    'confirm password': 'Password Dobara Likhein',
    'created': 'Banaya Gaya',
    'created at': 'Banane ka Waqt',
    'updated': 'Update Hua',
    'last login': 'Aakhri Login',
    'ip address': 'IP Address',
    'total': 'Kul',
    'subtotal': 'Subtotal',
    'summary': 'Khulasa',
    'weekly': 'Haftawar',
    'biweekly': 'Pandrah Roza',
    'monthly': 'Mahana',
    'weekly (7/3)': 'Haftawar (7/3)',
    'biweekly (15/3)': 'Pandrah Roza (15/3)',
    'monthly (30/5) {w}': 'Mahana (30/5) {W}',
    'monthly cycle settlement': 'Mahana Cycle Settlement',
    'hold summary': 'Hold ka Khulasa',
    'next payout': 'Agli Payment',
    'pool': 'Pool',
    'held/pool': 'Hold / Pool',
    'limit': 'Hadd',
    'daily limit': 'Rozana Hadd',
    'batch size': 'Batch Size',
    'weekly target': 'Haftawar Target',
    'weekly client pkr target': 'Haftawar Client PKR Target',

    // Live Chat UI Labels (strictly UI chrome — never user messages)
    'new group': 'Naya Group',
    'live': 'Live',
    'reconnecting...': 'Dobara jor rahe hain...',
    'search chats or contacts...': 'Chats ya contacts talash karein...',
    'type a message...': 'Message likhein...',
    'add a caption...': 'Caption likhein...',
    'live chat workspace': 'Live Chat Workspace',
    'select any agent from the left to chat directly 1-to-1.': 'Baayein taraf se kisi bhi Agent ko chunein aur seedhi 1-to-1 chat shuru karein.',
    'chat privately with the owner, message your clients 1-to-1, or create a private client group.': 'Owner se private chat karein, apne Clients ko message bhejein, ya private Client Group banayein.',
    'select your agent or a joined group from the left to start chatting.': 'Chat shuru karne ke liye baayein taraf se apna Agent ya Group chunein.',
    'private role-isolated chat': 'Private Role-Protected Chat',
    'messages in this group are private to your agent and group members.': 'Is group ke messages sirf aapke Agent aur members tak mehdood hain.',
    'send your first message below to start the conversation.': 'Baat cheet shuru karne ke liye neeche pehla message bhejein.',
    'only your agent (group admin) can send messages in this group.': 'Is group mein sirf aapka Agent (Group Admin) message bhej sakta hai.',
    'group admin settings': 'Group Admin Settings',
    'group info': 'Group ki Maloomat',
    'group name': 'Group ka Naam',
    'save group info': 'Group Info Save Karein',
    'only admin can send': 'Sirf Admin Message Bhej Sake',
    'restrict clients from sending messages': 'Clients ko message bhejne se rokein',
    'announcement mode (you can change anytime)': 'Announcement mode (kabhi bhi badal sakte hain)',
    'add my clients': 'Apne Clients Shamil Karein',
    'select client to add...': 'Shamil karne ke liye client chunein...',
    'all of your assigned clients are already in this group.': 'Aapke tamam clients pehle se is group mein shamil hain.',
    'delete group': 'Group Delete Karein',
    'delete this group and all its messages permanently?': 'Kya yeh group aur iske tamam messages hamesha ke liye delete kar dein?',
    'yes, delete': 'Haan, Delete Karein',
    'new client group': 'Naya Client Group',
    'create group': 'Group Banayein',
    'agents directory': 'Agents ki Fehrist',
    'start direct chat': 'Seedhi Chat Shuru Karein',
    'your assigned agent': 'Aapka Agent',
    'no messages yet': 'Abhi koi message nahi',
    'online': 'Online',
    'offline': 'Offline',
    'drop photo to send': 'Bhejne ke liye photo yahan chhorein',
    'this message was deleted': 'Yeh message delete kar diya gaya',
    'send photo': 'Photo Bhejein',
    'emoji': 'Emoji',
    'send': 'Bhejein',
    'reply': 'Jawab Dein',
    'pin message': 'Message Pin Karein',
    'unpin': 'Unpin Karein',
    'groups': 'Groups',

    // Notifications UI
    'mark all read': 'Sab Parha Hua Mark Karein',
    'mark all as read': 'Sab Parha Hua Mark Karein',
    'view all notifications': 'Tamam Notifications Dekhein',
    'unread': 'Na-Parhe',
    'no notifications yet': 'Abhi koi notification nahi hai',
    'no notifications': 'Koi notification nahi',
    'search range, term, rate, or message...': 'Range, term, rate ya message talash karein...',

    // Profile & Security UI
    'account information': 'Account ki Maloomat',
    'personal details': 'Zaati Maloomat',
    'change password': 'Password Tabdeel Karein',
    'update password': 'Password Update Karein',
    'two-factor authentication': 'Two-Factor Security (2FA)',
    'two-factor authentication (2fa)': 'Two-Factor Security (2FA)',
    'enable 2fa': '2FA Chalu Karein',
    'disable 2fa': '2FA Band Karein',
    'appearance & theme': 'Rang aur Theme',
    'appearance': 'Appearance',
    'theme mode': 'Theme Mode',
    'light': 'Safed (Light)',
    'dark': 'Kaala (Dark)',
    'system': 'System Default',
    'light mode': 'Light Mode',
    'dark mode': 'Dark Mode',
    'language': 'Zuban (Language)',
    'english': 'English',
    'roman urdu': 'Roman Urdu',
    'loading...': 'Load ho raha hai...',
    'loading audit logs...': 'Audit logs load ho rahe hain...',
    'please wait...': 'Intezar karein...',
    'all ranges': 'Tamam Ranges',
    'all agents': 'Tamam Agents',
    'all clients': 'Tamam Clients',
    'all providers': 'Tamam Providers',
    'all statuses': 'Tamam Haalat',
    'all payterms': 'Tamam Payterms',
    'all services': 'Tamam Services'
  };

  // Ordered dynamic regex rules for parameterized UI strings
  const PATTERN_RULES = [
    [/^Showing\s+(\d[\d,]*)\s+of\s+(\d[\d,]*)\s*(.*)$/i, (_, a, b, rest) => `${b} mein se ${a}${rest ? ' ' + rest : ''} dikha raha hai`],
    [/^Replying to\s+(.+)$/i, (_, who) => `${who} ko jawab de rahe hain`],
    [/^Pinned\s*[·•-]\s*(.+)$/i, (_, who) => `Pin Shuda · ${who}`],
    [/^Members\s*\((\d+)\)$/i, (_, n) => `Members (${n})`],
    [/^Select Your Clients\s*\((\d+)\s+available\)$/i, (_, n) => `Apne Clients Chunein (${n} dastiyab)`],
    [/^(\d+)\s+members$/i, (_, n) => `${n} members`],
    [/^(\d+)\s+online$/i, (_, n) => `${n} online`],
    [/^Search\s+(.+)\.\.\.$/i, (_, what) => `${what} talash karein...`],
    [/^Select\s+(.+)\.\.\.$/i, (_, what) => `${what} chunein...`],
    [/^Enter\s+(.+)$/i, (_, what) => `${what} darj karein`],
    [/^No\s+(.+)\s+found\.?$/i, (_, what) => `Koi ${what} nahi mila`],
    [/^Total\s+(.+)$/i, (_, what) => `Kul ${what}`],
    [/^Pending\s+(.+)$/i, (_, what) => `Pending ${what}`],
    [/^Active\s+(.+)$/i, (_, what) => `Active ${what}`],
    [/^All\s+(.+)$/i, (_, what) => `Tamam ${what}`],
    [/^Switch to Dark Mode$/i, () => 'Dark Mode (Black) Lagayein'],
    [/^Switch to Light Mode$/i, () => 'Light Mode (White) Lagayein']
  ];

  // Tags & selectors whose inner text must NEVER be translated (user data, numbers, messages, code)
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG', 'PATH', 'CANVAS', 'IFRAME', 'TEXTAREA', 'INPUT', 'OPTION']);
  const SKIP_SELECTOR = [
    '[data-no-i18n]',
    '.monospace',
    '.zy-clock',
    '#zy-utc-time',
    '.zy-chat-text',
    '.zy-chat-quote-txt',
    '.zy-chat-row-name',
    '.zy-chat-row-preview',
    '.zy-chat-thread-name',
    '.zy-chat-pinned-txt',
    '.zy-chat-lb-caption',
    '.zy-chat-lb-who',
    '.zy-notif-row-msg',
    '.zy-lang-popover',
    '#topbar-user',
    '#panel-username-side',
    '.zy-badge-name',
    '[contenteditable="true"]'
  ].join(',');

  const ORIG_TEXT = new WeakMap();
  let _currentLang = 'en';
  let _observer = null;
  let _rafScheduled = false;
  let _pendingRoots = new Set();
  let _isMutating = false;

  function getUserLangStorageKey() {
    try {
      const uStr = sessionStorage.getItem('admin_user') || localStorage.getItem('admin_user') || localStorage.getItem('active_session_user');
      if (uStr) {
        const u = JSON.parse(uStr);
        if (u && u.username) {
          const role = String(u.role || sessionStorage.getItem('session_role') || 'user').toLowerCase();
          return `humex_lang_${role}_${String(u.username).toLowerCase()}`;
        }
      }
    } catch (_) {}
    return 'humex_lang_default';
  }

  function detectInitialLang() {
    try {
      // 1. User-scoped localStorage first (instant tab switch)
      const userKey = getUserLangStorageKey();
      const savedPerUser = localStorage.getItem(userKey);
      if (savedPerUser === 'roman_ur' || savedPerUser === 'en') return savedPerUser;
      // 2. Server-injected user preference
      if (window.__USER_THEME__ && (window.__USER_THEME__.language === 'roman_ur' || window.__USER_THEME__.language === 'en')) {
        return window.__USER_THEME__.language;
      }
      // 3. Cached user object
      const uStr = sessionStorage.getItem('admin_user') || localStorage.getItem('admin_user');
      if (uStr) {
        const u = JSON.parse(uStr);
        if (u && (u.language === 'roman_ur' || u.language === 'en')) return u.language;
      }
    } catch (_) {}
    return 'en';
  }

  function isSkippableString(trimmed) {
    if (!trimmed || trimmed.length < 2) return true;
    // Pure numbers, phone numbers, currency, percentages, dates, URLs, emails
    if (/^[\d\s.,:%$€£+\-—–/()#@]+$/.test(trimmed)) return true;
    if (/^(Rs\.?|PKR|USD|EUR|GBP)\s*[\d,.-]+$/i.test(trimmed)) return true;
    if (/^https?:\/\//i.test(trimmed) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return true;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /^\d{1,2}:\d{2}/.test(trimmed)) return true;
    return false;
  }

  function translateString(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    const match = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match) return raw;
    const lead = match[1];
    const core = match[2];
    const trail = match[3];
    if (isSkippableString(core)) return raw;

    const norm = core.replace(/\s+/g, ' ').trim();
    const key = norm.toLowerCase();

    // 1. Exact dictionary match
    if (Object.prototype.hasOwnProperty.call(EXACT_DICT, key)) {
      return lead + EXACT_DICT[key] + trail;
    }

    // 2. Exact match ignoring trailing colon (e.g. "Status:" -> "Haalat:")
    if (key.endsWith(':')) {
      const noColon = key.slice(0, -1).trim();
      if (Object.prototype.hasOwnProperty.call(EXACT_DICT, noColon)) {
        return lead + EXACT_DICT[noColon] + ':' + trail;
      }
    }

    // 3. Pattern rules
    for (let i = 0; i < PATTERN_RULES.length; i++) {
      const [re, repl] = PATTERN_RULES[i];
      const m = norm.match(re);
      if (m) {
        const out = norm.replace(re, repl);
        if (out && out !== norm) return lead + out + trail;
      }
    }

    return raw;
  }

  function shouldSkipElement(el) {
    if (!el || el.nodeType !== 1) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.closest && el.closest(SKIP_SELECTOR)) return true;
    // Skip table data cells (td) unless they contain explicit button/badge/label UI
    if (el.tagName === 'TD' && !el.querySelector('button, .badge, .zy-badge')) {
      // Allow translating short known status pills inside TD, skip arbitrary data
      const txt = (el.textContent || '').trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(EXACT_DICT, txt)) return true;
    }
    return false;
  }

  function processElementAttributes(el, lang) {
    if (!el || el.nodeType !== 1) return;
    if (el.closest && el.closest('.zy-lang-popover, [data-no-i18n]')) return;
    const attrs = ['placeholder', 'title'];
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (!el.hasAttribute(attr)) continue;
      const origAttr = `data-i18n-orig-${attr}`;
      if (lang === 'en') {
        if (el.hasAttribute(origAttr)) {
          const orig = el.getAttribute(origAttr);
          if (el.getAttribute(attr) !== orig) el.setAttribute(attr, orig);
        }
      } else {
        const orig = el.hasAttribute(origAttr) ? el.getAttribute(origAttr) : el.getAttribute(attr);
        if (!el.hasAttribute(origAttr)) el.setAttribute(origAttr, orig);
        const translated = translateString(orig);
        if (translated !== orig && el.getAttribute(attr) !== translated) {
          el.setAttribute(attr, translated);
        }
      }
    }
  }

  function walkAndApply(root, lang) {
    if (!root) return;
    _isMutating = true;
    try {
      if (root.nodeType === 1) {
        processElementAttributes(root, lang);
      }
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        null
      );
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === 1) {
          if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.hasAttribute('title')) {
            processElementAttributes(node, lang);
          }
          continue;
        }
        if (node.nodeType === 3) {
          const parent = node.parentElement;
          if (!parent || shouldSkipElement(parent)) continue;

          if (lang === 'en') {
            if (ORIG_TEXT.has(node)) {
              const orig = ORIG_TEXT.get(node);
              if (node.nodeValue !== orig) node.nodeValue = orig;
            }
          } else {
            const cur = node.nodeValue;
            if (!cur || !cur.trim()) continue;
            let orig = ORIG_TEXT.get(node);
            if (orig === undefined) {
              orig = cur;
              const translated = translateString(orig);
              if (translated !== orig) {
                ORIG_TEXT.set(node, orig);
                node.nodeValue = translated;
              }
            } else {
              // If app script updated text dynamically since last translation, detect fresh English
              const expectedPrev = translateString(orig);
              if (cur !== expectedPrev && cur !== orig) {
                orig = cur;
                ORIG_TEXT.set(node, orig);
              }
              const translated = translateString(orig);
              if (node.nodeValue !== translated) node.nodeValue = translated;
            }
          }
        }
      }
    } finally {
      _isMutating = false;
    }
  }

  function flushPendingTranslations() {
    _rafScheduled = false;
    if (_currentLang !== 'roman_ur') {
      _pendingRoots.clear();
      return;
    }
    const roots = Array.from(_pendingRoots);
    _pendingRoots.clear();
    for (let i = 0; i < roots.length; i++) {
      if (roots[i] && document.contains(roots[i])) {
        walkAndApply(roots[i], 'roman_ur');
      }
    }
  }

  function ensureObserver() {
    if (_observer || typeof MutationObserver === 'undefined') return;
    _observer = new MutationObserver((mutations) => {
      if (_isMutating || _currentLang !== 'roman_ur') return;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'childList') {
          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (n.nodeType === 1) _pendingRoots.add(n);
            else if (n.nodeType === 3 && n.parentElement) _pendingRoots.add(n.parentElement);
          }
        } else if (m.type === 'characterData' && m.target && m.target.parentElement) {
          _pendingRoots.add(m.target.parentElement);
        }
      }
      if (_pendingRoots.size > 0 && !_rafScheduled) {
        _rafScheduled = true;
        requestAnimationFrame(flushPendingTranslations);
      }
    });
    if (document.body) {
      _observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  // ── Header Theme (Half-Moon White/Black) Controls ─────────────
  function getEffectiveThemeMode() {
    const attr = document.documentElement && document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    if (document.body && document.body.classList.contains('dark')) return 'dark';
    return 'light';
  }

  function syncThemeToggleUi() {
    const isDark = getEffectiveThemeMode() === 'dark';
    document.querySelectorAll('#zy-theme-toggle-btn, .zy-theme-toggle-btn').forEach(btn => {
      btn.classList.toggle('is-dark', isDark);
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      const tipEn = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
      const tip = _currentLang === 'roman_ur' ? translateString(tipEn) : tipEn;
      btn.setAttribute('title', tip);
      btn.setAttribute('aria-label', tip);
      // Clean half-moon SVG (left-filled in light, right-flipped warm in dark)
      btn.innerHTML = isDark
        ? `<svg class="zy-halfmoon-svg" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
             <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
             <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>
           </svg>`
        : `<svg class="zy-halfmoon-svg" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
             <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
             <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>
           </svg>`;
    });
  }

  function syncCachedUserPref(patch) {
    try {
      const sRaw = sessionStorage.getItem('admin_user');
      if (sRaw) {
        const u = JSON.parse(sRaw);
        Object.assign(u, patch);
        sessionStorage.setItem('admin_user', JSON.stringify(u));
      }
      const lRaw = localStorage.getItem('admin_user');
      if (lRaw) {
        const u = JSON.parse(lRaw);
        Object.assign(u, patch);
        localStorage.setItem('admin_user', JSON.stringify(u));
      }
      if (window.__USER_THEME__) Object.assign(window.__USER_THEME__, patch);
    } catch (_) {}
  }

  function toggleDarkLight() {
    const isDark = getEffectiveThemeMode() === 'dark';
    const next = isDark ? 'light' : 'dark';
    if (typeof window.setManualThemeOverride === 'function') {
      window.setManualThemeOverride(next);
    } else {
      try {
        const now = new Date();
        const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        localStorage.setItem('theme_manual_override', JSON.stringify({ mode: next, date: todayStr }));
        localStorage.setItem('theme', next);
      } catch (_) {}
    }

    if (typeof window.applyThemePreference === 'function') {
      window.applyThemePreference(next);
    } else {
      if (document.documentElement) document.documentElement.setAttribute('data-theme', next);
      if (document.body) {
        document.body.classList.remove('dark', 'light');
        document.body.classList.add(next, 'rmsui', 'adminui');
      }
    }

    // Keep Profile page theme selector cards in sync if currently mounted
    ['light', 'dark', 'system'].forEach(opt => {
      const el = document.getElementById(`theme-opt-${opt}`);
      if (el) el.classList.toggle('active', opt === next);
    });

    syncCachedUserPref({ theme_mode: next });
    syncThemeToggleUi();

    // Persist per user in backend profile
    try {
      fetch('/api/user/profile/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_mode: next })
      }).catch(() => {});
    } catch (_) {}
  }

  // ── Header Language Switcher Controls ─────────────────────────
  function syncLangUi() {
    const isUr = _currentLang === 'roman_ur';
    if (document.documentElement) {
      document.documentElement.setAttribute('data-lang', _currentLang);
      document.documentElement.setAttribute('lang', isUr ? 'ur-Latn' : 'en');
    }
    const badge = document.getElementById('zy-lang-code');
    if (badge) badge.textContent = isUr ? 'UR' : 'EN';
    const btn = document.getElementById('zy-lang-btn');
    if (btn) {
      btn.classList.toggle('is-ur', isUr);
      btn.setAttribute('title', isUr ? 'Zuban: Roman Urdu (Click to change)' : 'Language: English (Click to change)');
    }
    document.querySelectorAll('.zy-lang-opt').forEach(opt => {
      const active = opt.getAttribute('data-lang-val') === _currentLang;
      opt.classList.toggle('is-active', active);
      opt.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    syncThemeToggleUi();
  }

  function closeLangMenu() {
    const pop = document.getElementById('zy-lang-popover');
    const btn = document.getElementById('zy-lang-btn');
    if (pop) pop.classList.remove('is-open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleLangMenu(ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    const pop = document.getElementById('zy-lang-popover');
    const btn = document.getElementById('zy-lang-btn');
    if (!pop) return;
    // Close notification dropdown if open
    if (window.HumexNotifications && typeof window.HumexNotifications.closeDropdown === 'function') {
      try { window.HumexNotifications.closeDropdown(); } catch (_) {}
    }
    const opening = !pop.classList.contains('is-open');
    pop.classList.toggle('is-open', opening);
    if (btn) btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }

  function setLanguage(lang, opts = {}) {
    const clean = (lang === 'roman_ur') ? 'roman_ur' : 'en';
    _currentLang = clean;

    try {
      const userKey = getUserLangStorageKey();
      localStorage.setItem(userKey, clean);
    } catch (_) {}

    syncCachedUserPref({ language: clean });
    syncLangUi();
    closeLangMenu();

    if (document.body) {
      walkAndApply(document.body, clean);
      if (clean === 'roman_ur') ensureObserver();
    }

    if (!opts.silent) {
      try {
        fetch('/api/user/profile/update', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: clean })
        }).catch(() => {});
      } catch (_) {}

      if (typeof window.toast === 'function') {
        window.toast(
          clean === 'roman_ur' ? 'Zuban Roman Urdu par set ho gayi' : 'Language switched to English',
          'success'
        );
      }
    }
  }

  // Inject header controls automatically if missing, or bind existing ones
  function initHeaderControls() {
    const right = document.querySelector('.zy-head-right');
    if (right && !document.getElementById('zy-theme-toggle-btn')) {
      const bell = right.querySelector('.zy-bell-btn');
      const frag = document.createElement('div');
      frag.className = 'zy-head-tools';
      frag.setAttribute('data-no-i18n', '1');
      frag.innerHTML = `
        <div class="zy-lang-wrap" id="zy-lang-wrap">
          <button type="button" class="zy-hdr-icon-btn zy-hdr-lang-btn" id="zy-lang-btn"
                  aria-label="Language" aria-haspopup="menu" aria-expanded="false" title="Language">
            <i class="fas fa-language" aria-hidden="true"></i>
            <span class="zy-lang-code" id="zy-lang-code">EN</span>
          </button>
          <div class="zy-lang-popover" id="zy-lang-popover" role="menu" aria-label="Select Language">
            <div class="zy-lang-pop-head">Language / Zuban</div>
            <button type="button" class="zy-lang-opt is-active" role="menuitemradio" aria-checked="true" data-lang-val="en">
              <span class="zy-lang-opt-main">
                <span class="zy-lang-opt-tag">EN</span>
                <span class="zy-lang-opt-txt">
                  <strong>English</strong>
                  <small>Default panel language</small>
                </span>
              </span>
              <i class="fas fa-check zy-lang-check" aria-hidden="true"></i>
            </button>
            <button type="button" class="zy-lang-opt" role="menuitemradio" aria-checked="false" data-lang-val="roman_ur">
              <span class="zy-lang-opt-main">
                <span class="zy-lang-opt-tag is-ur">UR</span>
                <span class="zy-lang-opt-txt">
                  <strong>Roman Urdu</strong>
                  <small>Poora panel Roman Urdu mein</small>
                </span>
              </span>
              <i class="fas fa-check zy-lang-check" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <button type="button" class="zy-hdr-icon-btn zy-theme-toggle-btn" id="zy-theme-toggle-btn"
                aria-label="Toggle Dark/Light Theme" aria-pressed="false" title="Toggle Dark/Light Theme">
        </button>
      `;
      if (bell) right.insertBefore(frag, bell);
      else right.appendChild(frag);
    }

    const themeBtn = document.getElementById('zy-theme-toggle-btn');
    if (themeBtn && !themeBtn._zyBound) {
      themeBtn._zyBound = true;
      themeBtn.addEventListener('click', toggleDarkLight);
    }

    const langBtn = document.getElementById('zy-lang-btn');
    if (langBtn && !langBtn._zyBound) {
      langBtn._zyBound = true;
      langBtn.addEventListener('click', toggleLangMenu);
    }

    document.querySelectorAll('.zy-lang-opt').forEach(opt => {
      if (opt._zyBound) return;
      opt._zyBound = true;
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        setLanguage(opt.getAttribute('data-lang-val') || 'en');
      });
    });

    // Sync icon if theme changes from Profile page too
    const origApply = window.applyThemePreference;
    if (typeof origApply === 'function' && !origApply._zyWrapped) {
      const wrapped = function (pref) {
        const res = origApply(pref);
        syncThemeToggleUi();
        return res;
      };
      wrapped._zyWrapped = true;
      window.applyThemePreference = wrapped;
    }

    document.addEventListener('click', (e) => {
      if (!e.target || !e.target.closest('#zy-lang-wrap')) closeLangMenu();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLangMenu();
    });

    _currentLang = detectInitialLang();
    syncLangUi();
    if (_currentLang === 'roman_ur') {
      ensureObserver();
      walkAndApply(document.body, 'roman_ur');
      // Re-pass after async initial dashboard/sidebar renders settle
      setTimeout(() => { if (_currentLang === 'roman_ur') walkAndApply(document.body, 'roman_ur'); }, 400);
      setTimeout(() => { if (_currentLang === 'roman_ur') walkAndApply(document.body, 'roman_ur'); }, 1200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeaderControls);
  } else {
    initHeaderControls();
  }

  window.HumexI18n = {
    getLanguage: () => _currentLang,
    setLanguage,
    translate: translateString,
    applyNow: () => { if (document.body) walkAndApply(document.body, _currentLang); }
  };

  window.HumexHeaderTools = {
    toggleDarkLight,
    toggleLangMenu,
    closeLangMenu,
    setLanguage,
    syncThemeToggleUi
  };
})();
