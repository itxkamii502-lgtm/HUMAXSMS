/* ═══════════════════════════════════════════════════════════════════
   HUMEX SMS / Unified Role-Based Brand & Theme Engine
   Synchronizes semantic CSS tokens (--theme-*) across Owner, Agent,
   Client & Login portals with crisp white/slate cards, unified action
   buttons, Owner-published catalog, and per-user Profile selection.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function (str) {
      if (str === null || str === undefined) return '';
      return String(str).replace(/[&<>"']/g, function (m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
      });
    };
  }

  /* ── Built-in Starter Role Themes (Mirrors server.js) ─────────────── */
  const DEFAULT_ROLE_THEMES = [
    {
      key: 'cobalt_emerald',
      name: 'Royal Blue & Emerald',
      description: 'Clean white surfaces, Royal Blue primary actions & Emerald Green accents with locked neutral ink',
      is_builtin: true,
      structure_tone: 'light',
      structure_bg: '#ffffff',
      structure_side_bg: '#ffffff',
      structure_text: '#0f172a',
      structure_muted: '#64748b',
      structure_item_bg: '#f8fafc',
      structure_item_hover: '#eff6ff',
      structure_border: '#e2e8f0',
      structure_table_bg: '#f1f5f9',
      structure_table_text: '#334155',
      primary_btn: '#1d4ed8',
      primary_btn_hover: '#1e40af',
      primary_btn_text: '#ffffff',
      warning_btn: '#d97706',
      warning_btn_hover: '#b45309',
      warning_btn_text: '#ffffff',
      danger_btn: '#dc2626',
      danger_btn_hover: '#b91c1c'
    },
    {
      key: 'daylight_cobalt',
      name: 'Daylight Crisp & Cobalt',
      description: 'White header & sidebar, Slate table headers, Cobalt buttons, Amber exports',
      is_builtin: true,
      structure_tone: 'light',
      structure_bg: '#ffffff',
      structure_side_bg: '#ffffff',
      structure_text: '#0f172a',
      structure_muted: '#64748b',
      structure_item_bg: '#f1f5f9',
      structure_item_hover: '#eff6ff',
      structure_border: '#e2e8f0',
      structure_table_bg: '#f1f5f9',
      structure_table_text: '#334155',
      primary_btn: '#2563eb',
      primary_btn_hover: '#1d4ed8',
      primary_btn_text: '#ffffff',
      warning_btn: '#d97706',
      warning_btn_hover: '#b45309',
      warning_btn_text: '#ffffff',
      danger_btn: '#dc2626',
      danger_btn_hover: '#b91c1c'
    },
    {
      key: 'emerald_executive',
      name: 'Emerald Executive',
      description: 'Forest Emerald header & sidebar, crisp white cards, Pine primary actions',
      is_builtin: true,
      structure_tone: 'dark',
      structure_bg: '#064e3b',
      structure_side_bg: '#064e3b',
      structure_text: '#ffffff',
      structure_muted: '#a7f3d0',
      structure_item_bg: 'rgba(255, 255, 255, 0.08)',
      structure_item_hover: 'rgba(255, 255, 255, 0.16)',
      structure_border: '#047857',
      structure_table_bg: '#065f46',
      structure_table_text: '#ffffff',
      primary_btn: '#059669',
      primary_btn_hover: '#047857',
      primary_btn_text: '#ffffff',
      warning_btn: '#d97706',
      warning_btn_hover: '#b45309',
      warning_btn_text: '#ffffff',
      danger_btn: '#dc2626',
      danger_btn_hover: '#b91c1c'
    },
    {
      key: 'midnight_navy',
      name: 'Midnight Navy Command',
      description: 'Deep Navy frame & table headers, white workspace cards, Electric Blue CTAs',
      is_builtin: true,
      structure_tone: 'dark',
      structure_bg: '#0f172a',
      structure_side_bg: '#0f172a',
      structure_text: '#ffffff',
      structure_muted: '#94a3b8',
      structure_item_bg: 'rgba(255, 255, 255, 0.07)',
      structure_item_hover: 'rgba(255, 255, 255, 0.15)',
      structure_border: '#1e293b',
      structure_table_bg: '#1e293b',
      structure_table_text: '#f8fafc',
      primary_btn: '#2563eb',
      primary_btn_hover: '#1d4ed8',
      primary_btn_text: '#ffffff',
      warning_btn: '#d97706',
      warning_btn_hover: '#b45309',
      warning_btn_text: '#ffffff',
      danger_btn: '#dc2626',
      danger_btn_hover: '#b91c1c'
    },
    {
      key: 'teal_meridian',
      name: 'Teal Meridian',
      description: 'Ocean Teal structure frame, Jade table headers, Teal action buttons',
      is_builtin: true,
      structure_tone: 'dark',
      structure_bg: '#134e4a',
      structure_side_bg: '#134e4a',
      structure_text: '#ffffff',
      structure_muted: '#99f6e4',
      structure_item_bg: 'rgba(255, 255, 255, 0.08)',
      structure_item_hover: 'rgba(255, 255, 255, 0.16)',
      structure_border: '#115e59',
      structure_table_bg: '#115e59',
      structure_table_text: '#ffffff',
      primary_btn: '#0d9488',
      primary_btn_hover: '#0f766e',
      primary_btn_text: '#ffffff',
      warning_btn: '#d97706',
      warning_btn_hover: '#b45309',
      warning_btn_text: '#ffffff',
      danger_btn: '#dc2626',
      danger_btn_hover: '#b91c1c'
    },
    {
      key: 'indigo_command',
      name: 'Indigo Command',
      description: 'Royal Indigo frame & table headers, white cards, Vivid Indigo buttons',
      is_builtin: true,
      structure_tone: 'dark',
      structure_bg: '#1e1b4b',
      structure_side_bg: '#1e1b4b',
      structure_text: '#ffffff',
      structure_muted: '#c7d2fe',
      structure_item_bg: 'rgba(255, 255, 255, 0.08)',
      structure_item_hover: 'rgba(255, 255, 255, 0.16)',
      structure_border: '#312e81',
      structure_table_bg: '#312e81',
      structure_table_text: '#ffffff',
      primary_btn: '#4f46e5',
      primary_btn_hover: '#4338ca',
      primary_btn_text: '#ffffff',
      warning_btn: '#d97706',
      warning_btn_hover: '#b45309',
      warning_btn_text: '#ffffff',
      danger_btn: '#dc2626',
      danger_btn_hover: '#b91c1c'
    }
  ];

  const FONT_DEFS = {
    inter: {
      family: "'Inter', sans-serif",
      url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
    },
    poppins: {
      family: "'Poppins', sans-serif",
      url: 'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap'
    },
    roboto: {
      family: "'Roboto', sans-serif",
      url: 'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'
    },
    outfit: {
      family: "'Outfit', sans-serif",
      url: 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap'
    },
    montserrat: {
      family: "'Montserrat', sans-serif",
      url: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap'
    },
    opensans: {
      family: "'Open Sans', sans-serif",
      url: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap'
    },
    jakarta: {
      family: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      url: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'
    },
    system: {
      family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      url: null
    },
    monospace: {
      family: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      url: null
    }
  };

  /* ── Color & Contrast Utilities ───────────────────────────────────── */
  function normalizeHexColor(hex, fallback = '#2563eb') {
    if (typeof hex !== 'string') return fallback;
    let s = hex.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
  }

  function hexToRgb(hex) {
    const clean = normalizeHexColor(hex, '#2563eb').slice(1);
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }

  function hexLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const chan = [r, g, b].map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  }

  function contrastRatio(hexA, hexB) {
    const l1 = hexLuminance(hexA);
    const l2 = hexLuminance(hexB);
    const bright = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return Number(((bright + 0.05) / (dark + 0.05)).toFixed(2));
  }

  function autoContrastText(hex) {
    return hexLuminance(hex) > 0.36 ? '#0f172a' : '#ffffff';
  }

  function shadeHex(hex, amount = -0.14) {
    const { r, g, b } = hexToRgb(hex);
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    const adj = c => (amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
    return '#' + [clamp(adj(r)), clamp(adj(g)), clamp(adj(b))]
      .map(n => n.toString(16).padStart(2, '0'))
      .join('');
  }

  function hexToRgba(hex, alpha = 0.2) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function buildCompleteRoleTheme(input = {}, isBuiltin = false) {
    const structBg = normalizeHexColor(input.structure_bg || input.structureBg, '#0f172a');
    const isLightStruct = hexLuminance(structBg) > 0.36;
    const tone = isLightStruct ? 'light' : 'dark';
    const primaryBtn = normalizeHexColor(input.primary_btn || input.primaryBtn, '#2563eb');
    const warningBtn = normalizeHexColor(input.warning_btn || input.warningBtn, '#d97706');
    const dangerBtn = normalizeHexColor(input.danger_btn || input.dangerBtn, '#dc2626');
    const structTableBg = normalizeHexColor(
      input.structure_table_bg || input.structureTableBg,
      isLightStruct ? '#f1f5f9' : shadeHex(structBg, 0.06)
    );
    const cleanKey = String(input.key || ('custom_' + Date.now()))
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || ('custom_' + Date.now());

    return {
      key: cleanKey,
      name: String(input.name || cleanKey).trim().slice(0, 80),
      description: String(input.description || input.desc || `${structBg} frame · ${primaryBtn} CTA · ${warningBtn} warn`).trim().slice(0, 140),
      is_builtin: Boolean(isBuiltin || input.is_builtin),
      structure_tone: tone,
      structure_bg: structBg,
      structure_side_bg: normalizeHexColor(input.structure_side_bg, structBg),
      structure_text: input.structure_text || (isLightStruct ? '#0f172a' : '#ffffff'),
      structure_muted: input.structure_muted || (isLightStruct ? '#64748b' : 'rgba(255, 255, 255, 0.72)'),
      structure_item_bg: input.structure_item_bg || (isLightStruct ? '#f1f5f9' : 'rgba(255, 255, 255, 0.08)'),
      structure_item_hover: input.structure_item_hover || (isLightStruct ? hexToRgba(primaryBtn, 0.1) : 'rgba(255, 255, 255, 0.16)'),
      structure_border: input.structure_border || (isLightStruct ? '#e2e8f0' : shadeHex(structBg, 0.12)),
      structure_table_bg: structTableBg,
      structure_table_text: input.structure_table_text || (hexLuminance(structTableBg) > 0.36 ? '#334155' : '#ffffff'),
      primary_btn: primaryBtn,
      primary_btn_hover: input.primary_btn_hover ? normalizeHexColor(input.primary_btn_hover, shadeHex(primaryBtn, -0.14)) : shadeHex(primaryBtn, -0.14),
      primary_btn_text: autoContrastText(primaryBtn),
      warning_btn: warningBtn,
      warning_btn_hover: input.warning_btn_hover ? normalizeHexColor(input.warning_btn_hover, shadeHex(warningBtn, -0.14)) : shadeHex(warningBtn, -0.14),
      warning_btn_text: autoContrastText(warningBtn),
      danger_btn: dangerBtn,
      danger_btn_hover: input.danger_btn_hover ? normalizeHexColor(input.danger_btn_hover, shadeHex(dangerBtn, -0.14)) : shadeHex(dangerBtn, -0.14)
    };
  }

  /* ── Universal Dark / Light / System Display Mode Controller ──────── */
  (function initHumexTheme() {
    function getThemePref() {
      try {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
        const ut = window.__USER_THEME__;
        if (ut && (ut.theme_mode === 'dark' || ut.theme_mode === 'light' || ut.theme_mode === 'system')) {
          return ut.theme_mode;
        }
        const user = window._currentUser || window.CURRENT_USER || window._user;
        if (user && (user.theme_mode === 'dark' || user.theme_mode === 'light' || user.theme_mode === 'system')) {
          return user.theme_mode;
        }
        if (window.__BRAND_SETTINGS__ && (window.__BRAND_SETTINGS__.theme_mode === 'dark' || window.__BRAND_SETTINGS__.theme_mode === 'light')) {
          return window.__BRAND_SETTINGS__.theme_mode;
        }
      } catch (e) {}
      return 'light';
    }

    function applyTheme(pref) {
      const choice = pref || getThemePref();
      let effective = choice;
      if (choice === 'system') {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        effective = prefersDark ? 'dark' : 'light';
      }
      if (document.documentElement) document.documentElement.setAttribute('data-theme', effective);
      if (document.body) {
        document.body.classList.remove('dark', 'light');
        document.body.classList.add(effective, 'rmsui', 'adminui');
      }
      return effective;
    }

    window.toggleTheme = function () {
      const cur = (document.documentElement && document.documentElement.getAttribute('data-theme')) ||
        (document.body && document.body.classList.contains('dark') ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', next); } catch (e) {}
      applyTheme(next);
    };
    window.applyThemePreference = applyTheme;
    window.getThemePreference = getThemePref;

    if (window.matchMedia) {
      try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          if (getThemePref() === 'system') applyTheme('system');
        });
      } catch (e) {}
    }

    applyTheme();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => applyTheme());
    }
  })();

  const DEFAULT_PRIMARY_SETTINGS = {
    site_name: 'HUMAX SMS',
    logo_url: '/static/img/humex-sms-logo.png',
    default_theme_key: 'cobalt_emerald',
    theme_mode: 'light',
    font_family: 'jakarta',
    custom_themes: [],
    theme_catalog: DEFAULT_ROLE_THEMES
  };

  let _currentSettings = { ...DEFAULT_PRIMARY_SETTINGS };
  let _userThemeKey = '';
  let _previewThemeOverride = null;

  try {
    if (window.__BRAND_SETTINGS__ && typeof window.__BRAND_SETTINGS__ === 'object') {
      _currentSettings = { ..._currentSettings, ...window.__BRAND_SETTINGS__ };
    } else {
      const cached = localStorage.getItem('app_brand_settings');
      if (cached) _currentSettings = { ..._currentSettings, ...JSON.parse(cached) };
    }
    if (window.__USER_THEME__ && window.__USER_THEME__.theme_key) {
      _userThemeKey = String(window.__USER_THEME__.theme_key);
    } else {
      const cachedUser = JSON.parse(sessionStorage.getItem('admin_user') || localStorage.getItem('admin_user') || '{}');
      if (cachedUser && cachedUser.theme_key) _userThemeKey = String(cachedUser.theme_key);
    }
  } catch (e) {}

  function getThemes(settingsOverride) {
    const s = settingsOverride || _currentSettings || {};
    const builtins = DEFAULT_ROLE_THEMES.map(t => buildCompleteRoleTheme(t, true));
    const byKey = new Map();
    builtins.forEach(t => byKey.set(t.key, t));

    if (Array.isArray(s.theme_catalog) && s.theme_catalog.length) {
      s.theme_catalog.forEach(t => {
        if (!t || !t.key) return;
        const built = buildCompleteRoleTheme(t, byKey.has(t.key) ? byKey.get(t.key).is_builtin : Boolean(t.is_builtin));
        byKey.set(built.key, built);
      });
    }
    if (Array.isArray(s.custom_themes)) {
      s.custom_themes.forEach(ct => {
        if (!ct || !ct.key) return;
        const built = buildCompleteRoleTheme(ct, byKey.has(ct.key) ? byKey.get(ct.key).is_builtin : false);
        byKey.set(built.key, built);
      });
    }
    return Array.from(byKey.values());
  }

  function resolveEffectiveTheme(settingsOverride, explicitTheme) {
    if (explicitTheme && typeof explicitTheme === 'object') {
      return buildCompleteRoleTheme(explicitTheme, Boolean(explicitTheme.is_builtin));
    }
    const s = settingsOverride || _currentSettings || {};
    const catalog = getThemes(s);
    const byKey = new Map(catalog.map(t => [t.key, t]));
    const defKey = (s.default_theme_key && byKey.has(s.default_theme_key)) ? s.default_theme_key : 'cobalt_emerald';
    const picked = (_userThemeKey && _userThemeKey !== 'default' && byKey.has(_userThemeKey)) ? _userThemeKey : defKey;
    return byKey.get(picked) || catalog[0];
  }

  function getActiveThemeKey() {
    const catalog = getThemes();
    if (_userThemeKey && _userThemeKey !== 'default' && catalog.some(t => t.key === _userThemeKey)) {
      return _userThemeKey;
    }
    return '';
  }

  function loadGoogleFont(fontKey) {
    const def = FONT_DEFS[fontKey] || FONT_DEFS.jakarta;
    if (def.url) {
      const linkId = 'dynamic-google-font-' + fontKey;
      if (!document.getElementById(linkId)) {
        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = def.url;
        document.head.appendChild(link);
      }
    }
    return def.family;
  }

  function setUserTheme(themeKey, themeMode) {
    const cleanKey = (themeKey && themeKey !== 'default') ? String(themeKey).trim() : '';
    _userThemeKey = cleanKey;
    window.__USER_THEME__ = {
      ...(window.__USER_THEME__ || {}),
      theme_key: cleanKey,
      ...(themeMode ? { theme_mode: themeMode } : {})
    };
    if (themeMode && (themeMode === 'light' || themeMode === 'dark' || themeMode === 'system')) {
      try {
        if (!localStorage.getItem('theme')) localStorage.setItem('theme', themeMode);
      } catch (e) {}
      if (typeof window.applyThemePreference === 'function') {
        window.applyThemePreference(themeMode);
      }
    }
    _previewThemeOverride = null;
    applyBrandTheme(_currentSettings);
  }

  function previewRoleTheme(themeOrKey) {
    if (!themeOrKey) {
      _previewThemeOverride = null;
      applyBrandTheme(_currentSettings);
      return;
    }
    if (typeof themeOrKey === 'string') {
      const found = getThemes().find(t => t.key === themeOrKey);
      if (found) {
        _previewThemeOverride = found;
        applyBrandTheme(_currentSettings, found);
      }
      return;
    }
    if (typeof themeOrKey === 'object') {
      _previewThemeOverride = buildCompleteRoleTheme(themeOrKey, Boolean(themeOrKey.is_builtin));
      applyBrandTheme(_currentSettings, _previewThemeOverride);
    }
  }

  function applyBrandTheme(settings, previewThemeOverride) {
    if (settings && typeof settings === 'object') {
      _currentSettings = { ..._currentSettings, ...settings };
      try {
        localStorage.setItem('app_brand_settings', JSON.stringify(_currentSettings));
      } catch (e) {}
    }

    const activeOverride = previewThemeOverride !== undefined ? previewThemeOverride : _previewThemeOverride;
    const theme = resolveEffectiveTheme(_currentSettings, activeOverride);

    const siteName = _currentSettings.site_name || 'HUMAX SMS';
    const logoUrl = _currentSettings.logo_url || '/static/img/humex-sms-logo.png';
    const fontKey = _currentSettings.font_family || 'jakarta';
    const fontFamily = loadGoogleFont(fontKey);

    const isLightChrome = theme.structure_tone === 'light';
    const itemText = isLightChrome ? '#334155' : theme.structure_text;
    const subText = isLightChrome ? '#475569' : theme.structure_muted;
    const ctrlBg = isLightChrome ? '#f8fafc' : 'rgba(255, 255, 255, 0.14)';
    const ctrlBorder = isLightChrome ? '#cbd5e1' : 'rgba(255, 255, 255, 0.25)';

    if (document.documentElement) {
      document.documentElement.setAttribute('data-chrome-tone', theme.structure_tone || 'light');
      document.documentElement.setAttribute('data-role-theme', theme.key || 'cobalt_emerald');
    }

    // 1. Update Document Title
    const curTitle = document.title || '';
    if (curTitle.includes('—') || curTitle.includes('|')) {
      const sep = curTitle.includes('—') ? ' — ' : ' | ';
      const parts = curTitle.split(sep);
      document.title = parts[0].trim() + sep + siteName;
    } else {
      document.title = curTitle.replace(/HUMEX SMS|HUMAX SMS/g, siteName) || siteName;
    }

    // 2. Update Favicon
    let icon = document.querySelector("link[rel*='icon']");
    if (!icon && document.head) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    if (icon) icon.href = logoUrl;

    // 3. Apply CSS Variables synchronously on :root
    try {
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--app-font', fontFamily);
      rootStyle.setProperty('--theme-struct-bg', theme.structure_bg);
      rootStyle.setProperty('--theme-struct-side-bg', theme.structure_side_bg);
      rootStyle.setProperty('--theme-struct-text', theme.structure_text);
      rootStyle.setProperty('--theme-struct-muted', theme.structure_muted);
      rootStyle.setProperty('--theme-struct-item-bg', theme.structure_item_bg);
      rootStyle.setProperty('--theme-struct-item-hover', theme.structure_item_hover);
      rootStyle.setProperty('--theme-struct-item-text', itemText);
      rootStyle.setProperty('--theme-struct-sub-text', subText);
      rootStyle.setProperty('--theme-struct-border', theme.structure_border);
      rootStyle.setProperty('--theme-struct-table-bg', theme.structure_table_bg);
      rootStyle.setProperty('--theme-struct-table-text', theme.structure_table_text);
      rootStyle.setProperty('--theme-struct-ctrl-bg', ctrlBg);
      rootStyle.setProperty('--theme-struct-ctrl-border', ctrlBorder);
      rootStyle.setProperty('--theme-btn-primary', theme.primary_btn);
      rootStyle.setProperty('--theme-btn-primary-hover', theme.primary_btn_hover);
      rootStyle.setProperty('--theme-btn-primary-text', theme.primary_btn_text);
      rootStyle.setProperty('--theme-btn-primary-tint', hexToRgba(theme.primary_btn, 0.10));
      rootStyle.setProperty('--theme-accent-blue', '#1d4ed8');
      rootStyle.setProperty('--theme-accent-blue-hover', '#1e40af');
      rootStyle.setProperty('--theme-accent-blue-tint', 'rgba(29, 78, 216, 0.10)');
      rootStyle.setProperty('--theme-accent-green', '#059669');
      rootStyle.setProperty('--theme-accent-green-hover', '#047857');
      rootStyle.setProperty('--theme-accent-green-tint', 'rgba(5, 150, 105, 0.10)');
      rootStyle.setProperty('--theme-btn-warn', theme.warning_btn);
      rootStyle.setProperty('--theme-btn-warn-hover', theme.warning_btn_hover);
      rootStyle.setProperty('--theme-btn-warn-text', theme.warning_btn_text);
      rootStyle.setProperty('--theme-btn-danger', theme.danger_btn);
      rootStyle.setProperty('--theme-btn-danger-hover', theme.danger_btn_hover);
      rootStyle.setProperty('--theme-focus-ring', hexToRgba(theme.primary_btn, 0.22));
      rootStyle.setProperty('--brand-primary', theme.primary_btn);
      rootStyle.setProperty('--brand-hover', theme.primary_btn_hover);
      rootStyle.setProperty('--brand-accent', '#059669');
      rootStyle.setProperty('--brand-glow', hexToRgba(theme.primary_btn, 0.24));
      rootStyle.setProperty('--sp-primary', theme.primary_btn);
      rootStyle.setProperty('--sp-primary-hover', theme.primary_btn_hover);
      rootStyle.setProperty('--sp-primary-contrast', theme.primary_btn_text);
      rootStyle.setProperty('--sp-success', '#059669');
      rootStyle.setProperty('--sp-warning', theme.warning_btn);
      rootStyle.setProperty('--sp-danger', theme.danger_btn);
      rootStyle.setProperty('--sp-danger-hover', theme.danger_btn_hover);
      rootStyle.setProperty('--sp-focus-ring', hexToRgba(theme.primary_btn, 0.22));
      rootStyle.setProperty('--header-gradient', theme.structure_bg);
      rootStyle.setProperty('--header-text-color', theme.structure_text);
    } catch (e) {}

    // Update dark-mode adaptation rules (clear inline root overrides when dark mode active on light chrome)
    const isDarkDisplay = document.documentElement?.getAttribute('data-theme') === 'dark' || document.body?.classList.contains('dark');
    if (isLightChrome && isDarkDisplay) {
      try {
        const rs = document.documentElement.style;
        rs.setProperty('--theme-struct-bg', '#0f172a');
        rs.setProperty('--theme-struct-side-bg', '#131c2e');
        rs.setProperty('--theme-struct-text', '#f8fafc');
        rs.setProperty('--theme-struct-muted', '#94a3b8');
        rs.setProperty('--theme-struct-item-bg', '#1e293b');
        rs.setProperty('--theme-struct-item-hover', '#24334a');
        rs.setProperty('--theme-struct-item-text', '#e2e8f0');
        rs.setProperty('--theme-struct-sub-text', '#cbd5e1');
        rs.setProperty('--theme-struct-border', '#26354a');
        rs.setProperty('--theme-struct-table-bg', '#1e293b');
        rs.setProperty('--theme-struct-table-text', '#e2e8f0');
        rs.setProperty('--theme-struct-ctrl-bg', '#1e293b');
        rs.setProperty('--theme-struct-ctrl-border', '#334155');
      } catch (e) {}
    }

    let styleTag = document.getElementById('dynamic-brand-styles');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'dynamic-brand-styles';
      (document.head || document.documentElement).appendChild(styleTag);
    }

    styleTag.textContent = `
      body, button, input, select, textarea, .card, .dt, .zy-sidenav, .page-title, h1, h2, h3, h4 {
        font-family: ${fontFamily} !important;
      }
      .zy-logo img, .zy-head-title img, .zy-badge-logo {
        height: 32px !important;
        width: auto !important;
        max-width: 140px !important;
        object-fit: contain !important;
        display: inline-block !important;
        vertical-align: middle !important;
      }
      .brand-logo-img {
        width: auto !important;
        height: auto !important;
        max-width: 220px !important;
        max-height: 115px !important;
        object-fit: contain !important;
        display: block !important;
        margin: 0 auto !important;
      }
      .zy-panel-badge {
        font-size: 15px !important;
        font-weight: 700 !important;
        color: var(--theme-struct-text) !important;
        letter-spacing: -0.01em !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 8px !important;
      }
      .zy-panel-badge .zy-badge-name {
        color: var(--theme-struct-text) !important;
        font-weight: 700 !important;
      }
      body.rmsui .stat-value, .stat-value, .zy-strip-txt i, .zy-circle-txt b {
        color: var(--sp-text-primary, #0f172a) !important;
      }
      .zy-strip-up, .tpui .zy-tile-on span {
        color: var(--theme-accent-green, #059669) !important;
      }
      .stat-card-ims.blue {
        background: linear-gradient(135deg, #1d4ed8, #1e40af) !important;
        color: #ffffff !important;
      }
      .stat-card-ims.green {
        background: linear-gradient(135deg, #059669, #047857) !important;
        color: #ffffff !important;
      }
      .zy-gentoken {
        background: var(--theme-btn-primary) !important;
        border-color: var(--theme-btn-primary) !important;
        color: var(--theme-btn-primary-text) !important;
      }
      .logo-circle {
        border-color: var(--theme-btn-primary) !important;
        box-shadow: 0 8px 30px var(--brand-glow) !important;
      }
      .captcha-box input:focus, .input-group input:focus {
        border-color: var(--theme-btn-primary) !important;
        box-shadow: 0 0 0 3px var(--theme-focus-ring) !important;
      }

      /* ── Universal Responsive Layout (PC vs Mobile) ── */
      @media (max-width: 991px) {
        .settings-two-col, body.rmsui .settings-two-col {
          display: flex !important;
          flex-direction: column !important;
          width: 100% !important;
          gap: 18px !important;
        }
        .settings-sticky-card {
          position: static !important;
          top: auto !important;
          width: 100% !important;
        }
        .settings-subgrid-2 {
          grid-template-columns: 1fr !important;
          gap: 10px !important;
        }
        .two-col, .two-col-panel, .three-col, .form-row,
        body.rmsui .two-col, body.rmsui .two-col-panel, body.rmsui .three-col,
        .adminui .zy-dash-panels, .adminui .zy-dash-mid {
          display: flex !important;
          flex-direction: column !important;
          width: 100% !important;
          gap: 16px !important;
        }
        .stats-grid, body.rmsui .stats-grid, .adminui .zy-strips {
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 12px !important;
        }
        .charts-grid { grid-template-columns: 1fr !important; }
        .page-content {
          padding: 14px 10px !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        .zy-body { padding: 12px 8px !important; }
        .card, body.rmsui .card {
          padding: 14px 12px !important;
          margin-bottom: 14px !important;
          box-sizing: border-box !important;
          width: 100% !important;
        }
        .card-header, body.rmsui .card-header {
          margin: -14px -12px 14px !important;
          padding: 10px 12px !important;
        }
        .table-wrap, .zy-dt-wrap, body.rmsui .table-wrap, body.rmsui .zy-dt-wrap {
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
          width: 100% !important;
          display: block !important;
          border-radius: 6px !important;
        }
        table.zy-dt, table.zy-dt2-table, .table-wrap > table, .zy-dt-wrap > table, table.data-table {
          min-width: 520px;
        }
        #modal table, .zy-modal table, .modal table, .modal-box table, .zy-modal-body table {
          min-width: 0 !important;
          width: 100% !important;
        }
        .modal, #modal.zy-modal {
          width: calc(100% - 20px) !important;
          max-width: 100% !important;
          margin: 10px auto !important;
          max-height: 90vh !important;
          overflow-y: auto !important;
        }
        .page-header {
          flex-direction: column !important;
          align-items: flex-start !important;
          gap: 10px !important;
          margin-bottom: 16px !important;
        }
        .page-actions {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 8px !important;
          align-items: center !important;
          justify-content: flex-start !important;
          width: auto !important;
        }
        .zy-logo img, .zy-head-title img, .zy-badge-logo {
          height: 26px !important;
          max-width: 110px !important;
        }
      }
      @media (max-width: 768px) {
        .stats-grid, body.rmsui .stats-grid,
        .stat-grid, .kpi-grid, .sp-kpi-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          display: grid !important;
          gap: 8px 10px !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        .stat-card, body.rmsui .stat-card, .stat-card-ims {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
          padding: 8px 10px !important;
          min-height: 56px !important;
          border-radius: 8px !important;
          overflow: hidden !important;
        }
        .zy-filterbar {
          grid-template-columns: 1fr !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 8px !important;
          padding: 10px 10px 18px !important;
        }
      }
    `;

    // 4. Update Images / Logos across page
    const logoImgs = document.querySelectorAll('#zy-side-logo, #login-logo-img, .brand-logo-img, .zy-badge-logo, .zy-avatar-lg img, .zy-ava img, .zy-ava-dp-img, .logo-circle img, #preview-bar-logo, #logo-preview-img');
    logoImgs.forEach(img => {
      if (img && img.src !== logoUrl) {
        img.src = logoUrl;
        img.alt = siteName;
      }
    });

    document.querySelectorAll('.zy-avatar-lg, .zy-ava, .adminui .zy-user .zy-ava, .zy-avatar-circle').forEach(av => {
      av.style.backgroundColor = '#ffffff';
      let img = av.querySelector('img');
      if (!img) {
        av.innerHTML = `<img src="${logoUrl}" class="zy-ava-dp-img" alt="${window.escapeHtml(siteName)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;background-color:#ffffff;">`;
      } else {
        img.style.backgroundColor = '#ffffff';
        if (img.src !== logoUrl) {
          img.src = logoUrl;
          img.alt = siteName;
        }
      }
    });

    // 5. Update Header Panel Name & Logo
    const headerLogoContainer = document.getElementById('zy-logo');
    if (headerLogoContainer) {
      headerLogoContainer.innerHTML = `<span class="zy-panel-badge"><img class="zy-badge-logo" src="${logoUrl}" alt="${window.escapeHtml(siteName)}" onerror="this.style.display='none';"> <span class="zy-badge-name">${window.escapeHtml(siteName)}</span></span>`;
      headerLogoContainer.onclick = null;
      headerLogoContainer.style.cursor = 'default';
    }

    document.querySelectorAll('.zy-badge-name, .brand-name, .app-name, .site-name, [data-brand="site-name"]').forEach(el => {
      el.textContent = siteName;
    });

    document.querySelectorAll('.zy-panel-badge').forEach(badge => {
      const nameEl = badge.querySelector('.zy-badge-name');
      if (nameEl) {
        nameEl.textContent = siteName;
      } else {
        badge.innerHTML = `<img class="zy-badge-logo" src="${logoUrl}" alt="${window.escapeHtml(siteName)}" onerror="this.style.display='none';"> <span class="zy-badge-name">${window.escapeHtml(siteName)}</span>`;
      }
    });

    document.querySelectorAll('.inv-footer').forEach(inv => {
      inv.textContent = `Generated by ${siteName} Panel · System-generated payout invoice.`;
    });

    const loginHeaderP = document.querySelector('.login-header p');
    if (loginHeaderP) {
      loginHeaderP.textContent = `Sign in to your ${siteName} account`;
    }

    const footers = document.querySelectorAll('.zy-footer, .footer, .login-footer');
    footers.forEach(f => {
      f.textContent = _currentSettings.footer_text || `© ${new Date().getFullYear()} ${siteName}. All rights reserved.`;
    });

    // 6. Initialize Mobile Drawer & Sidebar Controls
    initSidebarDrawer();

    // 7. Propagate to parent/child iframes
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'BRAND_THEME_UPDATE', settings: _currentSettings }, '*');
      }
      document.querySelectorAll('iframe').forEach(f => {
        try { f.contentWindow.postMessage({ type: 'BRAND_THEME_UPDATE', settings: _currentSettings }, '*'); } catch (_) {}
      });
    } catch (_) {}
  }

  /* ── Universal Mobile Drawer & Desktop Sidebar Controller ─────────── */
  function initSidebarDrawer() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    let backdrop = document.getElementById('zy-side-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'zy-side-backdrop';
      backdrop.className = 'zy-side-backdrop';
      backdrop.setAttribute('aria-label', 'Close sidebar backdrop');
      backdrop.addEventListener('click', zyCloseSidebar);
      document.body.appendChild(backdrop);
    }

    const sideHead = sidebar.querySelector('.zy-side-head');
    if (sideHead && !sidebar.querySelector('.zy-side-close')) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'zy-side-close';
      closeBtn.type = 'button';
      closeBtn.innerHTML = '<i class="fas fa-times"></i>';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.setAttribute('title', 'Close');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        zyCloseSidebar();
      });
      sideHead.appendChild(closeBtn);
    }

    const headRow = document.querySelector('.zy-header-row');
    if (headRow) {
      let headLeft = headRow.querySelector('.zy-head-left');
      if (!headLeft) {
        headLeft = document.createElement('div');
        headLeft.className = 'zy-head-left';
        const logoEl = headRow.querySelector('#zy-logo, .zy-head-title');
        if (logoEl) {
          headRow.insertBefore(headLeft, logoEl);
          headLeft.appendChild(logoEl);
        } else {
          headRow.prepend(headLeft);
        }
      }
      if (!headLeft.querySelector('.zy-side-toggle')) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'zy-side-toggle';
        toggleBtn.type = 'button';
        toggleBtn.title = 'Toggle Sidebar';
        toggleBtn.setAttribute('aria-label', 'Toggle Sidebar');
        toggleBtn.innerHTML = '<i class="fas fa-bars"></i>';
        toggleBtn.onclick = function (e) {
          e.stopPropagation();
          zyToggleSidebar();
        };
        headLeft.prepend(toggleBtn);
      }
    }

    if (!sidebar.dataset.zyDrawerBound) {
      sidebar.dataset.zyDrawerBound = '1';
      sidebar.addEventListener('click', (e) => {
        const item = e.target.closest('.zy-snav, .zy-ssub div, a');
        if (item && window.innerWidth < 992) {
          const isExpander = item.hasAttribute('aria-controls') ||
            (item.hasAttribute('onclick') && (item.getAttribute('onclick').includes('zyToggleGroup') || item.getAttribute('onclick').includes('zySideSub')));
          if (!isExpander) {
            setTimeout(zyCloseSidebar, 120);
          }
        }
      });
    }
  }

  function zyToggleSidebar() {
    if (window.innerWidth < 992) {
      if (document.body.classList.contains('sidebar-open')) {
        zyCloseSidebar();
      } else {
        zyOpenSidebar();
      }
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
  }

  function zyOpenSidebar() {
    document.body.classList.add('sidebar-open');
    const side = document.getElementById('sidebar');
    if (side) side.classList.add('mobile-open');
    const bd = document.getElementById('zy-side-backdrop');
    if (bd) bd.classList.add('active');
  }

  function zyCloseSidebar() {
    document.body.classList.remove('sidebar-open');
    const side = document.getElementById('sidebar');
    if (side) side.classList.remove('mobile-open');
    const bd = document.getElementById('zy-side-backdrop');
    if (bd) bd.classList.remove('active');
  }

  window.zyToggleSidebar = zyToggleSidebar;
  window.zyCloseSidebar = zyCloseSidebar;
  window.zyOpenSidebar = zyOpenSidebar;
  window.zyToggleMenu = zyToggleSidebar;
  window.toggleSidebar = zyToggleSidebar;

  window.zySwitchPanelRole = function (role) {
    if (window.HumexAuth && typeof window.HumexAuth.switchRole === 'function') {
      window.HumexAuth.switchRole(role);
      return;
    }
    const routes = { owner: '/', agent: '/agent', client: '/client' };
    window.location.href = routes[role] || '/';
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
      zyCloseSidebar();
    }
  });

  let touchStartX = 0;
  let touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (e.changedTouches && e.changedTouches.length === 1) {
      const diffX = e.changedTouches[0].clientX - touchStartX;
      const diffY = Math.abs(e.changedTouches[0].clientY - touchStartY);
      if (document.body.classList.contains('sidebar-open') && diffX < -60 && diffY < 60) {
        zyCloseSidebar();
      }
    }
  }, { passive: true });

  // Re-evaluate dark/light surface overrides whenever display mode toggles
  const _origApplyPref = window.applyThemePreference;
  if (typeof _origApplyPref === 'function') {
    window.applyThemePreference = function (pref) {
      const res = _origApplyPref(pref);
      applyBrandTheme(_currentSettings);
      return res;
    };
  }

  // Initial synchronous execution
  applyBrandTheme(_currentSettings);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initSidebarDrawer();
      applyBrandTheme(_currentSettings);
      fetchLiveSettings();
    });
  } else {
    initSidebarDrawer();
    fetchLiveSettings();
  }

  // Cross-tab & Cross-frame sync
  window.addEventListener('storage', (e) => {
    if (e.key === 'app_brand_settings' && e.newValue) {
      try {
        applyBrandTheme(JSON.parse(e.newValue));
      } catch (err) {}
    } else if (e.key === 'theme' && e.newValue) {
      if (typeof window.applyThemePreference === 'function') {
        window.applyThemePreference(e.newValue);
      }
    }
  });

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'BRAND_THEME_UPDATE' && e.data.settings) {
      applyBrandTheme(e.data.settings);
    }
  });

  // Real-time WebSocket listener for immediate instant propagation across all tabs
  (function initBrandRealtimeSync() {
    try {
      if (typeof window === 'undefined' || !window.WebSocket) return;
      const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = wsProto + '//' + location.host + '/ws/live-traffic';
      let brandWs = null;

      function connect() {
        try {
          brandWs = new WebSocket(wsUrl);
          brandWs.onmessage = function (ev) {
            try {
              const payload = JSON.parse(ev.data);
              if (payload && (payload.type === 'brand_theme_updated' || payload.type === 'brand_updated' || payload.type === 'settings_updated')) {
                const newSettings = payload.settings || payload.data;
                if (newSettings && typeof newSettings === 'object') {
                  applyBrandTheme(newSettings);
                }
              }
            } catch (err) {}
          };
          brandWs.onclose = function () { setTimeout(connect, 6000); };
          brandWs.onerror = function () { try { brandWs.close(); } catch (_) {} };
        } catch (_) {}
      }

      setTimeout(connect, 1200);
    } catch (e) {}
  })();

  async function fetchLiveSettings() {
    try {
      const res = await fetch('/api/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          applyBrandTheme(data);
        }
      }
    } catch (e) {
      console.warn('BrandTheme live fetch failed:', e);
    }
  }

  function zySideSub(id, trigger) {
    if (typeof window.zyToggleGroup === 'function') {
      return window.zyToggleGroup(id || trigger);
    }
  }
  window.zySideSub = window.zyToggleGroup || zySideSub;

  window.BrandTheme = {
    apply: applyBrandTheme,
    applyBrand: applyBrandTheme,
    preview: previewRoleTheme,
    getSettings: () => ({ ..._currentSettings }),
    getThemes: getThemes,
    getActiveThemeKey: getActiveThemeKey,
    getEffectiveTheme: () => resolveEffectiveTheme(_currentSettings, _previewThemeOverride),
    setUserTheme: setUserTheme,
    buildRoleTheme: buildCompleteRoleTheme,
    contrastRatio: contrastRatio,
    autoContrastText: autoContrastText,
    defaultThemes: DEFAULT_ROLE_THEMES,
    fonts: FONT_DEFS,
    reload: fetchLiveSettings
  };
})();
