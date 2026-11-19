(function () {
  'use strict';

  var cfg = window.__PROD_GUARD__;
  if (!cfg || !cfg.enabled) return;

  // 1. Silence browser console methods in production
  try {
    var noop = function () {};
    var methods = ['log', 'info', 'debug', 'warn', 'table', 'dir', 'dirxml', 'trace', 'group', 'groupCollapsed', 'groupEnd'];
    if (window.console) {
      for (var i = 0; i < methods.length; i++) {
        try { window.console[methods[i]] = noop; } catch (_) {}
      }
      try { if (typeof window.console.clear === 'function') window.console.clear(); } catch (_) {}
    }
  } catch (_) {}

  // Helper: allow normal copy/paste context menu inside editable inputs only
  function isEditableTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // 2. Block right-click Inspect (allow inside inputs/textareas for usability)
  document.addEventListener('contextmenu', function (e) {
    if (!isEditableTarget(e.target)) {
      e.preventDefault();
      return false;
    }
  }, true);

  // 3. Block DevTools & View-Source keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    var key = String(e.key || '').toUpperCase();
    var code = e.keyCode || e.which || 0;
    var ctrlOrMeta = !!(e.ctrlKey || e.metaKey);

    // F12
    if (key === 'F12' || code === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+Shift+I / J / C  or  Cmd+Option+I / J / C
    if ((e.ctrlKey && e.shiftKey && (key === 'I' || key === 'J' || key === 'C')) ||
        (e.metaKey && e.altKey && (key === 'I' || key === 'J' || key === 'C' || key === 'U'))) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+U (View Source) or Ctrl+S (Save HTML)
    if (ctrlOrMeta && !e.shiftKey && !e.altKey && (key === 'U' || key === 'S')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  // 4. Desktop DevTools Docked-Panel Shield (safe on mobile & iframes)
  var shieldEl = null;
  function ensureShield() {
    if (shieldEl && document.body && document.body.contains(shieldEl)) return shieldEl;
    shieldEl = document.createElement('div');
    shieldEl.id = 'hx-sec-shield';
    shieldEl.setAttribute('role', 'alert');
    shieldEl.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'background:rgba(15,23,42,0.97)',
      'backdrop-filter:blur(18px)',
      '-webkit-backdrop-filter:blur(18px)',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'text-align:center',
      'padding:24px',
      'color:#f8fafc',
      'font-family:Inter,Roboto,-apple-system,BlinkMacSystemFont,sans-serif',
      'user-select:none'
    ].join(';');
    shieldEl.innerHTML =
      '<div style="max-width:400px;background:#1e293b;border:1px solid #334155;border-radius:14px;padding:28px 24px;box-shadow:0 20px 50px rgba(0,0,0,0.45);">' +
        '<div style="width:48px;height:48px;margin:0 auto 14px;border-radius:12px;background:rgba(239,68,68,0.14);border:1px solid rgba(239,68,68,0.35);display:flex;align-items:center;justify-content:center;color:#f87171;font-size:20px;">&#128274;</div>' +
        '<div style="font-size:16px;font-weight:700;letter-spacing:-0.2px;margin-bottom:8px;color:#ffffff;">Developer Tools Restricted</div>' +
        '<div style="font-size:13px;line-height:1.55;color:#cbd5e1;">Inspecting this workspace is disabled for security. Please close Developer Tools to continue.</div>' +
      '</div>';
    if (document.body) {
      document.body.appendChild(shieldEl);
    }
    return shieldEl;
  }

  function removeShield() {
    if (shieldEl && shieldEl.parentNode) {
      shieldEl.parentNode.removeChild(shieldEl);
    }
  }

  function isDesktopTopWindow() {
    try {
      if (window.top !== window.self) return false;
      if (window.matchMedia && !window.matchMedia('(pointer: fine)').matches) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  var consecutiveHits = 0;
  function checkDevTools() {
    if (!isDesktopTopWindow()) return;
    if (!document.body) return;
    var wDiff = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
    var hDiff = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
    var open = (window.outerWidth > 320 && window.innerWidth > 200) && (wDiff > 190 || hDiff > 190);
    if (open) {
      consecutiveHits++;
      if (consecutiveHits >= 2) {
        ensureShield();
      }
    } else {
      consecutiveHits = 0;
      removeShield();
    }
  }

  setInterval(checkDevTools, 700);
  window.addEventListener('resize', checkDevTools);
})();
