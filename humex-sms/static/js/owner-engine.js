/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Main Application (Production Ready v4.0)
   ═══════════════════════════════════════════════════════════════ */

const API = '';  // same origin

// ── Auth guard ────────────────────────────────────────────────────
(function initUser() {
  try {
    if (window.HumexAuth) {
      if (!window.HumexAuth.enforce(['Owner', 'Admin'])) return;
    } else {
      if (sessionStorage.getItem('admin_logged_in') !== '1') {
        try {
          if (window.top && window.top !== window) {
            window.top.location.href = '/login';
            return;
          }
        } catch (e) {}
        window.location.href = '/login';
        return;
      }
      const checkU = JSON.parse(sessionStorage.getItem('admin_user') || '{}');
      if (!['Admin', 'Owner'].includes(checkU.role)) {
        sessionStorage.removeItem('admin_logged_in');
        sessionStorage.removeItem('admin_user');
        window.location.href = '/login';
        return;
      }
    }
    const u = JSON.parse(sessionStorage.getItem('admin_user') || localStorage.getItem('admin_user') || '{}');
    const el = document.getElementById('topbar-user');
    const roleSub = document.getElementById('brand-role');
    if (roleSub) roleSub.textContent = (u.role === 'Admin' || u.role === 'Owner') ? 'Owner Panel' : ((u.role || 'User') + ' Account');
    if (el && u.username) {
      const roleColor = {
        Owner: 'purple',
        Admin: 'purple',
        Agent: 'cyan',
        Client: 'green',
        User: 'gray'
      };
      const displayRole = (u.role === 'Admin' || u.role === 'Owner') ? 'Owner' : u.role;
      el.innerHTML = `<i class="fas fa-crown" style="color:#e0a030;"></i><span>${escapeHtml(u.username)}</span>
        <span class="badge badge-${roleColor[displayRole] || 'purple'}" style="font-size:10px;">${escapeHtml(displayRole)}</span>`;
    }
  } catch (e) {}
})();

function getAuthToken() {
  return '';
}

// ── API Helpers ──────────────────────────────────────────────────
async function apiFetch(path, opts = {}, retries = 2) {
  try {
    const response = await fetch(API + path, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      },
      ...opts
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
      } catch (e) {
        if (typeof detail === 'string' && detail.trim().startsWith('<')) {
          detail = `HTTP ${response.status}: ${response.statusText || 'Request failed'}`;
        }
      }
      throw new Error(detail);
    }

    const data = await response.json();
    if (data && data.error && !('success' in data)) {
      throw new Error(data.error);
    }
    return data;
  } catch (err) {
    if (retries > 0 && (err.name === 'TypeError' || String(err.message).toLowerCase().includes('failed to fetch'))) {
      await new Promise(r => setTimeout(r, 350));
      return apiFetch(path, opts, retries - 1);
    }
    if (!opts.silent) {
      console.warn(`apiFetch [${path}]:`, err.message || err);
      toast(err.message || 'Network error', 'error');
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

// ── Real-Time Username Uniqueness Checker ─────────────────────────
window.setupUsernameAvailabilityCheck = function(inputId, feedbackId, submitBtnId, table = 'users', excludeId = null) {
  const input = document.getElementById(inputId);
  const feedback = document.getElementById(feedbackId);
  const btn = document.getElementById(submitBtnId);
  if (!input) return;

  let timer = null;
  const check = async () => {
    const val = input.value.trim();
    if (!val) {
      if (feedback) feedback.innerHTML = '';
      input.style.borderColor = '';
      if (btn) btn.disabled = false;
      return;
    }
    try {
      const q = `/api/check-username?username=${encodeURIComponent(val)}${excludeId ? `&exclude_id=${excludeId}` : ''}${table ? `&table=${table}` : ''}`;
      const token = getAuthToken();
      const headers = token ? { 'Authorization': `Bearer ${token}`, 'X-Session-Token': token } : {};
      const res = await fetch(q, { headers, credentials: 'include' });
      const data = await res.json();
      if (data.exists) {
        if (feedback) {
          feedback.innerHTML = `<span style="color:#ef4444;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;"><i class="fas fa-exclamation-circle"></i> This username already exists</span>`;
        }
        input.style.borderColor = '#ef4444';
        if (btn) btn.disabled = true;
      } else {
        if (feedback) {
          feedback.innerHTML = `<span style="color:#10b981;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;"><i class="fas fa-check-circle"></i> Username is available</span>`;
        }
        input.style.borderColor = '#10b981';
        if (btn) btn.disabled = false;
      }
    } catch (_) {}
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(check, 200);
  });
  input.addEventListener('blur', check);
  if (input.value && input.value.trim()) {
    check();
  }
};

// ── Modal System ──────────────────────────────────────────────────
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
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.classList.remove('modal-lg');
  if (window._logoCropper) {
    try { window._logoCropper.destroy(); } catch(e){}
    window._logoCropper = null;
  }
  if (overlay) overlay.classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }
});

// ── UI Helpers ────────────────────────────────────────────────────
function badge(text, color = 'blue') {
  const validColors = ['green', 'red', 'yellow', 'blue', 'purple', 'gray', 'cyan', 'black'];
  const c = validColors.includes(color) ? color : 'blue';
  return `<span class="badge badge-${c}">${text}</span>`;
}

function statusBadge(s) {
  const map = {
    active: 'green', connected: 'green', delivered: 'green', paid: 'green',
    approved: 'green', completed: 'green', inactive: 'gray',
    disconnected: 'gray', idle: 'gray', pending: 'yellow',
    blocked: 'red', failed: 'red', rejected: 'red', suspended: 'red',
    connecting: 'yellow', assigned: 'blue'
  };
  return badge(s, map[s] || 'blue');
}

function roleBadge(r) {
  const map = {
    Owner: 'purple',
    Admin: 'purple',
    Agent: 'cyan',
    Client: 'green',
    User: 'gray'
  };
  const displayRole = (r === 'Admin' || r === 'Owner') ? 'Owner' : r;
  return badge(displayRole, map[displayRole] || 'blue');
}

function formatCleanDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      return String(iso).replace('T', ' ').replace('Z', '').split('.')[0];
    }
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (_) {
    return String(iso).replace('T', ' ').replace('Z', '').split('.')[0] || '—';
  }
}

function fmtDate(iso) {
  return formatCleanDate(iso);
}

function fmtShort(iso) {
  return formatCleanDate(iso);
}
window.formatCleanDate = formatCleanDate;
window.fmtDate = fmtDate;
window.fmtShort = fmtShort;

// ─── SHARED PERSISTENT TABS ───────────────────────────────────────
function renderManagementTabs(activeTab = 'agents') {
  return `
    <div class="tabs" style="margin-bottom:16px;display:flex;gap:8px;border-bottom:1px solid var(--border);padding-bottom:12px;overflow-x:auto;">
      <button class="btn ${activeTab === 'agents' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderAdminAgents()"><i class="fas fa-user-secret"></i> Agents</button>
      <button class="btn ${activeTab === 'clients' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderAdminClients()"><i class="fas fa-user-group"></i> Clients</button>
      <button class="btn ${activeTab === 'hierarchy' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderHierarchy()"><i class="fas fa-sitemap"></i> Hierarchy Tree</button>
      <button class="btn ${activeTab === 'all' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderUsers(1)"><i class="fas fa-users"></i> All Accounts</button>
    </div>
  `;
}

function renderApiWebhooksTabs(activeTab = 'webhook') {
  return `
    <div class="tabs" style="margin-bottom:16px;display:flex;gap:8px;border-bottom:1px solid var(--border);padding-bottom:12px;overflow-x:auto;">
      <button class="btn ${activeTab === 'webhook' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderWebhookConfig()"><i class="fas fa-share-nodes"></i> Webhook Settings</button>
      <button class="btn ${activeTab === 'mapping' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderFieldMapping()"><i class="fas fa-layer-group"></i> Field Mapping Guide</button>
      <button class="btn ${activeTab === 'simulator' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderLiveTest()"><i class="fas fa-paper-plane"></i> Live Test Simulator</button>
      <button class="btn ${activeTab === 'playground' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderApiPlayground()"><i class="fas fa-terminal"></i> API Playground</button>
      <button class="btn ${activeTab === 'tokens' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderApiTokens()"><i class="fas fa-key"></i> API Tokens</button>
      <button class="btn ${activeTab === 'docs' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderDocumentation()"><i class="fas fa-book"></i> Documentation</button>
    </div>
  `;
}

function renderSecurityTabs(activeTab = 'firewall') {
  return `
    <div class="tabs" style="margin-bottom:16px;display:flex;gap:8px;border-bottom:1px solid var(--border);padding-bottom:12px;overflow-x:auto;">
      <button class="btn ${activeTab === 'audit-logs' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="loadPage('audit-logs')"><i class="fas fa-clipboard-list"></i> Audit Logs</button>
      <button class="btn ${activeTab === 'login-activity' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="loadPage('login-activity')"><i class="fas fa-clock-rotate-left"></i> Login Activity</button>
      <button class="btn ${activeTab === 'firewall' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="loadPage('firewall-dashboard')"><i class="fas fa-shield-halved"></i> Security &amp; Firewall</button>
      <button class="btn ${activeTab === 'ratelimits' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="loadPage('rate-limits')"><i class="fas fa-lock"></i> Rate Limits</button>
      <button class="btn ${activeTab === 'permissions' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="loadPage('permissions')"><i class="fas fa-user-lock"></i> Permissions</button>
    </div>
  `;
}

function renderOwnerHubTabs(hub, activePage) {
  const hubs = {
    numbers: [
      ['my-numbers', 'fa-mobile-screen', 'My Numbers'],
      ['bulk-allocation', 'fa-diagram-project', 'Bulk Allocation'],
      ['revoke-numbers', 'fa-rotate-left', 'Revoke Numbers']
    ],
    upload: [
      ['upload-numbers', 'fa-cloud-arrow-up', 'Import to Range'],
      ['bulk-range-import', 'fa-layer-group', 'Bulk Range Import'],
      ['blacklist-management', 'fa-ban', 'Blacklist']
    ],
    history: [
      ['allocation-history', 'fa-clock-rotate-left', 'Allocation History'],
      ['number-transfers-log', 'fa-right-left', 'Transfer History']
    ],
    cdr: [
      ['my-sms', 'fa-table-list', 'All CDR Reports'],
      ['cdr2', 'fa-tower-cell', 'CDR 2 (Whitenoise)'],
      ['failed-sms', 'fa-triangle-exclamation', 'Failed SMS']
    ],
    live: [
      ['live-otp-feed', 'fa-tower-broadcast', 'Live OTP Feed'],
      ['live-traffic', 'fa-wave-square', 'Live Traffic MPS']
    ],
    analytics: [
      ['sms-analytics', 'fa-chart-line', 'SMS Analytics'],
      ['profit-stats', 'fa-coins', 'Profit Stats'],
      ['business-reports', 'fa-briefcase', 'Business Reports']
    ],
    smpp: [
      ['smpp-dashboard', 'fa-gauge-high', 'SMPP Overview'],
      ['smpp-sessions', 'fa-plug', 'SMPP Sessions'],
      ['connected-clients', 'fa-users-viewfinder', 'Connected Clients'],
      ['dlr-monitor', 'fa-check-double', 'DLR Monitor'],
      ['throughput-monitor', 'fa-tachograph-digital', 'Throughput'],
      ['connection-logs', 'fa-file-shield', 'Connection Logs'],
      ['smpp-security', 'fa-shield-halved', 'SMPP Security']
    ],
    providers: [
      ['smpp-accounts', 'fa-server', 'SMPP Accounts'],
      ['login-panels', 'fa-arrow-right-to-bracket', 'Login Panels'],
      ['cr-api-panels', 'fa-link', 'CR API Panels'],
      ['whitenoise-panels', 'fa-tower-cell', 'Whitenoise API']
    ],
    finance: [
      ['payout-requests', 'fa-hand-holding-dollar', 'Payout Requests'],
      ['statements', 'fa-file-invoice-dollar', 'Statements (USD/EUR/GBP)'],
      ['credit-notes', 'fa-receipt', 'Credit Notes'],
      ['account-balances', 'fa-wallet', 'Account Balances'],
      ['my-payouts', 'fa-sack-dollar', 'Payouts Overview']
    ],
    settings: [
      ['general-settings', 'fa-sliders', 'General Settings'],
      ['security-settings', 'fa-user-shield', 'Security Settings'],
      ['smpp-settings', 'fa-plug-circle-bolt', 'SMPP Settings'],
      ['api-tokens', 'fa-code', 'API & Webhooks'],
      ['services-manager', 'fa-mobile-screen-button', 'Services & CLI'],
      ['backup-restore', 'fa-database', 'Backup & Restore']
    ],
    comm: [
      ['announcements', 'fa-bullhorn', 'Announcements'],
      ['support-tickets', 'fa-headset', 'Support Tickets']
    ]
  };
  const items = hubs[hub] || [];
  if (!items.length) return '';
  return `
    <div class="tabs" style="margin-bottom:16px;display:flex;gap:8px;border-bottom:1px solid var(--border);padding-bottom:12px;overflow-x:auto;flex-wrap:wrap;">
      ${items.map(([p, icon, label]) => `
        <button type="button" class="btn ${activePage === p ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="loadPage('${p}')">
          <i class="fas ${icon}"></i> ${label}
        </button>
      `).join('')}
    </div>
  `;
}


function appColor(app) {
  const colors = {
    WhatsApp: '#25d366', Telegram: '#2aabee', Google: '#4285f4',
    Amazon: '#ff9900', Facebook: '#1877f2', Twitter: '#1da1f2',
    Instagram: '#e1306c', Netflix: '#e50914', Uber: '#000000', Discord: '#5865f2'
  };
  return colors[app] || '#334155';
}

let _appTblCounter = 0;
function buildTable(headers, rows, options = {}) {
  const tableId = typeof options === 'string' ? options : (options && options.id ? options.id : ('tbl-auto-' + (++_appTblCounter)));
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
  return `${toolbarHtml}<div class="table-wrap apx-table-scroll"><table id="${tableId}" data-table-id="${tableId}" class="apx-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
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

function progressRow(label, val, max, color) {
  const pct = Math.min(100, Math.round((val / max) * 100));
  return `<div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
      <span>${label}</span><span class="text-muted">${pct}%</span>
    </div>
    <div class="progress-bar"><div class="progress-bar-fill ${color}" style="width:${pct}%"></div></div>
  </div>`;
}

function chartOpts(extra = {}) {
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
    },
    ...extra
  };
}

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
// ── GLOBAL SEARCH ─────────────────────────────────────────────────
let _searchDebounce = null;
function openGlobalSearch() {
  openModal('Search', `
    <input id="gs-input" placeholder="Search number, client, agent…" autofocus
      oninput="clearTimeout(_searchDebounce);_searchDebounce=setTimeout(runGlobalSearch,300)"
      style="width:100%;font-size:15px;padding:10px 12px;">
    <div id="gs-results" style="margin-top:14px;max-height:400px;overflow-y:auto;"></div>
  `);
  setTimeout(() => document.getElementById('gs-input')?.focus(), 100);
}

async function runGlobalSearch() {
  const q = document.getElementById('gs-input')?.value || '';
  const results = document.getElementById('gs-results');
  if (q.trim().length < 2) { results.innerHTML = ''; return; }

  results.innerHTML = `<div class="flex-center" style="padding:16px;"><div class="spinner"></div></div>`;
  const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!data) { results.innerHTML = ''; return; }

  const sections = [];
  if (data.numbers?.length) {
    sections.push(`
      <div style="margin-bottom:14px;">
        <div class="fs-12 text-muted fw-600" style="margin-bottom:6px;">NUMBERS</div>
        ${data.numbers.map(n => `
          <div class="search-result-row" onclick="closeModal();loadPage('my-numbers')">
            <span class="monospace">${n.number}</span>
            <span style="margin-left:auto;">${statusBadge(n.status)}</span>
          </div>`).join('')}
      </div>`);
  }
  if (data.clients?.length) {
    sections.push(`
      <div style="margin-bottom:14px;">
        <div class="fs-12 text-muted fw-600" style="margin-bottom:6px;">CLIENTS</div>
        ${data.clients.map(c => `
          <div class="search-result-row" onclick="closeModal();loadPage('clients')">
            <strong>${c.username}</strong>
            <span class="text-success" style="margin-left:auto;">$${zyFmtMoney((c.balance||0), 2)}</span>
          </div>`).join('')}
      </div>`);
  }
  if (data.agents?.length) {
    sections.push(`
      <div style="margin-bottom:14px;">
        <div class="fs-12 text-muted fw-600" style="margin-bottom:6px;">AGENTS</div>
        ${data.agents.map(a => `
          <div class="search-result-row" onclick="closeModal();loadPage('agents')">
            <strong>${a.username}</strong>
            <span class="text-success" style="margin-left:auto;">$${zyFmtMoney((a.balance||0), 2)}</span>
          </div>`).join('')}
      </div>`);
  }

  results.innerHTML = sections.length ? sections.join('') :
    `<div class="empty-state" style="padding:24px;"><i class="fas fa-magnifying-glass"></i><p>No results for "${q}"</p></div>`;
}

function toggleTheme() {
  document.body.classList.toggle('light');
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.className = document.body.classList.contains('light') ? 'fas fa-moon' : 'fas fa-circle-half-stroke';
  }
  try {
    localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
  } catch {}
}

(function initTheme() {
  try {
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
      const icon = document.getElementById('theme-icon');
      if (icon) icon.className = 'fas fa-moon';
    }
  } catch {}
})();

// ── Sidebar ───────────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const wrapper = document.querySelector('.main-wrapper');
  if (window.innerWidth < 992) {
    // Mobile: slide-in overlay behavior
    if (sidebar) sidebar.classList.toggle('open');
  } else {
    // Desktop: Fixed and solid permanent sidebar; dashboard never slides
    if (sidebar) sidebar.classList.remove('collapsed');
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
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  } catch (e) {}
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = '/login';
      return;
    }
  } catch (e) {}
  window.location.href = '/login';
}

// ── Router ────────────────────────────────────────────────────────
let currentPage = '';
let activeWS = [];
let activePollers = [];

function stopWebSockets() {
  activeWS.forEach(ws => { try { ws.close(); } catch (e) {} });
  activeWS = [];
  activePollers.forEach(id => { try { clearInterval(id); } catch (e) {} });
  activePollers = [];
}

function loadPage(page) {
  stopWebSockets();
  currentPage = page;
  sessionStorage.setItem('admin_current_page', page);

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${page}`);
  if (navEl) navEl.classList.add('active');

  const label = navEl ? navEl.querySelector('span')?.textContent || page : page;
  const bcEl = document.getElementById('breadcrumb') || document.querySelector('[data-breadcrumb="1"]');
  if (bcEl) bcEl.textContent = label;

  const content = document.getElementById('page-content');
  if (content) content.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;

  const pages = {
    'dashboard': renderDashboard,
    'my-numbers': renderMyNumbers,
    'bulk-allocation': renderBulkAllocation,
    'allocation-history': renderAllocationHistory,
    'sms-ranges': renderSmsRanges,
    'sms-rate-card': renderSmsRanges,
    'live-access': renderLiveOtpFeed,
    'upload-numbers': () => renderUploadNumbers('existing'),
    'bulk-range-import': renderBulkRangeImport,
    'blacklist-management': renderBlacklist,
    'revoke-numbers': renderRevokeNumbers,
    'my-sms': renderMySms,
    'cdr2': () => renderOwnerCdr2(),
    'profit-stats': renderProfitStats,
    'live-otp-feed': renderLiveOtpFeed,
    'sms-analytics': renderSmsAnalytics,
    'search-sms': renderMySms,
    'delivery-logs': renderMySms,
    'failed-sms': renderFailedSms,
    'live-traffic': renderLiveTraffic,
    'smpp-dashboard': renderSmppDashboard,
    'smpp-accounts': renderSmppAccounts,
    'login-panels': renderLoginPanels,
    'cr-api-panels': renderCrApiPanels,
    'whitenoise-panels': renderWhitenoisePanels,
    'smpp-sessions': renderSmppSessions,
    'connected-clients': renderConnectedClients,
    'dlr-monitor': renderDlrMonitor,
    'throughput-monitor': renderThroughputMonitor,
    'smpp-security': renderSmppSecurity,
    'connection-logs': renderConnectionLogs,
    'registration-requests': renderRegistrationRequests,
    'payout-requests': renderPayoutRequests,
    'agent-requests': renderAgentRequests,
    'number-requests': renderAgentRequests,
    'statements': () => renderStatementsHub('USD'),
    'usd-statements': () => renderStatementsHub('USD'),
    'eur-statements': () => renderStatementsHub('EUR'),
    'gbp-statements': () => renderStatementsHub('GBP'),
    'credit-notes': renderCreditNotesHub,
    'users': renderUsers,
    'agents': renderAdminAgents,
    'clients': renderAdminClients,
    'hierarchy': renderHierarchy,
    'account-balances': renderAccountBalances,
    'audit-logs': renderAuditLogs,
    'login-activity': renderLoginActivity,
    'business-reports': renderBusinessReports,
    'permissions': renderPermissions,
    'http-overview': renderHttpOverview,
    'standard-webhook': renderStandardWebhook,
    'custom-postback': renderCustomPostback,
    'field-mapping': renderFieldMapping,
    'test-endpoint': renderTestEndpoint,
    'api-tokens': renderApiTokens,
    'api-playground': renderApiPlayground,
    'live-test': renderLiveTest,
    'webhook-config': renderWebhookConfig,
    'documentation': renderDocumentation,
    'announcements': renderAnnouncements,
    'notifications': () => window.HumexNotifications && window.HumexNotifications.renderPage('page-content'),
    'support-tickets': renderSupportTickets,
    'my-profile': () => renderMyProfile('details'),
    'profile': () => renderMyProfile('details'),
    'profile-security': () => renderMyProfile('security'),
    '2fa': () => renderMyProfile('2fa'),
    'my-payouts': renderMyPayouts,
    'firewall-dashboard': renderFirewallDashboard,
    'blocked-ips': renderBlockedIps,
    'firewall-events': renderFirewallEvents,
    'rate-limits': renderRateLimits,
    'firewall-rates': renderRateLimits,
    'general-settings': renderGeneralSettings,
    'security-settings': renderSecuritySettings,
    'smpp-settings': renderSmppSettings,
    'backup-restore': renderBackupRestore,
    'cli-manager': renderCliManager,
    'services-manager': renderServicesManager,
    'services-cli': renderServicesManager,
    'number-transfers-log': renderNumberTransfersLog,
  };

  if (pages[page]) {
    pages[page]();
  } else {
    content.innerHTML = `<div class="empty-state"><i class="fas fa-circle-exclamation"></i><p>Page not found: ${page}</p></div>`;
  }
}

// ── Live MPS ticker ───────────────────────────────────────────────
(function liveTicker() {
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    const ws = new WebSocket(`${wsProto}://${location.host}/ws/live-traffic`);
    ws.onmessage = e => {
      const d = JSON.parse(e.data);
      const el = document.getElementById('live-mps');
      if (el) el.textContent = d.mps + ' MPS';
    };
  } catch (err) {}
})();

// ════════════════════════════════════════════════════════════════════
//  SMPP ACCOUNTS — COMPLETE WITH TEST CONNECTION
// ════════════════════════════════════════════════════════════════════

async function renderCrApiPanels() {
  try {
    const raw = await apiFetch('/api/cr-api-connections');
    const connections = Array.isArray(raw) ? raw : (raw?.data || []);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">CR API Connected Panel</div>
          <div class="page-subtitle">Auto-pulling OTPs every 5s from provider panels in real-time</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openAddCrApiModal()"><i class="fas fa-plus"></i> Add Connection</button>
        </div>
      </div>
      ${renderOwnerHubTabs('providers', 'cr-api-panels')}
      <div class="card">
        ${connections.length ? buildTable(
          ['#', 'Panel Name', 'Panel URL', 'Token', 'Auto-Pull', 'Last Pull', 'Status', 'Total Pulled', 'Active', 'Actions'],
          connections.map(cn => [
            cn.id,
            `<strong>${cn.panel_name}</strong>`,
            `<span class="fs-12 text-muted">${cn.panel_url.length > 40 ? cn.panel_url.slice(0,40)+'…' : cn.panel_url}</span>`,
            `<span class="monospace">${cn.token_masked}</span>`,
            `<span class="badge badge-blue"><i class="fas fa-bolt"></i> ${cn.interval || 5}s</span>`,
            cn.last_pulled_at ? fmtShort(cn.last_pulled_at) : '<span class="text-muted">Not polled yet</span>',
            `<span class="fs-12 ${cn.last_status?.startsWith('Error') ? 'text-danger' : 'text-success'}">${cn.last_status || '—'}</span>`,
            cn.total_pulled || 0,
            statusBadge(cn.active ? 'active' : 'paused'),
            `<button class="btn btn-outline btn-sm" onclick="pullCrApiConnNow(${cn.id})" title="Pull latest OTPs now"><i class="fas fa-rotate"></i> Pull</button>
             <button class="btn btn-outline btn-sm" onclick="toggleCrApiConn(${cn.id}, ${!cn.active})" title="${cn.active ? 'Pause' : 'Resume'}"><i class="fas fa-${cn.active ? 'pause' : 'play'}"></i></button>
             <button class="btn btn-outline btn-sm" onclick="deleteCrApiConn(${cn.id})" title="Remove"><i class="fas fa-trash"></i></button>`
          ])
        ) : `<div class="empty-state"><i class="fas fa-link"></i><p>No CR API connections yet — click "Add Connection" to pull OTPs in from another panel.</p></div>`}
      </div>
    `;
  } catch (err) {
    console.error('CR API panels error:', err);
    toast('Failed to load CR API connections', 'error');
  }
}

function openAddCrApiModal() {
  openModal('Add CR API Connection', `
    <form id="cr-api-form" onsubmit="submitAddCrApi(event)">
      <p class="fs-12 text-muted" style="margin-bottom:14px;">Connect external panel's CR API — incoming OTPs are auto-pulled into your panel every 5 seconds so they appear at the same time.</p>
      <div class="form-group">
        <label class="form-label">Panel Name *</label>
        <input id="cr-panel-name" placeholder="e.g. HUMAX SMS / Remote Panel" required>
      </div>
      <div class="form-group">
        <label class="form-label">Panel URL (CR API URL) *</label>
        <input id="cr-panel-url" placeholder="https://humaxsms.com/api/viewstats" required>
      </div>
      <div class="form-group">
        <label class="form-label">Token *</label>
        <input id="cr-token" placeholder="token key" required>
      </div>
      <div class="form-group">
        <label class="form-label">Auto-Pull Every (seconds)</label>
        <input id="cr-interval" type="number" min="3" value="5" placeholder="5">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="cr-api-submit-btn"><i class="fas fa-link"></i> Connect</button>
      </div>
    </form>
  `);
}

async function submitAddCrApi(event) {
  event.preventDefault();
  const panel_name = document.getElementById('cr-panel-name')?.value.trim();
  const panel_url = document.getElementById('cr-panel-url')?.value.trim();
  const token = document.getElementById('cr-token')?.value.trim();
  const interval = parseInt(document.getElementById('cr-interval')?.value) || 5;
  if (!panel_name || !panel_url || !token) { toast('Fill in all required fields', 'error'); return; }
  try {
    await apiFetch('/api/cr-api-connections', {
      method: 'POST', body: JSON.stringify({ panel_name, panel_url, token, interval })
    });
    closeModal();
    toast('✅ Connected! Auto-pulling every ' + interval + 's...', 'success');
    await renderCrApiPanels();
  } catch (err) {
    console.error('Add CR API error:', err);
    toast('Failed to add connection', 'error');
  }
}

async function pullCrApiConnNow(id) {
  toast('Pulling latest OTPs from remote panel...', 'info');
  try {
    const res = await apiFetch(`/api/cr-api-connections/${id}/pull`, { method: 'POST' });
    if (res && res.success) {
      toast(`✅ Pulled ${res.pulled} new OTP(s). Status: ${res.status}`, 'success');
    } else {
      toast(`⚠️ ${res?.error || res?.status || 'Failed'}`, 'error');
    }
    await renderCrApiPanels();
  } catch (e) {
    toast('Failed to pull: ' + e.message, 'error');
  }
}

async function toggleCrApiConn(id, active) {
  try {
    await apiFetch(`/api/cr-api-connections/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    toast(active ? '✅ Connection enabled' : '⏸️ Connection paused', 'info');
    await renderCrApiPanels();
  } catch (err) { toast('Failed to update connection', 'error'); }
}

async function deleteCrApiConn(id) {
  if (!confirm('Remove this CR API connection? OTPs will stop pulling in from it.')) return;
  try {
    await apiFetch(`/api/cr-api-connections/${id}`, { method: 'DELETE' });
    toast('✅ Connection removed', 'warning');
    renderCrApiPanels();
  } catch (err) { toast('Failed to remove connection', 'error'); }
}

// ════════════════════════════════════════════════════════════════════
//  WHITENOISE API CONNECTIONS (PURE NODE ADAPTER + HYBRID SCRAPER)
// ════════════════════════════════════════════════════════════════════
let _whitenoiseCache = [];

async function renderWhitenoisePanels() {
  try {
    const [raw, mcRes] = await Promise.all([
      apiFetch('/api/whitenoise-connections'),
      apiFetch('/api/monthly-cycle').catch(() => null)
    ]);
    const connections = Array.isArray(raw) ? raw : (raw?.data || []);
    _whitenoiseCache = connections;
    const mc = mcRes?.monthly_cycle || { start_date: '', end_date: '', clear_date: '' };

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fas fa-tower-cell" style="color:#4f46e5;"></i> Whitenoise API Connections</div>
          <div class="page-subtitle">Direct pure-Node integration for Whitenoise SMS fetching, conditional conversion registration, and Monthly (30/5) {W} payouts.</div>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;">
          <button class="btn btn-outline btn-sm" onclick="loadPage('cdr2')"><i class="fas fa-table-list"></i> Open CDR 2</button>
          <button class="btn btn-primary btn-sm" onclick="openAddWhitenoiseModal()"><i class="fas fa-plus"></i> Add Whitenoise Connection</button>
        </div>
      </div>
      ${renderOwnerHubTabs('providers', 'whitenoise-panels')}
      <div class="card" style="margin-bottom:14px;background:#eef2ff;border-color:#c7d2fe;padding:12px 16px;">
        <div style="font-size:12.5px;color:#312e81;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <div><strong><i class="fas fa-calendar-check"></i> Payment Rule:</strong> All Whitenoise numbers, ranges, and CDR 2 logs are locked to <b>Monthly (30/5) {W}</b> (5-day hold).</div>
          <div><strong>Modes:</strong> <code>Hybrid (Cookie + API Key)</code> fetches full SMS inbox + registers conversions · <code>API Key Only</code> hits <code>/sms/get-phone-last-sms</code></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:end;background:#ffffff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 12px;">
          <div>
            <label class="form-label" style="font-size:11.5px;margin-bottom:4px;">Monthly Cycle Start</label>
            <input type="date" id="wn-mc-start" value="${escapeHtml(mc.start_date || '')}" style="width:100%;height:34px;">
          </div>
          <div>
            <label class="form-label" style="font-size:11.5px;margin-bottom:4px;">Monthly Cycle End</label>
            <input type="date" id="wn-mc-end" value="${escapeHtml(mc.end_date || '')}" style="width:100%;height:34px;">
          </div>
          <div>
            <label class="form-label" style="font-size:11.5px;margin-bottom:4px;">Company Clear Date</label>
            <input type="date" id="wn-mc-clear" value="${escapeHtml(mc.clear_date || '')}" style="width:100%;height:34px;">
          </div>
          <div>
            <button type="button" class="btn btn-primary btn-sm" id="wn-mc-save-btn" onclick="zySaveMonthlyCycleFromPanels()" style="height:34px;width:100%;">
              <i class="fas fa-calendar-check"></i> Save Cycle Window
            </button>
          </div>
        </div>
      </div>
      <div class="card">
        ${connections.length ? buildTable(
          ['#', 'Panel Name', 'Base URL', 'Mode', 'Conversion', 'Credentials', 'Sweep (Client / Pool)', 'Status', 'Pulled / Conv.', 'Actions'],
          connections.map(cn => [
            cn.id,
            `<strong>${escapeHtml(cn.panel_name || cn.name || 'Whitenoise')}</strong>`,
            `<span class="fs-12 text-muted">${escapeHtml(cn.base_url || 'https://api.whitenoise.one')}</span>`,
            `<span class="badge ${cn.mode === 'hybrid' ? 'badge-purple' : 'badge-blue'}">${cn.mode === 'hybrid' ? 'Hybrid (Cookie+API)' : 'API Key'}</span>`,
            `<span class="badge badge-outline">${escapeHtml(cn.conversion_mode || 'on_client_match')}</span>`,
            `<div class="fs-12 monospace">Key: ${escapeHtml(cn.api_key_masked || '—')}<br>Cookie: ${escapeHtml(cn.cookie_masked || 'None')}</div>`,
            `<span class="badge badge-blue"><i class="fas fa-bolt"></i> ${cn.poll_interval_sec || cn.interval || 240}s / ${Math.round((cn.pool_interval_sec || 540) / 60)}m</span>`,
            `<div class="fs-12 ${String(cn.last_status || '').startsWith('Error') ? 'text-danger' : 'text-success'}">${statusBadge(cn.active ? 'active' : 'paused')}<div style="margin-top:2px;">${escapeHtml(cn.last_status || 'Ready')}</div></div>`,
            `<b>${cn.total_pulled || 0}</b> SMS<br><small class="text-muted">${cn.total_conversions || 0} conv.</small>`,
            `<div style="display:inline-flex;gap:4px;flex-wrap:wrap;">
              <button class="btn btn-outline btn-sm" onclick="openTestWhitenoiseModal(${cn.id}, '${escapeHtml(cn.panel_name || cn.name || 'Whitenoise')}')" title="Test Number"><i class="fas fa-vial"></i> Test</button>
              <button class="btn btn-outline btn-sm" onclick="pullWhitenoiseNow(${cn.id})" title="Pull latest OTPs now"><i class="fas fa-rotate"></i> Pull</button>
              <button class="btn btn-outline btn-sm" onclick="openEditWhitenoiseModal(${cn.id})" title="Edit Connection"><i class="fas fa-pen"></i></button>
              <button class="btn btn-outline btn-sm" onclick="toggleWhitenoiseConn(${cn.id}, ${!cn.active})" title="${cn.active ? 'Pause' : 'Resume'}"><i class="fas fa-${cn.active ? 'pause' : 'play'}"></i></button>
              <button class="btn btn-danger btn-sm" onclick="deleteWhitenoiseConn(${cn.id})" title="Remove"><i class="fas fa-trash"></i></button>
            </div>`
          ])
        ) : `<div class="empty-state"><i class="fas fa-tower-cell"></i><p>No Whitenoise connections yet — click "Add Whitenoise Connection" to integrate your Whitenoise account.</p></div>`}
      </div>
    `;
  } catch (err) {
    console.error('Whitenoise panels error:', err);
    toast('Failed to load Whitenoise connections', 'error');
  }
}

async function zySaveMonthlyCycleFromPanels() {
  const start_date = document.getElementById('wn-mc-start')?.value || '';
  const end_date = document.getElementById('wn-mc-end')?.value || '';
  const clear_date = document.getElementById('wn-mc-clear')?.value || '';
  if (!start_date || !end_date || !clear_date) {
    toast('Please fill Start Date, End Date, and Clear Date.', 'error');
    return;
  }
  const btn = document.getElementById('wn-mc-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }
  try {
    const res = await apiFetch('/api/monthly-cycle', {
      method: 'POST',
      body: JSON.stringify({ start_date, end_date, clear_date })
    });
    if (res && res.success) {
      toast(`Monthly Cycle updated: ${res.monthly_cycle.start_date} → ${res.monthly_cycle.end_date} (Clears ${res.monthly_cycle.clear_date})`, 'success');
    } else {
      toast(res?.error || 'Failed to save Monthly Cycle', 'error');
    }
  } catch (err) {
    toast(err.message || 'Failed to save Monthly Cycle', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-check"></i> Save Cycle Window'; }
  }
}

function openAddWhitenoiseModal() {
  openModal('Add Whitenoise Connection', buildWhitenoiseFormHtml(null));
}

function openEditWhitenoiseModal(id) {
  const cn = _whitenoiseCache.find(x => Number(x.id) === Number(id));
  if (!cn) return;
  openModal(`Edit Whitenoise — ${escapeHtml(cn.panel_name || cn.name || 'Connection')}`, buildWhitenoiseFormHtml(cn));
}

function buildWhitenoiseFormHtml(cn) {
  const isEdit = Boolean(cn && cn.id);
  const modeVal = cn?.mode || 'hybrid';
  const convVal = cn?.conversion_mode || 'on_client_match';
  return `
    <form id="wn-conn-form" onsubmit="submitWhitenoiseForm(event, ${isEdit ? Number(cn.id) : 'null'})">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Panel Name *</label>
          <input id="wn-panel-name" value="${escapeHtml(cn?.panel_name || cn?.name || 'Whitenoise Main')}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Base URL *</label>
          <input id="wn-base-url" value="${escapeHtml(cn?.base_url || 'https://api.whitenoise.one')}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Connection Mode *</label>
          <select id="wn-mode">
            <option value="hybrid" ${modeVal === 'hybrid' ? 'selected' : ''}>Hybrid (Cookie + API Key)</option>
            <option value="api_key" ${modeVal === 'api_key' ? 'selected' : ''}>API Key Only (/sms/get-phone-last-sms)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Conversion Registration</label>
          <select id="wn-conv-mode">
            <option value="on_client_match" ${convVal === 'on_client_match' ? 'selected' : ''}>On Client Match (Recommended)</option>
            <option value="always" ${convVal === 'always' ? 'selected' : ''}>Always Register</option>
            <option value="off" ${convVal === 'off' ? 'selected' : ''}>Disabled (Off)</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">API Key ${isEdit ? '(leave blank to keep existing)' : '*'}</label>
        <input id="wn-api-key" placeholder="${isEdit ? escapeHtml(cn.api_key_masked || 'Keep existing') : 'Whitenoise API key'}" ${isEdit ? '' : 'required'}>
      </div>
      <div class="form-group">
        <label class="form-label">Session Cookie ${isEdit ? '(optional — leave blank to keep existing)' : '(for Hybrid /sms fetch)'}</label>
        <textarea id="wn-cookie" rows="2" placeholder="${isEdit ? escapeHtml(cn.cookie_masked || 'Leave blank to keep existing cookie') : 'PHPSESSID=...; remember_web=...'}" style="width:100%;font-family:monospace;font-size:12px;"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Client Sweep Interval (sec)</label>
          <input id="wn-interval" type="number" min="10" max="1800" value="${Number(cn?.poll_interval_sec || cn?.interval || 240)}">
        </div>
        <div class="form-group">
          <label class="form-label">Pool Sweep Interval (sec, ~9m)</label>
          <input id="wn-pool-interval" type="number" min="60" max="3600" value="${Number(cn?.pool_interval_sec || 540)}">
        </div>
        <div class="form-group">
          <label class="form-label">Request Timeout (ms)</label>
          <input id="wn-timeout" type="number" min="2000" max="60000" value="${Number(cn?.timeout_ms || 12000)}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">User-Agent (optional)</label>
        <input id="wn-ua" value="${escapeHtml(cn?.user_agent || '')}" placeholder="Mozilla/5.0 ...">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="wn-submit-btn"><i class="fas fa-save"></i> ${isEdit ? 'Save Changes' : 'Connect Whitenoise'}</button>
      </div>
    </form>
  `;
}

async function submitWhitenoiseForm(event, editId) {
  event.preventDefault();
  const panelName = document.getElementById('wn-panel-name')?.value.trim();
  const clientSweep = parseInt(document.getElementById('wn-interval')?.value, 10) || 240;
  const poolSweep = parseInt(document.getElementById('wn-pool-interval')?.value, 10) || 540;
  const payload = {
    name: panelName,
    panel_name: panelName,
    base_url: document.getElementById('wn-base-url')?.value.trim() || 'https://api.whitenoise.one',
    mode: document.getElementById('wn-mode')?.value || 'hybrid',
    conversion_mode: document.getElementById('wn-conv-mode')?.value || 'on_client_match',
    interval: clientSweep,
    poll_interval_sec: clientSweep,
    client_interval_sec: clientSweep,
    pool_interval_sec: poolSweep,
    timeout_ms: parseInt(document.getElementById('wn-timeout')?.value, 10) || 12000,
    user_agent: document.getElementById('wn-ua')?.value.trim() || ''
  };
  const apiKey = document.getElementById('wn-api-key')?.value.trim();
  const cookie = document.getElementById('wn-cookie')?.value.trim();
  if (apiKey) payload.api_key = apiKey;
  if (cookie) { payload.cookie = cookie; payload.web_cookie = cookie; }

  if (!payload.panel_name) { toast('Panel name is required', 'error'); return; }
  if (!editId && !payload.api_key && !payload.web_cookie) { toast('API Key or Session Cookie is required', 'error'); return; }

  const btn = document.getElementById('wn-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }
  try {
    const url = editId ? `/api/whitenoise-connections/${editId}` : '/api/whitenoise-connections';
    const method = editId ? 'PATCH' : 'POST';
    const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
    if (res && !res.error) {
      closeModal();
      toast(editId ? 'Whitenoise connection updated' : 'Whitenoise connection added', 'success');
      await renderWhitenoisePanels();
    } else {
      toast(res?.error || 'Failed to save connection', 'error');
    }
  } catch (err) {
    toast(err.message || 'Failed to save connection', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${editId ? 'Save Changes' : 'Connect Whitenoise'}`; }
  }
}

function openTestWhitenoiseModal(id, panelName) {
  openModal(`Test Single Number — ${escapeHtml(panelName)}`, `
    <form onsubmit="submitTestWhitenoise(event, ${Number(id)})">
      <p class="fs-12 text-muted" style="margin-bottom:12px;">Fetch SMS directly from Whitenoise for a single number and optionally ingest new OTPs into CDR 2.</p>
      <div class="form-group">
        <label class="form-label">Phone Number *</label>
        <input id="wn-test-number" placeholder="e.g. 923001234567" required>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
          <input type="checkbox" id="wn-test-ingest" checked> Ingest new OTPs into CDR 2 (Monthly 30/5 {W})
        </label>
      </div>
      <div id="wn-test-result" style="margin-bottom:12px;"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Close</button>
        <button type="submit" class="btn btn-primary" id="wn-test-btn"><i class="fas fa-vial"></i> Run Test</button>
      </div>
    </form>
  `);
}

async function submitTestWhitenoise(event, id) {
  event.preventDefault();
  const number = document.getElementById('wn-test-number')?.value.trim();
  const ingest = Boolean(document.getElementById('wn-test-ingest')?.checked);
  const resEl = document.getElementById('wn-test-result');
  const btn = document.getElementById('wn-test-btn');
  if (!number) return;
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Testing...'; }
  if (resEl) resEl.innerHTML = '<div class="text-muted fs-12">Querying Whitenoise…</div>';
  try {
    const res = await apiFetch(`/api/whitenoise-connections/${id}/test-number`, {
      method: 'POST',
      body: JSON.stringify({ number, ingest })
    });
    const rows = Array.isArray(res?.messages) ? res.messages : [];
    if (resEl) {
      resEl.innerHTML = `
        <div class="badge ${res?.success ? 'badge-green' : 'badge-red'}" style="margin-bottom:8px;">
          ${res?.success ? `OK (${res.source || 'whitenoise'}) · ${rows.length} message(s), ${res.ingested || 0} new ingested` : (res?.error || 'Request failed')}
        </div>
        ${rows.length ? `<div style="max-height:220px;overflow:auto;border:1px solid #cbd5e1;border-radius:6px;padding:8px;font-size:12px;">
          ${rows.slice(0, 15).map(m => `<div style="border-bottom:1px dashed #e2e8f0;padding:4px 0;">
            <b>${escapeHtml(m.cli || m.sender || 'CLI')}</b> <span class="text-muted">${escapeHtml(m.timestamp || '')}</span>
            <div>${escapeHtml(m.message || '')}</div>
          </div>`).join('')}
        </div>` : ''}
      `;
    }
  } catch (err) {
    if (resEl) resEl.innerHTML = `<div class="text-danger fs-12">${escapeHtml(err.message || 'Test failed')}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-vial"></i> Run Test'; }
  }
}

async function pullWhitenoiseNow(id) {
  toast('Syncing Whitenoise connection…', 'info');
  try {
    const res = await apiFetch(`/api/whitenoise-connections/${id}/pull`, { method: 'POST' });
    if (res && res.success) {
      toast(`Synced ${res.checked || 0} number(s) · ${res.pulled || 0} new SMS · ${res.conversions || 0} conv.`, 'success');
    } else {
      toast(res?.error || res?.status || 'Sync completed with warning', 'warning');
    }
    await renderWhitenoisePanels();
  } catch (err) {
    toast('Failed to pull Whitenoise: ' + err.message, 'error');
  }
}

async function toggleWhitenoiseConn(id, active) {
  try {
    await apiFetch(`/api/whitenoise-connections/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    toast(active ? 'Whitenoise connection active' : 'Whitenoise connection paused', 'info');
    await renderWhitenoisePanels();
  } catch (err) {
    toast('Failed to update Whitenoise connection', 'error');
  }
}

async function deleteWhitenoiseConn(id) {
  if (!confirm('Remove this Whitenoise connection?')) return;
  try {
    await apiFetch(`/api/whitenoise-connections/${id}`, { method: 'DELETE' });
    toast('Whitenoise connection removed', 'warning');
    await renderWhitenoisePanels();
  } catch (err) {
    toast('Failed to remove Whitenoise connection', 'error');
  }
}

async function renderSmppAccounts() {
  try {
    const [data, serverInfo] = await Promise.all([
      apiFetch('/api/smpp/accounts') || [],
      apiFetch('/api/smpp/server-info')
    ]);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">SMPP Accounts</div>
          <div class="page-subtitle">External SMS provider connections</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openAddSmppModal()">
            <i class="fas fa-plus"></i> Add Account
          </button>
        </div>
      </div>
      ${renderOwnerHubTabs('providers', 'smpp-accounts')}

      <div class="card" style="margin-bottom:16px;background:${serverInfo?.listening ? 'rgba(46,160,67,0.08)' : 'rgba(218,54,51,0.08)'};border-color:${serverInfo?.listening ? 'rgba(46,160,67,0.25)' : 'rgba(218,54,51,0.25)'};">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="status-indicator ${serverInfo?.listening ? 'online' : 'offline'}"></span>
          <strong>${serverInfo?.listening ? `SMPP Server is listening on port ${serverInfo.port}` : 'SMPP Server is NOT running'}</strong>
          ${serverInfo?.listening ? `<span class="text-muted fs-12">— ${serverInfo.bound_connections} carrier(s) currently bound</span>` : `<span class="fs-12">— check your server logs, another process may be using port ${serverInfo?.port || 2775}</span>`}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px;background:rgba(210,153,34,0.08);border-color:rgba(210,153,34,0.25);">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <i class="fas fa-shield-halved" style="color:var(--yellow-light);margin-top:2px;"></i>
          <div style="font-size:12px;color:var(--text-secondary);">
            <strong>For SMPP:</strong> most carriers connect <em>to you</em> — give them your server's IP, port <span class="monospace">${serverInfo?.port || 2775}</span>, and the System ID/Password you set when adding the connection below.
            Whitelist any IPs they ask for on your own firewall so their connection isn't blocked —
            <span class="monospace">130.117.83.34</span> and <span class="monospace">130.117.83.32</span> are common examples, but always use what your specific provider gives you.<br>
            <strong>For HTTP delivery:</strong> share your inbound URL: <span class="monospace">/api/sms/inbound</span> (fields: from, to, message, sms_id).
          </div>
        </div>
      </div>

      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px;">
        ${statCard('Total Accounts', 'fas fa-users', data.length, 'blue', 'All accounts')}
        ${statCard('Active Accounts', 'fas fa-circle-check', data.filter(a => a.status === 'active').length, 'green', 'Connected')}
        ${statCard('Inactive Accounts', 'fas fa-circle-xmark', data.filter(a => a.status !== 'active').length, 'red', 'Disconnected')}
      </div>

      <div class="card">
        ${buildTable(
          ['#', 'Company', 'Type', 'Host/URL', 'System ID', 'OTP Today', 'Total OTP', 'Status', 'Actions'],
          data.map(a => [
            a.id || '—',
            `<strong>${a.company || '—'}</strong>`,
            badge(a.interconnect_type === 'http' ? 'HTTP' : (a.interconnect_type === 'smpp-client' ? 'SMPP Client' : 'SMPP Server'), a.interconnect_type === 'http' ? 'purple' : (a.interconnect_type === 'smpp-client' ? 'cyan' : 'blue')),
            `<span class="monospace" style="font-size:11px;">${
              a.interconnect_type === 'http' ? (a.forward_url || '—') :
              a.interconnect_type === 'smpp-client' ? (a.host || '—') + ':' + (a.port || '') :
              'carrier connects to you'
            }</span>`,
            `<span class="monospace">${a.system_id || '—'}</span>`,
            `<span class="badge badge-green">${a.otp_today || 0}</span>`,
            `<strong class="text-success">${a.total_otp || 0}</strong>`,
            `<span class="status-indicator ${a.status === 'active' ? 'online' : 'offline'}"></span> ${statusBadge(a.status)}`,
            `<button class="btn btn-success btn-sm" onclick="testSmppConnection(${a.id})" title="Test Connection">
              <i class="fas fa-plug"></i> Test
            </button>
            ${a.interconnect_type === 'smpp-client' ? `<button class="btn btn-outline btn-sm" onclick="reconnectSmppAccount(${a.id})" title="Reconnect"><i class="fas fa-rotate"></i></button>` : ''}
            <button class="btn btn-outline btn-sm" onclick="openEditSmppModal(${a.id})" title="Edit">
              <i class="fas fa-pen"></i>
            </button>
            <button class="btn btn-${a.status === 'active' ? 'warning' : 'success'} btn-sm" onclick="toggleSmppAccount(${a.id},'${a.status}')" title="Toggle Status">
              <i class="fas fa-${a.status === 'active' ? 'pause' : 'play'}"></i>
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteSmppAccount(${a.id})" title="Delete">
              <i class="fas fa-trash"></i>
            </button>`
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('SMPP Accounts error:', err);
    toast('Failed to load SMPP accounts: ' + err.message, 'error');
    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-plug-circle-xmark" style="color:var(--red-light);font-size:40px;"></i>
        <p>Failed to load SMPP accounts. Please try again.</p>
        <button class="btn btn-primary btn-sm mt-4" onclick="renderSmppAccounts()">Retry</button>
      </div>
    `;
  }
}

async function openAddSmppModal() {
  const info = await apiFetch('/api/smpp/server-info');
  const serverPort = info?.port || 2775;

  openModal('Add Provider Connection', `
    <form id="add-smpp-form" onsubmit="submitSmppAccount(event)">
      <div style="background:rgba(76,110,245,0.08);border:1px solid rgba(76,110,245,0.2);border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:var(--text-secondary);">
        <i class="fas fa-circle-info" style="color:var(--accent);margin-right:6px;"></i>
        Enter your provider's connection details. Each company's incoming OTPs are tracked separately once connected.
      </div>

      <div class="form-group">
        <label class="form-label">Interconnect Type</label>
        <select id="smpp-ic-type" onchange="toggleSmppTypeFields()">
          <option value="smpp">SMPP Server — carrier connects to you (Recommended)</option>
          <option value="smpp-client">SMPP Client — you connect to carrier</option>
          <option value="http">HTTP (GET/POST forward)</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Company Name <span class="text-danger">*</span></label>
        <input id="smpp-company" placeholder="e.g. Twilio, Vonage" required>
      </div>

      <div id="smpp-type-smpp">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">System ID / Username <span class="text-danger">*</span></label>
            <input id="smpp-server-sid" placeholder="Give this to the carrier">
          </div>
          <div class="form-group">
            <label class="form-label">Password <span class="text-danger">*</span></label>
            <input type="password" id="smpp-server-pass" placeholder="Max 8 ASCII chars" maxlength="8">
            <small class="text-muted">Max 8 ASCII characters (per SMPP spec)</small>
          </div>
        </div>
        <div style="background:var(--bg-hover);border-radius:8px;padding:12px 14px;font-size:12px;">
          <strong>Give the carrier these details</strong> (to enter into their own SMPP client config):
          <table style="width:100%;margin-top:8px;">
            <tr><td class="text-muted">Host</td><td class="monospace" id="smpp-info-host">your server's public IP</td></tr>
            <tr><td class="text-muted">Port</td><td class="monospace">${serverPort}</td></tr>
            <tr><td class="text-muted">Bind Type</td><td>Transceiver (TRX)</td></tr>
            <tr><td class="text-muted">System ID</td><td class="monospace" id="smpp-info-sid">—</td></tr>
            <tr><td class="text-muted">Password</td><td class="monospace" id="smpp-info-pass">—</td></tr>
          </table>
        </div>
      </div>

      <div id="smpp-type-client" style="display:none;">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Host/IP <span class="text-danger">*</span></label>
            <input id="smpp-host" placeholder="smpp.provider.com or 192.168.1.100">
          </div>
          <div class="form-group">
            <label class="form-label">Port <span class="text-danger">*</span></label>
            <input type="number" id="smpp-port" value="2775" min="1" max="65535">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">System ID / Username <span class="text-danger">*</span></label>
            <input id="smpp-sid" placeholder="Your SMPP username">
          </div>
          <div class="form-group">
            <label class="form-label">Password <span class="text-danger">*</span></label>
            <input type="password" id="smpp-pass" placeholder="Max 8 ASCII chars" maxlength="8">
            <small class="text-muted">Max 8 ASCII characters (per SMPP spec)</small>
          </div>
        </div>
      </div>

      <div id="smpp-type-http" style="display:none;">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Method</label>
            <select id="smpp-http-method">
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Their Forward URL (they push messages here)</label>
            <input id="smpp-forward-url" placeholder="Auto-filled below" readonly>
          </div>
        </div>
        <p class="text-muted fs-12">Give this provider your inbound URL: <span class="monospace">https://yourdomain/api/sms/inbound</span> — fields: from, to, message, sms_id.</p>
      </div>

      <div class="form-group">
        <label class="form-label">Whitelist IP (optional)</label>
        <input id="smpp-whitelist" placeholder="130.117.83.32, 130.117.83.34">
        <small class="text-muted">Comma separated IPs or CIDR ranges</small>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="smpp-submit-btn">
          <i class="fas fa-plus"></i> Add Connection
        </button>
      </div>
    </form>
  `);
  setTimeout(() => {
    const urlField = document.getElementById('smpp-forward-url');
    if (urlField) urlField.value = window.location.origin + '/api/sms/inbound';
    const hostInfo = document.getElementById('smpp-info-host');
    if (hostInfo) hostInfo.textContent = window.location.hostname;
    const sidInput = document.getElementById('smpp-server-sid');
    const passInput = document.getElementById('smpp-server-pass');
    const sidInfo = document.getElementById('smpp-info-sid');
    const passInfo = document.getElementById('smpp-info-pass');
    if (sidInput) sidInput.addEventListener('input', () => sidInfo.textContent = sidInput.value || '—');
    if (passInput) passInput.addEventListener('input', () => passInfo.textContent = passInput.value || '—');
  }, 0);
}

function toggleSmppTypeFields() {
  const type = document.getElementById('smpp-ic-type')?.value;
  document.getElementById('smpp-type-smpp').style.display = type === 'smpp' ? 'block' : 'none';
  document.getElementById('smpp-type-client').style.display = type === 'smpp-client' ? 'block' : 'none';
  document.getElementById('smpp-type-http').style.display = type === 'http' ? 'block' : 'none';
}

async function submitSmppAccount(event) {
  event.preventDefault();

  try {
    const icType = document.getElementById('smpp-ic-type')?.value || 'smpp';
    const company = document.getElementById('smpp-company').value.trim();
    const whitelist = document.getElementById('smpp-whitelist').value.trim();

    if (!company) { toast('Company name is required', 'error'); return; }

    let payload = { company, interconnect_type: icType, whitelist_ip: whitelist || '', status: 'active' };

    if (icType === 'smpp') {
      const systemId = document.getElementById('smpp-server-sid').value.trim();
      const password = document.getElementById('smpp-server-pass').value;

      if (!systemId) { toast('System ID is required', 'error'); return; }
      if (!password || password.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
      if (password.length > 8) { toast('Password must be max 8 ASCII characters', 'error'); return; }

      payload = { ...payload, system_id: systemId, password: password, bind_type: 'transceiver' };
    } else if (icType === 'smpp-client') {
      const host = document.getElementById('smpp-host').value.trim();
      const port = parseInt(document.getElementById('smpp-port').value) || 2775;
      const systemId = document.getElementById('smpp-sid').value.trim();
      const password = document.getElementById('smpp-pass').value;

      if (!host) { toast('Host/IP is required', 'error'); return; }
      if (!systemId) { toast('System ID is required', 'error'); return; }
      if (!password || password.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
      if (password.length > 8) { toast('Password must be max 8 ASCII characters', 'error'); return; }
      if (port < 1 || port > 65535) { toast('Port must be between 1 and 65535', 'error'); return; }

      payload = { ...payload, host, port, system_id: systemId, password: password, bind_type: 'transceiver' };
    } else {
      const method = document.getElementById('smpp-http-method').value;
      payload = { ...payload, http_method: method, forward_url: window.location.origin + '/api/sms/inbound' };
    }

    const btn = document.getElementById('smpp-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Adding...';
    }

    const result = await apiFetch('/api/smpp/accounts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (result && result.id) {
      closeModal();
      toast(`✅ Connection for "${company}" added successfully!`, 'success');

      if (icType === 'smpp-client') {
        setTimeout(() => {
          testSmppConnection(result.id);
        }, 500);
      }

      renderSmppAccounts();
    } else {
      toast(result?.error || 'Failed to add connection', 'error');
    }
  } catch (err) {
    console.error('Add SMPP account error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('smpp-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus"></i> Add Account';
    }
  }
}

async function testSmppConnection(accountId) {
  try {
    toast('Testing SMPP connection...', 'info');

    const result = await apiFetch(`/api/smpp/accounts/${accountId}/test`, {
      method: 'POST'
    });

    if (result && result.success) {
      toast(`✅ SMPP Connection successful! Response time: ${result.response_time || '—'}ms`, 'success');
    } else {
      toast(`❌ SMPP Connection failed: ${result?.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    console.error('Test SMPP connection error:', err);
    toast('Error testing connection: ' + err.message, 'error');
  }
}

async function reconnectSmppAccount(id) {
  toast('Reconnecting...', 'info');
  const result = await apiFetch(`/api/smpp/accounts/${id}/reconnect`, { method: 'POST' });
  if (!result) return;
  toast('✅ Reconnecting to carrier...', 'success');
  setTimeout(() => renderSmppAccounts(), 1500);
}

async function toggleSmppAccount(id, status) {
  try {
    const newStatus = status === 'active' ? 'inactive' : 'active';

    const result = await apiFetch(`/api/smpp/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });

    if (result && result.id) {
      toast(`SMPP account ${newStatus}`, 'info');
      renderSmppAccounts();
    } else {
      toast('Failed to toggle account status', 'error');
    }
  } catch (err) {
    console.error('Toggle SMPP account error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

async function deleteSmppAccount(id) {
  if (!confirm('Delete this SMPP account? This action cannot be undone.')) return;

  try {
    const result = await apiFetch(`/api/smpp/accounts/${id}`, {
      method: 'DELETE'
    });

    if (result && result.success) {
      toast('SMPP account deleted', 'warning');
      renderSmppAccounts();
    } else {
      toast('Failed to delete account', 'error');
    }
  } catch (err) {
    console.error('Delete SMPP account error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

async function openEditSmppModal(id) {
  try {
    const data = await apiFetch(`/api/smpp/accounts/${id}`);
    if (!data) {
      toast('Account not found', 'error');
      return;
    }

    openModal(`Edit SMPP Account — ${data.company || 'Unknown'}`, `
      <form id="edit-smpp-form" onsubmit="submitEditSmppAccount(event, ${id})">
        <div style="background:rgba(76,110,245,0.08);border:1px solid rgba(76,110,245,0.2);border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:var(--text-secondary);">
          <i class="fas fa-circle-info" style="color:var(--accent);margin-right:6px;"></i>
          Update your SMPP provider credentials. Leave password blank to keep current.
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Company Name <span class="text-danger">*</span></label>
            <input id="esmpp-company" value="${data.company || ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Host/IP <span class="text-danger">*</span></label>
            <input id="esmpp-host" value="${data.host || ''}" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Port <span class="text-danger">*</span></label>
            <input type="number" id="esmpp-port" value="${data.port || 2775}" min="1" max="65535" required>
          </div>
          <div class="form-group">
            <label class="form-label">Message Limit (MPS)</label>
            <input type="number" id="esmpp-limit" value="${data.limit || 500}" min="1">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">System ID <span class="text-danger">*</span></label>
            <input id="esmpp-sid" value="${data.system_id || ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Password (optional)</label>
            <input type="password" id="esmpp-pass" placeholder="Leave blank to keep current" maxlength="8">
            <small class="text-muted">Max 8 ASCII characters</small>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Bind Type</label>
          <select id="esmpp-bind-type">
            <option value="transceiver" ${data.bind_type === 'transceiver' ? 'selected' : ''}>Transceiver (TX/RX)</option>
            <option value="transmitter" ${data.bind_type === 'transmitter' ? 'selected' : ''}>Transmitter (TX Only)</option>
            <option value="receiver" ${data.bind_type === 'receiver' ? 'selected' : ''}>Receiver (RX Only)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Whitelist IP (optional)</label>
          <input id="esmpp-whitelist" value="${data.whitelist_ip || ''}" placeholder="130.117.83.32, 130.117.83.34">
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="esmpp-submit-btn">
            <i class="fas fa-save"></i> Save Changes
          </button>
        </div>
      </form>
    `);
  } catch (err) {
    console.error('Edit SMPP account error:', err);
    toast('Failed to load account details', 'error');
  }
}

async function submitEditSmppAccount(event, id) {
  event.preventDefault();

  try {
    const company = document.getElementById('esmpp-company').value.trim();
    const host = document.getElementById('esmpp-host').value.trim();
    const port = parseInt(document.getElementById('esmpp-port').value) || 2775;
    const limit = parseInt(document.getElementById('esmpp-limit').value) || 500;
    const systemId = document.getElementById('esmpp-sid').value.trim();
    const password = document.getElementById('esmpp-pass').value;
    const whitelist = document.getElementById('esmpp-whitelist').value.trim();
    const bindType = document.getElementById('esmpp-bind-type').value;

    if (!company) { toast('Company name is required', 'error'); return; }
    if (!host) { toast('Host/IP is required', 'error'); return; }
    if (!systemId) { toast('System ID is required', 'error'); return; }
    if (port < 1 || port > 65535) { toast('Port must be between 1 and 65535', 'error'); return; }

    const btn = document.getElementById('esmpp-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Saving...';
    }

    const payload = {
      company,
      host,
      port,
      limit,
      system_id: systemId,
      whitelist_ip: whitelist || '',
      bind_type: bindType || 'transceiver'
    };

    if (password && password.length >= 4 && password.length <= 8) {
      payload.password = password;
    }

    const result = await apiFetch(`/api/smpp/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    if (result && result.id) {
      closeModal();
      toast(`✅ SMPP Account "${company}" updated successfully!`, 'success');
      renderSmppAccounts();
    } else {
      toast(result?.error || 'Failed to update account', 'error');
    }
  } catch (err) {
    console.error('Edit SMPP account error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('esmpp-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  STANDARD WEBHOOK — HTTP INTERCONNECT
// ════════════════════════════════════════════════════════════════════

async function renderStandardWebhook() {
  try {
    const cfg = await apiFetch('/api/webhook/config') || {};

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Standard Webhook</div>
          <div class="page-subtitle">HTTP interconnect for SMS forwarding</div>
        </div>
      </div>
      ${renderOwnerHubTabs('settings', 'api-tokens')}
      ${renderApiWebhooksTabs('webhook')}

      <div class="card" style="margin-bottom:20px;background:rgba(76,110,245,0.05);border-left:4px solid var(--accent);">
        <div style="padding:16px;">
          <h4 style="margin-bottom:8px;">📋 HTTP Interconnect Setup</h4>
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">
            Method can be <strong>GET</strong> or <strong>POST</strong>. Please confirm which one is preferred with your provider.
          </p>
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">
            <strong>IP Whitelist:</strong> Please allow following IP addresses on your firewall:
            <code>130.117.83.34</code> and <code>130.117.83.32</code>
          </p>
          <p style="font-size:13px;color:var(--text-secondary);">
            <strong>Message Format:</strong> <code>from</code> (sender CLI), <code>to</code> (recipient number),
            <code>message</code> (SMS body), <code>sms_id</code> (unique ID)
          </p>
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-header"><div class="card-title">Webhook Configuration</div></div>
          <form id="webhook-form" onsubmit="saveWebhook(event)">
            <div class="form-group">
              <label class="form-label">Webhook URL <span class="text-danger">*</span></label>
              <input value="${cfg.url || ''}" id="wh-url" placeholder="https://your-server.com/webhook" required>
              <small class="text-muted">Provide this URL to your upstream provider</small>
            </div>
            <div class="form-group">
              <label class="form-label">HTTP Method</label>
              <select id="wh-method">
                <option ${cfg.method === 'POST' ? 'selected' : ''}>POST</option>
                <option ${cfg.method === 'GET' ? 'selected' : ''}>GET</option>
              </select>
              <small class="text-muted">Confirm with provider which method is preferred</small>
            </div>
            <div class="form-group">
              <label class="form-label">Secret Key</label>
              <input value="${cfg.secret || ''}" id="wh-secret" placeholder="Webhook secret for validation">
            </div>
            <div class="form-group">
              <label class="form-label">Retry Count</label>
              <input type="number" value="${cfg.retry || 3}" id="wh-retry" min="1" max="10">
            </div>
            <div class="form-group">
              <label class="form-label">Timeout (seconds)</label>
              <input type="number" value="${cfg.timeout || 30}" id="wh-timeout" min="5" max="120">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" id="wh-submit-btn">
                <i class="fas fa-save"></i> Save
              </button>
              <button type="button" class="btn btn-outline" onclick="testWebhook()">
                <i class="fas fa-paper-plane"></i> Test
              </button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Sample Payload</div>
            <button class="btn btn-outline btn-sm" onclick="copySamplePayload()">
              <i class="fas fa-copy"></i> Copy
            </button>
          </div>
          <div class="code-block" style="font-size:13px;">
            <pre style="margin:0;white-space:pre-wrap;word-wrap:break-word;">
{
  "from": "+1234567890",
  "to": "+12025551234",
  "message": "Your verification code is 123456",
  "sms_id": "sms_abc123xyz"
}</pre>
          </div>
          <div style="margin-top:16px;padding:12px;background:var(--bg-tertiary);border-radius:8px;">
            <p style="font-size:12px;color:var(--text-muted);">
              <strong>GET Example:</strong>
              <code style="display:block;margin-top:4px;word-break:break-all;font-size:11px;">
                https://your-server.com/webhook?from=+1234567890&to=+12025551234&message=Your+code+is+123456&sms_id=sms_abc123
              </code>
            </p>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Webhook error:', err);
    toast('Failed to load webhook config', 'error');
  }
}

function copySamplePayload() {
  const payload = JSON.stringify({
    from: "+1234567890",
    to: "+12025551234",
    message: "Your verification code is 123456",
    sms_id: "sms_abc123xyz"
  }, null, 2);

  navigator.clipboard.writeText(payload).then(() => {
    toast('Sample payload copied to clipboard', 'success');
  }).catch(() => {
    toast('Failed to copy', 'error');
  });
}

async function saveWebhook(event) {
  event.preventDefault();

  try {
    const url = document.getElementById('wh-url').value.trim();
    if (!url) {
      toast('Webhook URL is required', 'error');
      return;
    }

    const btn = document.getElementById('wh-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Saving...';
    }

    const payload = {
      url: url,
      method: document.getElementById('wh-method').value,
      secret: document.getElementById('wh-secret').value,
      retry: parseInt(document.getElementById('wh-retry').value) || 3,
      timeout: parseInt(document.getElementById('wh-timeout').value) || 30
    };

    const result = await apiFetch('/api/webhook/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (result && result.success) {
      toast('Webhook saved successfully', 'success');
    } else {
      toast(result?.error || 'Failed to save webhook', 'error');
    }
  } catch (err) {
    console.error('Save webhook error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('wh-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> Save';
    }
  }
}

async function testWebhook() {
  try {
    toast('Testing webhook...', 'info');

    const result = await apiFetch('/api/webhook/test', {
      method: 'POST',
      body: JSON.stringify({ test: true, event: 'otp_received' })
    });

    if (result && result.success) {
      toast(`✅ Webhook OK — ${result.response_time_ms || '—'}ms`, 'success');
    } else {
      toast('❌ Webhook test failed', 'error');
    }
  } catch (err) {
    console.error('Test webhook error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════════════
//  MY NUMBERS
// ════════════════════════════════════════════════════════════════════

let ZY_OWNER_RANGES = [], ZY_OWNER_AGENTS = [], ZY_OWNER_CLIENTS = [], ZY_OWNER_ALL_NUMS = [], ZY_OWNER_NUMROWS = [];
let ZY_OWNER_RANGE_BY_ID = {}, ZY_OWNER_RANGE_LOOKUP = {}, ZY_OWNER_RATE_LOOKUP = {}, ZY_OWNER_AG_BY_ID = {}, ZY_OWNER_CL_BY_ID = {};

async function renderMyNumbers(page = 1, search = '', status = '') {
  try {
    const c = document.getElementById('page-content');
    if (typeof zyCrumb === 'function') {
      zyCrumb(['Virtual Numbers', 'Manage Numbers Pool']);
    }

    c.innerHTML = `
      ${renderOwnerHubTabs('numbers', 'my-numbers')}
      <div class="zy-intro">Here you can view, filter, and manage virtual phone numbers in the Master Pool, allocate numbers to Agents or Clients, or unallocate back to pool.</div>

      <!-- APX Telecom-Switch My Numbers Filter & Actions Card -->
      <div class="apx-card zy-num-card">
        <div class="apx-card-header">
          <div class="apx-card-title">
            <i class="fas fa-filter"></i> Filters &amp; Pool Controls
          </div>
          <div class="apx-card-actions">
            <button type="button" class="apx-btn apx-btn-primary apx-btn-small" onclick="zyOwnerAllocateAll()" data-apx-tooltip="Allocate Selected Numbers">
              <i class="fas fa-user-plus"></i> Allocate
            </button>
            <button type="button" class="apx-btn apx-btn-warning apx-btn-small" onclick="zyOwnerUnassignSelected()" data-apx-tooltip="Unallocate back to Pool">
              <i class="fas fa-rotate-left"></i> Unallocate
            </button>
            <button type="button" class="apx-btn apx-btn-success apx-btn-small" onclick="openAuraAddNumberModal()" data-apx-tooltip="Add Virtual Numbers">
              <i class="fas fa-plus"></i> Add
            </button>
            <button type="button" class="apx-btn apx-btn-small" onclick="loadPage('upload-numbers')" data-apx-tooltip="Upload CSV File">
              <i class="fas fa-cloud-arrow-up"></i> CSV
            </button>
            <button type="button" class="apx-btn apx-btn-danger apx-btn-small" onclick="zyOwnerDeleteSelected()" data-apx-tooltip="Delete Selected">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
        <div class="apx-card-body" style="padding:14px;">
          <div class="apx-filter-fields-row" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;align-items:flex-end;">
            <div>
              <label class="zy-filter-label" for="num-range-filter" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">Range</label>
              <select id="num-range-filter" class="apx-select" style="width:100%;height:38px;max-height:38px;border:1.5px solid #cbd5e1;border-radius:6px;background:#ffffff;padding:0 10px;font-size:13px;color:#1e293b;box-sizing:border-box;" onchange="zyOwnerNumFilter()">
                <option value="">All Ranges</option>
              </select>
            </div>
            <div>
              <label class="zy-filter-label" for="num-agent-filter" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">Agent</label>
              <select id="num-agent-filter" class="apx-select" style="width:100%;height:38px;max-height:38px;border:1.5px solid #cbd5e1;border-radius:6px;background:#ffffff;padding:0 10px;font-size:13px;color:#1e293b;box-sizing:border-box;" onchange="zyOwnerNumFilter()">
                <option value="">All Agents</option>
              </select>
            </div>
            <div>
              <label class="zy-filter-label" for="num-client-filter" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">Client</label>
              <select id="num-client-filter" class="apx-select" style="width:100%;height:38px;max-height:38px;border:1.5px solid #cbd5e1;border-radius:6px;background:#ffffff;padding:0 10px;font-size:13px;color:#1e293b;box-sizing:border-box;" onchange="zyOwnerNumFilter()">
                <option value="">All Clients</option>
              </select>
            </div>
            <div>
              <label class="zy-filter-label" for="num-status" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">Status</label>
              <select id="num-status" class="apx-select" style="width:100%;height:38px;max-height:38px;border:1.5px solid #cbd5e1;border-radius:6px;background:#ffffff;padding:0 10px;font-size:13px;color:#1e293b;box-sizing:border-box;" onchange="zyOwnerNumFilter()">
                <option value="">All Statuses</option>
                <option value="unassigned">Master Pool (Free)</option>
                <option value="assigned">Assigned</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div>
              <label class="zy-filter-label" for="num-filter" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">Search Number</label>
              <input type="text" id="num-filter" class="apx-input" placeholder="e.g. 447123, range, agent..." style="width:100%;height:38px;max-height:38px;border:1.5px solid #cbd5e1;border-radius:6px;background:#ffffff;padding:0 10px;font-size:13px;color:#1e293b;box-sizing:border-box;" oninput="zyOwnerNumSearchInput()" onkeydown="if(event.key==='Enter'){event.preventDefault();zyOwnerNumFilter();}">
            </div>
          </div>
          <div class="zy-filter-actions" style="display:flex;gap:8px;align-items:center;margin-top:14px;flex-wrap:wrap;">
            <button type="button" class="zy-btn-blue-solid" style="height:38px;padding:0 22px;font-size:12.5px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;background:#2563eb;color:#ffffff;border:none;cursor:pointer;" onclick="zyOwnerNumFilter()">
              <i class="fas fa-filter"></i> Apply Filter
            </button>
            <button type="button" class="zy-btn-reset" style="height:38px;padding:0 18px;font-size:12.5px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;" onclick="zyOwnerResetNumFilter()" title="Reset Filters">
              <i class="fas fa-undo"></i> Reset Filters
            </button>
          </div>
        </div>
      </div>

      <!-- Table Panel with Toolbar matching Frame 02 -->
      <div class="apx-card zy-panel">
        <div class="apx-card-header zy-panel-head">
          <div class="apx-card-title">
            <i class="fas fa-hashtag"></i> Manage Numbers Pool
            <span id="owner-numbers-total-badge" class="badge badge-blue" style="margin-left:8px;font-size:11px;display:none;"></span>
          </div>
        </div>
        <div class="apx-card-body zy-panel-body" id="owner-numbers-body" style="padding:0;"><div class="zy-loading" style="padding:30px;text-align:center;">Loading numbers pool…</div></div>
      </div>
      ${typeof zyRenderFab === 'function' ? zyRenderFab('Need numbers? Tap here', 'zyOwnerAllocateAll()') : ''}
    `;

    const [rangesData, rateCardData, clientsData, agentsData] = await Promise.all([
      apiFetch('/api/numbers/sms-ranges'),
      apiFetch('/api/numbers/rate-card'),
      apiFetch('/api/clients?limit=5000'),
      apiFetch('/api/agents?limit=5000')
    ]);

    const ranges = (rangesData && rangesData.data) || (Array.isArray(rangesData) ? rangesData : []);
    const rateCard = (rateCardData && rateCardData.data) || (Array.isArray(rateCardData) ? rateCardData : []);
    const clients = (clientsData && clientsData.data) || (Array.isArray(clientsData) ? clientsData : []);
    const agents = (agentsData && agentsData.data) || (Array.isArray(agentsData) ? agentsData : []);

    ZY_OWNER_RANGES = ranges;
    ZY_OWNER_AGENTS = agents;
    ZY_OWNER_CLIENTS = clients;

    ZY_OWNER_RANGE_BY_ID = {}; ranges.forEach(r => { ZY_OWNER_RANGE_BY_ID[r.id] = r; });
    ZY_OWNER_RANGE_LOOKUP = {}; ranges.forEach(r => { ZY_OWNER_RANGE_LOOKUP[`${r.country}|${r.provider}`] = r; });
    ZY_OWNER_RATE_LOOKUP = {}; rateCard.forEach(r => { ZY_OWNER_RATE_LOOKUP[`${r.country}|${r.provider}`] = r; });
    ZY_OWNER_AG_BY_ID = {}; agents.forEach(a => { ZY_OWNER_AG_BY_ID[a.id] = a.username; });
    ZY_OWNER_CL_BY_ID = {}; clients.forEach(cl => { ZY_OWNER_CL_BY_ID[cl.id] = cl.username; });

    // Populate Range Filter
    const rangeSel = document.getElementById('num-range-filter');
    if (rangeSel) {
      rangeSel.innerHTML = '<option value="">All Ranges</option>' + ranges.map(r => {
        const rName = r.range_name || r.name || r.country || 'Range';
        const extra = r.prefix ? ` (${r.prefix})` : '';
        return `<option value="${escapeHtml(String(r.id))}">${escapeHtml(rName + extra)}</option>`;
      }).join('');
    }

    // Populate Agent Filter
    const agSel = document.getElementById('num-agent-filter');
    if (agSel) {
      agSel.innerHTML = '<option value="">All Agents</option>' + agents.map(a => `<option value="${escapeHtml(String(a.id))}">${escapeHtml(a.username || '')}</option>`).join('');
    }

    // Populate Client Filter
    const clSel = document.getElementById('num-client-filter');
    if (clSel) {
      clSel.innerHTML = '<option value="">All Clients</option>' + clients.map(cl => `<option value="${escapeHtml(String(cl.id))}">${escapeHtml(cl.username || '')}</option>`).join('');
    }

    if (search) {
      const fEl = document.getElementById('num-filter');
      if (fEl) fEl.value = search;
    }
    if (status) {
      const sEl = document.getElementById('num-status');
      if (sEl) sEl.value = status;
    }

    await zyOwnerLoadNumbers(page || 1);
  } catch (err) {
    console.error('My Numbers error:', err);
    toast('Failed to load numbers', 'error');
  }
}

async function zyOwnerLoadNumbers(targetPage = 1) {
  const bodyEl = document.getElementById('owner-numbers-body');
  if (!bodyEl) return;

  if (window._zyOwnerNumAbort) {
    try { window._zyOwnerNumAbort.abort(); } catch (_) {}
  }
  window._zyOwnerNumAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const reqSignal = window._zyOwnerNumAbort ? window._zyOwnerNumAbort.signal : undefined;

  const rangeVal = document.getElementById('num-range-filter')?.value || '';
  const agVal = document.getElementById('num-agent-filter')?.value || '';
  const clVal = document.getElementById('num-client-filter')?.value || '';
  const statusVal = document.getElementById('num-status')?.value || '';
  const searchVal = (document.getElementById('num-filter')?.value || '').trim();
  const perPage = Number(window._zyOwnerNumLimit) || 25;

  const params = new URLSearchParams();
  params.set('page', String(Math.max(1, parseInt(targetPage, 10) || 1)));
  params.set('limit', String(perPage));
  if (rangeVal) params.set('range', rangeVal);
  if (agVal) params.set('agent_id', agVal);
  if (clVal) params.set('client_id', clVal);
  if (statusVal) params.set('status', statusVal);
  if (searchVal) params.set('search', searchVal);

  bodyEl.innerHTML = '<div class="zy-loading" style="padding:30px;text-align:center;">Loading numbers…</div>';

  try {
    const res = await apiFetch(`/api/numbers?${params.toString()}`, { signal: reqSignal });
    if (!res) return;

    const numbers = Array.isArray(res.data) ? res.data : [];
    const total = Number(res.total != null ? res.total : numbers.length);
    const totalPages = Math.max(1, Number(res.total_pages) || Math.ceil(total / perPage));
    const currentPage = Math.max(1, Math.min(Number(res.page) || targetPage || 1, totalPages));

    window._zyOwnerNumPage = currentPage;
    ZY_OWNER_ALL_NUMS = numbers;
    window._currentNumbersList = numbers;

    const badge = document.getElementById('owner-numbers-total-badge');
    if (badge) {
      badge.textContent = `${total.toLocaleString()} number${total === 1 ? '' : 's'}`;
      badge.style.display = 'inline-flex';
    }

    const rows = numbers.map(n => {
      const rInfo = (n.range_id && ZY_OWNER_RANGE_BY_ID[n.range_id]) || ZY_OWNER_RANGE_LOOKUP[`${n.country}|${n.provider}`] || null;
      const rateInfo = ZY_OWNER_RATE_LOOKUP[`${n.country}|${n.provider}`] || null;

      // Agents column: show ONLY the Agent username (never client username or extra tags)
      let agentVal = '';
      if (n.agent_id && ZY_OWNER_AG_BY_ID[n.agent_id]) {
        agentVal = ZY_OWNER_AG_BY_ID[n.agent_id];
      } else if (n.agent_username && String(n.agent_username).trim()) {
        agentVal = String(n.agent_username).trim();
      } else if (n.agent && !['unassigned', 'unallocated', '—', '-'].includes(String(n.agent).trim().toLowerCase())) {
        agentVal = String(n.agent).trim();
      }
      const agentHtml = agentVal ? `<span class="fw-600">${escapeHtml(agentVal)}</span>` : '—';

      const dateCell = typeof zyFormatNumberDateCell === 'function'
        ? zyFormatNumberDateCell(n, 'owner')
        : { v: String(n.assigned_at || n.created_at || n.created || '').slice(0, 10), h: String(n.assigned_at || n.created_at || n.created || '—').slice(0, 10) };

      const rangeDisplayName = n.range_name || n.range_label || rInfo?.range_name || rInfo?.name || n.country || '—';
      const rawPrefix = rInfo?.prefix || n.prefix || '';
      const prefixDisplay = String(rawPrefix).trim().replace(/^\++/, '') || '—';
      const cleanNumber = String(n.number || '').trim().replace(/^\++/, '');
      const carrierCost = (rInfo?.cost ?? rInfo?.company_cost ?? rateInfo?.buy_rate ?? n.cost) ?? 0;
      const agentPayout = (rInfo?.payout ?? rateInfo?.sell_rate ?? n.agent_rate ?? n.payout) ?? 0;
      const isAssigned = !!(n.client_id || n.agent_id);

      const numBox = typeof zyRenderNumberCopyBox === 'function'
        ? zyRenderNumberCopyBox(cleanNumber)
        : `<span class="monospace fw-600">${escapeHtml(cleanNumber || '—')}</span>`;
      const r = [
        dateCell,
        escapeHtml(rangeDisplayName),
        escapeHtml(prefixDisplay),
        { v: cleanNumber, h: numBox },
        { v: agentVal || '—', h: agentHtml },
        `$ ${carrierCost}`,
        `$ ${agentPayout}`,
        { v: '', h: `<span style="font-size:11px;color:var(--text-muted);">SD: <b>${n.sd_limit ?? 0}</b> | OTP: <b>${n.otp_limit ?? 0}</b></span>` },
        statusBadge(n.status || 'active'),
        { v: '', h: `<div style="display:inline-flex;gap:4px;align-items:center;justify-content:center;">` +
          (isAssigned
            ? `<button class="zy-rowbtn" onclick="zyOwnerUnassignOne(${n.id})" title="Unallocate back to Master Pool">${typeof zyImg === 'function' ? zyImg('btn_row_x') : '<i class="fas fa-rotate-left"></i>'}</button>`
            : `<button class="zy-rowbtn" onclick="zyOwnerAllocateOne(${n.id})" title="Allocate to Agent / Client">${typeof zyImg === 'function' ? zyImg('btn_alloc') : '<i class="fas fa-user-plus"></i>'}</button>`) +
          `<button class="zy-rowbtn" onclick="zyOwnerDeleteOne(${n.id},'${cleanNumber.replace(/'/g, "\\'")}')" title="Delete Number">${typeof zyImg === 'function' ? zyImg('btn_unassign') : '<i class="fas fa-trash"></i>'}</button>` +
          `</div>` }
      ];
      r.__id = n.id;
      r.__raw = n;
      return r;
    });

    ZY_OWNER_NUMROWS = rows;
    if (typeof zyDT2 === 'function') {
      bodyEl.innerHTML = zyDT2('dt-numbers', {
        cols: ['Date', 'Range', 'Prefix', 'Number', 'Agents', 'Cost', 'Payout', 'Limits', 'Status', 'Action'],
        rows,
        check: true,
        perPage,
        serverMode: true,
        totalRecords: total,
        totalPages,
        page: currentPage,
        onPageChange: (p) => zyOwnerLoadNumbers(p),
        onSizeChange: (s) => {
          window._zyOwnerNumLimit = s;
          zyOwnerLoadNumbers(1);
        }
      });
      if (typeof zy2Render === 'function') zy2Render('dt-numbers');
    } else {
      bodyEl.innerHTML = '<div class="zy-empty-state">Data engine ready.</div>';
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('My Numbers load error:', err);
    bodyEl.innerHTML = '<div class="zy-empty" style="padding:30px;text-align:center;color:#ef4444;">Failed to load numbers pool. Please try again.</div>';
  }
}

function zyOwnerNumSearchInput() {
  if (window._zyOwnerNumSearchTimer) clearTimeout(window._zyOwnerNumSearchTimer);
  window._zyOwnerNumSearchTimer = setTimeout(() => {
    zyOwnerLoadNumbers(1);
  }, 280);
}

function zyOwnerNumFilter() {
  if (window._zyOwnerNumSearchTimer) clearTimeout(window._zyOwnerNumSearchTimer);
  zyOwnerLoadNumbers(1);
}

function zyOwnerResetNumFilter() {
  if (window._zyOwnerNumSearchTimer) clearTimeout(window._zyOwnerNumSearchTimer);
  const r = document.getElementById('num-range-filter'); if (r) r.value = '';
  const a = document.getElementById('num-agent-filter'); if (a) a.value = '';
  const c = document.getElementById('num-client-filter'); if (c) c.value = '';
  const s = document.getElementById('num-status'); if (s) s.value = '';
  const f = document.getElementById('num-filter'); if (f) f.value = '';

  zyOwnerLoadNumbers(1);
  toast('Filters reset', 'info');
}

function zyOwnerAllocateAll() {
  const ids = typeof zy2Checked === 'function' ? zy2Checked('dt-numbers') : [];
  if (!ids.length) {
    toast('Please select numbers from the table first', 'warning');
    return;
  }
  const picked = (ZY_OWNER_ALL_NUMS || []).filter(n => ids.includes(String(n.id))).map(n => n.number || n.id);

  const modalHtml = `
    <div style="font-size:13px;line-height:1.5;">
      <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Selected Numbers (${picked.length})</label>
      <div class="zy-numlist" style="max-height:85px;overflow-y:auto;background:#f8fafc;padding:8px 10px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px;margin-bottom:12px;color:#334155;word-break:break-all;">
        ${picked.length ? picked.join(', ') : 'No numbers selected'}
      </div>

      <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Allocate Target Type</label>
      <select id="al-owner-type" class="zy-input" style="height:34px;margin-bottom:12px;" onchange="zyToggleOwnerTargetType()">
        <option value="agent" selected>Agent</option>
        <option value="client">Client</option>
      </select>

      <div id="al-owner-ag-wrap">
        <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Select Agent *</label>
        <select id="al-owner-agent" class="zy-input" style="height:34px;margin-bottom:12px;">
          <option value="">— Select Agent —</option>
          ${(ZY_OWNER_AGENTS || []).filter(a => a.status !== 'inactive').map(a => `<option value="${a.id}">${mUsername(a)}</option>`).join('')}
        </select>
      </div>

      <div id="al-owner-cl-wrap" style="display:none;">
        <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Select Client *</label>
        <select id="al-owner-client" class="zy-input" style="height:34px;margin-bottom:12px;">
          <option value="">— Select Client —</option>
          ${(ZY_OWNER_CLIENTS || []).filter(cl => cl.status !== 'inactive').map(cl => `<option value="${cl.id}">${cl.username}</option>`).join('')}
        </select>
      </div>

      <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Payterm</label>
      <select id="al-owner-pay" class="zy-input" style="height:34px;margin-bottom:12px;">
        <option value="Weekly" selected>Weekly (7/3) — 3 Day Hold</option>
        <option value="Biweekly">Biweekly (15/3) — 3 Day Hold</option>
        <option value="Monthly">Monthly (30/5) {W} — 5 Day Hold</option>
      </select>
    </div>
  `;

  const footerHtml = `
    <button class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button class="zy-btn-blue" onclick="zyDoOwnerAllocate(${JSON.stringify(ids).replace(/"/g, '&quot;')})"><i class="fas fa-user-plus" style="margin-right:4px;"></i> Allocate Now</button>
  `;

  if (typeof zyModal === 'function') {
    zyModal(`Allocate ${ids.length} Number(s)`, modalHtml, footerHtml);
  } else {
    openModal(`Allocate ${ids.length} Number(s)`, modalHtml + `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">${footerHtml}</div>`);
  }
}

function mUsername(u) { return u && u.username ? u.username : ''; }

function zyToggleOwnerTargetType() {
  const type = document.getElementById('al-owner-type')?.value || 'agent';
  const agWrap = document.getElementById('al-owner-ag-wrap');
  const clWrap = document.getElementById('al-owner-cl-wrap');
  if (agWrap) agWrap.style.display = type === 'agent' ? 'block' : 'none';
  if (clWrap) clWrap.style.display = type === 'client' ? 'block' : 'none';
}

async function zyDoOwnerAllocate(ids) {
  const type = document.getElementById('al-owner-type')?.value || 'agent';
  const targetId = document.getElementById(`al-owner-${type === 'agent' ? 'agent' : 'client'}`)?.value;
  const payterm = document.getElementById('al-owner-pay')?.value || 'Weekly';

  if (!targetId) {
    toast(`Please select a ${type}`, 'error');
    return;
  }
  if (!ids || !ids.length) {
    toast('No numbers selected', 'error');
    return;
  }

  try {
    const payload = {
      number_ids: ids.map(Number),
      target_type: type,
      target_id: Number(targetId),
      payterm,
      notes: 'Allocated from Owner panel'
    };
    if (type === 'agent') payload.agent_id = Number(targetId);
    if (type === 'client') payload.client_id = Number(targetId);

    const res = await apiFetch('/api/numbers/bulk-assign-many', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    closeModal();
    toast(`✅ Allocated ${res?.assigned || ids.length} number(s) to ${type}!`, 'success');
    zyOwnerLoadNumbers(window._zyOwnerNumPage || 1);
  } catch (err) {
    console.error(err);
    toast(err?.message || 'Failed to allocate numbers', 'error');
  }
}

function zyOwnerAllocateOne(numberId) {
  const n = (ZY_OWNER_ALL_NUMS || []).find(x => x.id === numberId || String(x.id) === String(numberId)) || {};
  const numStr = n.number || numberId;

  const modalHtml = `
    <div style="font-size:13px;line-height:1.5;">
      <div style="margin-bottom:12px;padding:8px 10px;background:#f8fafc;border-radius:4px;border:1px solid #cbd5e1;font-weight:600;">
        Number: <span class="monospace" style="color:var(--brand-primary,#166534);">${numStr}</span>
      </div>

      <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Target Type</label>
      <select id="al-single-type" class="zy-input" style="height:34px;margin-bottom:12px;" onchange="zyToggleSingleTargetType()">
        <option value="agent" selected>Agent</option>
        <option value="client">Client</option>
      </select>

      <div id="al-single-ag-wrap">
        <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Select Agent *</label>
        <select id="al-single-ag" class="zy-input" style="height:34px;margin-bottom:12px;">
          <option value="">— Select Agent —</option>
          ${(ZY_OWNER_AGENTS || []).filter(a => a.status !== 'inactive').map(a => `<option value="${a.id}">${a.username}</option>`).join('')}
        </select>
      </div>

      <div id="al-single-cl-wrap" style="display:none;">
        <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Select Client *</label>
        <select id="al-single-cl" class="zy-input" style="height:34px;margin-bottom:12px;">
          <option value="">— Select Client —</option>
          ${(ZY_OWNER_CLIENTS || []).filter(cl => cl.status !== 'inactive').map(cl => `<option value="${cl.id}">${cl.username}</option>`).join('')}
        </select>
      </div>

      <label class="zy-lbl" style="font-weight:700;margin-bottom:4px;display:block;">Payterm</label>
      <select id="al-single-pay" class="zy-input" style="height:34px;margin-bottom:12px;">
        <option value="Weekly" selected>Weekly (7/3) — 3 Day Hold</option>
        <option value="Biweekly">Biweekly (15/3) — 3 Day Hold</option>
        <option value="Monthly">Monthly (30/5) {W} — 5 Day Hold</option>
      </select>
    </div>
  `;

  const footerHtml = `
    <button class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button class="zy-btn-blue" onclick="zyDoOwnerAllocateOne(${numberId})"><i class="fas fa-user-plus" style="margin-right:4px;"></i> Allocate</button>
  `;

  if (typeof zyModal === 'function') {
    zyModal(`Allocate Number — ${numStr}`, modalHtml, footerHtml);
  } else {
    openModal(`Allocate Number — ${numStr}`, modalHtml + `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">${footerHtml}</div>`);
  }
}

function zyToggleSingleTargetType() {
  const type = document.getElementById('al-single-type')?.value || 'agent';
  const agWrap = document.getElementById('al-single-ag-wrap');
  const clWrap = document.getElementById('al-single-cl-wrap');
  if (agWrap) agWrap.style.display = type === 'agent' ? 'block' : 'none';
  if (clWrap) clWrap.style.display = type === 'client' ? 'block' : 'none';
}

async function zyDoOwnerAllocateOne(numberId) {
  const type = document.getElementById('al-single-type')?.value || 'agent';
  const targetId = document.getElementById(`al-single-${type === 'agent' ? 'ag' : 'cl'}`)?.value;
  const payterm = document.getElementById('al-single-pay')?.value || 'Weekly';

  if (!targetId) {
    toast(`Please select a ${type}`, 'error');
    return;
  }

  try {
    const payload = { target_type: type, target_id: Number(targetId), payterm };
    if (type === 'agent') payload.agent_id = Number(targetId);
    if (type === 'client') payload.client_id = Number(targetId);

    const res = await apiFetch(`/api/numbers/${numberId}/assign`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res && res.error) {
      toast(res.error, 'error');
    } else {
      closeModal();
      toast('✅ Number allocated successfully!', 'success');
      zyOwnerLoadNumbers(window._zyOwnerNumPage || 1);
    }
  } catch (err) {
    console.error(err);
    toast('Failed to allocate number', 'error');
  }
}

async function zyOwnerUnassignSelected() {
  const ids = typeof zy2Checked === 'function' ? zy2Checked('dt-numbers') : [];
  if (!ids.length) {
    toast('Please select numbers from the table first', 'warning');
    return;
  }
  if (!confirm(`Unallocate ${ids.length} selected number(s) back to the Master Pool?`)) return;

  try {
    const res = await apiFetch('/api/numbers/bulk-unassign-many', {
      method: 'POST',
      body: JSON.stringify({ number_ids: ids.map(Number) })
    });
    toast(`✅ Unallocated ${res?.revoked || ids.length} number(s) to Master Pool`, 'warning');
    zyOwnerLoadNumbers(window._zyOwnerNumPage || 1);
  } catch (err) {
    console.error(err);
    toast('Failed to unallocate numbers', 'error');
  }
}

async function zyOwnerUnassignOne(numberId) {
  if (!confirm('Unallocate this number back to Master Pool?')) return;
  try {
    const res = await apiFetch(`/api/numbers/${numberId}/unassign`, { method: 'POST' });
    if (res && (res.success || res.id)) {
      toast('✅ Number unallocated to Master Pool', 'warning');
      zyOwnerLoadNumbers(window._zyOwnerNumPage || 1);
    } else {
      toast(res?.error || 'Failed to unallocate number', 'error');
    }
  } catch (err) {
    console.error(err);
    toast('Failed to unallocate number', 'error');
  }
}

async function zyOwnerDeleteSelected() {
  const ids = typeof zy2Checked === 'function' ? zy2Checked('dt-numbers') : [];
  if (!ids.length) {
    toast('Please select numbers from the table first', 'warning');
    return;
  }
  if (!confirm(`Permanently delete ${ids.length} selected number(s)? This cannot be undone.`)) return;

  try {
    const res = await apiFetch('/api/numbers/bulk-delete-many', {
      method: 'POST',
      body: JSON.stringify({ number_ids: ids.map(Number) })
    });
    toast(`🗑️ Permanently deleted ${res?.deleted ?? ids.length} number(s)`, 'warning');
    zyOwnerLoadNumbers(window._zyOwnerNumPage || 1);
  } catch (err) {
    console.error(err);
    toast('Failed to delete numbers', 'error');
  }
}

async function zyOwnerDeleteOne(numberId, numStr) {
  const displayNum = numStr || numberId;
  if (!confirm(`Permanently delete number ${displayNum}? This cannot be undone.`)) return;

  try {
    const res = await apiFetch(`/api/numbers/${encodeURIComponent(numberId)}`, { method: 'DELETE' });
    if (!res) return;
    toast('🗑️ Number permanently deleted', 'warning');
    zyOwnerLoadNumbers(window._zyOwnerNumPage || 1);
  } catch (err) {
    console.error(err);
    toast('Failed to delete number', 'error');
  }
}

// Backward-compatible bindings for My Numbers
function resetNumberFilters() { zyOwnerResetNumFilter(); }
function adminAssignSelected() { zyOwnerAllocateAll(); }
function adminRevokeSelected() { zyOwnerUnassignSelected(); }
function adminDeleteSelected() { zyOwnerDeleteSelected(); }
function adminReturnSelected() { zyOwnerUnassignSelected(); }
function adminRevokeOne(numberId) { zyOwnerUnassignOne(numberId); }
function adminDeleteOne(numberId, number) { zyOwnerDeleteOne(numberId, number); }
function adminQuickAssign(numberId, number) { zyOwnerAllocateOne(numberId); }

// ══════════════════════════════════════════════════════════════
// AURA SOFTSWITCH 4-IN-1 ADD NUMBERS ENGINE
// Modes: 1=Single, 2=Series (Start+Count), 3=List (Textarea), 4=CSV
// ══════════════════════════════════════════════════════════════
async function openAuraAddNumberModal() {
  let ranges = [], agents = [];
  try {
    const [rangesRes, agentsRes] = await Promise.all([
      apiFetch('/api/numbers/sms-ranges').catch(() => []),
      apiFetch('/api/agents?limit=1000').catch(() => ({ data: [] }))
    ]);
    ranges = (Array.isArray(rangesRes) ? rangesRes : (rangesRes && rangesRes.data)) || [];
    agents = (agentsRes && agentsRes.data) || [];
  } catch (err) {
    console.warn('Could not pre-fetch ranges/agents:', err);
  }

  const rangeOptions = ranges.map(r => `<option value="${r.id}">${zyEsc(r.range_name || r.name || r.country || r.id)} (${zyEsc(r.prefix || '')})</option>`).join('');
  const agentOptions = agents.map(a => `<option value="${a.id}">${zyEsc(a.username || a.name || a.id)}</option>`).join('');

  openModal('Add Numbers (AURA 4-in-1 Softswitch)', `
    <form id="aura-add-num-form" onsubmit="submitAuraAddNumber(event)">
      <div class="aura-modal-3col">
        <!-- Col 1: Range & Number Input Modes -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-list-ol"></i> Number Creation Mode
          </h5>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Select Range *</label>
            <select id="aura-num-range" class="form-control" required style="width:100%;height:30px;font-size:12px;">
              <option value="">-- Choose Range --</option>
              ${rangeOptions}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Category</label>
            <select id="aura-num-category" class="form-control" style="width:100%;height:30px;font-size:12px;">
              <option value="General" selected>General</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:10px;">
            <label class="form-label" style="font-size:11px;font-weight:700;display:block;margin-bottom:4px;">Creation Mode:</label>
            <div style="display:flex;gap:8px;font-size:11.5px;flex-wrap:wrap;">
              <label><input type="radio" name="aura_mode" value="single" checked onchange="switchAuraNumMode('single')"> Single</label>
              <label><input type="radio" name="aura_mode" value="series" onchange="switchAuraNumMode('series')"> Series</label>
              <label><input type="radio" name="aura_mode" value="list" onchange="switchAuraNumMode('list')"> List</label>
            </div>
          </div>

          <!-- Single Mode -->
          <div id="aura-mode-single" class="aura-mode-box">
            <label class="form-label" style="font-size:11px;font-weight:700;">Single MSISDN *</label>
            <input type="text" id="aura-num-single" class="form-control" placeholder="e.g. 44712345678" style="width:100%;height:30px;font-size:12px;font-family:monospace;">
          </div>

          <!-- Series Mode -->
          <div id="aura-mode-series" class="aura-mode-box" style="display:none;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
              <div>
                <label class="form-label" style="font-size:11px;font-weight:700;">Start Number *</label>
                <input type="text" id="aura-num-start" class="form-control" placeholder="e.g. 44712345600" style="width:100%;height:30px;font-size:12px;font-family:monospace;">
              </div>
              <div>
                <label class="form-label" style="font-size:11px;font-weight:700;">Count / Length *</label>
                <input type="number" id="aura-num-count" class="form-control" value="50" min="1" max="10000" style="width:100%;height:30px;font-size:12px;">
              </div>
            </div>
          </div>

          <!-- List Mode -->
          <div id="aura-mode-list" class="aura-mode-box" style="display:none;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Paste Numbers (1 per line) *</label>
            <textarea id="aura-num-list" class="form-control" rows="5" placeholder="44712345601&#10;44712345602&#10;44712345603" style="width:100%;font-size:11px;font-family:monospace;"></textarea>
          </div>
        </div>

        <!-- Col 2: Limits & Test Numbers -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-gauge"></i> Daily Limits
          </h5>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Maximum SMS / Day</label>
            <input type="number" id="aura-num-max-day" class="form-control" value="0" style="width:100%;height:30px;font-size:12px;">
            <small style="color:#64748b;font-size:10px;">0 = Unlimited</small>
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Maximum SMS / Week</label>
            <input type="number" id="aura-num-max-week" class="form-control" value="0" style="width:100%;height:30px;font-size:12px;">
            <small style="color:#64748b;font-size:10px;">0 = Unlimited</small>
          </div>
        </div>

        <!-- Col 3: Direct Allocation Option -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-user-plus"></i> Optional Agent Allocation
          </h5>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Allocate to Agent (Optional)</label>
            <select id="aura-num-agent" class="form-control" style="width:100%;height:30px;font-size:12px;">
              <option value="">-- Keep in Master Pool (Free) --</option>
              ${agentOptions}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Payterm</label>
            <select id="aura-num-payterm" class="form-control" style="width:100%;height:30px;font-size:12px;">
              <option value="Weekly" selected>Weekly (7/3) — 3d Hold</option>
              <option value="Biweekly">Biweekly (15/3) — 3d Hold</option>
              <option value="Monthly">Monthly (30/5) {W} — 5d Hold</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Custom Agent Rate (Optional)</label>
            <input type="number" id="aura-num-rate" class="form-control" placeholder="Inherit from Range" step="0.0001" style="width:100%;height:30px;font-size:12px;font-family:monospace;">
          </div>
        </div>
      </div>

      <div class="form-actions" style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm" id="aura-num-submit-btn"><i class="fas fa-check"></i> Create Numbers</button>
      </div>
    </form>
  `);
}

window.switchAuraNumMode = function(mode) {
  document.getElementById('aura-mode-single').style.display = mode === 'single' ? 'block' : 'none';
  document.getElementById('aura-mode-series').style.display = mode === 'series' ? 'block' : 'none';
  document.getElementById('aura-mode-list').style.display = mode === 'list' ? 'block' : 'none';
};

async function submitAuraAddNumber(event) {
  event.preventDefault();
  const rangeId = document.getElementById('aura-num-range').value;
  if (!rangeId) {
    toast('Please select a range', 'error');
    return;
  }

  const mode = document.querySelector('input[name="aura_mode"]:checked')?.value || 'single';
  let numberList = [];

  if (mode === 'single') {
    const single = (document.getElementById('aura-num-single').value || '').trim();
    if (!single) {
      toast('Please enter a number', 'error');
      return;
    }
    numberList.push(single);
  } else if (mode === 'series') {
    const startStr = (document.getElementById('aura-num-start').value || '').trim();
    const count = parseInt(document.getElementById('aura-num-count').value, 10) || 0;
    if (!startStr || count <= 0) {
      toast('Please enter a valid start number and count', 'error');
      return;
    }
    try {
      const startBig = BigInt(startStr);
      for (let i = 0; i < count; i++) {
        numberList.push((startBig + BigInt(i)).toString());
      }
    } catch (e) {
      toast('Invalid start number format', 'error');
      return;
    }
  } else if (mode === 'list') {
    const raw = document.getElementById('aura-num-list').value || '';
    numberList = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!numberList.length) {
      toast('Please enter at least one number in the list', 'error');
      return;
    }
  }

  const btn = document.getElementById('aura-num-submit-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Creating...';
  }

  try {
    const payload = {
      range_id: rangeId,
      numbers: numberList.join('\n'),
      category: document.getElementById('aura-num-category')?.value || 'General',
      max_sms_day: parseInt(document.getElementById('aura-num-max-day')?.value, 10) || 0,
      max_sms_week: parseInt(document.getElementById('aura-num-max-week')?.value, 10) || 0,
      test_auto: 'none',
      agent_id: document.getElementById('aura-num-agent')?.value || '',
      payterm: document.getElementById('aura-num-payterm')?.value || 'Weekly',
      agent_rate: parseFloat(document.getElementById('aura-num-rate')?.value) || 0
    };

    const res = await apiFetch('/api/numbers/import-to-range', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res && (res.success || res.imported != null)) {
      closeModal();
      let msg = `✅ Successfully created ${res.imported ?? numberList.length} numbers!`;
      if (res.skipped_duplicates) {
        msg += ` (${res.skipped_duplicates} duplicate(s) skipped)`;
      }
      toast(msg, (res.imported > 0 || !res.skipped_duplicates) ? 'success' : 'warning');
      if (typeof renderMyNumbers === 'function') renderMyNumbers(1);
    } else {
      toast(res?.error || 'Failed to create numbers', 'error');
    }
  } catch (err) {
    console.error('Error creating numbers:', err);
    toast('Failed to create numbers', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> Create Numbers';
    }
  }
}

function copyAdminNumbers() {
  const nums = (ZY_OWNER_ALL_NUMS || []).map(n => n.number || '');
  navigator.clipboard.writeText(nums.join('\n')).then(() => toast('Numbers copied', 'success')).catch(() => toast('Copy failed', 'error'));
}

function exportAdminNumbersCsv() {
  if (typeof zy2Export === 'function') {
    zy2Export('dt-numbers', 'csv');
  } else if (typeof zyDownloadFile === 'function') {
    zyDownloadFile('/api/numbers/download', 'numbers.csv');
  }
}

function exportAdminNumbersPdf() {
  if (typeof zy2Export === 'function') {
    zy2Export('dt-numbers', 'pdf');
  } else {
    window.print();
  }
}

// ════════════════════════════════════════════════════════════════════
//  OTHER PAGES — Placeholder functions (will work with real API)
// ════════════════════════════════════════════════════════════════════

// ─── BULK ALLOCATION ──────────────────────────────────────────────
async function renderBulkAllocation() {
  try {
    const [agentsData, clientsData, ranges] = await Promise.all([
      apiFetch('/api/agents?limit=1000'),
      apiFetch('/api/clients?limit=1000'),
      apiFetch('/api/numbers/sms-ranges')
    ]);
    const agents = (agentsData?.data || []).filter(a => a && a.status !== 'inactive' && a.status !== 'suspended' && a.status !== 'blocked');
    const clients = (clientsData?.data || []).filter(c => c && c.status !== 'inactive' && c.status !== 'suspended' && c.status !== 'blocked');
    const rangeList = Array.isArray(ranges) ? ranges.filter(r => r.active !== false) : [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Bulk Allocation</div><div class="page-subtitle">Transfer numbers to Agents or Clients in bulk</div></div>
      </div>
      ${renderOwnerHubTabs('numbers', 'bulk-allocation')}
      <div class="two-col">
        <div class="card">
          <div class="card-header"><div class="card-title">Allocate Numbers</div></div>
          <form id="bulk-alloc-form" onsubmit="doBulkAllocate(event)">
            <div class="form-group">
              <label class="form-label">Allocate To</label>
              <select id="alloc-target-type" onchange="toggleAllocTargetOptions()">
                <option value="agent" selected>Agent</option>
                <option value="client">Client</option>
              </select>
              <small style="display:block;margin-top:4px;color:var(--text-muted);">Allocating to a Client automatically stamps their Agent on every number — keeping the 3-tier chain accurate.</small>
            </div>
            <div class="form-group" id="alloc-agent-wrap">
              <label class="form-label">Select Agent *</label>
              ${zySelectSearch('alloc-agent', 'Search agents…')}
              <select id="alloc-agent">
                <option value="">— Select Agent —</option>
                ${agents.map(a => `<option value="${a.id}">${a.username}</option>`).join('')}
              </select>
              ${!agents.length ? '<small class="text-danger">No active agents found.</small>' : ''}
            </div>
            <div class="form-group" id="alloc-client-wrap" style="display:none;">
              <label class="form-label">Select Client *</label>
              ${zySelectSearch('alloc-client', 'Search clients…')}
              <select id="alloc-client">
                <option value="">— Select Client —</option>
                ${clients.map(cl => `<option value="${cl.id}">${cl.username}</option>`).join('')}
              </select>
              ${!clients.length ? '<small class="text-danger">No active clients found.</small>' : ''}
            </div>
            <div class="form-group">
              <label class="form-label">Select Range (Block / Location)</label>
              <select id="alloc-range-id" onchange="onAllocRangeChange()">
                <option value="">— None (manual range or whole pool) —</option>
                ${rangeList.map(r => `<option value="${r.id}" data-available="${r.available ?? 0}">
                  ${r.range_name || r.country} — ${r.country || ''} / ${r.provider || ''} (${r.available ?? 0} available)
                </option>`).join('')}
              </select>
              <small id="alloc-range-avail" style="display:block;margin-top:4px;color:var(--text-muted);"></small>
            </div>
            <div class="form-group">
              <label class="form-label">Payterm (Settlement Schedule)</label>
              <select id="alloc-payterm">
                <option value="From range">From range (inherit range payterm)</option>
                <option value="Weekly">Weekly (7/3) — 3 Day Hold</option>
                <option value="Biweekly">Biweekly (15/3) — 3 Day Hold</option>
                <option value="Monthly">Monthly (30/5) {W} — 5 Day Hold</option>
              </select>
              <small style="display:block;margin-top:4px;color:var(--text-muted);">Weekly (7/3), Biweekly (15/3), or Monthly (30/5) {W} settlement schedule for this batch.</small>
            </div>
            <div class="form-group">
              <label class="form-label">Amount (how many numbers)</label>
              <input type="number" placeholder="100" id="alloc-count" min="1">
              <small style="display:block;margin-top:4px;color:var(--text-muted);">Pick a range above and an amount — that many numbers are pulled from that range only. Leave the range empty and only enter an amount to auto-pick from the whole free pool. If not enough numbers are free, you'll get "No free numbers available" instead of a partial allocation.</small>
            </div>
            <div class="form-group">
              <label class="form-label">Or — manual exact Number Range (advanced, optional)</label>
              <div class="form-row">
                <input placeholder="Start e.g. +12000000000" id="range-start">
                <input placeholder="End e.g. +12000999999" id="range-end">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Note (optional)</label>
              <textarea id="alloc-note" rows="2" placeholder="Allocation reason…"></textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" id="alloc-submit-btn"><i class="fas fa-plus"></i> Allocate</button>
            </div>
          </form>
        </div>
        <div class="card">
          <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;">
            <div class="card-title">Recent Allocation History</div>
          </div>
          <div id="alloc-history-box" style="padding:12px;">
            <div class="loading"><div class="spinner"></div> Loading history…</div>
          </div>
        </div>
      </div>
    `;
    setTimeout(loadRecentAllocHistory, 50);
  } catch (err) {
    console.error('Bulk allocation error:', err);
    toast('Failed to load users', 'error');
  }
}

async function loadRecentAllocHistory() {
  const box = document.getElementById('alloc-history-box');
  if (!box) return;
  try {
    const res = await apiFetch('/api/numbers/allocation-history?limit=50');
    const list = (res && res.data) || (Array.isArray(res) ? res : []);
    if (!list.length) {
      box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);"><i class="fas fa-history" style="font-size:32px;margin-bottom:8px;"></i><p>No allocation history yet.</p></div>';
      return;
    }
    const rows = list.map(h => {
      const isUndone = h.status === 'undone';
      return `
      <tr style="${isUndone ? 'opacity:0.6;' : ''}">
        <td style="font-size:12px;color:var(--text-muted);">${(h.created || h.timestamp || '').replace('T', ' ').slice(0, 19)}</td>
        <td><strong style="color:var(--text-primary);">${zyEsc(h.to_user || h.target || h.agent || '—')}</strong> <span class="badge" style="font-size:10px;">${zyEsc(h.to_role || 'Agent')}</span></td>
        <td style="font-size:12px;">${zyEsc(h.range_name || 'General')}</td>
        <td><span class="badge badge-purple" style="font-size:11px;">${zyEsc(h.payterm || 'From range')}</span></td>
        <td><span class="badge badge-primary" style="font-weight:700;">${h.count || h.qty_each || 0}</span></td>
        <td>
          <div style="display:inline-flex;gap:4px;align-items:center;">
            <a href="/api/numbers/allocation-history/${h.id}/export?format=txt" class="btn btn-xs btn-outline" download title="Download TXT"><i class="fas fa-file-lines"></i> TXT</a>
            <a href="/api/numbers/allocation-history/${h.id}/export?format=csv" class="btn btn-xs btn-outline" download title="Download CSV"><i class="fas fa-file-csv"></i> CSV</a>
            ${isUndone
              ? '<span class="badge badge-muted" style="font-size:10px;">Undone</span>'
              : `<button type="button" class="btn btn-xs btn-danger" onclick="undoAllocation(${h.id}, ${h.count || 0})" title="Revert to free pool"><i class="fas fa-undo"></i> Undo</button>`}
          </div>
        </td>
      </tr>
    `;
    }).join('');
    box.innerHTML = `
      <div class="table-container" style="max-height:450px;overflow-y:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>To User</th>
              <th>Range</th>
              <th>Payterm</th>
              <th>Qty</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    box.innerHTML = '<div class="text-danger" style="padding:10px;">Failed to load history</div>';
  }
}

async function undoAllocation(id, count) {
  if (!confirm(`Are you sure you want to revert allocation #${id} (${count} numbers)? These numbers will be returned to the unassigned pool.`)) return;
  try {
    toast('Reverting allocation...', 'info');
    const res = await apiFetch(`/api/numbers/allocation-history/${id}/undo`, { method: 'POST' });
    if (res && res.success) {
      toast(res.message || 'Allocation successfully undone', 'success');
      loadRecentAllocHistory();
      if (typeof renderAllocationHistory === 'function') renderAllocationHistory();
    } else {
      toast(res?.error || 'Failed to undo allocation', 'error');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

function onAllocRangeChange() {
  const sel = document.getElementById('alloc-range-id');
  const opt = sel?.selectedOptions?.[0];
  const availEl = document.getElementById('alloc-range-avail');
  if (!opt || !opt.value) { if (availEl) availEl.textContent = ''; return; }
  const avail = opt.getAttribute('data-available') || '0';
  if (availEl) availEl.textContent = `${avail} number(s) currently unassigned in this range.`;
}

function toggleAllocTargetOptions() {
  const type = document.getElementById('alloc-target-type')?.value;
  document.getElementById('alloc-agent-wrap').style.display = type === 'agent' ? 'block' : 'none';
  document.getElementById('alloc-client-wrap').style.display = type === 'client' ? 'block' : 'none';
}

async function doBulkAllocate(event) {
  event.preventDefault();

  try {
    const targetType = document.getElementById('alloc-target-type').value;
    const targetId = parseInt(document.getElementById(`alloc-${targetType}`)?.value);
    const count = parseInt(document.getElementById('alloc-count').value) || 0;
    const rangeId = parseInt(document.getElementById('alloc-range-id').value) || null;
    const payterm = document.getElementById('alloc-payterm')?.value || 'From range';
    const rangeStart = document.getElementById('range-start').value.trim();
    const rangeEnd = document.getElementById('range-end').value.trim();
    const note = document.getElementById('alloc-note').value || '';

    if (!targetId) {
      toast(`Please select a ${targetType}`, 'error');
      return;
    }
    if (!count && !rangeId && !(rangeStart && rangeEnd)) {
      toast('Enter an amount, or select a range, or enter a manual number range', 'error');
      return;
    }

    const btn = document.getElementById('alloc-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Allocating...';
    }

    const result = await apiFetch('/api/numbers/bulk-allocate', {
      method: 'POST',
      body: JSON.stringify({
        target_type: targetType, target_id: targetId,
        count, range_id: rangeId, payterm, range_start: rangeStart, range_end: rangeEnd, notes: note
      })
    });

    if (result && result.success) {
      toast(`Allocated ${result.allocated || count} numbers to ${result.to_user || 'user'}`, 'success');
      document.getElementById('bulk-alloc-form')?.reset();
      if (typeof loadRecentAllocHistory === 'function') loadRecentAllocHistory();
      else loadPage('allocation-history');
    } else {
      toast(result?.error || result?.detail || 'Allocation failed', 'error');
    }
  } catch (err) {
    console.error('Bulk allocate error:', err);
    toast(err.message || 'No free numbers available for this selection', 'error');
  } finally {
    const btn = document.getElementById('alloc-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus"></i> Allocate';
    }
  }
}

// ─── ALLOCATION HISTORY ───────────────────────────────────────────
async function renderAllocationHistory(page = 1) {
  try {
    const data = await apiFetch(`/api/numbers/allocation-history?page=${page}&limit=15`);
    if (!data) return;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Allocation History</div><div class="page-subtitle">Complete log of number allocations</div></div>
        <div class="page-actions">
          <button class="btn btn-outline btn-sm" onclick="loadPage('bulk-allocation')"><i class="fas fa-plus"></i> New Allocation</button>
        </div>
      </div>
      ${renderOwnerHubTabs('history', 'allocation-history')}
      <div class="card">
        ${buildTable(
          ['#', 'From', 'To User', 'Range', 'Payterm', 'Count', 'Time', 'Status', 'Actions'],
          (data.data || []).map(a => [
            a.id || '—',
            a.from_user || '—',
            `<strong>${zyEsc(a.to_user || '—')}</strong> <span class="badge" style="font-size:10px;">${zyEsc(a.to_role || 'Agent')}</span>`,
            zyEsc(a.range_name || (a.range_start ? `${a.range_start} - ${a.range_end}` : 'General')),
            `<span class="badge badge-purple">${zyEsc(a.payterm || 'From range')}</span>`,
            `<span class="badge badge-primary" style="font-weight:700;">${a.count || 0}</span>`,
            fmtShort(a.timestamp),
            statusBadge(a.status),
            `<div style="display:inline-flex;gap:4px;align-items:center;">
              <a href="/api/numbers/allocation-history/${a.id}/export?format=txt" class="btn btn-xs btn-outline" download title="Download TXT"><i class="fas fa-file-lines"></i> TXT</a>
              <a href="/api/numbers/allocation-history/${a.id}/export?format=csv" class="btn btn-xs btn-outline" download title="Download CSV"><i class="fas fa-file-csv"></i> CSV</a>
              ${a.status === 'undone' ? '<span class="badge badge-muted" style="font-size:10px;">Undone</span>' : `<button type="button" class="btn btn-xs btn-danger" onclick="undoAllocation(${a.id}, ${a.count || 0})" title="Revert to free pool"><i class="fas fa-undo"></i> Undo</button>`}
            </div>`
          ]),
          { id: 'tbl-alloc-history', title: 'Bulk Allocation History', toolbar: true }
        )}
        ${pagination(page, data.total || 0, 15, renderAllocationHistory)}
      </div>
    `;
  } catch (err) {
    console.error('Allocation history error:', err);
    toast('Failed to load allocation history', 'error');
  }
}

// ─── SMS RANGES ───────────────────────────────────────────────────
function zyNormalizeRangePaytermKey(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('month') || s.includes('30/5')) return 'Monthly';
  if (s.includes('biweek') || s.includes('15/3')) return 'Biweekly';
  return 'Weekly';
}

function zyFormatRangePaytermText(key) {
  const k = zyNormalizeRangePaytermKey(key);
  if (k === 'Monthly') return 'Monthly (30/5) {W}';
  if (k === 'Biweekly') return 'Biweekly (15/3)';
  return 'Weekly (7/3)';
}

function zyResolveRangePaytermRates(r) {
  const pts = (r && r.payterms && typeof r.payterms === 'object') ? r.payterms : {};
  const readNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const rawW = readNum(pts['Weekly'] !== undefined ? pts['Weekly'] : pts['7/3']);
  const rawB = readNum(pts['Biweekly'] !== undefined ? pts['Biweekly'] : pts['15/3']);
  const rawM = readNum(pts['Monthly'] !== undefined ? pts['Monthly'] : pts['30/5']);
  const fallbackRate = readNum(r && r.payout) ?? 0;

  let activeKeys = [];
  if (Array.isArray(r && r.active_payterms) && r.active_payterms.length) {
    activeKeys = [...new Set(r.active_payterms.map(zyNormalizeRangePaytermKey))];
  } else {
    const present = [];
    if (rawW !== null) present.push('Weekly');
    if (rawB !== null) present.push('Biweekly');
    if (rawM !== null) present.push('Monthly');
    if (present.length > 0 && present.length < 3) {
      activeKeys = present;
    } else {
      activeKeys = [zyNormalizeRangePaytermKey((r && r.payterm) || 'Weekly')];
    }
  }

  return {
    activeKeys,
    Weekly: activeKeys.includes('Weekly') ? (rawW !== null ? rawW : fallbackRate) : null,
    Biweekly: activeKeys.includes('Biweekly') ? (rawB !== null ? rawB : fallbackRate) : null,
    Monthly: activeKeys.includes('Monthly') ? (rawM !== null ? rawM : fallbackRate) : null
  };
}

async function renderSmsRanges() {
  try {
    const [data, noRateData] = await Promise.all([
      apiFetch('/api/numbers/sms-ranges').then(r => r || []).catch(() => []),
      apiFetch('/api/numbers/no-rate-ranges').catch(() => ({ ranges: [], count: 0 }))
    ]);

    const c = document.getElementById('page-content');
    const noRateList = (noRateData && noRateData.ranges) || [];
    const totalRanges = data.length;

    c.innerHTML = `
      <div class="page-header" style="margin-bottom:14px;">
        <div>
          <div class="page-title" style="font-size:18px;font-weight:800;">
            <i class="fas fa-table-list" style="margin-right:6px;"></i> Ranges &amp; Rate Card
          </div>
          <div class="page-subtitle" style="font-size:12.5px;">
            Unified telecom master catalog: Country prefixes, carrier costs &amp; active payterm rates — Weekly (7/3), Biweekly (15/3), Monthly (30/5) {W}
          </div>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" onclick="openAddRangeModal()">
            <i class="fas fa-plus"></i> Add Range &amp; Rates
          </button>
        </div>
      </div>

      <!-- No-Rate Warning List (Owner Only) -->
      ${noRateList.length ? `
      <div class="card" style="margin-bottom:16px;padding:12px 16px;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:13px;">
            <i class="fas fa-triangle-exclamation" style="margin-right:6px;"></i> Notice: ${noRateList.length} Range(s) Missing Cost or Payout Rate
          </strong>
        </div>
        ${buildTable(
          ['Range Name', 'Country', 'Provider', 'Company Cost', 'Has Payout', 'Affected Numbers', 'Action'],
          noRateList.map(nr => [
            `<strong>${escapeHtml(nr.range_name || '—')}</strong>`,
            escapeHtml(nr.country || '—'),
            escapeHtml(nr.provider || '—'),
            nr.cost ? `$${nr.cost}` : 'Missing Cost',
            nr.has_payout ? 'Yes' : 'Missing Payout',
            `${nr.affected_numbers_count || 0} numbers`,
            `<button class="btn btn-primary btn-sm" onclick="findAndEditRange(${nr.id})"><i class="fas fa-wrench"></i> Set Rates</button>`
          ])
        )}
      </div>
      ` : ''}

      <!-- Master Excel-style DataTable matching My Numbers -->
      <div class="apx-card zy-panel">
        <div class="apx-card-header zy-panel-head">
          <div class="apx-card-title">
            <i class="fas fa-table-list"></i> Ranges &amp; Rate Card
            <span style="margin-left:8px;font-size:11.5px;font-weight:600;">(${totalRanges.toLocaleString()} range${totalRanges === 1 ? '' : 's'})</span>
          </div>
        </div>
        <div class="apx-card-body zy-panel-body" id="owner-ranges-body" style="padding:0;"></div>
      </div>
    `;

    window._zyOwnerRangesById = {};
    data.forEach(r => { window._zyOwnerRangesById[r.id] = r; });

    const rangeRows = data.map(r => {
      const resolved = zyResolveRangePaytermRates(r);
      const costVal = parseFloat(r.company_cost !== undefined ? r.company_cost : (r.cost ?? 0)) || 0;
      const qty = Number(r.numbers_count || r.qty || 0);
      const free = Number(r.free_count !== undefined ? r.free_count : qty);
      const rangeName = String(r.range_name || r.name || r.country || '—').trim();
      const providerName = String(r.provider || 'Direct').trim();
      const cleanPrefix = String(r.prefix || '').trim().replace(/^\++/, '') || '—';
      const currencyCode = String(r.currency || 'USD').trim().toUpperCase();
      const currSym = escapeHtml(currencyCode === 'EUR' ? '€' : (currencyCode === 'GBP' ? '£' : '$'));
      const paytermDisplay = resolved.activeKeys.map(zyFormatRangePaytermText).join(', ');
      const isActive = r.active !== false;
      const safeDelName = (r.range_name || r.country || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      const fmtRateCell = (val) => val !== null
        ? { v: val, h: `<span class="monospace fw-600">${currSym} ${zyFmtMoney(Number(val), 4)}</span>` }
        : { v: 'N/A', h: `<span>N/A</span>` };

      return [
        { v: rangeName, h: `<span class="fw-600">${escapeHtml(rangeName)}</span>` },
        { v: providerName, h: `<span>${escapeHtml(providerName)}</span>` },
        { v: cleanPrefix, h: `<span class="monospace fw-600">${escapeHtml(cleanPrefix)}</span>` },
        { v: currencyCode, h: `<span>${escapeHtml(currencyCode)}</span>` },
        { v: paytermDisplay, h: `<span>${escapeHtml(paytermDisplay)}</span>` },
        { v: costVal, h: `<span class="monospace fw-600">${currSym} ${zyFmtMoney(costVal, 4)}</span>` },
        fmtRateCell(resolved.Weekly),
        fmtRateCell(resolved.Biweekly),
        fmtRateCell(resolved.Monthly),
        { v: qty, h: `<span class="monospace fw-600">${qty}</span>` },
        { v: free, h: `<span class="monospace fw-600">${free}</span>` },
        { v: isActive ? 'Active' : 'Inactive', h: `<span>${isActive ? 'Active' : 'Inactive'}</span>` },
        {
          v: '',
          h: `<div style="display:inline-flex;gap:4px;align-items:center;justify-content:center;">
                <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyOwnerViewRangeById(${r.id})" title="View Range Details" data-apx-tooltip="View"><i class="fas fa-eye"></i></button>
                <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyOwnerEditRangeById(${r.id})" title="Edit Rates" data-apx-tooltip="Edit"><i class="fas fa-pen"></i></button>
                <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="adminDeleteRange(${r.id},'${safeDelName}')" title="Delete Range" data-apx-tooltip="Delete"><i class="fas fa-trash"></i></button>
              </div>`
        }
      ];
    });

    const rangesHost = document.getElementById('owner-ranges-body');
    if (rangesHost && typeof zyDT2 === 'function') {
      rangesHost.innerHTML = zyDT2('dt-ranges', {
        cols: ['Range', 'Provider', 'Prefix', 'Currency', 'Payterm', 'Cost', 'Weekly (7/3)', 'Biweekly (15/3)', 'Monthly (30/5) {W}', 'Total', 'Free', 'Status', 'Action'],
        rows: rangeRows,
        perPage: 25
      });
      if (typeof zy2Render === 'function') zy2Render('dt-ranges');
    }
  } catch (err) {
    console.error('SMS Ranges error:', err);
    toast('Failed to load SMS ranges', 'error');
  }
}

function zyOwnerViewRangeById(rangeId) {
  const r = window._zyOwnerRangesById && window._zyOwnerRangesById[rangeId];
  if (r) openViewRangeModal(r);
  else toast('Range not found', 'error');
}

function zyOwnerEditRangeById(rangeId) {
  const r = window._zyOwnerRangesById && window._zyOwnerRangesById[rangeId];
  if (r) openEditRangeModal(r);
  else findAndEditRange(rangeId);
}

async function findAndEditRange(rangeId) {
  try {
    const ranges = await apiFetch('/api/numbers/sms-ranges') || [];
    const r = ranges.find(x => x.id === rangeId);
    if (r) openEditRangeModal(r);
    else toast('Range not found', 'error');
  } catch (e) {
    toast('Failed to open range', 'error');
  }
}

function adminDeleteRange(rangeId, rangeName) {
  openModal('Delete Range', `
    <div style="padding:10px 0;">
      <p style="font-size:14px;color:var(--text);margin-bottom:12px;">Delete range <strong>${rangeName || rangeId}</strong>?</p>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">This will permanently remove this range and all numbers belonging to it. This cannot be undone.</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="doAdminDeleteRange(${rangeId})"><i class="fas fa-trash"></i> Delete Range & Numbers</button>
      </div>
    </div>
  `);
}

async function doAdminDeleteRange(rangeId) {
  closeModal();
  try {
    const result = await apiFetch(`/api/numbers/sms-ranges/${rangeId}?delete_numbers=true`, { method: 'DELETE' });
    toast(`🗑️ Range deleted — ${result?.deleted_numbers ?? 0} number(s) removed with it`, 'warning');
    renderSmsRanges();
  } catch (err) { console.error(err); toast('Failed to delete range', 'error'); }
}

function openAddRangeModal() {
  openModal('Add New Range (AURA Standard)', `
    <form id="add-range-form" onsubmit="submitAddRange(event)">
      <div class="aura-modal-3col">
        <!-- Col 1: General Info -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-tower-broadcast"></i> General Info
          </h5>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Select Provider *</label>
            <input id="range-provider" class="form-control" placeholder="e.g. MTN, Whale, Zidi" required style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Range Name *</label>
            <input id="range-name" class="form-control" placeholder="e.g. Ghana_MTN_Live" required style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Country *</label>
            <input id="range-country" class="form-control" placeholder="e.g. Ghana" required style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Range Prefix *</label>
            <input id="range-prefix" class="form-control" placeholder="e.g. 23355" required style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Currency *</label>
            <select id="range-currency" class="form-control" style="width:100%;height:30px;font-size:12px;">
              <option value="USD" selected>USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;color:#0f766e;"><i class="fas fa-lock"></i> My Wholesale Payout / Buy Rate *</label>
            <input type="number" id="range-company-cost" class="form-control" placeholder="0.02" step="0.0001" value="0.02" required style="width:100%;height:30px;font-family:monospace;font-weight:700;font-size:12px;">
          </div>
        </div>

        <!-- Col 2: Limits & Memo -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-sliders"></i> Limits (0 = Unlimited)
          </h5>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Max SMS Limit / Day</label>
            <input type="number" id="range-otplimit" class="form-control" value="0" style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Status</label>
            <select id="range-active" class="form-control" style="width:100%;height:30px;font-size:12px;">
              <option value="1" selected>Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Memo Text / Instructions</label>
            <textarea id="range-memo" class="form-control" rows="5" placeholder="e.g. No Payout for UK CLI. Testing required before live traffic." style="width:100%;font-size:11.5px;"></textarea>
          </div>
        </div>

        <!-- Col 3: Payterm Agent Payout Matrix (Leave blank for N/A) -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-coins"></i> Your Agent's Payouts
          </h5>
          <div style="font-size:10.5px;margin-bottom:8px;">Fill only the payterm(s) you want active — blank columns will show <b>N/A</b>.</div>
          <table style="width:100%;font-size:11.5px;border-collapse:collapse;">
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:6px 0;"><b>Weekly (7/3)</b><div style="font-size:10px;">Weekly payment · 3 day hold</div></td>
              <td align="right"><input type="number" id="pt-weekly" value="0.012" placeholder="N/A" step="0.0001" style="width:90px;height:26px;font-family:monospace;font-size:11.5px;text-align:right;"></td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:6px 0;"><b>Biweekly (15/3)</b><div style="font-size:10px;">2 weeks payment · 3 day hold</div></td>
              <td align="right"><input type="number" id="pt-biweekly" value="" placeholder="N/A" step="0.0001" style="width:90px;height:26px;font-family:monospace;font-size:11.5px;text-align:right;"></td>
            </tr>
            <tr>
              <td style="padding:6px 0;"><b>Monthly (30/5) {W}</b><div style="font-size:10px;">Monthly payment · 5 day hold</div></td>
              <td align="right"><input type="number" id="pt-monthly" value="" placeholder="N/A" step="0.0001" style="width:90px;height:26px;font-family:monospace;font-size:11.5px;text-align:right;"></td>
            </tr>
          </table>
          <div style="font-size:10.5px;margin-top:8px;"><i class="fas fa-calendar-check"></i> Provider <b>Whitenoise</b> automatically locks ranges to <b>Monthly (30/5) {W}</b> (5d hold).</div>
        </div>
      </div>

      <div class="form-actions" style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm" id="range-submit-btn"><i class="fas fa-plus"></i> Add Range &amp; Rates</button>
      </div>
    </form>
  `);
}

async function submitAddRange(event) {
  event.preventDefault();

  try {
    const range_name = document.getElementById('range-name').value.trim();
    const country = document.getElementById('range-country').value.trim();
    const provider = document.getElementById('range-provider').value.trim() || 'Manual';
    const prefix = document.getElementById('range-prefix').value.trim();
    const currency = document.getElementById('range-currency')?.value || 'USD';
    const memo = document.getElementById('range-memo')?.value || '';
    const companyCost = parseFloat(document.getElementById('range-company-cost').value) || 0;

    const rawW = (document.getElementById('pt-weekly')?.value ?? '').trim();
    const rawB = (document.getElementById('pt-biweekly')?.value ?? '').trim();
    const rawM = (document.getElementById('pt-monthly')?.value ?? '').trim();

    if (!country || !prefix) {
      toast('Please fill all required fields', 'error');
      return;
    }

    const isWn = provider.toLowerCase().includes('whitenoise');
    const payterms = {};
    if (rawW !== '' && !isNaN(parseFloat(rawW))) payterms['Weekly'] = parseFloat(rawW);
    if (rawB !== '' && !isNaN(parseFloat(rawB))) payterms['Biweekly'] = parseFloat(rawB);
    if (rawM !== '' && !isNaN(parseFloat(rawM))) payterms['Monthly'] = parseFloat(rawM);

    if (isWn) {
      const wnRate = payterms['Monthly'] ?? payterms['Biweekly'] ?? payterms['Weekly'] ?? 0;
      delete payterms['Weekly'];
      delete payterms['Biweekly'];
      payterms['Monthly'] = wnRate;
    }

    const active_payterms = Object.keys(payterms);
    if (!active_payterms.length) {
      toast('Please enter a rate for at least one payterm', 'error');
      return;
    }

    const primaryPayterm = isWn ? 'Monthly' : active_payterms[0];
    const primaryPayout = payterms[primaryPayterm] ?? 0;

    const btn = document.getElementById('range-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Adding...';
    }

    const payload = {
      range_name: range_name || country,
      name: range_name || country,
      country,
      provider,
      prefix,
      currency,
      memo,
      company_cost: companyCost,
      cost: companyCost,
      payout: primaryPayout,
      payterm: primaryPayterm,
      payterms,
      active_payterms,
      otp_limit: parseInt(document.getElementById('range-otplimit')?.value) || 0,
      active: document.getElementById('range-active')?.value === '1'
    };

    const result = await apiFetch('/api/numbers/sms-ranges', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (result && result.id) {
      closeModal();
      toast('Range and rate card saved successfully', 'success');
      renderSmsRanges();
    } else {
      toast(result?.error || 'Failed to add range', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Save Range & Rates'; }
    }
  } catch (err) {
    console.error('submitAddRange error:', err);
    toast('Error adding range: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('range-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus"></i> Save Range & Rates';
    }
  }
}

function openViewRangeModal(r) {
  const resolved = zyResolveRangePaytermRates(r);
  const compCost = r.company_cost !== undefined ? r.company_cost : (r.cost ?? 0);
  const clis = r.cli_list || (Array.isArray(r.clis) && r.clis.length ? r.clis.join(', ') : 'All CLIs');
  const currSym = escapeHtml(r.currency === 'EUR' ? '€' : (r.currency === 'GBP' ? '£' : '$'));
  const fmtVal = (v) => v !== null ? `${currSym}${zyFmtMoney(Number(v), 4)}` : 'N/A';

  openModal(`Range Specification: ${escapeHtml(r.range_name || r.name || 'Details')}`, `
    <div class="aura-modal-3col">
      <!-- Col 1: General Info -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-tower-broadcast"></i> General Info
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span>Provider:</span> <b>${escapeHtml(r.provider || 'Direct')}</b></div>
          <div><span>Range Name:</span> <b>${escapeHtml(r.range_name || r.name || '—')}</b></div>
          <div><span>Country:</span> <b>${escapeHtml(r.country || '—')}</b></div>
          <div><span>Prefix:</span> <b class="monospace">${escapeHtml(String(r.prefix || '').trim().replace(/^\++/, '') || '—')}</b></div>
          <div><span>Currency:</span> <b>${escapeHtml(r.currency || 'USD')}</b></div>
          <div><span>Company Cost:</span> <b class="monospace">${currSym}${zyFmtMoney(Number(compCost), 4)}</b></div>
        </div>
      </div>

      <!-- Col 2: Limits & Routing -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-sliders"></i> Limits &amp; Status
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span>Status:</span> <b>${r.active !== false ? 'Active' : 'Inactive'}</b></div>
          <div><span>Daily Limit:</span> <b>${r.otp_limit || 'Unlimited'}</b></div>
          <div><span>Total Numbers:</span> <b>${r.numbers_count || r.qty || 0}</b></div>
          <div><span>Free in Pool:</span> <b>${r.free_count ?? (r.numbers_count || 0)}</b></div>
          <div><span>Allowed CLIs:</span> <small style="display:block;">${escapeHtml(clis)}</small></div>
        </div>
      </div>

      <!-- Col 3: Payterm Rates -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-coins"></i> Payterms Rate Card
        </h5>
        <table style="width:100%;font-size:11.5px;border-collapse:collapse;">
          <tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;">Weekly (7/3) · 3d Hold</td><td align="right" class="monospace"><b>${fmtVal(resolved.Weekly)}</b></td></tr>
          <tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;">Biweekly (15/3) · 3d Hold</td><td align="right" class="monospace"><b>${fmtVal(resolved.Biweekly)}</b></td></tr>
          <tr><td style="padding:6px 0;">Monthly (30/5) {W} · 5d Hold</td><td align="right" class="monospace"><b>${fmtVal(resolved.Monthly)}</b></td></tr>
        </table>
      </div>
    </div>
    <div style="margin-top:14px;display:flex;justify-content:flex-end;">
      <button type="button" class="btn btn-primary btn-sm" onclick="closeModal()">Close</button>
    </div>
  `);
}

function openEditRangeModal(r) {
  const resolved = zyResolveRangePaytermRates(r);
  const weeklyVal = resolved.Weekly !== null ? resolved.Weekly : '';
  const biweeklyVal = resolved.Biweekly !== null ? resolved.Biweekly : '';
  const monthlyVal = resolved.Monthly !== null ? resolved.Monthly : '';
  const compCost = r.company_cost !== undefined ? r.company_cost : (r.cost ?? 0);

  openModal('Edit Range & Rate Card (AURA Standard)', `
    <form id="edit-range-form" onsubmit="submitEditRange(event, ${r.id})">
      <div class="aura-modal-3col">
        <!-- Col 1: General Info -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-tower-broadcast"></i> General Info
          </h5>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Range Name *</label>
            <input id="er-name" class="form-control" value="${escapeHtml(r.range_name || r.name || '')}" required style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Country *</label>
            <input id="er-country" class="form-control" value="${escapeHtml(r.country || '')}" required style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Provider</label>
            <input id="er-provider" class="form-control" value="${escapeHtml(r.provider || '')}" style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Prefix *</label>
            <input id="er-prefix" class="form-control" value="${escapeHtml(r.prefix || '')}" required style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;"><i class="fas fa-lock"></i> Company Wholesale Cost *</label>
            <input type="number" id="er-company-cost" class="form-control" value="${compCost}" step="0.0001" required style="width:100%;height:30px;font-family:monospace;font-weight:700;font-size:12px;">
          </div>
        </div>

        <!-- Col 2: Limits & Status -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-sliders"></i> Limits &amp; Status
          </h5>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Max SMS Limit / Day</label>
            <input type="number" id="er-otplimit" class="form-control" value="${r.otp_limit || 0}" style="width:100%;height:30px;font-size:12px;">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label class="form-label" style="font-size:11px;font-weight:700;">Status</label>
            <select id="er-active" class="form-control" style="width:100%;height:30px;font-size:12px;">
              <option value="1" ${r.active !== false ? 'selected' : ''}>Active</option>
              <option value="0" ${r.active === false ? 'selected' : ''}>Inactive</option>
            </select>
          </div>
        </div>

        <!-- Col 3: Payterm Rates Matrix (Leave blank for N/A) -->
        <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:4px;">
          <h5 style="margin:0 0 10px 0;font-size:12px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
            <i class="fas fa-coins"></i> Payterm Rates ($)
          </h5>
          <div style="font-size:10.5px;margin-bottom:8px;">Fill only the payterm(s) you want active — blank columns show <b>N/A</b>.</div>
          <table style="width:100%;font-size:11.5px;border-collapse:collapse;">
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:6px 0;"><b>Weekly (7/3)</b><div style="font-size:10px;">Weekly payout · 3d hold</div></td>
              <td align="right"><input type="number" id="er-pt-weekly" value="${weeklyVal}" placeholder="N/A" step="0.0001" style="width:85px;height:26px;font-family:monospace;font-size:11px;text-align:right;"></td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:6px 0;"><b>Biweekly (15/3)</b><div style="font-size:10px;">2 weeks payout · 3d hold</div></td>
              <td align="right"><input type="number" id="er-pt-biweekly" value="${biweeklyVal}" placeholder="N/A" step="0.0001" style="width:85px;height:26px;font-family:monospace;font-size:11px;text-align:right;"></td>
            </tr>
            <tr>
              <td style="padding:6px 0;"><b>Monthly (30/5) {W}</b><div style="font-size:10px;">Monthly payout · 5d hold</div></td>
              <td align="right"><input type="number" id="er-pt-monthly" value="${monthlyVal}" placeholder="N/A" step="0.0001" style="width:85px;height:26px;font-family:monospace;font-size:11px;text-align:right;"></td>
            </tr>
          </table>
        </div>
      </div>

      <div class="form-actions" style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm" id="er-submit-btn"><i class="fas fa-save"></i> Save Changes</button>
      </div>
    </form>
  `);
}

async function submitEditRange(event, rangeId) {
  event.preventDefault();
  try {
    const range_name = document.getElementById('er-name').value.trim();
    const providerVal = document.getElementById('er-provider').value.trim() || 'Manual';
    const isWn = providerVal.toLowerCase().includes('whitenoise');
    const companyCost = parseFloat(document.getElementById('er-company-cost').value) || 0;

    const rawW = (document.getElementById('er-pt-weekly')?.value ?? '').trim();
    const rawB = (document.getElementById('er-pt-biweekly')?.value ?? '').trim();
    const rawM = (document.getElementById('er-pt-monthly')?.value ?? '').trim();

    const payterms = {};
    if (rawW !== '' && !isNaN(parseFloat(rawW))) payterms['Weekly'] = parseFloat(rawW);
    if (rawB !== '' && !isNaN(parseFloat(rawB))) payterms['Biweekly'] = parseFloat(rawB);
    if (rawM !== '' && !isNaN(parseFloat(rawM))) payterms['Monthly'] = parseFloat(rawM);

    if (isWn) {
      const wnRate = payterms['Monthly'] ?? payterms['Biweekly'] ?? payterms['Weekly'] ?? 0;
      delete payterms['Weekly'];
      delete payterms['Biweekly'];
      payterms['Monthly'] = wnRate;
    }

    const active_payterms = Object.keys(payterms);
    if (!active_payterms.length) {
      toast('Please enter a rate for at least one payterm', 'error');
      return;
    }

    const primaryPayterm = isWn ? 'Monthly' : active_payterms[0];
    const primaryPayout = payterms[primaryPayterm] ?? 0;

    const btn = document.getElementById('er-submit-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }

    const payload = {
      range_name: range_name,
      name: range_name,
      country: document.getElementById('er-country').value.trim(),
      provider: providerVal,
      prefix: document.getElementById('er-prefix').value.trim(),
      company_cost: companyCost,
      cost: companyCost,
      payout: primaryPayout,
      payterm: primaryPayterm,
      payterms,
      active_payterms,
      otp_limit: parseInt(document.getElementById('er-otplimit').value) || 0,
      active: document.getElementById('er-active').value === '1'
    };

    const result = await apiFetch(`/api/numbers/sms-ranges/${rangeId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    if (result && result.id) {
      closeModal();
      toast('Range and rates updated successfully', 'success');
      renderSmsRanges();
    } else {
      toast(result?.error || 'Failed to update range', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
    }
  } catch (err) {
    console.error('submitEditRange error:', err);
    toast('Error updating range: ' + err.message, 'error');
    const btn = document.getElementById('er-submit-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
  }
}

// ─── UPLOAD NUMBERS ───────────────────────────────────────────────
let _uploadTab = 'existing';
function renderBulkRangeImport() {
  return renderUploadNumbers('bulk');
}
async function renderUploadNumbers(mode = 'existing') {
  _uploadTab = (mode === 'bulk') ? 'bulk' : 'existing';
  const ranges = await apiFetch('/api/numbers/sms-ranges') || [];
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">${_uploadTab === 'bulk' ? 'Bulk Range Import' : 'Upload Numbers'}</div></div>
    </div>
    ${renderOwnerHubTabs('upload', _uploadTab === 'bulk' ? 'bulk-range-import' : 'upload-numbers')}
    <div id="upload-tab-content"></div>
  `;
  window._uploadRangesCache = ranges;
  renderUploadTabContent();
}

function renderUploadTabContent() {
  const wrap = document.getElementById('upload-tab-content');
  const ranges = window._uploadRangesCache || [];
  if (_uploadTab === 'existing') {
    wrap.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Import Numbers to Range</div>
          <p class="text-muted fs-12">Select a range, then paste or upload numbers (TXT/CSV — one per line).</p></div>
          <span class="badge badge-blue">${ranges.length} RANGES</span>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Destination Range *</label>
            <select id="ex-range" onchange="toggleNewRangeFields()">
              <option value="">Select range…</option>
              <option value="__new__">+ Create New Range…</option>
              ${ranges.map(r => `<option value="${r.id}">${r.range_name || r.name || r.country}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Country Override</label>
            <input id="ex-country-override" placeholder="Leave blank to use range country">
          </div>
        </div>
        <div id="new-range-fields" style="display:none;background:var(--bg-hover);border-radius:var(--radius);padding:14px;margin-bottom:16px;">
          <p class="fs-12 text-muted" style="margin-bottom:10px;">Name this range and set your own payout — nothing is auto-generated.</p>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Range Name *</label>
              <input id="nr-name" placeholder="e.g. Afghanistan Apple KM 16Aug-1"></div>
            <div class="form-group"><label class="form-label">Country *</label>
              <input id="nr-country" placeholder="e.g. Afghanistan"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Prefix</label>
              <input id="nr-prefix" placeholder="e.g. 9377056"></div>
            <div class="form-group"><label class="form-label">Carrier Rate — what they pay you ($)</label>
              <input id="nr-cost" type="number" step="0.0001" placeholder="0.004"></div>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Term *</label>
            <select id="nr-term" onchange="toggleNrTermRate()">
              <option value="Weekly" selected>Weekly (7/3) — 3d Hold</option>
              <option value="Biweekly">Biweekly (15/3) — 3d Hold</option>
              <option value="Monthly">Monthly (30/5) {W} — 5d Hold</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" id="nr-term-rate-label">Weekly (7/3) Payment ($) *</label>
            <input id="nr-term-rate" type="number" step="0.0001" placeholder="0.012">
          </div>
          <div class="form-group">
            <label class="form-label">OTP Limit (per number)</label>
            <input id="nr-otp-limit" type="number" min="1" placeholder="e.g. 10">
            <small class="text-muted">Max OTPs allowed per number — shown to whoever the number is assigned to.</small>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" style="display:flex;justify-content:space-between;">
            Numbers *
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('ex-file').click()"><i class="fas fa-upload"></i> Upload File (TXT/CSV/Excel)</button>
          </label>
          <textarea id="ex-numbers" rows="8" placeholder="+1234567890&#10;+9876543210&#10;001234567890"></textarea>
          <input type="file" id="ex-file" accept=".txt,.csv" style="display:none" onchange="loadNumbersFileIntoTextarea(this,'ex-numbers')">
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="submitImportToRange()"><i class="fas fa-cloud-arrow-up"></i> Import Numbers</button>
      </div>
    `;
  } else {
    wrap.innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">Bulk Range Import</div></div>
        <p class="text-muted fs-12" style="margin-bottom:14px;">Upload a provider file (CSV / Excel / TXT). Ranges are auto-created per termination, using the Cost/Payout you set below — nothing is auto-calculated for you.</p>
        <div style="background:var(--bg-hover);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;font-size:12px;">
          <strong>Range Name Format:</strong> Country Provider SSP MonthDay — e.g. <em>Afghanistan Vonage SSP Jul 10</em>
        </div>
        <div class="form-group">
          <label class="form-label">Provider Name (required for plain TXT, optional for CSV/Excel)</label>
          <input id="bri-provider" placeholder="e.g. IPRN, Telecom1…">
        </div>
        <div class="form-row" style="margin-bottom:16px;">
          <div class="form-group">
            <label class="form-label">Carrier Rate — what they pay you ($) *</label>
            <input id="bri-cost" type="number" step="0.0001" placeholder="e.g. 0.02" required>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:16px;">
          <label class="form-label">Payment Term *</label>
          <select id="bri-term" onchange="toggleBriTermRate()">
            <option value="Weekly" selected>Weekly (7/3) — 3d Hold</option>
            <option value="Biweekly">Biweekly (15/3) — 3d Hold</option>
            <option value="Monthly">Monthly (30/5) {W} — 5d Hold</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:16px;">
          <label class="form-label" id="bri-term-rate-label">Weekly (7/3) Payment ($) *</label>
          <input id="bri-term-rate" type="number" step="0.0001" placeholder="e.g. 0.01">
        </div>
        <div class="form-group" style="margin-bottom:16px;">
          <label class="form-label">OTP Limit (per number)</label>
          <input id="bri-otp-limit" type="number" min="1" placeholder="e.g. 10">
          <small class="text-muted">Max OTPs allowed per number — applies to every range created from this file.</small>
        </div>
        <div class="upload-zone" id="bri-drop-zone" onclick="document.getElementById('bri-file').click()">
          <i class="fas fa-cloud-arrow-up"></i>
          <p>Drop file here or click to browse</p>
          <small>Supports CSV, Excel (.xlsx/.xls), TXT · Max 25 MB</small>
        </div>
        <input type="file" id="bri-file" accept=".csv,.txt,.xlsx,.xls" style="display:none" onchange="submitBulkRangeImport(this)">
        <div id="bri-result" style="margin-top:16px;"></div>
      </div>
    `;
    const zone = document.getElementById('bri-drop-zone');
    if (zone) {
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const f = e.dataTransfer.files[0];
        if (f) submitBulkRangeImportFile(f);
      });
    }
  }
}

function toggleNewRangeFields() {
  const sel = document.getElementById('ex-range')?.value;
  const box = document.getElementById('new-range-fields');
  if (box) box.style.display = sel === '__new__' ? 'block' : 'none';
}

function toggleNrTermRate() {
  const term = document.getElementById('nr-term')?.value || 'Weekly';
  const label = document.getElementById('nr-term-rate-label');
  const title = term === 'Monthly' ? 'Monthly (30/5) {W}' : (term === 'Biweekly' ? 'Biweekly (15/3)' : 'Weekly (7/3)');
  if (label) label.textContent = `${title} Payment ($) *`;
}

function toggleBriTermRate() {
  const term = document.getElementById('bri-term')?.value || 'Weekly';
  const label = document.getElementById('bri-term-rate-label');
  const title = term === 'Monthly' ? 'Monthly (30/5) {W}' : (term === 'Biweekly' ? 'Biweekly (15/3)' : 'Weekly (7/3)');
  if (label) label.textContent = `${title} Payment ($) *`;
}

function loadNumbersFileIntoTextarea(input, textareaId) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const ta = document.getElementById(textareaId);
    if (ta) ta.value = e.target.result;
  };
  reader.readAsText(file);
}

async function submitImportToRange() {
  const rangeSel = document.getElementById('ex-range')?.value;
  const numbers = document.getElementById('ex-numbers')?.value.trim();
  const countryOverride = document.getElementById('ex-country-override')?.value.trim() || '';

  if (!rangeSel) { toast('Select a destination range', 'error'); return; }
  if (!numbers) { toast('Paste or upload at least one number', 'error'); return; }

  const payload = { numbers, country_override: countryOverride };
  if (rangeSel === '__new__') {
    const name = document.getElementById('nr-name')?.value.trim();
    const country = document.getElementById('nr-country')?.value.trim();
    const term = document.getElementById('nr-term')?.value || 'Weekly';
    const rate = document.getElementById('nr-term-rate')?.value;
    if (!name || !country) { toast('Range name and country are required', 'error'); return; }
    if (!rate) { toast(`Set the ${term} payment amount`, 'error'); return; }
    payload.new_range = {
      name, country,
      provider: 'Manual',
      prefix: document.getElementById('nr-prefix')?.value.trim() || '',
      cost: document.getElementById('nr-cost')?.value || 0,
      payterm: term,
      payout_schedule: term === 'Monthly' ? 'monthly30_5' : (term === 'Biweekly' ? 'biweekly15_3' : 'weekly7_3'),
      payout: rate,
      otp_limit: document.getElementById('nr-otp-limit')?.value || 0
    };
  } else {
    payload.range_id = parseInt(rangeSel);
  }

  const result = await apiFetch('/api/numbers/import-to-range', { method: 'POST', body: JSON.stringify(payload) });
  if (!result) return;
  let uploadMsg = `✅ Imported ${result.imported} number(s) into "${result.range_name}"`;
  if (result.skipped_duplicates) {
    uploadMsg += ` (${result.skipped_duplicates} duplicate(s) skipped)`;
  }
  toast(uploadMsg, (result.imported > 0 || !result.skipped_duplicates) ? 'success' : 'warning');
  renderUploadNumbers();
}

function submitBulkRangeImport(input) {
  const file = input.files?.[0];
  if (file) submitBulkRangeImportFile(file);
}

async function submitBulkRangeImportFile(file) {
  const res = document.getElementById('bri-result');
  const mode = 'iprn';
  const providerName = document.getElementById('bri-provider')?.value.trim() || '';
  const myCost = document.getElementById('bri-cost')?.value || '';
  const term = document.getElementById('bri-term')?.value || 'Weekly';
  const rate = document.getElementById('bri-term-rate')?.value || '';

  if (!myCost) {
    toast('Please enter your Carrier Rate before uploading', 'error');
    return;
  }
  if (!rate) {
    toast(`Set the ${term} payment amount`, 'error');
    return;
  }

  if (res) res.innerHTML = `<div class="flex-center gap-2"><div class="spinner"></div> Processing ${file.name}…</div>`;

  const form = new FormData();
  form.append('file', file);
  form.append('provider_name', providerName);
  form.append('mode', mode);
  form.append('override_cost', myCost);
  form.append('payout_schedule', term);
  form.append('override_payout', rate);
  form.append('otp_limit', document.getElementById('bri-otp-limit')?.value || '0');

  try {
    const token = getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Session-Token'] = token;
    }
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const response = await fetch('/api/numbers/bulk-range-import' + query, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form
    });
    const d = await response.json();
    if (!response.ok) throw new Error(d.detail || 'Import failed');

    if (res) {
      res.innerHTML = `
        <div class="alert alert-success" style="margin-bottom:12px;">
          ✅ Created ${d.ranges_created} range(s), imported ${d.numbers_imported} number(s).
        </div>
        ${buildTable(['Range', 'Country', 'Provider', 'Cost', 'Term', 'Payout'],
          d.ranges.map(r => [r.name, r.country, r.provider, '$' + r.cost, r.payterm || (r.payout_schedule === 'monthly30_5' ? 'Monthly (30/5) {W}' : (r.payout_schedule === 'biweekly15_3' ? 'Biweekly (15/3)' : 'Weekly (7/3)')), '$' + r.payout]))}
      `;
    }
    toast('Bulk import complete', 'success');
  } catch (err) {
    console.error('Bulk import error:', err);
    if (res) res.innerHTML = `<div class="alert alert-danger">Failed: ${err.message}</div>`;
    toast('Bulk import failed', 'error');
  }
}

function handleFileUpload(input) {
  if (input.files && input.files[0]) uploadFile(input.files[0]);
}

async function uploadFile(file) {
  const res = document.getElementById('upload-result');
  if (!res) return;

  res.innerHTML = `<div class="flex-center gap-2"><div class="spinner"></div> Uploading ${file.name}…</div>`;

  try {
    const form = new FormData();
    form.append('file', file);
    form.append('user_id', document.getElementById('upload-user')?.value || '');
    form.append('country', document.getElementById('upload-country')?.value || '');

    const token = getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Session-Token'] = token;
    }
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const response = await fetch('/api/numbers/upload' + query, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form
    });
    const d = await response.json();

    if (response.ok && d.imported) {
      res.innerHTML = `<div class="badge badge-green" style="font-size:13px;padding:8px 14px;">
        <i class="fas fa-circle-check"></i> Imported ${d.imported} numbers. Total: ${d.total || d.imported}</div>`;
      toast(`Imported ${d.imported} numbers`, 'success');
      loadPage('my-numbers');
    } else {
      res.innerHTML = `<div class="badge badge-red">${d.error || 'Upload failed'}</div>`;
      toast(d.error || 'Upload failed', 'error');
    }
  } catch (e) {
    res.innerHTML = `<div class="badge badge-red">Upload failed</div>`;
    toast('Upload failed', 'error');
  }
}

// ─── BLACKLIST ────────────────────────────────────────────────────
async function renderBlacklist() {
  try {
    const data = await apiFetch('/api/numbers/blacklist') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Blacklist Management</div><div class="page-subtitle">Block numbers, apps, or country patterns</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openAddBlacklistModal()"><i class="fas fa-plus"></i> Add Rule</button>
        </div>
      </div>
      ${renderOwnerHubTabs('upload', 'blacklist-management')}
      <div class="card">
        ${buildTable(
          ['#', 'Pattern', 'Type', 'Reason', 'Date Added', 'Actions'],
          data.map(b => [
            b.id || '—',
            `<span class="monospace">${b.pattern || '—'}</span>`,
            badge(b.type || 'number', 'blue'),
            b.reason || '—',
            fmtShort(b.created),
            `<button class="btn btn-danger btn-sm" onclick="deleteBlacklist(${b.id})"><i class="fas fa-trash"></i></button>`
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('Blacklist error:', err);
    toast('Failed to load blacklist', 'error');
  }
}

function openAddBlacklistModal() {
  openModal('Add Blacklist Rule', `
    <form id="add-blacklist-form" onsubmit="submitBlacklist(event)">
      <div class="form-group"><label class="form-label">Pattern (number, prefix, or app name) *</label>
        <input id="bl-pattern" placeholder="+18005555…" required></div>
      <div class="form-group"><label class="form-label">Type</label>
        <select id="bl-type">
          <option value="number">Number</option>
          <option value="app">App</option>
          <option value="country">Country</option>
          <option value="prefix">Prefix</option>
        </select></div>
      <div class="form-group"><label class="form-label">Reason</label>
        <input id="bl-reason" placeholder="Spam, abuse…"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-danger" id="bl-submit-btn"><i class="fas fa-ban"></i> Block</button>
      </div>
    </form>
  `);
}

async function submitBlacklist(event) {
  event.preventDefault();

  try {
    const pattern = document.getElementById('bl-pattern').value.trim();
    const type = document.getElementById('bl-type').value;
    const reason = document.getElementById('bl-reason').value || '';

    if (!pattern) {
      toast('Pattern is required', 'error');
      return;
    }

    const btn = document.getElementById('bl-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Blocking...';
    }

    const result = await apiFetch('/api/numbers/blacklist', {
      method: 'POST',
      body: JSON.stringify({ pattern, type, reason })
    });

    if (result && result.id) {
      closeModal();
      toast('Rule added to blacklist', 'success');
      renderBlacklist();
    } else {
      toast(result?.error || 'Failed to add rule', 'error');
    }
  } catch (err) {
    console.error('Add blacklist error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('bl-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-ban"></i> Block';
    }
  }
}

async function deleteBlacklist(id) {
  if (!confirm('Delete this blacklist rule?')) return;

  try {
    await apiFetch(`/api/numbers/blacklist/${id}`, { method: 'DELETE' });
    toast('Rule removed', 'warning');
    renderBlacklist();
  } catch (err) {
    console.error('Delete blacklist error:', err);
    toast('Failed to delete rule', 'error');
  }
}

// ─── REVOKE NUMBERS ───────────────────────────────────────────────
async function renderRevokeNumbers() {
  try {
    const [agents, clients] = await Promise.all([
      apiFetch('/api/agents?limit=500'),
      apiFetch('/api/clients?limit=500')
    ]);
    const allList = [
      ...(agents?.data || []).map(a => ({ id: a.id, username: a.username, role: 'Agent' })),
      ...(clients?.data || []).map(c => ({ id: c.id, username: c.username, role: 'Client' }))
    ];
    const userOptions = allList.map(u =>
      `<option value="${u.id}">${u.username} (${u.role})</option>`
    ).join('');

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Revoke Numbers</div><div class="page-subtitle">Take back numbers from Agents or Clients</div></div>
      </div>
      ${renderOwnerHubTabs('numbers', 'revoke-numbers')}
      <div class="two-col">
        <div class="card">
          <div class="card-header"><div class="card-title">Revoke from User</div></div>
          <form id="revoke-form" onsubmit="doRevokeNumbers(event)">
            <div class="form-group">
              <label class="form-label">Select User *</label>
              <select id="revoke-user" required>
                <option value="">— Select User —</option>
                ${userOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Number or Range</label>
              <input id="revoke-number" placeholder="+12025551234 or +1202555* for range">
            </div>
            <div class="form-group">
              <label class="form-label">Revoke Count</label>
              <input type="number" id="revoke-count" placeholder="All">
            </div>
            <div class="form-group">
              <label class="form-label">Reason</label>
              <textarea id="revoke-reason" rows="2" placeholder="Reason for revocation…"></textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-warning" id="revoke-submit-btn">
                <i class="fas fa-rotate-right"></i> Revoke Numbers
              </button>
            </div>
          </form>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Recent Revocations</div></div>
          <div id="revoke-history">
            <div class="empty-state"><i class="fas fa-clock"></i><p>No recent revocations</p></div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Revoke numbers error:', err);
    toast('Failed to load users', 'error');
  }
}

async function doRevokeNumbers(event) {
  event.preventDefault();

  try {
    const userId = document.getElementById('revoke-user').value;
    const number = document.getElementById('revoke-number').value.trim();
    const count = parseInt(document.getElementById('revoke-count').value) || 0;
    const reason = document.getElementById('revoke-reason').value || '';

    if (!userId) {
      toast('Please select a user', 'error');
      return;
    }

    const btn = document.getElementById('revoke-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Revoking...';
    }

    const payload = { user_id: parseInt(userId), reason };
    if (number) payload.number = number;
    if (count > 0) payload.count = count;

    const result = await apiFetch('/api/numbers/revoke', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (result && result.success) {
      toast(`Revoked ${result.revoked || count || 'numbers'} from user`, 'warning');
      document.getElementById('revoke-form')?.reset();
      loadPage('my-numbers');
    } else {
      toast(result?.error || 'Revocation failed', 'error');
    }
  } catch (err) {
    console.error('Revoke error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('revoke-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-rotate-right"></i> Revoke Numbers';
    }
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────
function zyHighlightOtp(msg) {
  if (!msg) return '—';
  return (typeof zyEsc === 'function')
    ? zyEsc(msg)
    : String(msg).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function zyToolbarFilterTable(tableId, val) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const q = String(val || '').toLowerCase().trim();
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(r => {
    const txt = r.textContent.toLowerCase();
    r.style.display = (!q || txt.includes(q)) ? '' : 'none';
  });
}

// ─── PROFIT STATS ─────────────────────────────────────────────────
async function renderProfitStats() {
  try {
    const stats = await apiFetch('/api/sms/stats');
    if (!stats) return;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Profit Stats</div><div class="page-subtitle">Earnings overview and analytics</div></div>
      </div>
      ${renderOwnerHubTabs('analytics', 'profit-stats')}
      <div class="stats-grid">
        ${statCard('Total Revenue', 'fas fa-dollar-sign', '$' + (stats.total_profit || 0), 'green', 'All time')}
        ${statCard('Delivered SMS', 'fas fa-circle-check', stats.delivered || 0, 'blue', 'Billed messages')}
        ${statCard('Success Rate', 'fas fa-chart-line', stats.total_sms ? Math.round((stats.delivered / stats.total_sms) * 100) + '%' : '0%', 'purple', 'Delivery success')}
        ${statCard('Avg per SMS', 'fas fa-coins', '$' + (stats.total_sms ? zyFmtMoney((stats.total_profit / stats.total_sms), 5) : '0'), 'yellow', 'Per message')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Daily Profit (Last 30 Days)</div></div>
        <div class="chart-container"><canvas id="profit-chart"></canvas></div>
      </div>
    `;

    try {
      const ctx = document.getElementById('profit-chart');
      const profitData = stats.daily_profit || Array.from({ length: 30 }, () => 0);
      if (ctx && typeof Chart !== 'undefined') {
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
            datasets: [{
              data: profitData,
              label: 'Profit ($)',
              backgroundColor: 'rgba(51,65,85,0.2)',
              borderColor: '#334155',
              borderWidth: 1,
              borderRadius: 3
            }]
          },
          options: chartOpts()
        });
      }
    } catch (err) {
      console.warn('Chart render error:', err);
    }
  } catch (err) {
    console.error('Profit stats error:', err);
    toast('Failed to load profit stats', 'error');
  }
}

// ─── LIVE OTP FEED ────────────────────────────────────────────────
function renderLiveOtpFeed() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Live OTP Feed</div><div class="page-subtitle">Real-time incoming OTP messages</div></div>
      <div class="page-actions">
        <span class="badge badge-red" style="font-size:12px;padding:5px 12px;">
          <span class="pulse-dot" style="display:inline-block;"></span> LIVE
        </span>
        <button class="btn btn-outline btn-sm" id="feed-pause" onclick="toggleFeedPause()"><i class="fas fa-pause"></i> Pause</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('otp-feed').innerHTML=''"><i class="fas fa-trash"></i> Clear</button>
      </div>
    </div>
    ${renderOwnerHubTabs('live', 'live-otp-feed')}
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);">
      <div class="stat-card"><div class="stat-icon green"><i class="fas fa-bell"></i></div>
        <div><div class="stat-label">Total Today</div><div class="stat-value" id="otp-total">0</div></div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-mobile-screen"></i></div>
        <div><div class="stat-label">WhatsApp</div><div class="stat-value" id="otp-whatsapp">0</div></div></div>
      <div class="stat-card"><div class="stat-icon cyan"><i class="fas fa-paper-plane"></i></div>
        <div><div class="stat-label">Telegram</div><div class="stat-value" id="otp-telegram">0</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow"><i class="fas fa-google"></i></div>
        <div><div class="stat-label">Google</div><div class="stat-value" id="otp-google">0</div></div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Incoming OTPs</div></div>
      <div id="otp-feed" class="live-feed" style="max-height:500px;">
        <div class="empty-state" style="padding:40px 20px;">
          <i class="fas fa-satellite-dish" style="font-size:28px;color:var(--text-muted);margin-bottom:10px;display:block;"></i>
          <p style="color:var(--text-muted);">Waiting for real incoming OTPs — this feed only shows genuine messages received through your SMPP/HTTP connections.</p>
        </div>
      </div>
    </div>
  `;
  startOtpFeed();
}

let otpPaused = false;
let otpCounts = { total: 0, WhatsApp: 0, Telegram: 0, Google: 0 };

function toggleFeedPause() {
  otpPaused = !otpPaused;
  const btn = document.getElementById('feed-pause');
  if (btn) {
    btn.innerHTML = otpPaused ? '<i class="fas fa-play"></i> Resume' : '<i class="fas fa-pause"></i> Pause';
  }
}

function startOtpFeed() {
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${wsProto}://${location.host}/ws/live-otp`);
  activeWS.push(ws);

  ws.onmessage = e => {
    if (otpPaused) return;
    try {
      const raw = JSON.parse(e.data);
      if (raw.type !== 'otp') return;  // ignore heartbeat/keep-alive pings
      const d = raw.data || raw;
      const feed = document.getElementById('otp-feed');
      if (!feed) { ws.close(); return; }

      const emptyState = feed.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      otpCounts.total++;
      if (otpCounts[d.app] !== undefined) otpCounts[d.app]++;

      const el = document.getElementById('otp-total');
      if (el) el.textContent = otpCounts.total;

      ['WhatsApp', 'Telegram', 'Google'].forEach(a => {
        const e2 = document.getElementById('otp-' + a.toLowerCase());
        if (e2) e2.textContent = otpCounts[a] || 0;
      });

      const item = document.createElement('div');
      item.className = 'feed-item';
      item.innerHTML = `
        <div class="feed-app-icon" style="background:${appColor(d.app)};min-width:36px">${d.app ? d.app[0] : '?'}</div>
        <div class="feed-info">
          <div class="feed-number"><strong>${escapeHtml(d.app || '—')}</strong> &nbsp;<span class="monospace">${escapeHtml(d.number || '—')}</span></div>
          <div class="feed-msg">${escapeHtml(d.message || '—')}</div>
        </div>
        <div class="feed-meta">
          <div class="feed-time">${new Date(d.timestamp || Date.now()).toLocaleTimeString()}</div>
          <div class="feed-country">${d.country || '—'} · ${d.provider || '—'}</div>
        </div>
      `;
      feed.prepend(item);
      if (feed.children.length > 50) feed.lastChild.remove();
    } catch (err) {
      console.warn('WebSocket message error:', err);
    }
  };

  ws.onerror = () => {
    const feed = document.getElementById('otp-feed');
    if (feed && !feed.querySelector('.feed-item')) {
      feed.innerHTML = `<div class="empty-state"><i class="fas fa-wifi" style="color:var(--yellow-light);"></i><p>Reconnecting...</p></div>`;
    }
  };

  // Live 3-second syncing fallback
  const seenOtpIds = new Set();
  const otpPoller = setInterval(async () => {
    const feed = document.getElementById('otp-feed');
    if (!feed) { clearInterval(otpPoller); return; }
    if (otpPaused) return;
    try {
      const logs = await apiFetch('/api/sms/logs?limit=30');
      const data = (logs && logs.data) || [];
      const newItems = data.filter(d => !seenOtpIds.has(d.id)).reverse();
      for (const d of newItems) {
        seenOtpIds.add(d.id);
        const emptyState = feed.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        otpCounts.total++;
        if (otpCounts[d.app] !== undefined) otpCounts[d.app]++;

        const el = document.getElementById('otp-total');
        if (el) el.textContent = otpCounts.total;

        ['WhatsApp', 'Telegram', 'Google'].forEach(a => {
          const e2 = document.getElementById('otp-' + a.toLowerCase());
          if (e2) e2.textContent = otpCounts[a] || 0;
        });

        const item = document.createElement('div');
        item.className = 'feed-item';
        item.innerHTML = `
          <div class="feed-app-icon" style="background:${appColor(d.app)};min-width:36px">${d.app ? d.app[0] : '?'}</div>
          <div class="feed-info">
            <div class="feed-number"><strong>${escapeHtml(d.app || '—')}</strong> &nbsp;<span class="monospace">${escapeHtml(d.number || '—')}</span> ${d.otp ? `<span class="badge badge-green" style="margin-left:6px;font-size:12px;font-weight:700;"><i class="fas fa-key" style="margin-right:3px;"></i>OTP: ${escapeHtml(d.otp)}</span>` : ''}</div>
            <div class="feed-msg">${escapeHtml(d.message || '—')}</div>
          </div>
          <div class="feed-meta">
            <div class="feed-time">${d.date || d.timestamp ? (String(d.date || d.timestamp).replace('T', ' ').slice(0, 19)) : new Date().toLocaleTimeString()}</div>
            <div class="feed-country">${d.country || '—'} · ${d.provider || '—'}</div>
          </div>
        `;
        feed.prepend(item);
        if (feed.children.length > 50) feed.lastChild.remove();
      }
    } catch (e) {}
  }, 3000);
  activePollers.push(otpPoller);
}

// ─── SMS ANALYTICS ────────────────────────────────────────────────
async function renderSmsAnalytics() {
  try {
    const stats = await apiFetch('/api/sms/stats');
    if (!stats) return;

    const delivRate = stats.total_sms > 0 ? Math.round((stats.delivered / stats.total_sms) * 100) : 0;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">SMS Analytics</div><div class="page-subtitle">Traffic, delivery & performance metrics</div></div>
      </div>
      ${renderOwnerHubTabs('analytics', 'sms-analytics')}
      <div class="stats-grid">
        ${statCard('Total SMS', 'fas fa-comment-sms', stats.total_sms || 0, 'blue', 'All messages')}
        ${statCard('Delivery Rate', 'fas fa-chart-line', delivRate + '%', 'green', 'Success %')}
        ${statCard('Failed', 'fas fa-xmark', stats.failed || 0, 'red', 'Delivery failures')}
        ${statCard('Total Profit', 'fas fa-dollar-sign', '$' + (stats.total_profit || 0), 'yellow', 'Earned')}
      </div>
      <div class="charts-grid">
        <div class="card">
          <div class="card-header"><div class="card-title">Hourly Traffic</div></div>
          <div class="chart-container"><canvas id="hourly-chart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">App Distribution</div></div>
          <div class="chart-container"><canvas id="app-dist-chart"></canvas></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Delivery Success Gauge</div></div>
        <div style="text-align:center;padding:20px;">
          <div style="font-size:64px;font-weight:800;color:var(--green-light)">${delivRate}%</div>
          <div class="text-muted">Overall Delivery Success Rate</div>
          <div class="progress-bar" style="margin-top:16px;height:12px;">
            <div class="progress-bar-fill green" style="width:${delivRate}%"></div>
          </div>
        </div>
      </div>
    `;

    try {
      const trafficData = stats.hourly_traffic || Array.from({ length: 24 }, () => 0);
      const ctx1 = document.getElementById('hourly-chart');
      if (ctx1 && typeof Chart !== 'undefined') {
        new Chart(ctx1, {
          type: 'line',
          data: {
            labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
            datasets: [{
              data: trafficData,
              label: 'SMS/hr',
              borderColor: '#334155',
              backgroundColor: 'rgba(51,65,85,0.08)',
              fill: true,
              tension: 0.4,
              pointRadius: 0,
              borderWidth: 2
            }]
          },
          options: chartOpts()
        });
      }

      const ctx2 = document.getElementById('app-dist-chart');
      if (ctx2 && typeof Chart !== 'undefined') {
        const dist = stats.app_breakdown || { WhatsApp: 30, Telegram: 25, Google: 20, Amazon: 15, Others: 10 };
        new Chart(ctx2, {
          type: 'doughnut',
          data: {
            labels: Object.keys(dist),
            datasets: [{
              data: Object.values(dist),
              backgroundColor: ['#25d366', '#2aabee', '#4285f4', '#ff9900', '#8b949e'],
              borderColor: 'transparent',
              hoverOffset: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'right',
                labels: {
                  color: '#8b949e',
                  font: { size: 11 }
                }
              }
            }
          }
        });
      }
    } catch (err) {
      console.warn('Chart render error:', err);
    }
  } catch (err) {
    console.error('SMS Analytics error:', err);
    toast('Failed to load analytics', 'error');
  }
}

// ─── FAILED SMS ───────────────────────────────────────────────────
async function renderFailedSms(page = 1) {
  try {
    const data = await apiFetch(`/api/sms/logs?page=${page}&limit=20&status=failed`);
    if (!data) return;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Failed SMS</div><div class="page-subtitle">Delivery failures and errors</div></div>
        <div class="page-actions">
          <button class="btn btn-outline btn-sm" onclick="toast('Export started', 'info')"><i class="fas fa-download"></i> Export</button>
        </div>
      </div>
      <div class="card">
        ${buildTable(
          ['#', 'Number', 'App', 'Provider', 'Error', 'Timestamp'],
          (data.data || []).map(s => [
            s.id || '—',
            `<span class="monospace">${s.number || '—'}</span>`,
            `<span style="color:${appColor(s.app)}">${s.app || '—'}</span>`,
            s.provider || '—',
            badge(s.error || 'Route Error', 'red'),
            fmtShort(s.timestamp)
          ])
        )}
        ${pagination(page, data.total || 0, 20, renderFailedSms)}
      </div>
    `;
  } catch (err) {
    console.error('Failed SMS error:', err);
    toast('Failed to load failed SMS', 'error');
  }
}

// ─── LIVE TRAFFIC ─────────────────────────────────────────────────
function renderLiveTraffic() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Live Traffic</div><div class="page-subtitle">Real-time SMS throughput monitor</div></div>
      <div class="page-actions"><span class="badge badge-green"><span class="pulse-dot" style="display:inline-block;"></span> Live</span></div>
    </div>
    ${renderOwnerHubTabs('live', 'live-traffic')}
    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
      <div class="stat-card"><div class="stat-icon green"><i class="fas fa-chart-line"></i></div>
        <div><div class="stat-label">Messages/sec</div><div class="stat-value" id="lt-mps">—</div></div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-comment-sms"></i></div>
        <div><div class="stat-label">Total This Session</div><div class="stat-value" id="lt-total">0</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow"><i class="fas fa-percent"></i></div>
        <div><div class="stat-label">Success Rate</div><div class="stat-value" id="lt-rate">—</div></div></div>
    </div>
    <div class="card">
      <div class="chart-container" style="height:280px;"><canvas id="live-traffic-chart"></canvas></div>
    </div>
  `;

  const labels = [],
    data = [];
  let total = 0;

  const ctx = document.getElementById('live-traffic-chart');
  const chart = (ctx && typeof Chart !== 'undefined') ? new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        label: 'MPS',
        borderColor: '#334155',
        backgroundColor: 'rgba(51,65,85,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: chartOpts()
  }) : null;

  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${wsProto}://${location.host}/ws/live-traffic`);
  activeWS.push(ws);

  ws.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      const mpsEl = document.getElementById('lt-mps');
      const totEl = document.getElementById('lt-total');
      const rateEl = document.getElementById('lt-rate');
      if (!mpsEl) { ws.close(); return; }

      mpsEl.textContent = d.mps || '—';
      total += d.mps || 0;
      totEl.textContent = total;
      rateEl.textContent = (d.success_rate || 0) + '%';

      labels.push(new Date(d.timestamp || Date.now()).toLocaleTimeString());
      data.push(d.mps || 0);

      if (labels.length > 60) { labels.shift();
        data.shift(); }
      if (chart) chart.update('none');
    } catch (err) {
      console.warn('WebSocket message error:', err);
    }
  };

  ws.onerror = () => {
    const mpsEl = document.getElementById('lt-mps');
    if (mpsEl) mpsEl.textContent = '⚠️';
  };
}

// ─── SMPP DASHBOARD ───────────────────────────────────────────────
async function renderSmppDashboard() {
  try {
    const [throughput, sessions] = await Promise.all([
      apiFetch('/api/smpp/throughput'),
      apiFetch('/api/smpp/sessions')
    ]);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">SMPP Dashboard</div><div class="page-subtitle">Server performance overview</div></div>
      </div>
      ${renderOwnerHubTabs('smpp', 'smpp-dashboard')}
      <div class="stats-grid">
        ${statCard('Active Sessions', 'fas fa-plug', sessions?.length || 0, 'blue', 'SMPP connections')}
        ${statCard('Current MPS', 'fas fa-chart-line', throughput?.current_mps || 0, 'green', 'Messages/sec')}
        ${statCard('Peak MPS', 'fas fa-bolt', throughput?.peak_mps || 0, 'yellow', 'Maximum today')}
        ${statCard('DLR Rate', 'fas fa-circle-check', (throughput?.dlr_rate || 0) + '%', 'purple', 'Delivery receipts')}
      </div>
      <div class="charts-grid">
        <div class="card">
          <div class="card-header"><div class="card-title">Throughput (last 60s)</div></div>
          <div class="chart-container"><canvas id="smpp-throughput-chart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Active Sessions</div></div>
          ${buildTable(['System ID', 'IP', 'Bind', 'Messages', 'Status'],
            (sessions || []).slice(0, 6).map(s => [
              `<span class="monospace">${s.system_id || '—'}</span>`,
              s.ip || '—',
              badge(s.bind_type || '—', 'blue'),
              (s.messages_sent || 0).toLocaleString(),
              statusBadge(s.status)
            ])
          )}
        </div>
      </div>
    `;

    try {
      const throughputData = throughput?.data || Array.from({ length: 60 }, () => 0);
      const ctx = document.getElementById('smpp-throughput-chart');
      if (ctx && typeof Chart !== 'undefined') {
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: Array.from({ length: 60 }, (_, i) => i),
            datasets: [{
              data: throughputData,
              label: 'MPS',
              borderColor: '#334155',
              backgroundColor: 'rgba(51,65,85,0.08)',
              fill: true,
              tension: 0.4,
              pointRadius: 0,
              borderWidth: 2
            }]
          },
          options: chartOpts()
        });
      }
    } catch (err) {
      console.warn('Chart render error:', err);
    }
  } catch (err) {
    console.error('SMPP Dashboard error:', err);
    toast('Failed to load SMPP dashboard', 'error');
  }
}

// ─── SMPP SESSIONS ────────────────────────────────────────────────
async function renderSmppSessions() {
  try {
    const data = await apiFetch('/api/smpp/sessions') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">SMPP Sessions</div><div class="page-subtitle">Active server sessions</div></div>
      </div>
      ${renderOwnerHubTabs('smpp', 'smpp-sessions')}
      <div class="card">
        ${buildTable(
          ['ID', 'System ID', 'IP Address', 'Bind Type', 'Messages Sent', 'Connected At', 'Status', 'Actions'],
          data.map(s => [
            s.id || '—',
            `<span class="monospace">${s.system_id || '—'}</span>`,
            s.ip || '—',
            badge(s.bind_type || '—', 'blue'),
            (s.messages_sent || 0).toLocaleString(),
            fmtShort(s.connected_at),
            statusBadge(s.status),
            `<button class="btn btn-warning btn-sm" onclick="disconnectSession(${s.id})"><i class="fas fa-plug-circle-xmark"></i> Disconnect</button>`
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('SMPP Sessions error:', err);
    toast('Failed to load SMPP sessions', 'error');
  }
}

async function disconnectSession(id) {
  if (!confirm('Disconnect this session?')) return;

  try {
    await apiFetch(`/api/smpp/sessions/${id}`, { method: 'DELETE' });
    toast('Session disconnected', 'warning');
    renderSmppSessions();
  } catch (err) {
    console.error('Disconnect session error:', err);
    toast('Failed to disconnect session', 'error');
  }
}

// ─── CONNECTED CLIENTS ────────────────────────────────────────────
async function renderConnectedClients() {
  try {
    const data = await apiFetch('/api/smpp/sessions') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Connected Clients</div><div class="page-subtitle">${data.length} active clients</div></div>
      </div>
      ${renderOwnerHubTabs('smpp', 'connected-clients')}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
        ${data.map(s => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
              <div>
                <div class="fw-600 monospace">${s.system_id || '—'}</div>
                <div class="text-muted fs-12">${s.ip || '—'}</div>
              </div>
              ${statusBadge(s.status)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
              <div><div class="text-muted">Bind Type</div><div>${badge(s.bind_type || '—', 'blue')}</div></div>
              <div><div class="text-muted">Messages</div><div>${(s.messages_sent || 0).toLocaleString()}</div></div>
              <div style="grid-column:1/-1"><div class="text-muted">Connected</div><div>${fmtShort(s.connected_at)}</div></div>
            </div>
            <div style="margin-top:12px;display:flex;gap:8px;">
              <button class="btn btn-outline btn-sm" style="flex:1" onclick="toast('Client details', 'info')"><i class="fas fa-info"></i> Details</button>
              <button class="btn btn-danger btn-sm" style="flex:1" onclick="disconnectSession(${s.id})"><i class="fas fa-times"></i> Drop</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Connected clients error:', err);
    toast('Failed to load connected clients', 'error');
  }
}

// ─── DLR MONITOR ─────────────────────────────────────────────────
async function renderDlrMonitor() {
  try {
    const data = await apiFetch('/api/smpp/dlr');

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">DLR Monitor</div><div class="page-subtitle">Delivery receipt tracking</div></div>
      </div>
      ${renderOwnerHubTabs('smpp', 'dlr-monitor')}
      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);">
        ${statCard('DLR Rate', 'fas fa-percent', (data?.dlr_rate || 0) + '%', 'green', 'Success')}
        ${statCard('Delivered', 'fas fa-circle-check', data?.delivered || 0, 'blue', 'Confirmed')}
        ${statCard('Pending', 'fas fa-clock', data?.pending || 0, 'yellow', 'Awaiting')}
        ${statCard('Failed DLR', 'fas fa-circle-xmark', data?.failed || 0, 'red', 'No receipt')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">DLR Rate (last 60s)</div></div>
        <div class="chart-container"><canvas id="dlr-chart"></canvas></div>
      </div>
    `;

    try {
      const dlrData = data?.data || Array.from({ length: 60 }, () => 0);
      const ctx = document.getElementById('dlr-chart');
      if (ctx && typeof Chart !== 'undefined') {
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: Array.from({ length: 60 }, (_, i) => i),
            datasets: [{
              data: dlrData,
              label: 'DLR %',
              borderColor: '#334155',
              backgroundColor: 'rgba(51,65,85,0.08)',
              fill: true,
              tension: 0.4,
              pointRadius: 0,
              borderWidth: 2
            }]
          },
          options: chartOpts()
        });
      }
    } catch (err) {
      console.warn('Chart render error:', err);
    }
  } catch (err) {
    console.error('DLR Monitor error:', err);
    toast('Failed to load DLR monitor', 'error');
  }
}

// ─── THROUGHPUT MONITOR ───────────────────────────────────────────
function renderThroughputMonitor() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Throughput Monitor</div><div class="page-subtitle">Messages per second — live</div></div>
      <div class="page-actions"><span class="badge badge-green"><span class="pulse-dot" style="display:inline-block;"></span> Live</span></div>
    </div>
    ${renderOwnerHubTabs('smpp', 'throughput-monitor')}
    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
      <div class="stat-card"><div class="stat-icon green"><i class="fas fa-gauge-high"></i></div>
        <div><div class="stat-label">Current MPS</div><div class="stat-value" id="tp-mps">—</div></div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-bolt"></i></div>
        <div><div class="stat-label">Peak (session)</div><div class="stat-value" id="tp-peak">0</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow"><i class="fas fa-percent"></i></div>
        <div><div class="stat-label">Success Rate</div><div class="stat-value" id="tp-rate">—</div></div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Live Throughput</div></div>
      <div class="chart-container" style="height:280px;"><canvas id="tp-chart"></canvas></div>
    </div>
  `;

  const labels = [],
    data = [];
  let peak = 0;

  const ctx = document.getElementById('tp-chart');
  const chart = (ctx && typeof Chart !== 'undefined') ? new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        label: 'MPS',
        borderColor: '#334155',
        backgroundColor: 'rgba(51,65,85,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        borderWidth: 2
      }]
    },
    options: chartOpts()
  }) : null;

  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${wsProto}://${location.host}/ws/smpp-monitor`);
  activeWS.push(ws);

  ws.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      const el = document.getElementById('tp-mps');
      if (!el) { ws.close(); return; }

      peak = Math.max(peak, d.mps || 0);
      el.textContent = d.mps || '—';
      document.getElementById('tp-peak').textContent = peak;
      document.getElementById('tp-rate').textContent = (d.dlr || 0) + '%';

      labels.push(new Date(d.timestamp).toLocaleTimeString());
      data.push(d.mps || 0);

      if (labels.length > 60) { labels.shift();
        data.shift(); }
      if (chart) chart.update('none');
    } catch (err) {
      console.warn('WebSocket message error:', err);
    }
  };

  ws.onerror = () => {
    const el = document.getElementById('tp-mps');
    if (el) el.textContent = '⚠️';
  };
}

// ─── SMPP SECURITY ────────────────────────────────────────────────
async function renderSmppSecurity() {
  try {
    const logs = await apiFetch('/api/smpp/connection-logs') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">SMPP Security Center</div><div class="page-subtitle">Authentication and access logs</div></div>
      </div>
      ${renderOwnerHubTabs('smpp', 'smpp-security')}
      <div class="card">
        ${buildTable(
          ['IP Address', 'System ID', 'Event', 'Timestamp'],
          logs.slice(0, 20).map(l => [
            l.ip || '—',
            `<span class="monospace">${l.system_id || '—'}</span>`,
            badge(l.event || '—', l.event === 'Connected' ? 'green' : l.event === 'Auth Failed' ? 'red' : 'yellow'),
            fmtShort(l.timestamp)
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('SMPP Security error:', err);
    toast('Failed to load security logs', 'error');
  }
}

// ─── CONNECTION LOGS ──────────────────────────────────────────────
async function renderConnectionLogs() {
  try {
    const data = await apiFetch('/api/smpp/connection-logs') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Connection Logs</div><div class="page-subtitle">All SMPP connection events</div></div>
      </div>
      ${renderOwnerHubTabs('smpp', 'connection-logs')}
      <div class="card">
        ${buildTable(
          ['#', 'IP Address', 'System ID', 'Event', 'Timestamp'],
          data.map((l, i) => [
            i + 1,
            l.ip || '—',
            `<span class="monospace">${l.system_id || '—'}</span>`,
            badge(l.event || '—', l.event === 'Connected' ? 'green' : l.event === 'Auth Failed' ? 'red' : 'yellow'),
            fmtShort(l.timestamp)
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('Connection logs error:', err);
    toast('Failed to load connection logs', 'error');
  }
}

// ─── REGISTRATION REQUESTS ────────────────────────────────────────
async function renderRegistrationRequests() {
  try {
    const raw = await apiFetch('/api/registration-requests');
    const data = Array.isArray(raw) ? raw : (raw?.data || []);
    const pending = data.filter(r => r.status === 'pending').length;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Registration Requests</div>
        <div class="page-subtitle">${pending} pending</div></div>
      </div>
      <div class="card">
        ${buildTable(
          ['#', 'Username', 'Email', 'Role', 'Company', 'Status', 'Time', 'Actions'],
          data.map(r => [
            r.id || '—',
            r.username || '—',
            r.email || '—',
            roleBadge(r.role),
            r.company || '—',
            statusBadge(r.status),
            fmtShort(r.timestamp),
            r.status === 'pending' ? `
              <button class="btn btn-success btn-sm" onclick="approveReg(${r.id})"><i class="fas fa-check"></i> Approve</button>
              <button class="btn btn-danger btn-sm" onclick="rejectReg(${r.id})"><i class="fas fa-times"></i> Reject</button>
            ` : '—'
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('Registration requests error:', err);
    toast('Failed to load registration requests', 'error');
  }
}

async function approveReg(id) {
  try {
    await apiFetch(`/api/registration-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });
    toast('Registration approved', 'success');
    renderRegistrationRequests();
  } catch (err) {
    console.error('Approve error:', err);
    toast('Failed to approve', 'error');
  }
}

async function rejectReg(id) {
  try {
    await apiFetch(`/api/registration-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) });
    toast('Registration rejected', 'warning');
    renderRegistrationRequests();
  } catch (err) {
    console.error('Reject error:', err);
    toast('Failed to reject', 'error');
  }
}

// ─── PAYOUT REQUESTS ──────────────────────────────────────────────
// ─── PAYOUT REQUESTS ──────────────────────────────────────────────
async function renderPayoutRequests(activeTab = 'all') {
  try {
    const [result, settings] = await Promise.all([
      apiFetch('/api/payout-requests?limit=1000'),
      apiFetch('/api/settings')
    ]);
    const rawData = result?.data || [];
    const pendingList = rawData.filter(r => !['paid', 'completed'].includes((r.status || '').toLowerCase()));
    const paidList = rawData.filter(r => ['paid', 'completed'].includes((r.status || '').toLowerCase()));
    const pendingCount = pendingList.length;
    const pendingSum = pendingList.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
    const paidSum = paidList.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
    const minPayout = settings?.min_payout ?? 0;
    const fxRate = Number(settings?.usd_to_pkr_rate || 280);

    let filtered = rawData;
    if (activeTab === 'pending') filtered = pendingList;
    else if (activeTab === 'paid') filtered = paidList;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header" style="margin-bottom:18px;">
        <div>
          <div class="page-title">Agent Payment Requests</div>
          <div class="page-subtitle">Agent-to-Owner USD settlement ledger · Min payout: $${zyFmtMoney(Number(minPayout), 2)} USD · FX Reference: 1 USD = Rs. ${zyFmtMoney(fxRate, 2)} PKR</div>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="sp-btn-secondary" style="height:36px;padding:0 14px;font-size:13px;display:inline-flex;align-items:center;gap:6px;" onclick="loadPage('general-settings')">
            <i class="fas fa-coins"></i> FX Rate: Rs. ${zyFmtMoney(fxRate, 2)}
          </button>
          <button class="sp-btn-secondary" style="height:36px;padding:0 14px;font-size:13px;display:inline-flex;align-items:center;gap:6px;" onclick="openSetMinPayoutModal(${minPayout})">
            <i class="fas fa-sliders"></i> Minimum Payout
          </button>
        </div>
      </div>
      ${renderOwnerHubTabs('finance', 'payout-requests')}

      <!-- Financial Metrics Strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:20px;">
        <div class="sp-card" style="padding:16px 18px;border-left:4px solid #f59e0b;">
          <div style="font-size:11px;font-weight:700;color:var(--sp-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Pending Settlement</div>
          <div style="font-size:24px;font-weight:800;color:#f59e0b;margin-top:4px;">${pendingCount} <span style="font-size:14px;font-weight:600;color:var(--sp-text-secondary);">($${zyFmtMoney(pendingSum, 2)})</span></div>
        </div>
        <div class="sp-card" style="padding:16px 18px;border-left:4px solid #10b981;">
          <div style="font-size:11px;font-weight:700;color:var(--sp-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Total Paid Out</div>
          <div style="font-size:24px;font-weight:800;color:#10b981;margin-top:4px;">$${zyFmtMoney(paidSum, 2)}</div>
        </div>
        <div class="sp-card" style="padding:16px 18px;border-left:4px solid #3b82f6;">
          <div style="font-size:11px;font-weight:700;color:var(--sp-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Total Requests</div>
          <div style="font-size:24px;font-weight:800;color:var(--sp-text);margin-top:4px;">${rawData.length}</div>
        </div>
        <div class="sp-card" style="padding:16px 18px;border-left:4px solid #8b5cf6;">
          <div style="font-size:11px;font-weight:700;color:var(--sp-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Min Payout Rule</div>
          <div style="font-size:24px;font-weight:800;color:#8b5cf6;margin-top:4px;">$${zyFmtMoney(Number(minPayout), 2)}</div>
        </div>
      </div>

      <!-- Main Ledger Panel -->
      <div class="zy-panel">
        <div class="zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span>Settlement Requests</span>
            <div style="display:inline-flex;background:var(--sp-bg-surface);border:1px solid var(--sp-border);border-radius:8px;padding:2px;margin-left:8px;">
              <button type="button" style="padding:4px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:${activeTab==='all'?'var(--sp-primary)':'transparent'};color:${activeTab==='all'?'#fff':'var(--sp-text-secondary)'};" onclick="renderPayoutRequests('all')">All (${rawData.length})</button>
              <button type="button" style="padding:4px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:${activeTab==='pending'?'var(--sp-primary)':'transparent'};color:${activeTab==='pending'?'#fff':'var(--sp-text-secondary)'};" onclick="renderPayoutRequests('pending')">Pending (${pendingCount})</button>
              <button type="button" style="padding:4px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:${activeTab==='paid'?'var(--sp-primary)':'transparent'};color:${activeTab==='paid'?'#fff':'var(--sp-text-secondary)'};" onclick="renderPayoutRequests('paid')">Paid (${paidList.length})</button>
            </div>
          </div>
        </div>
        <div class="zy-panel-body" style="padding:16px;">
          ${buildTable(
            ['#', 'Requester', 'Amount', 'Method', 'Wallet / IBAN', 'Status', 'Requested At', 'Actions'],
            filtered.map(r => {
              const stLow = String(r.status || 'pending').toLowerCase();
              const isPaid = stLow === 'paid' || stLow === 'completed';
              return [
                `<span class="monospace fw-600">#${r.id || '—'}</span>`,
                `<div><strong>${escapeHtml(r.user || r.username || '—')}</strong><div style="font-size:11px;color:var(--sp-text-muted);">${escapeHtml(r.role || 'Agent')}</div></div>`,
                `<strong style="color:#10b981;font-size:15px;">$${zyFmtMoney((Number(r.amount) || 0), 2)}</strong>`,
                `<span class="badge badge-blue">${escapeHtml(r.method || 'Transfer')}</span>`,
                `<span class="monospace text-muted" style="font-size:11px;">${escapeHtml(r.wallet || r.account || '—')}</span>`,
                statusBadge(isPaid ? 'paid' : 'pending'),
                fmtShort(r.timestamp),
                !isPaid ? `
                  <div style="display:inline-flex;gap:6px;justify-content:center;">
                    <button class="sp-btn-primary" style="height:30px;padding:0 12px;font-size:12px;" onclick="approvePayout(${r.id})"><i class="fas fa-check"></i> Pay</button>
                    <button class="btn btn-warning btn-sm" style="height:30px;padding:0 10px;font-size:12px;" onclick="markPayoutPending(${r.id})" title="Keep in Pending queue &amp; notify requester"><i class="fas fa-clock"></i> Pending</button>
                  </div>
                ` : `
                  <button class="sp-btn-secondary" style="height:30px;padding:0 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;" onclick='downloadPayoutInvoice(${JSON.stringify(r)})'>
                    <i class="fas fa-file-invoice"></i> Invoice
                  </button>
                `
              ];
            }),
            { id: 'tbl-payout-requests', title: 'Settlement Requests', toolbar: true }
          )}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Payout requests error:', err);
    toast('Failed to load payout requests', 'error');
  }
}

// ── PAYOUT INVOICE (PDF via print) ─────────────────────────────────
function downloadPayoutInvoice(r) {
  const siteName = (window.__BRAND_SETTINGS__ && window.__BRAND_SETTINGS__.site_name) || 'HUMAX SMS';
  const prefix = siteName.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase() || 'HUMAX';
  const invoiceNo = `${prefix}-INV-${String(r.id).padStart(5, '0')}`;
  const dateStr = fmtShort(r.paid_at || r.timestamp);
  const invoiceHtml = `
    <html><head><title>${invoiceNo}</title>
    <style>
      body{font-family:'Segoe UI',Arial,sans-serif;padding:30px;color:#222;max-width:700px;margin:0 auto;}
      .inv-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e293b;padding-bottom:18px;margin-bottom:24px;}
      .inv-logo{font-size:22px;font-weight:800;}
      .inv-logo span{color:#1e293b;}
      .inv-meta{text-align:right;font-size:13px;color:#666;}
      .inv-title{font-size:26px;font-weight:700;margin-bottom:4px;}
      table{width:100%;border-collapse:collapse;margin-top:16px;}
      th{background:#f5f6fa;text-align:left;padding:10px 12px;font-size:12px;text-transform:uppercase;color:#666;}
      td{padding:10px 12px;border-bottom:1px solid #eee;font-size:14px;}
      .inv-total{font-size:20px;font-weight:800;color:#2ba84a;text-align:right;margin-top:18px;}
      .inv-footer{margin-top:30px;font-size:11px;color:#999;text-align:center;}
      .paid-stamp{display:inline-block;border:2px solid #2ba84a;color:#2ba84a;padding:4px 14px;border-radius:6px;font-weight:700;font-size:12px;letter-spacing:1px;}
    </style></head>
    <body>
      <div class="inv-header">
        <div>
          <div class="inv-logo">${escapeHtml(siteName)}</div>
          <div class="inv-title" style="margin-top:10px;">Payout Invoice</div>
          <span class="paid-stamp">✔ PAID</span>
        </div>
        <div class="inv-meta">
          <div><strong>${invoiceNo}</strong></div>
          <div>Date: ${dateStr}</div>
        </div>
      </div>
      <table>
        <tr><th>Paid To</th><th>Method</th><th>Wallet / Account</th><th>Request #</th></tr>
        <tr>
          <td>${escapeHtml(r.user || '—')}</td>
          <td>${escapeHtml(r.method || '—')}</td>
          <td style="font-family:monospace;font-size:12px;">${escapeHtml(r.wallet || '—')}</td>
          <td>#${escapeHtml(r.id)}</td>
        </tr>
      </table>
      <div class="inv-total">Total Paid: $${zyFmtMoney((Number(r.amount) || 0), 2)}</div>
      <div class="inv-footer">Generated by ${escapeHtml(siteName)} Panel · System-generated payout invoice.</div>
    </body></html>
  `;
  if (typeof zyPrintHtml === 'function') { zyPrintHtml(invoiceHtml); return; }
  openModal(`Payout Invoice — #${escapeHtml(invoiceNo)}`, `
    <div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:14px;">
      ${invoiceHtml}
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="window.print()"><i class="fas fa-print"></i> Print Invoice</button>
    </div>
  `);
}

// ─── AGENT NUMBER REQUESTS ────────────────────────────────────────
async function renderAgentRequests() {
  try {
    const raw = await apiFetch('/api/agent-requests');
    const data = Array.isArray(raw) ? raw : (raw?.data || []);
    window._zyOwnerNumRequestsCache = data;
    const pending = data.filter(r => (r.status || '').toLowerCase() === 'pending').length;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Number Requests</div>
          <div class="page-subtitle">${pending} pending number inventory requests across accounts</div>
        </div>
      </div>
      <div class="card">
        ${buildTable(
          ['#', 'Requester', 'Range / Service', 'App', 'Free', 'Qty', 'Urgency', 'Status', 'Date', 'Actions'],
          data.map(r => {
            const reqQty = Number(r.quantity || 1);
            const freeCnt = Number(r.free_count != null ? r.free_count : 0);
            const freeBadgeCls = freeCnt === 0 ? 'badge-red' : (freeCnt < reqQty ? 'badge-yellow' : 'badge-green');
            const reqUser = escapeHtml(r.requester_username || r.agent_username || r.agent_name || ('Account #' + (r.requester_id || r.agent_id || '—')));
            const rngName = escapeHtml(r.range_name || ('Range #' + (r.range_id || '—')));
            const qtyDisplay = (r.fulfilled_count != null && Number(r.fulfilled_count) !== reqQty && String(r.status || '').toLowerCase() === 'approved')
              ? `<span class="badge badge-blue fw-600" title="Allocated ${r.fulfilled_count} of ${reqQty} requested">${r.fulfilled_count} / ${reqQty}</span>`
              : `<span class="badge badge-blue fw-600">${reqQty}</span>`;
            return [
              r.id || '—',
              `<strong>${reqUser}</strong> <span class="badge badge-blue" style="font-size:10px;">${escapeHtml(r.requester_role || r.agent_role || 'Agent')}</span>`,
              rngName,
              escapeHtml(r.app_name || r.service_name || 'General'),
              `<span class="badge ${freeBadgeCls} fw-600" title="Available unassigned numbers in Owner pool for this range">${freeCnt.toLocaleString()}</span>`,
              qtyDisplay,
              badge(r.urgency || 'normal', r.urgency === 'high' ? 'red' : 'blue'),
              statusBadge(r.status),
              fmtShort(r.created_at || r.created),
              (r.status || '').toLowerCase() === 'pending' ? `
                <div style="display:inline-flex;gap:5px;justify-content:center;">
                  <button class="btn btn-success btn-sm" onclick="fulfillAgentRequestPrompt(${Number(r.id)})"><i class="fas fa-check"></i> Fulfill</button>
                  <button class="btn btn-danger btn-sm" onclick="rejectAgentRequestPrompt(${Number(r.id)})"><i class="fas fa-times"></i> Reject</button>
                </div>
              ` : (r.rejected_reason || r.reason ? `<span class="text-muted fs-12">${escapeHtml(r.rejected_reason || r.reason)}</span>` : '—')
            ];
          }),
          { id: 'tbl-agent-requests', title: 'Agent Number Requests', toolbar: true }
        )}
      </div>
    `;
  } catch (err) {
    console.error('Agent requests error:', err);
    toast('Failed to load number requests', 'error');
  }
}

function fulfillAgentRequestPrompt(id) {
  const req = (window._zyOwnerNumRequestsCache || []).find(x => Number(x.id) === Number(id)) || {};
  const reqQty = Number(req.quantity || 1);
  const freeCnt = Number(req.free_count != null ? req.free_count : 0);
  const rangeId = req.range_id || null;
  const rangeName = escapeHtml(req.range_name || ('Range #' + (rangeId || '—')));
  const requester = escapeHtml(req.requester_username || req.agent_username || 'Agent');
  const suggested = freeCnt > 0 ? Math.min(reqQty, freeCnt) : 0;

  let stockNotice = '';
  if (freeCnt === 0) {
    stockNotice = `<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 12px;font-size:12.5px;font-weight:600;margin-bottom:12px;">
      <i class="fas fa-circle-exclamation"></i> 0 free numbers available in Master Pool for "${rangeName}". Please upload/import numbers into this range before accepting.
    </div>`;
  } else if (freeCnt < reqQty) {
    stockNotice = `<div style="background:#fffbeb;border:1px solid #fde68a;color:#b45309;border-radius:8px;padding:10px 12px;font-size:12.5px;font-weight:600;margin-bottom:12px;">
      <i class="fas fa-triangle-exclamation"></i> Requested <b>${reqQty}</b>, but only <b>${freeCnt}</b> free number(s) exist in "${rangeName}". You can allocate up to <b>${freeCnt}</b> now.
    </div>`;
  }

  openModal('Fulfill Number Request', `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;background:var(--sp-bg-subtle,#f8fafc);border:1px solid var(--sp-border,#e2e8f0);border-radius:8px;padding:10px;text-align:center;">
      <div><div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Range</div><div style="font-size:12.5px;font-weight:700;margin-top:2px;">${rangeName}</div></div>
      <div><div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Requested</div><div style="font-size:15px;font-weight:800;color:#2563eb;margin-top:2px;">${reqQty}</div></div>
      <div><div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Free Pool</div><div style="font-size:15px;font-weight:800;color:${freeCnt === 0 ? '#dc2626' : (freeCnt < reqQty ? '#d97706' : '#059669')};margin-top:2px;">${freeCnt}</div></div>
    </div>
    ${stockNotice}
    <div class="form-group">
      <label class="form-label">Allocate Qty to ${requester} (Max available: ${freeCnt}) *</label>
      <input type="number" id="fulfill-count-input" value="${suggested}" min="${freeCnt > 0 ? 1 : 0}" max="${freeCnt}" ${freeCnt === 0 ? 'disabled' : ''} required>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button type="button" class="btn btn-success" id="fulfill-btn" ${freeCnt === 0 ? 'disabled' : ''} onclick="submitFulfillRequest(${Number(id)}, ${rangeId || 'null'}, ${freeCnt})"><i class="fas fa-check"></i> Fulfill Allocation</button>
    </div>
  `);
}

async function submitFulfillRequest(id, rangeId, maxFree) {
  const count = parseInt(document.getElementById('fulfill-count-input')?.value, 10) || 0;
  if (count <= 0) {
    toast('Enter a valid quantity (at least 1).', 'error');
    return;
  }
  if (typeof maxFree === 'number' && count > maxFree) {
    toast(`Only ${maxFree} free number(s) available in pool. Please enter ${maxFree} or fewer.`, 'error');
    return;
  }
  const btn = document.getElementById('fulfill-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Allocating...'; }
  try {
    const res = await apiFetch(`/api/agent-requests/${id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({ count, range_id: rangeId })
    });
    if (res && res.success) {
      closeModal();
      toast(`Allocated ${res.allocated || count} number(s) and fulfilled request!`, 'success');
      renderAgentRequests();
    } else {
      toast(res?.error || 'Failed to fulfill request', 'error');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Fulfill Allocation'; }
  }
}

function rejectAgentRequestPrompt(id) {
  openModal('Decline Number Request', `
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">
      Please specify a reason for rejecting this number request. The agent will be notified immediately.
    </div>
    <div class="form-group">
      <label class="form-label">Reason for rejection *</label>
      <input type="text" id="reject-reason-input" value="No inventory currently available in this range" required>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button type="button" class="btn btn-danger" id="reject-btn" onclick="submitRejectRequest(${id})"><i class="fas fa-times"></i> Reject Request</button>
    </div>
  `);
}

async function submitRejectRequest(id) {
  const reason = document.getElementById('reject-reason-input')?.value || 'Rejected by administrator';
  const btn = document.getElementById('reject-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Rejecting...'; }
  try {
    const res = await apiFetch(`/api/agent-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    if (res && res.success) {
      closeModal();
      toast('Request rejected', 'warning');
      renderAgentRequests();
    } else {
      toast(res?.error || 'Failed to reject request', 'error');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openSetMinPayoutModal(current) {
  openModal('Set Minimum Payout', `
    <p class="text-muted fs-12" style="margin-bottom:12px;">
      Any Agent requesting a payout below this amount will be blocked with a "Payment low" message.
    </p>
    <div class="form-group">
      <label class="form-label">Minimum Payout ($) *</label>
      <input type="number" id="min-payout-input" step="0.01" min="0" value="${current}" required>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button type="button" class="btn btn-primary" onclick="submitMinPayout()"><i class="fas fa-check"></i> Save</button>
    </div>
  `);
}

async function submitMinPayout() {
  const val = parseFloat(document.getElementById('min-payout-input')?.value);
  if (isNaN(val) || val < 0) { toast('Enter a valid amount', 'error'); return; }
  const result = await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify({ min_payout: val }) });
  if (!result) return;
  closeModal();
  toast(`✅ Minimum payout set to $${zyFmtMoney(val, 4)}`, 'success');
  renderPayoutRequests();
}

async function approvePayout(id) {
  try {
    await apiFetch(`/api/payout-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) });
    toast('Payout marked as paid', 'success');
    renderPayoutRequests();
  } catch (err) {
    console.error('Approve payout error:', err);
    toast('Failed to approve payout', 'error');
  }
}

async function markPayoutPending(id) {
  try {
    await apiFetch(`/api/payout-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'pending' }) });
    toast('Payout request kept in Pending queue and requester notified', 'info');
    renderPayoutRequests();
  } catch (err) {
    console.error('Pending payout error:', err);
    toast(err.message || 'Failed to mark payout as pending', 'error');
  }
}

// ─── MULTI-CURRENCY STATEMENTS & CREDIT NOTES ────────────────────
let _lastStatementRows = [];
let _lastStatementCurrency = 'USD';

async function renderStatementsHub(currency = 'USD', agentId = '') {
  try {
    const cur = ['USD', 'EUR', 'GBP'].includes(String(currency).toUpperCase()) ? String(currency).toUpperCase() : 'USD';
    _lastStatementCurrency = cur;
    const params = new URLSearchParams({ currency: cur });
    if (agentId) params.append('agent_id', agentId);

    const [res, agentsRes] = await Promise.all([
      apiFetch(`/api/statements?${params.toString()}`),
      apiFetch('/api/agents?limit=500').catch(() => ({ data: [] }))
    ]);
    const rows = (res && res.data) || [];
    _lastStatementRows = rows;
    const agents = (agentsRes && agentsRes.data) || [];
    const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$';
    const totCredit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
    const totDebit = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
    const totBal = rows.reduce((s, r) => s + (Number(r.balance) || 0), 0);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Multi-Currency Statements (${cur})</div>
          <div class="page-subtitle">Monthly wholesale revenue vs payouts settlement statements</div>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="exportStatementsCsv()"><i class="fas fa-file-csv"></i> Export CSV</button>
        </div>
      </div>
      ${renderOwnerHubTabs('finance', 'statements')}
      <div class="card" style="margin-bottom:16px;">
        <div class="filters-bar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          ${['USD', 'EUR', 'GBP'].map(k => `
            <button type="button" class="btn btn-sm ${cur === k ? 'btn-primary' : 'btn-outline'}" onclick="renderStatementsHub('${k}', document.getElementById('stmt-agent')?.value || '')">${k}</button>
          `).join('')}
          <select id="stmt-agent" style="min-width:180px;" onchange="renderStatementsHub('${cur}', this.value)">
            <option value="">All Agents (Owner Ledger)</option>
            ${agents.map(a => `<option value="${a.id}" ${String(agentId) === String(a.id) ? 'selected' : ''}>${escapeHtml(a.username || ('Agent #' + a.id))}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px;">
        ${statCard(`Total Credited (${cur})`, 'fas fa-arrow-trend-up', `${sym}${zyFmtMoney(totCredit, 4)}`, 'green', 'SMS revenue')}
        ${statCard(`Total Paid Out (${cur})`, 'fas fa-money-bill-transfer', `${sym}${zyFmtMoney(totDebit, 4)}`, 'blue', 'Settled payouts')}
        ${statCard(`Net Balance (${cur})`, 'fas fa-scale-balanced', `${sym}${zyFmtMoney(totBal, 4)}`, 'purple', 'Credit - Debit')}
      </div>
      <div class="card">
        ${buildTable(
          ['Month', 'Currency', 'SMS Count', 'Credit (Earned)', 'Debit (Paid)', 'Net Balance'],
          rows.map(r => [
            `<strong>${escapeHtml(r.month || '—')}</strong>`,
            badge(r.currency || cur, 'blue'),
            r.count || 0,
            `<span class="text-success fw-600">${sym}${zyFmtMoney(Number(r.credit || 0), 4)}</span>`,
            `<span class="text-muted">${sym}${zyFmtMoney(Number(r.debit || 0), 4)}</span>`,
            `<strong>${sym}${zyFmtMoney(Number(r.balance || 0), 4)}</strong>`
          ]),
          { id: 'tbl-statements', title: `${cur} Statements`, toolbar: true }
        )}
      </div>
    `;
  } catch (err) {
    console.error('Statements hub error:', err);
    toast('Failed to load statements', 'error');
  }
}

function exportStatementsCsv() {
  const rows = _lastStatementRows || [];
  const cur = _lastStatementCurrency || 'USD';
  let csv = `Month,Currency,SMS Count,Credit,Debit,Balance\n`;
  rows.forEach(r => {
    csv += `${r.month || ''},${r.currency || cur},${r.count || 0},${zyFmtMoney(Number(r.credit || 0), 4)},${zyFmtMoney(Number(r.debit || 0), 4)},${zyFmtMoney(Number(r.balance || 0), 4)}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `humax_statements_${cur}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${cur} statements CSV`, 'success');
}

async function renderCreditNotesHub() {
  try {
    const res = await apiFetch('/api/credit-notes');
    const notes = (res && res.data) || [];
    const totalVal = notes.reduce((s, n) => s + (Number(n.amount) || 0), 0);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Credit Notes &amp; Settlement Vouchers</div>
          <div class="page-subtitle">${notes.length} credit note(s) issued · Total $${zyFmtMoney(totalVal, 4)}</div>
        </div>
      </div>
      ${renderOwnerHubTabs('finance', 'credit-notes')}
      <div class="card">
        ${buildTable(
          ['Voucher #', 'Account', 'Role', 'Currency', 'Amount', 'Term', 'Reason', 'Date', 'Status', 'PDF'],
          notes.map(n => [
            `<span class="monospace fw-600">CN-${String(n.id).padStart(5, '0')}</span>`,
            `<strong>${escapeHtml(n.username || (n.agent_id ? 'Agent #' + n.agent_id : 'Account Holder'))}</strong>`,
            roleBadge(n.role || 'Agent'),
            badge(n.currency || 'USD', 'blue'),
            `<strong class="text-success">$${zyFmtMoney(Number(n.amount || 0), 2)}</strong>`,
            escapeHtml(n.term || 'Weekly'),
            escapeHtml(n.reason || 'SMS Wholesale Revenue'),
            fmtShort(n.date || n.created),
            statusBadge((n.status || 'settled').toLowerCase()),
            `<button class="btn btn-outline btn-sm" onclick="printCreditNotePdf(${Number(n.id)})"><i class="fas fa-file-pdf"></i> View / Print</button>`
          ]),
          { id: 'tbl-credit-notes', title: 'Credit Notes', toolbar: true }
        )}
      </div>
    `;
  } catch (err) {
    console.error('Credit notes error:', err);
    toast('Failed to load credit notes', 'error');
  }
}

async function printCreditNotePdf(id) {
  try {
    const res = await fetch(`/api/credit-notes/${id}/pdf`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load credit note');
    const html = await res.text();
    if (typeof zyPrintHtml === 'function') {
      zyPrintHtml(html);
      return;
    }
    openModal(`Credit Note #CN-${String(id).padStart(5, '0')}`, `<div style="max-height:70vh;overflow:auto;">${html}</div><div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Close</button><button class="btn btn-primary" onclick="window.print()">Print</button></div>`);
  } catch (err) {
    console.error('Print credit note error:', err);
    toast('Failed to open credit note', 'error');
  }
}

async function openAdminAddAgentModal() {
  openModal('Add New Agent', `
    <form id="admin-add-agent-form" onsubmit="submitAdminAddAgent(event)">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Username *</label>
          <input id="aa-user" placeholder="agent_name" required>
          <div id="aa-user-feedback" style="margin-top:4px;"></div>
        </div>
        <div class="form-group"><label class="form-label">Password *</label><input type="password" id="aa-pass" value="agent123" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Full Name</label><input id="aa-fullname" placeholder="Agent's full name"></div>
        <div class="form-group"><label class="form-label">Commission Rate (%)</label><input type="number" id="aa-commission" value="5" step="0.1"></div>
      </div>
      <div class="form-group"><label class="form-label">Initial Balance ($)</label><input type="number" id="aa-bal" value="0" step="0.01"></div>
      <div class="form-group" style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 12px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;color:#312e81;margin:0;">
          <input type="checkbox" id="aa-wn-access"> Whitenoise Access (Numbers, Ranges &amp; CDR 2 · Monthly 30/5 {W})
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="aa-submit-btn"><i class="fas fa-user-plus"></i> Create Agent</button>
      </div>
    </form>
  `);
  setTimeout(() => window.setupUsernameAvailabilityCheck('aa-user', 'aa-user-feedback', 'aa-submit-btn', 'agents'), 50);
}

async function submitAdminAddAgent(event) {
  event.preventDefault();
  try {
    const username = document.getElementById('aa-user').value.trim();
    const password = document.getElementById('aa-pass').value;
    if (!username || !password) { toast('Username and password are required', 'error'); return; }

    const btn = document.getElementById('aa-submit-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Creating...'; }

    const payload = {
      username, password,
      full_name: document.getElementById('aa-fullname').value,
      commission_rate: parseFloat(document.getElementById('aa-commission').value) || 5,
      balance: parseFloat(document.getElementById('aa-bal').value) || 0,
      whitenoise_access: Boolean(document.getElementById('aa-wn-access')?.checked),
      status: 'active'
    };

    const result = await apiFetch('/api/agents', { method: 'POST', body: JSON.stringify(payload) });
    if (result && result.id) {
      closeModal();
      zyFlash('Agent Added.');
      await renderAdminAgents();
      zyShowFlash();
    } else {
      toast(result?.error || 'Failed — username may already exist', 'error');
    }
  } catch (err) {
    console.error('Add agent error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('aa-submit-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Agent'; }
  }
}

// ─── AGENTS ──────────────────────────────────────────────────────────
async function renderAdminAgents(page = 1) {
  try {
    const data = await apiFetch(`/api/agents?page=${page}&limit=25`);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">All Agents</div><div class="page-subtitle">${data?.total || 0} direct agents under Owner</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openAdminAddAgentModal()"><i class="fas fa-user-plus"></i> Add Agent</button>
        </div>
      </div>
      <div class="card">
        ${renderManagementTabs('agents')}
        ${buildTable(
          ['#', 'Username', 'Full Name', 'Balance', 'Clients', 'Numbers', 'Today OTP', 'Commission', 'Status', 'Actions'],
          (data?.data || []).map((a, idx) => [
            `<strong class="monospace">#${(page - 1) * 25 + idx + 1}</strong>`,
            `<strong>${escapeHtml(a.username || '—')}</strong>${a.whitenoise_access ? ' <span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;font-size:10px;">WN</span>' : ''}`,
            escapeHtml(a.full_name || '—'),
            `<span class="text-success fw-600">$${zyFmtMoney((a.balance || 0), 2)}</span>`,
            a.clients_count || 0,
            a.numbers_assigned || 0,
            `<span class="badge badge-green">${a.today_otp || 0}</span>`,
            (a.commission_rate || 0) + '%',
            statusBadge(a.status),
            `<div style="display:inline-flex;gap:4px;align-items:center;">
              <button class="btn btn-outline btn-sm" onclick="openViewUserModal(${Number(a.id)},'agent')" title="View Agent Details"><i class="fas fa-eye"></i></button>
              <button class="btn btn-outline btn-sm" onclick="openEditAgentModal(${Number(a.id)})" title="Edit Agent"><i class="fas fa-pen"></i></button>
              <button class="btn btn-outline btn-sm" onclick="openResetPasswordModal(${Number(a.id)},'${escapeHtml(a.username)}','agents')" title="Reset Password"><i class="fas fa-key"></i></button>
              <button class="btn btn-outline btn-sm" onclick="openAgentBalanceModal(${Number(a.id)},'${escapeHtml(a.username)}',${Number(a.balance) || 0})" title="Adjust Balance"><i class="fas fa-dollar-sign"></i></button>
              <button class="btn btn-${a.status === 'active' ? 'warning' : 'success'} btn-sm" onclick="toggleAgentAdmin(${Number(a.id)},'${escapeHtml(a.status)}')" title="${a.status === 'active' ? 'Suspend' : 'Activate'}"><i class="fas fa-${a.status === 'active' ? 'pause' : 'play'}"></i></button>
              <button class="btn btn-danger btn-sm" onclick="deleteAgentAdmin(${Number(a.id)})" title="Delete"><i class="fas fa-trash"></i></button>
            </div>`
          ]),
          { id: 'tbl-agents', title: 'Agents List', toolbar: true }
        )}
        ${pagination(page, data?.total || 0, 25, renderAdminAgents)}
      </div>
    `;
  } catch (err) {
    console.error('Agents error:', err);
    toast('Failed to load agents', 'error');
  }
}

function openAgentBalanceModal(id, username, current) {
  openModal(`Adjust Balance — ${escapeHtml(username)}`, `
    <p class="text-muted" style="margin-bottom:16px;">Current balance: <strong class="text-success">$${zyFmtMoney((current || 0), 2)}</strong></p>
    <form onsubmit="submitAgentBalance(event, ${id})">
      <div class="form-group">
        <label class="form-label">Operation</label>
        <select id="agbal-op">
          <option value="add">Add</option>
          <option value="subtract">Subtract</option>
          <option value="set">Set to</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Amount ($)</label>
        <input type="number" id="agbal-amt" placeholder="0.00" step="0.01" required>
      </div>
      <div class="form-group">
        <label class="form-label">Reason</label>
        <input id="agbal-reason" placeholder="e.g. Bonus, correction, refund…">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="agbal-submit-btn"><i class="fas fa-check"></i> Apply</button>
      </div>
    </form>
  `);
}

async function submitAgentBalance(event, id) {
  event.preventDefault();
  const operation = document.getElementById('agbal-op').value;
  const amount = parseFloat(document.getElementById('agbal-amt').value);
  const reason = document.getElementById('agbal-reason').value;
  if (isNaN(amount) || amount < 0) { toast('Enter a valid amount', 'error'); return; }

  const adminUser = JSON.parse(sessionStorage.getItem('admin_user') || '{}');
  const result = await apiFetch(`/api/agents/${id}/adjust-balance`, {
    method: 'POST',
    body: JSON.stringify({ operation, amount, reason, adjusted_by: adminUser.username || 'Admin' })
  });
  if (!result) return;
  closeModal();
  toast(`✅ Balance updated: $${zyFmtMoney(result.before, 2)} → $${zyFmtMoney(result.after, 2)}`, 'success');
  renderAdminAgents();
}

async function toggleAgentAdmin(id, status) {
  try {
    const newS = status === 'active' ? 'suspended' : 'active';
    await apiFetch(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newS }) });
    toast(`Agent ${newS}`, 'info');
    renderAdminAgents();
  } catch (err) {
    console.error('Toggle agent error:', err);
    toast('Failed to toggle agent', 'error');
  }
}

async function deleteAgentAdmin(id) {
  if (!confirm('Delete agent?')) return;

  try {
    await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
    toast('Deleted', 'warning');
    renderAdminAgents();
  } catch (err) {
    console.error('Delete agent error:', err);
    toast('Failed to delete agent', 'error');
  }
}

async function openEditAgentModal(id) {
  try {
    const agent = await apiFetch(`/api/agents/${id}`);
    if (!agent) return;
    openModal(`Edit Agent — ${escapeHtml(agent.username)}`, `
      <form id="edit-agent-form" onsubmit="submitEditAgent(event, ${Number(id)})" autocomplete="off">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Username</label><input value="${escapeHtml(agent.username || '')}" id="edit-ag-user" required autocomplete="off"></div>
          <div class="form-group"><label class="form-label">Full Name</label><input value="${escapeHtml(agent.full_name || '')}" id="edit-ag-fullname" autocomplete="off"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Email</label><input type="email" value="${escapeHtml(agent.email || '')}" id="edit-ag-email" autocomplete="off"></div>
          <div class="form-group"><label class="form-label">Commission %</label><input type="number" value="${Number(agent.commission_rate) || 0}" id="edit-ag-comm" step="0.1" min="0" max="100"></div>
        </div>
        <div class="form-group"><label class="form-label">New Password (optional)</label><input type="password" id="edit-ag-pass" autocomplete="new-password" placeholder="Leave blank to keep current"></div>
        <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
          <div style="font-weight:700;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Number Acquisition Override (Optional)</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Acquisition Mode</label>
              <select id="edit-ag-alloc-mode">
                <option value="" ${!agent.alloc_mode ? 'selected' : ''}>Inherit Default</option>
                <option value="request" ${agent.alloc_mode === 'request' ? 'selected' : ''}>Request Only</option>
                <option value="self_allocate" ${agent.alloc_mode === 'self_allocate' ? 'selected' : ''}>Self-Allocate Only</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Daily Limit (blank = inherit, 0 = unlimited)</label>
              <input type="number" id="edit-ag-alloc-daily" min="0" value="${agent.alloc_daily_limit ?? ''}" placeholder="Inherit">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Total Holding Limit (blank = inherit, 0 = unlimited)</label>
            <input type="number" id="edit-ag-alloc-total" min="0" value="${agent.alloc_total_limit ?? ''}" placeholder="Inherit">
          </div>
        </div>
        <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:10px 14px;margin-bottom:14px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;color:#312e81;margin:0;">
            <input type="checkbox" id="edit-ag-wn-access" ${agent.whitenoise_access ? 'checked' : ''}>
            Whitenoise Access (Numbers, Ranges &amp; CDR 2 · Monthly 30/5 {W})
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="edit-ag-btn"><i class="fas fa-save"></i> Save Changes</button>
        </div>
      </form>
    `);
  } catch (err) {
    console.error('Edit agent error:', err);
    toast('Failed to load agent', 'error');
  }
}

async function submitEditAgent(event, id) {
  event.preventDefault();
  const username = document.getElementById('edit-ag-user').value.trim();
  if (!username) { toast('Username is required', 'error'); return; }
  const agMode = document.getElementById('edit-ag-alloc-mode')?.value || '';
  const agDailyRaw = document.getElementById('edit-ag-alloc-daily')?.value;
  const agTotalRaw = document.getElementById('edit-ag-alloc-total')?.value;
  const payload = {
    username,
    full_name: document.getElementById('edit-ag-fullname').value.trim(),
    email: document.getElementById('edit-ag-email').value.trim(),
    commission_rate: parseFloat(document.getElementById('edit-ag-comm').value) || 0,
    whitenoise_access: Boolean(document.getElementById('edit-ag-wn-access')?.checked),
    alloc_mode: agMode || null,
    alloc_daily_limit: agDailyRaw !== '' && agDailyRaw !== undefined ? Math.max(0, parseInt(agDailyRaw, 10) || 0) : null,
    alloc_total_limit: agTotalRaw !== '' && agTotalRaw !== undefined ? Math.max(0, parseInt(agTotalRaw, 10) || 0) : null
  };
  const pass = document.getElementById('edit-ag-pass').value;
  if (pass) {
    if (pass.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    payload.password = pass;
  }
  const btn = document.getElementById('edit-ag-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }
  try {
    const res = await apiFetch(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (res) {
      closeModal();
      toast('Agent updated successfully', 'success');
      renderAdminAgents();
    }
  } catch (err) {
    console.error('Submit edit agent error:', err);
    toast(err.message || 'Failed to update agent', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
  }
}

// ─── CLIENTS ─────────────────────────────────────────────────────────
async function renderAdminClients(page = 1) {
  try {
    const data = await apiFetch(`/api/clients?page=${page}&limit=25`);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">All Clients</div>
          <div class="page-subtitle">${data?.total || 0} clients across Agents · Basic directory only (PKR balances, bank/wallet &amp; contact details are private and managed by their Agent)</div>
        </div>
      </div>
      <div class="card">
        ${renderManagementTabs('clients')}
        ${buildTable(
          ['#', 'Username', 'Assigned Agent', 'Financial Scope', 'Numbers', 'Status', 'Created / Active', 'Actions'],
          (data?.data || []).map((c, idx) => {
            const isPrivate = c.privacy_redacted === true || c.balance === undefined;
            const privacyHtml = isPrivate
              ? '<span class="badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;"><i class="fas fa-lock" style="margin-right:4px;"></i>Private · Agent PKR</span>'
              : `<span class="text-success">$${zyFmtMoney(Number(c.balance || 0), 2)}</span>`;
            return [
              `<strong class="monospace">#${(page - 1) * 25 + idx + 1}</strong>`,
              `<strong>${escapeHtml(c.username || '—')}</strong>${c.whitenoise_access ? ' <span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;font-size:10px;">WN</span>' : ''}`,
              badge(c.agent_username ? `Agent: ${escapeHtml(c.agent_username)}` : (escapeHtml(c.agent_name) || (c.agent_id ? `Agent #${c.agent_id}` : '—')), 'blue'),
              privacyHtml,
              c.numbers_assigned ?? c.numbers ?? 0,
              statusBadge(c.status),
              fmtShort(c.created_at || c.created || c.last_active),
              `<div style="display:inline-flex;gap:4px;align-items:center;">
                <button class="btn btn-outline btn-sm" onclick="openViewUserModal(${Number(c.id)},'client')" title="View Client Directory Details"><i class="fas fa-eye"></i></button>
                <button class="btn btn-outline btn-sm" onclick="openEditClientModal(${Number(c.id)})" title="Edit Client Settings"><i class="fas fa-pen"></i></button>
                <button class="btn btn-outline btn-sm" onclick="openResetPasswordModal(${Number(c.id)},'${escapeHtml(c.username)}','clients')" title="Reset Password"><i class="fas fa-key"></i></button>
                <button class="btn btn-${c.status === 'active' ? 'warning' : 'success'} btn-sm" onclick="toggleClientAdmin(${Number(c.id)},'${escapeHtml(c.status)}')" title="${c.status === 'active' ? 'Suspend' : 'Activate'}"><i class="fas fa-${c.status === 'active' ? 'pause' : 'play'}"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteClientAdmin(${Number(c.id)})" title="Delete"><i class="fas fa-trash"></i></button>
              </div>`
            ];
          }),
          { id: 'tbl-clients', title: 'Clients Directory (Privacy Protected)', toolbar: true }
        )}
        ${pagination(page, data?.total || 0, 25, renderAdminClients)}
      </div>
    `;
  } catch (err) {
    console.error('Admin clients error:', err);
    toast('Failed to load clients', 'error');
  }
}

async function toggleClientAdmin(id, status) {
  try {
    const newS = status === 'active' ? 'suspended' : 'active';
    await apiFetch(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newS }) });
    toast(`Client marked as ${newS}`, 'info');
    renderAdminClients();
  } catch (err) {
    toast('Failed to toggle client', 'error');
  }
}

async function deleteClientAdmin(id) {
  if (!confirm('Are you sure you want to delete this client?')) return;
  try {
    const res = await apiFetch(`/api/clients/${id}`, { method: 'DELETE' });
    if (res && res.error) {
      toast(res.error, 'error');
    } else {
      toast('Client deleted', 'warning');
      renderAdminClients();
    }
  } catch (err) {
    toast('Failed to delete client: ' + err.message, 'error');
  }
}

function openClientBalanceModal() {
  toast('Client PKR balances are private and managed exclusively by their assigned Agent.', 'info');
}

async function openEditClientModal(id) {
  try {
    const client = await apiFetch(`/api/clients/${id}`);
    if (!client) return;
    const isRedacted = client.privacy_redacted === true;
    openModal(`Edit Client — ${escapeHtml(client.username)}`, `
      <form id="edit-client-form" onsubmit="submitEditClient(event, ${Number(id)})" autocomplete="off">
        ${isRedacted ? `
          <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#475569;">
            <i class="fas fa-lock" style="color:#0284c7;margin-right:6px;"></i>
            <strong>Privacy Protected:</strong> Client email, phone, bank/wallet details, and PKR balance are managed exclusively by their Agent (${escapeHtml(client.agent_username || (client.agent_id ? 'Agent #' + client.agent_id : 'Assigned Agent'))}).
          </div>
        ` : ''}
        <div class="${isRedacted ? 'form-group' : 'form-row'}">
          <div class="form-group"><label class="form-label">Username</label><input value="${escapeHtml(client.username || '')}" id="edit-cl-user" required autocomplete="off"></div>
          ${!isRedacted ? `<div class="form-group"><label class="form-label">Full Name</label><input value="${escapeHtml(client.full_name || '')}" id="edit-cl-fullname" autocomplete="off"></div>` : ''}
        </div>
        ${!isRedacted ? `<div class="form-group"><label class="form-label">Email</label><input type="email" value="${escapeHtml(client.email || '')}" id="edit-cl-email" autocomplete="off"></div>` : ''}
        <div class="form-group"><label class="form-label">New Password (optional)</label><input type="password" id="edit-cl-pass" autocomplete="new-password" placeholder="Leave blank to keep current"></div>
        <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
          <div style="font-weight:700;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Number Acquisition Override (Optional)</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Acquisition Mode</label>
              <select id="edit-cl-alloc-mode">
                <option value="" ${!client.alloc_mode ? 'selected' : ''}>Inherit Default</option>
                <option value="request" ${client.alloc_mode === 'request' ? 'selected' : ''}>Request Only</option>
                <option value="self_allocate" ${client.alloc_mode === 'self_allocate' ? 'selected' : ''}>Self-Allocate Only</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Daily Limit (blank = inherit, 0 = unlimited)</label>
              <input type="number" id="edit-cl-alloc-daily" min="0" value="${client.alloc_daily_limit ?? ''}" placeholder="Inherit">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Total Holding Limit (blank = inherit, 0 = unlimited)</label>
            <input type="number" id="edit-cl-alloc-total" min="0" value="${client.alloc_total_limit ?? ''}" placeholder="Inherit">
          </div>
        </div>
        <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:10px 14px;margin-bottom:14px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;color:#312e81;margin:0;">
            <input type="checkbox" id="edit-cl-wn-access" ${client.whitenoise_access ? 'checked' : ''}>
            Whitenoise Access (Numbers, Ranges &amp; CDR 2 · Monthly 30/5 {W})
          </label>
          <div style="font-size:11px;color:#4338ca;margin-top:4px;">Note: Assigned Agent must also have Whitenoise Access enabled for Client access to be active.</div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="edit-cl-btn"><i class="fas fa-save"></i> Save Changes</button>
        </div>
      </form>
    `);
  } catch (err) {
    console.error('Edit client error:', err);
    toast('Failed to load client', 'error');
  }
}

async function submitEditClient(event, id) {
  event.preventDefault();
  const username = document.getElementById('edit-cl-user').value.trim();
  if (!username) { toast('Username is required', 'error'); return; }
  const clMode = document.getElementById('edit-cl-alloc-mode')?.value || '';
  const clDailyRaw = document.getElementById('edit-cl-alloc-daily')?.value;
  const clTotalRaw = document.getElementById('edit-cl-alloc-total')?.value;
  const payload = {
    username,
    whitenoise_access: Boolean(document.getElementById('edit-cl-wn-access')?.checked),
    alloc_mode: clMode || null,
    alloc_daily_limit: clDailyRaw !== '' && clDailyRaw !== undefined ? Math.max(0, parseInt(clDailyRaw, 10) || 0) : null,
    alloc_total_limit: clTotalRaw !== '' && clTotalRaw !== undefined ? Math.max(0, parseInt(clTotalRaw, 10) || 0) : null
  };
  const fnEl = document.getElementById('edit-cl-fullname');
  const emEl = document.getElementById('edit-cl-email');
  if (fnEl) payload.full_name = fnEl.value.trim();
  if (emEl) payload.email = emEl.value.trim();
  const pass = document.getElementById('edit-cl-pass').value;
  if (pass) {
    if (pass.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    payload.password = pass;
  }
  const btn = document.getElementById('edit-cl-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }
  try {
    const res = await apiFetch(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (res) {
      closeModal();
      toast('Client updated successfully', 'success');
      renderAdminClients();
    }
  } catch (err) {
    console.error('Submit edit client error:', err);
    toast(err.message || 'Failed to update client', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
  }
}

// ─── HIERARCHY VIEW (3-Tier: Owner -> Agent -> Client) ───────────
async function renderHierarchy() {
  try {
    const data = await apiFetch('/api/hierarchy');
    const c = document.getElementById('page-content');
    const nodes = Array.isArray(data) ? data : [];
    const rootEntry = nodes[0] || {};
    const ownerInfo = rootEntry.owner || { username: 'Kamran_Bhatti', role: 'Owner' };
    const agentList = Array.isArray(rootEntry.agents) ? rootEntry.agents : [];

    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Hierarchy View</div><div class="page-subtitle">Direct 3-Tier Chain: Owner → Agent (USD) → Client (Basic Directory · PKR Private)</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openAdminAddAgentModal()"><i class="fas fa-user-plus"></i> Add Agent</button>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        ${renderManagementTabs('hierarchy')}
      </div>
      <div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,rgba(99,102,241,0.12) 0%,rgba(59,130,246,0.06) 100%);border:1px solid rgba(99,102,241,0.3);padding:14px 18px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:42px;height:42px;border-radius:10px;background:#6366f1;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;">
            <i class="fas fa-crown"></i>
          </div>
          <div>
            <div style="font-weight:700;font-size:15px;color:var(--text);display:flex;align-items:center;gap:8px;">
              <span>${escapeHtml(ownerInfo.username || 'Kamran_Bhatti')}</span>
              <span class="badge badge-purple" style="font-size:11px;">Company Owner</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
              Master Root Node · Controls Direct Agents (${agentList.length}) &amp; Master Number Pools
            </div>
          </div>
          <div style="margin-left:auto;">
            <span class="badge badge-green"><i class="fas fa-sitemap"></i> Root Controller</span>
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;">
        ${agentList.length ? agentList.map(agent => `
          <div class="card">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
              <div style="width:38px;height:38px;background:rgba(76,110,245,0.18);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:16px;">
                <i class="fas fa-user-secret"></i>
              </div>
              <div>
                <div style="font-size:15px;font-weight:700;">${escapeHtml(agent.username || '—')}</div>
                <div class="text-muted fs-12">${(agent.clients || []).length} client(s) · ${agent.commission_rate || 0}% commission · $${zyFmtMoney(Number(agent.balance || 0), 2)}</div>
              </div>
              <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
                ${statusBadge(agent.status)}
                <button class="btn btn-outline btn-sm" onclick="openEditAgentModal(${Number(agent.id)})" title="Edit Agent"><i class="fas fa-pen"></i></button>
              </div>
            </div>
            <div style="margin-left:18px;border-left:2px solid var(--border);padding-left:16px;display:flex;flex-wrap:wrap;gap:8px;">
              ${(agent.clients || []).length ? agent.clients.map(cl => {
                const isRedacted = cl.privacy_redacted === true || cl.balance === undefined;
                return `
                  <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-user" style="color:var(--text-muted);font-size:10px;"></i>
                    <strong>${escapeHtml(cl.username || '—')}</strong>
                    ${isRedacted
                      ? '<span class="text-muted" style="font-size:11px;"><i class="fas fa-lock" style="margin-right:3px;"></i>Private · Agent PKR</span>'
                      : `<span class="text-muted">$${zyFmtMoney(Number(cl.balance || 0), 2)}</span>`}
                    ${statusBadge(cl.status)}
                  </div>
                `;
              }).join('') : '<span class="text-muted fs-12">No clients created by this agent yet</span>'}
            </div>
          </div>
        `).join('') : `<div class="empty-state"><i class="fas fa-sitemap"></i><p>No direct agents created yet</p></div>`}
      </div>
    `;
  } catch (err) {
    console.error('Hierarchy error:', err);
    toast('Failed to load hierarchy', 'error');
  }
}

// ─── USERS ────────────────────────────────────────────────────────
async function renderUsers(page = 1, search = '', role = '') {
  try {
    const data = await apiFetch(`/api/users?page=${page}&limit=25&search=${encodeURIComponent(search)}&role=${role}`);
    if (!data) return;

    const rawList = (data.data || []);
    // Owner is fixed root controller and never displayed as an ordinary manageable user in the table
    const filteredUsers = rawList.filter(u => u.role !== 'Owner' && u.username !== 'Kamran_Bhatti');

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Users &amp; Accounts Directory</div><div class="page-subtitle">${data.total || filteredUsers.length} system accounts · Platform Controller: <strong>Kamran_Bhatti</strong></div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openAddUserModal()"><i class="fas fa-user-plus"></i> Add Account</button>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        ${renderManagementTabs('all')}
      </div>
      <div class="card">
        <div class="filters-bar">
          <input id="usr-search" placeholder="Username or email…" value="${search}"
            onkeyup="if(event.key==='Enter')renderUsers(1,this.value,document.getElementById('usr-role').value)">
          <select id="usr-role" onchange="renderUsers(1,document.getElementById('usr-search').value,this.value)">
            <option value="" ${role === '' ? 'selected' : ''}>All Roles</option>
            <option value="Agent" ${role === 'Agent' ? 'selected' : ''}>Agent</option>
            <option value="Client" ${role === 'Client' ? 'selected' : ''}>Client</option>
          </select>
          <button class="btn btn-outline btn-sm" onclick="renderUsers(1,document.getElementById('usr-search').value,document.getElementById('usr-role').value)">
            <i class="fas fa-search"></i>
          </button>
          <button class="btn btn-outline btn-sm" onclick="resetUserFilters()"><i class="fas fa-undo"></i> Reset</button>
        </div>
        ${buildTable(
          ['#', 'Username', 'Role', 'Email', 'Balance', 'Numbers', 'Status', 'Created', 'Actions'],
          filteredUsers.map((u, idx) => {
            const isPrivateClient = u.privacy_redacted === true || String(u.role || '').toLowerCase() === 'client';
            return [
              `<strong class="monospace">#${(page - 1) * 25 + idx + 1}</strong>`,
              `<strong>${u.username || '—'}</strong>`,
              roleBadge(u.role),
              isPrivateClient ? '<span class="text-muted"><i class="fas fa-lock" style="margin-right:4px;"></i>Private</span>' : (u.email || '—'),
              isPrivateClient ? '<span class="badge" style="background:#f1f5f9;color:#475569;"><i class="fas fa-lock" style="margin-right:4px;"></i>Agent PKR</span>' : `<span class="text-success fw-600">$${u.balance || 0}</span>`,
              u.numbers || 0,
              statusBadge(u.status),
              fmtShort(u.created),
              `<div style="display:inline-flex;gap:4px;align-items:center;">
                <button type="button" class="apx-btn apx-btn-icon apx-btn-mini" style="color:#0284c7;border-color:#bae6fd;background:#f0f9ff;" onclick="openViewUserModal(${u.id},'${(u.role || 'user').toLowerCase()}')" title="View Account Details" data-apx-tooltip="View Details"><i class="fas fa-eye"></i></button>
                <button type="button" class="apx-btn apx-btn-icon apx-btn-mini" style="color:#d97706;border-color:#fde68a;background:#fffbeb;" onclick="openEditUserModal(${u.id})" title="Edit Account" data-apx-tooltip="Edit Account"><i class="fas fa-pen"></i></button>
                <button type="button" class="apx-btn apx-btn-icon apx-btn-mini" style="color:#6366f1;border-color:#c7d2fe;background:#eef2ff;" onclick="openResetPasswordModal(${u.id},'${u.username}','users')" title="Reset Password" data-apx-tooltip="Reset Password"><i class="fas fa-key"></i></button>
                <button type="button" class="apx-btn apx-btn-icon apx-btn-mini ${u.status === 'active' ? 'apx-btn-warning' : 'apx-btn-success'}" onclick="toggleUser(${u.id},'${u.status}')" title="${u.status === 'active' ? 'Suspend' : 'Activate'}" data-apx-tooltip="${u.status === 'active' ? 'Suspend' : 'Activate'}">
                  <i class="fas fa-${u.status === 'active' ? 'pause' : 'play'}"></i>
                </button>
              </div>`
            ];
          }),
          { id: 'tbl-users', title: 'Accounts Directory', toolbar: true }
        )}
        ${pagination(page, data.total || 0, 25, p => renderUsers(p, search, role))}
      </div>
    `;
  } catch (err) {
    console.error('Users error:', err);
    toast('Failed to load users', 'error');
  }
}

function resetUserFilters() {
  const searchInput = document.getElementById('usr-search');
  const roleSelect = document.getElementById('usr-role');
  if (searchInput) searchInput.value = '';
  if (roleSelect) roleSelect.value = '';
  renderUsers(1);
  toast('Filters reset', 'info');
}

function openAddUserModal() {
  openModal('Add New Account', `
    <form id="add-user-form" onsubmit="submitAddUser(event)" autocomplete="off">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Username *</label>
          <input id="au-user" placeholder="username" autocomplete="off" required>
          <div id="au-user-feedback" style="margin-top:4px;"></div>
        </div>
        <div class="form-group"><label class="form-label">Email</label><input type="email" id="au-email" placeholder="email@example.com" autocomplete="off"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Role</label>
          <select id="au-role">
            <option value="Agent">Agent</option>
          </select>
          <small class="text-muted">Owner creates Agents only. Clients are created by Agents.</small>
        </div>
        <div class="form-group"><label class="form-label">Initial Balance</label><input type="number" id="au-balance" placeholder="0.00" step="0.01"></div>
      </div>
      <div class="form-group"><label class="form-label">Password *</label><input type="password" id="au-pass" placeholder="••••••••" autocomplete="new-password" required></div>

      <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
        <div style="font-weight:700;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Default Permissions (Lamix Style)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
            <input type="checkbox" id="au-can-ratecard" checked style="width:16px;height:16px;accent-color:#2563eb;">
            <span>View Rate Card</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
            <input type="checkbox" id="au-can-bulk" checked style="width:16px;height:16px;accent-color:#2563eb;">
            <span>Bulk Allocation</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
            <input type="checkbox" id="au-can-cdr" checked style="width:16px;height:16px;accent-color:#2563eb;">
            <span>View CDR Reports</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
            <input type="checkbox" id="au-can-payout" checked style="width:16px;height:16px;accent-color:#2563eb;">
            <span>Request Payout</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
            <input type="checkbox" id="au-can-export" checked style="width:16px;height:16px;accent-color:#2563eb;">
            <span>Export CSV/TXT</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
            <input type="checkbox" id="au-allow-rest" checked style="width:16px;height:16px;accent-color:#2563eb;">
            <span>REST API &amp; Tokens</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
            <input type="checkbox" id="au-can-downline" checked style="width:16px;height:16px;accent-color:#2563eb;">
            <span>Manage Downline</span>
          </label>
        </div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="au-submit-btn"><i class="fas fa-user-plus"></i> Create Account</button>
      </div>
    </form>
  `);
  setTimeout(() => window.setupUsernameAvailabilityCheck('au-user', 'au-user-feedback', 'au-submit-btn', 'users'), 50);
}

async function submitAddUser(event) {
  event.preventDefault();

  try {
    const username = document.getElementById('au-user').value.trim();
    const password = document.getElementById('au-pass').value;

    if (!username || !password) {
      toast('Username and password are required', 'error');
      return;
    }

    const role = document.getElementById('au-role').value || 'User';
    if (role.toLowerCase() === 'owner' || role.toLowerCase() === 'admin') {
      toast('New Owner cannot be created. Kamran_Bhatti is the fixed Owner.', 'error');
      return;
    }

    const btn = document.getElementById('au-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Creating...';
    }

    const payload = {
      username,
      role: role,
      email: document.getElementById('au-email').value,
      password,
      balance: parseFloat(document.getElementById('au-balance').value) || 0,
      can_view_rate_card: document.getElementById('au-can-ratecard')?.checked !== false,
      can_bulk_allocate: document.getElementById('au-can-bulk')?.checked !== false,
      can_view_cdr: document.getElementById('au-can-cdr')?.checked !== false,
      can_request_payout: document.getElementById('au-can-payout')?.checked !== false,
      can_export_data: document.getElementById('au-can-export')?.checked !== false,
      allow_rest_api: document.getElementById('au-allow-rest')?.checked !== false,
      can_manage_downline: document.getElementById('au-can-downline')?.checked !== false,
      status: 'active'
    };

    const result = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(payload) });

    if (result && result.id) {
      closeModal();
      zyFlash('User Added.');
      await renderUsers();
      zyShowFlash();
    } else {
      toast(result?.error || 'This username already exists', 'error');
    }
  } catch (err) {
    console.error('Add user error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('au-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-user-plus"></i> Create User';
    }
  }
}

async function openEditUserModal(id) {
  try {
    const user = await apiFetch(`/api/users/${id}`);
    if (!user) return;

    if (user.username === 'Kamran_Bhatti' || user.role === 'Owner' || user.role === 'Admin') {
      toast('Kamran_Bhatti is the fixed Owner account and cannot be modified here.', 'warning');
      return;
    }

    openModal(`Edit User — ${user.username}`, `
      <form id="edit-user-form" onsubmit="submitEditUser(event, ${id})" autocomplete="off">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input value="${user.username}" id="edit-username" autocomplete="off" required>
            <div id="edit-user-feedback" style="margin-top:4px;"></div>
          </div>
          <div class="form-group"><label class="form-label">Email</label><input value="${user.email || ''}" id="edit-email" autocomplete="off"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Role</label>
            <select id="edit-role">
              ${['Agent', ...(user.role === 'Client' ? ['Client'] : [])].map(r =>
                `<option ${r === user.role ? 'selected' : ''}>${r}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Commission %</label><input type="number" value="${user.commission_percent ?? user.commission_rate ?? 0}" id="edit-commission" min="0" max="100" step="0.1"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Balance ($)</label><input type="number" value="${user.balance || 0}" id="edit-balance" step="0.01"></div>
          <div class="form-group"><label class="form-label">New Password (optional)</label><input type="password" id="edit-pass" autocomplete="new-password" placeholder="Leave blank to keep current"></div>
        </div>
        <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
          <div style="font-weight:700;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Permissions &amp; Access (Lamix Style)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
              <input type="checkbox" id="edit-can-ratecard" ${user.can_view_rate_card !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2563eb;">
              <span>View Rate Card</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
              <input type="checkbox" id="edit-can-bulk" ${user.can_bulk_allocate !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2563eb;">
              <span>Bulk Allocation</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
              <input type="checkbox" id="edit-can-cdr" ${user.can_view_cdr !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2563eb;">
              <span>View CDR Reports</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
              <input type="checkbox" id="edit-can-payout" ${user.can_request_payout !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2563eb;">
              <span>Request Payout</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
              <input type="checkbox" id="edit-can-export" ${user.can_export_data !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2563eb;">
              <span>Export CSV/TXT</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
              <input type="checkbox" id="edit-allow-rest" ${user.allow_rest_api !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2563eb;">
              <span>REST API &amp; Tokens</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
              <input type="checkbox" id="edit-can-downline" ${user.can_manage_downline !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2563eb;">
              <span>Manage Downline</span>
            </label>
          </div>
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;">
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
              <input type="checkbox" id="edit-active" ${user.status === 'active' ? 'checked' : ''} style="width:16px;height:16px;accent-color:#10b981;">
              <span style="font-weight:600;">Active Account Status</span>
            </label>
          </div>
        </div>
        <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
          <div style="font-weight:700;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Number Acquisition Override (Optional)</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Acquisition Mode</label>
              <select id="edit-alloc-mode">
                <option value="" ${!user.alloc_mode ? 'selected' : ''}>Inherit Default</option>
                <option value="request" ${user.alloc_mode === 'request' ? 'selected' : ''}>Request Only</option>
                <option value="self_allocate" ${user.alloc_mode === 'self_allocate' ? 'selected' : ''}>Self-Allocate Only</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Daily Limit (blank = inherit, 0 = unlimited)</label>
              <input type="number" id="edit-alloc-daily" min="0" value="${user.alloc_daily_limit ?? ''}" placeholder="Inherit">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Total Holding Limit (blank = inherit, 0 = unlimited)</label>
            <input type="number" id="edit-alloc-total" min="0" value="${user.alloc_total_limit ?? ''}" placeholder="Inherit">
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="edit-submit-btn"><i class="fas fa-save"></i> Save Changes</button>
        </div>
      </form>
    `);
    setTimeout(() => window.setupUsernameAvailabilityCheck('edit-username', 'edit-user-feedback', 'edit-submit-btn', 'users', id), 50);
  } catch (err) {
    console.error('Edit user error:', err);
    toast('Failed to load user', 'error');
  }
}

async function submitEditUser(event, id) {
  event.preventDefault();

  try {
    const username = document.getElementById('edit-username').value.trim();
    if (!username) {
      toast('Username is required', 'error');
      return;
    }

    const btn = document.getElementById('edit-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Saving...';
    }

    const commVal = parseFloat(document.getElementById('edit-commission')?.value);
    const allocMode = document.getElementById('edit-alloc-mode')?.value || '';
    const allocDailyRaw = document.getElementById('edit-alloc-daily')?.value;
    const allocTotalRaw = document.getElementById('edit-alloc-total')?.value;
    const payload = {
      username,
      email: document.getElementById('edit-email').value,
      role: document.getElementById('edit-role').value,
      balance: parseFloat(document.getElementById('edit-balance').value) || 0,
      commission_percent: isNaN(commVal) ? 0 : commVal,
      commission_rate: isNaN(commVal) ? 0 : commVal,
      can_view_rate_card: document.getElementById('edit-can-ratecard')?.checked !== false,
      can_bulk_allocate: document.getElementById('edit-can-bulk')?.checked !== false,
      can_view_cdr: document.getElementById('edit-can-cdr')?.checked !== false,
      can_request_payout: document.getElementById('edit-can-payout')?.checked !== false,
      can_export_data: document.getElementById('edit-can-export')?.checked !== false,
      allow_rest_api: document.getElementById('edit-allow-rest')?.checked !== false,
      can_manage_downline: document.getElementById('edit-can-downline')?.checked !== false,
      status: document.getElementById('edit-active')?.checked ? 'active' : 'suspended',
      alloc_mode: allocMode || null,
      alloc_daily_limit: allocDailyRaw !== '' && allocDailyRaw !== undefined ? Math.max(0, parseInt(allocDailyRaw, 10) || 0) : null,
      alloc_total_limit: allocTotalRaw !== '' && allocTotalRaw !== undefined ? Math.max(0, parseInt(allocTotalRaw, 10) || 0) : null
    };

    const password = document.getElementById('edit-pass').value;
    if (password) {
      if (password.length < 6) {
        toast('Password must be at least 6 characters', 'error');
        return;
      }
      payload.password = password;
    }

    const result = await apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

    if (result) {
      closeModal();
      toast('User updated successfully', 'success');
      if (typeof renderUsers === 'function') renderUsers();
    } else {
      toast('Failed to update user', 'error');
    }
  } catch (err) {
    console.error('Edit user error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('edit-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
    }
  }
}

async function toggleUser(id, status) {
  try {
    const user = await apiFetch(`/api/users/${id}`);
    if (user && (user.username === 'Kamran_Bhatti' || user.role === 'Owner' || user.role === 'Admin')) {
      toast('Owner account cannot be suspended.', 'error');
      return;
    }
    const newStatus = status === 'active' ? 'suspended' : 'active';
    const res = await apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    if (res && res.error) {
      toast(res.error, 'error');
    } else {
      toast(`User ${newStatus}`, 'info');
    }
    renderUsers();
  } catch (err) {
    console.error('Toggle user error:', err);
    toast('Failed to toggle user', 'error');
  }
}

// ─── MODULAR VIEW DETAILS & RESET PASSWORD MODALS (Lamix Style) ───
async function openViewUserModal(id, role = 'user') {
  try {
    const table = role === 'agent' ? 'agents' : role === 'client' ? 'clients' : 'users';
    const u = await apiFetch(`/api/${table}/${id}`);
    if (!u) { toast('Record not found', 'error'); return; }

    const isAgent = role === 'agent';
    const isClient = role === 'client';
    const isPrivacyRedacted = isClient || u.privacy_redacted === true;
    const permissions = [
      { name: 'View Rate Card', val: u.can_view_rate_card !== false },
      { name: 'Bulk Allocation', val: u.can_bulk_allocate !== false },
      { name: 'View CDR Reports', val: u.can_view_cdr !== false },
      { name: 'Request Payout', val: u.can_request_payout !== false },
      { name: 'Export Data (CSV/TXT)', val: u.can_export_data !== false },
      { name: 'REST API & Tokens', val: u.allow_rest_api !== false },
      { name: 'Manage Downline', val: u.can_manage_downline !== false }
    ];

    zyModal(`Account Details — ${escapeHtml(u.username || 'User')}`, `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;align-items:center;gap:12px;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;">
          <div style="width:48px;height:48px;border-radius:50%;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;">
            ${(u.username || 'U')[0].toUpperCase()}
          </div>
          <div style="flex:1;">
            <div style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(u.username || '—')}</div>
            <div style="font-size:12px;color:#64748b;">
              ${isPrivacyRedacted
                ? `Client Directory · Agent: ${escapeHtml(u.agent_username || (u.agent_id ? 'Agent #' + u.agent_id : '—'))}`
                : escapeHtml(u.email || u.role || 'System Account')} · Created ${fmtShort(u.created || u.created_at)}
            </div>
          </div>
          <div>${statusBadge(u.status)}</div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;">
          <div style="background:#f1f5f9;padding:10px;border-radius:6px;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Role</div>
            <div style="font-size:14px;font-weight:700;color:#1e293b;margin-top:2px;">${roleBadge(u.role || (isClient ? 'Client' : 'Agent'))}</div>
          </div>
          ${isPrivacyRedacted ? `
            <div style="background:#f1f5f9;padding:10px;border-radius:6px;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Assigned Agent</div>
              <div style="font-size:14px;font-weight:700;color:#2563eb;margin-top:2px;">${escapeHtml(u.agent_username || (u.agent_id ? 'Agent #' + u.agent_id : '—'))}</div>
            </div>
            <div style="background:#f1f5f9;padding:10px;border-radius:6px;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Financial Ledger</div>
              <div style="font-size:13px;font-weight:700;color:#475569;margin-top:2px;"><i class="fas fa-lock" style="margin-right:4px;"></i>Private (Agent PKR)</div>
            </div>
          ` : `
            <div style="background:#f1f5f9;padding:10px;border-radius:6px;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Balance</div>
              <div style="font-size:14px;font-weight:700;color:#059669;margin-top:2px;">$${zyFmtMoney(Number(u.balance || 0), 2)}</div>
            </div>
            <div style="background:#f1f5f9;padding:10px;border-radius:6px;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Commission</div>
              <div style="font-size:14px;font-weight:700;color:#2563eb;margin-top:2px;">${u.commission_percent ?? u.commission_rate ?? 0}%</div>
            </div>
          `}
        </div>

        ${isPrivacyRedacted ? `
          <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:12px;color:#475569;">
            <i class="fas fa-shield-halved" style="color:#0284c7;margin-right:6px;"></i>
            <strong>Privacy Boundary:</strong> Client PKR balances, bank/wallet accounts, phone/email contact details, and SMS earnings are managed exclusively by their assigned Agent.
          </div>
        ` : ((u.phone || u.skype_id || u.full_name) ? `
          <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:12.5px;">
            ${u.full_name ? `<div style="margin-bottom:4px;"><strong>Full Name:</strong> ${escapeHtml(u.full_name)}</div>` : ''}
            ${u.phone ? `<div style="margin-bottom:4px;"><strong>Phone / Contact:</strong> ${escapeHtml(u.phone)}</div>` : ''}
            ${u.skype_id ? `<div><strong>Skype:</strong> ${escapeHtml(u.skype_id)}</div>` : ''}
          </div>
        ` : '')}

        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
          <div style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:8px;">Active Permissions &amp; Capabilities</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            ${permissions.map(p => `
              <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${p.val ? '#0f172a' : '#94a3b8'};">
                <i class="fas fa-${p.val ? 'circle-check' : 'circle-xmark'}" style="color:${p.val ? '#10b981' : '#cbd5e1'};font-size:13px;"></i>
                <span>${p.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `, `<button type="button" class="btn btn-outline" onclick="closeModal()">Close</button>`);
  } catch (err) {
    toast('Error loading details: ' + err.message, 'error');
  }
}

function openResetPasswordModal(id, username, table = 'users') {
  openModal(`Reset Password — ${escapeHtml(username)}`, `
    <form id="reset-pwd-form" onsubmit="submitResetPassword(event, ${id}, '${table}')" autocomplete="off">
      <div style="font-size:13px;color:#64748b;margin-bottom:14px;">
        Set a new secure password for <strong>${escapeHtml(username)}</strong>.
      </div>
      <div class="form-group">
        <label class="form-label">New Password *</label>
        <input type="password" id="rp-pwd" placeholder="Minimum 6 characters" minlength="6" required autocomplete="new-password">
      </div>
      <div class="form-group">
        <label class="form-label">Confirm Password *</label>
        <input type="password" id="rp-pwd-confirm" placeholder="Re-enter password" minlength="6" required autocomplete="new-password">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="rp-submit-btn"><i class="fas fa-key"></i> Update Password</button>
      </div>
    </form>
  `);
}

async function submitResetPassword(event, id, table = 'users') {
  event.preventDefault();
  const pwd = document.getElementById('rp-pwd')?.value || '';
  const pwd2 = document.getElementById('rp-pwd-confirm')?.value || '';
  if (!pwd || pwd.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
  if (pwd !== pwd2) { toast('Passwords do not match', 'error'); return; }

  const btn = document.getElementById('rp-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Updating...'; }

  try {
    const res = await apiFetch(`/api/${table}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ password: pwd })
    });
    if (res && (res.id || res.success || !res.error)) {
      closeModal();
      toast('✅ Password updated successfully!', 'success');
    } else {
      toast(res?.error || 'Failed to update password', 'error');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-key"></i> Update Password'; }
  }
}

// ─── ACCOUNT BALANCES ─────────────────────────────────────────────
async function renderAccountBalances() {
  try {
    const data = await apiFetch('/api/users');

    const acctRows = (data?.data || []).filter(u => !(u.privacy_redacted === true || String(u.role || '').toLowerCase() === 'client'));
    const totalBalance = acctRows.reduce((a, u) => a + (Number(u.balance) || 0), 0);
    const downlineFunds = acctRows.filter(u => u.role === 'Agent').reduce((a, u) => a + (Number(u.balance) || 0), 0);
    const avgBalance = acctRows.length > 0 ? (totalBalance / acctRows.length) : 0;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Account Balances</div><div class="page-subtitle">Owner &amp; Direct Agent USD Balances (Client PKR wallets are managed privately by their Agent)</div></div>
      </div>
      ${renderOwnerHubTabs('finance', 'account-balances')}
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
        ${statCard('Total Balance', 'fas fa-dollar-sign', '$' + zyFmtMoney(totalBalance, 2), 'green', 'Owner & Agent accounts')}
        ${statCard('Agent Funds', 'fas fa-users', '$' + zyFmtMoney(downlineFunds, 2), 'blue', 'Direct Agents (USD)')}
        ${statCard('Avg Balance', 'fas fa-chart-bar', '$' + zyFmtMoney(avgBalance, 2), 'yellow', 'Per USD account')}
      </div>
      <div class="card">
        ${buildTable(
          ['#', 'Username', 'Role', 'Balance', 'Numbers', 'Status', 'Action'],
          acctRows.map(u => [
            u.id || '—',
            u.username || '—',
            roleBadge(u.role),
            `<strong class="text-${(u.balance || 0) > 500 ? 'success' : 'warning'}">$${zyFmtMoney(Number(u.balance || 0), 2)}</strong>`,
            u.numbers || 0,
            statusBadge(u.status),
            (u.role === 'Owner' || u.username === 'Kamran_Bhatti')
              ? `<span class="badge badge-purple" style="font-size:11px;">Company Reserve</span>`
              : `<button class="btn btn-outline btn-sm" onclick="openAdjustBalanceModal(${u.id},'${u.username}',${u.balance || 0})">
                  <i class="fas fa-pen"></i> Adjust
                </button>`
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('Account balances error:', err);
    toast('Failed to load account balances', 'error');
  }
}

function openAdjustBalanceModal(id, username, current) {
  if (username === 'Kamran_Bhatti') {
    toast('Kamran_Bhatti is the fixed Owner account; company revenue is tracked via revenue ledger.', 'warning');
    return;
  }
  openModal(`Adjust Balance — ${username}`, `
    <p class="text-muted" style="margin-bottom:16px;">Current balance: <strong class="text-success">$${current || 0}</strong></p>
    <form id="adjust-balance-form" onsubmit="submitAdjustBalance(event, ${id}, ${current || 0})">
      <div class="form-group"><label class="form-label">Operation</label>
        <select id="adj-op">
          <option value="set">Set to</option>
          <option value="add">Add</option>
          <option value="subtract">Subtract</option>
        </select></div>
      <div class="form-group"><label class="form-label">Amount</label>
        <input type="number" id="adj-amount" placeholder="0.00" step="0.01" required></div>
      <div class="form-group"><label class="form-label">Reason</label>
        <input id="adj-reason" placeholder="Reason for adjustment…"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="adj-submit-btn"><i class="fas fa-check"></i> Apply</button>
      </div>
    </form>
  `);
}

async function submitAdjustBalance(event, id, current) {
  event.preventDefault();

  try {
    const op = document.getElementById('adj-op').value;
    const amount = parseFloat(document.getElementById('adj-amount').value) || 0;
    const reason = document.getElementById('adj-reason').value || '';

    if (amount <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }

    let newBalance = current;
    if (op === 'add') newBalance = current + amount;
    else if (op === 'subtract') newBalance = Math.max(0, current - amount);
    else if (op === 'set') newBalance = amount;

    const btn = document.getElementById('adj-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Applying...';
    }

    const result = await apiFetch(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ balance: Math.round(newBalance * 100) / 100, balance_reason: reason })
    });

    if (result) {
      closeModal();
      toast(`Balance updated from $${zyFmtMoney(current, 2)} to $${zyFmtMoney(newBalance, 2)}`, 'success');
      renderAccountBalances();
    } else {
      toast('Failed to update balance', 'error');
    }
  } catch (err) {
    console.error('Adjust balance error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('adj-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> Apply';
    }
  }
}

// ─── AUDIT LOGS ───────────────────────────────────────────────────
async function renderAuditLogs(page = 1) {
  try {
    const data = await apiFetch(`/api/audit-logs?page=${page}&limit=20`);
    if (!data) return;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Audit Logs</div><div class="page-subtitle">System activity trail</div></div>
        <div class="page-actions">
          <button class="btn btn-outline btn-sm text-danger" onclick="clearAuditLogs()"><i class="fas fa-trash-can"></i> Clear All Logs</button>
        </div>
      </div>
      ${renderSecurityTabs('audit-logs')}
      <div class="card">
        ${buildTable(
          ['#', 'User', 'Action', 'IP Address', 'Details', 'Timestamp'],
          (data.data || []).map(l => [
            l.id || '—',
            `<strong>${l.user || '—'}</strong>`,
            badge(l.action || '—', 'blue'),
            `<span class="monospace">${l.ip || '—'}</span>`,
            l.details || '—',
            fmtShort(l.timestamp)
          ]),
          { id: 'tbl-audit', title: 'Audit Trail', toolbar: true }
        )}
        ${pagination(page, data.total || 0, 20, renderAuditLogs)}
      </div>
    `;
  } catch (err) {
    console.error('Audit logs error:', err);
    toast('Failed to load audit logs', 'error');
  }
}

async function clearAuditLogs() {
  if (!confirm('⚠️ Are you sure you want to clear ALL audit logs? This action cannot be undone.')) return;
  try {
    const res = await apiFetch('/api/audit-logs/clear', { method: 'POST' });
    if (res && res.success) {
      toast('Audit logs cleared successfully', 'success');
      renderAuditLogs(1);
    } else {
      toast(res?.error || 'Failed to clear audit logs', 'error');
    }
  } catch (err) {
    toast(err.message || 'Error clearing logs', 'error');
  }
}

// ─── LOGIN ACTIVITY (Admin-only) ────────────────────────────────────
let laPage = 1, laPerPage = 25;
async function renderLoginActivity() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Login Activity</div><div class="page-subtitle">Every login attempt — account, role, IP address, and time</div></div>
      <div class="page-actions">
        <button class="btn btn-outline btn-sm text-danger" onclick="clearLoginActivity()"><i class="fas fa-trash-can"></i> Clear Login Logs</button>
      </div>
    </div>
    ${renderSecurityTabs('login-activity')}
    <div class="card">
      <div class="filters-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <input id="la-search" placeholder="Search username or IP…" onkeyup="if(event.key==='Enter'){laPage=1;loadLoginActivity();}">
        <select id="la-result" onchange="laPage=1;loadLoginActivity()">
          <option value="">All Results</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="blocked">Blocked IP</option>
          <option value="suspended">Suspended Account</option>
        </select>
        <button class="btn btn-outline btn-sm" onclick="laPage=1;loadLoginActivity()"><i class="fas fa-search"></i> Search</button>
      </div>
      <div id="la-wrap" style="margin-top:14px;"></div>
    </div>
  `;
  loadLoginActivity();
}

async function loadLoginActivity() {
  const wrap = document.getElementById('la-wrap');
  const search = document.getElementById('la-search')?.value || '';
  const result = document.getElementById('la-result')?.value || '';
  const params = new URLSearchParams();
  params.append('page', laPage);
  params.append('limit', laPerPage);
  if (search) params.append('search', search);
  if (result) params.append('result', result);

  const data = await apiFetch(`/api/login-activity?${params.toString()}`);
  const rows = data?.data || [];
  const total = data?.total || 0;

  const resultBadge = (r) => {
    if (r === 'success') return badge('Success', 'green');
    if (r === 'failed') return badge('Failed', 'red');
    if (r === 'blocked') return badge('Blocked IP', 'red');
    if (r === 'suspended') return badge('Suspended', 'yellow');
    return badge(r || '—', 'blue');
  };

  wrap.innerHTML = buildTable(
    ['Account', 'Role', 'IP Address', 'Result', 'Time', 'Action'],
    rows.map(a => [
      `<strong>${a.username || '—'}</strong>`,
      badge(a.role || '—', 'purple'),
      `<span class="monospace">${a.ip || '—'}</span>`,
      resultBadge(a.result),
      fmtShort(a.timestamp),
      `<button class="btn btn-danger btn-sm" onclick="quickBlockIp('${a.ip}')" title="Block this IP"><i class="fas fa-ban"></i> Block</button>`
    ])
  ) + `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
      <span style="font-size:13px;color:var(--text-muted);">Showing ${total === 0 ? 0 : Math.min((laPage-1)*laPerPage+1,total)}–${Math.min(laPage*laPerPage,total)} of ${total}</span>
      ${pagination(laPage, total, laPerPage, (p) => { laPage = p; loadLoginActivity(); })}
    </div>
  `;
}

async function quickBlockIp(ip) {
  if (!ip || ip === 'unknown') { toast('No IP address to block', 'error'); return; }
  if (!confirm(`Block IP ${ip}? Anyone logging in from this address will be denied.`)) return;
  const result = await apiFetch('/api/firewall/block-ip', {
    method: 'POST',
    body: JSON.stringify({ ip, reason: 'Blocked from Login Activity' })
  });
  if (!result) return;
  toast(`✅ ${ip} blocked`, 'success');
  loadLoginActivity();
}

async function clearLoginActivity() {
  if (!confirm('⚠️ Are you sure you want to clear ALL login activity logs? This action cannot be undone.')) return;
  try {
    const res = await apiFetch('/api/login-activity/clear', { method: 'POST' });
    if (res && res.success) {
      toast('Login activity cleared successfully', 'success');
      loadLoginActivity();
    } else {
      toast(res?.error || 'Failed to clear login activity', 'error');
    }
  } catch (err) {
    toast(err.message || 'Error clearing login activity', 'error');
  }
}

// ─── BUSINESS REPORTS ──────────────────────────────────────────────
let _lastReportData = null;
async function renderBusinessReports() {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0];
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Business Reports</div><div class="page-subtitle">Download a summary for any date range</div></div>
    </div>
    ${renderOwnerHubTabs('analytics', 'business-reports')}
    <div class="card" style="margin-bottom:16px;">
      <div class="filters-bar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <label class="fs-12 text-muted">From</label>
        <input type="date" id="br-from" value="${monthAgo}">
        <label class="fs-12 text-muted">To</label>
        <input type="date" id="br-to" value="${today}">
        <button class="btn btn-primary btn-sm" onclick="generateBusinessReport()"><i class="fas fa-chart-column"></i> Generate Report</button>
      </div>
    </div>
    <div id="br-output"></div>
  `;
  generateBusinessReport();
}

async function generateBusinessReport() {
  const dateFrom = document.getElementById('br-from')?.value || '';
  const dateTo = document.getElementById('br-to')?.value || '';
  const output = document.getElementById('br-output');
  output.innerHTML = `<div class="flex-center" style="padding:30px;"><div class="spinner"></div></div>`;

  const params = new URLSearchParams();
  if (dateFrom) params.append('date_from', dateFrom);
  if (dateTo) params.append('date_to', dateTo);
  const data = await apiFetch(`/api/reports/business?${params.toString()}`);
  if (!data) { output.innerHTML = ''; return; }
  // guard against a partial/empty response so the page still renders
  data.total_revenue = Number(data.total_revenue) || 0;
  data.total_sms = data.total_sms ?? 0;
  data.delivered = data.delivered ?? 0;
  data.failed = data.failed ?? 0;
  data.success_rate = data.success_rate ?? 0;
  data.top_agents = (data.top_agents || []).map(a => ({ ...a, revenue: Number(a.revenue) || 0 }));
  data.top_numbers = data.top_numbers || [];
  data.daily_breakdown = data.daily_breakdown || [];
  _lastReportData = data;

  output.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px;">
      ${statCard('Total SMS', 'fas fa-comment-sms', data.total_sms, 'blue', `${data.date_from} → ${data.date_to}`)}
      ${statCard('Delivered', 'fas fa-circle-check', data.delivered, 'green', data.success_rate + '% success rate')}
      ${statCard('Failed', 'fas fa-circle-xmark', data.failed, 'red', '')}
      ${statCard('Revenue', 'fas fa-dollar-sign', '$' + zyFmtMoney(data.total_revenue, 2), 'yellow', '')}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header"><div class="card-title">Top Agents by Revenue</div></div>
        ${buildTable(['Agent', 'SMS Count', 'Revenue'],
          data.top_agents.length ? data.top_agents.map(a => [a.agent, a.sms_count, `$${zyFmtMoney(a.revenue, 2)}`]) : [])}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Top Numbers by SMS Count</div></div>
        ${buildTable(['Number', 'SMS Count'],
          data.top_numbers.length ? data.top_numbers.map(n => [`<span class="monospace">${n.number}</span>`, n.sms_count]) : [])}
      </div>
    </div>
    <div class="form-actions" style="margin-top:16px;">
      <button class="btn btn-outline" onclick="downloadReportCsv()"><i class="fas fa-file-csv"></i> Download CSV</button>
      <button class="btn btn-primary" onclick="downloadReportPdf()"><i class="fas fa-file-pdf"></i> Download PDF</button>
    </div>
  `;
}

function downloadReportCsv() {
  const d = _lastReportData;
  if (!d) return;
  let csv = `HUMAX SMS Business Report,${d.date_from} to ${d.date_to}\n\n`;
  csv += `Total SMS,${d.total_sms}\nDelivered,${d.delivered}\nFailed,${d.failed}\nSuccess Rate,${d.success_rate}%\nTotal Revenue,$${zyFmtMoney(d.total_revenue, 2)}\n\n`;
  csv += `Top Agents\nAgent,SMS Count,Revenue\n`;
  d.top_agents.forEach(a => csv += `${a.agent},${a.sms_count},$${zyFmtMoney(a.revenue, 2)}\n`);
  csv += `\nTop Numbers\nNumber,SMS Count\n`;
  d.top_numbers.forEach(n => csv += `${n.number},${n.sms_count}\n`);

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const sitePrefix = ((window.__BRAND_SETTINGS__?.site_name) || 'humax_sms').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'humax_sms';
  a.href = url; a.download = `${sitePrefix}_report_${d.date_from}_to_${d.date_to}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('CSV downloaded', 'success');
}

function downloadReportPdf() {
  const d = _lastReportData;
  if (!d) return;
  const html = `
    <html><head><title>Business Report</title>
    <style>
      body{font-family:'Segoe UI',Arial,sans-serif;padding:40px;color:#222;max-width:800px;margin:0 auto;}
      h1{font-size:24px;border-bottom:3px solid #1e293b;padding-bottom:14px;}
      .stats{display:flex;gap:16px;margin:20px 0;flex-wrap:wrap;}
      .stat-box{flex:1;min-width:140px;background:#f5f6fa;border-radius:8px;padding:14px;}
      .stat-box .label{font-size:11px;color:#888;text-transform:uppercase;}
      .stat-box .value{font-size:20px;font-weight:800;margin-top:4px;}
      table{width:100%;border-collapse:collapse;margin:16px 0 30px;}
      th{background:#f5f6fa;text-align:left;padding:8px 10px;font-size:12px;text-transform:uppercase;color:#666;}
      td{padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;}
      .footer{margin-top:30px;font-size:11px;color:#999;text-align:center;}
    </style></head>
    <body>
      <h1>HUMAX SMS — Business Report</h1>
      <p style="color:#666;">${escapeHtml(d.date_from)} → ${escapeHtml(d.date_to)}</p>
      <div class="stats">
        <div class="stat-box"><div class="label">Total SMS</div><div class="value">${Number(d.total_sms) || 0}</div></div>
        <div class="stat-box"><div class="label">Delivered</div><div class="value">${Number(d.delivered) || 0}</div></div>
        <div class="stat-box"><div class="label">Success Rate</div><div class="value">${Number(d.success_rate) || 0}%</div></div>
        <div class="stat-box"><div class="label">Revenue</div><div class="value">$${zyFmtMoney(Number(d.total_revenue || 0), 2)}</div></div>
      </div>
      <h3>Top Agents by Revenue</h3>
      <table><tr><th>Agent</th><th>SMS Count</th><th>Revenue</th></tr>
        ${d.top_agents.map(a => `<tr><td>${escapeHtml(a.agent)}</td><td>${Number(a.sms_count) || 0}</td><td>$${zyFmtMoney(Number(a.revenue || 0), 2)}</td></tr>`).join('') || '<tr><td colspan="3">No data</td></tr>'}
      </table>
      <h3>Top Numbers by SMS Count</h3>
      <table><tr><th>Number</th><th>SMS Count</th></tr>
        ${d.top_numbers.map(n => `<tr><td>${escapeHtml(n.number)}</td><td>${Number(n.sms_count) || 0}</td></tr>`).join('') || '<tr><td colspan="2">No data</td></tr>'}
      </table>
      <div class="footer">Generated by HUMAX SMS Panel on ${new Date().toISOString().split('T')[0]}</div>
    </body></html>
  `;
  if (typeof zyPrintHtml === 'function') { zyPrintHtml(html); return; }
  window.print();
}

// ─── PERMISSIONS ──────────────────────────────────────────────────
// ─── PERMISSIONS ──────────────────────────────────────────────────
async function renderPermissions() {
  const c = document.getElementById('page-content');
  try {
    const livePerms = await apiFetch('/api/permissions') || {};
    const roles = ['Admin', 'Agent', 'Client'];
    const modules = ['Numbers', 'SMS', 'SMPP', 'Users', 'Finance', 'API', 'Settings', 'Security'];

    const getPerm = (r, m) => {
      if (livePerms[r] && livePerms[r][m] !== undefined) return livePerms[r][m];
      if (r === 'Admin') return 1;
      if (r === 'Agent') return ['Numbers', 'SMS', 'Users', 'Finance', 'API'].includes(m) ? 1 : 0;
      if (r === 'Client') return ['Numbers', 'SMS', 'Finance', 'API'].includes(m) ? 1 : 0;
      return 0;
    };

    const rows = roles.map(r => `<tr>
      <td>${roleBadge(r)}</td>
      ${modules.map(m => `<td>
        <input type="checkbox" id="perm-${r}-${m}" ${getPerm(r, m) ? 'checked' : ''} ${r === 'Admin' && m === 'Security' ? 'disabled' : ''}>
      </td>`).join('')}
    </tr>`).join('');

    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Permissions</div><div class="page-subtitle">Role-based access control (RBAC) matrix</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="savePermissions()">
            <i class="fas fa-save"></i> Save All Permissions
          </button>
        </div>
      </div>
      ${renderSecurityTabs('permissions')}
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Role</th>${modules.map(m => `<th>${m}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
    `;
  } catch (err) {
    console.error('Render permissions error:', err);
    toast('Failed to load permissions', 'error');
  }
}

async function savePermissions() {
  const roles = ['Owner', 'Admin', 'Agent', 'Client'];
  const modules = ['Numbers', 'SMS', 'SMPP', 'Users', 'Finance', 'API', 'Settings', 'Security'];
  const updated = {
    Owner: { Numbers: 1, SMS: 1, SMPP: 1, Users: 1, Finance: 1, API: 1, Settings: 1, Security: 1 }
  };

  roles.filter(r => r !== 'Owner').forEach(r => {
    updated[r] = {};
    modules.forEach(m => {
      const el = document.getElementById(`perm-${r}-${m}`);
      updated[r][m] = el ? (el.checked ? 1 : 0) : (r === 'Admin' ? 1 : 0);
    });
  });

  try {
    const res = await apiFetch('/api/permissions', {
      method: 'POST',
      body: JSON.stringify(updated)
    });
    if (res && res.success) {
      toast('Permissions updated and saved successfully!', 'success');
      renderPermissions();
    } else {
      toast(res?.error || 'Failed to save permissions', 'error');
    }
  } catch (err) {
    toast(err.message || 'Error saving permissions', 'error');
  }
}

// ════════════════════════════════════════════════════════════════════
//  REMAINING PAGES — Placeholder functions (will work with real API)
// ════════════════════════════════════════════════════════════════════

// ─── HTTP OVERVIEW ──────────────────────────────────────────────
function renderHttpOverview() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">HTTP Providers — Overview</div><div class="page-subtitle">Webhook and API integration guide</div></div>
    </div>
    ${renderOwnerHubTabs('settings', 'api-tokens')}
    ${renderApiWebhooksTabs('webhook')}
    <div class="two-col">
      <div class="card">
        <div class="card-header"><div class="card-title">Getting Started</div></div>
        <div style="line-height:1.8;color:var(--text-secondary);">
          <p>Connect your server to receive OTP data in real-time via HTTP webhooks.</p>
          <br>
          <strong>Steps:</strong>
          <ol style="padding-left:20px;margin-top:8px;">
            <li>Generate an API token</li>
            <li>Configure your webhook URL</li>
            <li>Set up field mapping</li>
            <li>Test with the simulator</li>
          </ol>
        </div>
        <div style="margin-top:20px;">
          <button class="btn btn-primary" onclick="loadPage('api-tokens')"><i class="fas fa-key"></i> Get API Token</button>
          <button class="btn btn-outline" style="margin-left:10px;" onclick="loadPage('webhook-config')"><i class="fas fa-share-nodes"></i> Configure Webhook</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Sample Payload</div></div>
        <div class="code-block">
<button class="code-copy" onclick="copyCode(this)">Copy</button>{
  "event": "otp_received",
  "number": "+12025551234",
  "app": "WhatsApp",
  "message": "Your code is 123456",
  "country": "US",
  "timestamp": "2024-01-15T10:30:00Z",
  "provider": "Twilio"
}
        </div>
      </div>
    </div>
  `;
}

function copyCode(btn) {
  const block = btn.parentElement;
  const text = block.textContent.replace('Copy', '').trim();
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard', 'success'));
}

// ─── CUSTOM POSTBACK ──────────────────────────────────────────────
function renderCustomPostback() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Custom Postback</div><div class="page-subtitle">Build custom URL with field placeholders</div></div>
    </div>
    ${renderOwnerHubTabs('settings', 'api-tokens')}
    ${renderApiWebhooksTabs('webhook')}
    <div class="card">
      <div class="card-header"><div class="card-title">Postback URL Builder</div></div>
      <div class="form-group"><label class="form-label">Base URL</label>
        <input id="pb-url" placeholder="https://your-server.com/callback" value="https://example.com/callback"></div>
      <div class="form-group"><label class="form-label">Postback URL (with variables)</label>
        <input id="pb-full" value="https://example.com/callback?number={number}&app={app}&msg={message}&time={timestamp}"></div>
      <div class="card-header" style="margin-top:16px;"><div class="card-title">Available Variables</div></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;">
        ${['{number}', '{app}', '{message}', '{country}', '{provider}', '{timestamp}', '{otp_code}', '{user_id}', '{token}']
          .map(v => `<div class="code-block" style="cursor:pointer;" onclick="insertVar('${v}')">${v}</div>`).join('')}
      </div>
    </div>
  `;
}

function insertVar(v) {
  const inp = document.getElementById('pb-full');
  if (inp) inp.value += v;
}

// ─── FIELD MAPPING ────────────────────────────────────────────────
function renderFieldMapping() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Field Mapping Guide</div><div class="page-subtitle">Map incoming fields to your schema</div></div>
    </div>
    ${renderOwnerHubTabs('settings', 'api-tokens')}
    <div class="card">
      ${renderApiWebhooksTabs('mapping')}
      ${buildTable(
        ['Our Field', 'Your Field Name', 'Type', 'Example'],
        [
          ['number', 'phone / mobile / number', 'string', '+12025551234'],
          ['app', 'service / application / app', 'string', 'WhatsApp'],
          ['message', 'body / text / sms_text', 'string', 'Your OTP is 123456'],
          ['country', 'country_code / region', 'string', 'US'],
          ['timestamp', 'time / created_at / date', 'ISO8601', '2024-01-15T10:30:00Z'],
          ['provider', 'carrier / operator', 'string', 'Twilio'],
          ['user_id', 'account_id / uid', 'integer', '42']
        ]
      )}
    </div>
  `;
}

// ─── TEST ENDPOINT ────────────────────────────────────────────────
async function renderTestEndpoint() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Test Endpoint</div><div class="page-subtitle">Send test calls to your webhook</div></div>
    </div>
    ${renderOwnerHubTabs('settings', 'api-tokens')}
    ${renderApiWebhooksTabs('simulator')}
    <div class="two-col">
      <div class="card">
        <div class="card-header"><div class="card-title">Request Builder</div></div>
        <div class="form-group"><label class="form-label">URL</label>
          <input id="ep-url" value="https://example.com/webhook"></div>
        <div class="form-group"><label class="form-label">Method</label>
          <select id="ep-method"><option>POST</option><option>GET</option></select></div>
        <div class="form-group"><label class="form-label">Body (JSON)</label>
          <textarea id="ep-body" rows="5">${JSON.stringify({ event: "otp_received", number: "+12025551234", app: "WhatsApp", message: "Your code is 123456" }, null, 2)}</textarea></div>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="runEndpointTest()"><i class="fas fa-paper-plane"></i> Send</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Response</div></div>
        <div class="terminal" id="ep-response">// Response appears here…</div>
      </div>
    </div>
  `;
}

async function runEndpointTest() {
  const out = document.getElementById('ep-response');
  out.innerHTML = '<span style="color:var(--yellow-light)">→ Sending request…</span>';

  try {
    const result = await apiFetch('/api/webhook/test', {
      method: document.getElementById('ep-method').value,
      body: document.getElementById('ep-body').value
    });

    if (result) {
      out.innerHTML = `<span style="color:var(--green-light)">✓ ${result.status_code || 200} OK — ${result.response_time_ms || '—'}ms</span>\n\n${JSON.stringify(result, null, 2)}`;
    } else {
      out.innerHTML = `<span style="color:var(--red-light)">✗ Request failed</span>`;
    }
  } catch (err) {
    out.innerHTML = `<span style="color:var(--red-light)">✗ Error: ${err.message}</span>`;
  }
}

// ─── API TOKENS ───────────────────────────────────────────────────
async function renderApiTokens() {
  try {
    const data = await apiFetch('/api/tokens') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">API Tokens</div><div class="page-subtitle">Manage access keys</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="createNewToken()"><i class="fas fa-plus"></i> New Token</button>
        </div>
      </div>
      ${renderOwnerHubTabs('settings', 'api-tokens')}
      <div class="card">
        ${renderApiWebhooksTabs('tokens')}
        ${buildTable(
          ['#', 'Name', 'Agent', 'Token', 'Calls', 'Created', 'Last Used', 'Status', 'Actions'],
          data.map(t => [
            t.id || '—',
            `<strong>${t.name || '—'}</strong>`,
            t.agent_username ? `<span class="badge badge-blue">${t.agent_username}</span>` : '<span class="text-muted">—</span>',
            `<span class="monospace api-token-full" style="font-size:11px;">${t.token_hint ? '••••••••' + t.token_hint : '••••••••'}</span>`,
            t.calls || 0,
            fmtShort(t.created),
            t.last_used ? fmtShort(t.last_used) : '—',
            statusBadge(t.status),
            `<button class="btn btn-danger btn-sm" onclick="deleteToken(${t.id})"><i class="fas fa-trash"></i></button>`
          ])
        )}
      </div>
      <div class="card" style="margin-top:20px;">
        <div class="card-header"><div class="card-title">Usage Example</div></div>
        <div class="code-block">
<button class="code-copy" onclick="copyCode(this)">Copy</button>curl -H "Authorization: Bearer YOUR_TOKEN" \\
     -H "Content-Type: application/json" \\
     ${window.location.origin}/api/numbers
        </div>
      </div>
    `;
  } catch (err) {
    console.error('API Tokens error:', err);
    toast('Failed to load API tokens', 'error');
  }
}

function copyToken(token) {
  navigator.clipboard.writeText(token).then(() => toast('Token copied', 'success'));
}

async function createNewToken() {
  const agentsData = await apiFetch('/api/agents?limit=500');
  const agents = agentsData?.data || [];
  openModal('Create API Token', `
    <form id="create-token-form" onsubmit="doCreateToken(event)">
      <div class="form-group"><label class="form-label">Agent *</label>
        <select id="new-token-agent" required>
          <option value="">— Select Agent —</option>
          ${agents.map(a => `<option value="${a.id}">${a.username}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">Token Name</label>
        <input id="new-token-name" placeholder="e.g. Production Key" required></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="token-submit-btn">Create</button>
      </div>
    </form>
  `);
}

async function doCreateToken(event) {
  event.preventDefault();

  try {
    const name = document.getElementById('new-token-name').value.trim();
    const agentId = parseInt(document.getElementById('new-token-agent')?.value);
    if (!agentId) {
      toast('Please select an agent', 'error');
      return;
    }
    if (!name) {
      toast('Token name is required', 'error');
      return;
    }

    const btn = document.getElementById('token-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Creating...';
    }

    const result = await apiFetch('/api/tokens', { method: 'POST', body: JSON.stringify({ name, agent_id: agentId, created_by: 'Admin' }) });

    if (result && result.id) {
      closeModal();
      openModal('API Token Created', `
        <div class="alert alert-success" style="margin-bottom:14px;">API token created successfully. Save this token now.</div>
        <div class="code-block api-token-full" id="new-api-token">${result.token || ''}</div>
        <div class="form-actions" style="margin-top:14px;">
          <button type="button" class="btn btn-primary" onclick="copyToken('${result.token || ''}')">Copy Full Token</button>
          <button type="button" class="btn btn-outline" onclick="closeModal();renderApiTokens()">Done</button>
        </div>
      `);
      toast('Token created successfully', 'success');
    } else {
      toast(result?.error || 'Failed to create token', 'error');
    }
  } catch (err) {
    console.error('Create token error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('token-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Create';
    }
  }
}

async function deleteToken(id) {
  if (!confirm('Delete this token? This cannot be undone.')) return;

  try {
    await apiFetch(`/api/tokens/${id}`, { method: 'DELETE' });
    toast('Token deleted', 'warning');
    renderApiTokens();
  } catch (err) {
    console.error('Delete token error:', err);
    toast('Failed to delete token', 'error');
  }
}

// ─── API PLAYGROUND ───────────────────────────────────────────────
function renderApiPlayground() {
  const endpoints = [
    { method: 'GET', path: '/api/numbers', desc: 'List all numbers' },
    { method: 'GET', path: '/api/sms/stats', desc: 'SMS statistics' },
    { method: 'GET', path: '/api/users', desc: 'List users' },
    { method: 'GET', path: '/api/smpp/sessions', desc: 'SMPP sessions' },
    { method: 'GET', path: '/api/firewall/stats', desc: 'Firewall stats' },
    { method: 'GET', path: '/api/dashboard/stats', desc: 'Dashboard stats' }
  ];

  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">API Playground</div><div class="page-subtitle">Test API calls interactively</div></div>
    </div>
    ${renderOwnerHubTabs('settings', 'api-tokens')}
    <div class="card" style="margin-bottom:16px;">
      ${renderApiWebhooksTabs('playground')}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header"><div class="card-title">Available Endpoints</div></div>
        ${endpoints.map(e => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;"
               onclick="setPlaygroundEndpoint('${e.method}','${e.path}')">
            <span class="badge badge-${e.method === 'GET' ? 'green' : 'blue'}">${e.method}</span>
            <span class="monospace fs-12">${e.path}</span>
            <span class="text-muted fs-12">${e.desc}</span>
          </div>
        `).join('')}
        <div style="margin-top:16px;">
          <div class="form-group"><label class="form-label">Method</label>
            <select id="pg-method"><option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option></select></div>
          <div class="form-group"><label class="form-label">Path</label>
            <input id="pg-path" value="/api/dashboard/stats"></div>
          <div class="form-group"><label class="form-label">Body (JSON)</label>
            <textarea id="pg-body" rows="3" placeholder="{}"></textarea></div>
          <button class="btn btn-primary" onclick="runPlayground()"><i class="fas fa-play"></i> Run</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Response</div></div>
        <div class="terminal" id="pg-response" style="min-height:400px;">// Hit Run to see response…</div>
      </div>
    </div>
  `;
}

function setPlaygroundEndpoint(method, path) {
  document.getElementById('pg-method').value = method;
  document.getElementById('pg-path').value = path;
}

async function runPlayground() {
  const method = document.getElementById('pg-method').value;
  const path = document.getElementById('pg-path').value;
  const body = document.getElementById('pg-body').value;
  const out = document.getElementById('pg-response');

  out.innerHTML = '<span style="color:var(--yellow-light)">→ Running…</span>';

  try {
    const opts = { method };
    if (body.trim() && method !== 'GET') { opts.body = body; }
    const result = await apiFetch(path, opts);

    if (result) {
      out.innerHTML = `<span style="color:var(--green-light)">// 200 OK</span>\n\n${JSON.stringify(result, null, 2)}`;
    } else {
      out.innerHTML = `<span style="color:var(--red-light)">// Request failed</span>`;
    }
  } catch (err) {
    out.innerHTML = `<span style="color:var(--red-light)">// Error: ${err.message}</span>`;
  }
}

// ─── LIVE TEST ────────────────────────────────────────────────────
function renderLiveTest() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Live Test Simulator</div><div class="page-subtitle">Send dummy OTPs to test your webhook</div></div>
    </div>
    ${renderOwnerHubTabs('settings', 'api-tokens')}
    <div class="card" style="margin-bottom:16px;">
      ${renderApiWebhooksTabs('simulator')}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header"><div class="card-title">Simulator</div></div>
        <div class="form-group"><label class="form-label">Target Webhook URL</label>
          <input id="sim-url" value="https://example.com/webhook"></div>
        <div class="form-group"><label class="form-label">App</label>
          <select id="sim-app">
            ${['WhatsApp', 'Telegram', 'Google', 'Amazon', 'Facebook'].map(a => `<option>${a}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Number</label>
          <input id="sim-number" value="+12025551234"></div>
        <div class="form-group"><label class="form-label">OTP Message</label>
          <input id="sim-msg" value="Your verification code is 123456"></div>
        <div class="form-group"><label class="form-label">Count</label>
          <input type="number" id="sim-count" value="1" min="1" max="50"></div>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="runSimulator()"><i class="fas fa-paper-plane"></i> Send Test</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Simulation Log</div></div>
        <div class="terminal" id="sim-log" style="min-height:300px;">// Simulation results appear here…</div>
      </div>
    </div>
  `;
}

async function runSimulator() {
  const count = parseInt(document.getElementById('sim-count').value) || 1;
  const log = document.getElementById('sim-log');
  log.innerHTML = '';

  for (let i = 0; i < Math.min(count, 10); i++) {
    setTimeout(async () => {
      try {
        const result = await apiFetch('/api/webhook/test', {
          method: 'POST',
          body: JSON.stringify({
            event: 'otp_received',
            app: document.getElementById('sim-app').value,
            number: document.getElementById('sim-number').value,
            message: document.getElementById('sim-msg').value
          })
        });
        const logEl = document.getElementById('sim-log');
        if (logEl) {
          logEl.innerHTML += `<span style="color:var(--green-light)">[${new Date().toLocaleTimeString()}] ✓ Sent — ${result?.response_time_ms || '?'}ms</span>\n`;
        }
      } catch (err) {
        const logEl = document.getElementById('sim-log');
        if (logEl) {
          logEl.innerHTML += `<span style="color:var(--red-light)">[${new Date().toLocaleTimeString()}] ✗ Failed — ${err.message}</span>\n`;
        }
      }
    }, i * 300);
  }
}

// ─── WEBHOOK CONFIG ───────────────────────────────────────────────
async function renderWebhookConfig() {
  try {
    const cfg = await apiFetch('/api/webhook/config') || {};

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header" style="margin-bottom:18px;">
        <div>
          <div class="page-title">Webhook & Interconnect Hub</div>
          <div class="page-subtitle">Real-time HTTP callbacks, carrier event dispatching & automated failover</div>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;">
          <button class="sp-btn-secondary" style="height:36px;padding:0 14px;font-size:12px;display:inline-flex;align-items:center;gap:6px;" onclick="testWebhookPing()">
            <i class="fas fa-paper-plane"></i> Test Webhook Ping
          </button>
        </div>
      </div>
      ${renderOwnerHubTabs('settings', 'api-tokens')}
      ${renderApiWebhooksTabs('webhook')}
      
      <div id="webhook-test-result" style="display:none;margin-bottom:16px;"></div>

      <div class="two-col" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
        <div class="zy-panel">
          <div class="zy-panel-head"><span>Callback Endpoint Connection</span></div>
          <div class="zy-panel-body" style="padding:16px;">
            <form id="webhook-config-form" onsubmit="saveWebhookConfig(event)">
              <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-weight:600;font-size:12px;">Endpoint URL *</label>
                <input class="zy-input" value="${cfg.url || ''}" id="wc-url" placeholder="https://api.yourdomain.com/sms/callback" style="width:100%;height:38px;">
              </div>
              <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-weight:600;font-size:12px;">HMAC Signing Secret</label>
                <input class="zy-input" value="${cfg.secret || ''}" id="wc-secret" type="password" placeholder="whsec_..." style="width:100%;height:38px;">
              </div>
              <div class="form-group" style="margin-bottom:16px;">
                <label class="form-label" style="font-weight:600;font-size:12px;">Content-Type</label>
                <select id="wc-content-type" class="zy-input" style="width:100%;height:38px;">
                  <option ${cfg.content_type === 'application/json' ? 'selected' : ''}>application/json</option>
                  <option ${cfg.content_type === 'application/x-www-form-urlencoded' ? 'selected' : ''}>application/x-www-form-urlencoded</option>
                </select>
              </div>
              <div class="form-actions" style="display:flex;gap:8px;">
                <button type="submit" class="sp-btn-primary" style="height:38px;padding:0 18px;font-size:13px;display:inline-flex;align-items:center;gap:6px;"><i class="fas fa-save"></i> Save Configuration</button>
                <button type="button" class="sp-btn-secondary" style="height:38px;padding:0 14px;font-size:13px;" onclick="testWebhookPing()"><i class="fas fa-bolt"></i> Send Test Event</button>
              </div>
            </form>
          </div>
        </div>

        <div class="zy-panel">
          <div class="zy-panel-head"><span>Custom HTTP Headers</span></div>
          <div class="zy-panel-body" style="padding:16px;">
            <div id="headers-list">
              ${Object.entries(cfg.headers || {}).map(([k, v]) => `
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                  <input class="zy-input" value="${k}" style="flex:1;height:34px;" placeholder="Header-Name">
                  <input class="zy-input" value="${v}" style="flex:2;height:34px;" placeholder="Value">
                  <button class="btn-icon text-danger" onclick="this.parentElement.remove()" style="padding:4px 8px;"><i class="fas fa-times"></i></button>
                </div>
              `).join('')}
            </div>
            <button class="sp-btn-secondary" style="height:32px;padding:0 12px;font-size:12px;margin-top:8px;display:inline-flex;align-items:center;gap:5px;" onclick="addHeader()"><i class="fas fa-plus"></i> Add Header</button>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Webhook config error:', err);
    toast('Failed to load webhook config', 'error');
  }
}

async function testWebhookPing() {
  const resultBox = document.getElementById('webhook-test-result');
  if (resultBox) {
    resultBox.style.display = 'block';
    resultBox.innerHTML = `<div class="zy-loading">Dispatching test ping to webhook endpoint...</div>`;
  }
  const start = Date.now();
  try {
    const res = await apiFetch('/api/webhook/test', {
      method: 'POST',
      body: JSON.stringify({
        event: 'test_ping',
        timestamp: new Date().toISOString(),
        test_payload: { ping: 'pong', source: 'HUMAX SMS Webhook Hub' }
      })
    });
    const latency = Date.now() - start;
    if (resultBox) {
      resultBox.innerHTML = `
        <div class="sp-card" style="padding:14px 18px;border-left:4px solid #10b981;background:#ecfdf5;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <i class="fas fa-circle-check" style="color:#10b981;font-size:20px;"></i>
            <div>
              <strong style="color:#065f46;">Webhook Test Succeeded (HTTP 200)</strong>
              <div style="font-size:12px;color:#047857;">Response received in ${latency}ms · Message: "${res?.message || 'Webhook test received'}"</div>
            </div>
          </div>
          <button class="sp-btn-secondary" style="height:28px;padding:0 10px;font-size:11px;" onclick="document.getElementById('webhook-test-result').style.display='none'">Dismiss</button>
        </div>`;
    }
    toast(`✅ Webhook ping successful (${latency}ms)`, 'success');
  } catch (err) {
    const latency = Date.now() - start;
    if (resultBox) {
      resultBox.innerHTML = `
        <div class="sp-card" style="padding:14px 18px;border-left:4px solid #ef4444;background:#fef2f2;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <i class="fas fa-circle-exclamation" style="color:#ef4444;font-size:20px;"></i>
            <div>
              <strong style="color:#991b1b;">Webhook Test Failed (${latency}ms)</strong>
              <div style="font-size:12px;color:#b91c1c;">${err.message || 'Connection refused or timeout'}</div>
            </div>
          </div>
          <button class="sp-btn-secondary" style="height:28px;padding:0 10px;font-size:11px;" onclick="document.getElementById('webhook-test-result').style.display='none'">Dismiss</button>
        </div>`;
    }
    toast(`Webhook test failed: ${err.message}`, 'error');
  }
}

function addHeader() {
  const list = document.getElementById('headers-list');
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
  div.innerHTML = `
    <input class="zy-input" style="flex:1;height:34px;" placeholder="Header-Name">
    <input class="zy-input" style="flex:2;height:34px;" placeholder="Value">
    <button class="btn-icon text-danger" onclick="this.parentElement.remove()" style="padding:4px 8px;"><i class="fas fa-times"></i></button>
  `;
  list.appendChild(div);
}

async function saveWebhookConfig(event) {
  event.preventDefault();

  try {
    const headers = {};
    document.querySelectorAll('#headers-list > div').forEach(div => {
      const inputs = div.querySelectorAll('input');
      if (inputs.length >= 2 && inputs[0].value.trim() && inputs[1].value.trim()) {
        headers[inputs[0].value.trim()] = inputs[1].value.trim();
      }
    });

    const payload = {
      url: document.getElementById('wc-url').value,
      secret: document.getElementById('wc-secret').value,
      content_type: document.getElementById('wc-content-type').value,
      headers
    };

    const result = await apiFetch('/api/webhook/config', { method: 'POST', body: JSON.stringify(payload) });

    if (result && result.success) {
      toast('Webhook config saved successfully', 'success');
    } else {
      toast(result?.error || 'Failed to save config', 'error');
    }
  } catch (err) {
    console.error('Save webhook config error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

// ─── DOCUMENTATION ────────────────────────────────────────────────
function renderDocumentation() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">API Documentation</div><div class="page-subtitle">REST API reference</div></div>
    </div>
    ${renderOwnerHubTabs('settings', 'api-tokens')}
    <div class="card" style="margin-bottom:16px;">
      ${renderApiWebhooksTabs('docs')}
    </div>
    ${[
      { method: 'GET', path: '/api/numbers', desc: 'List all virtual numbers. Supports ?page, ?limit, ?search, ?status query params.', resp: '{"data":[...],"total":200,"page":1,"pages":10}' },
      { method: 'POST', path: '/api/numbers/upload', desc: 'Upload a .txt or .csv file with one number per line.', resp: '{"imported":50,"total":250}' },
      { method: 'GET', path: '/api/sms/stats', desc: 'Get SMS delivery statistics and profit data.', resp: '{"total_sms":200,"delivered":180,"failed":20,...}' },
      { method: 'GET', path: '/api/users', desc: 'List all users. Supports ?search, ?role filtering.', resp: '{"data":[...],"total":30}' },
      { method: 'GET', path: '/api/smpp/sessions', desc: 'Get active SMPP sessions.', resp: '[{"id":1,"system_id":"sys001",...}]' },
      { method: 'GET', path: '/api/firewall/stats', desc: 'Firewall statistics and threat level.', resp: '{"total_blocked":20,"threat_level":"Low",...}' }
    ].map(ep => `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <span class="badge badge-${ep.method === 'GET' ? 'green' : 'blue'}" style="font-size:13px;padding:5px 12px;">${ep.method}</span>
          <span class="monospace fw-600">${ep.path}</span>
        </div>
        <p class="text-secondary" style="margin-bottom:12px;">${ep.desc}</p>
        <div class="code-block">${ep.resp}</div>
      </div>
    `).join('')}
  `;
}

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────
async function renderAnnouncements() {
  try {
    const result = await apiFetch('/api/announcements?role=Admin');
    const data = result?.data || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">News &amp; Announcements</div><div class="page-subtitle">Sent to everyone — Owner, Agents and Clients</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openNewAnnouncementModal()">
            <i class="fas fa-bullhorn"></i> New Broadcast
          </button>
          <button class="btn btn-outline btn-sm text-danger" onclick="clearAllAnnouncements()">
            <i class="fas fa-trash-can"></i> Clear All Announcements
          </button>
        </div>
      </div>
      ${renderOwnerHubTabs('comm', 'announcements')}
      ${data.length > 0 ? data.map(a => `
        <div class="card" style="margin-bottom:14px;border-left:3px solid var(--${a.type === 'warning' ? 'yellow-light' : a.type === 'success' ? 'green-light' : 'accent'});">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
              ${badge(a.type || 'info', a.type === 'warning' ? 'yellow' : a.type === 'success' ? 'green' : 'blue')}
              <strong>${a.title || '—'}</strong>
              ${badge(a.target?.scope === 'agent' ? `Agent #${a.target.agent_id}` : a.target?.scope === 'client' ? 'Clients Only' : 'Everyone', 'purple')}
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="text-muted fs-12">${fmtShort(a.created)}</span>
              <button class="btn-icon" onclick="deleteAnnouncement(${a.id})" title="Delete"><i class="fas fa-trash" style="color:var(--red-light);"></i></button>
            </div>
          </div>
          <p class="text-secondary">${a.body || ''}</p>
        </div>
      `).join('') : `
        <div class="empty-state"><i class="fas fa-inbox"></i><p>No announcements yet</p></div>
      `}
    `;
  } catch (err) {
    console.error('Announcements error:', err);
    toast('Failed to load announcements', 'error');
  }
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;
  await apiFetch(`/api/announcements/${id}`, { method: 'DELETE' });
  toast('Announcement deleted', 'warning');
  renderAnnouncements();
}

async function clearAllAnnouncements() {
  if (!confirm('⚠️ Are you sure you want to clear ALL announcements? This will remove all broadcast messages.')) return;
  try {
    const res = await apiFetch('/api/announcements/clear', { method: 'POST' });
    if (res && res.success) {
      toast('All announcements cleared successfully', 'success');
      renderAnnouncements();
    } else {
      toast(res?.error || 'Failed to clear announcements', 'error');
    }
  } catch (err) {
    toast(err.message || 'Error clearing announcements', 'error');
  }
}

function openNewAnnouncementModal() {
  openModal('System Broadcast & Announcement (Owner)', `
    <form id="new-announcement-form" onsubmit="submitAnnouncement(event)">
      <div class="form-group"><label class="form-label">Broadcast Target Audience *</label>
        <select id="ann-target">
          <option value="all">Entire System (Owner, Agents &amp; Clients)</option>
          <option value="agent">Agents Only</option>
          <option value="client">Clients Only</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Announcement Title *</label><input id="ann-title" placeholder="e.g. Important System Update / Maintenance Notice" required></div>
      <div class="form-group"><label class="form-label">Broadcast Message Content *</label><textarea id="ann-body" rows="4" placeholder="Type your broadcast message to be shown across the system..." required></textarea></div>
      <div class="form-group"><label class="form-label">Display Style / Type</label>
        <select id="ann-type">
          <option value="info">Information (Blue)</option>
          <option value="success">Success / Important (Green)</option>
          <option value="warning">System Warning / Urgent (Amber)</option>
        </select>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-top:12px;background:var(--bg-card);padding:10px 12px;border-radius:6px;border:1px solid var(--border);">
        <input type="checkbox" id="ann-popup" checked style="width:18px;height:18px;cursor:pointer;">
        <label for="ann-popup" style="margin:0;cursor:pointer;font-weight:600;font-size:13px;color:var(--text);">
          Pop-up on screen when users open their panel
        </label>
      </div>
      <div class="form-actions" style="margin-top:16px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="ann-submit-btn"><i class="fas fa-bullhorn"></i> Send Broadcast</button>
      </div>
    </form>
  `);
}

async function submitAnnouncement(event) {
  event.preventDefault();

  try {
    const title = document.getElementById('ann-title').value.trim();
    const body = document.getElementById('ann-body').value.trim();
    const type = document.getElementById('ann-type').value;
    const target_role = document.getElementById('ann-target').value;
    const is_popup = document.getElementById('ann-popup').checked;

    if (!title || !body) {
      toast('Title and body are required', 'error');
      return;
    }

    const btn = document.getElementById('ann-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Broadcasting...';
    }

    const result = await apiFetch('/api/announcements', {
      method: 'POST',
      body: JSON.stringify({
        title,
        body,
        type,
        target_role,
        is_popup,
        sender_role: 'Owner',
        sender_name: 'Kamran_Bhatti'
      })
    });

    if (result && result.id) {
      closeModal();
      toast('System broadcast published successfully!', 'success');
      renderAnnouncements();
    } else {
      toast(result?.error || 'Failed to post broadcast', 'error');
    }
  } catch (err) {
    console.error('Submit announcement error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('ann-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-bullhorn"></i> Send Broadcast';
    }
  }
}

// ─── SUPPORT TICKETS ──────────────────────────────────────────────
async function renderSupportTickets() {
  try {
    const data = await apiFetch('/api/support-tickets') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Support Tickets</div><div class="page-subtitle">${data.filter(t => t.status !== 'closed').length} open</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="toast('New ticket', 'info')"><i class="fas fa-plus"></i> New Ticket</button>
        </div>
      </div>
      ${renderOwnerHubTabs('comm', 'support-tickets')}
      <div class="card">
        ${buildTable(
          ['#', 'User', 'Subject', 'Priority', 'Status', 'Date', 'Actions'],
          data.map(t => [
            t.id || '—',
            t.user || '—',
            t.subject || '—',
            badge(t.priority || 'Medium', t.priority === 'High' ? 'red' : t.priority === 'Medium' ? 'yellow' : 'blue'),
            statusBadge(t.status),
            t.date || '—',
            `<button class="btn btn-outline btn-sm" onclick="toast('Ticket opened', 'info')"><i class="fas fa-eye"></i> View</button>`
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('Support tickets error:', err);
    toast('Failed to load support tickets', 'error');
  }
}

// ─── MY PROFILE ───────────────────────────────────────────────────
function renderMyProfile(tab = 'details') {
  if (window.HumexProfile && typeof window.HumexProfile.render === 'function') {
    window.HumexProfile.render('page-content', tab || 'details');
  }
}

// ─── MY PAYOUTS ───────────────────────────────────────────────────
async function renderMyPayouts() {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;
  try {
    const data = await apiFetch('/api/payout-requests');
    const requests = data?.data || [];

    const paid = requests.filter(r => r.status === 'paid' || r.status === 'approved');
    const pending = requests.filter(r => r.status === 'pending');
    const totalPaid = paid.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
    const totalPending = pending.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
    const thisMonth = new Date().toISOString().slice(0, 7);
    const thisMonthPaid = paid.filter(r => (r.timestamp || '').slice(0, 7) === thisMonth)
                              .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);

    const sorted = [...requests].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Payouts Overview</div><div class="page-subtitle">Real payout activity across your whole system</div></div>
        <div class="page-actions">
          <button class="btn btn-outline btn-sm" onclick="loadPage('payout-requests')"><i class="fas fa-list-check"></i> Review Requests</button>
        </div>
      </div>
      ${renderOwnerHubTabs('finance', 'my-payouts')}
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
        ${statCard('Total Paid Out', 'fas fa-coins', '$' + zyFmtMoney(totalPaid, 2), 'blue', 'All time')}
        ${statCard('This Month', 'fas fa-calendar', '$' + zyFmtMoney(thisMonthPaid, 2), 'green', 'Paid so far this month')}
        ${statCard('Pending', 'fas fa-clock', '$' + zyFmtMoney(totalPending, 2), 'yellow', `${pending.length} request(s) awaiting`)}
      </div>
      <div class="card">
        ${sorted.length ? buildTable(
          ['#', 'To', 'Amount', 'Method', 'Status', 'Date'],
          sorted.map(r => [
            r.id || '—',
            r.user || r.username || '—',
            `$${zyFmtMoney((parseFloat(r.amount) || 0), 2)}`,
            r.method || '—',
            statusBadge(r.status),
            fmtShort(r.timestamp)
          ])
        ) : `<div class="empty-state"><i class="fas fa-receipt"></i><p>No payout requests yet</p></div>`}
      </div>
    `;
  } catch (err) {
    console.error('Payouts overview error:', err);
    toast('Failed to load payouts data', 'error');
  }
}

// ─── FIREWALL DASHBOARD ───────────────────────────────────────────
async function renderFirewallDashboard() {
  try {
    const [stats, events] = await Promise.all([
      apiFetch('/api/firewall/stats'),
      apiFetch('/api/firewall/events?limit=5')
    ]);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Firewall & Security Control</div><div class="page-subtitle">Security overview and intrusion defense</div></div>
      </div>
      ${renderSecurityTabs('firewall')}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="loadPage('firewall-dashboard')"><i class="fas fa-shield-halved"></i> Security Overview</button>
        <button class="btn btn-outline btn-sm" onclick="loadPage('blocked-ips')"><i class="fas fa-ban"></i> Blocked IPs</button>
        <button class="btn btn-outline btn-sm" onclick="loadPage('firewall-events')"><i class="fas fa-file-shield"></i> Firewall Events</button>
      </div>
      <div class="stats-grid">
        ${statCard('Blocked IPs', 'fas fa-ban', stats?.total_blocked || 0, 'red', 'Active blocks')}
        ${statCard('Events (24h)', 'fas fa-bolt', stats?.events_24h || 0, 'yellow', 'Today')}
        ${statCard('Threat Level', 'fas fa-shield-halved', stats?.threat_level || '—', 'blue', 'Current')}
        ${statCard('Scanner Agents', 'fas fa-robot', stats?.scanner_agents || 0, 'purple', 'Detected')}
      </div>
      <div class="charts-grid">
        <div class="card">
          <div class="card-header"><div class="card-title">24h Firewall Events</div></div>
          <div class="chart-container"><canvas id="fw-chart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Recent Events</div></div>
          ${buildTable(['IP', 'Event', 'Reason', 'Time'],
            (events?.data || []).slice(0, 5).map(e => [
              e.ip || '—',
              badge(e.event || '—', e.event === 'Blocked' ? 'red' : e.event === 'Allowed' ? 'green' : 'yellow'),
              e.reason || '—',
              fmtShort(e.timestamp)
            ])
          )}
        </div>
      </div>
    `;

    try {
      const ctx = document.getElementById('fw-chart');
      const hourlyData = stats?.hourly_events || Array.from({ length: 24 }, () => 0);
      if (ctx && typeof Chart !== 'undefined') {
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
            datasets: [{
              data: hourlyData,
              label: 'Events',
              backgroundColor: 'rgba(218,54,51,0.5)',
              borderColor: '#f85149',
              borderWidth: 1,
              borderRadius: 3
            }]
          },
          options: chartOpts()
        });
      }
    } catch (err) {
      console.warn('Chart render error:', err);
    }
  } catch (err) {
    console.error('Firewall dashboard error:', err);
    toast('Failed to load firewall dashboard', 'error');
  }
}

// ─── BLOCKED IPs ──────────────────────────────────────────────────
async function renderBlockedIps() {
  try {
    const data = await apiFetch('/api/firewall/blocked-ips') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Blocked IP Addresses</div><div class="page-subtitle">${data.length} active IP blocks in firewall</div></div>
        <div class="page-actions">
          <button class="btn btn-danger btn-sm" onclick="openBlockIpModal()"><i class="fas fa-ban"></i> Block IP</button>
        </div>
      </div>
      ${renderSecurityTabs('firewall')}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="loadPage('firewall-dashboard')"><i class="fas fa-shield-halved"></i> Security Overview</button>
        <button class="btn btn-primary btn-sm" onclick="loadPage('blocked-ips')"><i class="fas fa-ban"></i> Blocked IPs</button>
        <button class="btn btn-outline btn-sm" onclick="loadPage('firewall-events')"><i class="fas fa-file-shield"></i> Firewall Events</button>
      </div>
      <div class="card">
        ${buildTable(
          ['#', 'IP Address', 'Reason', 'Blocked At', 'Expires', 'Actions'],
          data.map(b => [
            b.id || '—',
            `<span class="monospace">${b.ip || '—'}</span>`,
            badge(b.reason || '—', b.reason === 'DDoS' || b.reason === 'Brute Force' ? 'red' : 'yellow'),
            fmtShort(b.blocked_at),
            b.expires === 'Permanent' ? badge('Permanent', 'red') : fmtShort(b.expires),
            `<button class="btn btn-success btn-sm" onclick="unblockIp(${b.id})"><i class="fas fa-unlock"></i> Unblock</button>`
          ])
        )}
      </div>
    `;
  } catch (err) {
    console.error('Blocked IPs error:', err);
    toast('Failed to load blocked IPs', 'error');
  }
}

function openBlockIpModal() {
  openModal('Block IP Address', `
    <form id="block-ip-form" onsubmit="doBlockIp(event)">
      <div class="form-group"><label class="form-label">IP Address *</label>
        <input id="block-ip" placeholder="192.168.1.1 or 192.168.1.0/24" required></div>
      <div class="form-group"><label class="form-label">Reason</label>
        <select id="block-reason">
          <option>DDoS</option>
          <option>Brute Force</option>
          <option>Spam</option>
          <option>Port Scan</option>
          <option>Manual</option>
        </select></div>
      <div class="form-group"><label class="form-label">Duration</label>
        <select id="block-duration">
          <option value="Permanent">Permanent</option>
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
        </select></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-danger" id="block-submit-btn"><i class="fas fa-ban"></i> Block</button>
      </div>
    </form>
  `);
}

async function doBlockIp(event) {
  event.preventDefault();

  try {
    const ip = document.getElementById('block-ip').value.trim();
    const reason = document.getElementById('block-reason').value;
    const duration = document.getElementById('block-duration').value;

    if (!ip) {
      toast('IP address is required', 'error');
      return;
    }

    const btn = document.getElementById('block-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Blocking...';
    }

    const result = await apiFetch('/api/firewall/block-ip', {
      method: 'POST',
      body: JSON.stringify({ ip, reason, expires: duration })
    });

    if (result && result.success) {
      closeModal();
      toast(`${ip} blocked successfully`, 'warning');
      renderBlockedIps();
    } else {
      toast(result?.error || 'Failed to block IP', 'error');
    }
  } catch (err) {
    console.error('Block IP error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('block-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-ban"></i> Block';
    }
  }
}

async function unblockIp(id) {
  if (!confirm('Unblock this IP?')) return;

  try {
    await apiFetch(`/api/firewall/blocked-ips/${id}`, { method: 'DELETE' });
    toast('IP unblocked', 'success');
    renderBlockedIps();
  } catch (err) {
    console.error('Unblock IP error:', err);
    toast('Failed to unblock IP', 'error');
  }
}

// ─── FIREWALL EVENTS ──────────────────────────────────────────────
async function renderFirewallEvents(page = 1) {
  try {
    const data = await apiFetch(`/api/firewall/events?page=${page}&limit=20`);
    if (!data) return;

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Firewall Events</div><div class="page-subtitle">Security log</div></div>
      </div>
      ${renderSecurityTabs('firewall')}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="loadPage('firewall-dashboard')"><i class="fas fa-shield-halved"></i> Security Overview</button>
        <button class="btn btn-outline btn-sm" onclick="loadPage('blocked-ips')"><i class="fas fa-ban"></i> Blocked IPs</button>
        <button class="btn btn-primary btn-sm" onclick="loadPage('firewall-events')"><i class="fas fa-file-shield"></i> Firewall Events</button>
      </div>
      <div class="card">
        ${buildTable(
          ['#', 'IP Address', 'Event', 'Reason', 'Threat', 'Timestamp'],
          (data.data || []).map(e => [
            e.id || '—',
            `<span class="monospace">${e.ip || '—'}</span>`,
            badge(e.event || '—', e.event === 'Blocked' ? 'red' : e.event === 'Allowed' ? 'green' : 'yellow'),
            e.reason || '—',
            `<span class="threat-${(e.threat || 'low').toLowerCase()}">${e.threat || 'Low'}</span>`,
            fmtShort(e.timestamp)
          ])
        )}
        ${pagination(page, data.total || 0, 20, renderFirewallEvents)}
      </div>
    `;
  } catch (err) {
    console.error('Firewall events error:', err);
    toast('Failed to load firewall events', 'error');
  }
}

// ─── RATE LIMITS ──────────────────────────────────────────────────
async function renderRateLimits() {
  try {
    const data = await apiFetch('/api/rate-limits') || {};

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Rate Limits</div><div class="page-subtitle">DDoS protection configuration</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="saveRateLimits()"><i class="fas fa-save"></i> Save All</button>
        </div>
      </div>
      ${renderSecurityTabs('ratelimits')}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
        ${Object.entries(data).map(([key, val]) => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <div class="fw-600">${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
              <input type="checkbox" ${val.enabled ? 'checked' : ''} id="rl-${key}-enabled">
            </div>
            <div class="form-group"><label class="form-label">Max Requests</label>
              <input type="number" id="rl-${key}-limit" value="${val.limit || 100}"></div>
            <div class="form-group"><label class="form-label">Window (seconds)</label>
              <input type="number" id="rl-${key}-window" value="${val.window || 60}"></div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Rate limits error:', err);
    toast('Failed to load rate limits', 'error');
  }
}

async function saveRateLimits() {
  toast('Rate limits saved', 'success');
}

// ─── GENERAL SETTINGS & UNIFIED ROLE THEME STUDIO ─────────────────
let _gsSelectedDefaultThemeKey = 'daylight_cobalt';
let _gsEditingThemeKey = '';

async function renderGeneralSettings() {
  try {
    const data = await apiFetch('/api/settings') || {};
    const curFont = data.font_family || 'system';
    const curLogo = data.logo_url || '/static/img/humex-sms-logo.png';
    const curSiteName = data.site_name || 'HUMAX SMS';
    const curTagline = data.tagline || 'Wholesale SMS Termination Gateway';
    const curFooter = data.footer_text || `© ${new Date().getFullYear()} ${curSiteName}. All rights reserved.`;

    const catalog = (window.BrandTheme && typeof window.BrandTheme.getThemes === 'function')
      ? window.BrandTheme.getThemes(data)
      : (Array.isArray(data.theme_catalog) ? data.theme_catalog : []);

    _gsSelectedDefaultThemeKey = (data.default_theme_key && catalog.some(t => t.key === data.default_theme_key))
      ? data.default_theme_key
      : (catalog[0]?.key || 'daylight_cobalt');
    _gsEditingThemeKey = '';

    const activeTheme = catalog.find(t => t.key === _gsSelectedDefaultThemeKey) || catalog[0] || {
      key: 'daylight_cobalt',
      name: 'Daylight Crisp & Cobalt',
      structure_tone: 'light',
      structure_bg: '#ffffff',
      structure_text: '#0f172a',
      structure_table_bg: '#f1f5f9',
      structure_table_text: '#334155',
      primary_btn: '#2563eb',
      primary_btn_text: '#ffffff',
      warning_btn: '#d97706',
      warning_btn_text: '#ffffff',
      danger_btn: '#dc2626'
    };

    const fontOptions = [
      { key: 'system', name: 'System Default (Native OS)' },
      { key: 'inter', name: 'Inter (Clean & Modern)' },
      { key: 'poppins', name: 'Poppins (Geometric & Friendly)' },
      { key: 'roboto', name: 'Roboto (Google Standard)' },
      { key: 'outfit', name: 'Outfit (Trendy & High-Tech)' },
      { key: 'montserrat', name: 'Montserrat (Bold & Modern)' },
      { key: 'opensans', name: 'Open Sans (Neutral & Legible)' },
      { key: 'jakarta', name: 'Plus Jakarta Sans (Premium UI)' },
      { key: 'monospace', name: 'Monospace (Terminal / Tech)' }
    ];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fas fa-sliders" style="margin-right:8px;color:var(--theme-btn-primary,#2563eb);"></i> General &amp; Appearance Settings</div>
          <div class="page-subtitle">Configure brand identity, unified Role-Based Themes, typography, FX rates, and system defaults</div>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-primary" onclick="saveSettings()"><i class="fas fa-save"></i> Save All Settings</button>
        </div>
      </div>
      ${renderOwnerHubTabs('settings', 'general-settings')}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm" onclick="loadPage('general-settings')"><i class="fas fa-sliders"></i> General &amp; Appearance</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="loadPage('security-settings')"><i class="fas fa-shield"></i> Security &amp; Sessions</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="loadPage('smpp-settings')"><i class="fas fa-server"></i> SMPP Server</button>
      </div>

      <div class="gs-subtabs" id="gs-section-tabs">
        <button type="button" class="gs-subtab-btn active" data-gs-tab="brand" onclick="switchGsSectionTab('brand', this)"><i class="fas fa-palette"></i> Brand &amp; Role Theme Studio</button>
        <button type="button" class="gs-subtab-btn" data-gs-tab="rates" onclick="switchGsSectionTab('rates', this)"><i class="fas fa-coins"></i> FX, Payterms &amp; Limits</button>
        <button type="button" class="gs-subtab-btn" data-gs-tab="system" onclick="switchGsSectionTab('system', this)"><i class="fas fa-server"></i> System &amp; Cleanup</button>
        <button type="button" class="gs-subtab-btn" data-gs-tab="all" onclick="switchGsSectionTab('all', this)"><i class="fas fa-layer-group"></i> Show All</button>
      </div>

      <div class="settings-two-col" id="gs-main-grid">
        <!-- Left Column: Brand & System Settings -->
        <div id="gs-left-col" style="display:flex; flex-direction:column; gap:20px; width:100%;">
          <!-- Brand & Identity -->
          <div class="card gs-card-section" data-gs-sec="brand">
            <div class="card-header" style="border-bottom:1px solid #eef2f6;padding-bottom:12px;margin-bottom:16px;">
              <div class="card-title"><i class="fas fa-building" style="color:var(--theme-btn-primary,#2563eb);margin-right:6px;"></i> Brand &amp; Logo Settings</div>
            </div>

            <div class="form-group">
              <label class="form-label" style="font-weight:600;">Panel / Site Name</label>
              <input type="text" value="${escapeHtml(curSiteName)}" id="s-site-name" oninput="gsUpdateLiveRolePreview()" placeholder="e.g. HUMAX SMS" style="font-size:15px;font-weight:600;">
              <div class="text-muted fs-12" style="margin-top:4px;">Displayed in header logo, login screen, and browser tab title across all panels.</div>
            </div>

            <div class="form-group">
              <label class="form-label" style="font-weight:600;">Tagline / Subtitle</label>
              <input type="text" value="${escapeHtml(curTagline)}" id="s-tagline" placeholder="e.g. Wholesale SMS Termination Gateway">
            </div>

            <div class="form-group">
              <label class="form-label" style="font-weight:600;">Brand Logo &amp; Icon</label>
              <div style="background:#f8fafc;padding:16px;border-radius:12px;border:1.5px dashed #cbd5e1;display:flex;flex-direction:column;gap:12px;">
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                  <div style="width:80px;height:80px;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.08);padding:8px;position:relative;border:1px solid #e2e8f0;flex-shrink:0;">
                    <img id="logo-preview-img" src="${escapeHtml(curLogo)}" alt="Logo Preview" style="max-height:100%;max-width:100%;object-fit:contain;">
                  </div>
                  <div style="flex:1;min-width:0;width:100%;">
                    <div style="font-size:13.5px;font-weight:700;color:#0f172a;margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      <span>Upload Picture Directly to Project</span>
                      <span class="badge" style="font-size:10px;padding:2px 8px;background:var(--theme-btn-primary,#2563eb);color:#fff;"><i class="fas fa-database"></i> Permanent Storage</span>
                    </div>
                    <div style="font-size:11.5px;color:#64748b;margin-bottom:8px;line-height:1.4;">
                      Image is saved permanently in project assets and persisted in settings across Owner, Agent, and Client portals.
                    </div>
                    <input type="file" id="logo-file-input" accept="image/*" onchange="directUploadLogo(event)" style="font-size:12px;display:block;margin-bottom:10px;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                      <button type="button" class="btn btn-primary btn-sm" onclick="document.getElementById('logo-file-input').click()" style="font-size:11.5px;padding:6px 14px;">
                        <i class="fas fa-upload" style="margin-right:4px;"></i> Upload Picture
                      </button>
                      <button type="button" class="btn btn-outline btn-sm" onclick="resetDefaultLogo()" style="font-size:11.5px;padding:6px 12px;" title="Reset to official HUMAX SMS logo">
                        <i class="fas fa-rotate-left" style="margin-right:4px;"></i> Reset HUMAX SMS Logo
                      </button>
                      <button type="button" class="btn btn-outline btn-sm" onclick="cropCurrentLogo()" style="font-size:11.5px;padding:6px 12px;">
                        <i class="fas fa-crop-alt" style="margin-right:4px;"></i> Crop &amp; Adjust
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" style="font-weight:600;">Logo Image URL (Optional Direct Link)</label>
              <input type="text" value="${escapeHtml(curLogo)}" id="s-logo-url" oninput="document.getElementById('logo-preview-img').src=this.value; var p=document.getElementById('preview-bar-logo'); if(p)p.src=this.value;" placeholder="/static/img/... or https://...">
            </div>

            <div class="form-group">
              <label class="form-label" style="font-weight:600;">Footer Copyright Text</label>
              <input type="text" value="${escapeHtml(curFooter)}" id="s-footer-text" placeholder="© 2026 Brand Name. All rights reserved.">
            </div>
          </div>

          <!-- OTP & Payout Controls -->
          <div class="card gs-card-section gs-hidden" data-gs-sec="rates">
            <div class="card-header" style="border-bottom:1px solid #eef2f6;padding-bottom:12px;margin-bottom:16px;">
              <div class="card-title"><i class="fas fa-coins" style="color:var(--theme-btn-primary,#2563eb);margin-right:6px;"></i> OTP, Payout &amp; Currency FX Controls</div>
            </div>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <div style="font-size:12.5px;font-weight:700;color:#14532d;">
                  <i class="fas fa-money-bill-transfer" style="margin-right:5px;color:#16a34a;"></i> Global Exchange Rate (USD → PKR)
                </div>
                <span id="s-fx-preview-badge" class="badge" style="background:#fff;color:#15803d;border:1px solid #86efac;font-size:11px;font-weight:700;">
                  1 USD = Rs. ${zyFmtMoney(Number(data.usd_to_pkr_rate || 280), 4)} PKR
                </span>
              </div>
              <div class="form-row" style="align-items:end;margin-bottom:8px;">
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label" style="font-size:12px;font-weight:600;color:#166534;">PKR per 1 USD *</label>
                  <input type="number" step="0.01" min="0.01" max="100000" value="${zyFmtMoney(Number(data.usd_to_pkr_rate || 280), 4)}" id="s-usd-to-pkr" oninput="zyUpdateFxPreview()" placeholder="280">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label" style="font-size:12px;font-weight:600;color:#166534;">Client Min Payout (PKR)</label>
                  <input type="number" step="1" min="0" value="${zyFmtMoney(Number(data.min_payout_pkr || (Number(data.min_payout || 50) * Number(data.usd_to_pkr_rate || 280))), 4)}" id="s-min-payout-pkr" placeholder="Auto: Min USD × FX">
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                <div id="s-fx-preview-text" class="text-muted fs-11" style="color:#166534;">
                  Used across Agent Client Rate Set margin caps and Client PKR conversion ($0.0100 USD ≈ Rs. ${zyFmtMoney((0.01 * Number(data.usd_to_pkr_rate || 280)), 4)} PKR).
                </div>
                <button type="button" class="btn btn-primary btn-sm" id="s-save-fx-btn" onclick="zySaveFxRateOnly()" style="white-space:nowrap;">
                  <i class="fas fa-check"></i> Update FX Rate
                </button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Global OTP Limit (per number / day)</label>
              <input type="number" value="${data.otp_limit || 5}" id="s-otp-limit">
            </div>
            <div class="form-group">
              <label class="form-label">Default Payout Rate (%)</label>
              <input type="number" value="${data.payout_rate || 0.85}" step="0.01" id="s-payout-rate">
            </div>
            <div class="form-group">
              <label class="form-label">Minimum Payout Threshold ($ USD for Agents)</label>
              <input type="number" value="${data.min_payout || 50}" id="s-min-payout">
            </div>
            <div class="form-group">
              <label class="form-label" style="font-weight:600;"><i class="fas fa-calendar-alt"></i> Master Payterm List (Owner Only)</label>
              <input type="text" value="${escapeHtml((data.payterms && data.payterms.length ? data.payterms : ['Weekly', 'Biweekly', 'Monthly']).join(', '))}" id="s-payterms" placeholder="Weekly, Biweekly, Monthly">
              <div class="text-muted fs-11" style="margin-top:4px;">Active schedules: Weekly (7/3 · 3d hold), Biweekly (15/3 · 3d hold), Monthly (30/5 {W} · 5d hold). Server rejects unknown strings.</div>
            </div>
            <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:12px 14px;margin-top:14px;">
              <div style="font-size:12.5px;font-weight:700;color:#312e81;margin-bottom:8px;">
                <i class="fas fa-calendar-check" style="margin-right:5px;color:#4f46e5;"></i> Monthly Cycle Window (30/5 {W} Settlement)
              </div>
              <div class="form-row" style="align-items:end;margin-bottom:8px;">
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label" style="font-size:11.5px;">Cycle Start Date</label>
                  <input type="date" id="s-mc-start" value="${escapeHtml(data.monthly_cycle?.start_date || '')}">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label" style="font-size:11.5px;">Cycle End Date</label>
                  <input type="date" id="s-mc-end" value="${escapeHtml(data.monthly_cycle?.end_date || '')}">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label" style="font-size:11.5px;">Company Clear Date</label>
                  <input type="date" id="s-mc-clear" value="${escapeHtml(data.monthly_cycle?.clear_date || '')}">
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <div class="text-muted fs-11" style="color:#4338ca;">Controls the settlement window shown in Agent &amp; Client Monthly Payment Boxes.</div>
                <button type="button" class="btn btn-primary btn-sm" id="s-save-mc-btn" onclick="zySaveMonthlyCycleOnly()"><i class="fas fa-check"></i> Save Monthly Cycle</button>
              </div>
            </div>
          </div>

          <!-- System Defaults & Maintenance -->
          <div class="card gs-card-section gs-hidden" data-gs-sec="system">
            <div class="card-header" style="border-bottom:1px solid #eef2f6;padding-bottom:12px;margin-bottom:16px;">
              <div class="card-title"><i class="fas fa-server" style="color:var(--theme-btn-primary,#2563eb);margin-right:6px;"></i> System Defaults</div>
            </div>
            <div class="form-group">
              <label class="form-label">Default Currency</label>
              <select id="s-currency">
                <option ${data.default_currency === 'USD' ? 'selected' : ''}>USD</option>
                <option ${data.default_currency === 'EUR' ? 'selected' : ''}>EUR</option>
                <option ${data.default_currency === 'GBP' ? 'selected' : ''}>GBP</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" style="font-weight:600;"><i class="fas fa-clock" style="margin-right:4px;"></i> Panel Timezone &amp; Clock Setting</label>
              <select id="s-timezone" onchange="previewTimezoneChange(this.value)">
                <option value="UTC" ${data.timezone === 'UTC' ? 'selected' : ''}>UTC (Coordinated Universal Time +00:00)</option>
                <option value="Asia/Karachi" ${data.timezone === 'Asia/Karachi' ? 'selected' : ''}>Asia/Karachi (Pakistan Standard Time, PKT UTC +05:00)</option>
                <option value="Asia/Dubai" ${data.timezone === 'Asia/Dubai' ? 'selected' : ''}>Asia/Dubai (Gulf Standard Time, GST UTC +04:00)</option>
                <option value="Asia/Riyadh" ${data.timezone === 'Asia/Riyadh' ? 'selected' : ''}>Asia/Riyadh (Arabia Standard Time, AST UTC +03:00)</option>
                <option value="Asia/Kolkata" ${data.timezone === 'Asia/Kolkata' ? 'selected' : ''}>Asia/Kolkata (India Standard Time, IST UTC +05:30)</option>
                <option value="Asia/Dhaka" ${data.timezone === 'Asia/Dhaka' ? 'selected' : ''}>Asia/Dhaka (Bangladesh Standard Time, BST UTC +06:00)</option>
                <option value="Europe/London" ${data.timezone === 'Europe/London' ? 'selected' : ''}>Europe/London (GMT / BST UTC +00:00 / +01:00)</option>
                <option value="Europe/Berlin" ${data.timezone === 'Europe/Berlin' ? 'selected' : ''}>Europe/Berlin (Central European Time, CET UTC +01:00)</option>
                <option value="Europe/Paris" ${data.timezone === 'Europe/Paris' ? 'selected' : ''}>Europe/Paris (Central European Time, CET UTC +01:00)</option>
                <option value="Europe/Istanbul" ${data.timezone === 'Europe/Istanbul' ? 'selected' : ''}>Europe/Istanbul (Turkey Time, TRT UTC +03:00)</option>
                <option value="America/New_York" ${data.timezone === 'America/New_York' ? 'selected' : ''}>America/New_York (US Eastern Time, ET UTC -05:00)</option>
                <option value="America/Chicago" ${data.timezone === 'America/Chicago' ? 'selected' : ''}>America/Chicago (US Central Time, CT UTC -06:00)</option>
                <option value="America/Los_Angeles" ${data.timezone === 'America/Los_Angeles' ? 'selected' : ''}>America/Los_Angeles (US Pacific Time, PT UTC -08:00)</option>
                <option value="Asia/Singapore" ${data.timezone === 'Asia/Singapore' ? 'selected' : ''}>Asia/Singapore (Singapore Time, SGT UTC +08:00)</option>
                <option value="Asia/Hong_Kong" ${data.timezone === 'Asia/Hong_Kong' ? 'selected' : ''}>Asia/Hong_Kong (Hong Kong Time, HKT UTC +08:00)</option>
                <option value="Asia/Tokyo" ${data.timezone === 'Asia/Tokyo' ? 'selected' : ''}>Asia/Tokyo (Japan Standard Time, JST UTC +09:00)</option>
              </select>
              <div class="text-muted fs-11" style="margin-top:4px;">Affects sidebar clock, dashboard live time, and all SMS log timestamps across Owner, Agent, and Client panels.</div>
            </div>
            <div class="form-group">
              <label class="form-label">Admin Notification Email</label>
              <input value="${escapeHtml(data.admin_email || '')}" id="s-admin-email" placeholder="admin@domain.com">
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff1f2;border-radius:8px;border:1px solid #fecdd3;margin-top:10px;">
              <div>
                <div class="fw-600" style="color:#9f1239;">Maintenance Mode</div>
                <div class="text-muted fs-12">Temporarily lock user panels for maintenance</div>
              </div>
              <input type="checkbox" ${data.maintenance_mode ? 'checked' : ''} id="s-maintenance" style="transform:scale(1.2);">
            </div>
          </div>

          <!-- Number Acquisition Mode & Hierarchy Limits -->
          <div class="card gs-card-section gs-hidden" data-gs-sec="rates">
            <div class="card-header" style="border-bottom:1px solid #eef2f6;padding-bottom:12px;margin-bottom:14px;">
              <div class="card-title"><i class="fas fa-sliders" style="color:var(--theme-btn-primary,#2563eb);margin-right:6px;"></i> Number Acquisition Mode &amp; Limits</div>
            </div>
            <p class="fs-12 text-muted" style="margin-bottom:14px;">Choose whether each tier can only <strong>Request</strong> numbers or only <strong>Self-Allocate</strong> directly (mutually exclusive — never both at once). Leave limits as <code>0</code> for unlimited.</p>
            <div style="display:grid;grid-template-columns:1fr;gap:12px;">
              ${[
                { key: 'agent',   label: 'Agents' },
                { key: 'client',  label: 'Clients' }
              ].map(t => {
                const modeVal = data[`${t.key}_alloc_mode`] === 'self_allocate' ? 'self_allocate' : 'request';
                const dailyVal = parseInt(data[`${t.key}_alloc_daily_limit`], 10) || 0;
                const totalVal = parseInt(data[`${t.key}_alloc_total_limit`], 10) || 0;
                return `
                  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;">
                    <div style="font-weight:700;font-size:12.5px;color:#0f172a;margin-bottom:8px;">${t.label} Default Policy</div>
                    <div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:8px;align-items:end;">
                      <div>
                        <label class="form-label" style="font-size:11px;margin-bottom:3px;">Active Mode</label>
                        <select id="s-${t.key}-alloc-mode" style="width:100%;">
                          <option value="request" ${modeVal === 'request' ? 'selected' : ''}>Request Only</option>
                          <option value="self_allocate" ${modeVal === 'self_allocate' ? 'selected' : ''}>Self-Allocate Only</option>
                        </select>
                      </div>
                      <div>
                        <label class="form-label" style="font-size:11px;margin-bottom:3px;">Daily Limit</label>
                        <input type="number" id="s-${t.key}-alloc-daily" min="0" value="${dailyVal}" placeholder="0 = unlimited">
                      </div>
                      <div>
                        <label class="form-label" style="font-size:11px;margin-bottom:3px;">Total Limit</label>
                        <input type="number" id="s-${t.key}-alloc-total" min="0" value="${totalVal}" placeholder="0 = unlimited">
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0;">
              <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;color:#1e293b;">
                <input type="checkbox" id="s-allow-ag-alloc" ${data.allow_agent_alloc_config !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--theme-btn-primary,#2563eb);">
                <span>Allow <strong>Agents</strong> to configure their downline Clients</span>
              </label>
            </div>
          </div>

          <!-- System Logs & Data Maintenance Card -->
          <div class="card gs-card-section gs-hidden" data-gs-sec="system" style="border: 1px solid #fed7aa; background: #fffaf0;">
            <div class="card-header" style="border-bottom:1px solid #fde68a;padding-bottom:12px;margin-bottom:14px;">
              <div class="card-title" style="color:#b45309;"><i class="fas fa-trash-can" style="margin-right:6px;"></i> System Logs &amp; Notification Cleanup</div>
            </div>
            <p class="fs-12 text-muted" style="margin-bottom:14px;">Role: <strong>Owner / Admin only</strong>. Safely purge old activity records, notifications, or login history to keep the database fast and clean.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-sm" style="color:#b91c1c;border-color:#fca5a5;background:#fff;" onclick="clearAuditLogs()"><i class="fas fa-file-shield"></i> Clear Audit Logs</button>
              <button type="button" class="btn btn-outline btn-sm" style="color:#b91c1c;border-color:#fca5a5;background:#fff;" onclick="clearLoginActivity()"><i class="fas fa-user-clock"></i> Clear Login Logs</button>
              <button type="button" class="btn btn-outline btn-sm" style="color:#b91c1c;border-color:#fca5a5;background:#fff;" onclick="clearAllNotifications()"><i class="fas fa-bell-slash"></i> Clear Notifications</button>
              <button type="button" class="btn btn-outline btn-sm" style="color:#b91c1c;border-color:#fca5a5;background:#fff;" onclick="clearAllAnnouncements()"><i class="fas fa-bullhorn"></i> Clear Announcements</button>
              <button type="button" class="btn btn-outline btn-sm" style="color:#b91c1c;border-color:#fca5a5;background:#fff;" onclick="clearFirewallEvents()"><i class="fas fa-shield-halved"></i> Clear Firewall Logs</button>
            </div>
          </div>
        </div>

        <!-- Right Column: Unified Role Theme Studio -->
        <div class="card settings-sticky-card gs-card-section" data-gs-sec="brand">
          <div class="card-header" style="border-bottom:1px solid #eef2f6;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div class="card-title">
              <i class="fas fa-palette" style="color:var(--theme-btn-primary,#2563eb);margin-right:6px;"></i> Role Theme Studio
            </div>
            <span class="badge" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-weight:700;font-size:11px;padding:4px 9px;">
              4-Role Unified System
            </span>
          </div>

          <!-- 1. Live Interactive Mini-Panel Preview -->
          <div style="margin-bottom:18px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <span style="font-size:11px; text-transform:uppercase; letter-spacing:0.8px; color:#475569; font-weight:800;">
                <i class="fas fa-eye" style="margin-right:4px;"></i> Live Component Preview
              </span>
              <span id="gs-preview-label" style="font-size:11px; font-weight:700; color:var(--theme-btn-primary,#2563eb);">Active Default: ${escapeHtml(activeTheme.name)}</span>
            </div>

            <div id="gs-preview-shell" style="border-radius:10px; overflow:hidden; border:1px solid #cbd5e1; background:#f8fafc;">
              <!-- Mini Topbar -->
              <div id="gs-prev-topbar" style="height:40px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; background:${activeTheme.structure_bg}; color:${activeTheme.structure_text}; border-bottom:1px solid ${activeTheme.structure_border || '#e2e8f0'};">
                <div style="display:flex; align-items:center; gap:8px;">
                  <img id="preview-bar-logo" src="${escapeHtml(curLogo)}" alt="Logo" style="height:22px; width:22px; border-radius:50%; background:#fff; padding:1px; object-fit:contain;">
                  <span id="preview-bar-title" style="font-weight:800; font-size:12.5px;">${escapeHtml(curSiteName)}</span>
                </div>
                <span style="font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:999px; background:${activeTheme.structure_item_bg || 'rgba(0,0,0,0.08)'};">Owner Panel</span>
              </div>

              <div style="display:grid; grid-template-columns:130px 1fr; min-height:142px;">
                <!-- Mini Sidebar -->
                <div id="gs-prev-sidebar" style="background:${activeTheme.structure_side_bg || activeTheme.structure_bg}; color:${activeTheme.structure_text}; padding:8px; border-right:1px solid ${activeTheme.structure_border || '#e2e8f0'}; display:flex; flex-direction:column; gap:5px;">
                  <div id="gs-prev-nav-active" style="padding:6px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${activeTheme.primary_btn}; color:${activeTheme.primary_btn_text};">
                    <i class="fas fa-gauge-high" style="margin-right:4px;"></i> Dashboard
                  </div>
                  <div id="gs-prev-nav-item" style="padding:6px 8px; border-radius:6px; font-size:11px; font-weight:600; background:${activeTheme.structure_item_bg || 'rgba(255,255,255,0.08)'};">
                    <i class="fas fa-comment-sms" style="margin-right:4px;"></i> SMS Reports
                  </div>
                  <div style="padding:6px 8px; border-radius:6px; font-size:11px; opacity:0.82;">
                    <i class="fas fa-user" style="margin-right:4px;"></i> My Profile
                  </div>
                </div>

                <!-- Mini White Workspace Canvas + Unified Buttons + Table Header -->
                <div style="background:#ffffff; padding:10px; display:flex; flex-direction:column; gap:8px;">
                  <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <span id="gs-prev-btn-pri" style="font-size:10.5px; font-weight:700; padding:4px 9px; border-radius:6px; background:${activeTheme.primary_btn}; color:${activeTheme.primary_btn_text};">Submit / Save</span>
                    <span id="gs-prev-btn-warn" style="font-size:10.5px; font-weight:700; padding:4px 9px; border-radius:6px; background:${activeTheme.warning_btn}; color:${activeTheme.warning_btn_text};">Export CSV</span>
                    <span id="gs-prev-btn-dng" style="font-size:10.5px; font-weight:700; padding:4px 9px; border-radius:6px; background:${activeTheme.danger_btn}; color:#ffffff;">Delete</span>
                    <span style="font-size:10.5px; font-weight:700; padding:4px 9px; border-radius:6px; background:#ffffff; color:#334155; border:1px solid #cbd5e1;">Reset</span>
                  </div>
                  <div style="border:1px solid #e2e8f0; border-radius:6px; overflow:hidden;">
                    <div id="gs-prev-th" style="background:${activeTheme.structure_table_bg}; color:${activeTheme.structure_table_text}; padding:5px 8px; font-size:10.5px; font-weight:700; display:grid; grid-template-columns:1fr 1fr 1fr;">
                      <span>DATE</span><span>RANGE</span><span>STATUS</span>
                    </div>
                    <div style="background:#ffffff; color:#334155; padding:5px 8px; font-size:10.5px; display:grid; grid-template-columns:1fr 1fr 1fr; border-top:1px solid #f1f5f9;">
                      <span>Today</span><span>UK O2</span><span>Success</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. Owner-Published Role Themes Catalog -->
          <div style="margin-bottom:18px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <div>
                <div style="font-size:13.5px; font-weight:800; color:#0f172a;">Published Role Themes Catalog</div>
                <div style="font-size:11.5px; color:#64748b;">Agents &amp; Clients pick only from these published themes in their My Profile page.</div>
              </div>
              <button type="button" class="btn btn-outline btn-sm" onclick="gsResetLivePreview()">
                <i class="fas fa-rotate-left"></i> End Live Preview
              </button>
            </div>
            <div id="gs-role-catalog-grid" class="gs-role-studio-grid"></div>
          </div>

          <!-- 3. Create / Edit Custom Role Theme -->
          <div style="border-top:1px solid #eef2f6; padding-top:16px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
              <div>
                <div id="gs-builder-heading" style="font-size:13.5px; font-weight:800; color:#0f172a;"><i class="fas fa-wand-magic-sparkles" style="color:var(--theme-btn-primary,#2563eb);margin-right:5px;"></i> Create / Customize Role Theme</div>
                <div style="font-size:11.5px; color:#64748b;">Cards &amp; workspace stay crisp white; set Structure, Primary Buttons, Warning/Export, and Danger colors cleanly.</div>
              </div>
              <span id="gs-wcag-badge" class="badge" style="font-size:11px; padding:3px 8px;">WCAG AA Check</span>
            </div>

            <div class="form-group" style="margin-bottom:10px;">
              <label class="form-label" style="font-size:12px; font-weight:700;">Theme Name *</label>
              <input type="text" id="gs-build-name" placeholder="e.g. Royal Ocean Executive" value="">
            </div>

            <div class="settings-subgrid-2" style="gap:10px; margin-bottom:10px;">
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px;">
                <label class="form-label" style="font-size:11.5px; font-weight:700; margin-bottom:5px; display:block;">1. Structure (Topbar, Sidebar &amp; Borders)</label>
                <div style="display:flex; gap:6px; align-items:center;">
                  <input type="color" id="gs-build-struct" value="${activeTheme.structure_bg}" oninput="gsSyncBuilderHex('struct', this.value)" style="width:36px; height:32px; padding:2px; border-radius:6px; border:1px solid #cbd5e1; cursor:pointer;">
                  <input type="text" id="gs-build-struct-hex" value="${activeTheme.structure_bg}" oninput="gsSyncBuilderColor('struct', this.value)" style="flex:1; font-family:monospace; font-size:12px; height:32px;">
                </div>
              </div>

              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px;">
                <label class="form-label" style="font-size:11.5px; font-weight:700; margin-bottom:5px; display:block;">Table Header (&lt;thead&gt; / &lt;th&gt;)</label>
                <div style="display:flex; gap:6px; align-items:center;">
                  <input type="color" id="gs-build-table" value="${activeTheme.structure_table_bg}" oninput="gsSyncBuilderHex('table', this.value)" style="width:36px; height:32px; padding:2px; border-radius:6px; border:1px solid #cbd5e1; cursor:pointer;">
                  <input type="text" id="gs-build-table-hex" value="${activeTheme.structure_table_bg}" oninput="gsSyncBuilderColor('table', this.value)" style="flex:1; font-family:monospace; font-size:12px; height:32px;">
                </div>
              </div>

              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px;">
                <label class="form-label" style="font-size:11.5px; font-weight:700; margin-bottom:5px; display:block;">2. Primary Action Buttons</label>
                <div style="display:flex; gap:6px; align-items:center;">
                  <input type="color" id="gs-build-primary" value="${activeTheme.primary_btn}" oninput="gsSyncBuilderHex('primary', this.value)" style="width:36px; height:32px; padding:2px; border-radius:6px; border:1px solid #cbd5e1; cursor:pointer;">
                  <input type="text" id="gs-build-primary-hex" value="${activeTheme.primary_btn}" oninput="gsSyncBuilderColor('primary', this.value)" style="flex:1; font-family:monospace; font-size:12px; height:32px;">
                </div>
              </div>

              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px;">
                <label class="form-label" style="font-size:11.5px; font-weight:700; margin-bottom:5px; display:block;">3. Warning / Export Buttons</label>
                <div style="display:flex; gap:6px; align-items:center;">
                  <input type="color" id="gs-build-warn" value="${activeTheme.warning_btn}" oninput="gsSyncBuilderHex('warn', this.value)" style="width:36px; height:32px; padding:2px; border-radius:6px; border:1px solid #cbd5e1; cursor:pointer;">
                  <input type="text" id="gs-build-warn-hex" value="${activeTheme.warning_btn}" oninput="gsSyncBuilderColor('warn', this.value)" style="flex:1; font-family:monospace; font-size:12px; height:32px;">
                </div>
              </div>
            </div>

            <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-bottom:12px;">
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px; flex:1; min-width:190px;">
                <label class="form-label" style="font-size:11.5px; font-weight:700; margin-bottom:5px; display:block;">4. Danger / Destructive Buttons</label>
                <div style="display:flex; gap:6px; align-items:center;">
                  <input type="color" id="gs-build-danger" value="${activeTheme.danger_btn}" oninput="gsSyncBuilderHex('danger', this.value)" style="width:36px; height:32px; padding:2px; border-radius:6px; border:1px solid #cbd5e1; cursor:pointer;">
                  <input type="text" id="gs-build-danger-hex" value="${activeTheme.danger_btn}" oninput="gsSyncBuilderColor('danger', this.value)" style="flex:1; font-family:monospace; font-size:12px; height:32px;">
                </div>
              </div>
              <button type="button" class="btn btn-outline" onclick="gsPreviewBuilderTheme()">
                <i class="fas fa-eye"></i> Preview Draft Live
              </button>
              <button type="button" class="btn btn-primary" onclick="gsSaveCustomRoleTheme()">
                <i class="fas fa-plus-circle"></i> Save Theme to Catalog
              </button>
            </div>
          </div>

          <!-- 4. Global Typography & Default Display Mode -->
          <div style="border-top:1px solid #eef2f6; padding-top:14px;">
            <div class="settings-subgrid-2" style="gap:10px;">
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px;">
                <label class="form-label" style="font-size:12px; font-weight:700; margin-bottom:6px; display:block;">Global Font Family</label>
                <select id="s-font-family" onchange="previewFontFamily(this.value)" style="font-size:13px; padding:6px 10px; width:100%; border-radius:6px; border:1px solid #cbd5e1; height:36px;">
                  ${fontOptions.map(f => `<option value="${f.key}" ${curFont === f.key ? 'selected' : ''}>${f.name}</option>`).join('')}
                </select>
              </div>
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px;">
                <span style="font-size:12px; font-weight:700; color:#334155; display:block; margin-bottom:8px;">System Default Display Mode</span>
                <div style="display:flex; gap:14px; align-items:center;">
                  <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:12.5px; font-weight:600;">
                    <input type="radio" name="s-theme-mode" value="light" ${(!data.theme_mode || data.theme_mode === 'light') ? 'checked' : ''}>
                    <i class="fas fa-sun" style="color:#f59e0b;"></i> Light
                  </label>
                  <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:12.5px; font-weight:600;">
                    <input type="radio" name="s-theme-mode" value="dark" ${data.theme_mode === 'dark' ? 'checked' : ''}>
                    <i class="fas fa-moon" style="color:#64748b;"></i> Dark
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div style="margin-top:16px; text-align:right;">
            <button type="button" class="btn btn-primary" onclick="saveSettings()" style="padding:10px 24px; font-size:14px; font-weight:700;"><i class="fas fa-save"></i> Save All Appearance Settings</button>
          </div>
        </div>
      </div>
    `;

    window._roleThemeCatalog = catalog;
    gsRenderCatalogCards(catalog);
    gsUpdateLiveRolePreview(activeTheme);
  } catch (err) {
    console.error('General settings error:', err);
    toast('Failed to load settings', 'error');
  }
}

window.switchGsSectionTab = function(tab, btn) {
  document.querySelectorAll('#gs-section-tabs .gs-subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const grid = document.getElementById('gs-main-grid');
  if (grid) {
    grid.style.gridTemplateColumns = (tab === 'rates' || tab === 'system') ? '1fr' : '';
  }
  document.querySelectorAll('.gs-card-section').forEach(el => {
    const sec = el.getAttribute('data-gs-sec');
    if (tab === 'all' || sec === tab) el.classList.remove('gs-hidden');
    else el.classList.add('gs-hidden');
  });
};

function gsRenderCatalogCards(catalog) {
  const host = document.getElementById('gs-role-catalog-grid');
  if (!host) return;
  const list = Array.isArray(catalog) ? catalog : (window._roleThemeCatalog || []);
  host.innerHTML = list.map(t => {
    const isActive = t.key === _gsSelectedDefaultThemeKey;
    const isProtected = Boolean(t.is_builtin) || isActive;
    return `
      <div class="gs-role-theme-card ${isActive ? 'active' : ''}" data-theme-key="${escapeHtml(t.key)}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:6px;">
          <div style="min-width:0; flex:1;">
            <div style="font-size:12.5px; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
            <div style="font-size:10.5px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(t.description || '')}">${escapeHtml(t.description || '')}</div>
          </div>
          ${t.is_builtin
            ? '<span class="badge" style="background:#f1f5f9;color:#334155;font-size:9.5px;padding:2px 6px;">Built-in</span>'
            : '<span class="badge" style="background:#dbeafe;color:#1d4ed8;font-size:9.5px;padding:2px 6px;">Custom</span>'}
        </div>
        <div class="zy-pro-swatch-strip" style="margin-bottom:8px;">
          <span title="Structure" style="background:${escapeHtml(t.structure_bg)};"></span>
          <span title="Table Header" style="background:${escapeHtml(t.structure_table_bg)};"></span>
          <span title="Primary CTA" style="background:${escapeHtml(t.primary_btn)};"></span>
          <span title="Warning / Export" style="background:${escapeHtml(t.warning_btn)};"></span>
          <span title="Danger" style="background:${escapeHtml(t.danger_btn)};"></span>
        </div>
        <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
          <button type="button" class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}" onclick="gsSetDefaultRoleTheme('${escapeHtml(t.key)}')" style="font-size:10.5px; padding:4px 8px;">
            <i class="fas ${isActive ? 'fa-check-circle' : 'fa-star'}"></i> ${isActive ? 'Active Default' : 'Set Default'}
          </button>
          <button type="button" class="btn btn-sm btn-outline" onclick="gsPreviewRoleTheme('${escapeHtml(t.key)}')" style="font-size:10.5px; padding:4px 8px;" title="Live preview without saving">
            <i class="fas fa-eye"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline" onclick="gsLoadRoleThemeBuilder('${escapeHtml(t.key)}')" style="font-size:10.5px; padding:4px 8px;" title="Load into custom builder">
            <i class="fas fa-pen"></i>
          </button>
          ${!isProtected ? `
            <button type="button" class="btn btn-sm btn-danger" onclick="gsDeleteRoleTheme('${escapeHtml(t.key)}', '${escapeHtml(t.name).replace(/'/g, "\\'")}')" style="font-size:10.5px; padding:4px 8px;" title="Delete custom theme">
              <i class="fas fa-trash-alt"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function gsReadBuilderTheme() {
  const name = document.getElementById('gs-build-name')?.value?.trim() || 'Custom Role Theme';
  const structure_bg = document.getElementById('gs-build-struct')?.value || '#0f172a';
  const structure_table_bg = document.getElementById('gs-build-table')?.value || '#1e293b';
  const primary_btn = document.getElementById('gs-build-primary')?.value || '#2563eb';
  const warning_btn = document.getElementById('gs-build-warn')?.value || '#d97706';
  const danger_btn = document.getElementById('gs-build-danger')?.value || '#dc2626';
  if (window.BrandTheme && typeof window.BrandTheme.buildRoleTheme === 'function') {
    return window.BrandTheme.buildRoleTheme({
      key: _gsEditingThemeKey || undefined,
      name,
      structure_bg,
      structure_table_bg,
      primary_btn,
      warning_btn,
      danger_btn
    }, false);
  }
  return { key: _gsEditingThemeKey || ('custom_' + Date.now()), name, structure_bg, structure_table_bg, primary_btn, warning_btn, danger_btn };
}

function gsUpdateLiveRolePreview(themeObj) {
  const th = themeObj || gsReadBuilderTheme();
  const siteName = document.getElementById('s-site-name')?.value?.trim() || 'HUMAX SMS';
  const barTitle = document.getElementById('preview-bar-title');
  if (barTitle) barTitle.textContent = siteName;

  const topbar = document.getElementById('gs-prev-topbar');
  if (topbar) {
    topbar.style.background = th.structure_bg;
    topbar.style.color = th.structure_text || '#0f172a';
    topbar.style.borderBottomColor = th.structure_border || '#e2e8f0';
  }
  const sidebar = document.getElementById('gs-prev-sidebar');
  if (sidebar) {
    sidebar.style.background = th.structure_side_bg || th.structure_bg;
    sidebar.style.color = th.structure_text || '#0f172a';
    sidebar.style.borderRightColor = th.structure_border || '#e2e8f0';
  }
  const navActive = document.getElementById('gs-prev-nav-active');
  if (navActive) {
    navActive.style.background = th.primary_btn;
    navActive.style.color = th.primary_btn_text || '#ffffff';
  }
  const navItem = document.getElementById('gs-prev-nav-item');
  if (navItem) {
    navItem.style.background = th.structure_item_bg || 'rgba(0,0,0,0.06)';
  }
  const btnPri = document.getElementById('gs-prev-btn-pri');
  if (btnPri) {
    btnPri.style.background = th.primary_btn;
    btnPri.style.color = th.primary_btn_text || '#ffffff';
  }
  const btnWarn = document.getElementById('gs-prev-btn-warn');
  if (btnWarn) {
    btnWarn.style.background = th.warning_btn;
    btnWarn.style.color = th.warning_btn_text || '#ffffff';
  }
  const btnDng = document.getElementById('gs-prev-btn-dng');
  if (btnDng) {
    btnDng.style.background = th.danger_btn;
  }
  const thEl = document.getElementById('gs-prev-th');
  if (thEl) {
    thEl.style.background = th.structure_table_bg;
    thEl.style.color = th.structure_table_text || '#334155';
  }

  // Update WCAG AA badge
  const wcagEl = document.getElementById('gs-wcag-badge');
  if (wcagEl && window.BrandTheme && typeof window.BrandTheme.contrastRatio === 'function') {
    const structRatio = window.BrandTheme.contrastRatio(th.structure_bg, th.structure_text || '#0f172a');
    const ctaRatio = window.BrandTheme.contrastRatio(th.primary_btn, th.primary_btn_text || '#ffffff');
    const minRatio = Math.min(structRatio, ctaRatio);
    const passAA = minRatio >= 4.5;
    wcagEl.textContent = `Contrast ${minRatio}:1 (${passAA ? 'WCAG AA Pass' : 'Low Contrast'})`;
    wcagEl.style.background = passAA ? '#dcfce7' : '#fef3c7';
    wcagEl.style.color = passAA ? '#166534' : '#92400e';
    wcagEl.style.border = `1px solid ${passAA ? '#86efac' : '#fcd34d'}`;
  }
}

function gsSyncBuilderHex(field, hex) {
  const hexEl = document.getElementById(`gs-build-${field}-hex`);
  if (hexEl) hexEl.value = String(hex || '').toLowerCase();
  gsUpdateLiveRolePreview(gsReadBuilderTheme());
}

function gsSyncBuilderColor(field, hex) {
  if (/^#[0-9a-fA-F]{6}$/.test(String(hex || '').trim())) {
    const colEl = document.getElementById(`gs-build-${field}`);
    if (colEl) colEl.value = hex.trim().toLowerCase();
    gsUpdateLiveRolePreview(gsReadBuilderTheme());
  }
}

function gsSetDefaultRoleTheme(key) {
  const found = (window._roleThemeCatalog || []).find(t => t.key === key);
  if (!found) return;
  _gsSelectedDefaultThemeKey = key;
  gsRenderCatalogCards(window._roleThemeCatalog);
  gsUpdateLiveRolePreview(found);
  const lbl = document.getElementById('gs-preview-label');
  if (lbl) lbl.textContent = `Selected Default: ${found.name} (Click Save All Settings to publish)`;
  if (window.BrandTheme && typeof window.BrandTheme.preview === 'function') {
    window.BrandTheme.preview(found);
  }
}

function gsPreviewRoleTheme(key) {
  const found = (window._roleThemeCatalog || []).find(t => t.key === key);
  if (!found) return;
  gsUpdateLiveRolePreview(found);
  const lbl = document.getElementById('gs-preview-label');
  if (lbl) lbl.textContent = `Live Preview: ${found.name}`;
  if (window.BrandTheme && typeof window.BrandTheme.preview === 'function') {
    window.BrandTheme.preview(found);
  }
}

function gsPreviewBuilderTheme() {
  const draft = gsReadBuilderTheme();
  gsUpdateLiveRolePreview(draft);
  const lbl = document.getElementById('gs-preview-label');
  if (lbl) lbl.textContent = `Draft Preview: ${draft.name}`;
  if (window.BrandTheme && typeof window.BrandTheme.preview === 'function') {
    window.BrandTheme.preview(draft);
  }
}

function gsResetLivePreview() {
  if (window.BrandTheme && typeof window.BrandTheme.preview === 'function') {
    window.BrandTheme.preview(null);
  }
  const active = (window._roleThemeCatalog || []).find(t => t.key === _gsSelectedDefaultThemeKey);
  if (active) gsUpdateLiveRolePreview(active);
  const lbl = document.getElementById('gs-preview-label');
  if (lbl && active) lbl.textContent = `Active Default: ${active.name}`;
}

function gsLoadRoleThemeBuilder(key) {
  const found = (window._roleThemeCatalog || []).find(t => t.key === key);
  if (!found) return;
  _gsEditingThemeKey = found.is_builtin ? '' : found.key;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('gs-build-name', found.is_builtin ? `${found.name} Copy` : found.name);
  setVal('gs-build-struct', found.structure_bg);
  setVal('gs-build-struct-hex', found.structure_bg);
  setVal('gs-build-table', found.structure_table_bg);
  setVal('gs-build-table-hex', found.structure_table_bg);
  setVal('gs-build-primary', found.primary_btn);
  setVal('gs-build-primary-hex', found.primary_btn);
  setVal('gs-build-warn', found.warning_btn);
  setVal('gs-build-warn-hex', found.warning_btn);
  setVal('gs-build-danger', found.danger_btn);
  setVal('gs-build-danger-hex', found.danger_btn);
  gsUpdateLiveRolePreview(found);
  toast(found.is_builtin ? `Cloned "${found.name}" into builder` : `Editing custom theme "${found.name}"`, 'info');
}

async function gsSaveCustomRoleTheme() {
  const name = document.getElementById('gs-build-name')?.value?.trim();
  if (!name) {
    toast('Please enter a Theme Name before saving to catalog.', 'error');
    document.getElementById('gs-build-name')?.focus();
    return;
  }
  const draft = gsReadBuilderTheme();
  const payload = {
    key: _gsEditingThemeKey || ('custom_' + Date.now()),
    name,
    structure_bg: draft.structure_bg,
    structure_table_bg: draft.structure_table_bg,
    primary_btn: draft.primary_btn,
    warning_btn: draft.warning_btn,
    danger_btn: draft.danger_btn
  };

  try {
    const res = await apiFetch('/api/settings/themes', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res && res.success) {
      toast(`Theme "${name}" published to catalog!`, 'success');
      if (res.settings && window.BrandTheme) {
        window.BrandTheme.apply(res.settings);
      }
      await renderGeneralSettings();
    } else {
      toast(res?.error || 'Failed to save theme to catalog', 'error');
    }
  } catch (err) {
    toast(err?.message || 'Failed to save theme', 'error');
  }
}

async function gsDeleteRoleTheme(key, name) {
  if (!confirm(`Delete custom theme "${name}"? Users on this theme will safely fall back to the active default.`)) {
    return;
  }
  try {
    const res = await apiFetch(`/api/settings/themes/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (res && res.success) {
      toast(`Custom theme "${name}" deleted`, 'success');
      if (res.settings && window.BrandTheme) {
        window.BrandTheme.apply(res.settings);
      }
      await renderGeneralSettings();
    } else {
      toast(res?.error || 'Could not delete theme', 'error');
    }
  } catch (err) {
    toast(err?.message || 'Could not delete theme', 'error');
  }
}

function previewFontFamily(fontKey) {
  if (window.BrandTheme && window.BrandTheme.fonts) {
    const def = window.BrandTheme.fonts[fontKey];
    if (def) {
      if (def.url && !document.getElementById('dynamic-google-font-' + fontKey)) {
        const link = document.createElement('link');
        link.id = 'dynamic-google-font-' + fontKey;
        link.rel = 'stylesheet';
        link.href = def.url;
        document.head.appendChild(link);
      }
      document.documentElement.style.setProperty('--app-font', def.family);
    }
  }
}

function resetDefaultLogo() {
  const def = '/static/img/humex-sms-logo.png';
  const logoInput = document.getElementById('s-logo-url');
  if (logoInput) logoInput.value = def;
  const previewImg = document.getElementById('logo-preview-img');
  if (previewImg) previewImg.src = def;
  const prevLogo = document.getElementById('preview-bar-logo');
  if (prevLogo) prevLogo.src = def;
  if (window.BrandTheme && typeof window.BrandTheme.apply === 'function') {
    window.BrandTheme.apply({ logo_url: def });
  }
  toast('Selected Official HUMAX SMS Logo. Click "Save All Settings" to apply.', 'info');
}

function setCircleLogo() {
  resetDefaultLogo();
}

// ── Logo Cropping System ──────────────────────────────────────────
let _pendingLogoOriginal = null;

function cropCurrentLogo() {
  const cur = document.getElementById('s-logo-url')?.value?.trim() || 
              document.getElementById('logo-preview-img')?.src || 
              '/static/img/humex-sms-logo.png';
  openLogoCropModal(cur, 'Current Logo');
}

async function directUploadLogo(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (file.size > 15 * 1024 * 1024) {
    toast('Image file too large (max 15MB)', 'error');
    e.target.value = '';
    return;
  }

  toast('Uploading picture directly into project...', 'info');
  const reader = new FileReader();
  reader.onload = async function(evt) {
    try {
      const dataUrl = evt.target.result;
      await uploadLogoData(dataUrl);
      toast('✅ Picture saved permanently inside project!', 'success');
    } catch(err) {
      toast('Upload failed: ' + err.message, 'error');
    }
    e.target.value = '';
  };
  reader.onerror = function() {
    toast('Could not read image file', 'error');
    e.target.value = '';
  };
  reader.readAsDataURL(file);
}

function handleLogoFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (file.size > 12 * 1024 * 1024) {
    toast('Image file too large (max 12MB)', 'error');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    const dataUrl = evt.target.result;
    openLogoCropModal(dataUrl, file.name);
    e.target.value = '';
  };
  reader.onerror = function() {
    toast('Could not read image file', 'error');
    e.target.value = '';
  };
  reader.readAsDataURL(file);
}

function openLogoCropModal(imageUrl, filename = 'Brand Logo') {
  _pendingLogoOriginal = imageUrl;
  _isCircleMode = true;

  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.classList.add('modal-lg');

  const siteName = document.getElementById('s-site-name')?.value || 'HUMAX SMS';
  
  const title = 'Crop & Frame Logo';

  const html = `
    <div class="studio-cropper-wrap">
      <!-- Left: Workspace & Controls -->
      <div>
        <!-- Mode Switcher & Aspect presets bar -->
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          <!-- Move vs Crop Mode Toggle -->
          <div class="studio-mode-pill">
            <button type="button" class="studio-mode-btn active" id="mode-btn-move" onclick="setStudioDragMode('move', this)">
              <i class="fas fa-arrows-alt"></i> <span>Pan</span>
            </button>
            <button type="button" class="studio-mode-btn" id="mode-btn-crop" onclick="setStudioDragMode('crop', this)">
              <i class="fas fa-vector-square"></i> <span>Frame</span>
            </button>
          </div>

          <!-- Stencil / Aspect Presets -->
          <div class="studio-aspect-group">
            <button type="button" class="studio-aspect-btn active" id="asp-circle" onclick="setStudioCircleMode(true, this)">
              <i class="fas fa-circle"></i> Round
            </button>
            <button type="button" class="studio-aspect-btn" id="asp-1-1" onclick="setStudioAspect(1, false, this)">
              <i class="fas fa-square"></i> 1:1
            </button>
            <button type="button" class="studio-aspect-btn" id="asp-3-1" onclick="setStudioAspect(3/1, false, this)">
              <i class="fas fa-window-maximize"></i> 3:1
            </button>
            <button type="button" class="studio-aspect-btn" id="asp-16-9" onclick="setStudioAspect(16/9, false, this)">
              <i class="fas fa-tv"></i> 16:9
            </button>
            <button type="button" class="studio-aspect-btn" id="asp-free" onclick="setStudioAspect(NaN, false, this)">
              <i class="fas fa-crop-alt"></i> Free
            </button>
          </div>
        </div>

        <!-- Main Studio Viewport (Native drag & Google Lens strictly blocked) -->
        <div class="studio-viewport cropper-circle-mode" id="studio-viewport"
             draggable="false"
             oncontextmenu="event.preventDefault(); return false;"
             ondragstart="event.preventDefault(); return false;"
             onselectstart="event.preventDefault(); return false;">
          <img id="cropper-image" src="${imageUrl}"
               draggable="false"
               oncontextmenu="event.preventDefault(); return false;"
               ondragstart="event.preventDefault(); return false;"
               alt="Logo Workspace"
               style="max-height:100%;max-width:100%;opacity:0;">
        </div>

        <!-- Zoom Slider & Control Dock -->
        <div class="studio-control-dock">
          <div class="studio-slider-wrap">
            <span style="font-size:11px;font-weight:700;color:#94a3b8;" title="Zoom Out"><i class="fas fa-search-minus"></i></span>
            <input type="range" class="studio-slider" id="studio-zoom-slider" min="0.2" max="3" step="0.01" value="1" oninput="onStudioZoomSlider(this.value)">
            <span style="font-size:11px;font-weight:700;color:#94a3b8;" title="Zoom In"><i class="fas fa-search-plus"></i></span>
            <span id="studio-zoom-val" class="studio-badge">100%</span>
          </div>

          <div style="display:flex;gap:5px;align-items:center;">
            <button type="button" class="studio-tool-btn" onclick="cropperRotate(-90)" title="Rotate Left 90°"><i class="fas fa-undo"></i> -90°</button>
            <button type="button" class="studio-tool-btn" onclick="cropperRotate(90)" title="Rotate Right 90°"><i class="fas fa-redo"></i> +90°</button>
            <button type="button" class="studio-tool-btn" onclick="cropperFlip('h')" title="Flip Horizontal"><i class="fas fa-arrows-alt-h"></i> Flip</button>
            <button type="button" class="studio-tool-btn" onclick="cropperReset()" title="Reset"><i class="fas fa-sync-alt"></i> Reset</button>
          </div>
        </div>

        <div style="font-size:11px;color:#94a3b8;margin-top:8px;display:flex;align-items:center;justify-content:flex-end;">
          <span id="cropper-dims" class="studio-badge" style="background:#0f172a;color:#38bdf8;">800 × 800 px</span>
        </div>
      </div>

      <!-- Right: Real-time Platform Previews -->
      <div>
        <div class="studio-previews-panel">
          <div style="font-size:12px;font-weight:700;color:#f8fafc;border-bottom:1px solid #1e293b;padding-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
            <span><i class="fas fa-eye" style="margin-right:5px;color:var(--brand-accent,#38bdf8);"></i> Live Previews</span>
          </div>

          <!-- Header Bar Look -->
          <div class="studio-preview-card">
            <div class="studio-preview-title">
              <span>Header</span>
              <span style="font-size:9px;color:#64748b;">Top bar</span>
            </div>
            <div style="background:var(--header-gradient, linear-gradient(180deg, #1b4332 0%, #143627 50%, #081c15 100%));padding:7px 10px;border-radius:6px;display:flex;align-items:center;gap:8px;box-shadow:0 2px 6px rgba(0,0,0,0.35);">
              <div style="height:32px;width:32px;background:#fff;border-radius:50%;padding:2px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,0.2);">
                <img id="crop-prev-hdr" style="max-height:100%;max-width:100%;object-fit:contain;" alt="Header Preview">
              </div>
              <span style="color:var(--header-text-color,#fff);font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${siteName}</span>
            </div>
          </div>

          <!-- Sidebar Avatar Look (Circle) -->
          <div class="studio-preview-card">
            <div class="studio-preview-title">
              <span>Profile Avatar</span>
              <span style="font-size:9px;color:#64748b;">Circle</span>
            </div>
            <div style="background:#030712;padding:12px;border-radius:6px;display:flex;align-items:center;justify-content:center;border:1px dashed #1e293b;">
              <div style="width:62px;height:62px;border-radius:50%;border:2px solid var(--brand-accent,#38bdf8);overflow:hidden;background:#ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px rgba(56,189,248,0.3);padding:3px;">
                <img id="crop-prev-circle" style="max-height:100%;max-width:100%;object-fit:contain;" alt="Circle Preview">
              </div>
            </div>
          </div>

          <!-- Favicon / App Icon -->
          <div class="studio-preview-card">
            <div class="studio-preview-title">
              <span>App Icon</span>
              <span style="font-size:9px;color:#64748b;">Square</span>
            </div>
            <div style="background:#0f172a;padding:10px;border-radius:6px;display:flex;align-items:center;justify-content:center;gap:12px;">
              <div style="width:44px;height:44px;border-radius:8px;background:#ffffff;border:1px solid #334155;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:3px;box-shadow:0 2px 6px rgba(0,0,0,0.25);">
                <img id="crop-prev-square" style="max-height:100%;max-width:100%;object-fit:contain;" alt="Square Preview">
              </div>
              <div style="font-size:11px;color:#94a3b8;line-height:1.4;">
                <div style="color:#f8fafc;font-weight:600;">Browser Tab</div>
                <div style="font-size:10px;">Generated</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Footer Actions -->
    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid #1e293b;padding-top:14px;margin-top:16px;">
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-outline btn-sm" onclick="applyOriginalLogo()" style="color:#94a3b8;border-color:#334155;">
          <i class="fas fa-image" style="margin-right:4px;"></i> Use Original
        </button>
      </div>
      <div style="display:flex;gap:10px;">
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()" style="border-color:#334155;color:#cbd5e1;">Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" id="btn-apply-crop" onclick="applyCroppedLogo()" style="font-weight:600;padding:8px 20px;">
          <i class="fas fa-check-circle" style="margin-right:6px;"></i> Apply & Save
        </button>
      </div>
    </div>
  `;

  openModal(title, html);

  setTimeout(() => {
    initCropperInstance();
  }, 120);
}

function initCropperInstance() {
  if (window._logoCropper) {
    try { window._logoCropper.destroy(); } catch(e){}
    window._logoCropper = null;
  }

  const imgEl = document.getElementById('cropper-image');
  if (!imgEl) return;

  imgEl.setAttribute('draggable', 'false');
  imgEl.oncontextmenu = () => false;
  imgEl.ondragstart = () => false;

  if (typeof Cropper === 'undefined') {
    imgEl.style.opacity = '1';
    toast('Cropper ready', 'info');
    return;
  }

  window._logoCropper = new Cropper(imgEl, {
    aspectRatio: 1,
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 0.85,
    restore: false,
    guides: true,
    center: true,
    highlight: false,
    cropBoxMovable: true,
    cropBoxResizable: true,
    toggleDragModeOnDblclick: false,
    ready: function() {
      imgEl.style.opacity = '1';
      const vp = document.getElementById('studio-viewport');
      if (vp && _isCircleMode) vp.classList.add('cropper-circle-mode');

      try {
        const canvasData = window._logoCropper.getCanvasData();
        const initialRatio = (canvasData.width && canvasData.naturalWidth) ? 
                             (canvasData.width / canvasData.naturalWidth) : 1;
        _initialZoomRatio = initialRatio || 1;
        const slider = document.getElementById('studio-zoom-slider');
        if (slider) {
          slider.min = (initialRatio * 0.3).toFixed(3);
          slider.max = (initialRatio * 4.0).toFixed(3);
          slider.value = initialRatio.toFixed(3);
        }
      } catch(e) {}

      updateCropperPreviews();
    },
    zoom: function(e) {
      const slider = document.getElementById('studio-zoom-slider');
      const zoomBadge = document.getElementById('studio-zoom-val');
      if (slider && e.detail && e.detail.ratio) {
        slider.value = e.detail.ratio.toFixed(3);
        if (zoomBadge && _initialZoomRatio) {
          zoomBadge.textContent = Math.round((e.detail.ratio / _initialZoomRatio) * 100) + '%';
        }
      }
    },
    crop: function() {
      updateCropperPreviews();
    }
  });
}

function setStudioDragMode(mode, btn) {
  if (!window._logoCropper) return;
  window._logoCropper.setDragMode(mode);
  document.querySelectorAll('.studio-mode-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function setStudioCircleMode(isCircle, btn) {
  _isCircleMode = !!isCircle;
  const vp = document.getElementById('studio-viewport');
  if (vp) {
    if (_isCircleMode) vp.classList.add('cropper-circle-mode');
    else vp.classList.remove('cropper-circle-mode');
  }
  if (window._logoCropper) {
    window._logoCropper.setAspectRatio(1);
  }
  document.querySelectorAll('.studio-aspect-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  updateCropperPreviews();
}

function setStudioAspect(ratio, isCircle, btn) {
  _isCircleMode = !!isCircle;
  const vp = document.getElementById('studio-viewport');
  if (vp) vp.classList.remove('cropper-circle-mode');
  if (window._logoCropper) {
    window._logoCropper.setAspectRatio(ratio);
  }
  document.querySelectorAll('.studio-aspect-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  updateCropperPreviews();
}

function onStudioZoomSlider(val) {
  if (!window._logoCropper) return;
  const num = parseFloat(val);
  const zoomBadge = document.getElementById('studio-zoom-val');
  if (zoomBadge && _initialZoomRatio) {
    zoomBadge.textContent = Math.round((num / _initialZoomRatio) * 100) + '%';
  }
  window._logoCropper.zoomTo(num);
}

function cropperRotate(deg) {
  if (window._logoCropper) window._logoCropper.rotate(deg);
}

let _cropFlipH = 1;
function cropperFlip(dir) {
  if (!window._logoCropper) return;
  _cropFlipH = -_cropFlipH;
  window._logoCropper.scaleX(_cropFlipH);
}

function cropperReset() {
  if (!window._logoCropper) return;
  _cropFlipH = 1;
  window._logoCropper.reset();
  setStudioCircleMode(true, document.getElementById('asp-circle'));
  setStudioDragMode('move', document.getElementById('mode-btn-move'));
}

function updateCropperPreviews() {
  if (!window._logoCropper) return;
  try {
    const data = window._logoCropper.getData(true);
    const dimsEl = document.getElementById('cropper-dims');
    if (dimsEl) {
      dimsEl.textContent = `${Math.round(data.width)} × ${Math.round(data.height)} px`;
    }

    const canvas = window._logoCropper.getCroppedCanvas({
      maxWidth: 300,
      maxHeight: 300,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'medium'
    });
    if (!canvas) return;

    let finalCanvas = canvas;
    if (_isCircleMode) {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      const ctx = c.getContext('2d');
      ctx.beginPath();
      ctx.arc(c.width / 2, c.height / 2, Math.min(c.width, c.height) / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(canvas, 0, 0);
      finalCanvas = c;
    }

    const url = finalCanvas.toDataURL('image/png');
    const pHdr = document.getElementById('crop-prev-hdr');
    const pCir = document.getElementById('crop-prev-circle');
    const pSqr = document.getElementById('crop-prev-square');
    if (pHdr) pHdr.src = url;
    if (pCir) pCir.src = url;
    if (pSqr) pSqr.src = url;
  } catch(e) {}
}

async function applyCroppedLogo() {
  if (!window._logoCropper) {
    applyOriginalLogo();
    return;
  }

  const applyBtn = document.getElementById('btn-apply-crop');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing & Uploading...';
  }

  try {
    let canvas = window._logoCropper.getCroppedCanvas({
      maxWidth: 480,
      maxHeight: 480,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    if (!canvas) throw new Error('Could not generate cropped image');

    if (_isCircleMode) {
      const circleCanvas = document.createElement('canvas');
      circleCanvas.width = canvas.width;
      circleCanvas.height = canvas.height;
      const ctx = circleCanvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(canvas, 0, 0);
      canvas = circleCanvas;
    }

    const base64Data = canvas.toDataURL('image/png');
    await uploadLogoData(base64Data);
    closeModal();
  } catch(err) {
    console.error('Crop save error:', err);
    toast('Failed to apply cropped logo: ' + err.message, 'error');
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Apply & Save';
    }
  }
}

async function applyOriginalLogo() {
  if (!_pendingLogoOriginal) return;
  toast('Uploading original logo...', 'info');
  try {
    const optimized = await optimizeBase64Image(_pendingLogoOriginal, 480);
    await uploadLogoData(optimized);
    closeModal();
  } catch(err) {
    toast('Failed to upload logo: ' + err.message, 'error');
  }
}

async function optimizeBase64Image(dataUrl, maxDim = 480) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return resolve(dataUrl);
    }
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(maxDim / Math.max(width, 1), maxDim / Math.max(height, 1), 1);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const cvs = document.createElement('canvas');
      cvs.width = width;
      cvs.height = height;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(cvs.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function uploadLogoData(base64Data) {
  const prevLogo = document.getElementById('preview-bar-logo');
  const previewImg = document.getElementById('logo-preview-img');
  if (previewImg) previewImg.src = base64Data;
  if (prevLogo) prevLogo.src = base64Data;

  const optimizedData = await optimizeBase64Image(base64Data, 480);

  const res = await apiFetch('/api/settings/upload-logo', {
    method: 'POST',
    body: JSON.stringify({ image: optimizedData })
  });

  if (res && res.success && res.logo_url) {
    const sLogo = document.getElementById('s-logo-url');
    if (sLogo) sLogo.value = res.logo_url;
    if (previewImg) previewImg.src = res.logo_url;
    if (prevLogo) prevLogo.src = res.logo_url;
    toast('✅ Logo uploaded successfully!', 'success');
    if (window.BrandTheme) {
      window.BrandTheme.apply({ logo_url: res.logo_url });
    }
  } else {
    throw new Error(res?.error || 'Server rejected logo upload');
  }
}

async function saveSettings(event) {
  if (event) event.preventDefault();

  try {
    const selectedMode = document.querySelector('input[name="s-theme-mode"]:checked')?.value || 'light';
    const selectedFont = document.getElementById('s-font-family')?.value || 'system';
    const siteName = document.getElementById('s-site-name')?.value?.trim() || 'HUMAX SMS';
    const tagline = document.getElementById('s-tagline')?.value?.trim() || '';
    const logoUrl = document.getElementById('s-logo-url')?.value?.trim() || '/static/img/humex-sms-logo.png';
    const footerText = document.getElementById('s-footer-text')?.value?.trim() || `© ${new Date().getFullYear()} ${siteName}. All rights reserved.`;

    const payload = {
      site_name: siteName,
      tagline: tagline,
      logo_url: logoUrl,
      default_theme_key: _gsSelectedDefaultThemeKey || 'daylight_cobalt',
      theme_mode: selectedMode,
      font_family: selectedFont,
      footer_text: footerText,
      otp_limit: parseInt(document.getElementById('s-otp-limit')?.value) || 5,
      payout_rate: parseFloat(document.getElementById('s-payout-rate')?.value) || 0.85,
      min_payout: parseFloat(document.getElementById('s-min-payout')?.value) || 50,
      default_currency: document.getElementById('s-currency')?.value || 'USD',
      timezone: document.getElementById('s-timezone')?.value || 'UTC',
      admin_email: document.getElementById('s-admin-email')?.value?.trim() || '',
      maintenance_mode: document.getElementById('s-maintenance')?.checked || false,
      payterms: (document.getElementById('s-payterms')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
      agent_alloc_mode: document.getElementById('s-agent-alloc-mode')?.value || 'request',
      agent_alloc_daily_limit: Math.max(0, parseInt(document.getElementById('s-agent-alloc-daily')?.value, 10) || 0),
      agent_alloc_total_limit: Math.max(0, parseInt(document.getElementById('s-agent-alloc-total')?.value, 10) || 0),
      client_alloc_mode: document.getElementById('s-client-alloc-mode')?.value || 'request',
      client_alloc_daily_limit: Math.max(0, parseInt(document.getElementById('s-client-alloc-daily')?.value, 10) || 0),
      client_alloc_total_limit: Math.max(0, parseInt(document.getElementById('s-client-alloc-total')?.value, 10) || 0),
      allow_agent_alloc_config: document.getElementById('s-allow-ag-alloc')?.checked !== false
    };

    const fxEl = document.getElementById('s-usd-to-pkr');
    if (fxEl) {
      const fxVal = parseFloat(fxEl.value);
      if (!Number.isFinite(fxVal) || fxVal <= 0 || fxVal > 100000) {
        toast('USD to PKR FX rate must be between 0.01 and 100,000.', 'error');
        return;
      }
      payload.usd_to_pkr_rate = Math.round(fxVal * 100) / 100;
    }
    const minPkrEl = document.getElementById('s-min-payout-pkr');
    if (minPkrEl && minPkrEl.value !== '') {
      const mpPkr = parseFloat(minPkrEl.value);
      if (!Number.isFinite(mpPkr) || mpPkr < 0) {
        toast('Client Minimum Payout (PKR) must be 0 or greater.', 'error');
        return;
      }
      payload.min_payout_pkr = Math.round(mpPkr * 100) / 100;
    }
    const mcStart = document.getElementById('s-mc-start')?.value || '';
    const mcEnd = document.getElementById('s-mc-end')?.value || '';
    const mcClear = document.getElementById('s-mc-clear')?.value || '';
    if (mcStart && mcEnd && mcClear) {
      payload.monthly_cycle = { start_date: mcStart, end_date: mcEnd, clear_date: mcClear };
    }

    const result = await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(payload) });

    if (result) {
      toast('All settings saved successfully!', 'success');
      const savedSettings = (result && result.settings) ? result.settings : result;
      try {
        let bs = JSON.parse(localStorage.getItem('app_brand_settings') || '{}');
        bs = { ...bs, ...savedSettings };
        localStorage.setItem('app_brand_settings', JSON.stringify(bs));
        if (window.__BRAND_SETTINGS__) {
          window.__BRAND_SETTINGS__ = { ...window.__BRAND_SETTINGS__, ...savedSettings };
        }
      } catch (e) {}

      if (window.BrandTheme) {
        window.BrandTheme.preview(null);
        window.BrandTheme.apply(savedSettings);
      }
      if (typeof window.zyUpdateClockLive === 'function') {
        window.zyUpdateClockLive();
      }
      zyUpdateFxPreview();
      if (Array.isArray(savedSettings.theme_catalog)) {
        window._roleThemeCatalog = savedSettings.theme_catalog;
        gsRenderCatalogCards(savedSettings.theme_catalog);
      }
    } else {
      toast('Failed to save settings', 'error');
    }
  } catch (err) {
    console.error('Save settings error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

function zyUpdateFxPreview() {
  const fxVal = parseFloat(document.getElementById('s-usd-to-pkr')?.value);
  const badgeEl = document.getElementById('s-fx-preview-badge');
  const textEl = document.getElementById('s-fx-preview-text');
  if (Number.isFinite(fxVal) && fxVal > 0) {
    if (badgeEl) badgeEl.textContent = `1 USD = Rs. ${zyFmtMoney(fxVal, 2)} PKR`;
    if (textEl) textEl.textContent = `Used across Agent Client Rate Set margin caps and Client PKR conversion ($0.01 USD ≈ Rs. ${zyFmtMoney((0.01 * fxVal), 4)} PKR).`;
  } else {
    if (badgeEl) badgeEl.textContent = 'Invalid FX Rate';
  }
}

async function zySaveFxRateOnly() {
  const fxEl = document.getElementById('s-usd-to-pkr');
  const minPkrEl = document.getElementById('s-min-payout-pkr');
  const fxVal = parseFloat(fxEl?.value);
  if (!Number.isFinite(fxVal) || fxVal <= 0 || fxVal > 100000) {
    toast('USD to PKR FX rate must be between 0.01 and 100,000.', 'error');
    return;
  }
  const body = { usd_to_pkr_rate: Math.round(fxVal * 100) / 100 };
  if (minPkrEl && minPkrEl.value !== '') {
    const mpPkr = parseFloat(minPkrEl.value);
    if (!Number.isFinite(mpPkr) || mpPkr < 0) {
      toast('Client Minimum Payout (PKR) must be 0 or greater.', 'error');
      return;
    }
    body.min_payout_pkr = Math.round(mpPkr * 100) / 100;
  }
  const btn = document.getElementById('s-save-fx-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }
  try {
    const res = await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    if (res && !res.error) {
      try {
        let bs = JSON.parse(localStorage.getItem('app_brand_settings') || '{}');
        bs = { ...bs, ...body };
        localStorage.setItem('app_brand_settings', JSON.stringify(bs));
        if (window.__BRAND_SETTINGS__) window.__BRAND_SETTINGS__ = { ...window.__BRAND_SETTINGS__, ...body };
      } catch (_) {}
      zyUpdateFxPreview();
      toast(`FX Rate updated: 1 USD = Rs. ${zyFmtMoney(body.usd_to_pkr_rate, 4)} PKR`, 'success');
    } else {
      toast(res?.error || 'Failed to update FX rate', 'error');
    }
  } catch (err) {
    toast('Failed to update FX rate: ' + (err.message || 'Error'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Update FX Rate'; }
  }
}

async function zySaveMonthlyCycleOnly() {
  const start_date = document.getElementById('s-mc-start')?.value || '';
  const end_date = document.getElementById('s-mc-end')?.value || '';
  const clear_date = document.getElementById('s-mc-clear')?.value || '';
  if (!start_date || !end_date || !clear_date) {
    toast('Start Date, End Date, and Clear Date are required.', 'error');
    return;
  }
  const btn = document.getElementById('s-save-mc-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }
  try {
    const res = await apiFetch('/api/monthly-cycle', { method: 'POST', body: JSON.stringify({ start_date, end_date, clear_date }) });
    if (res && res.success) {
      toast(`Monthly Cycle saved: ${res.monthly_cycle.start_date} → ${res.monthly_cycle.end_date} (Clears ${res.monthly_cycle.clear_date})`, 'success');
    } else {
      toast(res?.error || 'Failed to save Monthly Cycle', 'error');
    }
  } catch (err) {
    toast(err.message || 'Failed to save Monthly Cycle', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Save Monthly Cycle'; }
  }
}

function previewTimezoneChange(tz) {
  try {
    let bs = JSON.parse(localStorage.getItem('app_brand_settings') || '{}');
    bs.timezone = tz;
    localStorage.setItem('app_brand_settings', JSON.stringify(bs));
    if (window.__BRAND_SETTINGS__) window.__BRAND_SETTINGS__.timezone = tz;
    if (typeof window.zyUpdateClockLive === 'function') {
      window.zyUpdateClockLive();
    }
  } catch (e) {}
}

async function clearAllNotifications() {
  if (!confirm('⚠️ Are you sure you want to clear ALL user notifications? This cannot be undone.')) return;
  try {
    const res = await apiFetch('/api/notifications/clear?clear_all=true', {
      method: 'POST',
      body: JSON.stringify({ clear_all: true })
    });
    if (res && res.success) {
      toast('Notifications cleared successfully', 'success');
    } else {
      toast(res?.error || 'Failed to clear notifications', 'error');
    }
  } catch (err) {
    toast(err.message || 'Error clearing notifications', 'error');
  }
}

async function clearFirewallEvents() {
  if (!confirm('⚠️ Are you sure you want to clear ALL firewall security event logs?')) return;
  try {
    const res = await apiFetch('/api/firewall/events/clear', { method: 'POST' });
    if (res && res.success) {
      toast('Firewall security logs cleared successfully', 'success');
    } else {
      toast(res?.error || 'Failed to clear firewall events', 'error');
    }
  } catch (err) {
    toast(err.message || 'Error clearing firewall events', 'error');
  }
}

// ─── SECURITY SETTINGS ────────────────────────────────────────────
async function renderSecuritySettings() {
  try {
    const data = await apiFetch('/api/settings') || {};

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Security Settings</div></div>
      </div>
      ${renderOwnerHubTabs('settings', 'general-settings')}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="loadPage('general-settings')"><i class="fas fa-sliders"></i> General &amp; Appearance</button>
        <button class="btn btn-primary btn-sm" onclick="loadPage('security-settings')"><i class="fas fa-shield"></i> Security &amp; Sessions</button>
        <button class="btn btn-outline btn-sm" onclick="loadPage('smpp-settings')"><i class="fas fa-server"></i> SMPP Server</button>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-header"><div class="card-title">Credentials &amp; Two-Factor Auth</div></div>
          <p class="text-muted fs-12" style="margin-bottom:14px;">Manage your Owner login password, TOTP 2FA authenticator setup, REST API tokens, and personal audit history in My Profile.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="loadPage('profile-security')"><i class="fas fa-key"></i> Change Password</button>
            <button class="btn btn-outline btn-sm" onclick="loadPage('2fa')"><i class="fas fa-shield-halved"></i> 2FA Authenticator</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Session Settings</div></div>
          <div class="form-group"><label class="form-label">Session Timeout (minutes)</label>
            <input type="number" min="5" value="${data.session_timeout || 60}" id="sec-timeout"></div>
          <div class="form-group"><label class="form-label">Max Concurrent Sessions</label>
            <input type="number" min="1" value="${data.max_sessions || 3}" id="sec-sessions"></div>
          <div class="form-actions">
            <button class="btn btn-primary" onclick="saveSecuritySettings()"><i class="fas fa-save"></i> Save</button>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Security settings error:', err);
    toast('Failed to load security settings', 'error');
  }
}

async function saveSecuritySettings() {
  try {
    const payload = {
      session_timeout: parseInt(document.getElementById('sec-timeout').value, 10) || 60,
      max_sessions: parseInt(document.getElementById('sec-sessions').value, 10) || 3
    };

    const result = await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(payload) });

    if (result && (result.success || result.session_timeout !== undefined)) {
      toast('Security settings saved', 'success');
    } else {
      toast(result?.error || 'Failed to save settings', 'error');
    }
  } catch (err) {
    console.error('Save security settings error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

// ─── SMPP SETTINGS ────────────────────────────────────────────────
async function renderSmppSettings() {
  try {
    const data = await apiFetch('/api/settings') || {};
    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">SMPP Settings</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="saveSmppSettings()"><i class="fas fa-save"></i> Save</button>
        </div>
      </div>
      ${renderOwnerHubTabs('settings', 'general-settings')}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="loadPage('general-settings')"><i class="fas fa-sliders"></i> General &amp; Appearance</button>
        <button class="btn btn-outline btn-sm" onclick="loadPage('security-settings')"><i class="fas fa-shield"></i> Security &amp; Sessions</button>
        <button class="btn btn-primary btn-sm" onclick="loadPage('smpp-settings')"><i class="fas fa-server"></i> SMPP Server</button>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-header"><div class="card-title">Server Configuration</div></div>
          <div class="form-group" style="display:flex;align-items:center;justify-content:space-between;">
            <label class="form-label" style="margin:0;">Enable Built-in SMPP Listener</label>
            <input type="checkbox" id="smpp-enabled" ${data.smpp_enabled ? 'checked' : ''}>
          </div>
          <div class="form-group"><label class="form-label">Listen Host</label><input id="smpp-host" value="${escapeHtml(data.smpp_host || '0.0.0.0')}"></div>
          <div class="form-group"><label class="form-label">Port</label><input id="smpp-port" type="number" value="${Number(data.smpp_port || 2775)}"></div>
          <div class="form-group"><label class="form-label">Max Connections</label><input id="smpp-max-conn" type="number" value="${Number(data.smpp_max_connections || 100)}"></div>
          <div class="form-group"><label class="form-label">Bind Timeout (s)</label><input id="smpp-bind-timeout" type="number" value="${Number(data.smpp_bind_timeout || 30)}"></div>
          <div class="form-group"><label class="form-label">Enquire Link Interval (s)</label><input id="smpp-enquire-interval" type="number" value="${Number(data.smpp_enquire_interval || 60)}"></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Throughput Limits</div></div>
          <div class="form-group"><label class="form-label">Max MPS (per session)</label><input id="smpp-max-mps" type="number" value="${Number(data.smpp_max_mps || 500)}"></div>
          <div class="form-group"><label class="form-label">Global Max MPS</label><input id="smpp-global-mps" type="number" value="${Number(data.smpp_global_max_mps || 5000)}"></div>
          <div class="form-group"><label class="form-label">Queue Size</label><input id="smpp-queue-size" type="number" value="${Number(data.smpp_queue_size || 10000)}"></div>
          <div class="form-group"><label class="form-label">DLR Timeout (s)</label><input id="smpp-dlr-timeout" type="number" value="${Number(data.smpp_dlr_timeout || 86400)}"></div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('SMPP settings error:', err);
    toast('Failed to load SMPP settings', 'error');
  }
}

async function saveSmppSettings() {
  try {
    const payload = {
      smpp_enabled: !!document.getElementById('smpp-enabled')?.checked,
      smpp_host: (document.getElementById('smpp-host')?.value || '0.0.0.0').trim(),
      smpp_port: parseInt(document.getElementById('smpp-port')?.value, 10) || 2775,
      smpp_max_connections: parseInt(document.getElementById('smpp-max-conn')?.value, 10) || 100,
      smpp_bind_timeout: parseInt(document.getElementById('smpp-bind-timeout')?.value, 10) || 30,
      smpp_enquire_interval: parseInt(document.getElementById('smpp-enquire-interval')?.value, 10) || 60,
      smpp_max_mps: parseInt(document.getElementById('smpp-max-mps')?.value, 10) || 500,
      smpp_global_max_mps: parseInt(document.getElementById('smpp-global-mps')?.value, 10) || 5000,
      smpp_queue_size: parseInt(document.getElementById('smpp-queue-size')?.value, 10) || 10000,
      smpp_dlr_timeout: parseInt(document.getElementById('smpp-dlr-timeout')?.value, 10) || 86400
    };
    const result = await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
    if (result && !result.error) {
      toast('SMPP settings saved', 'success');
    } else {
      toast(result?.error || 'Failed to save SMPP settings', 'error');
    }
  } catch (err) {
    console.error('Save SMPP settings error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

// ─── BACKUP & RESTORE ─────────────────────────────────────────────
function renderBackupRestore() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Backup &amp; Restore</div><div class="page-subtitle">Full system export — every client, agent, number, and log</div></div>
    </div>
    ${renderOwnerHubTabs('settings', 'backup-restore')}
    <div class="two-col">
      <div class="card">
        <div class="card-header"><div class="card-title">Create Backup</div></div>
        <p class="text-secondary" style="margin-bottom:16px;">Downloads a single .zip containing everything: numbers, clients, agents, SMS logs, settings, rate cards, audit logs — the entire <span class="monospace">data/</span> folder.</p>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="doBackup()" id="backup-btn"><i class="fas fa-download"></i> Download Backup</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Restore</div></div>
        <p class="text-secondary" style="margin-bottom:16px;">Upload a backup .zip (from this same panel) to restore all data — useful when moving to a new server: install the script fresh, then restore your last backup here.</p>
        <div style="background:rgba(210,153,34,0.1);border:1px solid rgba(210,153,34,0.25);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;">
          <i class="fas fa-triangle-exclamation" style="color:var(--yellow-light);"></i>
          This <strong>overwrites</strong> all current data. A safety copy of what's there now is kept automatically before restoring.
        </div>
        <div class="upload-zone" onclick="document.getElementById('restore-file-input').click()">
          <i class="fas fa-cloud-arrow-up"></i>
          <p>Click to select backup .zip file</p>
          <small>Only accepts backups exported from this panel</small>
        </div>
        <input type="file" id="restore-file-input" accept=".zip" style="display:none" onchange="handleRestoreFile(this)">
        <div id="restore-result" style="margin-top:14px;"></div>
      </div>
    </div>
  `;
}

async function doBackup() {
  const btn = document.getElementById('backup-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Preparing backup...'; }
  try {
    const token = getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Session-Token'] = token;
    }
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const response = await fetch('/api/backup/export' + query, {
      method: 'GET',
      credentials: 'include',
      headers
    });
    if (!response.ok) {
      let msg = 'Export failed';
      try {
        const errJson = await response.json();
        if (errJson && errJson.error) msg = errJson.error;
        else if (errJson && errJson.message) msg = errJson.message;
      } catch (_) {}
      if (response.status === 401) {
        msg = 'Unauthorized. Please log in again to export backup.';
      }
      throw new Error(msg);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename=(?:["']?)([^"';]+)(?:["']?)/);
    const sitePrefix = ((window.__BRAND_SETTINGS__?.site_name) || 'humax_sms').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'humax_sms';
    const filename = match ? match[1].replace(/['"]/g, '').trim() : `${sitePrefix}_backup_${new Date().toISOString().split('T')[0]}.zip`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('✅ Backup downloaded', 'success');
  } catch (err) {
    console.error('Backup error:', err);
    toast('Failed to create backup: ' + (err.message || 'Export error'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download Backup'; }
  }
}

async function handleRestoreFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!confirm(`This will overwrite ALL current data with the contents of "${file.name}". Continue?`)) {
    input.value = '';
    return;
  }

  const result = document.getElementById('restore-result');
  result.innerHTML = `<div class="flex-center gap-2"><div class="spinner"></div> Restoring from ${file.name}...</div>`;

  const form = new FormData();
  form.append('file', file);
  try {
    const token = getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Session-Token'] = token;
    }
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const response = await fetch('/api/backup/restore' + query, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form
    });
    const d = await response.json();
    if (!response.ok) throw new Error(d.error || d.detail || 'Restore failed');
    result.innerHTML = `<div class="alert alert-success">✅ Restored ${d.restored_files} file(s) successfully. Reloading...</div>`;
    toast('✅ Restore complete', 'success');
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    console.error('Restore error:', err);
    result.innerHTML = `<div class="alert alert-danger">Failed: ${err.message}</div>`;
    toast('Restore failed: ' + err.message, 'error');
  }
  input.value = '';
}

// ─── SERVICES MANAGER ────────────────────────────────────────────
async function renderServicesManager() {
  try {
    const data = await apiFetch('/api/services') || [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Services Manager</div>
        <div class="page-subtitle">Manage OTP service labels &amp; icons (rates are controlled dynamically via Ranges &amp; Client Rate Set)</div></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openAddServiceModal()"><i class="fas fa-plus"></i> Add Service</button>
        </div>
      </div>
      ${renderOwnerHubTabs('settings', 'services-manager')}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="loadPage('services-manager')"><i class="fas fa-mobile-screen"></i> Services Manager</button>
        <button class="btn btn-outline btn-sm" onclick="loadPage('cli-manager')"><i class="fas fa-terminal"></i> CLI Routes Manager</button>
      </div>
      <div class="card">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:8px 0;">
          ${data.length ? data.map(s => `
            <div class="stat-card" style="border-left:4px solid ${escapeHtml(s.color || '#334155')};position:relative;">
              <div class="stat-icon" style="background:${escapeHtml(s.color || '#334155')}22;color:${escapeHtml(s.color || '#334155')}">
                <i class="${escapeHtml(s.icon || 'fas fa-mobile-screen')}"></i>
              </div>
              <div style="flex:1;padding-right:76px;">
                <div class="stat-label" style="font-size:15px;font-weight:700;">${escapeHtml(s.name || '—')}</div>
                <div class="text-muted fs-12" style="margin-top:4px;">${escapeHtml(s.description || 'OTP Service Tag')}</div>
              </div>
              <div style="position:absolute;top:12px;right:12px;display:flex;gap:6px;align-items:center;">
                <span class="badge badge-${s.active !== false ? 'green' : 'red'}">${s.active !== false ? 'Active' : 'Inactive'}</span>
                <button class="btn-icon" onclick="openEditServiceModal(${Number(s.id)})" title="Edit Service"><i class="fas fa-pen"></i></button>
                <button class="btn-icon text-danger" onclick="deleteService(${Number(s.id)})" title="Delete Service"><i class="fas fa-trash"></i></button>
              </div>
            </div>
          `).join('') : '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-mobile-screen"></i><p>No services configured yet</p></div>'}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Services manager error:', err);
    toast('Failed to load services', 'error');
  }
}

function openAddServiceModal() {
  openModal('Add New Service', `
    <form id="add-service-form" onsubmit="submitAddService(event)">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Service Name *</label>
          <input id="svc-name" placeholder="e.g. WhatsApp, Google" required></div>
        <div class="form-group"><label class="form-label">Icon (FontAwesome class)</label>
          <input id="svc-icon" placeholder="fab fa-whatsapp" value="fas fa-mobile-screen"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Color (hex)</label>
          <input id="svc-color" type="color" value="#334155"></div>
        <div class="form-group"><label class="form-label">Description</label>
          <input id="svc-desc" placeholder="Brief description"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="svc-submit-btn"><i class="fas fa-plus"></i> Add Service</button>
      </div>
    </form>
  `);
}

async function submitAddService(event) {
  event.preventDefault();

  try {
    const name = document.getElementById('svc-name').value.trim();
    if (!name) {
      toast('Service name is required', 'error');
      return;
    }

    const btn = document.getElementById('svc-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Adding...';
    }

    const payload = {
      name,
      icon: document.getElementById('svc-icon').value.trim() || 'fas fa-mobile-screen',
      color: document.getElementById('svc-color').value || '#334155',
      description: document.getElementById('svc-desc').value.trim() || ''
    };

    const result = await apiFetch('/api/services', { method: 'POST', body: JSON.stringify(payload) });

    if (result && result.id) {
      closeModal();
      toast(`Service "${name}" added`, 'success');
      renderServicesManager();
    } else {
      toast(result?.error || 'Failed to add service', 'error');
    }
  } catch (err) {
    console.error('Add service error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('svc-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus"></i> Add Service';
    }
  }
}

// ─── CLI MANAGER ──────────────────────────────────────────────────
async function renderCliManager() {
  try {
    const cliData = await apiFetch('/api/cli-routes') || [];
    const rows = Array.isArray(cliData) ? cliData : [];

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">CLI Manager</div>
        <div class="page-subtitle">Clean Caller Line Identity (CLI) directory (rates are managed separately via Ranges &amp; Client Rate Set)</div></div>
        <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="exportCli()"><i class="fas fa-file-csv"></i> Export CSV</button>
          <button class="btn btn-primary btn-sm" onclick="openAddCliModal()"><i class="fas fa-plus"></i> Add CLI</button>
        </div>
      </div>
      ${renderOwnerHubTabs('settings', 'services-manager')}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="loadPage('services-manager')"><i class="fas fa-mobile-screen"></i> Services Manager</button>
        <button class="btn btn-primary btn-sm" onclick="loadPage('cli-manager')"><i class="fas fa-terminal"></i> CLI Routes Manager</button>
      </div>
      <div class="card">
        <div class="filters-bar" style="margin-bottom:12px;">
          <input id="cli-search" placeholder="Search CLI, country or description…" onkeyup="if(event.key==='Enter')searchCli()">
          <select id="cli-status-filter" onchange="searchCli()">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button type="button" class="btn btn-outline btn-sm" onclick="searchCli()"><i class="fas fa-search"></i> Search</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="resetCliFilters()"><i class="fas fa-rotate-left"></i> Reset</button>
        </div>
        ${buildTable(
          ['#', 'CLI Number', 'Country', 'Description', 'Status', 'Actions'],
          rows.map(cl => [
            `<span class="monospace fw-600">#${Number(cl.id) || '—'}</span>`,
            `<span class="monospace fw-600">${escapeHtml(cl.cli || '—')}</span>`,
            escapeHtml(cl.country || '—'),
            escapeHtml(cl.description || '—'),
            statusBadge(cl.status),
            `<div style="display:inline-flex;gap:4px;align-items:center;">
              <button class="btn btn-outline btn-sm" onclick="openEditCliModal(${Number(cl.id)})" title="Edit CLI"><i class="fas fa-pen"></i></button>
              <button class="btn btn-${cl.status === 'active' ? 'warning' : 'success'} btn-sm" onclick="toggleCliRoute(${Number(cl.id)},'${escapeHtml(cl.status || 'active')}')" title="${cl.status === 'active' ? 'Deactivate' : 'Activate'}">
                <i class="fas fa-${cl.status === 'active' ? 'pause' : 'play'}"></i>
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteCliRoute(${Number(cl.id)})" title="Delete CLI"><i class="fas fa-trash"></i></button>
            </div>`
          ]),
          { id: 'tbl-cli-manager', title: 'CLI Routes', toolbar: true }
        )}
      </div>
    `;
  } catch (err) {
    console.error('CLI manager error:', err);
    toast('Failed to load CLI routes', 'error');
  }
}

function openAddCliModal() {
  openModal('Add New CLI', `
    <form id="add-cli-form" onsubmit="submitAddCli(event)">
      <div class="form-group"><label class="form-label">CLI Number *</label>
        <input id="cli-num" placeholder="e.g. WhatsApp or +12025551234" required></div>
      <div class="form-group"><label class="form-label">Country</label>
        <input id="cli-country" placeholder="e.g. US, UK, PK"></div>
      <div class="form-group"><label class="form-label">Description</label>
        <input id="cli-desc" placeholder="Brief description"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="cli-submit-btn"><i class="fas fa-plus"></i> Add CLI</button>
      </div>
    </form>
  `);
}

async function submitAddCli(event) {
  event.preventDefault();

  try {
    const cli = document.getElementById('cli-num').value.trim();
    if (!cli) {
      toast('CLI number is required', 'error');
      return;
    }

    const btn = document.getElementById('cli-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Adding...';
    }

    const payload = {
      cli,
      country: document.getElementById('cli-country').value.trim(),
      description: document.getElementById('cli-desc').value.trim() || ''
    };

    const result = await apiFetch('/api/cli-routes', { method: 'POST', body: JSON.stringify(payload) });

    if (result && result.id) {
      closeModal();
      toast(`CLI "${cli}" added`, 'success');
      renderCliManager();
    } else {
      toast(result?.error || 'Failed to add CLI', 'error');
    }
  } catch (err) {
    console.error('Add CLI error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('cli-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus"></i> Add CLI';
    }
  }
}

function openEditCliModal(id) {
  apiFetch('/api/cli-routes').then(data => {
    const cl = (data || []).find(c => Number(c.id) === Number(id));
    if (!cl) { toast('CLI not found', 'error'); return; }
    openModal('Edit CLI', `
      <form id="edit-cli-form" onsubmit="submitEditCli(event, ${Number(id)})">
        <div class="form-group"><label class="form-label">CLI Number *</label>
          <input id="ecli-num" value="${escapeHtml(cl.cli || '')}" required></div>
        <div class="form-group"><label class="form-label">Country</label>
          <input id="ecli-country" value="${escapeHtml(cl.country || '')}"></div>
        <div class="form-group"><label class="form-label">Description</label>
          <input id="ecli-desc" value="${escapeHtml(cl.description || '')}"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="ecli-submit-btn"><i class="fas fa-check"></i> Save</button>
        </div>
      </form>
    `);
  }).catch(() => toast('Failed to load CLI', 'error'));
}

async function submitEditCli(event, id) {
  event.preventDefault();
  const cli = document.getElementById('ecli-num')?.value.trim();
  if (!cli) { toast('CLI number is required', 'error'); return; }
  const btn = document.getElementById('ecli-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }
  try {
    const payload = {
      cli,
      country: document.getElementById('ecli-country').value.trim(),
      description: document.getElementById('ecli-desc').value.trim()
    };
    const result = await apiFetch(`/api/cli-routes/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (result && !result.error) {
      closeModal();
      toast('CLI updated', 'success');
      renderCliManager();
    } else {
      toast(result?.error || 'Failed to update CLI', 'error');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Save'; }
  }
}

async function toggleCliRoute(id, currentStatus) {
  try {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    const res = await apiFetch(`/api/cli-routes/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    if (res && !res.error) {
      toast(`CLI ${newStatus === 'active' ? 'activated' : 'deactivated'}`, 'success');
      renderCliManager();
    } else {
      toast(res?.error || 'Failed to update CLI status', 'error');
    }
  } catch (err) {
    toast('Failed to update CLI status', 'error');
  }
}

async function deleteCliRoute(id) {
  if (!confirm('Delete this CLI number?')) return;
  try {
    const res = await apiFetch(`/api/cli-routes/${id}`, { method: 'DELETE' });
    if (res && !res.error) {
      toast('CLI deleted', 'warning');
      renderCliManager();
    } else {
      toast(res?.error || 'Failed to delete CLI', 'error');
    }
  } catch (err) {
    toast('Failed to delete CLI', 'error');
  }
}


// ─── NUMBER TRANSFERS LOG ─────────────────────────────────────────
async function renderNumberTransfersLog(page = 1) {
  try {
    const data = await apiFetch(`/api/number-transfers?page=${page}&limit=20`);

    const c = document.getElementById('page-content');
    c.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Number Transfer History</div>
        <div class="page-subtitle">Complete log of all number transfers</div></div>
        <div class="page-actions">
          <button class="btn btn-outline btn-sm" onclick="toast('Exporting...', 'info')"><i class="fas fa-download"></i> Export CSV</button>
        </div>
      </div>
      ${renderOwnerHubTabs('history', 'number-transfers-log')}
      <div class="card">
        ${buildTable(
          ['#', 'From', 'Role', 'To', 'Role', 'Count', 'Service', 'Notes', 'Time', 'Status'],
          (data?.data || []).map(t => [
            t.id || '—',
            `<strong>${t.from_username || '—'}</strong>`,
            `<span class="badge badge-${(t.from_role === 'Owner' || t.from_role === 'Admin') ? 'purple' : 'cyan'}">${t.from_role || '—'}</span>`,
            `<strong>${t.to_username || '—'}</strong>`,
            `<span class="badge badge-${t.to_role === 'Agent' ? 'cyan' : 'green'}">${t.to_role || '—'}</span>`,
            `<span class="badge badge-blue">${t.count || 0}</span>`,
            t.service || '—',
            t.notes || '—',
            fmtShort(t.timestamp),
            statusBadge(t.status)
          ])
        )}
        ${pagination(page, data?.total || 0, 20, renderNumberTransfersLog)}
      </div>
    `;
  } catch (err) {
    console.error('Number transfers log error:', err);
    toast('Failed to load transfer history', 'error');
  }
}

// ─── Auto-logout after 10 minutes of inactivity ─────────────────────
let _idleTimer = null;
const IDLE_LIMIT_MS = 10 * 60 * 1000;
function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(autoLogoutIdle, IDLE_LIMIT_MS);
}
function autoLogoutIdle() {
  try {
    sessionStorage.clear();
  } catch (e) {}
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = '/login';
      return;
    }
  } catch (e) {}
  window.location.href = '/login';
}
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
  document.addEventListener(evt, resetIdleTimer, { passive: true });
});
resetIdleTimer();

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window !== 'undefined' && (window.__AUTH_BLOCKED__ || (window.HumexAuth && !window.HumexAuth.isLoggedIn()))) {
    return;
  }
  const lastPage = sessionStorage.getItem('admin_current_page') || 'dashboard';
  loadPage(lastPage);
});