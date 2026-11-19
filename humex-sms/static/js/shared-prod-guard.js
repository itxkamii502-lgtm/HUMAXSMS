(function () {
  'use strict';

  // Ensure any legacy fullscreen shield from cached sessions is immediately removed
  try {
    var oldShield = document.getElementById('hx-sec-shield');
    if (oldShield && oldShield.parentNode) oldShield.parentNode.removeChild(oldShield);
  } catch (_) {}

  var cfg = window.__PROD_GUARD__;
  if (!cfg || !cfg.enabled) return;

  // Non-intrusive production console silencing only (never blocks login, zoom, or viewport)
  try {
    var noop = function () {};
    var methods = ['log', 'info', 'debug', 'warn', 'table', 'dir', 'dirxml', 'trace', 'group', 'groupCollapsed', 'groupEnd'];
    if (window.console) {
      for (var i = 0; i < methods.length; i++) {
        try { window.console[methods[i]] = noop; } catch (_) {}
      }
    }
  } catch (_) {}
})();
