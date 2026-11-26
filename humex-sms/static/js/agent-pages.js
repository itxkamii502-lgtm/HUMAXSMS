/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — AGENT pages. Requires shared-ui-kit.js
   ═══════════════════════════════════════════════════════════════ */

let ZY_RANGES = [], ZY_CLIENTS = [], ZY_NUMROWS = [];

async function zyFillClients(selectId, label) {
  const res = await apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=200`);
  ZY_CLIENTS = zyList(res).slice().sort((a, b) => String(a.username || '').localeCompare(String(b.username || ''), undefined, { sensitivity: 'base' }));
  const el = document.getElementById(selectId);
  if (el) el.innerHTML = `<option value="">${label || 'Filter Client'}</option>` +
    ZY_CLIENTS.map(c => `<option value="${c.id}">${zyEsc(c.username)}</option>`).join('');
  return ZY_CLIENTS;
}
const zyClientName = id => (ZY_CLIENTS.find(c => String(c.id) === String(id)) || {}).username || '';
const zyNA = v => (v === '' || v == null) ? '<span class="zy-na">NA</span>' : v;

/* ═══ 1. SMS RANGES & RATECARD MASTER CATALOG ═════════════════════════ */
let ZY_AGENT_RANGE_LIST = [];

async function pgSmsRanges() {
  const c = document.getElementById('page-content');
  zyCrumb(['SMS Module', 'Ranges Add']);
  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title" style="font-size:18px;font-weight:800;">
          <i class="fas fa-table-list" style="color:#0ea5e9;margin-right:6px;"></i> Ranges Add
        </div>
        <div class="page-subtitle" style="font-size:12.5px;">
          Master catalog of available termination ranges, payout rates, and real-time numbers room.
        </div>
      </div>
    </div>
    <div class="apx-card zy-theme-card" style="border-radius:10px;overflow:hidden;">
      <div class="apx-card-body" id="agt-ranges-table-host" style="padding:14px;"><div class="zy-loading">Loading termination ranges…</div></div>
    </div>`;

  try {
    const [rangesRes, myNumsRes, policy] = await Promise.all([
      apiFetch('/api/numbers/sms-ranges').catch(() => []),
      apiFetch(AGENT_ID ? `/api/numbers?agent_id=${encodeURIComponent(AGENT_ID)}&limit=100000` : '/api/numbers?limit=100000').catch(() => ({ total: 0, data: [] })),
      typeof zyFetchAllocPolicy === 'function' ? zyFetchAllocPolicy() : Promise.resolve({ mode: 'request' })
    ]);

    const list = zyList(rangesRes).slice().sort((a, b) => String(a.range_name || a.name || a.country || '').localeCompare(String(b.range_name || b.name || b.country || ''), undefined, { sensitivity: 'base' }));
    const myNums = zyList(myNumsRes);
    ZY_AGENT_RANGE_LIST = list;
    window._zyAgtPolicy = policy || { mode: 'request' };
    const isSelfAlloc = window._zyAgtPolicy.mode === 'self_allocate';

    const naHtml = `<span class="zy-na">N/A</span>`;

    const rows = list.map((r, i) => {
      const rName = r.range_name || r.name || r.country || '—';
      const pts = r.payterms || {};
      const ptInfo = typeof zyResolveRangeActivePayterms === 'function'
        ? zyResolveRangeActivePayterms(r)
        : { active: [r.payterm || 'Weekly'], primary: r.payterm || 'Weekly', isWn: Boolean(r.is_whitenoise) };
      const hasWeekly = ptInfo.active.includes('Weekly');
      const hasMonthly = ptInfo.active.includes('Monthly');
      const fallbackRate = Number(r.agent_rate ?? r.payout ?? r.rate ?? 0);
      const weeklyRate = hasWeekly ? Number(pts['Weekly'] ?? pts['7/3'] ?? fallbackRate) : null;
      const monthlyRate = hasMonthly ? Number(pts['Monthly'] ?? pts['30/5'] ?? fallbackRate) : null;
      const curr = r.currency || 'USD';
      const currSym = curr === 'EUR' ? '€' : (curr === 'GBP' ? '£' : '$');
      const myRangeNums = myNums.filter(n => {
        if (r.id && n.range_id && Number(n.range_id) === Number(r.id)) return true;
        const nr = n.range_name || n.name || n.country || '';
        return nr.toLowerCase() === rName.toLowerCase();
      });
      const heldCount = myRangeNums.length;
      const agentFreePool = Number(r.agent_free_count ?? myRangeNums.filter(n => !n.client_id).length);
      const roomCount = Math.max(0, Number(r.owner_free_count ?? r.free_count ?? r.available ?? 0));
      const hasPendingReq = Boolean(r.has_pending_request || Number(r.pending_request_count || 0) > 0);
      const agPolicy = window._zyAgtPolicy || {};
      const agDailyBlocked = Number(agPolicy.daily_limit || 0) > 0 && Number(agPolicy.daily_remaining ?? 0) <= 0;
      const agTotalBlocked = Number(agPolicy.total_limit || 0) > 0 && Number(agPolicy.total_remaining ?? 0) <= 0;
      const agLimitBlocked = agDailyBlocked || agTotalBlocked;
      const agLimitTip = agDailyBlocked
        ? `Daily limit reached (${Number(agPolicy.used_today || 0)}/${Number(agPolicy.daily_limit)} used today). Resets at 00:00 UTC (05:00 AM PKT).`
        : `Overall number holding limit reached (${Number(agPolicy.total_held || 0)}/${Number(agPolicy.total_limit)}). Return numbers to add more.`;

      const ptBadge = ptInfo.active.map(pt =>
        typeof zyPaytermBadge === 'function'
          ? zyPaytermBadge(pt)
          : `<span class="badge badge-purple" style="font-size:10.5px;">${zyEsc(pt)}</span>`
      ).join(' ');
      const wnRouteTag = ptInfo.isWn ? ' <span class="zy-wn-route-tag"><i class="fas fa-calendar-check"></i> {W} Monthly Route</span>' : '';
      const safeProvider = ptInfo.isWn || String(r.provider || '').toLowerCase().includes('whitenoise')
        ? 'Monthly Route {W}'
        : (r.provider || 'Direct');

      const returnBtnHtml = heldCount > 0
        ? `<button type="button" class="apx-btn apx-btn-small zy-btn-return-solid" onclick="zyOpenRangeReturnModal(${r.id || 'null'}, '${zyEsc(rName)}', pgSmsRanges)" title="Return numbers from ${zyEsc(rName)} by date"><i class="fas fa-rotate-left"></i> Return (${heldCount})</button>`
        : `<button type="button" class="apx-btn apx-btn-small zy-btn-return-solid is-disabled" disabled title="No numbers held in this range to return"><i class="fas fa-rotate-left"></i> Return</button>`;

      let allocBtnHtml = '';
      if (isSelfAlloc) {
        if (agLimitBlocked) {
          allocBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#94a3b8;border-color:#cbd5e1;background:#f8fafc;cursor:not-allowed;" disabled title="${zyEsc(agLimitTip)}"><i class="fas fa-lock"></i> Limit Reached</button>`;
        } else if (roomCount <= 0) {
          allocBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#94a3b8;border-color:#cbd5e1;background:#f8fafc;cursor:not-allowed;" disabled title="No free numbers are currently available in Owner pool for this range."><i class="fas fa-ban"></i> Out of Stock</button>`;
        } else {
          allocBtnHtml = `<button type="button" class="apx-btn apx-btn-small zy-btn-alloc-solid" onclick="zyOpenSelfAllocateModal('${zyEsc(rName)}', ${r.id || 'null'}, window._zyAgtPolicy, pgSmsRanges, ZY_AGENT_RANGE_LIST[${i}])" title="Self-Allocate from ${roomCount.toLocaleString()} free pool numbers"><i class="fas fa-bolt"></i> Self-Allocate</button>`;
        }
      } else {
        if (hasPendingReq) {
          allocBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#b45309;border-color:#fde68a;background:#fffbeb;cursor:not-allowed;" disabled title="You already have a pending request for this range. Please wait for Owner approval."><i class="fas fa-clock"></i> Pending Approval</button>`;
        } else if (agLimitBlocked) {
          allocBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#94a3b8;border-color:#cbd5e1;background:#f8fafc;cursor:not-allowed;" disabled title="${zyEsc(agLimitTip)}"><i class="fas fa-lock"></i> Limit Reached</button>`;
        } else if (roomCount <= 0) {
          allocBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#94a3b8;border-color:#cbd5e1;background:#f8fafc;cursor:not-allowed;" disabled title="No free numbers are currently available in Owner pool for this range."><i class="fas fa-ban"></i> Out of Stock</button>`;
        } else {
          allocBtnHtml = `<button type="button" class="apx-btn apx-btn-small zy-btn-alloc-solid" onclick="zyOpenRequestNumbersModal('${zyEsc(rName)}', ${r.id || 'null'}, window._zyAgtPolicy, pgSmsRanges, ZY_AGENT_RANGE_LIST[${i}])" title="Request Numbers (${roomCount.toLocaleString()} free in Owner pool)"><i class="fas fa-phone-volume"></i> Request</button>`;
        }
      }

      const inactDays = Math.max(0, parseInt(r.inactivity_days, 10) || 0);
      const isBlockedRange = String(r.range_status || r.status || '').toLowerCase() === 'blocked' || r.active === false;
      const statusHtml = isBlockedRange
        ? `<span style="color:#dc2626;font-weight:700;"><i class="fas fa-ban"></i> Blocked</span>`
        : `<span style="color:#10b981;font-weight:700;">Active</span>${inactDays > 0 ? `<div style="font-size:10px;color:#b45309;font-weight:700;">Auto-Block: ${inactDays}d</div>` : ''}`;
      const prefixDisplay = r.prefix ? `+${String(r.prefix).trim().replace(/^\++/, '')}` : '—';

      return [
        { v: rName, h: `<strong class="${ptInfo.isWn ? 'zy-wn-range-name' : ''}">${zyEsc(rName)}</strong>` },
        `<span class="monospace" style="font-weight:700;color:#2563eb;">${zyEsc(prefixDisplay)}</span>`,
        weeklyRate !== null ? `<span style="font-family:monospace;font-weight:700;color:#16a34a;">${currSym} ${zyFmtMoney(weeklyRate, 4)}</span>` : naHtml,
        monthlyRate !== null ? `<span style="font-family:monospace;font-weight:700;color:#7c3aed;">${currSym} ${zyFmtMoney(monthlyRate, 4)}</span>` : naHtml,
        `<span style="font-family:monospace;font-size:11.5px;" title="Your Held: ${heldCount} (${agentFreePool} free in your pool) · Owner Free Pool: ${roomCount}"><b>${heldCount.toLocaleString()}</b> / <span style="color:${roomCount > 0 ? '#10b981' : '#dc2626'};font-weight:700;">${roomCount.toLocaleString()}</span></span>`,
        { v: isBlockedRange ? 'Blocked' : 'Active', h: statusHtml },
        { v: '', h: `<div style="display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;">
          <button type="button" class="apx-btn apx-btn-icon apx-btn-small" style="color:#0284c7;border-color:#bae6fd;background:#f0f9ff;" onclick="zyViewAgentRange(${i})" title="View Details"><i class="fas fa-eye"></i></button>
          ${allocBtnHtml}
          ${returnBtnHtml}
        </div>` }
      ];
    });

    const host = document.getElementById('agt-ranges-table-host');
    if (host) {
      host.innerHTML = zyDT2('dt-ranges', {
        cols: ['Range', 'Prefix', 'Weekly (7/3)', 'Monthly (30/5) {W}', 'Held / Free Pool', 'Status', 'Actions'],
        rows
      });
      zy2Render('dt-ranges');
    }
  } catch (err) {
    console.error('Failed to load ranges:', err);
    const host = document.getElementById('agt-ranges-table-host');
    if (host) host.innerHTML = `<div class="text-danger" style="padding:20px;text-align:center;">Failed to load SMS Ranges: ${zyEsc(err.message || 'Network error')}</div>`;
  }
}

/* 3-Column Range Specification Modal matching Owner Rate Card */
function zyViewAgentRange(i) {
  const r = ZY_AGENT_RANGE_LIST[i] || {};
  const rName = r.name || r.range_name || `${r.country || ''} ${r.provider || ''}`.trim() || 'Details';
  const pts = r.payterms || {};
  const ptInfo = typeof zyResolveRangeActivePayterms === 'function'
    ? zyResolveRangeActivePayterms(r)
    : { active: [r.payterm || 'Weekly'], primary: r.payterm || 'Weekly', isWn: Boolean(r.is_whitenoise) };
  const fallbackRate = Number(r.agent_rate ?? r.payout ?? r.rate ?? 0);
  const weeklyVal = ptInfo.active.includes('Weekly') ? Number(pts['Weekly'] ?? pts['7/3'] ?? fallbackRate) : null;
  const monthlyVal = ptInfo.active.includes('Monthly') ? Number(pts['Monthly'] ?? pts['30/5'] ?? fallbackRate) : null;
  const curr = r.currency || 'USD';
  const currSym = curr === 'EUR' ? '€' : (curr === 'GBP' ? '£' : '$');
  const clis = r.cli_list || (Array.isArray(r.clis) && r.clis.length ? r.clis.join(', ') : (r.cli || 'All CLIs'));
  const roomCount = Math.max(0, Number(r.owner_free_count ?? r.free_count ?? r.available ?? 0));
  const ptBadge = ptInfo.active.map(pt =>
    typeof zyPaytermBadge === 'function'
      ? zyPaytermBadge(pt)
      : `<b class="badge badge-purple" style="font-size:10.5px;">${zyEsc(pt)}</b>`
  ).join(' ');
  const naCell = `<span class="zy-na">N/A</span>`;
  const safeProvider = ptInfo.isWn || String(r.provider || '').toLowerCase().includes('whitenoise')
    ? 'Monthly Route {W}'
    : (r.provider || 'Direct');

  zyModal(`Range Specification: ${zyEsc(rName)}`, `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;margin-bottom:12px;">
      <!-- Col 1: General Info -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-tower-broadcast" style="color:#0284c7;margin-right:4px;"></i> General Info
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Route Type:</span> <b>${zyEsc(safeProvider)}</b></div>
          <div><span style="color:#64748b;">Range Name:</span> <b>${zyEsc(rName)}</b></div>
          <div><span style="color:#64748b;">Country:</span> <b>${zyEsc(r.country || '—')}</b></div>
          <div><span style="color:#64748b;">Prefix:</span> <b class="monospace" style="color:#2563eb;">${zyEsc(r.prefix || '—')}</b></div>
          <div><span style="color:#64748b;">Currency:</span> <b>${zyEsc(curr)}</b></div>
          <div><span style="color:#64748b;">Active Payterm:</span> ${ptBadge}</div>
        </div>
      </div>

      <!-- Col 2: Limits & Routing -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-sliders" style="color:#10b981;margin-right:4px;"></i> Limits &amp; Routing
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Status:</span> ${r.active !== false ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Inactive</span>'}</div>
          <div><span style="color:#64748b;">Max SMS / Day:</span> <b>${r.max_sms_day != null ? r.max_sms_day : (r.otp_limit || 'Unlimited')}</b></div>
          <div><span style="color:#64748b;">Room in Pool:</span> <b style="color:#10b981;">${roomCount.toLocaleString()} numbers</b></div>
          <div><span style="color:#64748b;">Memo:</span> <span style="font-style:italic;">${zyEsc(r.memo || 'None')}</span></div>
          <div><span style="color:#64748b;">Allowed CLIs:</span> <small style="display:block;color:#64748b;line-height:1.3;margin-top:2px;">${zyEsc(clis)}</small></div>
        </div>
      </div>

      <!-- Col 3: Payterm Rates -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-coins" style="color:#d97706;margin-right:4px;"></i> Payterms Rate Card
        </h5>
        <table style="width:100%;font-size:11.5px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #cbd5e1;text-align:left;color:#64748b;">
              <th style="padding:3px 0;">Schedule</th>
              <th style="padding:3px 0;text-align:right;">Payout Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:5px 0;">Weekly (7/3) · 3d Hold</td><td style="text-align:right;font-weight:700;color:#16a34a;font-family:monospace;">${weeklyVal !== null ? currSym + ' ' + zyFmtMoney(weeklyVal, 4) : naCell}</td></tr>
            <tr><td style="padding:5px 0;">Monthly (30/5) {W} · 5d Hold</td><td style="text-align:right;font-weight:700;color:#7c3aed;font-family:monospace;">${monthlyVal !== null ? currSym + ' ' + zyFmtMoney(monthlyVal, 4) : naCell}</td></tr>
          </tbody>
        </table>
      </div>
    </div>`,
     `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
     <button class="zy-btn-grey" style="color:#dc2626;border-color:#fecaca;" onclick="closeModal();zyOpenRangeReturnModal(${r.id || 'null'}, '${zyEsc(rName)}', pgSmsRanges)"><i class="fas fa-rotate-left"></i> Return Numbers</button>
     ${(window._zyAgtPolicy && window._zyAgtPolicy.mode === 'self_allocate')
       ? `<button class="zy-btn-blue" onclick="closeModal();zyOpenSelfAllocateModal('${zyEsc(rName)}', ${r.id || 'null'}, window._zyAgtPolicy, pgSmsRanges, ZY_AGENT_RANGE_LIST[${i}])"><i class="fas fa-bolt"></i> Self-Allocate Numbers</button>`
       : `<button class="zy-btn-blue" onclick="closeModal();zyOpenRequestNumbersModal('${zyEsc(rName)}', ${r.id || 'null'}, window._zyAgtPolicy, pgSmsRanges, ZY_AGENT_RANGE_LIST[${i}])"><i class="fas fa-phone-volume"></i> Request Numbers</button>`}`);
}

/* ═══ CLIENT RATE SET (PKR Configuration & Weekly Target) ═════ */
window._zyCrsState = {
  fx: 280,
  weekly_target: null,
  ranges: [],
  filter: 'all',
  search: '',
  dirty: {}
};

async function zyFetchAgentClientRates(force = false) {
  if (!force && window._zyAgentRatesCache && (Date.now() - window._zyAgentRatesCache._ts < 10000)) {
    return window._zyAgentRatesCache;
  }
  const res = await apiFetch('/api/agent/client-rates', { silent: true });
  if (res && res.success) {
    res._ts = Date.now();
    window._zyAgentRatesCache = res;
    window._zyAgentFxRate = Number(res.usd_to_pkr_rate || 280);
  }
  return res;
}

function zyFindClientRateForRange(ratesData, rangeId, rangeName) {
  const list = Array.isArray(ratesData?.ranges) ? ratesData.ranges : [];
  if (rangeId != null && rangeId !== '') {
    const byId = list.find(r => String(r.range_id) === String(rangeId));
    if (byId) return byId;
  }
  const rn = String(rangeName || '').trim().toLowerCase();
  if (rn) {
    return list.find(r => String(r.range_name || '').trim().toLowerCase() === rn) || null;
  }
  return null;
}

async function pgClientRateSet() {
  const c = document.getElementById('page-content');
  zyCrumb(['NUMBERS & INVENTORY', 'Client Rate Set']);
  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title" style="font-size:18px;font-weight:800;color:var(--sp-text-primary);">
          <i class="fas fa-tags" style="color:var(--sp-primary);margin-right:6px;"></i> Client Rate Set (PKR)
        </div>
        <div class="page-subtitle" style="font-size:12.5px;color:var(--sp-text-secondary);">
          Set your per-range client payout rates in PKR. Unconfigured ranges stay hidden from your clients' Rate Card.
        </div>
      </div>
      <div id="crs-fx-header" style="font-size:12.5px;color:var(--sp-text-secondary);background:var(--sp-bg-surface);border:1px solid var(--sp-border);border-radius:8px;padding:7px 12px;">
        Loading FX rate…
      </div>
    </div>
    <div id="crs-top-cards" style="margin-bottom:14px;"><div class="zy-loading">Loading metric summaries…</div></div>
    <div id="crs-vault-card" style="margin-bottom:14px;"></div>
    <div class="apx-card zy-theme-card" style="border-radius:10px;overflow:hidden;">
      <div class="zy-crs-toolbar">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:13px;color:var(--sp-text-primary);margin-right:4px;">
            <i class="fas fa-table-list" style="color:#0ea5e9;margin-right:4px;"></i> Termination Ranges (PKR Client Rates &amp; Per-Range Limits)
          </span>
          <div class="zy-crs-tabs" id="crs-filter-tabs">
            <button type="button" class="zy-crs-tab active" data-filter="all" onclick="zyCrsSetFilter('all')">All</button>
            <button type="button" class="zy-crs-tab" data-filter="pending" onclick="zyCrsSetFilter('pending')">Pending Setup</button>
            <button type="button" class="zy-crs-tab" data-filter="configured" onclick="zyCrsSetFilter('configured')">Published</button>
          </div>
          <input type="text" id="crs-search" class="zy-input" style="height:34px;width:220px;" placeholder="Search range…" oninput="zyCrsSetSearch(this.value)">
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="btn btn-outline btn-sm" onclick="zyCrsReload(true)"><i class="fas fa-rotate"></i> Refresh</button>
          <button type="button" class="btn btn-primary btn-sm" id="crs-save-all-btn" onclick="zyCrsSaveAllModified()" disabled>
            <i class="fas fa-floppy-disk"></i> Save All Modified (0)
          </button>
        </div>
      </div>
      <div class="apx-card-body" id="crs-table-host" style="padding:0;"><div class="zy-loading">Loading ranges…</div></div>
    </div>`;

  window._zyCrsState.dirty = {};
  await zyCrsReload(true);
}

async function zyCrsReload(force = true) {
  const host = document.getElementById('crs-table-host');
  const topEl = document.getElementById('crs-top-cards');
  const fxEl = document.getElementById('crs-fx-header');
  try {
    const res = await zyFetchAgentClientRates(force);
    if (!res || !res.success) {
      throw new Error(res?.error || 'Could not load Client Rate Set');
    }
    window._zyCrsState.fx = Number(res.usd_to_pkr_rate || 280);
    window._zyCrsState.weekly_target = res.weekly_target || {};
    window._zyCrsState.ranges = Array.isArray(res.ranges) ? res.ranges : [];
    window._zyCrsState.pending_count = Number(res.pending_count || 0);
    window._zyCrsState.configured_count = Number(res.configured_count || 0);
    window._zyCrsState.return_vault_client_id = res.return_vault_client_id || null;
    window._zyCrsState.return_vault_client_username = res.return_vault_client_username || '';
    window._zyCrsState.return_vault_held_count = Number(res.return_vault_held_count || 0);
    window._zyCrsState.agent_clients = Array.isArray(res.agent_clients) ? res.agent_clients : [];

    if (fxEl) {
      fxEl.innerHTML = `Active FX (Owner): <strong class="zy-crs-num" style="color:var(--sp-text-primary);">1 USD = Rs. ${window._zyCrsState.fx.toLocaleString(undefined, { maximumFractionDigits: 2 })} PKR</strong>`;
    }

    zyCrsRenderTopCards();
    zyCrsRenderVaultCard();
    zyCrsUpdateTabs();
    zyCrsRenderTable();
  } catch (err) {
    if (topEl) topEl.innerHTML = '';
    if (host) {
      host.innerHTML = `<div style="padding:28px;text-align:center;color:var(--sp-danger);">
        <div style="font-weight:700;margin-bottom:6px;">Failed to load Client Rate Set</div>
        <div style="font-size:12.5px;color:var(--sp-text-secondary);margin-bottom:12px;">${zyEsc(err.message || 'Network error')}</div>
        <button type="button" class="btn btn-primary btn-sm" onclick="zyCrsReload(true)">Retry</button>
      </div>`;
    }
  }
}

function zyCrsRenderVaultCard() {
  const host = document.getElementById('crs-vault-card');
  if (!host) return;
  const st = window._zyCrsState || {};
  const clients = Array.isArray(st.agent_clients) ? st.agent_clients : [];
  const curId = st.return_vault_client_id ? Number(st.return_vault_client_id) : null;
  const curName = st.return_vault_client_username || '';
  const heldCnt = Number(st.return_vault_held_count || 0);

  const optsHtml = `<option value="">Default: Agent Free Pool (Re-allocatable)</option>` + clients.map(cl => {
    const sel = curId && Number(cl.id) === curId ? 'selected' : '';
    const extra = cl.full_name ? ` (${zyEsc(cl.full_name)})` : '';
    return `<option value="${Number(cl.id)}" ${sel}>${zyEsc(cl.username)}${extra} — ${Number(cl.held_count || 0)} held</option>`;
  }).join('');

  host.innerHTML = `
    <div class="apx-card zy-theme-card" style="border-radius:10px;padding:14px 16px;border:1.5px solid var(--sp-border,#cbd5e1);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div style="flex:1 1 320px;min-width:240px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:800;font-size:13.5px;color:var(--sp-text-primary);">
              <i class="fas fa-vault" style="color:#4f46e5;margin-right:5px;"></i> Returned / Used Numbers Vault Panel
            </span>
            ${curId
              ? `<span class="badge badge-green" style="font-size:10.5px;">Active: ${zyEsc(curName)} (${heldCnt.toLocaleString()} isolated)</span>`
              : `<span class="badge badge-yellow" style="font-size:10.5px;">Not Connected (Free Pool)</span>`}
          </div>
          <div style="font-size:12px;color:var(--sp-text-secondary);margin-top:4px;line-height:1.45;">
            Connect one of your Client panels here as a holding vault. Whenever any client returns numbers (weekly direct returns or approved Monthly Route {W} returns), those used numbers automatically transfer to this Vault Client so they are <strong>never</strong> re-issued to other clients.
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <select id="crs-vault-client-select" class="zy-input" style="height:36px;min-width:240px;max-width:320px;margin:0;">
            ${optsHtml}
          </select>
          <button type="button" class="btn btn-primary btn-sm" id="crs-vault-save-btn" onclick="zyCrsSaveReturnVault()" style="height:36px;white-space:nowrap;">
            <i class="fas fa-shield-halved"></i> Save Vault
          </button>
        </div>
      </div>
    </div>`;
}

window.zyCrsSaveReturnVault = async function() {
  const sel = document.getElementById('crs-vault-client-select');
  const btn = document.getElementById('crs-vault-save-btn');
  if (!sel) return;
  const val = sel.value ? Number(sel.value) : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }
  try {
    const res = await apiFetch('/api/agent/return-vault', {
      method: 'PUT',
      body: JSON.stringify({ client_id: val })
    });
    if (res && res.success) {
      window._zyCrsState.return_vault_client_id = res.return_vault_client_id || null;
      window._zyCrsState.return_vault_client_username = res.return_vault_client_username || '';
      window._zyCrsState.return_vault_held_count = Number(res.return_vault_held_count || 0);
      zyCrsRenderVaultCard();
      if (typeof toast === 'function') toast(res.message || 'Vault Client updated!', 'success');
    } else {
      throw new Error(res?.error || 'Failed to save Vault Client');
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to save Vault Client', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shield-halved"></i> Save Vault'; }
  }
};

function zyCrsRenderTopCards() {
  const el = document.getElementById('crs-top-cards');
  if (!el) return;
  const st = window._zyCrsState;
  const totalRanges = (st.ranges || []).length;
  const publishedRanges = (st.ranges || []).filter(r => r.configured && Number(r.client_rate_pkr) > 0);
  const avgPkr = publishedRanges.length
    ? (publishedRanges.reduce((s, r) => s + Number(r.client_rate_pkr || 0), 0) / publishedRanges.length)
    : 0;
  const totalOwnerPool = (st.ranges || []).reduce((s, r) => s + Number(r.owner_pool_available ?? r.pool_available ?? 0), 0);
  const totalAgentHeld = (st.ranges || []).reduce((s, r) => s + Number(r.agent_held_count || 0), 0);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(170px, 1fr));gap:10px;">
      <div class="zy-theme-card" style="border-radius:8px;padding:10px 14px;">
        <div style="font-size:11px;font-weight:700;color:var(--sp-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Total Ranges</div>
        <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:var(--sp-text-primary);margin-top:2px;">${totalRanges}</div>
        <div style="font-size:11px;color:var(--sp-text-muted);margin-top:2px;">My Nums: <b>${totalAgentHeld.toLocaleString()}</b> · Owner Pool: <b style="color:#059669;">${totalOwnerPool.toLocaleString()}</b></div>
      </div>
      <div class="zy-theme-card" style="border-radius:8px;padding:10px 14px;">
        <div style="font-size:11px;font-weight:700;color:var(--sp-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Published to Clients</div>
        <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:#059669;margin-top:2px;">${st.configured_count || 0}</div>
        <div style="font-size:11px;color:#059669;margin-top:2px;">Visible on Client Ranges Add</div>
      </div>
      <div class="zy-theme-card" style="border-radius:8px;padding:10px 14px;">
        <div style="font-size:11px;font-weight:700;color:var(--sp-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Pending Setup</div>
        <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:${(st.pending_count || 0) > 0 ? '#d97706' : 'var(--sp-text-muted)'};margin-top:2px;">${st.pending_count || 0}</div>
        <div style="font-size:11px;color:var(--sp-text-muted);margin-top:2px;">Hidden until PKR Rate Set</div>
      </div>
      <div class="zy-theme-card" style="border-radius:8px;padding:10px 14px;">
        <div style="font-size:11px;font-weight:700;color:var(--sp-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Avg Client Rate (PKR)</div>
        <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:#2563eb;margin-top:2px;">Rs. ${zyFmtMoney(avgPkr, 2)}</div>
        <div style="font-size:11px;color:var(--sp-text-muted);margin-top:2px;">FX: 1 USD = Rs. ${zyFmtMoney(Number(st.fx || 280), 2)}</div>
      </div>
    </div>`;
}

function zyCrsUpdateTabs() {
  const st = window._zyCrsState;
  const total = (st.ranges || []).length;
  document.querySelectorAll('#crs-filter-tabs .zy-crs-tab').forEach(btn => {
    const f = btn.getAttribute('data-filter');
    btn.classList.toggle('active', f === st.filter);
    if (f === 'all') btn.textContent = `All (${total})`;
    else if (f === 'pending') btn.textContent = `Pending Setup (${st.pending_count || 0})`;
    else if (f === 'configured') btn.textContent = `Published (${st.configured_count || 0})`;
  });
}

window.zyCrsSetFilter = function(f) {
  window._zyCrsState.filter = f || 'all';
  zyCrsUpdateTabs();
  zyCrsRenderTable();
};

window.zyCrsSetSearch = function(q) {
  window._zyCrsState.search = String(q || '').trim().toLowerCase();
  zyCrsRenderTable();
};

function zyCrsSyncSaveAllBtn() {
  const btn = document.getElementById('crs-save-all-btn');
  if (!btn) return;
  const count = Object.keys(window._zyCrsState.dirty || {}).length;
  btn.disabled = count === 0;
  btn.innerHTML = `<i class="fas fa-floppy-disk"></i> Save All Modified (${count})`;
}

function zyCrsGetRowDraft(r) {
  const dirty = (window._zyCrsState.dirty || {})[r.range_id];
  const baseBatch = Math.max(1, parseInt(r.batch_size || (Array.isArray(r.allowed_quantities) ? r.allowed_quantities[0] : 25), 10) || 25);
  const baseDaily = Math.max(1, parseInt(r.daily_request_limit, 10) || 1);
  const baseMaxHold = Math.max(baseBatch, parseInt(r.max_hold_limit, 10) || Math.max(baseBatch, 25));
  return dirty || {
    client_rate_pkr: r.client_rate_pkr != null ? String(r.client_rate_pkr) : '',
    batch_size: baseBatch,
    allowed_quantities: [baseBatch],
    daily_request_limit: baseDaily,
    max_hold_limit: baseMaxHold
  };
}

function zyCrsEnsureDirty(rangeId) {
  const st = window._zyCrsState;
  if (!st.dirty[rangeId]) {
    const base = (st.ranges || []).find(x => Number(x.range_id) === Number(rangeId));
    if (!base) return null;
    const baseBatch = Math.max(1, parseInt(base.batch_size || (Array.isArray(base.allowed_quantities) ? base.allowed_quantities[0] : 25), 10) || 25);
    const baseDaily = Math.max(1, parseInt(base.daily_request_limit, 10) || 1);
    const baseMaxHold = Math.max(baseBatch, parseInt(base.max_hold_limit, 10) || Math.max(baseBatch, 25));
    st.dirty[rangeId] = {
      client_rate_pkr: base.client_rate_pkr != null ? String(base.client_rate_pkr) : '',
      batch_size: baseBatch,
      allowed_quantities: [baseBatch],
      daily_request_limit: baseDaily,
      max_hold_limit: baseMaxHold
    };
  }
  return st.dirty[rangeId];
}

function zyCrsFormatMarginHtml(agentPkr, valStr) {
  const v = parseFloat(valStr);
  if (valStr === '' || isNaN(v)) {
    return `<span style="color:var(--sp-text-muted);font-size:11px;">Not set</span>`;
  }
  if (v <= 0) {
    return `<span style="color:var(--sp-danger);font-size:11px;font-weight:700;">Must be &gt; 0</span>`;
  }
  if (agentPkr > 0 && v >= agentPkr) {
    return `<span style="color:var(--sp-danger);font-size:11px;font-weight:700;">Exceeds max (&lt; Rs. ${zyFmtMoney(agentPkr, 4)})</span>`;
  }
  if (agentPkr <= 0) {
    return `<span class="zy-crs-num" style="color:var(--sp-text-secondary);font-size:11px;">Set</span>`;
  }
  const margin = agentPkr - v;
  const pct = (margin / agentPkr) * 100;
  return `<span class="zy-crs-num" style="color:var(--sp-success);font-weight:700;font-size:11.5px;">+Rs. ${zyFmtMoney(margin, 2)} (${pct.toFixed(1)}%)</span>`;
}

window.zyCrsOnRateInput = function(rangeId, inpEl) {
  const draft = zyCrsEnsureDirty(rangeId);
  if (!draft) return;
  draft.client_rate_pkr = inpEl.value;
  const r = (window._zyCrsState.ranges || []).find(x => Number(x.range_id) === Number(rangeId));
  const fx = window._zyCrsState.fx || 280;
  const agentPkr = Number(r?.agent_rate_pkr || 0);
  const v = parseFloat(inpEl.value);
  const invalid = inpEl.value !== '' && (isNaN(v) || v <= 0 || (agentPkr > 0 && v >= agentPkr));
  inpEl.classList.toggle('is-invalid', invalid);
  inpEl.classList.add('is-dirty');

  const mEl = document.getElementById(`crs-margin-${rangeId}`);
  if (mEl) mEl.innerHTML = zyCrsFormatMarginHtml(agentPkr, inpEl.value);
  const eqEl = document.getElementById(`crs-usdeq-${rangeId}`);
  if (eqEl) eqEl.textContent = (!isNaN(v) && v > 0) ? `≈ $${zyFmtMoney((v / fx), 4)} USD` : 'Hidden from clients';
  zyCrsSyncSaveAllBtn();
};

window.zyCrsOnBatchInput = function(rangeId, inpEl) {
  const draft = zyCrsEnsureDirty(rangeId);
  if (!draft) return;
  const b = Math.min(1000, Math.max(1, parseInt(inpEl.value, 10) || 25));
  draft.batch_size = b;
  draft.allowed_quantities = [b];
  if (draft.max_hold_limit < b) {
    draft.max_hold_limit = b;
    const holdInp = document.getElementById(`crs-hold-${rangeId}`);
    if (holdInp) holdInp.value = String(b);
  }
  inpEl.classList.add('is-dirty');
  zyCrsSyncSaveAllBtn();
};

window.zyCrsOnLimitInput = function(rangeId, val, inpEl) {
  const draft = zyCrsEnsureDirty(rangeId);
  if (!draft) return;
  draft.daily_request_limit = Math.min(50, Math.max(1, parseInt(val, 10) || 1));
  if (inpEl) inpEl.classList.add('is-dirty');
  zyCrsSyncSaveAllBtn();
};

window.zyCrsOnMaxHoldInput = function(rangeId, inpEl) {
  const draft = zyCrsEnsureDirty(rangeId);
  if (!draft) return;
  const mh = Math.min(5000, Math.max(1, parseInt(inpEl.value, 10) || 25));
  draft.max_hold_limit = mh;
  inpEl.classList.add('is-dirty');
  zyCrsSyncSaveAllBtn();
};

function zyCrsRenderTable() {
  const host = document.getElementById('crs-table-host');
  if (!host) return;
  const st = window._zyCrsState;
  const fx = st.fx || 280;
  let rows = st.ranges || [];

  if (st.filter === 'pending') rows = rows.filter(r => !r.configured);
  else if (st.filter === 'configured') rows = rows.filter(r => r.configured);

  if (st.search) {
    rows = rows.filter(r =>
      String(r.range_name || '').toLowerCase().includes(st.search)
    );
  }

  if (!rows.length) {
    host.innerHTML = `<div class="zy-pro-empty">
      <div style="font-weight:700;color:var(--sp-text-primary);margin-bottom:4px;">No ranges match this view</div>
      <div>${st.filter === 'pending' ? 'All ranges already have Client PKR rates configured.' : 'Try clearing your search or switching tabs.'}</div>
    </div>`;
    zyCrsSyncSaveAllBtn();
    return;
  }

  host.innerHTML = `
    <div class="zy-pro-table-wrap" style="border:none;border-radius:0;">
      <table class="zy-pro-table">
        <thead>
          <tr>
            <th>Range</th>
            <th style="text-align:right;">Agent Payout</th>
            <th>Client Rate (PKR)</th>
            <th>Batch Size</th>
            <th>Daily Limit</th>
            <th>Max Hold / Client</th>
            <th>Status</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const draft = zyCrsGetRowDraft(r);
            const isDirty = Boolean(st.dirty[r.range_id]);
            const agentUsd = Number(r.agent_rate_usd || 0);
            const agentPkr = Number(r.agent_rate_pkr || 0);
            const valNum = parseFloat(draft.client_rate_pkr);
            const usdEqText = (!isNaN(valNum) && valNum > 0) ? `≈ $${zyFmtMoney((valNum / fx), 4)} USD` : 'Hidden from clients';
            const isInvalid = draft.client_rate_pkr !== '' && (isNaN(valNum) || valNum <= 0 || (agentPkr > 0 && valNum >= agentPkr));
            const statusText = r.configured
              ? `<span style="color:var(--sp-success);font-weight:700;font-size:12px;">Published</span>`
              : `<span style="color:#d97706;font-weight:700;font-size:12px;">Pending Setup</span>`;
            const isWnRow = Boolean(r.is_whitenoise || String(r.provider || '').toLowerCase().includes('whitenoise') || String(r.payout_schedule || '').toLowerCase() === 'monthly30_5');
            return `
              <tr class="${!r.configured ? 'zy-crs-row-pending' : ''}">
                <td>
                  <div class="${isWnRow ? 'zy-wn-range-name' : ''}" style="font-weight:700;${isWnRow ? '' : 'color:var(--sp-text-primary);'}">${zyEsc(r.range_name)}</div>
                  <div style="font-size:11px;color:var(--sp-text-muted);">
                    My Nums: <strong>${Number(r.agent_held_count || 0).toLocaleString()}</strong> · Owner Pool: <strong style="color:${Number(r.owner_pool_available ?? r.pool_available ?? 0) > 0 ? '#059669' : '#dc2626'};">${Number(r.owner_pool_available ?? r.pool_available ?? 0).toLocaleString()}</strong>
                  </div>
                </td>
                <td style="text-align:right;">
                  <div class="zy-crs-num" style="font-weight:700;color:var(--sp-text-primary);">Rs. ${zyFmtMoney(agentPkr, 4)}</div>
                  <div class="zy-crs-num" style="font-size:11px;color:var(--sp-text-muted);">$${zyFmtMoney(agentUsd, 4)} USD</div>
                </td>
                <td>
                  <input type="number" id="crs-inp-${r.range_id}" class="zy-crs-rate-inp ${isDirty ? 'is-dirty' : ''} ${isInvalid ? 'is-invalid' : ''}"
                         step="0.01" min="0.01" value="${zyEsc(draft.client_rate_pkr)}"
                         placeholder="${agentPkr > 0 ? zyFmtMoney((agentPkr * 0.8), 4) : '0.50'}"
                         oninput="zyCrsOnRateInput(${Number(r.range_id)}, this)">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px;">
                    <span id="crs-usdeq-${r.range_id}" class="zy-crs-num" style="font-size:11px;color:var(--sp-text-muted);">${usdEqText}</span>
                    <span id="crs-margin-${r.range_id}">${zyCrsFormatMarginHtml(agentPkr, draft.client_rate_pkr)}</span>
                  </div>
                </td>
                <td>
                  <input type="number" id="crs-batch-${r.range_id}" class="zy-input zy-crs-num" min="1" max="1000" style="width:74px;height:32px;padding:0 8px;font-weight:700;"
                         value="${Number(draft.batch_size || 25)}"
                         title="Numbers per batch request/allocation (default 25)"
                         oninput="zyCrsOnBatchInput(${Number(r.range_id)}, this)">
                  <div style="font-size:10.5px;color:var(--sp-text-muted);margin-top:2px;">nums / batch</div>
                </td>
                <td>
                  <input type="number" id="crs-daily-${r.range_id}" class="zy-input zy-crs-num" min="1" max="50" style="width:66px;height:32px;padding:0 8px;font-weight:700;"
                         value="${Number(draft.daily_request_limit || 1)}"
                         title="How many times per day a client can add this range"
                         oninput="zyCrsOnLimitInput(${Number(r.range_id)}, this.value, this)">
                  <div style="font-size:10.5px;color:var(--sp-text-muted);margin-top:2px;">adds / day</div>
                </td>
                <td>
                  <input type="number" id="crs-hold-${r.range_id}" class="zy-input zy-crs-num" min="1" max="5000" style="width:78px;height:32px;padding:0 8px;font-weight:700;"
                         value="${Number(draft.max_hold_limit || 25)}"
                         title="Maximum active numbers 1 client can hold in this range (default 25, e.g. 50 or 100)"
                         oninput="zyCrsOnMaxHoldInput(${Number(r.range_id)}, this)">
                  <div style="font-size:10.5px;color:var(--sp-text-muted);margin-top:2px;">max / client</div>
                </td>
                <td>
                  ${statusText}
                  ${isWnRow
                    ? `<div><span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;font-size:10px;font-weight:700;">Monthly (30/5) {W}</span></div>`
                    : `<div style="font-size:11px;color:var(--sp-text-muted);">${typeof zyPaytermBadge === 'function' ? zyPaytermBadge(r.payterm || 'Weekly') : zyEsc(r.payterm || 'Weekly')}</div>`}
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <div style="display:inline-flex;align-items:center;gap:6px;">
                    <button type="button" class="apx-btn apx-btn-icon apx-btn-small" style="color:#0284c7;border-color:#bae6fd;background:#f0f9ff;" onclick="zyCrsViewRangeSpec(${Number(r.range_id)})" title="View Range Specification"><i class="fas fa-eye"></i></button>
                    <button type="button" class="btn btn-primary btn-xs" onclick="zyCrsSaveRow(${Number(r.range_id)})">
                      <i class="fas fa-check"></i> Save
                    </button>
                    ${r.configured ? `<button type="button" class="btn btn-outline btn-xs" onclick="zyCrsUnpublishRow(${Number(r.range_id)})" title="Hide from Client Ranges Add">Hide</button>` : ''}
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  zyCrsSyncSaveAllBtn();
}

window.zyCrsViewRangeSpec = function(rangeId) {
  const st = window._zyCrsState;
  const r = (st.ranges || []).find(x => Number(x.range_id) === Number(rangeId));
  if (!r) return;
  const fx = Number(st.fx || 280);
  const pts = r.payterms || {};
  const ptInfo = typeof zyResolveRangeActivePayterms === 'function'
    ? zyResolveRangeActivePayterms(r)
    : { active: [r.payterm || 'Weekly'], primary: r.payterm || 'Weekly', isWn: Boolean(r.is_whitenoise) };
  const agentUsd = Number(r.agent_rate_usd || 0);
  const agentPkr = Number(r.agent_rate_pkr || 0);
  const draft = zyCrsGetRowDraft(r);
  const clPkr = Number(draft.client_rate_pkr || r.client_rate_pkr || 0);
  const batchSize = Number(draft.batch_size || r.batch_size || 25);
  const dailyAdds = Number(draft.daily_request_limit || r.daily_request_limit || 1);
  const maxHold = Math.max(batchSize, Number(draft.max_hold_limit || r.max_hold_limit || 25));
  const naCell = `<span class="zy-na">N/A</span>`;
  const wUsd = ptInfo.active.includes('Weekly') ? Number(pts['Weekly'] ?? pts['7/3'] ?? agentUsd) : null;
  const mUsd = ptInfo.active.includes('Monthly') ? Number(pts['Monthly'] ?? pts['30/5'] ?? agentUsd) : null;

  zyModal(`Range Specification: ${zyEsc(r.range_name)}`, `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;margin-bottom:12px;">
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-tower-broadcast" style="color:#0284c7;margin-right:4px;"></i> General Info
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Range Name:</span> <b class="${ptInfo.isWn ? 'zy-wn-range-name' : ''}">${zyEsc(r.range_name)}</b></div>
          <div><span style="color:#64748b;">Active Payterm:</span> <b class="badge badge-purple" style="font-size:10.5px;">${ptInfo.isWn ? 'Monthly (30/5) {W}' : 'Weekly (7/3)'}</b></div>
          <div><span style="color:#64748b;">Active FX:</span> <b class="monospace">1 USD = Rs. ${zyFmtMoney(fx, 2)}</b></div>
        </div>
      </div>

      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-sliders" style="color:#10b981;margin-right:4px;"></i> Per-Range Client Limits
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Client Visibility:</span> ${r.configured ? '<span class="badge badge-green">Published</span>' : '<span class="badge badge-yellow">Pending Setup</span>'}</div>
          <div><span style="color:#64748b;">Batch Size:</span> <b>${batchSize} numbers</b></div>
          <div><span style="color:#64748b;">Daily Limit:</span> <b>${dailyAdds} add(s) / day (${batchSize * dailyAdds} nums/day)</b></div>
          <div><span style="color:#64748b;">Max Hold / Client:</span> <b>${maxHold} active numbers</b></div>
          <div><span style="color:#64748b;">My Numbers:</span> <b>${Number(r.agent_held_count || 0).toLocaleString()} numbers</b></div>
          <div><span style="color:#64748b;">Owner Pool Left:</span> <b style="color:${Number(r.owner_pool_available ?? r.pool_available ?? 0) > 0 ? '#10b981' : '#dc2626'};">${Number(r.owner_pool_available ?? r.pool_available ?? 0).toLocaleString()} numbers</b></div>
          <div><span style="color:#64748b;">Allowed CLIs:</span> <small style="display:block;color:#64748b;line-height:1.3;">${zyEsc(r.cli_list || 'All CLIs')}</small></div>
        </div>
      </div>

      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-coins" style="color:#d97706;margin-right:4px;"></i> Payout vs Client PKR
        </h5>
        <table style="width:100%;font-size:11.5px;border-collapse:collapse;">
          <tbody>
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:4px 0;">Agent Payout (USD)</td><td style="text-align:right;font-weight:700;font-family:monospace;">$${zyFmtMoney(agentUsd, 4)}</td></tr>
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:4px 0;">Agent Payout (PKR)</td><td style="text-align:right;font-weight:700;font-family:monospace;">Rs. ${zyFmtMoney(agentPkr, 4)}</td></tr>
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:4px 0;">Client Rate (PKR)</td><td style="text-align:right;font-weight:800;color:#059669;font-family:monospace;">${clPkr > 0 ? 'Rs. ' + zyFmtMoney(clPkr, 4) : 'Not Set'}</td></tr>
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:4px 0;">Your Margin / SMS</td><td style="text-align:right;font-weight:700;color:#2563eb;font-family:monospace;">${clPkr > 0 && agentPkr > 0 ? '+Rs. ' + zyFmtMoney((agentPkr - clPkr), 4) : '—'}</td></tr>
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:4px 0;">Weekly (7/3 USD)</td><td style="text-align:right;font-family:monospace;">${wUsd !== null ? '$' + zyFmtMoney(wUsd, 4) : naCell}</td></tr>
            <tr><td style="padding:4px 0;">Monthly (30/5) {W} USD</td><td style="text-align:right;font-family:monospace;">${mUsd !== null ? '$' + zyFmtMoney(mUsd, 4) : naCell}</td></tr>
          </tbody>
        </table>
      </div>
    </div>`, `<button type="button" class="zy-btn-grey" onclick="closeModal()">Close</button>`);
};

window.zyCrsSaveRow = async function(rangeId) {
  const st = window._zyCrsState;
  const r = (st.ranges || []).find(x => Number(x.range_id) === Number(rangeId));
  if (!r) return;
  const draft = zyCrsGetRowDraft(r);
  const pkr = parseFloat(draft.client_rate_pkr);
  if (isNaN(pkr) || pkr <= 0) {
    toast(`Enter a valid positive PKR rate for ${r.range_name}`, 'error');
    return;
  }
  if (Number(r.agent_rate_pkr) > 0 && pkr >= Number(r.agent_rate_pkr)) {
    toast(`Client PKR rate (Rs. ${zyFmtMoney(pkr, 4)}) must be strictly less than Rs. ${zyFmtMoney(Number(r.agent_rate_pkr), 4)}`, 'error');
    return;
  }
  const batchSize = Math.min(1000, Math.max(1, parseInt(draft.batch_size, 10) || 25));
  const dailyLimit = Math.min(50, Math.max(1, parseInt(draft.daily_request_limit, 10) || 1));
  const maxHold = Math.min(5000, Math.max(batchSize, parseInt(draft.max_hold_limit, 10) || batchSize));
  const res = await apiFetch('/api/agent/client-rates', {
    method: 'PUT',
    body: JSON.stringify({
      range_id: Number(rangeId),
      client_rate_pkr: pkr,
      batch_size: batchSize,
      allowed_quantities: [batchSize],
      daily_request_limit: dailyLimit,
      max_hold_limit: maxHold,
      published: true
    })
  });
  if (res && res.success) {
    delete st.dirty[rangeId];
    toast(`Saved ${r.range_name} (Batch: ${batchSize}, Daily: ${dailyLimit}x, Max Hold: ${maxHold})`, 'success');
    await zyCrsReload(true);
  }
};

window.zyCrsSaveAllModified = async function() {
  const st = window._zyCrsState;
  const dirtyIds = Object.keys(st.dirty || {});
  if (!dirtyIds.length) return;
  const items = [];
  for (const idStr of dirtyIds) {
    const rid = Number(idStr);
    const r = (st.ranges || []).find(x => Number(x.range_id) === rid);
    const d = st.dirty[idStr];
    const pkr = parseFloat(d.client_rate_pkr);
    if (!r || isNaN(pkr) || pkr <= 0) {
      toast(`Invalid PKR rate on ${r?.range_name || 'range #' + rid}`, 'error');
      return;
    }
    if (Number(r.agent_rate_pkr) > 0 && pkr >= Number(r.agent_rate_pkr)) {
      toast(`${r.range_name}: Rs. ${zyFmtMoney(pkr, 4)} must be less than Rs. ${zyFmtMoney(Number(r.agent_rate_pkr), 4)}`, 'error');
      return;
    }
    const batchSize = Math.min(1000, Math.max(1, parseInt(d.batch_size, 10) || 25));
    const dailyLimit = Math.min(50, Math.max(1, parseInt(d.daily_request_limit, 10) || 1));
    const maxHold = Math.min(5000, Math.max(batchSize, parseInt(d.max_hold_limit, 10) || batchSize));
    items.push({
      range_id: rid,
      client_rate_pkr: pkr,
      batch_size: batchSize,
      allowed_quantities: [batchSize],
      daily_request_limit: dailyLimit,
      max_hold_limit: maxHold,
      published: true
    });
  }
  const res = await apiFetch('/api/agent/client-rates', {
    method: 'PUT',
    body: JSON.stringify({ items })
  });
  if (res && res.success) {
    st.dirty = {};
    toast(`Saved ${res.saved_count || items.length} range configuration(s)`, 'success');
    await zyCrsReload(true);
  }
};

window.zyCrsUnpublishRow = async function(rangeId) {
  const res = await apiFetch(`/api/agent/client-rates/${encodeURIComponent(rangeId)}`, { method: 'DELETE' });
  if (res && res.success) {
    delete window._zyCrsState.dirty[rangeId];
    toast('Range hidden from Client Rate Card', 'info');
    await zyCrsReload(true);
  }
};

window.zyCrsSaveTarget = async function(reloadClientPayouts = false) {
  const valRaw = document.getElementById('crs-target-val')?.value;
  const val = (valRaw === '' || valRaw == null) ? 0 : parseFloat(valRaw);
  const mode = document.getElementById('crs-target-mode')?.value === 'block' ? 'block' : 'warn';
  if (isNaN(val) || val < 0) {
    toast('Enter 0 or a positive Weekly PKR Target amount', 'error');
    return;
  }
  const minEl = document.getElementById('crs-client-min-payout');
  const payload = { weekly_pkr_target: val, weekly_pkr_enforce_mode: mode };
  if (minEl) {
    const rawMin = String(minEl.value ?? '').trim();
    if (rawMin === '') {
      payload.client_min_payout_pkr = null;
    } else {
      const mp = parseFloat(rawMin);
      if (isNaN(mp) || mp < 0) {
        toast('Enter 0 or a positive Client Min Payout (PKR) amount', 'error');
        return;
      }
      payload.client_min_payout_pkr = mp;
    }
  }
  const btn = document.getElementById('crs-save-target-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const res = await apiFetch('/api/agent/pkr-target', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Save Target'; }
  if (res && res.success) {
    window._zyAgentRatesCache = null;
    toast('Client PKR target & minimum payout updated', 'success');
    if (reloadClientPayouts || document.getElementById('cpr-agt-body')) {
      pgClientPaymentRequests(window._zyAgtCprTab || 'all');
    } else {
      await zyCrsReload(true);
    }
  }
};

/* ═══ MY SMS NUMBERS ════════════════════════════════════════ */
let ZY_ALL_NUMS = [];
let ZY_RANGES_LOOKUP = {};

async function pgMySmsNumbers() {
  const c = document.getElementById('page-content');
  zyCrumb(['SMS Module', 'My SMS Numbers']);
  if (typeof window.zyResetMyNumDisplayMode === 'function') window.zyResetMyNumDisplayMode();
  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-hashtag" style="color:#2563eb;"></i> My SMS Numbers</div>
        <div class="page-subtitle">Numbers assigned to your account. Allocate to clients, return to pool or move. (Weekly 7/3 · Monthly 30/5 {W})</div>
      </div>
    </div>

    <!-- Video-Accurate My SMS Numbers Filter & Action Card (Frame 02) -->
    <div class="zy-num-card zy-filter-grid card" style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div class="zy-filter-grid-fields" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;align-items:flex-end;">
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="num-range" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;display:block;">Range</label>
          <select id="num-range" class="zy-filter-input" style="width:100%;height:38px;min-height:38px;border-radius:6px;border:1.5px solid #cbd5e1;padding:0 10px;font-size:13px;background:#ffffff;box-sizing:border-box;" onchange="zyApplyFilters()">
            <option value="">All Ranges</option>
          </select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="num-client" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;display:block;">Client</label>
          <select id="num-client" class="zy-filter-input" style="width:100%;height:38px;min-height:38px;border-radius:6px;border:1.5px solid #cbd5e1;padding:0 10px;font-size:13px;background:#ffffff;box-sizing:border-box;" onchange="zyApplyFilters()">
            <option value="">All</option>
          </select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="num-status" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;display:block;">Status</label>
          <select id="num-status" class="zy-filter-input" style="width:100%;height:38px;min-height:38px;border-radius:6px;border:1.5px solid #cbd5e1;padding:0 10px;font-size:13px;background:#ffffff;box-sizing:border-box;" onchange="zyApplyFilters()">
            <option value="">All</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="num-starts-with" style="font-size:11.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;display:block;">Number starts with</label>
          <input type="text" id="num-starts-with" class="zy-filter-input" placeholder="Number starts with..." style="width:100%;height:38px;min-height:38px;border-radius:6px;border:1.5px solid #cbd5e1;padding:0 10px;font-size:13px;background:#ffffff;box-sizing:border-box;" oninput="zyApplyFilters()">
        </div>
        <div class="zy-filter-field" style="grid-column: 1 / -1; display: none;">
          <input type="text" id="num-range-contains" class="zy-filter-input" placeholder="Range contains..." oninput="zyApplyFilters()">
        </div>
      </div>

      <div class="zy-filter-actions" style="margin-top:14px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="zy-btn-blue-solid" style="height:38px;padding:0 20px;font-size:12.5px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;" onclick="zyApplyFilters()">
          <i class="fas fa-filter"></i> Filter
        </button>
        <button type="button" class="zy-btn-reset" style="height:38px;padding:0 18px;font-size:12.5px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;" onclick="zyResetFilters()">
          <i class="fas fa-undo"></i> Reset
        </button>
      </div>

      <div class="zy-num-row-2">
        <button type="button" id="btn-act-allocate" class="zy-btn-allocate-light" onclick="zyActionAllocate()">
          <i class="fas fa-user-plus"></i> <span id="lbl-act-allocate">Allocate</span>
        </button>
        <button type="button" id="btn-act-unallocate" class="zy-btn-unallocate-light" onclick="zyActionUnallocate()">
          <i class="fas fa-rotate-left"></i> <span id="lbl-act-unallocate">Unallocate</span>
        </button>
      </div>

      <div class="zy-num-row-full">
        <button type="button" id="btn-act-return" class="zy-btn-return-light" onclick="zyActionReturn()">
          <i class="fas fa-arrow-up"></i> <span id="lbl-act-return">Return</span>
        </button>
      </div>
    </div>

    <!-- Table Panel with Toolbar matching Frame 02 -->
    <div class="zy-panel" style="border:1px solid #cbd5e1;border-radius:4px;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <div class="zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #cbd5e1;flex-wrap:wrap;gap:8px;">
        <span style="font-weight:700;font-size:14px;color:#1e293b;">My SMS Numbers</span>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${typeof window.zyRenderMyNumDisplayControl === 'function' ? window.zyRenderMyNumDisplayControl('zyAgentOnNumDisplayChange', 'dt-numbers') : ''}
          <button type="button" class="zy-act zy-act-blue zy-act-wide" onclick="zyActionMove()" title="Move number directly from Client A to Client B"><i class="fas fa-right-left" style="margin-right:4px;"></i> Move</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="loadPage('transfer-history')" title="View Transfer History"><i class="fas fa-clock-rotate-left"></i> Transfer History</button>
        </div>
      </div>
      <div class="zy-panel-body" style="padding:14px;"><div class="zy-loading">Loading numbers…</div></div>
    </div>
    ${typeof zyRenderFab === 'function' ? zyRenderFab('Need numbers? Tap here', 'zyActionAllocate()') : ''}`;


  const [nums, ranges, clientsRes, crsRes] = await Promise.all([
    apiFetch(AGENT_ID ? `/api/numbers?agent_id=${encodeURIComponent(AGENT_ID)}&limit=100000` : '/api/numbers?limit=100000'),
    apiFetch('/api/numbers/sms-ranges').catch(() => []),
    apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=500`).catch(() => ({ data: [] })),
    zyFetchAgentClientRates(true).catch(() => null)
  ]);

  if (crsRes && Array.isArray(crsRes.ranges)) {
    window._zyAgentClientRatesCache = crsRes;
  }
  ZY_ALL_NUMS = zyList(nums);
  ZY_RANGES = zyList(ranges).slice().sort((a, b) => String(a.range_name || a.name || a.country || '').localeCompare(String(b.range_name || b.name || b.country || ''), undefined, { sensitivity: 'base' }));
  ZY_CLIENTS = zyList(clientsRes).slice().sort((a, b) => String(a.username || '').localeCompare(String(b.username || ''), undefined, { sensitivity: 'base' }));

  ZY_RANGES_LOOKUP = {};
  ZY_RANGES.forEach(r => {
    if (r.id) ZY_RANGES_LOOKUP[r.id] = r;
    if (r.range_name) ZY_RANGES_LOOKUP[r.range_name] = r;
    if (r.name) ZY_RANGES_LOOKUP[r.name] = r;
    if (r.country && r.provider) ZY_RANGES_LOOKUP[`${r.country}|${r.provider}`] = r;
  });

  // Populate Range dropdown (A-Z)
  const rangeSel = document.getElementById('num-range');
  if (rangeSel) {
    const uniqueRanges = [];
    const seenR = new Set();
    ZY_ALL_NUMS.forEach(n => {
      const rName = n.range_name || n.range_label || n.range || n.country || '';
      if (rName && !seenR.has(rName)) {
        seenR.add(rName);
        uniqueRanges.push({ id: n.range_id || rName, name: rName });
      }
    });
    uniqueRanges.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
    rangeSel.innerHTML = '<option value="">All Ranges</option>' +
      uniqueRanges.map(r => `<option value="${zyEsc(r.name)}">${zyEsc(r.name)}</option>`).join('');
  }

  // Populate Client dropdown (A-Z)
  const clientSel = document.getElementById('num-client');
  if (clientSel) {
    clientSel.innerHTML = '<option value="">All Clients</option>' +
      ZY_CLIENTS.map(cl => `<option value="${cl.id}">${zyEsc(cl.username)}</option>`).join('');
  }

  zyRenderNumbersTable(ZY_ALL_NUMS);
}

function zyGetRangeForNumber(n) {
  if (n.range_id && ZY_RANGES_LOOKUP[n.range_id]) return ZY_RANGES_LOOKUP[n.range_id];
  const rName = n.range_name || n.range_label || n.range;
  if (rName && ZY_RANGES_LOOKUP[rName]) return ZY_RANGES_LOOKUP[rName];
  if (n.country && n.provider && ZY_RANGES_LOOKUP[`${n.country}|${n.provider}`]) return ZY_RANGES_LOOKUP[`${n.country}|${n.provider}`];
  return null;
}

function zyGetAgentRateForNumber(n) {
  if (n.agent_rate !== undefined && n.agent_rate !== null && !isNaN(Number(n.agent_rate)) && Number(n.agent_rate) > 0) {
    return Number(n.agent_rate);
  }
  const r = zyGetRangeForNumber(n);
  if (r) {
    const term = n.payterm || n.agent_payterm || 'Weekly';
    const pts = r.payterms || {};
    if (pts[term] !== undefined && !isNaN(Number(pts[term]))) return Number(pts[term]);
    if (pts['Weekly'] !== undefined && !isNaN(Number(pts['Weekly']))) return Number(pts['Weekly']);
    if (r.payout !== undefined && !isNaN(Number(r.payout))) return Number(r.payout);
    if (r.sell_rate !== undefined && !isNaN(Number(r.sell_rate))) return Number(r.sell_rate);
  }
  if (n.payout !== undefined && n.payout !== null && !isNaN(Number(n.payout))) return Number(n.payout);
  return 0;
}

window.zySyncSelectionBar = function(id) {
  if (id === 'dt-numbers') {
    const n = (typeof zy2Checked === 'function' ? zy2Checked('dt-numbers') : []).length;
    const l1 = document.getElementById('lbl-act-allocate');
    const l2 = document.getElementById('lbl-act-unallocate');
    const l3 = document.getElementById('lbl-act-return');
    if (l1) l1.textContent = n > 0 ? `Allocate (${n})` : 'Allocate';
    if (l2) l2.textContent = n > 0 ? `Unallocate (${n})` : 'Unallocate';
    if (l3) l3.textContent = n > 0 ? `Return (${n})` : 'Return';
  }
};

function zyIsWhitenoiseObj(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const pt = String(obj.payterm || obj.client_payterm || obj.agent_payterm || '').toLowerCase();
  return Boolean(
    obj.is_whitenoise ||
    String(obj.provider || '').toLowerCase().includes('whitenoise') ||
    String(obj.payout_schedule || '').toLowerCase() === 'monthly30_5' ||
    pt === 'monthly' || pt === '30/5' || pt === 'monthly30_5'
  );
}

window.zyAgentFetchWhitenoiseOtp = async function(id, btn) {
  const prevHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching…'; }
  try {
    const res = await apiFetch(`/api/numbers/${encodeURIComponent(id)}/whitenoise-fetch`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (res && res.success) {
      const nNew = Number(res.new_sms ?? res.ingested ?? 0);
      const nTotal = Number(res.fetched_count ?? res.count ?? res.fetched ?? (res.latest_sms ? res.latest_sms.length : 0));
      toast(nNew > 0 ? `Fetched ${nNew} new OTP SMS (total matched: ${nTotal})` : `Checked live feed (${nTotal} matched, 0 new)`, nNew > 0 ? 'success' : 'info');
      if (nNew > 0 && typeof pgMySmsNumbers === 'function') pgMySmsNumbers();
    } else {
      toast(res?.error || 'Live OTP fetch failed', 'error');
    }
  } catch (err) {
    toast(err.message || 'Live OTP fetch failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = prevHtml || '<i class="fas fa-bolt"></i> Fetch OTP'; }
  }
};

function zyRenderNumbersTable(numsList) {
  const c = document.getElementById('page-content');
  if (!c) return;

  const rows = (numsList || []).map(n => {
    const dateCell = typeof zyFormatNumberDateCell === 'function'
      ? zyFormatNumberDateCell(n, 'agent')
      : { v: String(n.assigned_at || n.created || '').slice(0, 10), h: String(n.assigned_at || n.created || '—').slice(0, 10) };
    const rangeName = n.range_name || n.range_label || n.range || n.country || '—';
    const cleanPrefix = String(n.prefix || '').trim().replace(/^\++/, '');
    const cleanNumber = String(n.number || '').trim().replace(/^\++/, '');
    const agentRate = zyGetAgentRateForNumber(n);
    const clientName = n.client_id
      ? (zyClientName(n.client_id) || n.client_username || n.client_name || `Client #${n.client_id}`)
      : '';
    const clientPayoutVal = (n.client_rate !== undefined && n.client_rate !== null) ? n.client_rate : (n.client_payout ?? '');
    const clientPkrVal = (n.client_rate_pkr !== undefined && n.client_rate_pkr !== null && Number(n.client_rate_pkr) > 0) ? Number(n.client_rate_pkr) : null;
    const clientPayoutDisplay = clientPkrVal !== null
      ? `<span class="zy-crs-num" style="font-weight:700;color:#059669;">Rs. ${zyFmtMoney(clientPkrVal, 4)} PKR</span>` + (clientPayoutVal !== '' ? `<div class="zy-crs-num" style="font-size:10.5px;color:#64748b;">$${zyFmtMoney(Number(clientPayoutVal), 4)}</div>` : '')
      : (clientPayoutVal !== '' ? `$${zyFmtMoney(Number(clientPayoutVal), 4)}` : zyNA(''));
    const isWn = zyIsWhitenoiseObj(n) || zyIsWhitenoiseObj(zyGetRangeForNumber(n));
    const rawTerm = isWn ? 'Monthly' : String(n.client_payterm || n.payterm || n.agent_payterm || 'Weekly');
    const planDisplay = isWn
      ? `<span class="zy-payterm-badge zy-pt-monthly">Monthly (30/5) {W}</span>`
      : (typeof zyPaytermBadge === 'function' ? zyPaytermBadge(rawTerm) : `<span class="badge badge-blue" style="font-weight:700;">${zyEsc(rawTerm)}</span>`);
    const limitsDisplay = `<span class="zy-crs-num" style="font-size:11.5px;color:#475569;">${Number(n.sms_daily || 0)}/d · ${Number(n.sms_weekly || 0)}/w</span>`;
    const isBlockedNum = String(n.status || '').toLowerCase() === 'blocked' || Boolean(n.inactivity_flagged);
    const statusDisplay = isBlockedNum
      ? `<span style="display:inline-flex;align-items:center;gap:4px;color:#dc2626;font-weight:700;background:#fef2f2;border:1px solid #fecaca;padding:2px 8px;border-radius:6px;"><i class="fas fa-ban" style="color:#dc2626;"></i> Blocked${n.inactivity_days_limit ? ` (${n.inactivity_days_limit}d)` : ''}</span>`
      : `<span style="display:inline-flex;align-items:center;gap:4px;color:#10b981;font-weight:600;"><i class="fas fa-check-circle" style="color:#10b981;"></i> Active</span>`;
    const actionDisplay = isWn
      ? `<button type="button" class="apx-btn apx-btn-small" style="color:#4338ca;border-color:#c7d2fe;background:#eef2ff;font-weight:700;" onclick="zyAgentFetchWhitenoiseOtp(${Number(n.id)}, this)" title="Fetch live OTP"><i class="fas fa-bolt"></i> Fetch OTP</button>`
      : `<span style="color:#94a3b8;font-size:11px;">—</span>`;

    const displayNumber = typeof window.zyFormatMyNumberDisplay === 'function'
      ? window.zyFormatMyNumberDisplay(cleanNumber, cleanPrefix)
      : cleanNumber;
    const rawNumberHtml = typeof zyRenderNumberCopyBox === 'function'
      ? zyRenderNumberCopyBox(displayNumber, { isWn })
      : `<span class="${isWn ? 'zy-wn-number' : ''}" style="font-family:monospace;font-weight:700;${isWn ? '' : 'color:var(--brand-primary,#166534);'}">${zyEsc(displayNumber)}</span>`;
    const numberHtml = isBlockedNum
      ? `<span style="font-family:monospace;font-weight:800;color:#dc2626;background:#fef2f2;padding:3px 7px;border-radius:6px;border:1px solid #fecaca;display:inline-flex;align-items:center;gap:5px;"><i class="fas fa-circle-xmark" style="font-size:11px;"></i>${zyEsc(displayNumber)}</span>`
      : rawNumberHtml;

    const rangeCellHtml = isWn
      ? `<div class="zy-wn-cell-accent"><span class="${isBlockedNum ? '' : 'zy-wn-range-name'}" style="font-weight:600;${isBlockedNum ? 'color:#dc2626;' : ''}">${zyEsc(rangeName)}</span> <span class="zy-wn-route-tag">{W} Monthly</span></div>`
      : `<span style="font-weight:600;${isBlockedNum ? 'color:#dc2626;' : ''}">${zyEsc(rangeName)}</span>`;

    const r = [
      dateCell,
      { v: rangeName, h: rangeCellHtml },
      { v: cleanPrefix, h: cleanPrefix || '—' },
      { v: displayNumber, h: numberHtml },
      { v: agentRate, h: `<span style="font-weight:700;color:var(--brand-accent,#4ade80);">$${zyFmtMoney(agentRate, 4)}</span>` },
      { v: clientName || '—', h: clientName ? `<span class="fw-600">${zyEsc(clientName)}</span>` : '—' },
      { v: clientPkrVal !== null ? clientPkrVal : (clientPayoutVal !== '' ? Number(clientPayoutVal) : 0), h: clientPayoutDisplay },
      { v: isWn ? 'Monthly (30/5) {W}' : rawTerm, h: planDisplay },
      { v: (n.sms_daily || 0) + (n.sms_weekly || 0), h: limitsDisplay },
      { v: n.status || 'active', h: statusDisplay },
      { v: isWn ? 'fetch' : '', h: actionDisplay }
    ];
    r.__id = n.id;
    r.__raw = n;
    return r;
  });

  ZY_NUMROWS = rows;
  const body = c.querySelector('.zy-panel-body');
  if (body) {
    body.innerHTML = zyDT2('dt-numbers', {
      cols: ['Date', 'Range', 'Prefix', 'Number', 'My Payout', 'Client', 'Client payout', 'Plan', 'Limits', 'Status', 'Actions'],
      rows,
      check: true
    });
    zy2Render('dt-numbers');
    if (typeof window.zySyncSelectionBar === 'function') window.zySyncSelectionBar('dt-numbers');
  }
}

window.zyAgentOnNumDisplayChange = function(mode) {
  if (typeof window.zySetMyNumDisplayMode === 'function') {
    window.zySetMyNumDisplayMode(mode, () => zyApplyFilters());
  }
};

function zyApplyFilters() {
  const rVal = (document.getElementById('num-range')?.value || '').toLowerCase();
  const cVal = document.getElementById('num-client')?.value || '';
  const sVal = document.getElementById('num-status')?.value || '';
  const startsWith = (document.getElementById('num-starts-with')?.value || '').trim().replace(/^\++/, '');
  const rangeContains = (document.getElementById('num-range-contains')?.value || '').toLowerCase().trim();

  const filtered = ZY_ALL_NUMS.filter(n => {
    if (rVal) {
      const rName = (n.range_name || n.range_label || n.range || n.country || '').toLowerCase();
      if (!rName.includes(rVal)) return false;
    }
    if (rangeContains) {
      const rName = (n.range_name || n.range_label || n.range || n.country || '').toLowerCase();
      if (!rName.includes(rangeContains)) return false;
    }
    if (startsWith) {
      const numStr = String(n.number || '').trim().replace(/^\++/, '');
      const localStr = typeof window.zyStripCountryPrefix === 'function' ? window.zyStripCountryPrefix(numStr, n.prefix) : numStr;
      if (!numStr.startsWith(startsWith) && !localStr.startsWith(startsWith)) return false;
    }
    if (cVal) {
      if (String(n.client_id) !== String(cVal)) return false;
    }
    if (sVal) {
      if (sVal === 'assigned' && !n.client_id) return false;
      if (sVal === 'unassigned' && n.client_id) return false;
      if (sVal === 'active' && n.status !== 'active') return false;
      if (sVal === 'inactive' && n.status !== 'inactive') return false;
    }
    return true;
  });

  zyRenderNumbersTable(filtered);
}

function zyResetFilters() {
  const r = document.getElementById('num-range'); if (r) r.value = '';
  const cl = document.getElementById('num-client'); if (cl) cl.value = '';
  const st = document.getElementById('num-status'); if (st) st.value = '';
  const sw = document.getElementById('num-starts-with'); if (sw) sw.value = '';
  const rc = document.getElementById('num-range-contains'); if (rc) rc.value = '';
  zyRenderNumbersTable(ZY_ALL_NUMS);
}

function zyGetSelectedNumbers() {
  const ids = zy2Checked('dt-numbers');
  const t = ZYT2['dt-numbers'];
  if (!t || !ids.length) return [];
  const idSet = new Set(ids.map(String));
  return t.rows.filter(r => idSet.has(String(r.__id))).map(r => r.__raw);
}

// ── BUTTON 1: ALLOCATE (auto-inherits Client Rate Set PKR rate; optional manual USD override) ──
async function zyActionAllocate() {
  const selected = zyGetSelectedNumbers();
  if (!selected.length) {
    toast('Select at least one number to Allocate', 'warning');
    return;
  }
  if (!ZY_CLIENTS.length) {
    toast('No clients found. Create a client first.', 'error');
    return;
  }

  const sampleNum = selected[0];
  const initialAgentRate = zyGetAgentRateForNumber(sampleNum);
  const range = zyGetRangeForNumber(sampleNum) || {};
  const rPts = range.payterms || {};

  const crData = await zyFetchAgentClientRates().catch(() => null);
  const fx = Number(crData?.usd_to_pkr_rate || window._zyAgentFxRate || 280);
  const rangeName = range.range_name || range.name || sampleNum.range_name || sampleNum.country || '';
  const acr = zyFindClientRateForRange(crData, sampleNum.range_id || range.id, rangeName);
  const hasAutoRate = Boolean(acr && acr.configured && Number(acr.client_rate_pkr) > 0);
  const safeDefaultUsd = hasAutoRate
    ? Number(acr.client_rate_usd_eq || (Number(acr.client_rate_pkr) / fx))
    : (initialAgentRate > 0 ? Number(zyFmtMoney((initialAgentRate * 0.9), 4)) : 0);

  window._allocSelectedNums = selected;
  window._allocRangePayterms = rPts;
  window._allocHasRateSet = hasAutoRate;
  window._allocAcrEntry = acr;
  window._allocFxRate = fx;
  const hasWn = selected.some(n => zyIsWhitenoiseObj(n) || zyIsWhitenoiseObj(zyGetRangeForNumber(n)));
  window._allocIsWhitenoise = hasWn;

  zyModal('Allocate Numbers to Client', `
    <div style="background:var(--sp-bg-subtle,#f8fafc);border:1px solid var(--sp-border,#e2e8f0);padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:12px;line-height:1.55;">
      <div><strong>Selected:</strong> ${selected.length} number(s) (${selected.slice(0, 3).map(n => n.number).join(', ')}${selected.length > 3 ? '...' : ''})</div>
      <div><strong>Range:</strong> ${zyEsc(rangeName || '—')}</div>
      <div><strong>My Payout (Agent Rate):</strong> <span id="alloc-agent-rate-val" class="zy-crs-num" style="color:#059669;font-weight:700;">$${zyFmtMoney(initialAgentRate, 4)} (Rs. ${zyFmtMoney((initialAgentRate * fx), 2)} PKR)</span></div>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">Target Client *</label>
      <select id="alloc-client-id" class="zy-input" style="width:100%;height:34px;">
        <option value="">— Select Client —</option>
        ${ZY_CLIENTS.map(c => `<option value="${c.id}">${zyEsc(c.username)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">Client Payterm (client_payterm) *</label>
      <select id="alloc-client-payterm" class="zy-input" style="width:100%;height:34px;" onchange="zyOnAllocPaytermChange()" disabled>
        ${hasWn
          ? `<option value="Monthly" selected>Monthly (30/5) {W} — 5d Hold (Locked)</option>`
          : `<option value="Weekly" selected>Weekly (7/3) — 3 Day Hold (Locked)</option>`}
      </select>
      ${hasWn
        ? `<small style="display:block;margin-top:4px;color:#4338ca;font-weight:600;font-size:11px;">Monthly (30/5) {W} routes are locked to 5 day hold.</small>`
        : `<small style="display:block;margin-top:4px;color:#475569;font-weight:600;font-size:11px;">Standard routes are locked to Weekly (7/3) — 3 day hold.</small>`}
    </div>
    ${hasAutoRate ? `
      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12.5px;">
        <div style="font-weight:700;color:#059669;">Auto-Inherited from Client Rate Set</div>
        <div class="zy-crs-num" style="margin-top:3px;font-weight:700;color:var(--sp-text-primary);">
          Rs. ${zyFmtMoney(Number(acr.client_rate_pkr), 4)} PKR / SMS
          <span style="font-size:11.5px;font-weight:500;color:var(--sp-text-secondary);">(≈ $${zyFmtMoney(Number(safeDefaultUsd), 4)} @ ${fx} FX)</span>
        </div>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;cursor:pointer;font-size:12px;color:var(--sp-text-secondary);">
          <input type="checkbox" id="alloc-use-override" onchange="document.getElementById('alloc-override-wrap').style.display = this.checked ? 'block' : 'none';">
          Override rate manually (USD)
        </label>
      </div>
    ` : `
      <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.35);border-radius:8px;padding:9px 12px;margin-bottom:10px;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span>No Client Rate Set for this range yet.</span>
        <button type="button" class="btn btn-outline btn-xs" onclick="closeModal();loadPage('client-rate-set')">Configure PKR Rate</button>
      </div>
    `}
    <div class="form-group" id="alloc-override-wrap" style="margin-bottom:12px;display:${hasAutoRate ? 'none' : 'block'};">
      <label class="zy-lbl" style="font-weight:600;">Custom Client Rate (client_rate USD) *</label>
      <input type="number" id="alloc-client-rate" class="zy-input zy-crs-num" step="0.0001" value="${zyFmtMoney(safeDefaultUsd, 4)}" style="width:100%;height:34px;">
      <small class="text-muted" style="display:block;margin-top:4px;font-size:11px;">
        Must be strictly below your Agent Rate (<span id="alloc-cap-hint">$${zyFmtMoney(initialAgentRate, 4)}</span>).
      </small>
    </div>
  `, `
    <button class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button class="zy-btn-blue" id="btn-do-allocate" onclick="zySubmitAllocate()"><i class="fas fa-check"></i> Allocate</button>
  `);
}

function zyOnAllocPaytermChange() {
  const term = document.getElementById('alloc-client-payterm')?.value || 'Weekly';
  const rPts = window._allocRangePayterms || {};
  const selected = window._allocSelectedNums || [];
  const sample = selected[0] || {};
  const fx = window._allocFxRate || 280;

  let agentRate = (sample.agent_rate !== undefined && sample.agent_rate !== null && Number(sample.agent_rate) > 0)
    ? Number(sample.agent_rate)
    : null;

  if (!agentRate) {
    if (rPts[term] !== undefined && !isNaN(Number(rPts[term]))) {
      agentRate = Number(rPts[term]);
    } else if (rPts['Weekly'] !== undefined && !isNaN(Number(rPts['Weekly']))) {
      agentRate = Number(rPts['Weekly']);
    } else {
      agentRate = 0;
    }
  }

  const rateEl = document.getElementById('alloc-agent-rate-val');
  const capHint = document.getElementById('alloc-cap-hint');
  const input = document.getElementById('alloc-client-rate');
  if (rateEl) rateEl.textContent = `$${zyFmtMoney(agentRate, 4)} (Rs. ${zyFmtMoney((agentRate * fx), 2)} PKR)`;
  if (capHint) capHint.textContent = `$${zyFmtMoney(agentRate, 4)}`;
  if (input && !window._allocHasRateSet) {
    input.value = agentRate > 0 ? zyFmtMoney((agentRate * 0.9), 4) : '0';
  }
}

async function zySubmitAllocate() {
  const clientId = document.getElementById('alloc-client-id')?.value;
  const clientPayterm = document.getElementById('alloc-client-payterm')?.value || 'Weekly';
  const useOverride = !window._allocHasRateSet || Boolean(document.getElementById('alloc-use-override')?.checked);
  const clientRate = parseFloat(document.getElementById('alloc-client-rate')?.value);
  const selected = window._allocSelectedNums || [];

  if (!clientId) { toast('Please select a client', 'error'); return; }
  if (useOverride && (isNaN(clientRate) || clientRate < 0)) { toast('Enter a valid client rate', 'error'); return; }
  if (!selected.length) { toast('No numbers selected', 'error'); return; }

  const btn = document.getElementById('btn-do-allocate');
  if (btn) { btn.disabled = true; btn.textContent = 'Allocating...'; }

  const numberIds = selected.map(n => n.id);
  const payload = {
    number_ids: numberIds,
    target_type: 'client',
    target_id: Number(clientId),
    client_id: Number(clientId),
    client_payterm: clientPayterm,
    payterm: clientPayterm
  };
  if (useOverride) {
    payload.client_rate = clientRate;
    payload.client_payout = clientRate;
  }

  try {
    const res = await apiFetch('/api/numbers/bulk-assign-many', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res && (res.success || res.updated || res.count !== undefined)) {
      closeModal();
      toast(`Successfully allocated ${numberIds.length} number(s) to client`, 'success');
      loadPage('my-sms-numbers');
    } else {
      const errMsg = res?.error || res?.message || 'Server refused allocation';
      toast(errMsg, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Allocate'; }
    }
  } catch (err) {
    console.error('Allocate error:', err);
    toast(err.message || 'Allocation rejected', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Allocate'; }
  }
}

// ── BUTTON 2: UNALLOCATE (take back into agent pool) ──
async function zyActionUnallocate() {
  const selected = zyGetSelectedNumbers();
  if (!selected.length) {
    toast('Select at least one number to Unallocate', 'warning');
    return;
  }
  const assigned = selected.filter(n => n.client_id);
  if (!assigned.length) {
    toast('None of the selected numbers are currently allocated to a client', 'warning');
    return;
  }
  if (!(await zyConfirm(`Unallocate ${assigned.length} number(s) back to your agent pool?`, { title: 'Unallocate Numbers', confirmLabel: 'Unallocate' }))) return;

  const ids = assigned.map(n => n.id);
  try {
    const res = await apiFetch('/api/numbers/bulk-unassign-many', {
      method: 'POST',
      body: JSON.stringify({ number_ids: ids })
    });
    if (res && res.error) {
      toast(res.error, 'error');
    } else {
      toast(`Unallocated ${assigned.length} number(s) back to pool`, 'success');
      loadPage('my-sms-numbers');
    }
  } catch (err) {
    toast(err.message || 'Failed to unallocate numbers', 'error');
  }
}

// ── BUTTON 3: RETURN (return to upstream holder, POST /api/numbers/return) ──
async function zyActionReturn() {
  const selected = zyGetSelectedNumbers();
  if (!selected.length) {
    toast('Select at least one number to Return', 'warning');
    return;
  }
  if (!(await zyConfirm(`Return ${selected.length} number(s) to your upstream holder?`, { title: 'Return Numbers', confirmLabel: 'Return' }))) return;

  const ids = selected.map(n => n.id);
  try {
    const res = await apiFetch('/api/numbers/return', {
      method: 'POST',
      body: JSON.stringify({ number_ids: ids })
    });
    if (res && res.error) {
      toast(res.error, 'error');
    } else {
      toast(`Returned ${res?.count || selected.length} number(s) to upstream holder`, 'success');
      loadPage('my-sms-numbers');
    }
  } catch (err) {
    toast(err.message || 'Failed to return numbers', 'error');
  }
}

// ── BUTTON 4: MOVE (client A -> client B, POST /api/numbers/:id/move) ──
async function zyActionMove() {
  const selected = zyGetSelectedNumbers();
  if (!selected.length) {
    toast('Select a number to Move', 'warning');
    return;
  }
  if (selected.length > 1) {
    toast('Please select exactly one number to Move between clients', 'info');
  }
  const targetNum = selected[0];
  if (!targetNum.client_id) {
    toast(`Number ${targetNum.number} is not assigned to any client yet. Use Allocate instead.`, 'warning');
    return;
  }
  const currentClient = ZY_CLIENTS.find(c => String(c.id) === String(targetNum.client_id));
  const currentName = currentClient?.username || targetNum.client_username || targetNum.client_name || targetNum.user || `Client #${targetNum.client_id}`;
  const otherClients = ZY_CLIENTS.filter(c => String(c.id) !== String(targetNum.client_id));

  if (!otherClients.length) {
    toast('No other clients available to move number to', 'warning');
    return;
  }

  const crData = await zyFetchAgentClientRates().catch(() => null);
  const acrMove = zyFindClientRateForRange(crData, targetNum.range_id, targetNum.range_name || targetNum.country);
  const moveRateNote = (acrMove && acrMove.configured)
    ? `<div style="margin-top:4px;color:#059669;font-weight:700;">Destination inherits Client Rate Set: Rs. ${zyFmtMoney(Number(acrMove.client_rate_pkr), 4)} PKR</div>`
    : '';

  zyModal('Move Number Between Clients', `
    <div style="background:#f3f4f6;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:12px;">
      <div><strong>Number:</strong> <span style="font-family:monospace;font-weight:700;">${targetNum.number}</span></div>
      <div><strong>Current Holder:</strong> <span class="badge badge-green">${zyEsc(currentName)}</span></div>
      ${moveRateNote}
      <div class="text-muted" style="margin-top:4px;">Moving preserves old client's SMS history while routing new SMS to the new client.</div>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">Destination Client *</label>
      <select id="move-dest-client" class="zy-input" style="width:100%;height:34px;">
        <option value="">— Select Destination Client —</option>
        ${otherClients.map(c => `<option value="${c.id}">${zyEsc(c.username)}</option>`).join('')}
      </select>
    </div>
  `, `
    <button class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button class="zy-btn-blue" id="btn-do-move" onclick="zySubmitMove(${targetNum.id})"><i class="fas fa-right-left"></i> Move Number</button>
  `);
}

async function zySubmitMove(numberId) {
  const destClientId = document.getElementById('move-dest-client')?.value;
  if (!destClientId) { toast('Please select destination client', 'error'); return; }

  const btn = document.getElementById('btn-do-move');
  if (btn) { btn.disabled = true; btn.textContent = 'Moving...'; }

  try {
    const res = await apiFetch(`/api/numbers/${numberId}/move`, {
      method: 'POST',
      body: JSON.stringify({ to_client_id: Number(destClientId) })
    });

    if (res && (res.success || res.number || res.id)) {
      closeModal();
      toast('Number moved to new client successfully', 'success');
      loadPage('my-sms-numbers');
    } else {
      const errMsg = res?.error || res?.message || 'Move rejected by server';
      toast(errMsg, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Move Number'; }
    }
  } catch (err) {
    console.error('Move error:', err);
    toast(err.message || 'Failed to move number', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Move Number'; }
  }
}

/* ═══ AGENT NOTIFICATIONS CENTER (Live Role-Aware Engine) ═══ */
async function pgNewsClients() {
  if (window.HumexNotifications && typeof window.HumexNotifications.renderPage === 'function') {
    window.HumexNotifications.renderPage('page-content');
    return;
  }
  const c = document.getElementById('page-content');
  zyCrumb(['Notifications']);
  c.innerHTML = `<div class="card zy-panel"><div class="card-body zy-panel-body" style="text-align:center;padding:48px 20px;">Loading Notifications...</div></div>`;
}

window.zyAgentMarkSingleRead = async function(id) {
  if (window.HumexNotifications) return window.HumexNotifications.markSingleRead(id);
};
window.zyAgentMarkAllRead = async function() {
  if (window.HumexNotifications) return window.HumexNotifications.markAllRead();
};
window.zyAgentWipeNotifications = async function() {
  if (window.HumexNotifications) return window.HumexNotifications.clearAll();
};

function zyAddNewsModal() {
  zyModal('Post News for Clients', `
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">Headline *</label>
      <input class="zy-input" id="nn-title" placeholder="News headline" style="width:100%;height:38px;">
    </div>
    <div class="form-group" style="margin-bottom:8px;">
      <label class="zy-lbl" style="font-weight:600;">Message Content *</label>
      <textarea class="zy-input" id="nn-body" rows="4" placeholder="Important announcement for downline clients" style="width:100%;height:100px;padding:8px 10px;"></textarea>
    </div>`,
    `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
     <button class="sp-btn-primary" onclick="zySaveNews()"><i class="fas fa-bullhorn" style="margin-right:4px;"></i> Post News</button>`);
}

async function zySaveNews() {
  const p = {
    title: document.getElementById('nn-title').value.trim(),
    message: document.getElementById('nn-body').value.trim(),
    body: document.getElementById('nn-body').value.trim(),
    audience: 'Client',
    target_role: 'Client',
    created_by: AGENT_ID
  };
  if (!p.title || !p.message) { toast('Headline and message required', 'error'); return; }
  await apiFetch('/api/announcements', { method: 'POST', body: JSON.stringify(p) });
  closeModal();
  zyFlash('News Published.');
  loadPage('notifications');
}

/* ═══ MY CLIENTS ════════════════════════════════════════════ */
async function pgMyClients() {
  const c = document.getElementById('page-content');
  zyCrumb(['Users Master', 'Clients']);
  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title" style="font-size:18px;font-weight:800;color:#0f172a;">
          <i class="fas fa-users" style="color:#2563eb;margin-right:6px;"></i> Downline Clients Directory
        </div>
        <div class="page-subtitle" style="font-size:12.5px;color:#64748b;">Create clients, manage their credentials, control active status, and allocate number pools.</div>
      </div>
      <div class="page-actions" style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="zyAddClientModal()"><i class="fas fa-user-plus"></i> Add Client</button>
      </div>
    </div>
    <div class="apx-card" style="border:1.5px solid #cbd5e1;border-radius:10px;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.04);overflow:hidden;">
      <div class="apx-card-header" style="height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:#f8fafc;border-bottom:1px solid #cbd5e1;">
        <span style="font-weight:700;font-size:13px;color:#1e293b;">
          <i class="fas fa-users" style="color:#2563eb;margin-right:6px;"></i> Downline Clients Directory
        </span>
        <span id="dt-my-clients-count" class="badge badge-blue" style="font-size:11px;">Loading…</span>
      </div>
      <div class="apx-card-body" id="agt-clients-table-host" style="padding:14px;"><div class="zy-loading">Loading clients…</div></div>
    </div>`;

  const list = zyList(await apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=500`));
  ZY_CLIENTS = list;

  const countBadge = document.getElementById('dt-my-clients-count');
  if (countBadge) countBadge.textContent = `${list.length} Client(s)`;

  const rows = list.map(x => {
    const isAct = x.status === 'active';
    const hasWnBadge = x.whitenoise_access ? ` <span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;font-size:10px;">M30</span>` : '';
    const hasAppLinksBadge = x.app_links_access ? ` <span class="badge" style="background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;font-size:10px;">APPS</span>` : '';
    const actionHtml = `
      <div style="display:inline-flex;align-items:center;gap:5px;">
        <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyViewClientDetails(${x.id})" title="View Details" style="color:#0284c7;border-color:#bae6fd;background:#f0f9ff;"><i class="fas fa-eye"></i></button>
        <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyEditClientModal(${x.id})" title="Edit Client" style="color:#059669;border-color:#a7f3d0;background:#ecfdf5;"><i class="fas fa-pen"></i></button>
        <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyToggleClientStatus(${x.id},'${x.status || 'active'}')" title="${isAct ? 'Deactivate Client' : 'Activate Client'}" style="color:${isAct ? '#d97706' : '#16a34a'};border-color:${isAct ? '#fde68a' : '#bbf7d0'};background:${isAct ? '#fffbeb' : '#f0fdf4'};">
          <i class="fas fa-${isAct ? 'pause' : 'play'}"></i>
        </button>
        <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyDeleteClient(${x.id})" title="Delete Client" style="color:#dc2626;border-color:#fecaca;background:#fef2f2;">
          <i class="fas fa-trash"></i>
        </button>
      </div>`;
    const chatIdHtml = x.chat_id
      ? `<span class="monospace" style="font-weight:700;color:#2563eb;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.22);padding:2px 7px;border-radius:6px;font-size:11.5px;">${zyEsc(x.chat_id)}</span>`
      : '<span style="color:#94a3b8;">Auto</span>';
    const r = [
      `<span class="zy-col-username"><b>${zyEsc(x.username || '')}</b>${hasWnBadge}${hasAppLinksBadge}</span>`,
      { v: x.chat_id || '', h: chatIdHtml },
      zyEsc(x.full_name || '—'),
      zyEsc(x.email || '—'),
      zyEsc(x.phone || x.contact_no || '—'),
      zyEsc(x.skype_id || '—'),
      { v: isAct ? 'yes' : 'no', h: `<span class="badge ${isAct ? 'badge-green' : 'badge-red'}">${isAct ? 'Active' : 'Inactive'}</span>` },
      { v: '', h: actionHtml }
    ];
    r.__id = x.id;
    return r;
  });
  const host = document.getElementById('agt-clients-table-host');
  if (host) {
    host.innerHTML = zyDT2('dt-clients', {
      cols: ['Username', 'Chat ID', 'Name', 'Email', 'Contact', 'Skype', 'Status', 'Actions'], rows, check: true });
    zy2Render('dt-clients');
  }
}

window.zyGenRandomChatId = function(inputId) {
  const used = new Set((ZY_CLIENTS || []).map(c => String(c.chat_id || '').trim()).filter(Boolean));
  let cid = '';
  for (let i = 0; i < 100; i++) {
    cid = String(Math.floor(100000 + Math.random() * 900000));
    if (!used.has(cid)) break;
  }
  const el = document.getElementById(inputId);
  if (el) el.value = cid;
};

function zyAddClientModal() {
  const wnToggle = window.ZY_WHITENOISE_ACCESS ? `
    <div style="margin-top:10px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 12px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;font-weight:700;color:#312e81;">
        <input type="checkbox" id="nc-wn-access">
        <span>Allow Monthly Route Access (CDR 2 &amp; Monthly 30/5 {W})</span>
      </label>
    </div>` : '';
  const appLinksToggle = window.ZY_APP_LINKS_ACCESS ? `
    <div style="margin-top:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 12px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;font-weight:700;color:#075985;">
        <input type="checkbox" id="nc-applinks-access">
        <span>Allow Apps Links Menu (Show Apps Links Directory in Client Sidebar)</span>
      </label>
    </div>` : '';
  zyModal('Add New Client', `
    <div class="zy-acct-search-box">
      <label class="zy-lbl" for="nc-existing-search"><i class="fas fa-search" style="margin-right:5px;"></i>Search Existing Clients</label>
      <input class="zy-input" id="nc-existing-search" type="text" placeholder="Search existing client username or name..." autocomplete="off" oninput="zyFilterExistingClientsModal(this.value)">
      <div id="nc-existing-results" class="zy-acct-search-results"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
      <div><label class="zy-lbl">Username *</label><input class="zy-input" id="nc-user" placeholder="Minimum 6 Characters" autocomplete="off"></div>
      <div><label class="zy-lbl">Password *</label><input class="zy-input" id="nc-pass" type="password" placeholder="Minimum 6 Characters" autocomplete="new-password"></div>
    </div>
    <div style="margin-bottom:8px;">
      <label class="zy-lbl">Group Chat ID (6–8 Digits — blank = Auto Generate)</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="zy-input monospace" id="nc-chat-id" placeholder="e.g. 482910 (6 to 8 digits)" maxlength="8" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,8)" style="flex:1;">
        <button type="button" class="zy-btn-grey" style="white-space:nowrap;height:36px;" onclick="zyGenRandomChatId('nc-chat-id')"><i class="fas fa-wand-magic-sparkles"></i> Auto ID</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
      <div><label class="zy-lbl">Full Name</label><input class="zy-input" id="nc-name" placeholder="Client Name"></div>
      <div><label class="zy-lbl">Email</label><input class="zy-input" id="nc-mail" type="email" placeholder="client@example.com"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
      <div><label class="zy-lbl">Contact No.</label><input class="zy-input" id="nc-phone" placeholder="+44..."></div>
      <div><label class="zy-lbl">Skype ID</label><input class="zy-input" id="nc-skype" placeholder="Skype ID"></div>
    </div>
    ${wnToggle}
    ${appLinksToggle}`,
    `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
     <button class="zy-btn-blue" onclick="zySaveClient()"><i class="fas fa-user-plus" style="margin-right:4px;"></i> Create Client</button>`);
  if (!Array.isArray(ZY_CLIENTS) || !ZY_CLIENTS.length) {
    apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=500`).then(res => {
      ZY_CLIENTS = zyList(res);
      const inp = document.getElementById('nc-existing-search');
      if (inp && inp.value) zyFilterExistingClientsModal(inp.value);
    }).catch(() => {});
  }
}

window.zyFilterExistingClientsModal = function(q) {
  const box = document.getElementById('nc-existing-results');
  if (!box) return;
  const term = String(q || '').trim().toLowerCase();
  if (!term) { box.innerHTML = ''; box.style.display = 'none'; return; }
  const matches = (ZY_CLIENTS || []).filter(c =>
    String(c.username || '').toLowerCase().includes(term) ||
    String(c.full_name || '').toLowerCase().includes(term) ||
    String(c.chat_id || '').toLowerCase().includes(term)
  ).slice(0, 8);
  box.style.display = 'block';
  if (!matches.length) {
    box.innerHTML = `<div class="zy-acct-search-empty">No existing client matches "${zyEsc(q)}" — username is available.</div>`;
    return;
  }
  box.innerHTML = matches.map(c => `
    <div class="zy-acct-search-row">
      <span class="zy-col-username"><strong>${zyEsc(c.username || '')}</strong>${c.chat_id ? ` <span class="monospace" style="font-size:11px;color:#2563eb;">[ID: ${zyEsc(c.chat_id)}]</span>` : ''}${c.full_name ? ` <span class="text-muted">(${zyEsc(c.full_name)})</span>` : ''}</span>
      <span class="badge ${c.status === 'active' ? 'badge-green' : 'badge-red'}" style="font-size:10px;">${c.status === 'active' ? 'Active' : 'Inactive'}</span>
    </div>
  `).join('');
};

async function zySaveClient() {
  const wnEl = document.getElementById('nc-wn-access');
  const alEl = document.getElementById('nc-applinks-access');
  const chatIdVal = (document.getElementById('nc-chat-id')?.value || '').trim();
  if (chatIdVal && !/^\d{6,8}$/.test(chatIdVal)) {
    toast('Group Chat ID must be 6 to 8 digits (numbers only).', 'error');
    return;
  }
  const p = {
    username: document.getElementById('nc-user').value.trim(),
    password: document.getElementById('nc-pass').value,
    email: document.getElementById('nc-mail').value.trim(),
    skype_id: document.getElementById('nc-skype').value.trim(),
    contact_no: document.getElementById('nc-phone').value.trim(),
    full_name: document.getElementById('nc-name').value.trim(),
    agent_id: AGENT_ID
  };
  if (chatIdVal) p.chat_id = chatIdVal;
  if (wnEl) p.whitenoise_access = Boolean(wnEl.checked);
  if (alEl) p.app_links_access = Boolean(alEl.checked);
  if (p.username.length < 6 || p.password.length < 6) { toast('Username and password need 6+ characters', 'error'); return; }
  const r = await apiFetch('/api/clients', { method: 'POST', body: JSON.stringify(p) });
  if (r && r.id) { closeModal(); zyFlash(`Client Added${r.chat_id ? ` (Chat ID: ${r.chat_id})` : ''}.`); loadPage('my-clients'); }
  else { toast(r?.error || 'Failed to create client', 'error'); }
}

window.zyToggleClientStatus = async function(id, currentStatus) {
  try {
    const newStatus = currentStatus === 'active' ? 'deactivated' : 'active';
    const res = await apiFetch(`/api/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    if (res && (res.id || res.success)) {
      toast(`Client marked as ${newStatus}`, 'success');
      loadPage('my-clients');
    } else {
      toast(res?.error || 'Failed to update client status', 'error');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
};

window.zyDeleteClient = async function(id) {
  const c = (ZY_CLIENTS || []).find(x => String(x.id) === String(id));
  const label = c && c.username ? c.username : 'this client';
  const ok = await zyConfirm(
    `Delete client "${label}"?\n\n• Active numbers will return to your Agent pool and login will be revoked.\n• All historical CDR & SMS logs remain permanently saved under "${label}" (marked Deleted).\n• Creating a new client with the same username later will start fresh with separate CDR rows.`,
    { title: 'Delete Client', confirmLabel: 'Delete Client', danger: true }
  );
  if (!ok) return;

  try {
    if (c && c.status === 'active') {
      const deact = await apiFetch(`/api/clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'deactivated' })
      });
      if (!deact || deact.error) {
        toast(deact?.error || 'Could not deactivate client before deletion', 'error');
        return;
      }
    }
    const res = await apiFetch(`/api/clients/${id}`, { method: 'DELETE' });
    if (res && (res.deleted || res.success || !res.error)) {
      toast(`Client "${label}" deleted. Historical CDR logs preserved.`, 'warning');
      loadPage('my-clients');
    } else {
      toast(res?.error || 'Failed to delete client', 'error');
    }
  } catch (err) {
    toast('Error: ' + (err.message || 'Failed to delete client'), 'error');
  }
};

window.zyEditClientModal = async function(id) {
  const c = ZY_CLIENTS.find(x => String(x.id) === String(id));
  if (!c) return;
  const policy = typeof zyFetchAllocPolicy === 'function' ? await zyFetchAllocPolicy() : {};
  const canConfig = !!policy?.can_configure_downline;
  const allocBlock = canConfig ? `
    <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-top:10px;">
      <div style="font-weight:700;font-size:11.5px;color:#475569;text-transform:uppercase;margin-bottom:6px;">Number Acquisition Policy</div>
      <label class="zy-lbl">Mode</label>
      <select class="zy-input" id="ec-alloc-mode" style="width:100%;">
        <option value="" ${!c.alloc_mode ? 'selected' : ''}>Inherit Default</option>
        <option value="request" ${c.alloc_mode === 'request' ? 'selected' : ''}>Request Only</option>
        <option value="self_allocate" ${c.alloc_mode === 'self_allocate' ? 'selected' : ''}>Self-Allocate Only</option>
      </select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px;">
        <div><label class="zy-lbl">Daily Limit (blank = inherit)</label><input class="zy-input" type="number" min="0" id="ec-alloc-daily" value="${c.alloc_daily_limit ?? ''}" placeholder="Inherit"></div>
        <div><label class="zy-lbl">Total Limit (blank = inherit)</label><input class="zy-input" type="number" min="0" id="ec-alloc-total" value="${c.alloc_total_limit ?? ''}" placeholder="Inherit"></div>
      </div>
    </div>` : '';
  const wnToggle = window.ZY_WHITENOISE_ACCESS ? `
    <div style="margin-top:10px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 12px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;font-weight:700;color:#312e81;">
        <input type="checkbox" id="ec-wn-access" ${c.whitenoise_access ? 'checked' : ''}>
        <span>Allow Monthly Route Access (CDR 2 &amp; Monthly 30/5 {W})</span>
      </label>
    </div>` : '';
  const appLinksToggle = window.ZY_APP_LINKS_ACCESS ? `
    <div style="margin-top:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 12px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;font-weight:700;color:#075985;">
        <input type="checkbox" id="ec-applinks-access" ${c.app_links_access ? 'checked' : ''}>
        <span>Allow Apps Links Menu (Show Apps Links Directory in Client Sidebar)</span>
      </label>
    </div>` : '';
  zyModal(`Edit Client — ${zyEsc(c.username)}`, `
    <div style="margin-bottom:10px;">
      <label class="zy-lbl">Group Chat ID (6–8 Digits — shown to peers in Group Chat)</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="zy-input monospace" id="ec-chat-id" value="${zyEsc(c.chat_id || '')}" placeholder="6 to 8 digits" maxlength="8" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,8)" style="flex:1;font-weight:700;">
        <button type="button" class="zy-btn-grey" style="white-space:nowrap;height:36px;" onclick="zyGenRandomChatId('ec-chat-id')"><i class="fas fa-wand-magic-sparkles"></i> Auto ID</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
      <div><label class="zy-lbl">Full Name</label><input class="zy-input" id="ec-name" value="${zyEsc(c.full_name || '')}" placeholder="Full Name"></div>
      <div><label class="zy-lbl">Email</label><input class="zy-input" id="ec-mail" value="${zyEsc(c.email || '')}" placeholder="abc@xyz.com"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
      <div><label class="zy-lbl">Skype ID</label><input class="zy-input" id="ec-skype" value="${zyEsc(c.skype_id || '')}" placeholder="Skype ID"></div>
      <div><label class="zy-lbl">Contact No.</label><input class="zy-input" id="ec-phone" value="${zyEsc(c.phone || c.contact_no || '')}" placeholder="441768499506"></div>
    </div>
    <label class="zy-lbl">New Password (leave blank to keep current)</label>
    <input class="zy-input" id="ec-pass" type="password" placeholder="New Password">
    ${wnToggle}
    ${appLinksToggle}
    ${allocBlock}
  `,
  `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
   <button class="zy-btn-blue" onclick="zySaveEditClient(${id})">Save Changes</button>`);
};

window.zySaveEditClient = async function(id) {
  const chatIdVal = (document.getElementById('ec-chat-id')?.value || '').trim();
  if (chatIdVal && !/^\d{6,8}$/.test(chatIdVal)) {
    toast('Group Chat ID must be 6 to 8 digits (numbers only).', 'error');
    return;
  }
  const p = {
    full_name: document.getElementById('ec-name').value.trim(),
    email: document.getElementById('ec-mail').value.trim(),
    skype_id: document.getElementById('ec-skype').value.trim(),
    phone: document.getElementById('ec-phone').value.trim(),
    chat_id: chatIdVal
  };
  const pass = document.getElementById('ec-pass').value;
  if (pass) {
    if (pass.length < 6) { toast('Password must be 6+ characters', 'error'); return; }
    p.password = pass;
  }
  const wnEl = document.getElementById('ec-wn-access');
  if (wnEl) {
    p.whitenoise_access = Boolean(wnEl.checked);
  }
  const alEl = document.getElementById('ec-applinks-access');
  if (alEl) {
    p.app_links_access = Boolean(alEl.checked);
  }
  const modeEl = document.getElementById('ec-alloc-mode');
  if (modeEl) {
    const dRaw = document.getElementById('ec-alloc-daily')?.value;
    const tRaw = document.getElementById('ec-alloc-total')?.value;
    p.alloc_mode = modeEl.value || null;
    p.alloc_daily_limit = dRaw !== '' && dRaw !== undefined ? Math.max(0, parseInt(dRaw, 10) || 0) : null;
    p.alloc_total_limit = tRaw !== '' && tRaw !== undefined ? Math.max(0, parseInt(tRaw, 10) || 0) : null;
  }
  const r = await apiFetch(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(p) });
  if (r && (r.id || r.success)) {
    closeModal();
    toast('Client updated successfully', 'success');
    loadPage('my-clients');
  } else {
    toast(r?.error || 'Failed to update client', 'error');
  }
};

window.zyViewClientDetails = function(id) {
  const u = ZY_CLIENTS.find(x => String(x.id) === String(id));
  if (!u) return;
  const fx = Number(window._zyAgentFxRate || 280);
  const balPkr = u.balance_pkr != null ? Number(u.balance_pkr) : (Number(u.balance || 0) * fx);
  const line = (k, v) => `<div style="font-weight:700;font-size:11.5px;color:#64748b;margin-top:8px;text-transform:uppercase;letter-spacing:0.3px;">${k}</div><div style="font-size:13px;color:var(--sp-text-primary,#0f172a);margin-bottom:4px;font-weight:500;">${zyEsc(String(v ?? '—'))}</div>`;
  zyModal(`Client Details — ${zyEsc(u.username)}`,
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">` +
    line('Username', u.username) +
    line('Group Chat ID (6–8 Digits)', u.chat_id || 'Auto-assigned') +
    line('Full Name', u.full_name) +
    line('Email', u.email) +
    line('Contact No.', u.phone || u.contact_no) +
    line('Skype ID', u.skype_id) +
    line('Balance (PKR)', `Rs. ${balPkr.toLocaleString(undefined, { maximumFractionDigits: 2 })} PKR (≈ $${zyFmtMoney(Number(u.balance || 0), 2)})`) +
    line('Bank Name', u.bank_name || '—') +
    line('Account / IBAN', u.iban || u.account_number || '—') +
    line('PKR Wallet (JazzCash / Easypaisa)', u.wallet || '—') +
    line('Status', u.status || 'active') +
    line('Assigned Numbers', u.numbers_assigned || 0) +
    line('Monthly Route (CDR 2)', u.whitenoise_access ? 'Enabled (CDR 2 · Monthly 30/5 {W})' : 'Disabled') +
    `</div>`,
    `<button class="zy-btn-grey" onclick="closeModal()">Close</button>`);
};

/* ═══ SMS CDR REPORTS (Unified V5 — supports Group By presets) ═══ */
async function pgDetailedSms(defaultGroup = null) { zyCdrPage(defaultGroup); }

async function zyCdrPage(defaultGroup = null) {
  const c = document.getElementById('page-content');
  zyCrumb(['Show Report']);

  const defaultFrom = typeof zyDefaultFromDateTime === 'function' ? zyDefaultFromDateTime() : `${(typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10))} 00:00:00`;
  const defaultTo = typeof zyDefaultToDateTime === 'function' ? zyDefaultToDateTime() : `${(typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10))} 23:59:59`;

  const groupChips = [
    { id: 'hour', label: 'Hour', val: 'hour' },
    { id: 'date', label: 'Date', val: 'date' },
    { id: 'month', label: 'Month', val: 'month' },
    { id: 'range', label: 'Range', val: 'range' },
    { id: 'client', label: 'Client', val: 'client' },
    { id: 'number', label: 'Number', val: 'number' },
    { id: 'cli', label: 'CLI', val: 'cli' }
  ];

  const chipsHtml = groupChips.map(g => {
    const isDefault = typeof defaultGroup === 'string' && defaultGroup === g.val;
    return `
      <label class="zy-chip-pill${isDefault ? ' active' : ''}" for="grp-ag-${g.id}">
        <input type="checkbox" id="grp-ag-${g.id}" class="grp-chk" value="${g.val}" ${isDefault ? 'checked' : ''} onchange="this.closest('.zy-chip-pill').classList.toggle('active', this.checked)">
        ${g.label}
      </label>
    `;
  }).join('');

  c.innerHTML = `
    <div class="zy-intro" style="font-size:13px;color:var(--sp-text-secondary,#475569);margin-bottom:14px;line-height:1.5;">Here you can view all call detail records, agent traffic, and export reports.</div>

    <!-- Unified Compact Filter Card -->
    <div class="zy-filter-grid" data-cdr-compact="1">
      <div class="zy-filter-grid-fields">
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-from">From</label>
          <input type="text" id="rp-from" class="zy-filter-input" value="${defaultFrom}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)" style="cursor:pointer;">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-to">To</label>
          <input type="text" id="rp-to" class="zy-filter-input" value="${defaultTo}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)" style="cursor:pointer;">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-range">Range</label>
          <select id="rp-range" class="zy-filter-input">
            <option value="">All</option>
          </select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-client">Client</label>
          <select id="rp-client" class="zy-filter-input">
            <option value="">All</option>
          </select>
        </div>
      </div>

      <!-- Inline Group By Strip -->
      <div class="zy-groupby-card">
        <div class="zy-groupby-title">
          <i class="fas fa-layer-group" style="font-size:11px;color:var(--sp-text-muted,#64748b);"></i>
          Group By :
        </div>
        <div class="zy-groupby-chips">
          ${chipsHtml}
        </div>
        <div class="zy-groupby-search-wrap">
          <input type="text" id="rp-search" class="zy-groupby-search-input"
            placeholder="Search Date, Provider, Range, Number, CLI, SMS, Client, Payout..."
            autocomplete="off"
            oninput="zyHandleCdrSearchInput(this, 'rp-search-clear', () => zyCdrLoad(1))"
            onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._zyCdrSearchTimer){clearTimeout(window._zyCdrSearchTimer);}zyCdrLoad(1);}">
          <button type="button" id="rp-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearCdrSearch('rp-search', 'rp-search-clear', () => zyCdrLoad(1))">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <!-- Unified Action + Toolbar Row -->
      <div class="zy-table-toolbar zy-cdr-control-bar">
        <div class="zy-cdr-actions-left">
          <button type="button" class="zy-btn-blue-solid" id="btn-show-report" onclick="zyCdrLoad(1)">
            <i class="fas fa-chart-column"></i> Show Report
          </button>
        </div>
        <div class="zy-toolbar-right">
          <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('dt-cdr', this)"><i class="fas fa-columns"></i> Columns</button>
          <div class="zy-toolbar-select-wrap">
            <label class="zy-toolbar-label" for="rp-limit">Show Records</label>
            <select id="rp-limit" class="zy-toolbar-select" onchange="zyCdrLoad(1)">
              <option value="10">10</option>
              <option value="25" selected>25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
              <option value="5000">5000</option>
              <option value="10000">10000</option>
              <option value="15000">15000</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Results Table: seamless unified report body inside the single card -->
      <div class="zy-panel-body" id="rp-body" style="padding:0;margin-top:12px;">
        <div class="zy-loading" style="padding:40px;text-align:center;color:var(--sp-text-muted,#64748b);">Loading CDR records…</div>
      </div>
    </div>
    ${typeof zyRenderFab === 'function' ? zyRenderFab('Add Numbers in one tap', 'zyActionAllocate()') : ''}`;

  const ranges = zyList(await apiFetch('/api/numbers/sms-ranges'));
  ZY_RANGES = ranges;
  const rEl = document.getElementById('rp-range');
  if (rEl) {
    rEl.innerHTML = `<option value="">All</option>` +
      ranges.map(r => `<option value="${r.id}">${zyEsc(r.range_name || r.name || r.country || '')}${r.prefix ? ` (${zyEsc(r.prefix)})` : ''}</option>`).join('');
  }
  await zyFillClients('rp-client', 'All');
  // Auto-run first report
  zyCdrLoad(1);
}

window.zyAgentExportReport = function() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const checkedBoxes = Array.from(document.querySelectorAll('.grp-chk:checked')).map(cb => cb.value);
  zyExportCdrStream({
    agent_id: typeof AGENT_ID !== 'undefined' ? AGENT_ID : '',
    date_from: val('rp-from'),
    date_to: val('rp-to'),
    range: val('rp-range'),
    client_id: val('rp-client'),
    search: val('rp-search').trim(),
    status: val('rp-status') !== 'All' ? val('rp-status') : '',
    group_by: checkedBoxes.join(',')
  });
};

async function zyCdrLoad(page = 1) {
  const targetPage = typeof page === 'number' ? page : 1;

  const body = document.getElementById('rp-body');
  if (!body) return;

  // Cancel prior in-flight request if user quickly clicks page/filters
  if (window._agentCdrAbortController) {
    try { window._agentCdrAbortController.abort(); } catch (_) {}
  }
  window._agentCdrAbortController = new AbortController();
  const reqSignal = window._agentCdrAbortController.signal;

  body.innerHTML = `<div class="zy-loading" style="padding:40px;text-align:center;color:#64748b;">
    <div style="display:inline-block;margin-bottom:8px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:#0ea5e9;"></i></div>
    <div>Loading CDR records…</div>
  </div>`;

  const val = id => (document.getElementById(id) || {}).value || '';
  const from = val('rp-from'), to = val('rp-to');
  const rangeId = val('rp-range'), clientId = val('rp-client');
  const search = val('rp-search').trim();
  const status = val('rp-status');

  const checkedBoxes = Array.from(document.querySelectorAll('.grp-chk:checked')).map(cb => cb.value);

  const params = new URLSearchParams();
  if (typeof AGENT_ID !== 'undefined' && AGENT_ID) params.append('agent_id', AGENT_ID);
  if (from) params.append('date_from', from);
  if (to) params.append('date_to', to);
  if (rangeId) params.append('range', rangeId);
  if (clientId) params.append('client_id', clientId);
  if (search) params.append('search', search);
  if (status && status !== 'All') params.append('status', status);
  if (checkedBoxes.length) params.append('group_by', checkedBoxes.join(','));

  const limitVal = val('rp-limit') || '25';
  params.append('limit', limitVal);
  params.append('page', String(targetPage));

  try {
    const logs = await apiFetch(`/api/sms/logs?${params.toString()}`, { signal: reqSignal });
    if (!logs) return;
    const data = (logs && logs.data) || [];
    const effectiveLimit = limitVal === 'all'
      ? Math.max(1, Number(logs.limit) || data.length || Number(logs.total) || 25)
      : (parseInt(limitVal, 10) || 25);

    if (logs && logs.grouped && checkedBoxes.length) {
      const keyLabels = {
        hour: 'Hour',
        date: 'Date',
        daily: 'Date',
        month: 'Month',
        provider: 'Provider',
        range: 'Range',
        client: 'Client',
        number: 'Number',
        cli: 'CLI'
      };
      const cols = [
        ...checkedBoxes.map(k => keyLabels[k] || k),
        'Total SMS',
        'Curr.',
        'My Payout',
        'Client Payout',
        'My Profit'
      ];
      const renderGroupedClientCell = (g) => {
        const raw = String(g.client || '').trim();
        if (!raw) return '';
        const clean = raw.replace(/\s*\((?:Deleted\s*)?#\d+\)/gi, '').replace(/\s*\(Deleted\)/gi, '').trim();
        if (g.client_is_deleted || /\(Deleted/i.test(raw)) {
          return { v: clean, h: `${zyEsc(clean)} <span class="badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:10px;margin-left:4px;">Deleted</span>` };
        }
        return { v: clean, h: zyEsc(clean) };
      };
      const rows = data.map(g => [
        ...checkedBoxes.map(k => {
          if (k === 'client') return renderGroupedClientCell(g);
          if (k === 'agent') return g[k] ? zyEsc(g[k]) : '';
          return g[k] ? zyEsc(g[k]) : '—';
        }),
        g.sms_count || 0,
        g.currency || '$',
        zyFmtMoney(Number(g.payout || 0), 4),
        zyFmtMoney(Number(g.client_payout || 0), 4),
        zyFmtMoney(Number(g.profit != null ? g.profit : ((g.payout || 0) - (g.client_payout || 0))), 4)
      ]);

      const sumTotals = typeof zyBuildCdrTotalRow === 'function' ? zyBuildCdrTotalRow(data, true, { summary: logs.summary }) : null;
      const totalGroups = logs.total != null ? logs.total : (sumTotals ? sumTotals.count : data.length);
      const totalSms = sumTotals ? sumTotals.totalSms : (logs.summary && logs.summary.total_sms != null ? logs.summary.total_sms : data.reduce((sum, g) => sum + (g.sms_count || 0), 0));
      const totalPayout = sumTotals ? sumTotals.totalPayout : (logs.summary && logs.summary.payout != null ? logs.summary.payout : data.reduce((sum, g) => sum + (parseFloat(g.payout) || 0), 0));
      const totalClientPayout = sumTotals ? sumTotals.totalClientPayout : (logs.summary && logs.summary.client_payout != null ? logs.summary.client_payout : data.reduce((sum, g) => sum + (parseFloat(g.client_payout) || 0), 0));
      const totalProfit = sumTotals ? sumTotals.totalProfit : (logs.summary && logs.summary.profit != null ? logs.summary.profit : Math.max(0, totalPayout - totalClientPayout));

      body.innerHTML = zyDT2('dt-cdr', {
        cols,
        rows,
        sort: checkedBoxes.length,
        dir: -1,
        perPage: effectiveLimit,
        serverMode: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || targetPage,
        onPageChange: (p) => zyCdrLoad(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('rp-limit');
          if (sel) sel.value = String(s);
          zyCdrLoad(1);
        },
        searchPlaceholder: 'Number, CLI, message, range',
        footRow: `<td><b>Total Groups: ${Number(totalGroups).toLocaleString()}</b></td>` +
                 '<td></td>'.repeat(Math.max(0, checkedBoxes.length - 1)) +
                 `<td><b>${totalSms.toLocaleString()}</b></td>` +
                 `<td><b>$</b></td>` +
                 `<td><b>${zyFmtMoney(totalPayout, 4)}</b></td>` +
                 `<td><b>${zyFmtMoney(totalClientPayout, 4)}</b></td>` +
                 `<td><b>${zyFmtMoney(totalProfit, 4)}</b></td>`
      });
      zy2Render('dt-cdr');
    } else {
      const cleanOrg = (v) => {
        const s = String(v || '').trim();
        if (!s) return '';
        return ['—', '-', 'direct', 'general', 'unallocated', 'unassigned', 'test panel', 'unknown', 'none', 'null'].includes(s.toLowerCase()) ? '' : s;
      };
      const cols = ['Date', 'Provider', 'Range', 'Number', 'CLI', 'SMS', 'Client', 'Curr.', 'My Payout', 'Client Payout', 'My Profit'];
      const rows = data.map(s => {
        const dtCell = typeof zyFormatDateTimeStacked === 'function'
          ? zyFormatDateTimeStacked(s.timestamp || s.date)
          : { v: (s.timestamp || s.date || '').replace('T', ' ').slice(0, 19), h: (s.timestamp || s.date || '').replace('T', ' ').slice(0, 19) };
        const myP = parseFloat(s.agent_payout != null ? s.agent_payout : (s.agent_rate != null ? s.agent_rate : (s.my_payout || 0))) || 0;
        const clP = parseFloat(s.client_payout != null ? s.client_payout : (s.client_rate || 0)) || 0;
        const prof = parseFloat(s.agent_amount != null ? s.agent_amount : Math.max(0, myP - clP)) || 0;
        const fullCli = String(s.cli || s.app || s.sender || '—').trim() || '—';
        const smsCellHtml = typeof zyRenderSmsCell === 'function' ? zyRenderSmsCell(s.message || '') : `<div class="zy-sms-cell">${zyEsc(s.message || '')}</div>`;
        const clNameRaw = cleanOrg(s.client || s.client_username || s.client_name || s.user);
        const clName = clNameRaw.replace(/\s*\((?:Deleted\s*)?#\d+\)/gi, '').replace(/\s*\(Deleted\)/gi, '').trim();
        const clDisplay = clName;
        const clHtml = clName
          ? (s.client_is_deleted
            ? `${zyEsc(clName)} <span class="badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:10px;margin-left:4px;">Deleted</span>`
            : zyEsc(clName))
          : '';
        const numStr = String(s.number || '').trim();

        return [
          dtCell,
          zyEsc(s.provider || '—'),
          zyEsc(s.range_name || s.range_label || s.range || (s.country || '—')),
          { v: numStr, h: numStr ? `<span class="monospace" style="font-weight:600;">${zyEsc(numStr)}</span>` : '—' },
          { v: fullCli, h: `<span class="monospace">${zyEsc(fullCli)}</span>` },
          { v: s.message || '', h: smsCellHtml },
          { v: clDisplay, h: clHtml },
          zyEsc(s.currency || '$'),
          zyFmtMoney(Number(myP), 4),
          zyFmtMoney(Number(clP), 4),
          zyFmtMoney(Number(prof), 4)
        ];
      });

      const sum = logs.summary || {};
      const totalSms = (sum.total_sms != null) ? sum.total_sms : (logs.total != null ? logs.total : rows.length);
      const totalPayout = (sum.payout != null) ? sum.payout : (data.reduce((acc, s) => acc + (parseFloat(s.agent_payout != null ? s.agent_payout : (s.agent_rate != null ? s.agent_rate : (s.my_payout || 0))) || 0), 0));
      const totalClientPayout = (sum.client_payout != null) ? sum.client_payout : (data.reduce((acc, s) => acc + (parseFloat(s.client_payout != null ? s.client_payout : (s.client_rate || 0)) || 0), 0));
      const totalProfit = (sum.profit != null) ? sum.profit : Math.max(0, totalPayout - totalClientPayout);

      const footRow = `<td><b>Total SMS<br>${totalSms.toLocaleString()}</b></td>` +
        '<td></td>'.repeat(7) +
        `<td><b>My Payout<br>${zyFmtMoney(Number(totalPayout), 4)}</b></td>` +
        `<td><b>Client Payout<br>${zyFmtMoney(Number(totalClientPayout), 4)}</b></td>` +
        `<td><b>My Profit<br>${zyFmtMoney(Number(totalProfit), 4)}</b></td>`;

      body.innerHTML = zyDT2('dt-cdr', {
        cols,
        rows,
        sort: 0,
        dir: -1,
        perPage: effectiveLimit,
        serverMode: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || targetPage,
        onPageChange: (p) => zyCdrLoad(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('rp-limit');
          if (sel) sel.value = String(s);
          zyCdrLoad(1);
        },
        searchPlaceholder: 'Number, CLI, message, range',
        footRow
      });
      zy2Render('dt-cdr');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('Agent CDR stats load error:', err);
    body.innerHTML = '<div class="zy-empty" style="padding:40px;text-align:center;color:#ef4444;">Failed to load CDR records. Please try again.</div>';
  }
}

/* ═══ CDR 2 (MONTHLY ROUTE — EXCEL DAILY STATS · MONTHLY 30/5 {W}) ═══ */
async function pgCdr2() {
  const c = document.getElementById('page-content');
  zyCrumb(['SMS & Analytics', 'Whitenoise Reports']);

  try {
    const me = await apiFetch('/api/auth/me', { silent: true });
    if (typeof window.zyRefreshWhitenoiseNav === 'function') window.zyRefreshWhitenoiseNav(me);
    if (!me || !me.whitenoise_access) {
      c.innerHTML = `
        <div class="zy-panel" style="border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:42px 24px;text-align:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:#fef2f2;color:#ef4444;display:inline-flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:12px;">
            <i class="fas fa-lock"></i>
          </div>
          <h3 style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">Whitenoise Reports Access Not Enabled</h3>
          <p style="max-width:460px;margin:0 auto;font-size:13px;color:#64748b;line-height:1.5;">
            Your Agent account does not currently have Whitenoise Reports (Monthly 30/5 {W}) permission enabled. Contact Owner to enable Whitenoise Reports Access for your account.
          </p>
        </div>`;
      return;
    }
  } catch (_) {}

  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const defaultFrom = `${today.slice(0, 7)}-01 00:00:00`;
  const defaultTo = `${today} 23:59:59`;

  const groupChips = [
    { id: 'date', label: 'Date', val: 'date' },
    { id: 'month', label: 'Month', val: 'month' },
    { id: 'range', label: 'Range', val: 'range' },
    { id: 'client', label: 'Client', val: 'client' },
    { id: 'number', label: 'Number', val: 'number' },
    { id: 'cli', label: 'Service / CLI', val: 'cli' }
  ];

  const chipsHtml = groupChips.map(g => `
    <label class="zy-chip-pill" for="grp-ag-cdr2-${g.id}">
      <input type="checkbox" id="grp-ag-cdr2-${g.id}" class="cdr2-grp-chk" value="${g.val}" onchange="this.closest('.zy-chip-pill').classList.toggle('active', this.checked)">
      ${g.label}
    </label>`).join('');

  c.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title"><i class="fas fa-chart-column" style="color:#2563eb;"></i> Whitenoise Reports</div>
        <div class="page-subtitle">Monthly (30/5) {W} · 5-day hold · Updated daily from official company stats report</div>
      </div>
      <div>
        <button type="button" class="btn btn-outline btn-sm" onclick="zyAgentExportCdr2Report()"><i class="fas fa-download"></i> Export CSV</button>
      </div>
    </div>

    <div id="cdr2-agent-panel-access" style="margin-bottom:12px;"></div>
    <div id="cdr2-daily-banner" style="margin-bottom:10px;"></div>

    <div class="zy-filter-grid" data-cdr-compact="1">
      <div class="zy-cdr-head-row">
        <span><i class="fas fa-sliders" style="color:#2563eb;margin-right:6px;"></i> Daily Stats Filters</span>
        <span id="cdr2-sync-status" style="font-size:12px;color:#64748b;">Date-locked attribution · Monthly (30/5) {W}</span>
      </div>
      <div class="zy-filter-grid-fields">
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="cdr2-from">From</label>
          <input type="text" id="cdr2-from" class="zy-filter-input" value="${defaultFrom}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="cdr2-to">To</label>
          <input type="text" id="cdr2-to" class="zy-filter-input" value="${defaultTo}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="cdr2-range">Monthly Range</label>
          <select id="cdr2-range" class="zy-filter-input"><option value="">All Monthly Ranges</option></select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="cdr2-client">Client</label>
          <select id="cdr2-client" class="zy-filter-input"><option value="">All</option></select>
        </div>
      </div>

      <div class="zy-groupby-card">
        <div class="zy-groupby-title"><i class="fas fa-layer-group" style="font-size:11px;color:var(--sp-text-muted,#64748b);"></i> Group By :</div>
        <div class="zy-groupby-chips">${chipsHtml}</div>
        <div class="zy-groupby-search-wrap">
          <input type="text" id="cdr2-search" class="zy-groupby-search-input"
            placeholder="Search Date, Range, Number, Service, Client..."
            autocomplete="off"
            oninput="zyHandleCdrSearchInput(this, 'cdr2-search-clear', () => zyAgentCdr2Load(1))"
            onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._zyCdrSearchTimer){clearTimeout(window._zyCdrSearchTimer);}zyAgentCdr2Load(1);}">
          <button type="button" id="cdr2-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearCdrSearch('cdr2-search', 'cdr2-search-clear', () => zyAgentCdr2Load(1))">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="zy-table-toolbar zy-cdr-control-bar">
        <div class="zy-cdr-actions-left" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="zy-btn-blue-solid" id="btn-show-cdr2" onclick="zyAgentCdr2Load(1)"><i class="fas fa-chart-column"></i> Show Report</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="zyResetAgentCdr2Filters()"><i class="fas fa-rotate-left"></i> Reset</button>
        </div>
        <div class="zy-toolbar-right">
          <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('dt-cdr2', this)"><i class="fas fa-columns"></i> Columns</button>
          <div class="zy-toolbar-select-wrap">
            <label class="zy-toolbar-label" for="cdr2-limit">Show Records</label>
            <select id="cdr2-limit" class="zy-toolbar-select" onchange="zyAgentCdr2Load(1)">
              <option value="10">10</option>
              <option value="25" selected>25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </div>

      <div class="zy-panel-body" id="cdr2-body" style="padding:0;margin-top:12px;">
        <div class="zy-loading" style="padding:40px;text-align:center;color:#64748b;">Loading CDR 2 daily stats…</div>
      </div>
    </div>`;

  const [rangesRaw, cdr2Status, panelAccessRes] = await Promise.all([
    apiFetch('/api/numbers/sms-ranges').catch(() => []),
    apiFetch('/api/cdr2/status', { silent: true }).catch(() => null),
    apiFetch('/api/cdr2/panel-access', { silent: true }).catch(() => null)
  ]);
  window._zyAgentCdr2PanelCache = (panelAccessRes && panelAccessRes.panel) || { url: '', username: '', password: '' };
  window.zyRenderAgentCdr2PanelAccess(window._zyAgentCdr2PanelCache);

  const ranges = zyList(rangesRaw).filter(r => zyIsWhitenoiseObj(r));
  const rEl = document.getElementById('cdr2-range');
  if (rEl) {
    rEl.innerHTML = `<option value="">All Monthly Ranges</option>` +
      ranges.map(r => `<option value="${r.id}">${zyEsc(r.range_name || r.name || r.country || '')}${r.prefix ? ` (${zyEsc(r.prefix)})` : ''}</option>`).join('');
  }
  if (cdr2Status && typeof window.zyRenderCdr2DailyBanner === 'function') {
    window.zyRenderCdr2DailyBanner('cdr2-daily-banner', cdr2Status);
  }
  await zyFillClients('cdr2-client', 'All');
  if (cdr2Status && !cdr2Status.terms_accepted && typeof window.zyOpenCdr2TermsModal === 'function') {
    window.zyOpenCdr2TermsModal({
      viewOnly: false,
      onAccepted: () => zyAgentCdr2Load(1)
    });
  } else {
    zyAgentCdr2Load(1);
  }
}

window.zyRenderAgentCdr2PanelAccess = function(panel) {
  const host = document.getElementById('cdr2-agent-panel-access');
  if (!host) return;
  const p = panel || window._zyAgentCdr2PanelCache || { url: '', username: '', password: '' };
  host.innerHTML = `
    <div class="zy-wn-portal-bar">
      <div class="zy-wn-portal-head">
        <div class="zy-wn-portal-title">
          <i class="fas fa-key" style="color:#2563eb;"></i>
          <span>Client Panel Access</span>
          <span class="zy-wn-portal-badge">Visible to All Your Clients</span>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="btn-save-agent-cdr2-pa" onclick="window.zySaveAgentCdr2PanelAccess()">
          <i class="fas fa-save"></i> Save Details
        </button>
      </div>
      <div class="zy-wn-portal-grid">
        <div class="zy-wn-portal-field">
          <label class="zy-wn-portal-lbl" for="cdr2-pa-url">Panel Link</label>
          <div class="zy-wn-portal-val-row">
            <input type="url" id="cdr2-pa-url" class="zy-cdr2-pa-input" autocomplete="off" placeholder="https://panel.example.com" value="${zyEsc(p.url || '')}">
            <button type="button" class="zy-wn-copy-btn" onclick="window.zyCopyTextSafe((document.getElementById('cdr2-pa-url')?.value || '').trim(), 'Panel link')" title="Copy Panel Link">
              <i class="far fa-copy"></i> Copy
            </button>
          </div>
        </div>
        <div class="zy-wn-portal-field">
          <label class="zy-wn-portal-lbl" for="cdr2-pa-user">Username</label>
          <div class="zy-wn-portal-val-row">
            <input type="text" id="cdr2-pa-user" class="zy-cdr2-pa-input" autocomplete="off" placeholder="Enter client username" value="${zyEsc(p.username || '')}">
            <button type="button" class="zy-wn-copy-btn" onclick="window.zyCopyTextSafe((document.getElementById('cdr2-pa-user')?.value || '').trim(), 'Username')" title="Copy Username">
              <i class="far fa-copy"></i> Copy
            </button>
          </div>
        </div>
        <div class="zy-wn-portal-field">
          <label class="zy-wn-portal-lbl" for="cdr2-pa-pass">Password</label>
          <div class="zy-wn-portal-val-row">
            <input type="text" id="cdr2-pa-pass" class="zy-cdr2-pa-input" autocomplete="off" placeholder="Enter client password" value="${zyEsc(p.password || '')}">
            <button type="button" class="zy-wn-copy-btn is-accent" onclick="window.zyCopyTextSafe(document.getElementById('cdr2-pa-pass')?.value || '', 'Password')" title="Copy Password">
              <i class="far fa-copy"></i> Copy
            </button>
          </div>
        </div>
      </div>
    </div>`;
};

window.zySaveAgentCdr2PanelAccess = async function() {
  const url = (document.getElementById('cdr2-pa-url')?.value || '').trim();
  const username = (document.getElementById('cdr2-pa-user')?.value || '').trim();
  const password = document.getElementById('cdr2-pa-pass')?.value || '';
  const btn = document.getElementById('btn-save-agent-cdr2-pa');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }
  try {
    const res = await apiFetch('/api/cdr2/panel-access', {
      method: 'PUT',
      body: JSON.stringify({ url, username, password })
    });
    if (res && res.success) {
      window._zyAgentCdr2PanelCache = res.panel || { url, username, password };
      window.zyRenderAgentCdr2PanelAccess(window._zyAgentCdr2PanelCache);
      toast('Panel access saved for all your clients', 'success');
    } else if (res && res.error) {
      toast(res.error, 'error');
    }
  } catch (err) {
    toast(err?.message || 'Failed to save panel access', 'error');
  } finally {
    const b = document.getElementById('btn-save-agent-cdr2-pa');
    if (b) { b.disabled = false; b.innerHTML = '<i class="fas fa-save"></i> Save Details'; }
  }
};

window.zyResetAgentCdr2Filters = function() {
  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const f = document.getElementById('cdr2-from'); if (f) f.value = `${today.slice(0, 7)}-01 00:00:00`;
  const t = document.getElementById('cdr2-to'); if (t) t.value = `${today} 23:59:59`;
  ['cdr2-range', 'cdr2-client', 'cdr2-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const clr = document.getElementById('cdr2-search-clear');
  if (clr) clr.style.display = 'none';
  document.querySelectorAll('.cdr2-grp-chk').forEach(cb => {
    cb.checked = false;
    cb.closest('.zy-chip-pill')?.classList.remove('active');
  });
  zyAgentCdr2Load(1);
};

window.zyAgentExportCdr2Report = function() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const checkedBoxes = Array.from(document.querySelectorAll('.cdr2-grp-chk:checked')).map(cb => cb.value);
  const p = new URLSearchParams({ export: 'csv' });
  if (typeof AGENT_ID !== 'undefined' && AGENT_ID) p.set('agent_id', AGENT_ID);
  if (val('cdr2-from')) p.set('date_from', val('cdr2-from'));
  if (val('cdr2-to')) p.set('date_to', val('cdr2-to'));
  if (val('cdr2-range')) p.set('range', val('cdr2-range'));
  if (val('cdr2-client')) p.set('client_id', val('cdr2-client'));
  if (val('cdr2-search').trim()) p.set('search', val('cdr2-search').trim());
  if (checkedBoxes.length) p.set('group_by', checkedBoxes.join(','));
  if (typeof zyDownloadFile === 'function') zyDownloadFile(`/api/cdr2/export?${p.toString()}`, 'cdr2_monthly.csv');
};

async function zyAgentCdr2Load(page = 1) {
  const targetPage = typeof page === 'number' ? page : 1;
  const body = document.getElementById('cdr2-body');
  if (!body) return;

  if (window._agentCdr2AbortController) {
    try { window._agentCdr2AbortController.abort(); } catch (_) {}
  }
  window._agentCdr2AbortController = new AbortController();
  const reqSignal = window._agentCdr2AbortController.signal;

  const val = id => (document.getElementById(id) || {}).value || '';
  const from = val('cdr2-from'), to = val('cdr2-to');
  const rangeId = val('cdr2-range'), clientId = val('cdr2-client');
  const search = val('cdr2-search').trim();

  body.innerHTML = `<div class="zy-loading" style="padding:36px;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin fa-lg" style="color:#2563eb;"></i><div style="margin-top:8px;">Loading CDR 2 daily stats…</div></div>`;

  const checkedBoxes = Array.from(document.querySelectorAll('.cdr2-grp-chk:checked')).map(cb => cb.value);
  const params = new URLSearchParams();
  if (typeof AGENT_ID !== 'undefined' && AGENT_ID) params.append('agent_id', AGENT_ID);
  if (from) params.append('date_from', from);
  if (to) params.append('date_to', to);
  if (rangeId) params.append('range', rangeId);
  if (clientId) params.append('client_id', clientId);
  if (search) params.append('search', search);
  if (checkedBoxes.length) params.append('group_by', checkedBoxes.join(','));
  const limitVal = val('cdr2-limit') || '25';
  params.append('limit', limitVal);
  params.append('page', String(targetPage));

  try {
    const logs = await apiFetch(`/api/cdr2/logs?${params.toString()}`, { signal: reqSignal });
    if (!logs) return;
    const data = (logs && logs.data) || [];
    const effectiveLimit = limitVal === 'all'
      ? Math.max(1, Number(logs.limit) || data.length || Number(logs.total) || 25)
      : (parseInt(limitVal, 10) || 25);

    if (!data.length) {
      body.innerHTML = `
        <div style="padding:40px 24px;text-align:center;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">
          <i class="fas fa-chart-column" style="font-size:26px;color:#94a3b8;margin-bottom:8px;"></i>
          <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:4px;">No Daily Stats for Selected Dates</div>
          <div style="font-size:13px;color:#64748b;">Monthly Route (CDR 2) stats update daily once the official company Excel report is synced.</div>
        </div>`;
      return;
    }

    if (logs && logs.grouped && checkedBoxes.length) {
      const keyLabels = { date: 'Date', month: 'Month', range: 'Range', client: 'Client', number: 'Number', cli: 'Service / CLI' };
      const cols = [...checkedBoxes.map(k => keyLabels[k] || k), 'SMS Count', 'Cycle', 'My Payout (USD)', 'Client Payout (USD)', 'My Profit (USD)'];
      const rows = data.map(g => [
        ...checkedBoxes.map(k => {
          if (k === 'client') {
            const raw = String(g.client || '').trim();
            if (!raw) return 'Pool';
            const clean = raw.replace(/\s*\((?:Deleted\s*)?#\d+\)/gi, '').replace(/\s*\(Deleted\)/gi, '').trim();
            if (g.client_is_deleted || /\(Deleted/i.test(raw)) {
              return { v: clean, h: `${zyEsc(clean)} <span class="badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:10px;margin-left:4px;">Deleted</span>` };
            }
            return { v: clean, h: zyEsc(clean) };
          }
          if (k === 'range') {
            const rVal = g[k] || '—';
            return { v: rVal, h: `<span class="zy-wn-range-name">${zyEsc(rVal)}</span>` };
          }
          if (k === 'number') {
            const nVal = g[k] || '';
            return { v: nVal || '—', h: nVal ? `<span class="monospace zy-wn-number">${zyEsc(nVal)}</span>` : '—' };
          }
          return g[k] ? zyEsc(g[k]) : '—';
        }),
        { v: g.sms_count || 0, h: `<span class="monospace" style="font-weight:700;">${Number(g.sms_count || 0).toLocaleString()}</span>` },
        'Monthly (30/5) {W}',
        { v: Number(g.payout || 0), h: `<span class="monospace">$${zyFmtMoney(Number(g.payout || 0), 4)}</span>` },
        { v: Number(g.client_payout || 0), h: `<span class="monospace">$${zyFmtMoney(Number(g.client_payout || 0), 4)}</span>` },
        { v: Number(g.profit || 0), h: `<span class="monospace" style="color:#059669;font-weight:700;">$${zyFmtMoney(Number(g.profit != null ? g.profit : ((g.payout || 0) - (g.client_payout || 0))), 4)}</span>` }
      ]);
      const sum = logs.summary || {};
      const totalGroups = logs.total != null ? logs.total : (sum.total_groups != null ? sum.total_groups : data.length);
      const totalSms = sum.total_sms != null ? sum.total_sms : data.reduce((s, g) => s + (g.sms_count || 0), 0);
      const totalPayout = sum.payout != null ? Number(sum.payout) : data.reduce((s, g) => s + (parseFloat(g.payout) || 0), 0);
      const totalClPayout = sum.client_payout != null ? Number(sum.client_payout) : data.reduce((s, g) => s + (parseFloat(g.client_payout) || 0), 0);
      const totalProf = sum.profit != null ? Number(sum.profit) : Math.max(0, totalPayout - totalClPayout);

      body.innerHTML = zyDT2('dt-cdr2', {
        cols,
        rows,
        hideToolbar: true,
        sort: checkedBoxes.length,
        dir: -1,
        perPage: effectiveLimit,
        serverMode: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || targetPage,
        onPageChange: (p) => zyAgentCdr2Load(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('cdr2-limit');
          if (sel) sel.value = String(s);
          zyAgentCdr2Load(1);
        },
        footRow: `<td><b>Total Groups: ${Number(totalGroups).toLocaleString()}</b></td>` + '<td></td>'.repeat(Math.max(0, checkedBoxes.length - 1)) +
          `<td class="monospace"><b>${totalSms.toLocaleString()}</b></td><td><b>Monthly (30/5) {W}</b></td><td class="monospace"><b>$${zyFmtMoney(totalPayout, 4)}</b></td><td class="monospace"><b>$${zyFmtMoney(totalClPayout, 4)}</b></td><td class="monospace" style="color:#059669;"><b>$${zyFmtMoney(totalProf, 4)}</b></td>`
      });
      zy2Render('dt-cdr2');
    } else {
      const cols = ['Date', 'Range', 'Number', 'Service / CLI', 'Client', 'SMS Count', 'Rate (USD)', 'My Payout', 'Client Payout', 'My Profit', 'Cycle'];
      const rows = data.map(s => {
        const dStr = s.date_ymd || String(s.date || s.timestamp || '').replace('T', ' ').slice(0, 10);
        const smsCnt = Number(s.sms_count) > 0 ? Math.round(Number(s.sms_count)) : 1;
        const myP = parseFloat(s.agent_payout ?? s.agent_rate ?? s.my_payout ?? 0) || 0;
        const unitRate = Number(s.unit_agent_rate_usd != null ? s.unit_agent_rate_usd : (smsCnt > 0 ? myP / smsCnt : 0));
        const clP = parseFloat(s.client_payout ?? s.client_rate ?? 0) || 0;
        const prof = parseFloat(s.agent_amount ?? Math.max(0, myP - clP)) || 0;
        const fullCli = String(s.cli || s.service || s.app || 'General').trim() || 'General';
        const clNameRaw = String(s.client || s.client_username || s.client_name || '').trim();
        const clName = clNameRaw.replace(/\s*\((?:Deleted\s*)?#\d+\)/gi, '').replace(/\s*\(Deleted\)/gi, '').trim();
        const clDisplay = clName;
        const clCellHtml = clName
          ? (s.client_is_deleted
            ? `${zyEsc(clName)} <span class="badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:10px;margin-left:4px;">Deleted</span>`
            : zyEsc(clName))
          : '<span style="color:#94a3b8;">Agent Pool</span>';
        const numStr = String(s.number || '').trim();
        const clearLabel = s.clears_at ? `Clears ${String(s.clears_at).slice(0, 10)}` : 'Monthly (30/5) {W}';

        const rngLbl = s.range_name || s.range_label || s.range || s.country || '—';
        return [
          { v: dStr, h: `<span class="monospace" style="font-weight:600;">${zyEsc(dStr)}</span>` },
          { v: rngLbl, h: `<span class="zy-wn-range-name">${zyEsc(rngLbl)}</span>` },
          { v: numStr, h: numStr ? `<span class="monospace zy-wn-number">${zyEsc(numStr)}</span>` : '—' },
          { v: fullCli, h: `<span class="monospace">${zyEsc(fullCli)}</span>` },
          { v: clDisplay || 'Agent Pool', h: clCellHtml },
          { v: smsCnt, h: `<span class="monospace" style="font-weight:700;">${smsCnt.toLocaleString()}</span>` },
          { v: unitRate, h: `<span class="monospace" style="color:#64748b;">$${zyFmtMoney(unitRate, 4)}</span>` },
          { v: myP, h: `<span class="monospace">$${zyFmtMoney(myP, 4)}</span>` },
          { v: clP, h: `<span class="monospace">$${zyFmtMoney(clP, 4)}</span>` },
          { v: prof, h: `<span class="monospace" style="color:#059669;font-weight:700;">$${zyFmtMoney(prof, 4)}</span>` },
          `<span style="font-size:11.5px;color:#4338ca;font-weight:600;">${zyEsc(clearLabel)}</span>`
        ];
      });
      const sum = logs.summary || {};
      const totalSms = sum.total_sms != null ? sum.total_sms : data.reduce((a, s) => a + (Number(s.sms_count) || 1), 0);
      const totalPayout = sum.payout != null ? Number(sum.payout) : data.reduce((a, s) => a + (parseFloat(s.agent_payout || s.agent_rate || 0) || 0), 0);
      const totalClPayout = sum.client_payout != null ? Number(sum.client_payout) : data.reduce((a, s) => a + (parseFloat(s.client_payout || s.client_rate || 0) || 0), 0);
      const totalProf = sum.profit != null ? Number(sum.profit) : Math.max(0, totalPayout - totalClPayout);

      body.innerHTML = zyDT2('dt-cdr2', {
        cols, rows, hideToolbar: true, sort: 0, dir: -1, perPage: effectiveLimit, serverMode: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || targetPage,
        onPageChange: (p) => zyAgentCdr2Load(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('cdr2-limit');
          if (sel) sel.value = String(s);
          zyAgentCdr2Load(1);
        },
        footRow: `<td><b>Rows: ${Number(logs.total || data.length).toLocaleString()}</b></td>` + '<td></td>'.repeat(4) +
          `<td class="monospace"><b>${totalSms.toLocaleString()}</b></td><td></td>` +
          `<td class="monospace"><b>$${zyFmtMoney(totalPayout, 4)}</b></td>` +
          `<td class="monospace"><b>$${zyFmtMoney(totalClPayout, 4)}</b></td>` +
          `<td class="monospace" style="color:#059669;"><b>$${zyFmtMoney(totalProf, 4)}</b></td>` +
          `<td><b>Monthly (30/5) {W}</b></td>`
      });
      zy2Render('dt-cdr2');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('Agent CDR 2 load error:', err);
    body.innerHTML = `<div class="zy-empty" style="padding:40px;text-align:center;color:#ef4444;">${zyEsc(err.message || 'Failed to load CDR 2 records.')}</div>`;
  }
}

/* ═══ TRANSFER HISTORY & CSV EXPORT ═══════════════════════════ */
function downloadAgentNumbers() {
  try {
    const url = `/api/numbers/download?agent_id=${AGENT_ID}`;
    if (typeof zyDownloadFile === 'function') zyDownloadFile(url, 'agent_numbers.csv');
    toast('Downloading numbers CSV...', 'info');
  } catch (err) {
    console.error('Download error:', err);
    toast('Failed to download', 'error');
  }
}

function exportTransferHistory() {
  try {
    toast('Exporting transfer history...', 'info');
    const url = `/api/number-transfers/export?agent_id=${AGENT_ID}`;
    if (typeof zyDownloadFile === 'function') zyDownloadFile(url, 'transfer_history.csv');
  } catch (err) {
    console.error('Export error:', err);
    toast('Failed to export', 'error');
  }
}

async function pgAgentTransferHistory(page = 1) {
  try {
    const data = await apiFetch(`/api/number-transfers?page=${page}&limit=20&user_id=${AGENT_ID}`);
    const transfers = data?.data || [];
    const total = data?.total || 0;
    const perPage = 20;

    const content = document.getElementById('page-content');
    zyCrumb(['My Numbers', 'Transfer History']);
    content.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Transfer History</div>
          <div class="page-subtitle">All number transfers involving your account</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-outline btn-sm" onclick="exportTransferHistory()">
            <i class="fas fa-download"></i> Export CSV
          </button>
        </div>
      </div>

      <div class="card">
        ${buildTable(
          ['#', 'Direction', 'From', 'To', 'Count', 'Service', 'Notes', 'Time', 'Status'],
          transfers.map(t => [
            t.id || '—',
            t.from_user_id === AGENT_ID
              ? `<span class="badge badge-red">Sent</span>`
              : `<span class="badge badge-green">Received</span>`,
            `<strong>${zyEsc(t.from_username || '—')}</strong> <span class="badge badge-${t.from_role === 'Owner' || t.from_role === 'Admin' ? 'red' : 'purple'}">${zyEsc(t.from_role || '—')}</span>`,
            `<strong>${zyEsc(t.to_username || '—')}</strong> <span class="badge badge-${t.to_role === 'Agent' ? 'cyan' : 'green'}">${zyEsc(t.to_role || '—')}</span>`,
            `<span class="badge badge-blue">${t.count || 0}</span>`,
            zyEsc(t.service || '—'),
            zyEsc(t.notes || '—'),
            fmtShort(t.timestamp),
            statusBadge(t.status)
          ])
        )}
        ${pagination(page, total, perPage, pgAgentTransferHistory)}
      </div>
    `;
  } catch (err) {
    console.error('Transfer history error:', err);
    toast('Failed to load transfer history', 'error');
  }
}

/* ═══ MY CREDIT NOTES ═══════════════════════════════════════ */
async function pgCreditNotes() {
  const c = document.getElementById('page-content');
  zyCrumb(['My Credit Notes']);
  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-file-invoice" style="color:#2563eb;"></i> My Credit Notes</div>
        <div class="page-subtitle">Official wholesale SMS credit notes. Download print-ready settlement vouchers and track maturity dates.</div>
      </div>
    </div>
    <div class="zy-filterbox">
      <input class="zy-fb-input" id="cn-from" value="${zyMonthStart()} 00:00:00">
      <input class="zy-fb-input" id="cn-to" value="${zyToday()} 23:59:59">
      <div class="zy-fb-btns"><button class="zy-btn-blue" onclick="pgCreditNotesLoad()">Show Report</button></div>
    </div>
    <div class="card zy-panel">
      <div class="card-header zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;">
        <span class="card-title">My Credit Notes</span>
      </div>
      <div class="card-body zy-panel-body" id="cn-body"><div class="zy-loading">Loading…</div></div>
    </div>`;
  pgCreditNotesLoad();
}
async function pgCreditNotesLoad() {
  const body = document.getElementById('cn-body');
  if (!body) return;
  body.innerHTML = `<div class="zy-loading">Loading…</div>`;
  const list = zyList(await apiFetch('/api/credit-notes?limit=500'))
    .filter(n => String(n.agent_id) === String(AGENT_ID) || String(n.user_id) === String(AGENT_ID))
    .filter(n => zyInRange('cn', n.created || n.date));
  const rows = list.map(n => {
    const due = new Date(String(n.date || n.created || '').slice(0, 10));
    due.setDate(due.getDate() + 1);
    return [
      (n.date || n.created || '').slice(0, 10),
      n.reason ? zyEsc(n.reason) : 'Wholesale SMS Settlement',
      zyEsc(n.term || 'Weekly'),
      zyEsc(n.currency || 'USD'),
      zyFmtMoney(Number(n.amount || 0), 3),
      isNaN(due) ? '' : due.toISOString().slice(0, 10),
      { v: '', h: `<button class="zy-rowbtn" onclick="zyAgentCreditPdf(${Number(n.id)})" title="Download Credit Voucher"><i class="fas fa-file-invoice" style="color:var(--sp-primary);"></i></button>` }
    ];
  });
  body.innerHTML = zyDT2('dt-credit', {
    cols: ['Date', 'Description', 'Term', 'Currency', 'Amount', 'Due Date', 'Voucher'], rows, sort: 0, dir: -1 });
  zy2Render('dt-credit');
}
async function zyAgentCreditPdf(id) {
  try {
    const res = await fetch(`/api/credit-notes/${encodeURIComponent(id)}/pdf`, { credentials: 'include' });
    if (!res.ok) { toast('Failed to load voucher', 'error'); return; }
    const html = await res.text();
    if (typeof zyPrintHtml === 'function') zyPrintHtml(html);
  } catch (_) { toast('Failed to open voucher', 'error'); }
}

/* ═══ MY PAYMENT REQUESTS (Agent -> Owner USD Payouts) ═══════ */
async function pgPaymentRequests() {
  const c = document.getElementById('page-content');
  zyCrumb(['PAYMENTS', 'My Payment Requests']);

  let balUsd = 0;
  let thisWeekUsd = 0;
  let weekRangeStr = 'UTC Mon – Sun';
  let minPayout = 30;
  let payInfo = null;

  let wnNoticeHtml = '';
  let holdNoticeHtml = '';
  try {
    const [earn, settings, pRes] = await Promise.all([
      apiFetch(`/api/agent/${AGENT_ID}/earnings`),
      apiFetch('/api/settings').catch(() => ({})),
      apiFetch('/api/payments', { silent: true }).catch(() => null)
    ]);
    payInfo = pRes;
    balUsd = Number(earn?.main_balance ?? earn?.balance ?? 0);
    thisWeekUsd = Number(earn?.this_week ?? 0);
    if (earn?.week_range) weekRangeStr = earn.week_range;
    if (settings?.min_payout != null) minPayout = Number(settings.min_payout);
    if (payInfo && payInfo.hold_summary) {
      const hs = payInfo.hold_summary;
      const mcLive = payInfo.monthly_cycle || hs.monthly_cycle || {};
      const dynHold = Number.isFinite(Number(mcLive.hold_days)) ? Number(mcLive.hold_days) : 5;
      const dynTag = dynHold === 5 ? 'Monthly (30/5) {W}' : `Monthly (${mcLive.cycle_days || 30}/${dynHold}) {W}`;
      holdNoticeHtml = `
        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#1e293b;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <span><i class="fas fa-hourglass-half" style="color:#d97706;margin-right:6px;"></i> <b>Payout Hold Status:</b> Cleared <b>$${zyFmtMoney(Number(hs.cleared_usd || 0), 4)}</b> · On Hold <b>$${zyFmtMoney(Number(hs.held_usd || 0), 4)}</b>${hs.next_release_date ? ` · Next release: <b>${zyEsc(hs.next_release_date)}</b>` : ''}</span>
          <span style="font-size:11px;color:#475569;font-weight:600;">Weekly (7/3) API · ${zyEsc(dynTag)}</span>
        </div>`;
    }
    if (payInfo && (payInfo.whitenoise_access || window.ZY_WHITENOISE_ACCESS) && payInfo.monthly30_5) {
      const wn = payInfo.monthly30_5;
      const mc = payInfo.monthly_cycle || {};
      const holdDays = Number.isFinite(Number(wn.hold_days ?? mc.hold_days)) ? Number(wn.hold_days ?? mc.hold_days) : 5;
      const cycleDays = Number.isFinite(Number(wn.cycle_days ?? mc.cycle_days)) ? Number(wn.cycle_days ?? mc.cycle_days) : 30;
      const daysLeft = Number.isFinite(Number(wn.days_remaining ?? mc.days_remaining)) ? Number(wn.days_remaining ?? mc.days_remaining) : cycleDays;
      const dayInCycle = Number(wn.day_in_cycle ?? mc.day_in_cycle ?? 1);
      const cycleStart = wn.cycle_start || mc.start_date || '—';
      const cycleEnd = wn.cycle_end || mc.end_date || '—';
      const clearDate = wn.clear_date || mc.clear_date || wn.next_release_date || '—';
      const mcTitle = holdDays === 5
        ? 'Monthly Cycle (30/5) {W} Settlement Box'
        : `Monthly Cycle (${cycleDays}/${holdDays}) {W} Settlement Box`;
      const mcLabel = holdDays === 5 ? 'Monthly (30/5) {W}' : `Monthly (${cycleDays}/${holdDays}) {W}`;
      const completedCycles = Array.isArray(wn.completed_cycles) ? wn.completed_cycles : (Array.isArray(payInfo.completed_cycles) ? payInfo.completed_cycles : []);
      const completedRowsHtml = completedCycles.length ? `
        <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #c7d2fe;">
          <div style="font-size:11px;font-weight:800;color:#312e81;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">
            <i class="fas fa-archive" style="margin-right:4px;"></i> Completed 30-Day Whitenoise Cycles (${completedCycles.length})
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${completedCycles.slice(0, 4).map(cy => `
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;background:#fff;border:1px solid #e0e7ff;border-radius:6px;padding:6px 10px;font-size:11.5px;">
                <span><b>Cycle #${cy.cycle_number}</b> · ${zyEsc(cy.start_date)} → ${zyEsc(cy.end_date)} · <b>${Number(cy.sms_count || 0).toLocaleString()}</b> SMS</span>
                <span><b>$${zyFmtMoney(Number(cy.earned_usd || 0), 4)}</b> · ${cy.is_cleared ? '<span style="color:#059669;font-weight:700;">Cleared</span>' : `<span style="color:#d97706;font-weight:700;">Hold (${cy.days_until_clear}d left · Clears ${zyEsc(cy.clear_date)})</span>`}</span>
              </div>
            `).join('')}
          </div>
        </div>` : '';
      wnNoticeHtml = `
        <div style="background:linear-gradient(135deg,#eef2ff,#f8fafc);border:1.5px solid #c7d2fe;border-radius:10px;padding:12px 14px;margin-bottom:14px;color:#1e1b4b;">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:800;color:#312e81;">
              <i class="fas fa-calendar-check" style="color:#4f46e5;margin-right:6px;"></i> ${zyEsc(mcTitle)}
            </span>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span class="badge" style="background:#fff;color:#4338ca;border:1px solid #c7d2fe;font-weight:700;">Cycle: ${zyEsc(cycleStart)} → ${zyEsc(cycleEnd)}</span>
              <span class="badge" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-weight:700;">Day ${dayInCycle}/${cycleDays} · ${daysLeft}d left</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;font-size:12px;">
            <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
              <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">Cleared (USD)</div>
              <div style="font-size:15px;font-weight:800;color:#059669;margin-top:2px;">$${zyFmtMoney(Number(wn.cleared_usd || 0), 4)}</div>
            </div>
            <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
              <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">On Hold (${holdDays}d Hold)</div>
              <div style="font-size:15px;font-weight:800;color:#d97706;margin-top:2px;">$${zyFmtMoney(Number(wn.held_usd || 0), 4)}</div>
            </div>
            <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
              <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">Company Clear Date</div>
              <div style="font-size:14px;font-weight:800;color:#4338ca;margin-top:2px;">${zyEsc(clearDate)}</div>
            </div>
            <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
              <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">Monthly Route SMS</div>
              <div style="font-size:15px;font-weight:800;color:#0f172a;margin-top:2px;">${Number(wn.sms_count || 0).toLocaleString()}</div>
            </div>
          </div>
          <div style="font-size:11px;color:#4338ca;margin-top:8px;">${zyEsc(mcLabel)} auto-advances every ${cycleDays} days (Next: <b>${zyEsc(wn.next_cycle_start || mc.next_cycle_start || 'Auto')}</b>) and unlocks after <b>${holdDays} days hold</b> on <b>${zyEsc(clearDate)}</b>.</div>
          ${completedRowsHtml}
        </div>`;
    }
  } catch (e) { console.warn('Payment requests earnings fetch error:', e); }

  const ww = payInfo?.weekly_wallet || null;
  const mw = payInfo?.monthly_wallet || null;
  const weeklyAvailUsd = ww ? Number(ww.available_usd || 0) : balUsd;
  const weeklyPendingUsd = ww ? Number(ww.pending_usd || 0) : 0;
  const weeklyThisWeekLockedUsd = ww && ww.this_week_usd != null ? Number(ww.this_week_usd || 0) : thisWeekUsd;
  const weeklyNextMonday = ww?.next_monday_date || 'Next Monday';
  const monthlyAvailUsd = mw ? Number(mw.available_usd || 0) : 0;
  const monthlyHeldUsd = mw ? Number(mw.held_usd || 0) : 0;
  const monthlyPendingUsd = mw ? Number(mw.pending_usd || 0) : 0;
  const monthlyClearDate = mw?.clear_date || payInfo?.monthly30_5?.clear_date || payInfo?.monthly_cycle?.clear_date || 'End of cycle';
  const monthlyHoldDays = Number.isFinite(Number(mw?.hold_days ?? payInfo?.monthly_cycle?.hold_days)) ? Number(mw?.hold_days ?? payInfo?.monthly_cycle?.hold_days) : 5;
  const monthlyCycleDays = Number.isFinite(Number(mw?.cycle_days ?? payInfo?.monthly_cycle?.cycle_days)) ? Number(mw?.cycle_days ?? payInfo?.monthly_cycle?.cycle_days) : 30;
  const monthlyBadgeUpper = `MONTHLY (${monthlyCycleDays}/${monthlyHoldDays}) {W}`;
  const showMonthlyCard = Boolean(payInfo?.whitenoise_access || window.ZY_WHITENOISE_ACCESS || (mw && (Number(mw.earned_usd || 0) > 0 || monthlyAvailUsd > 0 || monthlyHeldUsd > 0)));

  const monthlyCardHtml = showMonthlyCard ? `
      <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1.5px solid #c7d2fe;background:#ffffff;box-shadow:0 1px 3px rgba(79,70,229,0.06);display:flex;flex-direction:column;justify-content:space-between;min-height:132px;">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-size:11.5px;font-weight:700;color:#4338ca;text-transform:uppercase;letter-spacing:0.3px;">Monthly {W} Balance ($)</div>
            <span class="badge" style="background:#ede9fe;color:#5b21b6;font-size:10px;font-weight:700;">${zyEsc(monthlyBadgeUpper)}</span>
          </div>
          <div class="zy-crs-num" style="font-size:24px;font-weight:800;color:${monthlyAvailUsd > 0 ? '#059669' : '#0f172a'};margin:4px 0 6px;">$<span id="bal-monthly-usd">${zyFmtMoney(monthlyAvailUsd, 2)}</span> <span style="font-size:11.5px;font-weight:600;color:#64748b;">matured</span></div>
          <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span><i class="fas fa-lock" style="color:#d97706;"></i> Held (${monthlyHoldDays}d): <strong>$${zyFmtMoney(monthlyHeldUsd, 2)}</strong></span>
            ${monthlyPendingUsd > 0 ? `<span style="color:#7c3aed;">· Pending: <b>$${zyFmtMoney(monthlyPendingUsd, 2)}</b></span>` : ''}
            <span>· Unlocks: <strong>${zyEsc(monthlyClearDate)}</strong></span>
          </div>
        </div>
        <div style="margin-top:12px;">
          ${monthlyAvailUsd > 0 ? `
            <button type="button" class="sp-btn-primary" style="height:32px;padding:0 14px;font-size:12px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;background:#4f46e5;border:none;color:#fff;cursor:pointer;" onclick="zyAgentRequestPayoutModal(${monthlyAvailUsd}, ${minPayout}, 'monthly')">
              <i class="fas fa-calendar-check"></i> Request Monthly {W} Payment
            </button>
          ` : `
            <button type="button" disabled style="height:32px;padding:0 14px;font-size:12px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;background:#e2e8f0;border:none;color:#64748b;cursor:not-allowed;" title="Monthly (${monthlyCycleDays}/${monthlyHoldDays}) {W} payout unlocks once the monthly cycle completes on ${zyEsc(monthlyClearDate)}">
              <i class="fas fa-lock"></i> Unlocks on ${zyEsc(monthlyClearDate)}
            </button>
          `}
        </div>
      </div>` : `
      <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1px solid #cbd5e1;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.04);display:flex;flex-direction:column;justify-content:space-between;min-height:132px;">
        <div>
          <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.3px;">This Week Mon-Sun</div>
          <div class="zy-crs-num" style="font-size:24px;font-weight:800;color:#2563eb;margin:4px 0 6px;">$<span id="bal-week">${zyFmtMoney(thisWeekUsd, 4)}</span></div>
          <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:4px;">
            <i class="fas fa-calendar-alt" style="color:#8b5cf6;"></i> <span>${zyEsc(weekRangeStr)}</span>
          </div>
        </div>
        <div style="margin-top:12px;font-size:11.5px;color:#059669;font-weight:600;display:flex;align-items:center;gap:5px;">
          <i class="fas fa-check-circle"></i> Auto-settles to Weekly (API) Balance at Sun 23:59:59 UTC
        </div>
      </div>`;

  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title"><i class="fas fa-wallet" style="color:#2563eb;"></i> My Payment Requests</div>
        <div class="page-subtitle">Submit separate Weekly (API) and Monthly {W} USD payout requests to Owner and track settlements.</div>
      </div>
    </div>

    <!-- Separated Weekly (API) & Monthly {W} Request Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(290px, 1fr));gap:12px;margin-bottom:16px;">
      <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1.5px solid #bfdbfe;background:#ffffff;box-shadow:0 1px 3px rgba(37,99,235,0.05);display:flex;flex-direction:column;justify-content:space-between;min-height:132px;">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-size:11.5px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.3px;">Weekly (API) Balance ($)</div>
            <span class="badge badge-blue" style="font-size:10px;font-weight:700;">WEEKLY (7/3) · API</span>
          </div>
          <div class="zy-crs-num" style="font-size:24px;font-weight:800;color:${weeklyAvailUsd > 0 ? '#059669' : '#0f172a'};margin:4px 0 6px;">$<span id="bal-usd">${zyFmtMoney(weeklyAvailUsd, 2)}</span> <span style="font-size:11.5px;font-weight:600;color:#64748b;">previous weeks</span></div>
          <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span><i class="fas fa-info-circle" style="color:#0ea5e9;"></i> Min payout: <strong>$${zyFmtMoney(minPayout, 2)}</strong></span>
            <span>· <i class="fas fa-lock" style="color:#d97706;"></i> This Week (Unlocks Mon ${zyEsc(weeklyNextMonday)}): <b>$${zyFmtMoney(weeklyThisWeekLockedUsd, 4)}</b></span>
            ${weeklyPendingUsd > 0 ? `<span style="color:#d97706;">· Pending: <b>$${zyFmtMoney(weeklyPendingUsd, 2)}</b></span>` : ''}
          </div>
        </div>
        <div style="margin-top:12px;">
          ${weeklyAvailUsd > 0 ? `
            <button type="button" class="sp-btn-primary" style="height:32px;padding:0 14px;font-size:12px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;background:#10b981;border:none;color:#fff;cursor:pointer;" onclick="zyAgentRequestPayoutModal(${weeklyAvailUsd}, ${minPayout}, 'weekly')">
              <i class="fas fa-paper-plane"></i> Request Weekly (API) Payment
            </button>
          ` : `
            <button type="button" disabled style="height:32px;padding:0 14px;font-size:12px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;background:#e2e8f0;border:none;color:#64748b;cursor:not-allowed;" title="Current week's earnings unlock on Monday (${zyEsc(weeklyNextMonday)}) after this week finishes">
              <i class="fas fa-lock"></i> ${weeklyThisWeekLockedUsd > 0 ? `Unlocks Mon ${zyEsc(weeklyNextMonday)}` : 'No Completed-Week Balance'}
            </button>
          `}
        </div>
      </div>

      ${monthlyCardHtml}
    </div>
    ${holdNoticeHtml}
    ${wnNoticeHtml}

    <!-- Date Filter -->
    <div class="zy-filterbox" style="margin-bottom:14px;">
      <input class="zy-fb-input" id="pr-from" value="${zyMonthStart()} 00:00:00" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
      <input class="zy-fb-input" id="pr-to" value="${zyToday()} 23:59:59" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
      <div class="zy-fb-btns"><button class="zy-btn-blue" onclick="pgPaymentRequestsLoad()">Show Report</button></div>
    </div>

    <div class="zy-panel">
      <div class="zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;">
        <span>My Payout Requests (To Owner)</span>
      </div>
      <div class="zy-panel-body" id="pr-body"><div class="zy-loading">Loading…</div></div>
    </div>`;

  pgPaymentRequestsLoad();
}

window.zyAgentRequestPayoutModal = async function(currentBal = 0, passedMin = null, payoutType = 'weekly') {
  const isMonthly = String(payoutType || 'weekly').toLowerCase() === 'monthly';
  const typeKey = isMonthly ? 'monthly' : 'weekly';
  const typeTitle = isMonthly ? 'Request Monthly {W} Payout' : 'Request Weekly (API) Payout';
  const typeBadge = isMonthly
    ? '<span class="badge" style="background:#ede9fe;color:#5b21b6;font-weight:700;">Monthly (30/5) {W} Pool</span>'
    : '<span class="badge badge-blue" style="font-weight:700;">Weekly (7/3) API Pool</span>';

  let minPayout = passedMin != null ? Number(passedMin) : 10;
  let bankAccounts = [];
  try {
    const [settings, banks] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch(`/api/bank-accounts?agent_id=${AGENT_ID}`)
    ]);
    minPayout = Number(settings?.min_payout ?? minPayout);
    bankAccounts = Array.isArray(banks) ? banks : (banks?.data || []);
  } catch (e) { console.warn('Payout modal settings fetch error:', e); }

  const bankOptions = bankAccounts.map(b => `<option value="${zyEsc(b.bank_name)} - ${zyEsc(b.account_no)}">${zyEsc(b.bank_name)} (${zyEsc(b.currency || 'USD')} - ${zyEsc(b.account_no)})</option>`).join('');

  zyModal(typeTitle, `
    <div style="background:${isMonthly ? '#f5f3ff' : '#f8fafc'};border:1px solid ${isMonthly ? '#c7d2fe' : '#e2e8f0'};border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="color:#64748b;">Payout Cycle:</span>
        ${typeBadge}
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="color:#64748b;">Available ${isMonthly ? 'Matured Monthly {W}' : 'Weekly (API)'} Balance:</span>
        <strong style="color:#10b981;font-size:15px;">$${zyFmtMoney(Number(currentBal), 2)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:#64748b;">Minimum Payout Limit:</span>
        <strong>$${zyFmtMoney(Number(minPayout), 2)}</strong>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <div>
        <label class="zy-lbl" style="font-weight:600;">Payout Amount ($) *</label>
        <input type="number" id="apr-amount" class="zy-input" style="width:100%;height:38px;" step="0.01" min="${minPayout}" max="${currentBal}" value="${currentBal >= minPayout ? currentBal : minPayout}">
      </div>
      <div>
        <label class="zy-lbl" style="font-weight:600;">Currency</label>
        <select id="apr-cur" class="zy-input" style="width:100%;height:38px;">
          <option value="USD" selected>USD ($)</option>
          <option value="EUR">EUR (€)</option>
          <option value="GBP">GBP (£)</option>
        </select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">Payment Method *</label>
      <select id="apr-method" class="zy-input" style="width:100%;height:38px;">
        <option value="USDT TRC20" selected>USDT (TRC-20)</option>
        <option value="Bank Transfer">Bank Wire Transfer</option>
        <option value="Payoneer">Payoneer</option>
        <option value="PayPal">PayPal</option>
      </select>
    </div>
    ${bankOptions ? `
      <div class="form-group" style="margin-bottom:12px;">
        <label class="zy-lbl" style="font-weight:600;">Saved Bank Account</label>
        <select id="apr-quick-bank" class="zy-input" style="width:100%;height:36px;" onchange="if(this.value)document.getElementById('apr-wallet').value=this.value;">
          <option value="">— Select Saved Bank Account —</option>
          ${bankOptions}
        </select>
      </div>
    ` : ''}
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">Wallet Address / IBAN / Account Details *</label>
      <input type="text" id="apr-wallet" class="zy-input" style="width:100%;height:38px;" placeholder="TRC20 Wallet Address or Account/IBAN">
    </div>
    <div class="form-group" style="margin-bottom:8px;">
      <label class="zy-lbl" style="font-weight:600;">Notes (Optional)</label>
      <input type="text" id="apr-notes" class="zy-input" style="width:100%;height:38px;" placeholder="${isMonthly ? 'Monthly {W} cycle settlement' : 'Weekly API traffic settlement'}">
    </div>
  `, `
    <button class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button class="sp-btn-primary" id="btn-submit-apr" onclick="zySubmitAgentPayout(${minPayout}, ${currentBal}, '${typeKey}')"><i class="fas fa-paper-plane"></i> Submit ${isMonthly ? 'Monthly {W}' : 'Weekly (API)'} Payout</button>
  `);
};

window.zySubmitAgentPayout = async function(minPayout, currentBal, payoutType = 'weekly') {
  const isMonthly = String(payoutType || 'weekly').toLowerCase() === 'monthly';
  const typeKey = isMonthly ? 'monthly' : 'weekly';
  const amt = parseFloat(document.getElementById('apr-amount')?.value);
  const cur = document.getElementById('apr-cur')?.value || 'USD';
  const method = document.getElementById('apr-method')?.value;
  const wallet = document.getElementById('apr-wallet')?.value.trim();
  const notes = document.getElementById('apr-notes')?.value.trim();

  if (isNaN(amt) || amt <= 0) { toast('Please enter a valid payout amount', 'error'); return; }
  if (amt < minPayout) { toast(`Payment low. Minimum payout is $${zyFmtMoney(minPayout, 2)}`, 'error'); return; }
  if (amt > currentBal) { toast(`Amount cannot exceed available ${isMonthly ? 'Monthly {W}' : 'Weekly (API)'} balance of $${zyFmtMoney(currentBal, 2)}`, 'error'); return; }
  if (!wallet) { toast('Please specify your wallet address or account details', 'error'); return; }

  const btn = document.getElementById('btn-submit-apr');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const res = await apiFetch('/api/payout-requests', {
      method: 'POST',
      body: JSON.stringify({
        amount: amt,
        currency: cur,
        payout_type: typeKey,
        method,
        wallet,
        notes,
        role: 'Agent',
        agent_id: AGENT_ID
      })
    });
    if (res && (res.id || res.success)) {
      closeModal();
      toast(`${isMonthly ? 'Monthly {W}' : 'Weekly (API)'} payout request submitted successfully`, 'success');
      pgPaymentRequests();
    } else {
      toast(res?.error || 'Failed to submit payout request', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Payout'; }
    }
  } catch (err) {
    toast(err.message || 'Error submitting payout request', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Payout'; }
  }
};

async function pgPaymentRequestsLoad() {
  const body = document.getElementById('pr-body');
  if (!body) return;
  body.innerHTML = `<div class="zy-loading">Loading…</div>`;
  const allList = zyList(await apiFetch(`/api/payout-requests?limit=500`))
    .filter(r => {
      const ts = r.timestamp || r.created || r.created_at || r.date;
      return zyInRange('pr', ts);
    });
  const myUsername = String(AGENT_USER?.username || '').toLowerCase();
  const myRequests = allList.filter(r => {
    const rRole = String(r.role || r.recipient_role || '').toLowerCase();
    const rUser = String(r.username || r.user || '').toLowerCase();
    return (rRole === 'agent' || rUser === myUsername || Number(r.user_id) === Number(AGENT_ID)) && rRole !== 'client';
  });

  const rows = myRequests.map(r => {
    const ts = r.timestamp || r.created || r.created_at || r.date;
    const st = (r.status || 'pending').toLowerCase();
    const isPaid = st === 'paid' || st === 'completed';
    const isRejected = st === 'rejected';
    const statusClass = isPaid ? 'status-active' : (isRejected ? 'status-inactive' : 'status-pending');
    const statusLabel = (r.status || 'Pending').toUpperCase();
    const isMonthlyReq = String(r.payout_type || '').toLowerCase() === 'monthly' || String(r.schedule || r.payterm || '').toLowerCase().includes('monthly');
    const cycleHtml = isMonthlyReq
      ? `<span class="badge" style="background:#ede9fe;color:#5b21b6;font-weight:700;">Monthly {W}</span>`
      : `<span class="badge badge-blue" style="font-weight:700;">Weekly (API)</span>`;
    const fmtUsd = v => `$${zyFmtMoney(Number(v || 0), 2)}`;
    return [
      (ts || '').replace('T', ' ').slice(0, 19),
      { v: isMonthlyReq ? 'Monthly {W}' : 'Weekly (API)', h: cycleHtml },
      zyEsc(r.method || r.mode || 'USDT TRC20'),
      { v: Number(r.amount || 0), h: `<span class="zy-crs-num" style="font-weight:700;">${fmtUsd(r.amount)}</span>` },
      { v: r.status || 'Pending', h: `<span class="badge ${statusClass}">${statusLabel}</span>` },
      zyEsc(r.wallet || r.address || '—'),
      isPaid ? `<span class="zy-crs-num">${fmtUsd(r.paid_amount || r.amount)}</span>` : '—',
      zyEsc(r.txid || r.transaction_id || '—'),
      zyEsc(r.notes || r.remarks || '—'),
      r.updated_at ? zyDateOnly(r.updated_at) : (r.paid_at ? zyDateOnly(r.paid_at) : (isPaid ? 'Paid' : '—'))
    ];
  });

  body.innerHTML = zyDT2('dt-payreq', {
    cols: ['Date', 'Cycle', 'Mode', 'Amount', 'Status', 'Address', 'Paid', 'Transaction', 'Remarks', 'Updated On'],
    rows,
    sort: 0,
    dir: -1
  });
  zy2Render('dt-payreq');
}

/* ═══ CLIENT PAYMENT REQUESTS (Agent -> Client PKR Queue + Weekly Target) ═══ */
window._zyAgtCprTab = 'all';
window._zyAgtClientPayoutsCache = [];

async function pgClientPaymentRequests(activeTab = 'all') {
  window._zyAgtCprTab = activeTab || 'all';
  const c = document.getElementById('page-content');
  zyCrumb(['PAYMENTS', 'Client Payment Requests']);

  try {
    const [payoutRes, settings, ratesRes, clientsRes] = await Promise.all([
      apiFetch('/api/payout-requests?limit=1000'),
      apiFetch('/api/settings').catch(() => ({})),
      zyFetchAgentClientRates(true).catch(() => ({})),
      apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=300`).catch(() => ({ data: [] }))
    ]);

    const fx = Number(ratesRes?.usd_to_pkr_rate || settings?.usd_to_pkr_rate || 280);
    const wt = ratesRes?.weekly_target || {};
    const minPayoutPkr = wt.client_min_payout_pkr != null
      ? Number(wt.client_min_payout_pkr)
      : Number(settings?.min_payout_pkr ?? 0);
    const hasCustomClientMin = wt.agent_client_min_payout_pkr != null;
    const target = Number(wt.weekly_pkr_target || 0);
    const used = Number(wt.weekly_pkr_used || 0);
    const rem = wt.weekly_pkr_remaining != null ? Number(wt.weekly_pkr_remaining) : null;
    const pct = Number(wt.weekly_pkr_percent || 0);
    const mode = wt.weekly_pkr_enforce_mode === 'block' ? 'block' : 'warn';
    const fillCls = pct >= 100 ? 'is-over' : (pct >= 80 ? 'is-warn' : '');

    const allPayouts = zyList(payoutRes);
    const clientRequests = allPayouts.filter(r => String(r.role || r.recipient_role || '').toLowerCase() === 'client');
    window._zyAgtClientPayoutsCache = clientRequests;

    const pkrAmt = r => {
      const isPkr = String(r.currency || 'PKR').toUpperCase() === 'PKR';
      return isPkr ? Number(r.amount_pkr != null ? r.amount_pkr : (r.amount || 0)) : (Number(r.amount || 0) * (Number(r.fx_usd_to_pkr) || fx));
    };
    const pendingList = clientRequests.filter(r => !['paid', 'completed'].includes((r.status || '').toLowerCase()));
    const paidList = clientRequests.filter(r => ['paid', 'completed'].includes((r.status || '').toLowerCase()));
    const pendingSumPkr = pendingList.reduce((acc, r) => acc + pkrAmt(r), 0);
    const paidSumPkr = paidList.reduce((acc, r) => acc + pkrAmt(r), 0);

    const clientsArr = zyList(clientsRes);
    const clientOpts = clientsArr.map(cl => `<option value="${zyEsc(cl.username)}">${zyEsc(cl.username)}</option>`).join('');

    c.innerHTML = `
      <div class="page-header" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
        <div>
          <div class="page-title"><i class="fas fa-hand-holding-dollar" style="color:#10b981;"></i> Client Payment Requests (PKR)</div>
          <div class="page-subtitle">Downline Client PKR payout approvals, receipt vouchers &amp; weekly PKR payout budget · FX: 1 USD = Rs. ${zyFmtMoney(fx, 2)} PKR</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-success btn-sm" onclick="loadPage('client-payment-tracker')">
            <i class="fas fa-bullseye"></i> Live Payment Tracker
          </button>
          <button type="button" class="btn btn-primary btn-sm" onclick="pgClientPaymentRequests('${zyEsc(activeTab)}')">
            <i class="fas fa-rotate"></i> Refresh
          </button>
        </div>
      </div>

      <!-- Weekly Client PKR Target & Budget Control (Fixed inside Client Payment Requests) -->
      <div class="zy-crs-card" style="margin-bottom:16px;">
        <div class="zy-crs-head">
          <div class="zy-crs-title"><i class="fas fa-bullseye" style="color:var(--sp-success);"></i> Weekly Client PKR Target (Mon–Sun UTC)</div>
          <span class="zy-crs-num" style="font-size:12px;font-weight:700;color:var(--sp-text-secondary);">
            ${target > 0 ? `${pct}% used · ${mode === 'block' ? 'Hard Cap (Block enabled)' : 'Warn Only'}` : 'No weekly cap configured'}
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">
          <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:var(--sp-text-primary);">
            Rs. ${used.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span style="font-size:13px;font-weight:600;color:var(--sp-text-secondary);">
              / ${target > 0 ? 'Rs. ' + target.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' PKR' : 'Unlimited'}
            </span>
          </div>
          ${rem != null ? `<div class="zy-crs-num" style="font-size:12px;color:var(--sp-text-secondary);">Remaining Weekly Cap: <strong>Rs. ${rem.toLocaleString(undefined, { maximumFractionDigits: 2 })} PKR</strong></div>` : ''}
        </div>
        <div class="zy-crs-track" aria-label="Weekly PKR target usage">
          <div class="zy-crs-fill ${fillCls}" style="width:${target > 0 ? Math.min(100, Math.max(0, pct)) : 0}%;"></div>
        </div>
        <div class="zy-crs-form-row">
          <div style="flex:1;min-width:165px;">
            <label class="zy-lbl" for="crs-client-min-payout">Client Min Payout (PKR)</label>
            <input type="number" id="crs-client-min-payout" class="zy-input zy-crs-num" min="0" step="10" value="${minPayoutPkr}" style="height:34px;" placeholder="0 = no minimum">
          </div>
          <div style="flex:1;min-width:165px;">
            <label class="zy-lbl" for="crs-target-val">Weekly Target (PKR)</label>
            <input type="number" id="crs-target-val" class="zy-input zy-crs-num" min="0" step="100" value="${target}" style="height:34px;" placeholder="0 = unlimited">
          </div>
          <div style="flex:1;min-width:190px;">
            <label class="zy-lbl" for="crs-target-mode">Cap Behavior</label>
            <select id="crs-target-mode" class="zy-input" style="height:34px;">
              <option value="warn" ${mode === 'warn' ? 'selected' : ''}>Warn Only (Track Budget)</option>
              <option value="block" ${mode === 'block' ? 'selected' : ''}>Block Client Requests at Cap</option>
            </select>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="crs-save-target-btn" style="height:34px;" onclick="zyCrsSaveTarget(true)">
            <i class="fas fa-check"></i> Save Target
          </button>
        </div>
      </div>

      <!-- 4-Card PKR Financial Metrics Strip (Owner-Style Parity) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
        <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1.5px solid #cbd5e1;background:#ffffff;">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Pending Approval</div>
          <div class="zy-crs-num" style="font-size:22px;font-weight:800;color:#d97706;margin-top:4px;">${pendingList.length} <span style="font-size:13px;font-weight:600;color:#64748b;">(Rs. ${pendingSumPkr.toLocaleString(undefined, { maximumFractionDigits: 2 })})</span></div>
        </div>
        <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1.5px solid #cbd5e1;background:#ffffff;">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Total Paid Out</div>
          <div class="zy-crs-num" style="font-size:22px;font-weight:800;color:#059669;margin-top:4px;">Rs. ${paidSumPkr.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        </div>
        <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1.5px solid #cbd5e1;background:#ffffff;">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Total Client Requests</div>
          <div class="zy-crs-num" style="font-size:22px;font-weight:800;color:#0f172a;margin-top:4px;">${clientRequests.length}</div>
        </div>
        <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1.5px solid #cbd5e1;background:#ffffff;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Client Min Payout</div>
            <span style="font-size:10px;font-weight:700;color:${hasCustomClientMin ? '#059669' : '#64748b'};">${hasCustomClientMin ? 'Agent Custom' : 'System Default'}</span>
          </div>
          <div class="zy-crs-num" style="font-size:22px;font-weight:800;color:#7c3aed;margin-top:4px;">Rs. ${zyFmtMoney(minPayoutPkr, 2)}</div>
        </div>
      </div>

      <!-- Filter Strip + Status Tabs + Settlement Table -->
      <div class="zy-panel">
        <div class="zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span>Downline Client PKR Requests</span>
            <div style="display:inline-flex;background:var(--sp-bg-surface);border:1px solid var(--sp-border);border-radius:8px;padding:2px;" id="cpr-agt-tabs">
              <button type="button" class="zy-crs-tab ${activeTab==='all'?'active':''}" onclick="zyAgtFilterClientPayouts('all')">All (${clientRequests.length})</button>
              <button type="button" class="zy-crs-tab ${activeTab==='pending'?'active':''}" onclick="zyAgtFilterClientPayouts('pending')">Pending (${pendingList.length})</button>
              <button type="button" class="zy-crs-tab ${activeTab==='paid'?'active':''}" onclick="zyAgtFilterClientPayouts('paid')">Paid (${paidList.length})</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <select id="cpr-agt-client-filter" class="zy-input" style="height:32px;width:165px;" onchange="zyAgtRenderClientPayoutTable()">
              <option value="">All Clients</option>
              ${clientOpts}
            </select>
            <input class="zy-input" id="cpr-agt-from" style="height:32px;width:140px;" value="${zyMonthStart()} 00:00:00" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
            <input class="zy-input" id="cpr-agt-to" style="height:32px;width:140px;" value="${zyToday()} 23:59:59" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
            <button type="button" class="btn btn-primary btn-xs" style="height:32px;padding:0 12px;" onclick="zyAgtRenderClientPayoutTable()">Filter</button>
          </div>
        </div>
        <div class="zy-panel-body" id="cpr-agt-body"><div class="zy-loading">Loading…</div></div>
      </div>`;

    zyAgtRenderClientPayoutTable();
  } catch (err) {
    console.error('Client payment requests load error:', err);
    c.innerHTML = `<div class="zy-panel"><div class="zy-panel-body" style="padding:28px;text-align:center;color:var(--sp-danger);">Failed to load Client Payment Requests: ${zyEsc(err.message)}</div></div>`;
  }
}

window.zyAgtFilterClientPayouts = function(tab) {
  window._zyAgtCprTab = tab || 'all';
  document.querySelectorAll('#cpr-agt-tabs button').forEach(b => {
    const label = b.textContent.toLowerCase();
    b.classList.toggle('active', label.startsWith(window._zyAgtCprTab));
  });
  zyAgtRenderClientPayoutTable();
};

window.zyAgtRenderClientPayoutTable = function() {
  const body = document.getElementById('cpr-agt-body');
  if (!body) return;
  const tab = window._zyAgtCprTab || 'all';
  const clientFilter = String(document.getElementById('cpr-agt-client-filter')?.value || '').trim().toLowerCase();
  const list = (window._zyAgtClientPayoutsCache || []).filter(r => {
    const st = String(r.status || 'pending').toLowerCase();
    const isPaid = st === 'paid' || st === 'completed';
    if (tab === 'pending' && isPaid) return false;
    if (tab === 'paid' && !isPaid) return false;
    if (clientFilter && String(r.username || r.user || '').toLowerCase() !== clientFilter) return false;
    const ts = r.timestamp || r.created || r.created_at || r.date;
    return zyInRange('cpr-agt', ts);
  });

  const rows = list.map(r => {
    const ts = r.timestamp || r.created || r.created_at || r.date;
    const st = String(r.status || 'pending').toLowerCase();
    const isPaid = st === 'paid' || st === 'completed';
    const statusClass = isPaid ? 'status-active' : 'status-pending';
    const statusLabel = isPaid ? 'PAID' : 'PENDING';
    const rawAmt = Number(r.amount_pkr != null ? r.amount_pkr : (r.amount || 0));
    const rawPaidAmt = Number(r.paid_amount_pkr != null ? r.paid_amount_pkr : (r.paid_amount || rawAmt));
    const fmtPkr = v => `Rs. ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} PKR`;

    const isMonthlyReq = String(r.payout_type || '').toLowerCase() === 'monthly' || String(r.schedule || r.payterm || '').toLowerCase().includes('monthly');
    const cycleBadge = isMonthlyReq
      ? `<span class="badge" style="background:#ede9fe;color:#5b21b6;font-weight:700;">Monthly {W}</span>`
      : `<span class="badge badge-blue" style="font-weight:700;">Weekly (API)</span>`;

    return [
      `<span class="zy-col-username"><strong>${zyEsc(r.username || r.user || 'Client')}</strong></span>`,
      { v: isMonthlyReq ? 'Monthly {W}' : 'Weekly (API)', h: cycleBadge },
      `<span class="badge badge-blue">${zyEsc(r.method || r.mode || 'Bank Transfer (IBAN)')}</span>`,
      { v: rawAmt, h: `<span class="zy-crs-num" style="font-weight:700;color:#059669;">${fmtPkr(rawAmt)}</span>` },
      { v: isPaid ? 'Paid' : 'Pending', h: `<span class="badge ${statusClass}">${statusLabel}</span>` },
      `<span class="monospace" style="font-size:11.5px;">${zyEsc(r.wallet || r.address || '—')}</span>`,
      isPaid ? `<span class="zy-crs-num">${fmtPkr(rawPaidAmt)}</span>` : '—',
      zyEsc(r.txid || r.transaction_id || '—'),
      (ts || '').replace('T', ' ').slice(0, 19),
      {
        v: '',
        h: !isPaid
          ? `<div style="display:inline-flex;gap:4px;justify-content:center;">
               <button type="button" class="btn btn-success btn-xs" onclick="zyAgtManageClientPayout(${Number(r.id)}, 'paid')"><i class="fas fa-check"></i> Pay</button>
               <button type="button" class="btn btn-warning btn-xs" onclick="zyAgtMarkClientPayoutPending(${Number(r.id)})" title="Keep Pending &amp; notify client"><i class="fas fa-clock"></i> Pending</button>
             </div>`
          : `<button type="button" class="btn btn-outline btn-xs" onclick="zyAgtPrintClientPayoutReceipt(${Number(r.id)})"><i class="fas fa-file-invoice"></i> Receipt</button>`
      }
    ];
  });

  body.innerHTML = zyDT2('dt-client-payreq', {
    cols: ['Client', 'Cycle', 'Method', 'Amount (PKR)', 'Status', 'Account / IBAN / Wallet', 'Paid (PKR)', 'Transaction', 'Requested At', 'Actions'],
    rows,
    sort: 8,
    dir: -1
  });
  zy2Render('dt-client-payreq');
};

window.zyAgtPrintClientPayoutReceipt = function(id) {
  const r = (window._zyAgtClientPayoutsCache || []).find(x => Number(x.id) === Number(id));
  if (!r) return;
  const siteName = (window.__BRAND_SETTINGS__ && window.__BRAND_SETTINGS__.site_name) || 'HUMAX SMS';
  const amt = Number(r.amount_pkr != null ? r.amount_pkr : (r.amount || 0));
  const html = `<html><head><title>PKR Receipt #${Number(r.id)}</title><style>body{font-family:Arial,sans-serif;padding:28px;max-width:640px;margin:0 auto;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:13px}th{background:#f8fafc;color:#475569}</style></head><body><h2>${zyEsc(siteName)} — Client PKR Payout Receipt</h2><p>Receipt #PKR-${Number(r.id)} · Status: <strong>PAID</strong></p><table><tr><th>Client</th><th>Method</th><th>Account / Wallet</th><th>Tx Reference</th></tr><tr><td>${zyEsc(r.username || r.user || '—')}</td><td>${zyEsc(r.method || '—')}</td><td>${zyEsc(r.wallet || '—')}</td><td>${zyEsc(r.txid || 'Paid')}</td></tr></table><h3 style="text-align:right;color:#059669;margin-top:18px;">Total Paid: Rs. ${zyFmtMoney(amt, 2)} PKR</h3></body></html>`;
  if (typeof zyPrintHtml === 'function') zyPrintHtml(html);
};

window.zyAgtManageClientPayout = function(id) {
  zyModal('Confirm Client PKR Payout', `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="zy-lbl" style="font-weight:600;">Transaction Reference / Slip ID (Optional)</label>
      <input type="text" id="agt-pay-txid" class="zy-input" style="width:100%;height:36px;" placeholder="JazzCash / SadaPay / Bank Trx ID">
    </div>
  `, `
    <button type="button" class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button type="button" class="btn btn-success btn-sm" id="btn-confirm-cli-pay" onclick="zyAgtSubmitClientPayoutAction(${Number(id)}, 'paid')">
      <i class="fas fa-check"></i> Mark Paid
    </button>
  `);
};

window.zyAgtMarkClientPayoutPending = async function(id) {
  try {
    const res = await apiFetch(`/api/payout-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending' })
    });
    if (res && !res.error) {
      toast('Client payout marked Pending and client notified', 'info');
      pgClientPaymentRequests(window._zyAgtCprTab || 'all');
    } else {
      toast(res?.error || 'Failed to update payout status', 'error');
    }
  } catch (err) {
    toast(err.message || 'Failed to update payout status', 'error');
  }
};

window.zyAgtSubmitClientPayoutAction = async function(id, status) {
  const refVal = (document.getElementById('agt-pay-txid')?.value || '').trim();
  const btn = document.getElementById('btn-confirm-cli-pay');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
  try {
    const payload = { status: 'paid', txid: refVal || undefined };
    const res = await apiFetch(`/api/payout-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    if (res && !res.error) {
      closeModal();
      toast('Client payout marked Paid', 'success');
      pgClientPaymentRequests(window._zyAgtCprTab || 'all');
    } else {
      toast(res?.error || 'Failed to update payout request', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Mark Paid'; }
    }
  } catch (err) {
    toast(err.message || 'Failed to update payout request', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Mark Paid'; }
  }
};

/* ═══ CLIENT LIVE PAYMENT TRACKER (Weekly Mon–Sun · API Only) ═══ */
window._zyCptState = {
  weekStart: null,
  data: null,
  search: '',
  hideZero: false,
  autoLive: true,
  timer: null,
  loading: false
};

window.zyCptStopLiveTimer = function() {
  if (window._zyCptState && window._zyCptState.timer) {
    clearInterval(window._zyCptState.timer);
    window._zyCptState.timer = null;
  }
};

window.zyCptStartLiveTimer = function() {
  window.zyCptStopLiveTimer();
  if (!window._zyCptState.autoLive) return;
  window._zyCptState.timer = setInterval(() => {
    const root = document.getElementById('zy-cpt-root');
    if (!root) {
      window.zyCptStopLiveTimer();
      return;
    }
    if (document.hidden) return;
    // Skip silent refresh while a modal is open so we don't disrupt typing
    const modalOv = document.getElementById('modal-overlay');
    if (modalOv && modalOv.classList.contains('open')) return;
    zyCptFetchAndRender(window._zyCptState.weekStart, true);
  }, 15000);
};

async function pgClientPaymentTracker(weekStart = null) {
  const c = document.getElementById('page-content');
  zyCrumb(['PAYMENTS', 'Client Payment Tracker']);
  window.zyCptStopLiveTimer();
  if (weekStart !== undefined && weekStart !== null) {
    window._zyCptState.weekStart = weekStart || null;
  }
  c.innerHTML = `<div id="zy-cpt-root" class="zy-cpt-root"><div class="zy-loading">Loading live API payment tracker…</div></div>`;
  await zyCptFetchAndRender(window._zyCptState.weekStart, false);
  window.zyCptStartLiveTimer();
}

async function zyCptFetchAndRender(weekStart = null, silent = false) {
  const root = document.getElementById('zy-cpt-root');
  if (!root || window._zyCptState.loading) return;
  window._zyCptState.loading = true;
  try {
    const qs = weekStart ? `?week_start=${encodeURIComponent(weekStart)}` : '';
    const data = await apiFetch(`/api/agent/client-payment-tracker${qs}`);
    if (!data || data.error) {
      if (!silent) {
        root.innerHTML = `<div class="zy-panel"><div class="zy-panel-body" style="padding:28px;text-align:center;color:var(--sp-danger);">${zyEsc(data?.error || 'Failed to load live payment tracker.')}</div></div>`;
      }
      return;
    }
    window._zyCptState.data = data;
    window._zyCptState.weekStart = data.week_start || weekStart || null;
    zyCptRender(silent);
  } catch (err) {
    if (!silent) {
      root.innerHTML = `<div class="zy-panel"><div class="zy-panel-body" style="padding:28px;text-align:center;color:var(--sp-danger);">Failed to load Client Payment Tracker: ${zyEsc(err.message)}</div></div>`;
    }
  } finally {
    window._zyCptState.loading = false;
  }
}

function zyCptFmtPkr(val) {
  const n = Number(val || 0);
  if (!Number.isFinite(n)) return 'Rs. 0';
  return 'Rs. ' + n.toLocaleString(undefined, { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

function zyCptFmtDayCell(val, sms) {
  const n = Number(val || 0);
  const cnt = Number(sms || 0);
  if (n <= 0 && cnt <= 0) {
    return `<span class="zy-cpt-zero">—</span>`;
  }
  return `<div class="zy-cpt-day-amt">${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div><div class="zy-cpt-day-sms">${cnt} SMS</div>`;
}

function zyCptRender(preserveFocus = false) {
  const root = document.getElementById('zy-cpt-root');
  const d = window._zyCptState.data;
  if (!root || !d) return;

  const activeElId = preserveFocus ? document.activeElement?.id : null;
  const activeSelStart = preserveFocus && document.activeElement && typeof document.activeElement.selectionStart === 'number'
    ? document.activeElement.selectionStart : null;
  const prevScrolls = {};
  root.querySelectorAll('.zy-cpt-table-scroll').forEach((el, idx) => {
    prevScrolls[idx] = el.scrollLeft;
  });

  const target = Number(d.target_pkr || 0);
  const days = Array.isArray(d.days) ? d.days : [];
  const searchQ = String(window._zyCptState.search || '').trim().toLowerCase();
  const hideZero = Boolean(window._zyCptState.hideZero);

  const matchSearch = r => !searchQ || String(r.username || '').toLowerCase().includes(searchQ) || String(r.full_name || '').toLowerCase().includes(searchQ);
  const reachedAll = Array.isArray(d.reached_clients) ? d.reached_clients : [];
  const trackingAll = Array.isArray(d.tracking_clients) ? d.tracking_clients : [];

  const reached = reachedAll.filter(matchSearch);
  const tracking = trackingAll.filter(r => matchSearch(r) && (!hideZero || Number(r.week_total_pkr || 0) > 0 || Number(r.weekly_unpaid_payable_pkr || 0) > 0));

  const sumR = d.summary?.reached || {};
  const sumT = d.summary?.tracking || {};
  const sumO = d.summary?.overall || {};

  const weekOptions = (d.available_weeks || []).map(w =>
    `<option value="${zyEsc(w.week_start)}" ${w.week_start === d.week_start ? 'selected' : ''}>${zyEsc(w.label)}</option>`
  ).join('');

  const lastSyncStr = d.server_time
    ? String(d.server_time).replace('T', ' ').slice(11, 19) + ' UTC'
    : 'Live';

  const dayHeadersHtml = days.map(day => `
    <th class="zy-cpt-th-day ${day.is_today ? 'is-today' : ''} ${day.is_future ? 'is-future' : ''}">
      <div class="zy-cpt-th-day-name">${zyEsc(day.label)}${day.is_today ? ' <span class="zy-cpt-today-dot" title="Today (Live)"></span>' : ''}</div>
      <div class="zy-cpt-th-day-date">${zyEsc(day.short_date)}</div>
    </th>`).join('');

  const buildRow = (r, isTopBox) => {
    const initials = String(r.username || 'C').slice(0, 2).toUpperCase();
    const daysCells = days.map((day, idx) => `
      <td class="zy-cpt-td-day ${day.is_today ? 'is-today' : ''} ${day.is_future ? 'is-future' : ''}">
        ${zyCptFmtDayCell(r.days_pkr?.[idx], r.days_sms?.[idx])}
      </td>`).join('');

    const pct = Math.min(100, Math.max(0, Number(r.progress_pct || 0)));
    const hasPendingReq = Array.isArray(r.pending_requests) && r.pending_requests.length > 0;
    const firstPending = hasPendingReq ? r.pending_requests[0] : null;
    const canPayDirect = Number(r.weekly_unpaid_payable_pkr || 0) > 0.01;

    let statusHtml = '';
    if (isTopBox) {
      if (r.status === 'paid') {
        statusHtml = `
          <span class="zy-cpt-badge is-paid"><i class="fas fa-circle-check"></i> Paid</span>
          ${r.week_paid_pkr > 0 ? `<div class="zy-cpt-sub-note">Settled ${zyCptFmtPkr(r.week_paid_pkr)}</div>` : ''}`;
      } else if (r.status === 'partial') {
        statusHtml = `
          <span class="zy-cpt-badge is-partial"><i class="fas fa-coins"></i> Partial Paid</span>
          <div class="zy-cpt-sub-note">Paid ${zyCptFmtPkr(r.week_paid_pkr)} · Unpaid <strong>${zyCptFmtPkr(r.week_remaining_unpaid_pkr)}</strong></div>`;
      } else if (hasPendingReq) {
        statusHtml = `
          <span class="zy-cpt-badge is-pending"><i class="fas fa-clock"></i> Req #${Number(firstPending.id)}</span>
          <div class="zy-cpt-sub-note">Requested ${zyCptFmtPkr(firstPending.amount_pkr)}</div>`;
      } else {
        statusHtml = `
          <span class="zy-cpt-badge is-ready"><i class="fas fa-bolt"></i> Ready to Pay</span>
          <div class="zy-cpt-sub-note">Unpaid API: <strong>${zyCptFmtPkr(r.weekly_unpaid_payable_pkr)}</strong></div>`;
      }
    } else {
      statusHtml = `
        <div class="zy-cpt-prog-wrap">
          <div class="zy-cpt-prog-meta">
            <span>${Number(r.progress_pct || 0).toFixed(1)}%</span>
            <span>${target > 0 ? `${zyCptFmtPkr(r.remaining_to_target_pkr)} left` : 'Tracking'}</span>
          </div>
          <div class="zy-cpt-prog-track"><div class="zy-cpt-prog-fill" style="width:${pct}%;"></div></div>
          ${hasPendingReq ? `<div class="zy-cpt-sub-note" style="color:#d97706;">Pending Req #${Number(firstPending.id)} (${zyCptFmtPkr(firstPending.amount_pkr)})</div>` : (r.week_paid_pkr > 0 ? `<div class="zy-cpt-sub-note" style="color:#059669;">Paid: ${zyCptFmtPkr(r.week_paid_pkr)}</div>` : '')}
        </div>`;
    }

    let actionHtml = '';
    if (isTopBox) {
      if (canPayDirect || hasPendingReq) {
        actionHtml = `
          <button type="button" class="btn btn-success btn-xs zy-cpt-pay-btn" onclick="zyCptOpenPayModal(${Number(r.client_id)})">
            <i class="fas fa-money-bill-wave"></i> ${hasPendingReq ? 'Settle / Pay' : 'Pay Now'}
          </button>`;
      } else if (r.latest_paid_receipt) {
        actionHtml = `
          <button type="button" class="btn btn-outline btn-xs" onclick="zyCptPrintReceipt(${Number(r.client_id)})">
            <i class="fas fa-file-invoice"></i> Receipt
          </button>`;
      } else {
        actionHtml = `<span class="zy-cpt-settled-txt"><i class="fas fa-check"></i> Settled</span>`;
      }
    } else {
      if (canPayDirect || hasPendingReq) {
        actionHtml = `
          <button type="button" class="btn btn-outline btn-xs zy-cpt-pay-soft" onclick="zyCptOpenPayModal(${Number(r.client_id)})" title="Settle available Weekly API balance (${zyCptFmtPkr(r.weekly_unpaid_payable_pkr)})">
            <i class="fas fa-wallet"></i> Pay
          </button>`;
      } else if (r.latest_paid_receipt) {
        actionHtml = `
          <button type="button" class="btn btn-outline btn-xs" onclick="zyCptPrintReceipt(${Number(r.client_id)})">
            <i class="fas fa-file-invoice"></i> Receipt
          </button>`;
      } else {
        actionHtml = `<span class="zy-cpt-muted-act">Tracking</span>`;
      }
    }

    const totalSubHtml = isTopBox
      ? (r.over_target_pkr > 0
          ? `<div class="zy-cpt-over-tag">+${zyCptFmtPkr(r.over_target_pkr)} over target</div>`
          : `<div class="zy-cpt-over-tag">Target hit (${Number(r.progress_pct || 100).toFixed(0)}%)</div>`)
      : `<div class="zy-cpt-day-sms">${Number(r.week_sms_count || 0).toLocaleString()} SMS</div>`;

    return `
      <tr class="zy-cpt-row ${isTopBox ? 'is-reached-row' : ''} ${r.status === 'paid' ? 'is-paid-row' : ''}">
        <td class="zy-cpt-td-client">
          <div class="zy-cpt-client-cell">
            <div class="zy-cpt-avatar ${isTopBox ? 'is-green' : 'is-blue'}">${zyEsc(initials)}</div>
            <div class="zy-cpt-client-meta">
              <div class="zy-cpt-client-name">${zyEsc(r.username)}</div>
              <div class="zy-cpt-client-sub">
                <span>${Number(r.week_sms_count || 0).toLocaleString()} SMS</span>
                ${r.saved_wallet ? `<span class="zy-cpt-wallet-dot" title="${zyEsc(r.saved_method + ': ' + r.saved_wallet)}">· ${zyEsc(r.saved_method)}</span>` : ''}
              </div>
            </div>
          </div>
        </td>
        ${daysCells}
        <td class="zy-cpt-td-total">
          <div class="zy-cpt-total-amt ${isTopBox ? 'is-green' : ''}">${zyCptFmtPkr(r.week_total_pkr)}</div>
          ${totalSubHtml}
        </td>
        <td class="zy-cpt-td-status">${statusHtml}</td>
        <td class="zy-cpt-td-act">${actionHtml}</td>
      </tr>`;
  };

  const buildFooter = (list, label, showUnpaid) => {
    const daySums = [0, 0, 0, 0, 0, 0, 0];
    let totPkr = 0;
    let totSms = 0;
    let totUnpaid = 0;
    for (const r of list) {
      for (let i = 0; i < 7; i++) daySums[i] += Number(r.days_pkr?.[i] || 0);
      totPkr += Number(r.week_total_pkr || 0);
      totSms += Number(r.week_sms_count || 0);
      totUnpaid += Number(r.week_remaining_unpaid_pkr || 0);
    }
    return `
      <tfoot>
        <tr class="zy-cpt-tfoot-row">
          <td class="zy-cpt-td-client"><strong>${zyEsc(label)} (${list.length})</strong></td>
          ${daySums.map((v, i) => `<td class="zy-cpt-td-day ${days[i]?.is_today ? 'is-today' : ''}"><strong>${v > 0 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</strong></td>`).join('')}
          <td class="zy-cpt-td-total"><strong>${zyCptFmtPkr(totPkr)}</strong><div class="zy-cpt-day-sms">${totSms.toLocaleString()} SMS</div></td>
          <td class="zy-cpt-td-status">${showUnpaid ? `<span class="zy-cpt-sub-note">Week Unpaid: <strong>${zyCptFmtPkr(totUnpaid)}</strong></span>` : ''}</td>
          <td class="zy-cpt-td-act"></td>
        </tr>
      </tfoot>`;
  };

  root.innerHTML = `
    <div class="zy-cpt-header">
      <div class="zy-cpt-header-left">
        <div class="page-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span><i class="fas fa-bullseye" style="color:#059669;"></i> Client Live Payment Tracker</span>
          <span class="zy-cpt-live-chip ${d.is_current_week && window._zyCptState.autoLive ? 'is-live' : ''}">
            <span class="zy-cpt-pulse"></span>
            ${d.is_current_week ? 'LIVE · API Weekly' : 'Archive Week · API Only'}
          </span>
        </div>
        <div class="page-subtitle">
          Mon–Sun UTC: <strong>${zyEsc(d.week_start)}</strong> to <strong>${zyEsc(d.week_end)}</strong> · Strictly API SMS traffic (Whitenoise excluded) · Updated ${zyEsc(lastSyncStr)}
        </div>
      </div>
      <div class="zy-cpt-header-controls">
        <div class="zy-cpt-week-nav">
          <button type="button" class="btn btn-outline btn-sm" onclick="zyCptSwitchWeek('${zyEsc(d.prev_week_start)}')" title="Previous Week">
            <i class="fas fa-chevron-left"></i>
          </button>
          <select id="cpt-week-select" class="zy-input zy-cpt-week-select" onchange="zyCptSwitchWeek(this.value)">
            ${weekOptions}
          </select>
          <button type="button" class="btn btn-outline btn-sm" ${d.next_week_start ? `onclick="zyCptSwitchWeek('${zyEsc(d.next_week_start)}')"` : 'disabled'} title="Next Week">
            <i class="fas fa-chevron-right"></i>
          </button>
        </div>
        <button type="button" class="btn ${window._zyCptState.autoLive ? 'btn-success' : 'btn-outline'} btn-sm" onclick="zyCptToggleAutoLive()" title="Toggle 15s automatic live tracking">
          <i class="fas fa-tower-broadcast"></i> ${window._zyCptState.autoLive ? 'Live: ON' : 'Live: OFF'}
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="zyCptFetchAndRender(window._zyCptState.weekStart, false)">
          <i class="fas fa-rotate"></i> Refresh
        </button>
      </div>
    </div>

    <!-- Target Control + Search Bar -->
    <div class="zy-cpt-toolbar-card">
      <div class="zy-cpt-target-group">
        <div class="zy-cpt-target-icon"><i class="fas fa-flag-checkered"></i></div>
        <div class="zy-cpt-target-fields">
          <label class="zy-lbl" for="cpt-target-input" style="margin:0 0 3px;">Per-Client Weekly Target (PKR)</label>
          <div class="zy-cpt-target-input-row">
            <div class="zy-cpt-rs-wrap">
              <span class="zy-cpt-rs-prefix">Rs.</span>
              <input type="number" id="cpt-target-input" class="zy-input zy-crs-num" min="0" step="50" value="${target}" placeholder="1500">
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="cpt-save-target-btn" onclick="zyCptSaveTarget()">
              <i class="fas fa-check"></i> Save Target
            </button>
          </div>
          <div class="zy-cpt-target-hint">Any client whose Mon–Sun API earnings reach <strong>${zyCptFmtPkr(target)}</strong> automatically moves into the Top Ready Box while live tracking continues through Sunday.</div>
        </div>
      </div>
      <div class="zy-cpt-search-group">
        <div class="zy-cpt-search-wrap">
          <i class="fas fa-magnifying-glass"></i>
          <input type="text" id="cpt-search-input" class="zy-input" value="${zyEsc(window._zyCptState.search)}" placeholder="Search client username…" oninput="zyCptOnSearch(this.value)">
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="loadPage('client-payment-requests')">
          <i class="fas fa-money-bill-transfer"></i> Requests Queue
        </button>
      </div>
    </div>

    <!-- 4 KPI Summary Cards -->
    <div class="zy-cpt-kpi-grid">
      <div class="zy-cpt-kpi is-green">
        <div class="zy-cpt-kpi-lbl">Target Reached (Top Box)</div>
        <div class="zy-cpt-kpi-val">${Number(sumR.count || 0)} <span class="zy-cpt-kpi-unit">Members</span></div>
        <div class="zy-cpt-kpi-sub">${zyCptFmtPkr(sumR.week_total_pkr)} · ${Number(sumR.week_sms_count || 0).toLocaleString()} SMS</div>
      </div>
      <div class="zy-cpt-kpi is-blue">
        <div class="zy-cpt-kpi-lbl">Tracking Below Target</div>
        <div class="zy-cpt-kpi-val">${Number(sumT.count || 0)} <span class="zy-cpt-kpi-unit">Members</span></div>
        <div class="zy-cpt-kpi-sub">${zyCptFmtPkr(sumT.week_total_pkr)} · ${Number(sumT.week_sms_count || 0).toLocaleString()} SMS</div>
      </div>
      <div class="zy-cpt-kpi is-amber">
        <div class="zy-cpt-kpi-lbl">Top Box Unpaid Ready</div>
        <div class="zy-cpt-kpi-val">${zyCptFmtPkr(sumR.week_remaining_unpaid_pkr)}</div>
        <div class="zy-cpt-kpi-sub">Total API Unpaid: ${zyCptFmtPkr(sumR.total_unpaid_payable_pkr)}</div>
      </div>
      <div class="zy-cpt-kpi is-teal">
        <div class="zy-cpt-kpi-lbl">Settled for This Week</div>
        <div class="zy-cpt-kpi-val">${zyCptFmtPkr(sumO.week_paid_pkr)}</div>
        <div class="zy-cpt-kpi-sub">Week Total: ${zyCptFmtPkr(sumO.week_total_pkr)} (${Number(sumO.week_sms_count || 0).toLocaleString()} SMS)</div>
      </div>
    </div>

    <!-- BOX 1 (TOP): TARGET REACHED — READY FOR PAYOUT -->
    <div class="zy-cpt-box is-reached">
      <div class="zy-cpt-box-head">
        <div class="zy-cpt-box-title-wrap">
          <div class="zy-cpt-box-icon is-green"><i class="fas fa-trophy"></i></div>
          <div>
            <div class="zy-cpt-box-title">
              Target Reached (${target > 0 ? '≥ ' + zyCptFmtPkr(target) : 'Active'}) — Ready for Payout
              <span class="zy-cpt-count-badge is-green">${reached.length}</span>
            </div>
            <div class="zy-cpt-box-sub">Auto-promoted members · Live Mon–Sun API counting stays active until Sunday · Pay directly even without a client request</div>
          </div>
        </div>
        <div class="zy-cpt-box-totals">
          <div class="zy-cpt-box-stat"><span>Box Total</span><strong>${zyCptFmtPkr(sumR.week_total_pkr)}</strong></div>
          <div class="zy-cpt-box-stat"><span>Unpaid Ready</span><strong style="color:#059669;">${zyCptFmtPkr(sumR.week_remaining_unpaid_pkr)}</strong></div>
        </div>
      </div>
      <div class="zy-cpt-box-body">
        ${reached.length > 0 ? `
          <div class="zy-cpt-table-scroll">
            <table class="zy-cpt-table">
              <thead>
                <tr>
                  <th class="zy-cpt-th-client">Member</th>
                  ${dayHeadersHtml}
                  <th class="zy-cpt-th-total">Week Total</th>
                  <th class="zy-cpt-th-status">Payout Status</th>
                  <th class="zy-cpt-th-act">Action</th>
                </tr>
              </thead>
              <tbody>${reached.map(r => buildRow(r, true)).join('')}</tbody>
              ${buildFooter(reached, 'Top Box Total', true)}
            </table>
          </div>
        ` : `
          <div class="zy-cpt-empty">
            <i class="fas fa-bullseye"></i>
            <div>
              <strong>No clients have reached ${zyCptFmtPkr(target)} yet this week</strong>
              <span>As soon as any member's live Mon–Sun API earnings reach ${zyCptFmtPkr(target)}, they automatically move from the tracking box below into this top payout box.</span>
            </div>
          </div>
        `}
      </div>
    </div>

    <!-- BOX 2 (BOTTOM): LIVE MEMBER TRACKING — BELOW TARGET -->
    <div class="zy-cpt-box is-tracking">
      <div class="zy-cpt-box-head">
        <div class="zy-cpt-box-title-wrap">
          <div class="zy-cpt-box-icon is-blue"><i class="fas fa-chart-line"></i></div>
          <div>
            <div class="zy-cpt-box-title">
              Live Member Tracking (${target > 0 ? '< ' + zyCptFmtPkr(target) : 'All Members'})
              <span class="zy-cpt-count-badge is-blue">${tracking.length}</span>
            </div>
            <div class="zy-cpt-box-sub">Daily Mon–Sun API earnings countdown · Sorted highest first so members closest to target appear at the top</div>
          </div>
        </div>
        <div class="zy-cpt-box-totals">
          <label class="zy-cpt-hidezero-lbl">
            <input type="checkbox" ${hideZero ? 'checked' : ''} onchange="zyCptToggleHideZero(this.checked)">
            <span>Hide Rs. 0</span>
          </label>
          <div class="zy-cpt-box-stat"><span>Box Total</span><strong>${zyCptFmtPkr(sumT.week_total_pkr)}</strong></div>
        </div>
      </div>
      <div class="zy-cpt-box-body">
        ${tracking.length > 0 ? `
          <div class="zy-cpt-table-scroll">
            <table class="zy-cpt-table">
              <thead>
                <tr>
                  <th class="zy-cpt-th-client">Member</th>
                  ${dayHeadersHtml}
                  <th class="zy-cpt-th-total">Week Total</th>
                  <th class="zy-cpt-th-status">Target Progress</th>
                  <th class="zy-cpt-th-act">Action</th>
                </tr>
              </thead>
              <tbody>${tracking.map(r => buildRow(r, false)).join('')}</tbody>
              ${buildFooter(tracking, 'Tracking Box Total', false)}
            </table>
          </div>
        ` : `
          <div class="zy-cpt-empty">
            <i class="fas fa-users"></i>
            <div>
              <strong>${searchQ ? 'No matching clients in tracking box' : (hideZero ? 'No active below-target clients (Rs. 0 hidden)' : 'All members have reached the weekly target!')}</strong>
              <span>${hideZero ? 'Uncheck "Hide Rs. 0" to view all downline members.' : 'Every client meeting the target is listed in the Top Box above.'}</span>
            </div>
          </div>
        `}
      </div>
    </div>
  `;

  root.querySelectorAll('.zy-cpt-table-scroll').forEach((el, idx) => {
    if (prevScrolls[idx]) el.scrollLeft = prevScrolls[idx];
  });
  if (activeElId) {
    const el = document.getElementById(activeElId);
    if (el) {
      el.focus();
      if (activeSelStart !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(activeSelStart, activeSelStart); } catch (_) {}
      }
    }
  }
}

window.zyCptSwitchWeek = function(weekStart) {
  window._zyCptState.weekStart = weekStart || null;
  zyCptFetchAndRender(window._zyCptState.weekStart, false);
};

window.zyCptToggleAutoLive = function() {
  window._zyCptState.autoLive = !window._zyCptState.autoLive;
  if (window._zyCptState.autoLive) window.zyCptStartLiveTimer();
  else window.zyCptStopLiveTimer();
  zyCptRender(false);
};

window.zyCptToggleHideZero = function(checked) {
  window._zyCptState.hideZero = Boolean(checked);
  zyCptRender(false);
};

window.zyCptOnSearch = function(val) {
  window._zyCptState.search = String(val || '');
  zyCptRender(true);
};

window.zyCptSaveTarget = async function() {
  const inp = document.getElementById('cpt-target-input');
  const val = parseFloat(inp?.value);
  if (isNaN(val) || val < 0) {
    toast('Enter a valid PKR target (0 or positive amount)', 'error');
    return;
  }
  const btn = document.getElementById('cpt-save-target-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await apiFetch('/api/agent/client-payment-tracker/target', {
      method: 'PUT',
      body: JSON.stringify({ target_pkr: val })
    });
    if (res && res.success) {
      toast(`Client weekly target updated to ${zyCptFmtPkr(res.target_pkr)}`, 'success');
      await zyCptFetchAndRender(window._zyCptState.weekStart, false);
    } else {
      toast(res?.error || 'Failed to update target', 'error');
    }
  } catch (err) {
    toast(err.message || 'Failed to update target', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Save Target'; }
  }
};

window._zyCptFindClient = function(clientId) {
  const d = window._zyCptState.data;
  if (!d) return null;
  const cid = Number(clientId);
  return (d.reached_clients || []).find(r => Number(r.client_id) === cid)
    || (d.tracking_clients || []).find(r => Number(r.client_id) === cid)
    || null;
};

window.zyCptOpenPayModal = function(clientId) {
  const d = window._zyCptState.data;
  const r = window._zyCptFindClient(clientId);
  if (!d || !r) return;

  const pendingReqs = Array.isArray(r.pending_requests) ? r.pending_requests : [];
  const firstPending = pendingReqs[0] || null;
  const maxDirect = Number(r.weekly_unpaid_payable_pkr || 0);
  const weekUnpaid = Number(r.week_remaining_unpaid_pkr || 0);
  const defaultAmt = weekUnpaid > 0.01 ? weekUnpaid : maxDirect;

  const methods = ['Bank Transfer (IBAN)', 'JazzCash', 'Easypaisa', 'SadaPay / NayaPay', 'Cash / Direct'];
  const savedMethod = methods.includes(r.saved_method) ? r.saved_method : 'Bank Transfer (IBAN)';

  const pendingBlock = firstPending ? `
    <div class="zy-cpt-modal-pending">
      <div style="font-weight:700;color:#b45309;margin-bottom:6px;">
        <i class="fas fa-clock"></i> Client already submitted Pending Request #${Number(firstPending.id)} (${zyCptFmtPkr(firstPending.amount_pkr)})
      </div>
      <div style="font-size:12px;color:#78350f;margin-bottom:8px;">
        Method: <strong>${zyEsc(firstPending.method)}</strong>${firstPending.wallet ? ` · Account: <span class="monospace">${zyEsc(firstPending.wallet)}</span>` : ''}
      </div>
      <label class="zy-cpt-radio-opt">
        <input type="radio" name="cpt-pay-mode" value="settle_request" checked onchange="zyCptTogglePayMode()">
        <span>Settle Pending Request #${Number(firstPending.id)} (${zyCptFmtPkr(firstPending.amount_pkr)})</span>
      </label>
      ${maxDirect > 0.01 ? `
        <label class="zy-cpt-radio-opt">
          <input type="radio" name="cpt-pay-mode" value="direct" onchange="zyCptTogglePayMode()">
          <span>Direct Agent Payout (from remaining unpaid API balance: ${zyCptFmtPkr(maxDirect)})</span>
        </label>` : ''}
      <input type="hidden" id="cpt-settle-req-id" value="${Number(firstPending.id)}">
    </div>` : '';

  const hideDirectInitially = Boolean(firstPending);

  zyModal(`Direct Weekly (API) Payout — ${zyEsc(r.username)}`, `
    <div class="zy-cpt-modal-summary">
      <div class="zy-cpt-ms-item">
        <span>Tracked Week</span>
        <strong>${zyEsc(d.week_start)} → ${zyEsc(d.week_end)}</strong>
      </div>
      <div class="zy-cpt-ms-item">
        <span>Week Earned (API)</span>
        <strong style="color:#059669;">${zyCptFmtPkr(r.week_total_pkr)}</strong>
      </div>
      <div class="zy-cpt-ms-item">
        <span>Unpaid API Balance</span>
        <strong style="color:#1d4ed8;">${zyCptFmtPkr(maxDirect)}</strong>
      </div>
    </div>
    ${pendingBlock}
    <div id="cpt-direct-fields" style="${hideDirectInitially ? 'display:none;' : ''}">
      <div class="form-group" style="margin-bottom:10px;">
        <label class="zy-lbl" style="font-weight:600;">Payout Amount (PKR) *</label>
        <input type="number" id="cpt-pay-amount" class="zy-input zy-crs-num" min="1" max="${maxDirect}" step="0.01" value="${defaultAmt > 0 ? defaultAmt : ''}" style="width:100%;height:38px;">
        <div class="zy-cpt-quick-fills">
          ${weekUnpaid > 0.01 ? `<button type="button" class="zy-cpt-qf-btn" onclick="document.getElementById('cpt-pay-amount').value='${weekUnpaid}'">This Week Unpaid (${zyCptFmtPkr(weekUnpaid)})</button>` : ''}
          ${maxDirect > 0.01 && Math.abs(maxDirect - weekUnpaid) > 0.01 ? `<button type="button" class="zy-cpt-qf-btn" onclick="document.getElementById('cpt-pay-amount').value='${maxDirect}'">Full Unpaid API (${zyCptFmtPkr(maxDirect)})</button>` : ''}
        </div>
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="zy-lbl" style="font-weight:600;">Payment Method</label>
        <select id="cpt-pay-method" class="zy-input" style="width:100%;height:38px;">
          ${methods.map(m => `<option value="${zyEsc(m)}" ${m === savedMethod ? 'selected' : ''}>${zyEsc(m)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="zy-lbl" style="font-weight:600;">Client Account / IBAN / Wallet</label>
        <input type="text" id="cpt-pay-wallet" class="zy-input" style="width:100%;height:38px;" value="${zyEsc(r.saved_wallet || '')}" placeholder="JazzCash / Easypaisa / Bank Account / IBAN">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="zy-lbl" style="font-weight:600;">Transaction Reference / Slip ID (Optional)</label>
      <input type="text" id="cpt-pay-txid" class="zy-input" style="width:100%;height:38px;" placeholder="TRX ID / Bank Reference">
    </div>
    <div class="form-group" style="margin-bottom:4px;">
      <label class="zy-lbl" style="font-weight:600;">Note (Optional)</label>
      <input type="text" id="cpt-pay-notes" class="zy-input" style="width:100%;height:36px;" placeholder="Weekly API settlement note">
    </div>
    <div style="font-size:11.5px;color:#64748b;margin-top:8px;">
      <i class="fas fa-shield-halved" style="color:#059669;"></i> Deducts strictly from this client's Weekly (API) balance, creates a paid receipt &amp; credit note, and notifies the client automatically. Whitenoise funds are untouched.
    </div>
  `, `
    <button type="button" class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button type="button" class="btn btn-success btn-sm" id="btn-cpt-confirm-pay" onclick="zyCptSubmitPay(${Number(r.client_id)})">
      <i class="fas fa-check"></i> Confirm &amp; Mark Paid
    </button>
  `);
};

window.zyCptTogglePayMode = function() {
  const mode = document.querySelector('input[name="cpt-pay-mode"]:checked')?.value || 'direct';
  const box = document.getElementById('cpt-direct-fields');
  if (box) box.style.display = mode === 'settle_request' ? 'none' : '';
};

window.zyCptSubmitPay = async function(clientId) {
  const d = window._zyCptState.data;
  const modeEl = document.querySelector('input[name="cpt-pay-mode"]:checked');
  const mode = modeEl ? modeEl.value : 'direct';
  const txid = String(document.getElementById('cpt-pay-txid')?.value || '').trim();
  const notes = String(document.getElementById('cpt-pay-notes')?.value || '').trim();
  const payload = {
    client_id: Number(clientId),
    week_start: d?.week_start || '',
    txid,
    notes
  };

  if (mode === 'settle_request') {
    payload.settle_request_id = Number(document.getElementById('cpt-settle-req-id')?.value || 0);
  } else {
    const amt = parseFloat(document.getElementById('cpt-pay-amount')?.value || '0');
    if (!Number.isFinite(amt) || amt <= 0) {
      toast('Enter a valid positive PKR payout amount', 'error');
      return;
    }
    payload.amount_pkr = amt;
    payload.method = String(document.getElementById('cpt-pay-method')?.value || 'Bank Transfer (IBAN)').trim();
    payload.wallet = String(document.getElementById('cpt-pay-wallet')?.value || '').trim();
  }

  const btn = document.getElementById('btn-cpt-confirm-pay');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
  try {
    const res = await apiFetch('/api/agent/client-payment-tracker/pay', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res && res.success) {
      closeModal();
      const paidAmt = Number(res.payout?.amount_pkr || res.payout?.amount || payload.amount_pkr || 0);
      toast(`Client paid ${zyCptFmtPkr(paidAmt)} successfully`, 'success');
      await zyCptFetchAndRender(window._zyCptState.weekStart, false);
    } else {
      toast(res?.error || 'Failed to settle client payout', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirm &amp; Mark Paid'; }
    }
  } catch (err) {
    toast(err.message || 'Failed to settle client payout', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirm &amp; Mark Paid'; }
  }
};

window.zyCptPrintReceipt = function(clientId) {
  const d = window._zyCptState.data;
  const r = window._zyCptFindClient(clientId);
  if (!r || !r.latest_paid_receipt) return;
  const rec = r.latest_paid_receipt;
  const siteName = (window.__BRAND_SETTINGS__ && window.__BRAND_SETTINGS__.site_name) || 'HUMAX SMS';
  const html = `<html><head><title>Weekly API Payout Receipt #${Number(rec.id)}</title><style>body{font-family:Arial,sans-serif;padding:28px;max-width:640px;margin:0 auto;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:13px}th{background:#f8fafc;color:#475569}</style></head><body><h2>${zyEsc(siteName)} — Client Weekly (API) Payout Receipt</h2><p>Receipt #PKR-${Number(rec.id)} · Week: <strong>${zyEsc(d?.week_start || '')} to ${zyEsc(d?.week_end || '')}</strong> · Status: <strong>PAID</strong></p><table><tr><th>Client</th><th>Method</th><th>Account / Wallet</th><th>Tx Reference</th></tr><tr><td>${zyEsc(r.username)}</td><td>${zyEsc(rec.method || '—')}</td><td>${zyEsc(rec.wallet || '—')}</td><td>${zyEsc(rec.txid || 'Paid')}</td></tr></table><h3 style="text-align:right;color:#059669;margin-top:18px;">Total Paid: Rs. ${zyFmtMoney(rec.amount_pkr, 2)} PKR</h3></body></html>`;
  if (typeof zyPrintHtml === 'function') zyPrintHtml(html);
};

/* ═══ BANK ACCOUNTS ═════════════════════════════════════════ */
async function pgBankAccounts() {
  const c = document.getElementById('page-content');
  zyCrumb(['Bank Accounts']);
  c.innerHTML = `<div class="zy-intro">Here you can add your bank accounts and use them while requesting payments.</div>
    <div class="zy-panel"><div class="zy-panel-head">Manage Bank Accounts
      <div class="zy-head-acts">
        <button class="zy-act zy-act-blue" onclick="zyAddBankModal()" title="Add Bank Account">${zyImg('btn_add')}</button>
      </div></div>
      <div class="zy-panel-body" id="bk-body"><div class="zy-loading">Loading…</div></div></div>`;
  let list = [];
  try { list = zyList(await apiFetch(`/api/bank-accounts?agent_id=${AGENT_ID}`)); } catch (e) { list = []; }
  const rows = list.map(b => [b.currency || '', b.country || '', b.bank_name || '', b.bank_branch || '',
                              b.bank_address || '', b.account_no || '', b.beneficiary || '']);
  document.getElementById('bk-body').innerHTML = zyDT2('dt-bank', {
    cols: ['Currency', 'Country', 'Bank Name', 'Bank Branch', 'Bank Address', 'Account No.', 'Beneficiary'], rows });
  zy2Render('dt-bank');
}
const ZY_COUNTRIES = ['Afghanistan', 'Aland Islands', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola',
  'Argentina', 'Armenia', 'Australia', 'Austria', 'Bahrain', 'Bangladesh', 'Belgium', 'Brazil', 'Canada', 'China',
  'Egypt', 'France', 'Germany', 'India', 'Indonesia', 'Iraq', 'Italy', 'Japan', 'Kenya', 'Malaysia', 'Nigeria',
  'Pakistan', 'Philippines', 'Saudi Arabia', 'Singapore', 'Spain', 'Turkey', 'Ukraine', 'United Arab Emirates',
  'United Kingdom', 'United States', 'Vietnam'];
function zyAddBankModal() {
  zyModal('Add New Bank Account', `
    <label class="zy-lbl">Currency</label>
    <select class="zy-input" id="bk-cur"><option value="">Select Currency</option>
      <option>USD</option><option>EUR</option><option>GBP</option></select>
    <label class="zy-lbl">Country</label>
    ${zyS2('bk-country', 'Select Country', ZY_COUNTRIES)}
    <label class="zy-lbl">Bank Name</label><input class="zy-input" id="bk-name" placeholder="Bank Name">
    <label class="zy-lbl">Bank Branch</label><input class="zy-input" id="bk-branch" placeholder="Bank Branch">
    <label class="zy-lbl">Bank Address</label><input class="zy-input" id="bk-addr" placeholder="Bank Address">
    <label class="zy-lbl">Account No./IBAN</label><input class="zy-input" id="bk-acc" placeholder="Account Number/IBAN">
    <label class="zy-lbl">Beneficiary Name</label><input class="zy-input" id="bk-ben" placeholder="Beneficiary Name">`,
    `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
     <button class="zy-btn-blue" onclick="zySaveBank()">Add</button>`);
}
async function zySaveBank() {
  const p = { agent_id: AGENT_ID,
    currency: document.getElementById('bk-cur').value,
    country: zyS2Value('bk-country'),
    bank_name: document.getElementById('bk-name').value.trim(),
    bank_branch: document.getElementById('bk-branch').value.trim(),
    bank_address: document.getElementById('bk-addr').value.trim(),
    account_no: document.getElementById('bk-acc').value.trim(),
    beneficiary: document.getElementById('bk-ben').value.trim() };
  if (!p.currency || !p.bank_name) { toast('Currency and bank name required', 'error'); return; }
  try {
    const res = await apiFetch('/api/bank-accounts', { method: 'POST', body: JSON.stringify(p) });
    if (!res || res.error) { toast(res?.error || 'Failed to add bank account', 'error'); return; }
    closeModal(); zyFlash('Bank Account Added.'); loadPage('bank-accounts');
  } catch (e) { console.error('Save bank error:', e); toast('Failed to save bank account', 'error'); }
}

/* ═══ STATEMENTS ════════════════════════════════════════════ */
async function pgStatements(cur) {
  const c = document.getElementById('page-content');
  zyCrumb([cur + ' Statements']);
  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-file-invoice-dollar" style="color:#2563eb;"></i> ${cur} Statements</div>
        <div class="page-subtitle">Track your credit notes, debits, and running balance ledger in ${cur}.</div>
      </div>
    </div>
    <div class="zy-filterbox">
      <input class="zy-fb-input" id="sm-from" value="${zyMonthStart()} 00:00:00">
      <input class="zy-fb-input" id="sm-to" value="${zyToday()} 23:59:59">
      <div class="zy-fb-btns"><button class="zy-btn-blue" onclick="pgStatementsLoad('${cur}')">Show Report</button></div>
    </div>
    <div class="card zy-panel">
      <div class="card-header zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;">
        <span class="card-title">${cur} Statements</span>
      </div>
      <div class="card-body zy-panel-body" id="sm-body"><div class="zy-loading">Loading…</div></div>
    </div>`;
  pgStatementsLoad(cur);
}
async function pgStatementsLoad(cur) {
  const body = document.getElementById('sm-body');
  body.innerHTML = `<div class="zy-loading">Loading…</div>`;
  let balance = 0;
  const rows = zyList(await apiFetch('/api/credit-notes?limit=500'))
    .filter(n => String(n.agent_id) === String(AGENT_ID))
    .filter(n => (n.currency || 'USD') === cur)
    .filter(n => zyInRange('sm', n.created || n.date))
    .sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')))
    .map(n => {
      const credit = Number(n.amount || 0);
      balance = Math.round((balance + credit) * 1000) / 1000;
      return [zyDateOnly(n.created || n.date), zyFmtMoney(credit, 2), '0', 'Credit Note', zyFmtMoney(balance, 2), n.reason || ''];
    }).reverse();
  body.innerHTML = zyDT2('dt-stmt', {
    cols: ['Date', 'Credit', 'Debit', 'Transaction For', 'Balance', 'Remarks'], rows, sort: 0, dir: -1 });
  zy2Render('dt-stmt');
}

/* ═══ BULK ADD ══════════════════════════════════════════════ */
/* ═══ BULK ADD NUMBERS QUEUE (V6) ═══════════════════════════ */
window._zyBulkJobsQueue = window._zyBulkJobsQueue || [];

async function pgBulkAdd() {
  const c = document.getElementById('page-content');
  zyCrumb(['SMS Module', 'Bulk Add']);

  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title" style="font-size:18px;font-weight:800;color:#0f172a;">
          <i class="fas fa-layer-group" style="color:#00a86b;margin-right:6px;"></i> Bulk Allocation to Client
        </div>
        <div class="page-subtitle" style="font-size:12.5px;color:#64748b;">Queue bulk number allocations to clients with instant pool availability checks and live job progress.</div>
      </div>
    </div>
    <div class="apx-card" style="border:1.5px solid #cbd5e1;border-radius:10px;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.04);overflow:hidden;">
      <div class="apx-card-header" style="height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:#f8fafc;border-bottom:1px solid #cbd5e1;">
        <span style="font-weight:700;font-size:13px;color:#1e293b;">
          <i class="fas fa-layer-group" style="color:#00a86b;margin-right:6px;"></i> Bulk Add Numbers to Client
        </span>
        <div id="ba-pool-stat-wrap"></div>
      </div>
      <div class="apx-card-body" style="padding:16px;">
        <div class="zy-bulk-card" style="max-width:680px;margin:10px auto 20px;">
          <div style="display:flex;flex-direction:column;gap:16px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
              <div>
                <label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;color:var(--sp-text-secondary);">Target Client *</label>
                <select id="ba-client" class="zy-input" style="width:100%;height:38px;border-radius:6px;border:1px solid #cbd5e1;"></select>
              </div>
              <div>
                <label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;color:var(--sp-text-secondary);">SMS Range</label>
                <select id="ba-range" class="zy-input" style="width:100%;height:38px;border-radius:6px;border:1px solid #cbd5e1;" onchange="zyUpdateBulkPoolStat()"></select>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
              <div>
                <label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;color:var(--sp-text-secondary);">Quantity *</label>
                <input type="number" id="ba-count" class="zy-input" value="10" min="1" max="5000" style="width:100%;height:38px;border-radius:6px;border:1px solid #cbd5e1;">
              </div>
              <div>
                <label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;color:var(--sp-text-secondary);">Client Payterm *</label>
                <select id="ba-payterm" class="zy-input" style="width:100%;height:38px;border-radius:6px;border:1px solid #cbd5e1;">
                  <option value="Weekly" selected>Weekly (7/3) — 3 Day Hold</option>
                  <option value="Monthly">Monthly (30/5) {W} — 5 Day Hold</option>
                </select>
              </div>
            </div>

            <div style="background:var(--sp-bg-subtle,#f8fafc);border:1px solid var(--sp-border,#e2e8f0);border-radius:8px;padding:10px 12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                <div>
                  <div style="font-size:11.5px;font-weight:700;color:var(--sp-text-secondary);">Client Rate Mode</div>
                  <div id="ba-rate-auto-info" style="font-size:12.5px;font-weight:700;color:#059669;margin-top:2px;">
                    Auto-Inherited from Client Rate Set (PKR)
                  </div>
                </div>
                <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;cursor:pointer;color:var(--sp-text-secondary);">
                  <input type="checkbox" id="ba-override-rate" onchange="zyToggleBulkOverride(this.checked)"> Custom Rate Override ($)
                </label>
              </div>
              <div id="ba-rate-wrap" style="display:none;margin-top:10px;">
                <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--sp-text-secondary);">Custom Client Rate (client_rate USD) *</label>
                <input type="number" id="ba-rate" step="0.0001" class="zy-input zy-crs-num" value="0.0080" style="width:100%;height:36px;border-radius:6px;border:1px solid #cbd5e1;">
              </div>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-top:4px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:600;color:var(--sp-text-secondary);">
                <input type="checkbox" id="ba-random" checked style="accent-color:var(--sp-primary);"> Sort / allocate numbers randomly
              </label>
              <div id="ba-pool-notice" style="font-size:12px;color:var(--sp-text-muted);"></div>
            </div>

            <div style="margin-top:6px;">
              <button class="btn btn-primary" onclick="zySubmitBulkAdd()" style="width:100%;height:42px;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:6px;">
                <i class="fas fa-play"></i> Execute Bulk Add Job
              </button>
            </div>
          </div>
        </div>

        <div id="ba-history"></div>
      </div>
    </div>
  `;

  const [clientsRes, rangesRes, numsRes, crData] = await Promise.all([
    zyFillClients('ba-client', 'Select Client'),
    apiFetch('/api/numbers/sms-ranges').catch(() => []),
    apiFetch(AGENT_ID ? `/api/numbers?agent_id=${encodeURIComponent(AGENT_ID)}&limit=100000` : '/api/numbers?limit=100000').catch(() => ({ data: [] })),
    zyFetchAgentClientRates().catch(() => null)
  ]);

  window._zyBulkClientRatesData = crData;
  const ranges = zyList(rangesRes);
  window._zyBulkRangesList = ranges;
  const el = document.getElementById('ba-range');
  if (el) {
    el.innerHTML = `<option value="">All Available Ranges</option>` +
      ranges.map(r => `<option value="${r.id}">${zyEsc(r.name || r.range_name || r.country || '')}</option>`).join('');
  }

  window._zyAgentPoolNumbers = zyList(numsRes);
  zyUpdateBulkPoolStat();
  zyRenderBulkQueueUi();
}

window.zyToggleBulkOverride = function(checked) {
  const wrap = document.getElementById('ba-rate-wrap');
  if (wrap) wrap.style.display = checked ? 'block' : 'none';
};

window.zyUpdateBulkPoolStat = function() {
  const rangeSel = document.getElementById('ba-range');
  const rangeId = rangeSel?.value;
  const rangeName = rangeSel?.options[rangeSel.selectedIndex]?.text || '';
  const all = window._zyAgentPoolNumbers || [];
  const unassigned = all.filter(n => !n.client_id && (!rangeId || String(n.range_id) === String(rangeId)));
  const rangeObj = (window._zyBulkRangesList || []).find(r => String(r.id) === String(rangeId));
  const isWnRange = Boolean(
    (rangeObj && zyIsWhitenoiseObj(rangeObj)) ||
    (rangeId && unassigned.length > 0 && unassigned.every(n => zyIsWhitenoiseObj(n)))
  );
  const paySel = document.getElementById('ba-payterm');
  if (paySel) {
    if (isWnRange) {
      paySel.value = 'Monthly';
      paySel.disabled = true;
    } else {
      if (paySel.disabled) paySel.value = 'Weekly';
      paySel.disabled = false;
    }
  }

  const wrap = document.getElementById('ba-pool-stat-wrap');
  const notice = document.getElementById('ba-pool-notice');
  const rateInfo = document.getElementById('ba-rate-auto-info');
  const cls = unassigned.length > 20 ? 'high' : unassigned.length > 0 ? 'low' : 'none';

  if (wrap) {
    wrap.innerHTML = `
      <span class="zy-pool-avail-badge ${cls}">
        <i class="fas fa-cubes"></i> Unassigned Pool: <b>${unassigned.length}</b>
      </span>
    `;
  }
  if (notice) {
    notice.innerHTML = `<i class="fas fa-info-circle"></i> <b>${unassigned.length}</b> unassigned numbers ready in selected pool${isWnRange ? ' · <span style="color:#4338ca;font-weight:700;">Monthly (30/5) {W} Locked</span>' : ''}`;
  }
  if (rateInfo) {
    const crData = window._zyBulkClientRatesData;
    const fx = Number(crData?.usd_to_pkr_rate || 280);
    if (!rangeId) {
      rateInfo.innerHTML = `Auto-Inherited per number from <a href="javascript:void(0)" onclick="loadPage('client-rate-set')" style="text-decoration:underline;color:var(--sp-primary);">Client Rate Set (PKR)</a>`;
    } else {
      const acr = zyFindClientRateForRange(crData, rangeId, rangeName);
      if (acr && acr.configured) {
        rateInfo.innerHTML = `<span class="zy-crs-num" style="color:#059669;">Auto-Inherited: Rs. ${zyFmtMoney(Number(acr.client_rate_pkr), 4)} PKR (≈ $${zyFmtMoney(Number(acr.client_rate_usd_eq || (acr.client_rate_pkr / fx)), 4)})</span>`;
      } else {
        rateInfo.innerHTML = `<span style="color:#d97706;">No Client Rate Set for this range — <a href="javascript:void(0)" onclick="loadPage('client-rate-set')" style="text-decoration:underline;">Set PKR rate</a> or check Custom Override.</span>`;
      }
    }
  }
};

window.zyRenderBulkQueueUi = function() {
  const host = document.getElementById('ba-history');
  if (!host) return;
  const all = window._zyAgentPoolNumbers || [];
  const unassigned = all.filter(n => !n.client_id);
  host.innerHTML = zyRenderBulkQueueCard(window._zyBulkJobsQueue, { available: unassigned.length });
};

window.zySubmitBulkAdd = async function() {
  const clientSel = document.getElementById('ba-client');
  const client = clientSel?.value;
  const clientName = clientSel?.options[clientSel.selectedIndex]?.text || `Client #${client}`;
  const rangeSel = document.getElementById('ba-range');
  const range = rangeSel?.value;
  const rangeName = rangeSel?.options[rangeSel.selectedIndex]?.text || 'All Ranges';
  const count = Number(document.getElementById('ba-count')?.value) || 0;
  const payterm = document.getElementById('ba-payterm')?.value || 'Weekly';
  const useOverride = Boolean(document.getElementById('ba-override-rate')?.checked);
  const rate = parseFloat(document.getElementById('ba-rate')?.value);
  const isRandom = document.getElementById('ba-random')?.checked;

  if (!client) { toast('Please select a target client', 'error'); return; }
  if (count <= 0) { toast('Quantity must be greater than 0', 'error'); return; }
  if (useOverride && (isNaN(rate) || rate < 0)) { toast('Enter a valid custom rate', 'error'); return; }

  const all = window._zyAgentPoolNumbers || [];
  let pool = all.filter(n => !n.client_id && (!range || String(n.range_id) === String(range)));
  if (isRandom) {
    pool = pool.slice().sort(() => Math.random() - 0.5);
  }

  if (pool.length === 0) {
    toast('No unassigned numbers available in your pool for the selected range', 'error');
    return;
  }

  const toAllocate = pool.slice(0, count);
  const numberIds = toAllocate.map(n => n.id);

  const jobId = 'JOB-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const newJob = {
    id: jobId,
    client: client,
    client_name: clientName,
    range: range,
    range_name: rangeName,
    requested: count,
    allocated: 0,
    status: 'PROCESSING',
    created_at: new Date().toLocaleTimeString()
  };
  window._zyBulkJobsQueue.unshift(newJob);
  zyRenderBulkQueueUi();

  const payload = {
    number_ids: numberIds,
    target_type: 'client',
    target_id: Number(client),
    client_payterm: payterm,
    notes: `Bulk add job ${jobId}`
  };
  if (useOverride) {
    payload.client_rate = rate;
  }

  try {
    const res = await apiFetch('/api/numbers/bulk-assign-many', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const allocatedCount = (res && res.updated_count) || numberIds.length;
    newJob.allocated = allocatedCount;
    newJob.status = 'COMPLETED';

    // Update in-memory pool
    const assignedSet = new Set(numberIds);
    (window._zyAgentPoolNumbers || []).forEach(n => {
      if (assignedSet.has(n.id)) {
        n.client_id = Number(client);
        if (useOverride) n.client_rate = rate;
        n.client_payterm = payterm;
      }
    });

    toast(`Successfully allocated ${allocatedCount} number(s) to ${clientName}!`, 'success');
  } catch (err) {
    newJob.status = 'FAILED';
    console.error('Bulk allocate error:', err);
    toast(err.message || 'Bulk allocate failed', 'error');
  }

  zyUpdateBulkPoolStat();
  zyRenderBulkQueueUi();
};

/* ═══ DOWNLINE CLIENT NUMBER REQUESTS & WHITENOISE RETURN REQUESTS ═══════ */
let _zyAgtReqActiveTab = 'alloc';

async function pgClientRequests(tabOverride) {
  if (tabOverride) _zyAgtReqActiveTab = tabOverride;
  const c = document.getElementById('page-content');
  if (typeof zyCrumb === 'function') zyCrumb(['SMS Module', 'Number Requests']);
  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Client Number &amp; Return Requests</div>
        <div class="page-subtitle">Review client allocation requests and approve Monthly Route {W} return requests.</div>
      </div>
    </div>
    <div class="apx-card zy-theme-card" style="border-radius:10px;overflow:hidden;">
      <div class="apx-card-header" style="min-height:46px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:6px 14px;border-bottom:1px solid var(--sp-border,#cbd5e1);">
        <div class="zy-applinks-tabbar" style="margin:0;padding:0;border:none;">
          <button type="button" id="agt-req-tab-alloc" class="zy-applinks-tab ${_zyAgtReqActiveTab === 'alloc' ? 'active' : ''}" onclick="pgClientRequests('alloc')">
            <i class="fas fa-inbox"></i> Allocation Requests <span id="agt-req-alloc-badge"></span>
          </button>
          <button type="button" id="agt-req-tab-returns" class="zy-applinks-tab ${_zyAgtReqActiveTab === 'returns' ? 'active' : ''}" onclick="pgClientRequests('returns')">
            <i class="fas fa-rotate-left"></i> Return Requests ({W}) <span id="agt-req-ret-badge"></span>
          </button>
        </div>
      </div>
      <div class="apx-card-body" id="agt-numreq-host" style="padding:14px;"><div class="zy-loading">Loading requests…</div></div>
    </div>`;
  try {
    const [rawAlloc, rawRet] = await Promise.all([
      apiFetch('/api/agent-requests?scope=downline').catch(() => []),
      apiFetch('/api/return-requests').catch(() => ({ data: [] }))
    ]);
    const allocData = Array.isArray(rawAlloc) ? rawAlloc : (rawAlloc?.data || []);
    const retData = Array.isArray(rawRet) ? rawRet : (rawRet?.data || []);
    window._zyAgtNumRequestsCache = allocData;
    window._zyAgtReturnRequestsCache = retData;

    const pendAlloc = allocData.filter(r => String(r.status || 'pending').toLowerCase() === 'pending').length;
    const pendRet = retData.filter(r => String(r.status || 'pending').toLowerCase() === 'pending').length;
    const aBadge = document.getElementById('agt-req-alloc-badge');
    const rBadge = document.getElementById('agt-req-ret-badge');
    if (aBadge) aBadge.innerHTML = pendAlloc > 0 ? `<span class="badge badge-yellow" style="margin-left:4px;font-size:10px;">${pendAlloc}</span>` : '';
    if (rBadge) rBadge.innerHTML = pendRet > 0 ? `<span class="badge badge-red" style="margin-left:4px;font-size:10px;">${pendRet}</span>` : '';

    const host = document.getElementById('agt-numreq-host');
    if (!host) return;

    if (_zyAgtReqActiveTab === 'returns') {
      if (!retData.length) {
        host.innerHTML = '<div style="padding:28px;text-align:center;color:var(--sp-text-muted,#64748b);">No Monthly Route {W} return requests from your clients yet.</div>';
        return;
      }
      const retRows = retData.map(r => {
        const stLow = String(r.status || 'pending').toLowerCase();
        const badgeCls = stLow === 'approved' ? 'badge-green' : (stLow === 'rejected' ? 'badge-red' : 'badge-yellow');
        const previewNums = Array.isArray(r.numbers_preview) && r.numbers_preview.length
          ? r.numbers_preview.slice(0, 3).join(', ') + (Number(r.quantity || 0) > 3 ? ` +${Number(r.quantity) - 3} more` : '')
          : '—';
        const datesLbl = Array.isArray(r.dates) && r.dates.length ? r.dates.join(', ') : '—';
        const destInfo = stLow === 'approved'
          ? (r.routed_to_vault && r.vault_client_username ? `Moved to Vault: ${r.vault_client_username}` : 'Returned to Agent Pool')
          : (r.rejected_reason || '—');
        return [
          `<span class="zy-col-username"><strong>${zyEsc(r.client_username || 'Client')}</strong></span>`,
          `<span class="zy-wn-range-name">${zyEsc(r.range_name || 'Monthly Route')}</span>`,
          { v: Number(r.quantity || 0), h: `<span class="badge badge-blue">${Number(r.quantity || 0)}</span>` },
          `<span class="monospace" style="font-size:11.5px;">${zyEsc(previewNums)}</span>`,
          `<span style="font-size:11.5px;">${zyEsc(datesLbl)}</span>`,
          `<span class="badge ${badgeCls}">${zyEsc(r.status || 'pending')}</span>`,
          String(r.created_at || '').replace('T', ' ').slice(0, 16) || '—',
          {
            v: '',
            h: stLow === 'pending'
              ? `<div style="display:inline-flex;gap:5px;justify-content:center;">
                   <button type="button" class="btn btn-success btn-xs" onclick="zyAgtApproveReturnReq(${Number(r.id)})"><i class="fas fa-check"></i> Accept Return</button>
                   <button type="button" class="btn btn-danger btn-xs" onclick="zyAgtRejectReturnReq(${Number(r.id)})"><i class="fas fa-times"></i> Decline</button>
                 </div>`
              : `<span style="font-size:11.5px;color:var(--sp-text-secondary);">${zyEsc(destInfo)}</span>`
          }
        ];
      });
      host.innerHTML = zyDT2('dt-agt-ret-reqs', {
        cols: ['Client', 'Range ({W})', 'Qty', 'Numbers', 'Assigned Dates', 'Status', 'Requested At', 'Actions'],
        rows: retRows
      });
      zy2Render('dt-agt-ret-reqs');
      return;
    }

    if (!allocData.length) {
      host.innerHTML = '<div style="padding:28px;text-align:center;color:var(--sp-text-muted,#64748b);">No allocation requests from your clients yet.</div>';
      return;
    }
    const rows = allocData.map(r => {
      const reqQty = Number(r.quantity || 1);
      const freeCnt = Number(r.free_count != null ? r.free_count : 0);
      const freeBadgeCls = freeCnt === 0 ? 'badge-red' : (freeCnt < reqQty ? 'badge-yellow' : 'badge-green');
      const pkrRateCell = (r.client_rate_pkr != null && Number(r.client_rate_pkr) > 0)
        ? `<span class="zy-crs-num" style="font-weight:700;color:#059669;">Rs. ${zyFmtMoney(Number(r.client_rate_pkr), 4)} PKR</span>`
        : '<span style="color:#64748b;font-size:11.5px;">Client Rate Set (Auto)</span>';
      const stLow = String(r.status || 'pending').toLowerCase();
      const qtyHtml = (r.fulfilled_count != null && Number(r.fulfilled_count) !== reqQty && (stLow === 'approved' || stLow === 'fulfilled'))
        ? `<span class="badge badge-blue" title="Allocated ${r.fulfilled_count} of ${reqQty} requested">${r.fulfilled_count} / ${reqQty}</span>`
        : `<span class="badge badge-blue">${reqQty}</span>`;
      return [
        `<span class="zy-col-username"><strong>${zyEsc(r.requester_username || r.client_username || r.agent_username || 'Client')}</strong> <span class="badge badge-blue" style="font-size:10px;">${zyEsc(r.requester_role || 'Client')}</span></span>`,
        zyEsc(r.range_name || 'Range'),
        zyEsc(r.app_name || r.service_name || 'General'),
        { v: freeCnt, h: `<span class="badge ${freeBadgeCls}" title="Available unassigned numbers in your Agent pool for this range">${freeCnt.toLocaleString()}</span>` },
        { v: reqQty, h: qtyHtml },
        pkrRateCell,
        zyEsc(r.notes || '—'),
        `<span class="badge badge-${(stLow === 'fulfilled' || stLow === 'approved') ? 'green' : (stLow === 'rejected' ? 'red' : 'yellow')}">${zyEsc(r.status || 'pending')}</span>`,
        String(r.created_at || r.created || '').replace('T', ' ').slice(0, 16) || '—',
        {
          v: '',
          h: stLow === 'pending'
            ? `<div style="display:inline-flex;gap:4px;justify-content:center;">
                 <button type="button" class="btn btn-success btn-xs" onclick="zyAgtFulfillReq(${Number(r.id)})"><i class="fas fa-check"></i> Fulfill</button>
                 <button type="button" class="btn btn-danger btn-xs" onclick="zyAgtRejectReq(${Number(r.id)})"><i class="fas fa-times"></i> Reject</button>
               </div>`
            : zyEsc(r.rejected_reason || r.reason || '—')
        }
      ];
    });
    host.innerHTML = zyDT2('dt-agt-reqs', {
      cols: ['Requester', 'Range', 'App', 'Free', 'Qty', 'Client Rate', 'Notes', 'Status', 'Date', 'Actions'],
      rows
    });
    zy2Render('dt-agt-reqs');
  } catch (err) {
    const host = document.getElementById('agt-numreq-host');
    if (host) host.innerHTML = `<div class="text-danger" style="padding:20px;">Failed to load requests: ${zyEsc(err.message)}</div>`;
  }
}

window.zyAgtApproveReturnReq = async function(id) {
  const req = (window._zyAgtReturnRequestsCache || []).find(x => Number(x.id) === Number(id));
  const label = req ? `${req.quantity} number(s) from ${req.client_username} (${req.range_name})` : `return request #${id}`;
  const ok = await zyConfirm(`Accept return of ${label}?\n\nIf you configured a Vault Client in Client Rate Set, these numbers will move directly to your Vault Client; otherwise they return to your Agent Pool.`, {
    title: 'Accept Monthly Route {W} Return',
    confirmLabel: 'Accept Return'
  });
  if (!ok) return;
  try {
    const res = await apiFetch(`/api/return-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
    if (res && res.success) {
      if (typeof toast === 'function') toast(res.message || 'Return accepted!', 'success');
      pgClientRequests('returns');
    } else {
      if (typeof toast === 'function') toast(res?.error || 'Failed to approve return', 'error');
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to approve return', 'error');
  }
};

window.zyAgtRejectReturnReq = async function(id) {
  const input = await zyPrompt('Optional reason for declining this return:', '', { title: 'Decline Return Request', placeholder: 'Reason (optional)', confirmLabel: 'Decline' });
  if (input === null) return;
  try {
    const res = await apiFetch(`/api/return-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: input.trim() || 'Declined by Agent' })
    });
    if (res && res.success) {
      if (typeof toast === 'function') toast('Return request declined.', 'info');
      pgClientRequests('returns');
    } else {
      if (typeof toast === 'function') toast(res?.error || 'Failed to decline return', 'error');
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to decline return', 'error');
  }
};

window.zyAgtFulfillReq = function(id) {
  const req = (window._zyAgtNumRequestsCache || []).find(x => Number(x.id) === Number(id)) || {};
  const reqQty = Number(req.quantity || 1);
  const freeCnt = Number(req.free_count != null ? req.free_count : 0);
  const rangeName = zyEsc(req.range_name || ('Range #' + (req.range_id || '—')));
  const clientName = zyEsc(req.requester_username || req.client_username || 'Client');
  const suggested = freeCnt > 0 ? Math.min(reqQty, freeCnt) : 0;

  let stockNotice = '';
  if (freeCnt === 0) {
    stockNotice = `<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 12px;font-size:12.5px;font-weight:600;margin-bottom:12px;">
      <i class="fas fa-circle-exclamation"></i> 0 free numbers available in Owner Pool for "${rangeName}".
    </div>`;
  } else if (freeCnt < reqQty) {
    stockNotice = `<div style="background:#fffbeb;border:1px solid #fde68a;color:#b45309;border-radius:8px;padding:10px 12px;font-size:12.5px;font-weight:600;margin-bottom:12px;">
      <i class="fas fa-triangle-exclamation"></i> Client requested <b>${reqQty}</b>, but only <b>${freeCnt}</b> free number(s) are available in "${rangeName}". You can allocate up to <b>${freeCnt}</b> now.
    </div>`;
  }

  zyModal('Fulfill Client Number Request', `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center;">
      <div><div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Range</div><div style="font-size:12.5px;font-weight:700;margin-top:2px;">${rangeName}</div></div>
      <div><div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Requested</div><div style="font-size:15px;font-weight:800;color:#2563eb;margin-top:2px;">${reqQty}</div></div>
      <div><div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Free Pool</div><div style="font-size:15px;font-weight:800;color:${freeCnt === 0 ? '#dc2626' : (freeCnt < reqQty ? '#d97706' : '#059669')};margin-top:2px;">${freeCnt}</div></div>
    </div>
    ${stockNotice}
    <div class="form-group">
      <label class="zy-lbl" style="font-weight:700;">Allocate Qty to ${clientName} (Max available: ${freeCnt}) *</label>
      <input type="number" id="agt-fulfill-qty" class="zy-input" style="width:100%;height:36px;" value="${suggested}" min="${freeCnt > 0 ? 1 : 0}" max="${freeCnt}" ${freeCnt === 0 ? 'disabled' : ''}>
    </div>
  `, `
    <button type="button" class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button type="button" class="btn btn-success btn-sm" id="btn-agt-fulfill-confirm" ${freeCnt === 0 ? 'disabled' : ''} onclick="zyAgtSubmitFulfillReq(${Number(id)}, ${freeCnt})">
      <i class="fas fa-check"></i> Fulfill Allocation
    </button>
  `);
};

window.zyAgtSubmitFulfillReq = async function(id, maxFree) {
  const qty = parseInt(document.getElementById('agt-fulfill-qty')?.value, 10) || 0;
  if (qty <= 0) {
    if (typeof toast === 'function') toast('Enter a valid quantity (at least 1).', 'error');
    return;
  }
  if (typeof maxFree === 'number' && qty > maxFree) {
    if (typeof toast === 'function') toast(`Only ${maxFree} free number(s) available in pool. Enter ${maxFree} or fewer.`, 'error');
    return;
  }
  const btn = document.getElementById('btn-agt-fulfill-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Allocating…'; }
  try {
    const res = await apiFetch(`/api/agent-requests/${id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({ count: qty })
    });
    if (res && (res.success || !res.error)) {
      closeModal();
      if (typeof toast === 'function') toast(`Allocated ${res.allocated || qty} number(s) and fulfilled request!`, 'success');
      pgClientRequests();
    } else {
      if (typeof toast === 'function') toast(res?.error || 'Failed to fulfill request', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Fulfill Allocation'; }
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to fulfill request', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Fulfill Allocation'; }
  }
};

window.zyAgtRejectReq = async function(id) {
  const input = await zyPrompt('Optional rejection reason:', '', { title: 'Reject Request', placeholder: 'Reason (optional)', confirmLabel: 'Reject' });
  if (input === null) return;
  const reason = input.trim() || 'Rejected by Agent';
  try {
    const res = await apiFetch(`/api/agent-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    if (res && (res.success || !res.error)) {
      if (typeof toast === 'function') toast('Request rejected', 'info');
      pgClientRequests();
    } else {
      if (typeof toast === 'function') toast(res?.error || 'Failed to reject request', 'error');
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to reject request', 'error');
  }
};

/* ── router ─────────────────────────────────────────────────── */
(function zyHookAgentPages() {
/* ── Apps Links Directory (Agent Catalog + Per-App Curation + Client Access) ── */
let _agentAppLinksTab = 'all';
let _agentAppLinksData = [];
let _agentAppLinksClients = [];
let _agentAppLinksQuery = '';
let _agentAppLinksPage = 1;
let _agentAppLinksMeta = { total: 0, filtered_total: 0, page: 1, limit: 25, total_pages: 1, all_count: 0, allowed_count: 0, latest_count: 0 };
let _agentAppLinksSearchTimer = null;

function _agentSafeUrl(raw) {
  const s = String(raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : '#';
}

async function pgAppLinks(tabOverride, pageOverride) {
  if (tabOverride) {
    const nextTab = tabOverride === 'links' ? 'all' : tabOverride;
    if (nextTab !== _agentAppLinksTab) {
      _agentAppLinksTab = nextTab;
      _agentAppLinksPage = 1;
    }
  }
  if (pageOverride != null) {
    _agentAppLinksPage = Math.max(1, Number(pageOverride) || 1);
  }
  const c = document.getElementById('page-content');
  if (!c) return;

  if (!document.getElementById('agent-applinks-body')) {
    c.innerHTML = `
      <div class="zy-card" style="padding:16px 18px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
          <div>
            <div style="font-weight:800;font-size:15.5px;"><i class="fas fa-link" style="color:#0284c7;margin-right:7px;"></i>Apps Links Catalog</div>
            <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:2px;">All Owner apps are listed here (25 per page). Allow only the apps you want your Clients to see, and star apps to feature them in <strong>Latest</strong>.</div>
          </div>
          <button type="button" class="zy-btn-blue-solid" style="height:34px;min-height:34px;padding:0 12px;font-size:12px;" onclick="zyAgentOpenAppLinkModal()">
            <i class="fas fa-plus"></i> Add Custom App
          </button>
        </div>
        <div class="zy-applinks-tabbar" style="flex-wrap:wrap;gap:8px;">
          <button type="button" id="ag-al-tab-all" class="zy-applinks-tab" onclick="pgAppLinks('all', 1)">
            <i class="fas fa-table"></i> All Links (<span id="ag-al-cnt-all">0</span>)
          </button>
          <button type="button" id="ag-al-tab-allowed" class="zy-applinks-tab" onclick="pgAppLinks('allowed', 1)">
            <i class="fas fa-check-circle"></i> Allowed for Clients (<span id="ag-al-cnt-allowed">0</span>)
          </button>
          <button type="button" id="ag-al-tab-latest" class="zy-applinks-tab" onclick="pgAppLinks('latest', 1)">
            <i class="fas fa-star"></i> Latest (<span id="ag-al-cnt-latest">0</span>)
          </button>
          <button type="button" id="ag-al-tab-clients" class="zy-applinks-tab" onclick="pgAppLinks('clients', 1)">
            <i class="fas fa-users"></i> Client Access (<span id="ag-al-cnt-clients">0/0</span>)
          </button>
          <div style="margin-left:auto;min-width:220px;">
            <input type="search" id="agent-applinks-search" class="zy-input" placeholder="Search apps, links, clients…" value="${zyEsc(_agentAppLinksQuery)}" oninput="zyAgentFilterAppLinks(this.value)" style="margin:0;padding:7px 10px;">
          </div>
        </div>
        <div id="agent-applinks-body"></div>
      </div>
    `;
  }

  await zyLoadAgentAppLinksPage(true);
}
window.pgAppLinks = pgAppLinks;

async function zyLoadAgentAppLinksPage(refreshClients) {
  const host = document.getElementById('agent-applinks-body');
  if (!host) return;

  const setActiveTab = () => {
    ['all', 'allowed', 'latest', 'clients'].forEach(t => {
      const btn = document.getElementById(`ag-al-tab-${t}`);
      if (btn) btn.classList.toggle('active', _agentAppLinksTab === t);
    });
  };
  setActiveTab();

  host.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-muted,#64748b);font-size:13px;"><i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Loading…</div>`;

  const reqs = [];
  const apiTab = _agentAppLinksTab === 'clients' ? 'all' : _agentAppLinksTab;
  const qs = new URLSearchParams({
    tab: apiTab,
    page: String(_agentAppLinksPage || 1),
    limit: '25'
  });
  if (_agentAppLinksTab !== 'clients' && _agentAppLinksQuery.trim()) {
    qs.set('search', _agentAppLinksQuery.trim());
  }
  reqs.push(apiFetch('/api/app-links?' + qs.toString(), { silent: true }).catch(() => null));
  if (refreshClients || !_agentAppLinksClients.length || _agentAppLinksTab === 'clients') {
    reqs.push(apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=500`, { silent: true }).catch(() => null));
  }

  const [linksRes, clientsRes] = await Promise.all(reqs);
  _agentAppLinksData = Array.isArray(linksRes?.data) ? linksRes.data : [];
  _agentAppLinksMeta = {
    total: Number(linksRes?.total || 0),
    filtered_total: Number(linksRes?.filtered_total ?? linksRes?.total ?? _agentAppLinksData.length),
    page: Number(linksRes?.page || _agentAppLinksPage || 1),
    limit: Number(linksRes?.limit || 25),
    total_pages: Number(linksRes?.total_pages || 1),
    all_count: Number(linksRes?.all_count ?? linksRes?.total ?? 0),
    allowed_count: Number(linksRes?.allowed_count || 0),
    latest_count: Number(linksRes?.latest_count || 0)
  };
  _agentAppLinksPage = _agentAppLinksMeta.page;

  if (clientsRes != null) {
    _agentAppLinksClients = Array.isArray(clientsRes) ? clientsRes : (Array.isArray(clientsRes?.data) ? clientsRes.data : []);
  }
  const enabledClients = _agentAppLinksClients.filter(x => x.app_links_access).length;

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('ag-al-cnt-all', _agentAppLinksMeta.all_count.toLocaleString());
  setTxt('ag-al-cnt-allowed', _agentAppLinksMeta.allowed_count.toLocaleString());
  setTxt('ag-al-cnt-latest', _agentAppLinksMeta.latest_count.toLocaleString());
  setTxt('ag-al-cnt-clients', `${enabledClients}/${_agentAppLinksClients.length}`);

  zyRenderAgentAppLinksBody();
}

window.zyAgentAppLinksGoPage = function(p) {
  _agentAppLinksPage = Math.max(1, Number(p) || 1);
  zyLoadAgentAppLinksPage(false);
};

window.zyAgentFilterAppLinks = function(q) {
  _agentAppLinksQuery = String(q || '');
  if (_agentAppLinksTab === 'clients') {
    zyRenderAgentAppLinksBody();
    return;
  }
  clearTimeout(_agentAppLinksSearchTimer);
  _agentAppLinksSearchTimer = setTimeout(() => {
    _agentAppLinksPage = 1;
    zyLoadAgentAppLinksPage(false);
  }, 240);
};

window.zyAgentToggleAppLinkAllow = async function(id, nextAllow) {
  const res = await apiFetch('/api/app-links/agent-toggle', {
    method: 'POST',
    body: JSON.stringify({ id: Number(id), allow: Boolean(nextAllow) })
  });
  if (res && res.success) {
    toast(nextAllow ? 'App allowed for your Clients.' : 'App removed from your Clients.', 'success');
    zyLoadAgentAppLinksPage(false);
  }
};

window.zyAgentToggleAppLinkLatest = async function(id, nextLatest) {
  const res = await apiFetch('/api/app-links/agent-toggle', {
    method: 'POST',
    body: JSON.stringify({ id: Number(id), latest: Boolean(nextLatest) })
  });
  if (res && res.success) {
    toast(nextLatest ? 'Pinned to Latest (and allowed for Clients).' : 'Removed from Latest.', 'success');
    zyLoadAgentAppLinksPage(false);
  }
};

window.zyAgentBulkPageAppLinks = async function(allowFlag) {
  const ids = _agentAppLinksData.map(x => Number(x.id)).filter(n => Number.isFinite(n) && n > 0);
  if (!ids.length) return;
  const res = await apiFetch('/api/app-links/agent-toggle', {
    method: 'POST',
    body: JSON.stringify({ ids, allow: Boolean(allowFlag) })
  });
  if (res && res.success) {
    toast(
      allowFlag
        ? `Allowed ${ids.length} app(s) on this page for your Clients.`
        : `Removed ${ids.length} app(s) on this page from your Clients.`,
      'success'
    );
    zyLoadAgentAppLinksPage(false);
  }
};

window.zyAgentOpenAppLinkModal = function(existingId) {
  const item = existingId ? _agentAppLinksData.find(x => Number(x.id) === Number(existingId)) : null;
  zyModal(item ? 'Edit App Link' : 'Add Custom App Link for Your Clients', `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">App Name *</label>
        <input type="text" id="ag-al-name" class="zy-input" placeholder="e.g. WhatsApp Business" value="${zyEsc(item ? item.name : '')}" maxlength="120">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">App URL *</label>
        <input type="url" id="ag-al-url" class="zy-input" placeholder="https://..." value="${zyEsc(item ? item.url : '')}" maxlength="500">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Category (Optional)</label>
        <input type="text" id="ag-al-cat" class="zy-input" placeholder="e.g. Messaging, Finance, Social" value="${zyEsc(item ? (item.category || '') : '')}" maxlength="60">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Notes (Optional)</label>
        <input type="text" id="ag-al-notes" class="zy-input" placeholder="Short instructions for clients" value="${zyEsc(item ? (item.notes || '') : '')}" maxlength="240">
      </div>
      <label style="display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;cursor:pointer;">
        <input type="checkbox" id="ag-al-pin" ${item && item.pinned_top ? 'checked' : ''}> Feature in Latest (also appears in Dashboard Latest Apps)
      </label>
    </div>
  `, `
    <button type="button" class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button type="button" class="zy-btn-blue" onclick="zyAgentSaveAppLink(${item ? Number(item.id) : 'null'})"><i class="fas fa-save"></i> ${item ? 'Save Changes' : 'Add App Link'}</button>
  `);
};

window.zyAgentSaveAppLink = async function(editId) {
  const name = (document.getElementById('ag-al-name')?.value || '').trim();
  const url = (document.getElementById('ag-al-url')?.value || '').trim();
  const category = (document.getElementById('ag-al-cat')?.value || '').trim();
  const notes = (document.getElementById('ag-al-notes')?.value || '').trim();
  const pinned_top = Boolean(document.getElementById('ag-al-pin')?.checked);
  if (!name || !url) {
    toast('App Name and URL are required.', 'error');
    return;
  }
  const endpoint = editId ? `/api/app-links/${editId}` : '/api/app-links';
  const method = editId ? 'PATCH' : 'POST';
  const res = await apiFetch(endpoint, {
    method,
    body: JSON.stringify({ name, url, category, notes, pinned_top })
  });
  if (res && (res.success || res.data || res.id)) {
    closeModal();
    toast(editId ? 'App link updated!' : 'App link added for your clients!', 'success');
    zyLoadAgentAppLinksPage(false);
  }
};

window.zyAgentDeleteAppLink = async function(id) {
  const res = await apiFetch(`/api/app-links/${id}`, { method: 'DELETE' });
  if (res && res.success) {
    toast('App link deleted.', 'success');
    zyLoadAgentAppLinksPage(false);
  }
};

function zyRenderAgentAppLinksBody() {
  const host = document.getElementById('agent-applinks-body');
  if (!host) return;
  const q = _agentAppLinksQuery.trim().toLowerCase();

  if (_agentAppLinksTab === 'clients') {
    const list = _agentAppLinksClients
      .filter(cl => !q || String(cl.username || '').toLowerCase().includes(q) || String(cl.full_name || '').toLowerCase().includes(q))
      .sort((a, b) => String(a.username || '').localeCompare(String(b.username || ''), undefined, { sensitivity: 'base' }));
    if (!list.length) {
      host.innerHTML = `<div class="zy-empty" style="padding:30px;">No clients found.</div>`;
      return;
    }
    host.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted,#64748b);margin-bottom:12px;padding:9px 12px;background:var(--bg-hover,#f8fafc);border-radius:8px;">
        <i class="fas fa-circle-info" style="color:#0284c7;margin-right:6px;"></i>
        Choose which Clients can access the <strong>Apps Links</strong> page. Enabled Clients will see only the apps you marked <strong>Allowed</strong>.
      </div>
      <div class="zy-access-list">
        ${list.map(cl => {
          const on = Boolean(cl.app_links_access);
          return `
            <div class="zy-access-row">
              <div>
                <div style="font-weight:700;font-size:13px;">${zyEsc(cl.username || '—')} <span style="font-weight:400;color:var(--text-muted,#64748b);font-size:12px;">${cl.full_name ? `· ${zyEsc(cl.full_name)}` : ''}</span></div>
                <div style="font-size:11.5px;color:var(--text-muted,#64748b);">Status: ${zyEsc(cl.status || 'active')}</div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <span class="badge ${on ? 'badge-green' : ''}" style="${on ? '' : 'background:var(--bg-hover,#f1f5f9);color:#64748b;'}">${on ? 'Visible' : 'Hidden'}</span>
                <button type="button" class="${on ? 'zy-btn-grey' : 'zy-btn-blue'}" onclick="zyAgentToggleClientAppLinks(${Number(cl.id)}, ${on ? 'false' : 'true'})">
                  <i class="fas fa-${on ? 'eye-slash' : 'check'}" style="margin-right:4px;"></i>${on ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    return;
  }

  const items = _agentAppLinksData;
  if (!items.length) {
    const emptyMsg = _agentAppLinksTab === 'allowed'
      ? 'No apps allowed for your Clients yet. Open <strong>All Links</strong> and click <strong>Allow</strong> on the apps you want Clients to see.'
      : _agentAppLinksTab === 'latest'
        ? 'No apps pinned to Latest yet. Click <strong>Latest</strong> on any app to feature it in your Clients’ Latest list.'
        : 'No matching apps found.';
    host.innerHTML = `<div class="zy-empty" style="padding:36px;">${emptyMsg}</div>`;
    return;
  }

  const offset = (_agentAppLinksMeta.page - 1) * _agentAppLinksMeta.limit;
  const pagerHtml = typeof window.zyRenderAppLinksPager === 'function'
    ? window.zyRenderAppLinksPager({
        page: _agentAppLinksMeta.page,
        totalPages: _agentAppLinksMeta.total_pages,
        total: _agentAppLinksMeta.filtered_total,
        limit: _agentAppLinksMeta.limit,
        onPageFn: 'zyAgentAppLinksGoPage',
        idPrefix: 'ag-al'
      })
    : '';

  host.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
      <div style="font-size:12px;color:var(--text-muted,#64748b);">
        Page <strong>${_agentAppLinksMeta.page.toLocaleString()}</strong> of <strong>${_agentAppLinksMeta.total_pages.toLocaleString()}</strong> · Showing <strong>${items.length}</strong> of <strong>${_agentAppLinksMeta.filtered_total.toLocaleString()}</strong> apps
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="zy-al-toggle-btn is-allowed" onclick="zyAgentBulkPageAppLinks(true)">
          <i class="fas fa-check-double"></i> Allow Page (${items.length})
        </button>
        <button type="button" class="zy-al-toggle-btn" onclick="zyAgentBulkPageAppLinks(false)">
          <i class="fas fa-ban"></i> Remove Page
        </button>
      </div>
    </div>
    <div class="zy-applinks-tbl-wrap zy-applinks-excel-wrap">
      <table class="zy-dt zy-applinks-tbl zy-applinks-excel">
        <thead>
          <tr>
            <th style="width:66px;text-align:center;">#</th>
            <th style="width:28%;">App Name</th>
            <th style="width:32%;">App Link</th>
            <th style="width:34%;text-align:right;">Client Visibility &amp; Actions</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => {
            const href = _agentSafeUrl(it.url);
            const rawUrl = String(it.url || '').trim();
            const isMine = Boolean(it.is_mine || (it.agent_id != null && Number(it.agent_id) === Number(AGENT_ID)));
            const isAllowed = Boolean(it.agent_allowed);
            const isLatest = Boolean(it.agent_latest);
            return `
              <tr>
                <td class="zy-applink-num-td"><span class="zy-applink-num">${(offset + idx + 1).toLocaleString()}</span></td>
                <td class="zy-applink-name-td">
                  <div class="zy-applink-name-line">
                    <span class="zy-applink-name-txt">${zyEsc(it.name || 'App Link')}</span>
                    ${isMine ? `<span class="badge badge-blue" style="font-size:9.5px;padding:1px 6px;">Mine</span>` : `<span class="zy-applink-cat-tag">Global</span>`}
                    ${it.category ? `<span class="zy-applink-cat-tag">${zyEsc(it.category)}</span>` : ''}
                  </div>
                  ${it.notes ? `<div class="zy-applink-card-note">${zyEsc(it.notes)}</div>` : ''}
                </td>
                <td class="zy-applink-url-td">
                  <a class="zy-applink-url-anchor" href="${zyEsc(href)}" target="_blank" rel="noopener noreferrer" title="${zyEsc(rawUrl)}">${zyEsc(rawUrl || href)}</a>
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <div class="zy-applink-row-actions" style="justify-content:flex-end;">
                    <button type="button" class="zy-al-toggle-btn ${isAllowed ? 'is-allowed' : ''}" onclick="zyAgentToggleAppLinkAllow(${Number(it.id)}, ${isAllowed ? 'false' : 'true'})" title="${isAllowed ? 'Allowed for Clients — click to remove' : 'Click to allow for your Clients'}">
                      <i class="fas fa-${isAllowed ? 'check-circle' : 'plus-circle'}"></i> ${isAllowed ? 'Allowed' : 'Allow'}
                    </button>
                    <button type="button" class="zy-al-toggle-btn ${isLatest ? 'is-latest' : ''}" onclick="zyAgentToggleAppLinkLatest(${Number(it.id)}, ${isLatest ? 'false' : 'true'})" title="${isLatest ? 'Pinned to Latest — click to unpin' : 'Click to feature in Latest'}">
                      <i class="fas fa-star"></i> ${isLatest ? 'In Latest' : 'Latest'}
                    </button>
                    <button type="button" class="zy-applink-copy-btn" data-url="${zyEsc(rawUrl || href)}" onclick="zyCopyAppLinkUrl(this)" title="Copy Link"><i class="far fa-copy"></i></button>
                    <a class="zy-applink-open-btn" href="${zyEsc(href)}" target="_blank" rel="noopener noreferrer" title="Open Link"><i class="fas fa-arrow-up-right-from-square"></i></a>
                    ${isMine ? `
                      <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyAgentOpenAppLinkModal(${Number(it.id)})" title="Edit"><i class="fas fa-pen"></i></button>
                      <button type="button" class="apx-btn apx-btn-icon apx-btn-small" style="color:#ef4444;" onclick="zyAgentDeleteAppLink(${Number(it.id)})" title="Delete"><i class="fas fa-trash"></i></button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${pagerHtml}
  `;
}

window.zyAgentToggleClientAppLinks = async function(clientId, enable) {
  const res = await apiFetch(`/api/clients/${clientId}`, {
    method: 'PATCH',
    body: JSON.stringify({ app_links_access: Boolean(enable) })
  });
  if (res && (res.id || res.success)) {
    toast(enable ? 'Apps Links enabled for this client.' : 'Apps Links hidden for this client.', 'success');
    zyLoadAgentAppLinksPage(true);
  }
};

/* ═══ BLOCKED / INACTIVE NUMBERS (AGENT) ═══════════════════════ */
window._zyAgentBlockedList = [];

async function pgBlockedNumbers() {
  const c = document.getElementById('page-content');
  if (!c) return;
  zyCrumb(['Numbers & Inventory', 'Blocked Numbers']);
  c.innerHTML = `
    <div class="apx-page-head">
      <div>
        <div class="apx-page-title" style="color:#dc2626;"><i class="fas fa-ban"></i> Blocked &amp; Inactive Numbers</div>
        <div class="apx-page-sub">Numbers flagged automatically due to zero SMS activity within the Range inactivity limit. Red numbers are unusable and can be permanently deleted from the system pool.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button type="button" class="apx-btn apx-btn-small" onclick="pgBlockedNumbers()"><i class="fas fa-sync-alt"></i> Refresh</button>
        <button type="button" class="apx-btn apx-btn-small" style="color:#b45309;border-color:#fde68a;background:#fffbeb;font-weight:700;" onclick="zyAgentBlockSelectedNums()"><i class="fas fa-ban"></i> Mark Blocked</button>
        <button type="button" class="apx-btn apx-btn-small" style="color:#ffffff;background:#dc2626;border-color:#dc2626;font-weight:700;" onclick="zyAgentDeleteBlockedNums()"><i class="fas fa-trash"></i> Delete Selected from Pool</button>
      </div>
    </div>
    <div class="zy-panel">
      <div class="zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <span style="font-weight:700;color:#dc2626;"><i class="fas fa-triangle-exclamation"></i> Inactive / Blocked Pool (<span id="agt-blk-count">0</span>)</span>
        <input type="text" id="agt-blk-search" class="zy-input" placeholder="Search number, range, client…" oninput="zyAgentRenderBlockedTable()" style="max-width:260px;height:32px;font-size:12.5px;">
      </div>
      <div class="zy-panel-body" id="agt-blocked-host" style="padding:14px;">
        <div style="text-align:center;padding:28px;color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Loading blocked numbers…</div>
      </div>
    </div>`;

  try {
    const res = await apiFetch('/api/numbers/blocked');
    window._zyAgentBlockedList = Array.isArray(res?.data) ? res.data : [];
    zyAgentRenderBlockedTable();
  } catch (err) {
    const host = document.getElementById('agt-blocked-host');
    if (host) host.innerHTML = `<div style="text-align:center;padding:24px;color:#dc2626;">${zyEsc(err?.message || 'Failed to load blocked numbers')}</div>`;
  }
}

window.zyAgentRenderBlockedTable = function () {
  const host = document.getElementById('agt-blocked-host');
  if (!host) return;
  const q = (document.getElementById('agt-blk-search')?.value || '').trim().toLowerCase();
  const list = (window._zyAgentBlockedList || []).filter(n => {
    if (!q) return true;
    return `${n.number || ''} ${n.range_name || ''} ${n.client_username || ''} ${n.blocked_reason || ''}`.toLowerCase().includes(q);
  });
  const cnt = document.getElementById('agt-blk-count');
  if (cnt) cnt.textContent = list.length.toLocaleString();

  if (!list.length) {
    host.innerHTML = `<div style="text-align:center;padding:34px;color:#64748b;">
      <i class="fas fa-shield-check" style="font-size:24px;color:#10b981;display:block;margin-bottom:8px;"></i>
      <b>No Blocked or Inactive Numbers</b>
      <div style="font-size:12px;margin-top:4px;">All your assigned numbers are currently active.</div>
    </div>`;
    return;
  }

  const rows = list.map(n => {
    const cleanNum = String(n.number || '').replace(/^\++/, '');
    const r = [
      { v: cleanNum, h: `<span style="font-family:monospace;font-weight:800;color:#dc2626;background:#fef2f2;padding:3px 7px;border-radius:6px;border:1px solid #fecaca;">${zyEsc(cleanNum)}</span>` },
      { v: n.range_name || '—', h: `<span style="font-weight:600;color:#dc2626;">${zyEsc(n.range_name || '—')}</span>` },
      { v: n.client_username || '—', h: n.client_username ? `<span style="font-weight:600;">${zyEsc(n.client_username)}</span>` : '<span style="color:#94a3b8;">Agent Pool</span>' },
      { v: n.inactivity_days_limit || 0, h: n.inactivity_days_limit ? `<span class="badge badge-red">${n.inactivity_days_limit}d Limit</span>` : '—' },
      { v: n.last_sms_at || 'Never', h: `<span style="font-size:11.5px;color:#64748b;">${n.last_sms_at ? zyEsc(String(n.last_sms_at).slice(0, 16).replace('T', ' ')) : 'No SMS'}</span>` },
      { v: n.blocked_reason || 'Blocked', h: `<span style="color:#dc2626;font-weight:700;font-size:12px;"><i class="fas fa-ban"></i> ${zyEsc(n.blocked_reason || 'Blocked')}</span>` }
    ];
    r.__id = n.id;
    return r;
  });

  host.innerHTML = zyDT2('dt-agt-blocked', {
    cols: ['Number', 'Range', 'Client', 'Rule', 'Last SMS', 'Status / Reason'],
    rows,
    check: true,
    perPage: 25
  });
  zy2Render('dt-agt-blocked');
};

window.zyAgentBlockSelectedNums = async function () {
  const ids = zy2Checked('dt-agt-blocked').map(Number).filter(Number.isFinite);
  if (!ids.length) { toast('Select at least one number first', 'warning'); return; }
  try {
    const res = await apiFetch('/api/numbers/blocked/block', {
      method: 'POST',
      body: JSON.stringify({ number_ids: ids, reason: 'Blocked by Agent' })
    });
    if (res && res.success) {
      toast(`Marked ${res.blocked || ids.length} number(s) as Blocked`, 'success');
      pgBlockedNumbers();
    } else {
      toast(res?.error || 'Failed to block numbers', 'error');
    }
  } catch (err) {
    toast(err?.message || 'Failed to block numbers', 'error');
  }
};

window.zyAgentDeleteBlockedNums = async function () {
  const ids = zy2Checked('dt-agt-blocked').map(Number).filter(Number.isFinite);
  if (!ids.length) { toast('Select at least one blocked number to delete', 'warning'); return; }
  const ok = await zyConfirm(`Permanently delete ${ids.length} blocked number(s) from the entire system pool (Owner, Agent & Client)? This cannot be undone.`, {
    title: 'Delete Blocked Numbers',
    confirmLabel: 'Delete Permanently',
    danger: true
  });
  if (!ok) return;
  try {
    const res = await apiFetch('/api/numbers/blocked/delete', {
      method: 'POST',
      body: JSON.stringify({ number_ids: ids })
    });
    if (res && res.success) {
      toast(`Deleted ${res.deleted || 0} blocked number(s) from system pool`, 'success');
      pgBlockedNumbers();
    } else {
      toast(res?.error || 'Failed to delete blocked numbers', 'error');
    }
  } catch (err) {
    toast(err?.message || 'Failed to delete blocked numbers', 'error');
  }
};

/* ═══ AGENT ALLOCATION HISTORY (PRIVATE AGENT-POOL LOGS) ═══════ */
const zyAgtAllocHistState = { type: 'all', client_id: '', search: '', page: 1, limit: 25 };
let zyAgtAllocHistSearchTimer = null;

function zyAgtAllocHistBadge(cat, label) {
  const map = {
    allocation: { bg: '#ecfdf5', fg: '#047857', bd: '#a7f3d0', icon: 'fa-plus-circle' },
    request:    { bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe', icon: 'fa-paper-plane' },
    return:     { bg: '#fff7ed', fg: '#c2410c', bd: '#fed7aa', icon: 'fa-rotate-left' },
    transfer:   { bg: '#f5f3ff', fg: '#6d28d9', bd: '#ddd6fe', icon: 'fa-right-left' }
  };
  const st = map[cat] || { bg: '#f1f5f9', fg: '#334155', bd: '#cbd5e1', icon: 'fa-circle-info' };
  return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;font-size:11.5px;font-weight:700;background:${st.bg};color:${st.fg};border:1px solid ${st.bd};white-space:nowrap;"><i class="fas ${st.icon}" style="font-size:10px;"></i>${zyEsc(label || cat || 'Event')}</span>`;
}

function zyAgtAllocHistPaytermBadge(pt) {
  const v = String(pt || '').trim();
  if (!v) return '<span style="color:#94a3b8;">—</span>';
  const low = v.toLowerCase();
  const isMonthly = low.includes('month');
  const isWeekly = low.includes('week');
  const bg = isMonthly ? '#f0f9ff' : isWeekly ? '#fefce8' : '#f1f5f9';
  const fg = isMonthly ? '#0369a1' : isWeekly ? '#a16207' : '#475569';
  const bd = isMonthly ? '#bae6fd' : isWeekly ? '#fde68a' : '#cbd5e1';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:${bg};color:${fg};border:1px solid ${bd};white-space:nowrap;">${zyEsc(v)}</span>`;
}

async function zyAgtAllocHistLoad() {
  const wrap = document.getElementById('agt-alloc-hist-body');
  if (!wrap) return;
  wrap.innerHTML = `<div class="zy-loading" style="padding:32px;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Loading allocation history…</div>`;
  try {
    const qs = new URLSearchParams({
      type: zyAgtAllocHistState.type || 'all',
      page: String(zyAgtAllocHistState.page || 1),
      limit: String(zyAgtAllocHistState.limit || 25)
    });
    if (zyAgtAllocHistState.client_id) qs.set('client_id', String(zyAgtAllocHistState.client_id));
    if (zyAgtAllocHistState.search) qs.set('search', zyAgtAllocHistState.search);

    const res = await apiFetch('/api/agent/allocation-history?' + qs.toString());
    const rows = Array.isArray(res?.data) ? res.data : [];
    const total = Number(res?.total || 0);
    const page = Number(res?.page || zyAgtAllocHistState.page || 1);
    const limit = Number(res?.limit || zyAgtAllocHistState.limit || 25);
    const sum = res?.summary || {};
    const clients = Array.isArray(res?.clients) ? res.clients : [];

    // Update KPI cards
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('agt-ah-kpi-total', Number(sum.total || 0).toLocaleString());
    setTxt('agt-ah-kpi-alloc', `${Number(sum.allocations || 0).toLocaleString()} (${Number(sum.total_nums_allocated || 0).toLocaleString()} nums)`);
    setTxt('agt-ah-kpi-req', Number(sum.requests || 0).toLocaleString());
    setTxt('agt-ah-kpi-ret', `${Number(sum.returns || 0).toLocaleString()} (${Number(sum.total_nums_returned || 0).toLocaleString()} nums)`);

    // Update tab counts
    setTxt('agt-ah-cnt-all', Number(sum.total || 0));
    setTxt('agt-ah-cnt-allocation', Number(sum.allocations || 0));
    setTxt('agt-ah-cnt-request', Number(sum.requests || 0));
    setTxt('agt-ah-cnt-return', Number(sum.returns || 0));
    setTxt('agt-ah-cnt-transfer', Number(sum.transfers || 0));

    // Populate client filter dropdown preserving current selection
    const sel = document.getElementById('agt-ah-client-sel');
    if (sel) {
      const curVal = String(zyAgtAllocHistState.client_id || '');
      const opts = [`<option value="">All My Clients (${clients.length})</option>`]
        .concat(clients.map(c => `<option value="${Number(c.id)}"${String(c.id) === curVal ? ' selected' : ''}>${zyEsc(c.username)}</option>`));
      sel.innerHTML = opts.join('');
    }

    // Highlight active tab
    document.querySelectorAll('#agt-ah-tabs .agt-ah-tab').forEach(btn => {
      const active = btn.getAttribute('data-type') === zyAgtAllocHistState.type;
      btn.style.background = active ? '#0284c7' : '#f8fafc';
      btn.style.color = active ? '#ffffff' : '#334155';
      btn.style.borderColor = active ? '#0284c7' : '#e2e8f0';
    });

    if (!rows.length) {
      wrap.innerHTML = `
        <div style="padding:44px 20px;text-align:center;color:#64748b;">
          <i class="fas fa-clock-rotate-left" style="font-size:30px;color:#cbd5e1;margin-bottom:10px;display:block;"></i>
          <div style="font-weight:700;color:#334155;font-size:14px;">No allocation history records found</div>
          <div style="font-size:12.5px;margin-top:4px;">Client allocations, number requests, returns, and transfers will appear here automatically.</div>
        </div>`;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const startIdx = (page - 1) * limit + 1;
    const endIdx = Math.min(total, page * limit);

    const tableRows = rows.map(e => {
      const isAgentActor = String(e.actor_role || '').toLowerCase() === 'agent';
      const roleChip = isAgentActor
        ? `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#e0f2fe;color:#0369a1;margin-left:5px;">You</span>`
        : `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#dcfce7;color:#15803d;margin-left:5px;">Client</span>`;
      const qtyColor = e.category === 'return' ? '#c2410c' : e.category === 'allocation' ? '#047857' : '#1d4ed8';
      const qtyBg = e.category === 'return' ? '#fff7ed' : e.category === 'allocation' ? '#ecfdf5' : '#eff6ff';
      return [
        `<span style="white-space:nowrap;font-size:12px;color:#475569;font-weight:600;">${zyEsc(fmtShort(e.timestamp))}</span>`,
        zyAgtAllocHistBadge(e.category, e.action_label),
        `<div style="white-space:nowrap;"><strong style="color:#0f172a;">${zyEsc(e.actor_name || '—')}</strong>${roleChip}</div>`,
        `<strong style="color:#1e293b;">${zyEsc(e.range_name || '—')}</strong>`,
        zyAgtAllocHistPaytermBadge(e.payterm),
        `<span style="display:inline-block;padding:2px 9px;border-radius:6px;font-weight:800;font-size:12px;background:${qtyBg};color:${qtyColor};">${Number(e.count || 0).toLocaleString()}</span>`,
        `<span style="font-size:12px;color:#475569;word-break:break-word;">${zyEsc(e.detail || '—')}</span>`,
        statusBadge(e.status || 'completed')
      ];
    });

    const pagerHtml = totalPages > 1 ? `
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;">
        <div style="font-size:12.5px;color:#64748b;font-weight:600;">Showing ${startIdx}–${endIdx} of ${total.toLocaleString()} events</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="btn btn-outline btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="window.zyAgtAllocHistPage(${page - 1})"><i class="fas fa-chevron-left"></i> Prev</button>
          <span style="font-size:12.5px;font-weight:700;color:#334155;padding:0 8px;">Page ${page} / ${totalPages}</span>
          <button class="btn btn-outline btn-sm" ${page >= totalPages ? 'disabled' : ''} onclick="window.zyAgtAllocHistPage(${page + 1})">Next <i class="fas fa-chevron-right"></i></button>
        </div>
      </div>` : `
      <div style="padding:10px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#64748b;font-weight:600;">
        Showing ${startIdx}–${endIdx} of ${total.toLocaleString()} events
      </div>`;

    wrap.innerHTML = `
      <div style="overflow-x:auto;">
        ${buildTable(['Date / Time', 'Action', 'Client / Account', 'Range', 'Payterm', 'Qty', 'Details', 'Status'], tableRows)}
      </div>
      ${pagerHtml}`;
  } catch (err) {
    console.error('Agent allocation history load error:', err);
    wrap.innerHTML = `<div style="padding:28px;text-align:center;color:#dc2626;font-weight:600;">Failed to load allocation history. Please try refreshing.</div>`;
    toast('Failed to load allocation history', 'error');
  }
}

window.zyAgtAllocHistSetType = function (type) {
  zyAgtAllocHistState.type = type || 'all';
  zyAgtAllocHistState.page = 1;
  zyAgtAllocHistLoad();
};

window.zyAgtAllocHistSetClient = function (clientId) {
  zyAgtAllocHistState.client_id = clientId || '';
  zyAgtAllocHistState.page = 1;
  zyAgtAllocHistLoad();
};

window.zyAgtAllocHistSetSearch = function (val) {
  clearTimeout(zyAgtAllocHistSearchTimer);
  zyAgtAllocHistSearchTimer = setTimeout(() => {
    zyAgtAllocHistState.search = String(val || '').trim();
    zyAgtAllocHistState.page = 1;
    zyAgtAllocHistLoad();
  }, 260);
};

window.zyAgtAllocHistPage = function (p) {
  zyAgtAllocHistState.page = Math.max(1, Number(p) || 1);
  zyAgtAllocHistLoad();
};

window.zyAgtAllocHistRefresh = function () {
  zyAgtAllocHistLoad();
};

async function pgAgentAllocationHistory(resetState = true) {
  if (resetState) {
    zyAgtAllocHistState.type = 'all';
    zyAgtAllocHistState.client_id = '';
    zyAgtAllocHistState.search = '';
    zyAgtAllocHistState.page = 1;
  }
  const c = document.getElementById('page-content');
  zyCrumb(['Allocation History']);
  c.innerHTML = `
    <div class="page-header" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div class="page-title" style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-clock-rotate-left" style="color:#0284c7;"></i> Allocation History
        </div>
        <div class="page-subtitle">Private log of your clients' number allocations, requests, returns, and transfers</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-outline btn-sm" onclick="window.zyAgtAllocHistRefresh()">
          <i class="fas fa-rotate"></i> Refresh
        </button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
      <div class="card" style="padding:14px 16px;border-left:4px solid #0284c7;">
        <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Total Events</div>
        <div id="agt-ah-kpi-total" style="font-size:22px;font-weight:800;color:#0f172a;margin-top:4px;">—</div>
      </div>
      <div class="card" style="padding:14px 16px;border-left:4px solid #10b981;">
        <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Allocations</div>
        <div id="agt-ah-kpi-alloc" style="font-size:18px;font-weight:800;color:#047857;margin-top:6px;">—</div>
      </div>
      <div class="card" style="padding:14px 16px;border-left:4px solid #2563eb;">
        <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Client Requests</div>
        <div id="agt-ah-kpi-req" style="font-size:22px;font-weight:800;color:#1d4ed8;margin-top:4px;">—</div>
      </div>
      <div class="card" style="padding:14px 16px;border-left:4px solid #ea580c;">
        <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Returns</div>
        <div id="agt-ah-kpi-ret" style="font-size:18px;font-weight:800;color:#c2410c;margin-top:6px;">—</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;padding:12px 14px;">
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;">
        <div id="agt-ah-tabs" style="display:flex;flex-wrap:wrap;gap:6px;">
          <button class="agt-ah-tab" data-type="all" onclick="window.zyAgtAllocHistSetType('all')" style="padding:6px 12px;border-radius:7px;border:1px solid #0284c7;background:#0284c7;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;">
            All <span id="agt-ah-cnt-all" style="opacity:.85;margin-left:3px;">0</span>
          </button>
          <button class="agt-ah-tab" data-type="allocation" onclick="window.zyAgtAllocHistSetType('allocation')" style="padding:6px 12px;border-radius:7px;border:1px solid #e2e8f0;background:#f8fafc;color:#334155;font-size:12.5px;font-weight:700;cursor:pointer;">
            Allocations <span id="agt-ah-cnt-allocation" style="opacity:.8;margin-left:3px;">0</span>
          </button>
          <button class="agt-ah-tab" data-type="request" onclick="window.zyAgtAllocHistSetType('request')" style="padding:6px 12px;border-radius:7px;border:1px solid #e2e8f0;background:#f8fafc;color:#334155;font-size:12.5px;font-weight:700;cursor:pointer;">
            Requests <span id="agt-ah-cnt-request" style="opacity:.8;margin-left:3px;">0</span>
          </button>
          <button class="agt-ah-tab" data-type="return" onclick="window.zyAgtAllocHistSetType('return')" style="padding:6px 12px;border-radius:7px;border:1px solid #e2e8f0;background:#f8fafc;color:#334155;font-size:12.5px;font-weight:700;cursor:pointer;">
            Returns <span id="agt-ah-cnt-return" style="opacity:.8;margin-left:3px;">0</span>
          </button>
          <button class="agt-ah-tab" data-type="transfer" onclick="window.zyAgtAllocHistSetType('transfer')" style="padding:6px 12px;border-radius:7px;border:1px solid #e2e8f0;background:#f8fafc;color:#334155;font-size:12.5px;font-weight:700;cursor:pointer;">
            Transfers <span id="agt-ah-cnt-transfer" style="opacity:.8;margin-left:3px;">0</span>
          </button>
        </div>

        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
          <select id="agt-ah-client-sel" onchange="window.zyAgtAllocHistSetClient(this.value)" style="padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;font-size:12.5px;font-weight:600;color:#1e293b;background:#fff;min-width:170px;">
            <option value="">All My Clients</option>
          </select>
          <input type="text" id="agt-ah-search" placeholder="Search client, range, notes…" oninput="window.zyAgtAllocHistSetSearch(this.value)" style="padding:7px 11px;border:1px solid #cbd5e1;border-radius:7px;font-size:12.5px;color:#1e293b;background:#fff;min-width:200px;">
        </div>
      </div>
    </div>

    <div class="card" id="agt-alloc-hist-body" style="padding:0;overflow:hidden;"></div>
  `;
  zyAgtAllocHistLoad();
}

/* ═══ APPS METHOD VIDEO VAULT (AGENT) ════════════════════════ */
window._zyMvState = {
  tab: 'vault',
  search: '',
  data: null,
  linkDrafts: []
};

async function pgMethodVault(tabOverride) {
  if (tabOverride) window._zyMvState.tab = tabOverride;
  const c = document.getElementById('page-content');
  zyCrumb(['Apps Method']);
  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title" style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-film" style="color:#7c3aed;"></i> Apps Method Video Vault
        </div>
        <div class="page-subtitle">Store protected app method videos &amp; links (25 GB shared cap), approve client Need requests, or send directly to any Client, Group, or Channel with auto-expiring timers.</div>
      </div>
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-outline btn-sm" onclick="zyMvLoadOverview()"><i class="fas fa-rotate"></i> Refresh</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="zyMvOpenUploadModal()"><i class="fas fa-cloud-arrow-up"></i> Upload App Method</button>
      </div>
    </div>

    <div id="zy-mv-agent-root">
      <div class="card" style="padding:28px;text-align:center;color:var(--sp-text-muted,#64748b);">
        <i class="fas fa-spinner fa-spin" style="font-size:20px;color:#7c3aed;margin-bottom:8px;"></i>
        <div>Loading Method Vault…</div>
      </div>
    </div>
  `;
  await zyMvLoadOverview();
}

window.zyMvLoadOverview = async function() {
  const root = document.getElementById('zy-mv-agent-root');
  if (!root) return;
  try {
    const res = await apiFetch('/api/method-vault/agent/overview');
    if (!res || res.error) {
      root.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:#b91c1c;"><i class="fas fa-lock" style="font-size:22px;margin-bottom:8px;"></i><div>${zyEsc(res?.error || 'Apps Method Vault access is not enabled for your account. Ask Owner to enable it in General Settings.')}</div></div>`;
      return;
    }
    window._zyMvState.data = res;
    zyMvRenderAgentView();
  } catch (err) {
    root.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:#b91c1c;">${zyEsc(err.message || 'Failed to load Method Vault')}</div>`;
  }
};

window.zyMvSwitchTab = function(tab) {
  window._zyMvState.tab = tab;
  zyMvRenderAgentView();
};

window.zyMvSetSearch = function(val) {
  window._zyMvState.search = String(val || '');
  zyMvRenderAgentView();
};

function zyMvRenderAgentView() {
  const root = document.getElementById('zy-mv-agent-root');
  const d = window._zyMvState.data;
  if (!root || !d) return;

  const st = d.storage || {};
  const methods = Array.isArray(d.methods) ? d.methods : [];
  const requests = Array.isArray(d.requests) ? d.requests : [];
  const pendingReqs = requests.filter(r => String(r.status || '').toLowerCase() === 'pending');

  const usedGb = Number(st.used_gb || 0).toFixed(2);
  const maxGb = Number(st.max_gb || 25).toFixed(0);
  const pct = Math.min(100, Math.max(0, Number(st.used_percent || 0)));
  const barColor = pct >= 90 ? '#dc2626' : (pct >= 75 ? '#d97706' : '#7c3aed');
  const freeDisk = st.disk_free_gb != null ? `${Number(st.disk_free_gb).toFixed(1)} GB VPS free` : 'VPS Protected';

  const q = String(window._zyMvState.search || '').trim().toLowerCase();
  const filteredMethods = q
    ? methods.filter(m =>
        String(m.app_name || '').toLowerCase().includes(q) ||
        String(m.description || '').toLowerCase().includes(q)
      )
    : methods;

  const activeTab = window._zyMvState.tab || 'vault';

  root.innerHTML = `
    <!-- Storage & KPI Overview -->
    <div class="zy-mv-stats-grid">
      <div class="card zy-mv-meter-card">
        <div class="zy-mv-owner-meter-top">
          <div>
            <div style="font-size:13px;font-weight:800;color:var(--sp-text-primary,#0f172a);"><i class="fas fa-hard-drive" style="color:#7c3aed;margin-right:5px;"></i> Shared Vault Storage Cap (${maxGb} GB Max)</div>
            <div style="font-size:11.5px;color:var(--sp-text-muted,#64748b);margin-top:2px;">Your Videos: <strong>${Number(st.agent_used_mb || 0).toFixed(1)} MB</strong> · Delete any old method to immediately free VPS space (${zyEsc(freeDisk)}).</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:15px;font-weight:800;color:${barColor};font-variant-numeric:tabular-nums;">${usedGb} GB / ${maxGb} GB</div>
            <div style="font-size:11px;color:var(--sp-text-muted,#64748b);">${pct}% used</div>
          </div>
        </div>
        <div class="zy-mv-progress-track">
          <div class="zy-mv-progress-fill" style="width:${pct}%;background:${barColor};"></div>
        </div>
      </div>

      <div class="card zy-mv-kpi-mini">
        <div class="zy-mv-kpi-lbl">Saved Methods</div>
        <div class="zy-mv-kpi-val" style="color:#7c3aed;">${methods.length}</div>
        <div class="zy-mv-kpi-sub">${methods.filter(m => m.active !== false).length} Active for Clients</div>
      </div>

      <div class="card zy-mv-kpi-mini" style="cursor:pointer;" onclick="zyMvSwitchTab('requests')">
        <div class="zy-mv-kpi-lbl">Pending Requests</div>
        <div class="zy-mv-kpi-val" style="color:${pendingReqs.length ? '#d97706' : '#059669'};">${pendingReqs.length}</div>
        <div class="zy-mv-kpi-sub">${Number(d.active_grants_count || 0)} Active Unlocks</div>
      </div>
    </div>

    <!-- Tabs + Toolbar -->
    <div class="card" style="padding:12px 14px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="zy-mv-tab-btn ${activeTab === 'vault' ? 'is-active' : ''}" onclick="zyMvSwitchTab('vault')">
            <i class="fas fa-film"></i> Method Storage <span class="zy-mv-tab-cnt">${methods.length}</span>
          </button>
          <button type="button" class="zy-mv-tab-btn ${activeTab === 'requests' ? 'is-active' : ''}" onclick="zyMvSwitchTab('requests')">
            <i class="fas fa-inbox"></i> Client Requests ${pendingReqs.length ? `<span class="zy-mv-tab-cnt is-alert">${pendingReqs.length}</span>` : `<span class="zy-mv-tab-cnt">${requests.length}</span>`}
          </button>
        </div>
        ${activeTab === 'vault' ? `
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="text" class="zy-input" style="min-width:210px;height:34px;font-size:12.5px;" placeholder="Search app name or caption…" value="${zyEsc(window._zyMvState.search)}" oninput="zyMvSetSearch(this.value)">
          </div>
        ` : ''}
      </div>
    </div>

    ${activeTab === 'vault' ? zyMvRenderMethodsGrid(filteredMethods) : zyMvRenderRequestsPanel(requests)}
  `;
}

function zyMvRenderMethodsGrid(list) {
  if (!list.length) {
    return `
      <div class="card" style="padding:36px 20px;text-align:center;">
        <i class="fas fa-film" style="font-size:34px;color:#a78bfa;margin-bottom:10px;"></i>
        <div style="font-size:15px;font-weight:800;color:var(--sp-text-primary,#0f172a);margin-bottom:4px;">No App Methods Saved Yet</div>
        <div style="font-size:12.5px;color:var(--sp-text-muted,#64748b);margin-bottom:14px;">Upload your first App Method video + caption + links to share securely with clients.</div>
        <button type="button" class="btn btn-primary btn-sm" onclick="zyMvOpenUploadModal()"><i class="fas fa-cloud-arrow-up"></i> Upload App Method</button>
      </div>
    `;
  }

  return `
    <div class="zy-mv-cards-grid">
      ${list.map(m => {
        const id = Number(m.id);
        const isActive = m.active !== false;
        const sizeMb = (Number(m.video_size || 0) / (1024 * 1024)).toFixed(1);
        const links = Array.isArray(m.links) ? m.links : [];
        return `
          <div class="card zy-mv-method-card ${isActive ? '' : 'is-inactive'}">
            <div class="zy-mv-card-top">
              <div style="min-width:0;flex:1;">
                <div class="zy-mv-card-title">${zyEsc(m.app_name)}</div>
                <div class="zy-mv-card-meta">
                  ${m.has_video ? `<span><i class="fas fa-video" style="color:#7c3aed;"></i> ${sizeMb} MB</span>` : '<span><i class="fas fa-file-lines"></i> Text &amp; Links Only</span>'}
                  <span><i class="fas fa-clock" style="color:#0284c7;"></i> Default ${Number(m.default_hours || 24)}h</span>
                  ${links.length ? `<span><i class="fas fa-link" style="color:#059669;"></i> ${links.length} link${links.length === 1 ? '' : 's'}</span>` : ''}
                </div>
              </div>
              <label class="zy-mv-switch-wrap is-compact" title="${isActive ? 'Visible to Clients in Apps Method' : 'Hidden from Clients'}">
                <input type="checkbox" ${isActive ? 'checked' : ''} onchange="zyMvToggleMethodActive(${id}, this.checked, this)">
                <span class="zy-mv-switch-slider"></span>
                <span class="zy-mv-switch-lbl">${isActive ? 'Active' : 'Hidden'}</span>
              </label>
            </div>

            ${m.description ? `<div class="zy-mv-card-desc">${zyEsc(m.description).replace(/\n/g, '<br>')}</div>` : ''}

            ${links.length ? `
              <div class="zy-mv-links-list" style="margin-top:8px;">
                ${links.map(l => {
                  const href = typeof window.zyMvSafeHref === 'function' ? window.zyMvSafeHref(l.url) : '';
                  if (!href) return '';
                  return `<a class="zy-mv-link-chip" href="${zyEsc(href)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square"></i> <span>${zyEsc(l.label || l.url)}</span></a>`;
                }).join('')}
              </div>
            ` : ''}

            <div class="zy-mv-card-actions">
              ${m.has_video ? `
                <button type="button" class="btn btn-outline btn-xs" onclick="zyMvPreviewMethod(${id})" title="Preview Video">
                  <i class="fas fa-play"></i> Preview
                </button>
              ` : ''}
              <button type="button" class="btn btn-primary btn-xs" onclick="zyMvOpenDirectSendModal(${id})" title="Send directly to a Client, Group, or Channel">
                <i class="fas fa-paper-plane"></i> Send to Client / Group
              </button>
              <button type="button" class="btn btn-outline btn-xs" onclick="zyMvOpenEditModal(${id})" title="Edit Method Details">
                <i class="fas fa-pen"></i>
              </button>
              <button type="button" class="btn btn-danger btn-xs" onclick="zyMvDeleteMethod(${id})" title="Delete Method & Free Disk Space">
                <i class="fas fa-trash-can"></i>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function zyMvRenderRequestsPanel(requests) {
  if (!requests.length) {
    return `
      <div class="card" style="padding:34px 20px;text-align:center;color:var(--sp-text-muted,#64748b);">
        <i class="fas fa-inbox" style="font-size:30px;opacity:0.5;margin-bottom:8px;"></i>
        <div>No client App Method requests yet. When clients tap <strong>Need</strong> in their Apps Method menu, requests appear here instantly.</div>
      </div>
    `;
  }
  const pending = requests.filter(r => String(r.status || '').toLowerCase() === 'pending');
  const history = requests.filter(r => String(r.status || '').toLowerCase() !== 'pending');

  const renderRow = (r) => {
    const st = String(r.status || 'pending').toLowerCase();
    const cls = st === 'approved' ? 'is-approved' : (st === 'declined' ? 'is-declined' : 'is-pending');
    const when = String(r.created_at || '').replace('T', ' ').slice(0, 16);
    return `
      <div class="zy-mv-req-row ${st === 'pending' ? 'is-pending-row' : ''}">
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="font-size:13.5px;color:var(--sp-text-primary,#0f172a);">${zyEsc(r.client_username || 'Client')}</strong>
            <span style="font-size:12px;color:var(--sp-text-muted,#64748b);">requested</span>
            <span class="badge" style="background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;font-weight:700;">${zyEsc(r.app_name || 'App Method')}</span>
            <span class="zy-mv-st-tag ${cls}">${zyEsc(st.toUpperCase())}</span>
          </div>
          <div style="font-size:11.5px;color:var(--sp-text-muted,#64748b);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap;">
            <span><i class="fas fa-clock"></i> ${zyEsc(when)}</span>
            ${st === 'approved' && r.expires_at ? `<span style="color:#059669;font-weight:600;"><i class="fas fa-hourglass-half"></i> Expires: ${zyEsc(String(r.expires_at).replace('T', ' ').slice(0, 16))} UTC</span>` : ''}
            ${st === 'declined' && r.decline_reason ? `<span style="color:#b91c1c;"><i class="fas fa-circle-info"></i> Reason: ${zyEsc(r.decline_reason)}</span>` : ''}
          </div>
        </div>
        ${st === 'pending' ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;">
            <button type="button" class="btn btn-success btn-sm" onclick="zyMvOpenApproveModal(${Number(r.id)})">
              <i class="fas fa-check"></i> Accept &amp; Send
            </button>
            <button type="button" class="btn btn-danger btn-sm" onclick="zyMvOpenDeclineModal(${Number(r.id)})">
              <i class="fas fa-times"></i> Decline
            </button>
          </div>
        ` : ''}
      </div>
    `;
  };

  return `
    ${pending.length ? `
      <div class="card" style="margin-bottom:14px;padding:14px;">
        <div style="font-size:13px;font-weight:800;color:#b45309;margin-bottom:10px;"><i class="fas fa-bell" style="margin-right:5px;"></i> Pending Client Requests (${pending.length})</div>
        <div class="zy-mv-req-list">${pending.map(renderRow).join('')}</div>
      </div>
    ` : ''}
    ${history.length ? `
      <div class="card" style="padding:14px;">
        <div style="font-size:13px;font-weight:800;color:var(--sp-text-secondary,#475569);margin-bottom:10px;"><i class="fas fa-clock-rotate-left" style="margin-right:5px;"></i> Request History (${history.length})</div>
        <div class="zy-mv-req-list">${history.map(renderRow).join('')}</div>
      </div>
    ` : ''}
  `;
}

function zyMvFindMethod(id) {
  return ((window._zyMvState.data && window._zyMvState.data.methods) || []).find(m => Number(m.id) === Number(id)) || null;
}

window.zyMvPreviewMethod = function(id) {
  const m = zyMvFindMethod(id);
  if (!m) return;
  if (typeof window.zyOpenSecureMethodPlayer === 'function') {
    window.zyOpenSecureMethodPlayer({
      methodId: m.id,
      appName: m.app_name,
      description: m.description,
      links: m.links,
      isAgentPreview: true
    });
  }
};

window.zyMvToggleMethodActive = async function(id, active, cb) {
  if (cb) cb.disabled = true;
  try {
    const res = await apiFetch(`/api/method-vault/agent/items/${Number(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: Boolean(active) })
    });
    if (res && res.success) {
      toast(`Method ${active ? 'activated for Clients' : 'hidden from Clients'}`, 'success');
      await zyMvLoadOverview();
    } else {
      if (cb) cb.checked = !active;
      toast(res?.error || 'Update failed', 'error');
    }
  } catch (err) {
    if (cb) cb.checked = !active;
    toast(err.message || 'Update failed', 'error');
  } finally {
    if (cb) cb.disabled = false;
  }
};

window.zyMvDeleteMethod = async function(id) {
  const m = zyMvFindMethod(id);
  const ok = await zyConfirm(
    `Delete "${m ? m.app_name : 'this method'}" permanently? Its video file will be deleted from VPS storage immediately to free disk space.`,
    { title: 'Delete App Method', confirmLabel: 'Delete & Free Space', danger: true }
  );
  if (!ok) return;
  try {
    const res = await apiFetch(`/api/method-vault/agent/items/${Number(id)}`, { method: 'DELETE' });
    if (res && res.success) {
      toast('Method deleted and storage freed.', 'success');
      await zyMvLoadOverview();
    } else {
      toast(res?.error || 'Delete failed', 'error');
    }
  } catch (err) {
    toast(err.message || 'Delete failed', 'error');
  }
};

/* Dynamic Links Builder helper for Upload/Edit modals */
window.zyMvRenderLinkRows = function(containerId, links) {
  const host = document.getElementById(containerId);
  if (!host) return;
  const arr = Array.isArray(links) ? links : [];
  if (!arr.length) {
    host.innerHTML = `<div style="font-size:11.5px;color:#64748b;padding:4px 0;">No links attached yet. Click "+ Add Link" to attach app/download links.</div>`;
    return;
  }
  host.innerHTML = arr.map((l, idx) => `
    <div class="zy-mv-link-edit-row" data-mv-link-row="${idx}">
      <input type="text" class="zy-input zy-mv-link-lbl-in" placeholder="Button / Label (e.g. Play Store)" value="${zyEsc(l.label || '')}">
      <input type="url" class="zy-input zy-mv-link-url-in" placeholder="https://..." value="${zyEsc(l.url || '')}">
      <button type="button" class="btn btn-outline btn-xs" style="color:#dc2626;" onclick="this.closest('.zy-mv-link-edit-row').remove()" title="Remove Link"><i class="fas fa-times"></i></button>
    </div>
  `).join('');
};

window.zyMvAddLinkRow = function(containerId) {
  const host = document.getElementById(containerId);
  if (!host) return;
  if (!host.querySelector('.zy-mv-link-edit-row')) host.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'zy-mv-link-edit-row';
  row.innerHTML = `
    <input type="text" class="zy-input zy-mv-link-lbl-in" placeholder="Label (e.g. Download App)">
    <input type="url" class="zy-input zy-mv-link-url-in" placeholder="https://...">
    <button type="button" class="btn btn-outline btn-xs" style="color:#dc2626;" onclick="this.closest('.zy-mv-link-edit-row').remove()" title="Remove Link"><i class="fas fa-times"></i></button>
  `;
  host.appendChild(row);
};

function zyMvCollectLinks(containerId) {
  const host = document.getElementById(containerId);
  if (!host) return [];
  const rows = Array.from(host.querySelectorAll('.zy-mv-link-edit-row'));
  const out = [];
  for (const r of rows) {
    const label = (r.querySelector('.zy-mv-link-lbl-in')?.value || '').trim();
    const url = (r.querySelector('.zy-mv-link-url-in')?.value || '').trim();
    if (url) out.push({ label: label || url, url });
  }
  return out;
}

window.zyMvOpenUploadModal = function() {
  zyModal('Upload App Method (Video + Caption + Links)', `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <label class="zy-lbl">App Name *</label>
        <input type="text" id="mv-up-name" class="zy-input" placeholder="e.g. WhatsApp Business Method, Telegram OTP Setup" maxlength="120">
      </div>
      <div>
        <label class="zy-lbl">Method Video (.mp4, .webm, .mov — max 500 MB per video)</label>
        <input type="file" id="mv-up-file" class="zy-input" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" style="padding:7px;">
        <div id="mv-up-file-info" style="font-size:11.5px;color:#64748b;margin-top:4px;">Videos stream directly to isolated 25 GB Vault storage (never slows SMS or backups).</div>
      </div>
      <div>
        <label class="zy-lbl">Caption / Step-by-Step Instructions (WhatsApp-style)</label>
        <textarea id="mv-up-desc" class="zy-input" rows="3" placeholder="Write method notes, instructions, or tips sent along with the video…" maxlength="3000"></textarea>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <label class="zy-lbl" style="margin:0;">Attached Links (Optional)</label>
          <button type="button" class="btn btn-outline btn-xs" onclick="zyMvAddLinkRow('mv-up-links-host')"><i class="fas fa-plus"></i> Add Link</button>
        </div>
        <div id="mv-up-links-host" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center;">
        <div>
          <label class="zy-lbl">Default Unlock Timer (Hours)</label>
          <input type="number" id="mv-up-hours" class="zy-input" value="24" min="1" max="720">
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;font-weight:700;padding-top:18px;">
          <input type="checkbox" id="mv-up-active" checked> Active in Client "Apps Method"
        </label>
      </div>
      <div id="mv-up-prog-wrap" style="display:none;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:10px 12px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:#5b21b6;margin-bottom:6px;">
          <span id="mv-up-prog-lbl">Uploading video…</span>
          <span id="mv-up-prog-pct">0%</span>
        </div>
        <div class="zy-mv-progress-track">
          <div id="mv-up-prog-bar" class="zy-mv-progress-fill" style="width:0%;background:#7c3aed;"></div>
        </div>
      </div>
    </div>
  `, `
    <button type="button" class="zy-btn-grey" id="mv-up-cancel" onclick="closeModal()">Cancel</button>
    <button type="button" class="zy-btn-blue" id="mv-up-submit" onclick="zyMvSubmitUpload()"><i class="fas fa-cloud-arrow-up"></i> Save to Vault</button>
  `);
  zyMvRenderLinkRows('mv-up-links-host', []);
};

window.zyMvSubmitUpload = async function() {
  const appName = (document.getElementById('mv-up-name')?.value || '').trim();
  const desc = (document.getElementById('mv-up-desc')?.value || '').trim();
  const fileEl = document.getElementById('mv-up-file');
  const file = fileEl && fileEl.files ? fileEl.files[0] : null;
  const links = zyMvCollectLinks('mv-up-links-host');
  const defaultHours = Math.max(1, Math.min(720, parseInt(document.getElementById('mv-up-hours')?.value || '24', 10) || 24));
  const active = Boolean(document.getElementById('mv-up-active')?.checked);

  if (!appName) { toast('App Name is required', 'error'); return; }
  if (!file && !desc && !links.length) {
    toast('Attach a video, caption, or at least one link', 'error');
    return;
  }

  const btn = document.getElementById('mv-up-submit');
  const cancelBtn = document.getElementById('mv-up-cancel');
  const progWrap = document.getElementById('mv-up-prog-wrap');
  const progBar = document.getElementById('mv-up-prog-bar');
  const progPct = document.getElementById('mv-up-prog-pct');
  const progLbl = document.getElementById('mv-up-prog-lbl');

  const resetBtn = () => {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Save to Vault'; }
    if (cancelBtn) cancelBtn.disabled = false;
  };
  const setProgress = (loaded, total, labelOverride) => {
    const pct = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
    if (progBar) progBar.style.width = pct + '%';
    if (progPct) progPct.textContent = pct + '%';
    if (progLbl) {
      if (labelOverride) {
        progLbl.textContent = labelOverride;
      } else {
        const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (total / (1024 * 1024)).toFixed(1);
        progLbl.textContent = `Uploading ${loadedMb} MB / ${totalMb} MB…`;
      }
    }
  };

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…'; }
  if (cancelBtn) cancelBtn.disabled = true;
  if (progWrap) progWrap.style.display = 'block';

  const tok = sessionStorage.getItem('admin_token') || localStorage.getItem('admin_token') || '';
  const authHeaders = tok ? { Authorization: 'Bearer ' + tok } : {};

  // Use resilient 768KB chunked upload for any video > 700KB (bypasses strict Nginx 1M/50M limits & survives slow internet)
  if (file && file.size > 700 * 1024) {
    try {
      setProgress(0, file.size, 'Preparing video upload…');
      const initRes = await apiFetch('/api/method-vault/agent/upload-init', {
        method: 'POST',
        body: JSON.stringify({
          file_name: file.name || 'video.mp4',
          file_size: file.size,
          file_mime: file.type || 'video/mp4'
        })
      });
      if (!initRes || !initRes.success || !initRes.upload_id) {
        toast((initRes && initRes.error) || 'Could not start video upload', 'error');
        resetBtn();
        return;
      }
      const uploadId = initRes.upload_id;
      const chunkSize = Number(initRes.chunk_size) || (768 * 1024);
      const totalChunks = Math.ceil(file.size / chunkSize);

      const uploadSingleChunk = (blob, idx, offsetBytes) => new Promise((resolve, reject) => {
        const fdChunk = new FormData();
        fdChunk.append('upload_id', uploadId);
        fdChunk.append('chunk_index', String(idx));
        fdChunk.append('chunk', blob, `chunk_${idx}.part`);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/method-vault/agent/upload-chunk', true);
        xhr.withCredentials = true;
        xhr.timeout = 90000;
        if (tok) xhr.setRequestHeader('Authorization', 'Bearer ' + tok);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.min(file.size, offsetBytes + ev.loaded), file.size);
          }
        };
        xhr.onload = () => {
          let data = null;
          try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
          if (xhr.status >= 200 && xhr.status < 300 && data && data.success) {
            resolve(data);
          } else {
            const err = new Error((data && data.error) || `Chunk upload failed (HTTP ${xhr.status})`);
            err.httpStatus = xhr.status;
            reject(err);
          }
        };
        xhr.onerror = () => reject(new Error('Network error during chunk upload'));
        xhr.ontimeout = () => reject(new Error('Upload timed out on slow connection'));
        xhr.send(fdChunk);
      });

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const blob = file.slice(start, end);
        let uploaded = false;
        let lastErr = null;
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            await uploadSingleChunk(blob, i, start);
            uploaded = true;
            break;
          } catch (chunkErr) {
            lastErr = chunkErr;
            // Don't retry hard 4xx validation/cap rejections
            if (chunkErr.httpStatus && chunkErr.httpStatus >= 400 && chunkErr.httpStatus < 500 && chunkErr.httpStatus !== 408) {
              break;
            }
            setProgress(start, file.size, `Slow connection — retrying part ${i + 1}/${totalChunks} (${attempt}/4)…`);
            await new Promise(r => setTimeout(r, 900 * attempt));
          }
        }
        if (!uploaded) {
          throw lastErr || new Error('Upload interrupted on slow internet. Please try again.');
        }
        setProgress(end, file.size);
      }

      setProgress(file.size, file.size, 'Finalizing and saving to Vault…');
      const compRes = await apiFetch('/api/method-vault/agent/upload-complete', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          upload_id: uploadId,
          app_name: appName,
          description: desc,
          links,
          default_hours: defaultHours,
          active
        })
      });
      if (compRes && compRes.success) {
        if (progBar) progBar.style.width = '100%';
        if (progPct) progPct.textContent = '100%';
        closeModal();
        toast('App Method saved to Vault!', 'success');
        await zyMvLoadOverview();
      } else {
        toast((compRes && compRes.error) || 'Could not finalize video', 'error');
        resetBtn();
      }
    } catch (err) {
      toast(err.message || 'Video upload failed', 'error');
      resetBtn();
    }
    return;
  }

  // Fast single-request path for text/links-only or tiny videos (<= 700KB)
  const fd = new FormData();
  fd.append('app_name', appName);
  fd.append('description', desc);
  fd.append('links', JSON.stringify(links));
  fd.append('default_hours', String(defaultHours));
  fd.append('active', active ? 'true' : 'false');
  if (file) fd.append('video', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/method-vault/agent/items', true);
  xhr.withCredentials = true;
  if (tok) xhr.setRequestHeader('Authorization', 'Bearer ' + tok);

  xhr.upload.onprogress = (ev) => {
    if (!ev.lengthComputable) return;
    setProgress(ev.loaded, ev.total);
  };

  xhr.onload = async () => {
    let data = null;
    try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
    if (xhr.status >= 200 && xhr.status < 300 && data && data.success) {
      if (progBar) progBar.style.width = '100%';
      if (progPct) progPct.textContent = '100%';
      closeModal();
      toast('App Method saved to Vault!', 'success');
      await zyMvLoadOverview();
    } else {
      toast((data && data.error) || `Upload failed (HTTP ${xhr.status})`, 'error');
      resetBtn();
    }
  };
  xhr.onerror = () => {
    toast('Network error while uploading video', 'error');
    resetBtn();
  };
  xhr.send(fd);
};

window.zyMvOpenEditModal = function(id) {
  const m = zyMvFindMethod(id);
  if (!m) return;
  zyModal(`Edit Method — ${zyEsc(m.app_name)}`, `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <label class="zy-lbl">App Name *</label>
        <input type="text" id="mv-ed-name" class="zy-input" value="${zyEsc(m.app_name || '')}" maxlength="120">
      </div>
      <div>
        <label class="zy-lbl">Caption / Instructions</label>
        <textarea id="mv-ed-desc" class="zy-input" rows="3" maxlength="3000">${zyEsc(m.description || '')}</textarea>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <label class="zy-lbl" style="margin:0;">Attached Links</label>
          <button type="button" class="btn btn-outline btn-xs" onclick="zyMvAddLinkRow('mv-ed-links-host')"><i class="fas fa-plus"></i> Add Link</button>
        </div>
        <div id="mv-ed-links-host" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center;">
        <div>
          <label class="zy-lbl">Default Unlock Timer (Hours)</label>
          <input type="number" id="mv-ed-hours" class="zy-input" value="${Number(m.default_hours || 24)}" min="1" max="720">
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;font-weight:700;padding-top:18px;">
          <input type="checkbox" id="mv-ed-active" ${m.active !== false ? 'checked' : ''}> Active for Clients
        </label>
      </div>
    </div>
  `, `
    <button type="button" class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button type="button" class="zy-btn-blue" id="mv-ed-save" onclick="zyMvSubmitEdit(${Number(m.id)})"><i class="fas fa-save"></i> Save Changes</button>
  `);
  zyMvRenderLinkRows('mv-ed-links-host', Array.isArray(m.links) ? m.links : []);
};

window.zyMvSubmitEdit = async function(id) {
  const app_name = (document.getElementById('mv-ed-name')?.value || '').trim();
  if (!app_name) { toast('App Name is required', 'error'); return; }
  const payload = {
    app_name,
    description: (document.getElementById('mv-ed-desc')?.value || '').trim(),
    links: zyMvCollectLinks('mv-ed-links-host'),
    default_hours: Math.max(1, Math.min(720, parseInt(document.getElementById('mv-ed-hours')?.value || '24', 10) || 24)),
    active: Boolean(document.getElementById('mv-ed-active')?.checked)
  };
  const btn = document.getElementById('mv-ed-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await apiFetch(`/api/method-vault/agent/items/${Number(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    if (res && res.success) {
      closeModal();
      toast('Method updated.', 'success');
      await zyMvLoadOverview();
    } else {
      toast(res?.error || 'Update failed', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
    }
  } catch (err) {
    toast(err.message || 'Update failed', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
  }
};

window.zyMvSetTimerPreset = function(hrsId, minsId, totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hEl = document.getElementById(hrsId);
  const mEl = document.getElementById(minsId);
  if (hEl) hEl.value = String(h);
  if (mEl) mEl.value = String(m);
};

window.zyMvOpenApproveModal = function(reqId) {
  const r = ((window._zyMvState.data && window._zyMvState.data.requests) || []).find(x => Number(x.id) === Number(reqId));
  if (!r) return;
  const m = zyMvFindMethod(r.method_id);
  const defHours = Number(m?.default_hours || 24);
  zyModal(`Approve & Send Method to ${zyEsc(r.client_username || 'Client')}`, `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:9px;padding:10px 12px;font-size:12.5px;">
        <strong>App Method:</strong> ${zyEsc(r.app_name || 'App Method')}<br>
        <span style="color:#64748b;">Sent directly from your Vault into <strong>${zyEsc(r.client_username || 'Client')}</strong>'s Live Chat. Auto-hides when the timer hits 00:00:00.</span>
      </div>
      <div>
        <label class="zy-lbl">Quick Timer Presets</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${[
            ['30 min', 30], ['1 hr', 60], ['2 hrs', 120], ['4 hrs', 240], ['12 hrs', 720], ['24 hrs', 1440], ['48 hrs', 2880]
          ].map(([lbl, mins]) => `<button type="button" class="btn btn-outline btn-xs" onclick="zyMvSetTimerPreset('mv-ap-hrs','mv-ap-mins',${mins})">${lbl}</button>`).join('')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label class="zy-lbl">Access Hours</label>
          <input type="number" id="mv-ap-hrs" class="zy-input" value="${defHours}" min="0" max="720">
        </div>
        <div>
          <label class="zy-lbl">Extra Minutes</label>
          <input type="number" id="mv-ap-mins" class="zy-input" value="0" min="0" max="59">
        </div>
      </div>
      <div>
        <label class="zy-lbl">Custom Caption / Note (Optional)</label>
        <textarea id="mv-ap-note" class="zy-input" rows="2" placeholder="Leave blank to use saved method caption…"></textarea>
      </div>
    </div>
  `, `
    <button type="button" class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button type="button" class="zy-btn-blue" id="mv-ap-btn" onclick="zyMvConfirmApprove(${Number(r.id)})"><i class="fas fa-paper-plane"></i> Approve &amp; Send to Chat</button>
  `);
};

window.zyMvConfirmApprove = async function(reqId) {
  const hrs = Math.max(0, parseInt(document.getElementById('mv-ap-hrs')?.value || '0', 10) || 0);
  const mins = Math.max(0, parseInt(document.getElementById('mv-ap-mins')?.value || '0', 10) || 0);
  const totalMinutes = hrs * 60 + mins;
  if (totalMinutes < 1) { toast('Set at least 1 minute timer', 'error'); return; }
  const custom_note = (document.getElementById('mv-ap-note')?.value || '').trim();
  const btn = document.getElementById('mv-ap-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const res = await apiFetch(`/api/method-vault/agent/requests/${Number(reqId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', duration_minutes: totalMinutes, custom_note })
    });
    if (res && res.success) {
      closeModal();
      toast('Approved! Timed Method Video sent to Client Live Chat.', 'success');
      await zyMvLoadOverview();
    } else {
      toast(res?.error || 'Could not approve request', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Approve &amp; Send to Chat'; }
    }
  } catch (err) {
    toast(err.message || 'Could not approve request', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Approve &amp; Send to Chat'; }
  }
};

window.zyMvOpenDeclineModal = function(reqId) {
  const r = ((window._zyMvState.data && window._zyMvState.data.requests) || []).find(x => Number(x.id) === Number(reqId));
  if (!r) return;
  zyModal(`Decline Request — ${zyEsc(r.client_username || 'Client')}`, `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="font-size:12.5px;color:#475569;">Declining <strong>${zyEsc(r.app_name || 'App Method')}</strong> request for <strong>${zyEsc(r.client_username || 'Client')}</strong>.</div>
      <div>
        <label class="zy-lbl">Reason (Optional — shown to Client)</label>
        <input type="text" id="mv-dec-reason" class="zy-input" placeholder="e.g. Complete current range first / Not active today" maxlength="300">
      </div>
    </div>
  `, `
    <button type="button" class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button type="button" class="btn btn-danger btn-sm" id="mv-dec-btn" onclick="zyMvConfirmDecline(${Number(r.id)})"><i class="fas fa-times"></i> Confirm Decline</button>
  `);
};

window.zyMvConfirmDecline = async function(reqId) {
  const reason = (document.getElementById('mv-dec-reason')?.value || '').trim();
  const btn = document.getElementById('mv-dec-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Declining…'; }
  try {
    const res = await apiFetch(`/api/method-vault/agent/requests/${Number(reqId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action: 'decline', reason })
    });
    if (res && res.success) {
      closeModal();
      toast('Request declined.', 'info');
      await zyMvLoadOverview();
    } else {
      toast(res?.error || 'Could not decline request', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-times"></i> Confirm Decline'; }
    }
  } catch (err) {
    toast(err.message || 'Could not decline request', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-times"></i> Confirm Decline'; }
  }
};

window.zyMvOpenDirectSendModal = function(methodId) {
  const m = zyMvFindMethod(methodId);
  const d = window._zyMvState.data || {};
  if (!m) return;
  const clients = Array.isArray(d.clients) ? d.clients : [];
  const groups = Array.isArray(d.groups) ? d.groups : [];
  const defHours = Number(m.default_hours || 24);

  zyModal(`Send Method — ${zyEsc(m.app_name)}`, `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <label class="zy-lbl">Send Destination *</label>
        <div style="display:flex;gap:10px;">
          <label style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:700;">
            <input type="radio" name="mv-send-kind" value="client" checked onchange="zyMvToggleSendDest('client')">
            <i class="fas fa-user" style="color:#0284c7;"></i> Direct Client (${clients.length})
          </label>
          <label style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:700;">
            <input type="radio" name="mv-send-kind" value="group" onchange="zyMvToggleSendDest('group')">
            <i class="fas fa-users" style="color:#7c3aed;"></i> Group / Channel (${groups.length})
          </label>
        </div>
      </div>

      <div id="mv-send-client-wrap">
        <label class="zy-lbl">Select Client *</label>
        <select id="mv-send-client" class="zy-input">
          <option value="">— Choose Client —</option>
          ${clients.map(cl => `<option value="${Number(cl.id)}">${zyEsc(cl.username)}${cl.full_name ? ` (${zyEsc(cl.full_name)})` : ''}</option>`).join('')}
        </select>
      </div>

      <div id="mv-send-group-wrap" style="display:none;">
        <label class="zy-lbl">Select Client Group / Channel *</label>
        <select id="mv-send-conv" class="zy-input">
          <option value="">— Choose Group or Channel —</option>
          ${groups.map(g => `<option value="${Number(g.id)}">${g.type === 'agent_channel' ? '📢 Channel: ' : '👥 Group: '}${zyEsc(g.title)} (${Number(g.member_count || 0)} members)</option>`).join('')}
        </select>
      </div>

      <div>
        <label class="zy-lbl">Quick Timer Presets</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${[
            ['30 min', 30], ['1 hr', 60], ['2 hrs', 120], ['4 hrs', 240], ['12 hrs', 720], ['24 hrs', 1440], ['48 hrs', 2880]
          ].map(([lbl, mins]) => `<button type="button" class="btn btn-outline btn-xs" onclick="zyMvSetTimerPreset('mv-ds-hrs','mv-ds-mins',${mins})">${lbl}</button>`).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label class="zy-lbl">Auto-Hide Hours</label>
          <input type="number" id="mv-ds-hrs" class="zy-input" value="${defHours}" min="0" max="720">
        </div>
        <div>
          <label class="zy-lbl">Extra Minutes</label>
          <input type="number" id="mv-ds-mins" class="zy-input" value="0" min="0" max="59">
        </div>
      </div>

      <div>
        <label class="zy-lbl">Custom Caption / Note (Optional)</label>
        <textarea id="mv-ds-note" class="zy-input" rows="2" placeholder="Leave blank to use saved method caption…"></textarea>
      </div>
    </div>
  `, `
    <button type="button" class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button type="button" class="zy-btn-blue" id="mv-ds-btn" onclick="zyMvSubmitDirectSend(${Number(m.id)})"><i class="fas fa-paper-plane"></i> Send Method Now</button>
  `);
};

window.zyMvToggleSendDest = function(kind) {
  const cWrap = document.getElementById('mv-send-client-wrap');
  const gWrap = document.getElementById('mv-send-group-wrap');
  if (cWrap) cWrap.style.display = kind === 'client' ? '' : 'none';
  if (gWrap) gWrap.style.display = kind === 'group' ? '' : 'none';
};

window.zyMvSubmitDirectSend = async function(methodId) {
  const kind = document.querySelector('input[name="mv-send-kind"]:checked')?.value || 'client';
  const clientId = Number(document.getElementById('mv-send-client')?.value || 0);
  const convId = Number(document.getElementById('mv-send-conv')?.value || 0);
  if (kind === 'client' && !clientId) { toast('Please select a Client', 'error'); return; }
  if (kind === 'group' && !convId) { toast('Please select a Group or Channel', 'error'); return; }

  const hrs = Math.max(0, parseInt(document.getElementById('mv-ds-hrs')?.value || '0', 10) || 0);
  const mins = Math.max(0, parseInt(document.getElementById('mv-ds-mins')?.value || '0', 10) || 0);
  const totalMinutes = hrs * 60 + mins;
  if (totalMinutes < 1) { toast('Set at least 1 minute timer', 'error'); return; }

  const payload = {
    method_id: Number(methodId),
    duration_minutes: totalMinutes,
    custom_note: (document.getElementById('mv-ds-note')?.value || '').trim()
  };
  if (kind === 'client') payload.client_id = clientId;
  else payload.conversation_id = convId;

  const btn = document.getElementById('mv-ds-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const res = await apiFetch('/api/method-vault/agent/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res && res.success) {
      closeModal();
      toast('Timed Method Video sent straight to Live Chat!', 'success');
      await zyMvLoadOverview();
    } else {
      toast(res?.error || 'Could not send method', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Method Now'; }
    }
  } catch (err) {
    toast(err.message || 'Could not send method', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Method Now'; }
  }
};

  const map = {
    'dashboard': () => pgDashboard(),
    'sms-ranges': pgSmsRanges, 'sms-overview': pgSmsRanges, 'sms-ratecard': pgSmsRanges,
    'client-rate-set': pgClientRateSet,
    'my-sms-numbers': pgMySmsNumbers,
    'blocked-numbers': pgBlockedNumbers,
    'assign-to-client': pgMySmsNumbers,
    'transfer-history': pgAgentTransferHistory,
    'allocation-history': () => pgAgentAllocationHistory(true),
    'client-requests': pgClientRequests,
    'news-clients': pgNewsClients, 'notifications': pgNewsClients,
    'live-chat': () => { if (window.HumexLiveChat) window.HumexLiveChat.renderPage('page-content'); },
    'live-access': () => { if (window.zyRenderLiveAccessPage) window.zyRenderLiveAccessPage({ role: 'agent' }); },
    'app-links': () => pgAppLinks(),
    'method-vault': () => pgMethodVault(),
    'my-clients': pgMyClients,
    'bulk-add': pgBulkAdd,
    'audit-logs': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', 'audit'); },
    'profile': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', 'details'); },
    'my-profile': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', 'details'); },
    'profile-security': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', 'security'); },
    '2fa': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', '2fa'); },
    'detailed-sms': () => pgDetailedSms(null),
    'cdr2': pgCdr2,
    'summary-sms': () => pgDetailedSms('date'),
    'client-sms-stats': () => pgDetailedSms('client'),
    'sms-range-stats': () => pgDetailedSms('range'),
    'sms-number-stats': () => pgDetailedSms('number'),
    'credit-notes': pgCreditNotes,
    'payment-requests': pgPaymentRequests, 'my-earnings': pgPaymentRequests, 'bank-accounts': pgBankAccounts,
    'client-payment-requests': () => pgClientPaymentRequests('all'),
    'client-payment-tracker': () => pgClientPaymentTracker(),
    'usd-statements': () => pgStatements('USD'), 'eur-statements': () => pgStatements('EUR'),
    'gbp-statements': () => pgStatements('GBP')
  };
  const prev = loadPage;
  loadPage = function (page) {
    if (page !== 'live-chat' && window.HumexLiveChat) window.HumexLiveChat.unmount();
    if (page !== 'client-payment-tracker' && window.zyCptStopLiveTimer) window.zyCptStopLiveTimer();
    if (map[page]) {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById('nav-' + page)?.classList.add('active');
      const bc = document.getElementById('breadcrumb');
      if (bc && typeof ZY_LABELS !== 'undefined') bc.textContent = ZY_LABELS[page] || bc.textContent || page;
      if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(page);
      if (window.zyCloseSidebar) window.zyCloseSidebar();
      window.scrollTo({ top: 0 });
      try { sessionStorage.setItem('agent_current_page', page); } catch (e) {}
      map[page]();
      return;
    }
    prev(page);
    if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(page);
    if (window.zyCloseSidebar) window.zyCloseSidebar();
  };
})();

