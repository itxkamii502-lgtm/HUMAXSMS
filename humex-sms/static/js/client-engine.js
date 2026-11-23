/* ═══════════════════════════════════════════════
   HUMEX SMS — Client Panel Core Engine
   ═══════════════════════════════════════════════ */

const API = '';
let CLIENT_ID = null;
let CLIENT_USER = {};

// ── Auth guard ────────────────────────────────────────────────────
(function init() {
  try {
    if (window.HumexAuth) {
      if (!window.HumexAuth.enforce(['Client'])) return;
    } else {
      if (sessionStorage.getItem('admin_logged_in') !== '1') {
        try {
          if (window.top && window.top !== window) {
            window.top.location.replace('/ints/login');
            return;
          }
        } catch (e) {}
        window.location.replace('/ints/login');
        return;
      }
      const checkU = JSON.parse(sessionStorage.getItem('admin_user') || '{}');
      if (!['Client'].includes(checkU.role)) {
        window.location.replace('/ints/login');
        return;
      }
    }
    CLIENT_USER = JSON.parse(sessionStorage.getItem('admin_user') || localStorage.getItem('admin_user') || '{}');
    CLIENT_ID = CLIENT_USER.id;

    const uEl = document.getElementById('panel-username-side') || document.getElementById('client-username');
    if (uEl) uEl.textContent = CLIENT_USER.username || 'Client';
    const sub = document.getElementById('client-name-sub');
    if (sub) sub.textContent = 'Client Panel';
  } catch (err) {
    console.error('Auth init error:', err);
    try {
      if (window.top && window.top !== window) {
        window.top.location.replace('/ints/login');
        return;
      }
    } catch (e) {}
    window.location.replace('/ints/login');
  }
})();

function getAuthToken() {
  return '';
}

// ── API Helpers ──────────────────────────────────────────────────
async function apiFetch(path, opts = {}, retries = 2) {
  try {
    const isFormData = typeof FormData !== 'undefined' && opts && opts.body instanceof FormData;
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      'X-Client-ID': CLIENT_ID || '',
      ...(opts.headers || {})
    };
    if (isFormData) {
      delete headers['Content-Type'];
      delete headers['content-type'];
    }
    const { headers: _h, ...restOpts } = opts || {};
    const response = await fetch(API + path, {
      credentials: 'include',
      ...restOpts,
      headers
    });

    if (response.status === 401) {
      console.warn(`[AUTH] 401 Unauthorized for ${path}. Redirecting to login.`);
      if (typeof window !== 'undefined' && !path.includes('/auth/login') && !path.includes('/auth/me')) {
        try {
          sessionStorage.removeItem('admin_logged_in');
          sessionStorage.removeItem('admin_user');
          sessionStorage.removeItem('session_token');
          localStorage.removeItem('admin_logged_in');
          localStorage.removeItem('session_token');
          localStorage.removeItem('active_session_active');
        } catch (_) {}
        if (window.HumexAuth && typeof window.HumexAuth.clearSession === 'function') {
          window.HumexAuth.clearSession();
        } else {
          window.location.replace('/ints/login');
        }
      }
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText);
        detail = parsed.error || parsed.detail || parsed.message || errorText;
      } catch (e) {}
      const cleanMsg = typeof window.zyHumanizeError === 'function'
        ? window.zyHumanizeError(detail, response.status)
        : detail;
      throw new Error(cleanMsg);
    }

    const data = await response.json();
    if (data && data.error && !('success' in data)) {
      const cleanMsg = typeof window.zyHumanizeError === 'function'
        ? window.zyHumanizeError(data.error)
        : data.error;
      throw new Error(cleanMsg);
    }
    return data;
  } catch (err) {
    if (retries > 0 && (err.name === 'TypeError' || String(err.message).toLowerCase().includes('failed to fetch'))) {
      await new Promise(r => setTimeout(r, 350));
      return apiFetch(path, opts, retries - 1);
    }
    if (!opts.silent) {
      const cleanMsg = typeof window.zyHumanizeError === 'function'
        ? window.zyHumanizeError(err.message || err)
        : (err.message || 'Connection error. Please try again.');
      console.error(`apiFetch error [${path}]:`, err);
      toast(cleanMsg, 'error');
    }
    return null;
  }
}

// ── Toast System ──────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${msg}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, 4000);
}

// ── Modal System (Explicit Close Only — Never Dismisses on Outside Click) ──
function openModal(title, html) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  if (!overlay || !titleEl || !bodyEl) return;

  if (typeof title === 'string' && title.includes('<')) {
    titleEl.innerHTML = title;
  } else {
    titleEl.textContent = title;
  }
  bodyEl.innerHTML = html;
  overlay.classList.add('show');
  document.body.classList.add('zy-modal-open');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.classList.remove('modal-lg');
  if (overlay) {
    overlay.classList.remove('show', 'active');
    overlay.style.display = '';
  }
  document.body.classList.remove('zy-modal-open');
}

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && typeof window.zyNudgeModal === 'function') {
        window.zyNudgeModal(document.getElementById('modal'));
      }
    });
  }
});

// ── UI Helpers ────────────────────────────────────────────────────
function badge(text, color = 'blue') {
  const validColors = ['green', 'red', 'yellow', 'blue', 'purple', 'gray', 'cyan'];
  const c = validColors.includes(color) ? color : 'blue';
  return `<span class="badge badge-${c}">${text}</span>`;
}

function statusBadge(status) {
  const map = {
    active: 'green',
    suspended: 'red',
    inactive: 'gray',
    paid: 'green',
    pending: 'yellow',
    rejected: 'red',
    delivered: 'green',
    failed: 'red'
  };
  return badge(status, map[status] || 'blue');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '—';
  }
}

function fmtShort(iso) {
  if (!iso) return '—';
  if (typeof window.zyFormatShortTime === 'function') {
    return window.zyFormatShortTime(iso);
  }
  if (typeof window.zyFormatUtc === 'function') {
    try {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return window.zyFormatUtc(d);
    } catch (_) {}
  }
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

let _clTblCounter = 0;
function buildTable(headers, rows, options = {}) {
  const tableId = typeof options === 'string' ? options : (options && options.id ? options.id : ('tbl-cl-' + (++_clTblCounter)));
  const thead = headers.map(h => `<th>${h}</th>`).join('');
  let tbody;
  if (rows && rows.length) {
    tbody = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  } else {
    tbody = `<tr><td colspan="${headers.length}" class="empty-state"><i class="fas fa-inbox"></i><br>No data</td></tr>`;
  }
  const showToolbar = (options && options.toolbar !== false && (options.toolbar === true || options.id || typeof options === 'string'));
  const toolbarHtml = (showToolbar && typeof window.zyRenderTableToolbar === 'function')
    ? window.zyRenderTableToolbar(tableId, { title: (options && options.title) || '' })
    : '';
  return `${toolbarHtml}<div class="table-wrap"><table id="${tableId}" data-table-id="${tableId}"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

function statCard(label, icon, value, color, sub = '', trend = 'up') {
  const safeLabel = String(label || '').replace(/"/g, '&quot;');
  const safeVal = String(value ?? '').replace(/"/g, '&quot;');
  const safeSub = String(sub || '').replace(/"/g, '&quot;');
  return `<div class="stat-card stat-card-ims ${color}">
    <div class="stat-label" title="${safeLabel}">${label}</div>
    <div class="stat-value" title="${safeVal}">${value}</div>
    ${sub ? `<div class="stat-change" title="${safeSub}">${sub}</div>` : ''}
    <div class="stat-icon-corner"><i class="fas fa-arrow-${trend === 'down' ? 'down' : 'up'}"></i></div>
  </div>`;
}

function chartOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#656d76', font: { size: 10 }, maxTicksLimit: 8 }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#656d76', font: { size: 10 } }
      }
    }
  };
}

function serviceColor(service) {
  const map = {
    WhatsApp: '#25d366',
    Telegram: '#2aabee',
    Google: '#4285f4',
    Amazon: '#ff9900',
    Facebook: '#1877f2',
    Twitter: '#1da1f2',
    Instagram: '#e1306c'
  };
  return map[service] || '#334155';
}

// ── Pagination ────────────────────────────────────────────────────
function pagination(current, total, perPage, onPage) {
  const pages = Math.ceil(total / perPage) || 1;
  window._pgnCb = onPage;

  const info = `Showing ${Math.min((current - 1) * perPage + 1, total)}–${Math.min(current * perPage, total)} of ${total}`;
  const first = `<button class="pg-text" onclick="window._pgnCb(1)" ${current <= 1 ? 'disabled' : ''}>First</button>`;
  const prev = `<button class="pg-text" onclick="window._pgnCb(${current - 1})" ${current <= 1 ? 'disabled' : ''}>Previous</button>`;
  const next = `<button class="pg-text" onclick="window._pgnCb(${current + 1})" ${current >= pages ? 'disabled' : ''}>Next</button>`;
  const last = `<button class="pg-text" onclick="window._pgnCb(${pages})" ${current >= pages ? 'disabled' : ''}>Last</button>`;

  let nums = '';
  const start = Math.max(1, current - 2);
  const end = Math.min(pages, current + 2);
  for (let p = start; p <= end; p++) {
    nums += `<button class="${p === current ? 'active' : ''}" onclick="window._pgnCb(${p})">${p}</button>`;
  }

  return `<div class="pagination"><span class="pg-info">${info}</span>${first}${prev}${nums}${next}${last}</div>`;
}

// ── Theme ─────────────────────────────────────────────────────────
function toggleTheme() {
  const cur = (document.documentElement && document.documentElement.getAttribute('data-theme')) ||
    (document.body && document.body.classList.contains('dark') ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  if (typeof window.setManualThemeOverride === 'function') {
    window.setManualThemeOverride(next);
  } else {
    try { localStorage.setItem('theme', next); } catch {}
  }
  if (typeof window.applyThemePreference === 'function') {
    window.applyThemePreference(next);
  } else {
    if (document.documentElement) document.documentElement.setAttribute('data-theme', next);
    if (document.body) {
      document.body.classList.remove('dark', 'light');
      document.body.classList.add(next);
    }
  }
}

(function initTheme() {
  try {
    if (typeof window.applyThemePreference === 'function') {
      window.applyThemePreference();
    }
  } catch {}
})();

// ── Sidebar ───────────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const wrapper = document.querySelector('.main-wrapper');
  if (!sidebar) return;
  if (window.innerWidth < 992) {
    sidebar.classList.toggle('open');
  } else {
    sidebar.classList.remove('collapsed');
    if (wrapper) wrapper.classList.remove('sidebar-collapsed');
  }
}

function toggleGroup(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('closed');
  const header = el.previousElementSibling;
  if (header) {
    const icon = header.querySelector('i');
    if (icon) {
      icon.style.transform = el.classList.contains('closed') ? 'rotate(-90deg)' : '';
    }
  }
}

// ── Logout ────────────────────────────────────────────────────────
function doLogout() {
  if (window.HumexAuth) {
    window.HumexAuth.clearSession();
    return;
  }
  try {
    ['admin_logged_in', 'admin_user', 'active_session_active', 'active_session_role', 'admin_current_page', 'agent_current_page', 'client_current_page'].forEach(k => {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
    sessionStorage.clear();
  } catch (e) {}
  try {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
  } catch (e) {}
  try {
    if (window.top && window.top !== window) {
      window.top.location.replace('/ints/login');
      return;
    }
  } catch (e) {}
  window.location.replace('/ints/login');
}

// ── Router ────────────────────────────────────────────────────────
let activeWS = [];

function stopWS() {
  activeWS.forEach(ws => {
    try { ws.close(); } catch (e) {}
  });
  activeWS = [];
}

function loadPage(page) {
  stopWS();
  if (window._dbClockInterval) { clearInterval(window._dbClockInterval); window._dbClockInterval = null; }
  sessionStorage.setItem('client_current_page', page);

  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  const navEl = document.getElementById(`nav-${page}`);
  if (navEl) navEl.classList.add('active');

  const label = navEl ? navEl.querySelector('span')?.textContent || page : page;
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = label;

  const content = document.getElementById('page-content');
  if (content) {
    content.innerHTML = `<div class="empty-state"><i class="fas fa-circle-exclamation"></i><p>Page not found</p></div>`;
  }
}

// ── Auto-logout after 10 minutes of inactivity ──────────────────────
let _idleTimer = null;
const IDLE_LIMIT_MS = 10 * 60 * 1000;
function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(autoLogoutIdle, IDLE_LIMIT_MS);
}
function autoLogoutIdle() {
  if (window.HumexAuth && typeof window.HumexAuth.clearSession === 'function') {
    window.HumexAuth.clearSession();
    return;
  }
  try {
    sessionStorage.removeItem('admin_logged_in');
    sessionStorage.removeItem('admin_user');
    sessionStorage.removeItem('client_current_page');
  } catch (e) {}
  try {
    if (window.top && window.top !== window) {
      window.top.location.replace('/ints/login');
      return;
    }
  } catch (e) {}
  window.location.replace('/ints/login');
}
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
  document.addEventListener(evt, resetIdleTimer, { passive: true });
});
resetIdleTimer();

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const lastPage = sessionStorage.getItem('client_current_page') || 'dashboard';
  loadPage(lastPage);
});