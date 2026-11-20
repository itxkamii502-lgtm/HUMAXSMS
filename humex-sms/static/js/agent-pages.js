/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — AGENT pages. Requires shared-ui-kit.js
   ═══════════════════════════════════════════════════════════════ */

let ZY_RANGES = [], ZY_CLIENTS = [], ZY_NUMROWS = [];

async function zyFillClients(selectId, label) {
  const res = await apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=200`);
  ZY_CLIENTS = zyList(res);
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
  zyCrumb(['SMS Module', 'Ranges & Rate Card']);
  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title" style="font-size:18px;font-weight:800;color:#0f172a;">
          <i class="fas fa-table-list" style="color:#0ea5e9;margin-right:6px;"></i> Ranges &amp; Rate Card
        </div>
        <div class="page-subtitle" style="font-size:12.5px;color:#64748b;">
          Master catalog of available termination ranges, payout rates, and real-time numbers room.
        </div>
      </div>
    </div>
    <div class="apx-card" style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div class="apx-card-body" id="agt-ranges-table-host" style="padding:14px;"><div class="zy-loading">Loading termination ranges…</div></div>
    </div>`;

  try {
    const [rangesRes, myNumsRes, policy] = await Promise.all([
      apiFetch('/api/numbers/sms-ranges').catch(() => []),
      apiFetch(`/api/numbers?agent_id=${AGENT_ID}&limit=100000`).catch(() => ({ total: 0, data: [] })),
      typeof zyFetchAllocPolicy === 'function' ? zyFetchAllocPolicy() : Promise.resolve({ mode: 'request' })
    ]);

    const list = zyList(rangesRes);
    const myNums = zyList(myNumsRes);
    ZY_AGENT_RANGE_LIST = list;
    window._zyAgtPolicy = policy || { mode: 'request' };
    const isSelfAlloc = window._zyAgtPolicy.mode === 'self_allocate';

    const rows = list.map((r, i) => {
      const rName = r.range_name || r.name || r.country || '—';
      const pts = r.payterms || {};
      const weeklyRate = pts['Weekly'] !== undefined ? pts['Weekly'] : (pts['7/3'] !== undefined ? pts['7/3'] : (r.payout ?? 0.01));
      const biweeklyRate = pts['Biweekly'] !== undefined ? pts['Biweekly'] : (pts['15/3'] !== undefined ? pts['15/3'] : weeklyRate);
      const monthlyRate = pts['Monthly'] !== undefined ? pts['Monthly'] : (pts['30/5'] !== undefined ? pts['30/5'] : weeklyRate);
      const curr = r.currency || 'USD';
      const currSym = curr === 'EUR' ? '€' : (curr === 'GBP' ? '£' : '$');
      const clis = r.cli_list || (Array.isArray(r.clis) && r.clis.length ? r.clis.join(', ') : (r.cli || 'All CLIs'));
      const heldCount = myNums.filter(n => {
        const nr = n.range_name || n.name || n.country || '';
        return nr.toLowerCase() === rName.toLowerCase();
      }).length;
      const roomCount = Math.max(0, (r.available != null ? r.available : (r.free_count ?? 1500)));
      const ptBadge = typeof zyPaytermBadge === 'function'
        ? zyPaytermBadge(r.payterm || 'Weekly')
        : `<span class="badge badge-purple" style="font-size:10.5px;">${zyEsc(r.payterm || 'Weekly')}</span>`;

      return [
        `<div style="min-width:130px;"><strong style="color:#0f172a;">${i + 1}. ${zyEsc(rName)}</strong><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px;font-size:11px;color:#64748b;"><span>${zyEsc(r.provider || 'Direct')}</span><span>·</span><b>${zyEsc(curr)}</b><span>·</span>${r.active !== false ? '<span style="color:#10b981;font-weight:700;">Active</span>' : '<span style="color:#ef4444;font-weight:700;">Inactive</span>'}</div></div>`,
        `<span class="monospace" style="font-weight:700;color:#2563eb;">${zyEsc(r.prefix || '—')}</span>`,
        { v: r.payterm || 'Weekly', h: ptBadge },
        `<span style="font-family:monospace;font-weight:700;color:#16a34a;">${currSym} ${zyFmtMoney(Number(weeklyRate), 4)}</span>`,
        `<span style="font-family:monospace;font-weight:700;color:#d97706;">${currSym} ${zyFmtMoney(Number(biweeklyRate), 4)}</span>`,
        `<span style="font-family:monospace;font-weight:700;color:#9333ea;">${currSym} ${zyFmtMoney(Number(monthlyRate), 4)}</span>`,
        `<span style="font-family:monospace;font-size:11.5px;"><b>${heldCount}</b> / <span style="color:#10b981;font-weight:700;">${roomCount.toLocaleString()}</span></span>`,
        { v: '', h: `<div style="display:inline-flex;align-items:center;gap:4px;">
          <button type="button" class="apx-btn apx-btn-icon apx-btn-small" style="color:#0284c7;border-color:#bae6fd;background:#f0f9ff;" onclick="zyViewAgentRange(${i})" title="View Details"><i class="fas fa-eye"></i></button>
          ${isSelfAlloc
            ? `<button type="button" class="apx-btn apx-btn-small" style="color:#059669;border-color:#a7f3d0;background:#ecfdf5;" onclick="zyOpenSelfAllocateModal('${zyEsc(rName)}', ${r.id || 'null'}, window._zyAgtPolicy, pgSmsRanges)" title="Self-Allocate Numbers"><i class="fas fa-bolt"></i> Self-Allocate</button>`
            : `<button type="button" class="apx-btn apx-btn-small" style="color:#2563eb;border-color:#bfdbfe;background:#eff6ff;" onclick="zyOpenRequestNumbersModal('${zyEsc(rName)}', ${r.id || 'null'}, window._zyAgtPolicy, pgSmsRanges)" title="Request Numbers"><i class="fas fa-phone-volume"></i> Request</button>`}
        </div>` }
      ];
    });

    const host = document.getElementById('agt-ranges-table-host');
    if (host) {
      host.innerHTML = zyDT2('dt-ranges', {
        cols: ['Range & Provider', 'Prefix', 'Payterm', 'Weekly (7/3)', 'Biweekly (15/3)', 'Monthly (30/5) {W}', 'Held / Room', 'Actions'],
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
  const weeklyVal = pts['Weekly'] !== undefined ? pts['Weekly'] : (pts['7/3'] !== undefined ? pts['7/3'] : (r.payout ?? 0.01));
  const biweeklyVal = pts['Biweekly'] !== undefined ? pts['Biweekly'] : (pts['15/3'] !== undefined ? pts['15/3'] : weeklyVal);
  const monthlyVal = pts['Monthly'] !== undefined ? pts['Monthly'] : (pts['30/5'] !== undefined ? pts['30/5'] : weeklyVal);
  const curr = r.currency || 'USD';
  const currSym = curr === 'EUR' ? '€' : (curr === 'GBP' ? '£' : '$');
  const clis = r.cli_list || (Array.isArray(r.clis) && r.clis.length ? r.clis.join(', ') : (r.cli || 'All CLIs'));
  const roomCount = Math.max(0, (r.available != null ? r.available : (r.free_count ?? 1500)));
  const ptBadge = typeof zyPaytermBadge === 'function'
    ? zyPaytermBadge(r.payterm || 'Weekly')
    : `<b class="badge badge-purple" style="font-size:10.5px;">${zyEsc(r.payterm || 'Weekly')}</b>`;

  zyModal(`Range Specification: ${zyEsc(rName)}`, `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;margin-bottom:12px;">
      <!-- Col 1: General Info -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-tower-broadcast" style="color:#0284c7;margin-right:4px;"></i> General Info
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Provider:</span> <b>${zyEsc(r.provider || 'Direct')}</b></div>
          <div><span style="color:#64748b;">Range Name:</span> <b>${zyEsc(rName)}</b></div>
          <div><span style="color:#64748b;">Country:</span> <b>${zyEsc(r.country || '—')}</b></div>
          <div><span style="color:#64748b;">Prefix:</span> <b class="monospace" style="color:#2563eb;">${zyEsc(r.prefix || '—')}</b></div>
          <div><span style="color:#64748b;">Currency:</span> <b>${zyEsc(curr)}</b></div>
          <div><span style="color:#64748b;">Default Payterm:</span> ${ptBadge}</div>
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
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:5px 0;">Weekly (7/3) · 3d Hold</td><td style="text-align:right;font-weight:700;color:#16a34a;font-family:monospace;">${currSym} ${zyFmtMoney(Number(weeklyVal), 4)}</td></tr>
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:5px 0;">Biweekly (15/3) · 3d Hold</td><td style="text-align:right;font-weight:700;color:#d97706;font-family:monospace;">${currSym} ${zyFmtMoney(Number(biweeklyVal), 4)}</td></tr>
            <tr><td style="padding:5px 0;">Monthly (30/5) {W} · 5d Hold</td><td style="text-align:right;font-weight:700;color:#9333ea;font-family:monospace;">${currSym} ${zyFmtMoney(Number(monthlyVal), 4)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>`,
     `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
     ${(window._zyAgtPolicy && window._zyAgtPolicy.mode === 'self_allocate')
       ? `<button class="zy-btn-blue" onclick="closeModal();zyOpenSelfAllocateModal('${zyEsc(rName)}', ${r.id || 'null'}, window._zyAgtPolicy, pgSmsRanges)"><i class="fas fa-bolt"></i> Self-Allocate Numbers</button>`
       : `<button class="zy-btn-blue" onclick="closeModal();zyOpenRequestNumbersModal('${zyEsc(rName)}', ${r.id || 'null'}, window._zyAgtPolicy, pgSmsRanges)"><i class="fas fa-phone-volume"></i> Request Numbers</button>`}`);
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
    <div id="crs-top-cards" style="margin-bottom:16px;"><div class="zy-loading">Loading metric summaries…</div></div>
    <div class="apx-card" style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div class="zy-crs-toolbar">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:13px;color:#1e293b;margin-right:4px;">
            <i class="fas fa-table-list" style="color:#0ea5e9;margin-right:4px;"></i> Termination Ranges (PKR Client Rates)
          </span>
          <div class="zy-crs-tabs" id="crs-filter-tabs">
            <button type="button" class="zy-crs-tab active" data-filter="all" onclick="zyCrsSetFilter('all')">All</button>
            <button type="button" class="zy-crs-tab" data-filter="pending" onclick="zyCrsSetFilter('pending')">Pending Setup</button>
            <button type="button" class="zy-crs-tab" data-filter="configured" onclick="zyCrsSetFilter('configured')">Published</button>
          </div>
          <input type="text" id="crs-search" class="zy-input" style="height:34px;width:220px;" placeholder="Search range, prefix, country…" oninput="zyCrsSetSearch(this.value)">
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

    if (fxEl) {
      fxEl.innerHTML = `Active FX (Owner): <strong class="zy-crs-num" style="color:var(--sp-text-primary);">1 USD = Rs. ${window._zyCrsState.fx.toLocaleString(undefined, { maximumFractionDigits: 2 })} PKR</strong>`;
    }

    zyCrsRenderTopCards();
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

function zyCrsRenderTopCards() {
  const el = document.getElementById('crs-top-cards');
  if (!el) return;
  const st = window._zyCrsState;
  const totalRanges = (st.ranges || []).length;
  const publishedRanges = (st.ranges || []).filter(r => r.configured && Number(r.client_rate_pkr) > 0);
  const avgPkr = publishedRanges.length
    ? (publishedRanges.reduce((s, r) => s + Number(r.client_rate_pkr || 0), 0) / publishedRanges.length)
    : 0;
  const totalPool = (st.ranges || []).reduce((s, r) => s + Number(r.pool_available || 0), 0);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(170px, 1fr));gap:10px;">
      <div style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:8px;padding:10px 14px;box-shadow:0 1px 2px rgba(0,0,0,0.03);">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Total Ranges</div>
        <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:#0f172a;margin-top:2px;">${totalRanges}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">${totalPool.toLocaleString()} Numbers in Pool</div>
      </div>
      <div style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:8px;padding:10px 14px;box-shadow:0 1px 2px rgba(0,0,0,0.03);">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Published to Clients</div>
        <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:#059669;margin-top:2px;">${st.configured_count || 0}</div>
        <div style="font-size:11px;color:#059669;margin-top:2px;">Visible on Client Rate Card</div>
      </div>
      <div style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:8px;padding:10px 14px;box-shadow:0 1px 2px rgba(0,0,0,0.03);">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Pending Setup</div>
        <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:${(st.pending_count || 0) > 0 ? '#d97706' : '#64748b'};margin-top:2px;">${st.pending_count || 0}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">Hidden until PKR Rate Set</div>
      </div>
      <div style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:8px;padding:10px 14px;box-shadow:0 1px 2px rgba(0,0,0,0.03);">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Avg Client Rate (PKR)</div>
        <div class="zy-crs-num" style="font-size:20px;font-weight:800;color:#2563eb;margin-top:2px;">Rs. ${zyFmtMoney(avgPkr, 2)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">FX: 1 USD = Rs. ${zyFmtMoney(Number(st.fx || 280), 2)}</div>
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
  return dirty || {
    client_rate_pkr: r.client_rate_pkr != null ? String(r.client_rate_pkr) : '',
    allowed_quantities: Array.isArray(r.allowed_quantities) && r.allowed_quantities.length ? r.allowed_quantities.slice() : [25, 50],
    daily_request_limit: Number(r.daily_request_limit || 1)
  };
}

function zyCrsEnsureDirty(rangeId) {
  const st = window._zyCrsState;
  if (!st.dirty[rangeId]) {
    const base = (st.ranges || []).find(x => Number(x.range_id) === Number(rangeId));
    if (!base) return null;
    st.dirty[rangeId] = {
      client_rate_pkr: base.client_rate_pkr != null ? String(base.client_rate_pkr) : '',
      allowed_quantities: Array.isArray(base.allowed_quantities) && base.allowed_quantities.length ? base.allowed_quantities.slice() : [25, 50],
      daily_request_limit: Number(base.daily_request_limit || 1)
    };
  }
  return st.dirty[rangeId];
}

function zyCrsFormatMarginHtml(agentPkr, valStr) {
  const v = parseFloat(valStr);
  if (valStr === '' || isNaN(v)) {
    return `<span style="color:var(--sp-text-muted);font-size:12px;">Not set</span>`;
  }
  if (v <= 0) {
    return `<span style="color:var(--sp-danger);font-size:12px;font-weight:700;">Must be &gt; 0</span>`;
  }
  if (agentPkr > 0 && v >= agentPkr) {
    return `<span style="color:var(--sp-danger);font-size:12px;font-weight:700;">Exceeds max (&lt; Rs. ${zyFmtMoney(agentPkr, 4)})</span>`;
  }
  if (agentPkr <= 0) {
    return `<span class="zy-crs-num" style="color:var(--sp-text-secondary);font-size:12px;">Set</span>`;
  }
  const margin = agentPkr - v;
  const pct = (margin / agentPkr) * 100;
  return `<div class="zy-crs-num" style="color:var(--sp-success);font-weight:700;font-size:12.5px;">+Rs. ${zyFmtMoney(margin, 2)}</div>
          <div class="zy-crs-num" style="color:var(--sp-text-muted);font-size:11px;">${pct.toFixed(1)}% margin</div>`;
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

window.zyCrsToggleQty = function(rangeId, qty, checked) {
  const draft = zyCrsEnsureDirty(rangeId);
  if (!draft) return;
  const set = new Set(draft.allowed_quantities || [25, 50]);
  if (checked) set.add(qty);
  else set.delete(qty);
  if (set.size === 0) set.add(qty);
  draft.allowed_quantities = Array.from(set).sort((a, b) => a - b);
  zyCrsSyncSaveAllBtn();
};

window.zyCrsOnLimitInput = function(rangeId, val) {
  const draft = zyCrsEnsureDirty(rangeId);
  if (!draft) return;
  draft.daily_request_limit = Math.max(1, parseInt(val, 10) || 1);
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
      String(r.range_name || '').toLowerCase().includes(st.search) ||
      String(r.country || '').toLowerCase().includes(st.search) ||
      String(r.prefix || '').toLowerCase().includes(st.search)
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
            <th>Range &amp; Prefix</th>
            <th style="text-align:right;">Agent Payout</th>
            <th>Client Rate (PKR)</th>
            <th style="text-align:right;">Your Profit</th>
            <th>Batch Sizes</th>
            <th>Daily Limit</th>
            <th>Rate Card</th>
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
            const qtys = Array.isArray(draft.allowed_quantities) ? draft.allowed_quantities : [25, 50];
            const statusText = r.configured
              ? `<span style="color:var(--sp-success);font-weight:700;font-size:12px;">Published</span>`
              : `<span style="color:#d97706;font-weight:700;font-size:12px;">Pending Setup</span>`;
            return `
              <tr class="${!r.configured ? 'zy-crs-row-pending' : ''}">
                <td>
                  <div style="font-weight:700;color:var(--sp-text-primary);">${zyEsc(r.range_name)}</div>
                  <div style="font-size:11.5px;color:var(--sp-text-muted);">
                    ${zyEsc(r.country || 'Global')} · <span class="zy-crs-num">${zyEsc(r.prefix || '—')}</span> · Pool: <strong>${Number(r.pool_available || 0)}</strong>
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
                  <div id="crs-usdeq-${r.range_id}" class="zy-crs-num" style="font-size:11px;color:var(--sp-text-muted);margin-top:3px;">${usdEqText}</div>
                </td>
                <td style="text-align:right;" id="crs-margin-${r.range_id}">
                  ${zyCrsFormatMarginHtml(agentPkr, draft.client_rate_pkr)}
                </td>
                <td>
                  <div style="display:flex;align-items:center;gap:10px;font-size:12px;">
                    <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
                      <input type="checkbox" ${qtys.includes(25) ? 'checked' : ''} onchange="zyCrsToggleQty(${Number(r.range_id)}, 25, this.checked)"> 25
                    </label>
                    <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
                      <input type="checkbox" ${qtys.includes(50) ? 'checked' : ''} onchange="zyCrsToggleQty(${Number(r.range_id)}, 50, this.checked)"> 50
                    </label>
                  </div>
                </td>
                <td>
                  <input type="number" class="zy-input zy-crs-num" min="1" max="20" style="width:62px;height:32px;padding:0 6px;"
                         value="${Number(draft.daily_request_limit || 1)}"
                         oninput="zyCrsOnLimitInput(${Number(r.range_id)}, this.value)">
                </td>
                <td>
                  ${statusText}
                  ${(r.is_whitenoise || String(r.provider || '').toLowerCase().includes('whitenoise') || String(r.payout_schedule || '').toLowerCase() === 'monthly30_5')
                    ? `<div><span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;font-size:10px;font-weight:700;">Monthly (30/5) {W}</span></div>`
                    : `<div style="font-size:11px;color:var(--sp-text-muted);">${typeof zyPaytermBadge === 'function' ? zyPaytermBadge(r.payterm || 'Weekly') : zyEsc(r.payterm || 'Weekly')}</div>`}
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <div style="display:inline-flex;align-items:center;gap:6px;">
                    <button type="button" class="apx-btn apx-btn-icon apx-btn-small" style="color:#0284c7;border-color:#bae6fd;background:#f0f9ff;" onclick="zyCrsViewRangeSpec(${Number(r.range_id)})" title="View Range Specification"><i class="fas fa-eye"></i></button>
                    <button type="button" class="btn btn-primary btn-xs" onclick="zyCrsSaveRow(${Number(r.range_id)})">
                      <i class="fas fa-check"></i> Save
                    </button>
                    ${r.configured ? `<button type="button" class="btn btn-outline btn-xs" onclick="zyCrsUnpublishRow(${Number(r.range_id)})" title="Hide from Client Rate Card">Hide</button>` : ''}
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
  const agentUsd = Number(r.agent_rate_usd || 0);
  const agentPkr = Number(r.agent_rate_pkr || 0);
  const draft = zyCrsGetRowDraft(r);
  const clPkr = Number(draft.client_rate_pkr || r.client_rate_pkr || 0);
  const qtys = Array.isArray(draft.allowed_quantities) && draft.allowed_quantities.length ? draft.allowed_quantities : [25, 50];

  zyModal(`Range Specification: ${zyEsc(r.range_name)}`, `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;margin-bottom:12px;">
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-tower-broadcast" style="color:#0284c7;margin-right:4px;"></i> General Info
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Range Name:</span> <b>${zyEsc(r.range_name)}</b></div>
          <div><span style="color:#64748b;">Country:</span> <b>${zyEsc(r.country || '—')}</b></div>
          <div><span style="color:#64748b;">Prefix:</span> <b class="monospace" style="color:#2563eb;">${zyEsc(r.prefix || '—')}</b></div>
          <div><span style="color:#64748b;">Default Payterm:</span> <b class="badge badge-purple" style="font-size:10.5px;">${zyEsc(r.payterm || 'Weekly')}</b></div>
          <div><span style="color:#64748b;">Active FX:</span> <b class="monospace">1 USD = Rs. ${zyFmtMoney(fx, 2)}</b></div>
        </div>
      </div>

      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-sliders" style="color:#10b981;margin-right:4px;"></i> Client Quota &amp; Routing
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Client Rate Card:</span> ${r.configured ? '<span class="badge badge-green">Published</span>' : '<span class="badge badge-yellow">Pending Setup</span>'}</div>
          <div><span style="color:#64748b;">Batch Sizes:</span> <b>${zyEsc(qtys.join(' / '))} numbers</b></div>
          <div><span style="color:#64748b;">Daily Limit:</span> <b>${Number(draft.daily_request_limit || 1)} request / day</b></div>
          <div><span style="color:#64748b;">Max SMS / Day:</span> <b>${r.max_sms_day != null ? r.max_sms_day : 'Unlimited'}</b></div>
          <div><span style="color:#64748b;">Pool Ready:</span> <b style="color:#10b981;">${Number(r.pool_available || 0).toLocaleString()} numbers</b></div>
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
            <tr><td style="padding:4px 0;">Weekly (7/3 USD)</td><td style="text-align:right;font-family:monospace;">$${zyFmtMoney(Number(pts['Weekly'] ?? pts['7/3'] ?? agentUsd), 4)}</td></tr>
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
  const res = await apiFetch('/api/agent/client-rates', {
    method: 'PUT',
    body: JSON.stringify({
      range_id: Number(rangeId),
      client_rate_pkr: pkr,
      allowed_quantities: draft.allowed_quantities,
      daily_request_limit: draft.daily_request_limit,
      published: true
    })
  });
  if (res && res.success) {
    delete st.dirty[rangeId];
    toast(`Saved Client PKR rate for ${r.range_name}`, 'success');
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
    items.push({
      range_id: rid,
      client_rate_pkr: pkr,
      allowed_quantities: d.allowed_quantities,
      daily_request_limit: d.daily_request_limit,
      published: true
    });
  }
  const res = await apiFetch('/api/agent/client-rates', {
    method: 'PUT',
    body: JSON.stringify({ items })
  });
  if (res && res.success) {
    st.dirty = {};
    toast(`Saved ${res.saved_count || items.length} client rate(s)`, 'success');
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
  const val = parseFloat(document.getElementById('crs-target-val')?.value);
  const mode = document.getElementById('crs-target-mode')?.value === 'block' ? 'block' : 'warn';
  if (isNaN(val) || val < 0) {
    toast('Enter 0 or a positive Weekly PKR Target amount', 'error');
    return;
  }
  const btn = document.getElementById('crs-save-target-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const res = await apiFetch('/api/agent/pkr-target', {
    method: 'PUT',
    body: JSON.stringify({ weekly_pkr_target: val, weekly_pkr_enforce_mode: mode })
  });
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Save Target'; }
  if (res && res.success) {
    toast('Weekly Client PKR target updated', 'success');
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
  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-hashtag" style="color:#2563eb;"></i> My SMS Numbers</div>
        <div class="page-subtitle">Numbers assigned to your account. Allocate to clients, return to pool or move. (Weekly 7/3 · Biweekly 15/3 · Monthly 30/5 {W})</div>
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
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <button type="button" class="zy-act zy-act-blue zy-act-wide" onclick="zyActionMove()" title="Move number directly from Client A to Client B"><i class="fas fa-right-left" style="margin-right:4px;"></i> Move</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="loadPage('transfer-history')" title="View Transfer History"><i class="fas fa-clock-rotate-left"></i> Transfer History</button>
        </div>
      </div>
      <div class="zy-panel-body" style="padding:14px;"><div class="zy-loading">Loading numbers…</div></div>
    </div>
    ${typeof zyRenderFab === 'function' ? zyRenderFab('Need numbers? Tap here', 'zyActionAllocate()') : ''}`;


  const [nums, ranges, clientsRes, crsRes] = await Promise.all([
    apiFetch(`/api/numbers?agent_id=${AGENT_ID}&limit=100000`),
    apiFetch('/api/numbers/sms-ranges').catch(() => []),
    apiFetch(`/api/clients?agent_id=${AGENT_ID}&limit=500`).catch(() => ({ data: [] })),
    zyFetchAgentClientRates(true).catch(() => null)
  ]);

  if (crsRes && Array.isArray(crsRes.ranges)) {
    window._zyAgentClientRatesCache = crsRes;
  }
  ZY_ALL_NUMS = zyList(nums);
  ZY_RANGES = zyList(ranges);
  ZY_CLIENTS = zyList(clientsRes);

  ZY_RANGES_LOOKUP = {};
  ZY_RANGES.forEach(r => {
    if (r.id) ZY_RANGES_LOOKUP[r.id] = r;
    if (r.range_name) ZY_RANGES_LOOKUP[r.range_name] = r;
    if (r.name) ZY_RANGES_LOOKUP[r.name] = r;
    if (r.country && r.provider) ZY_RANGES_LOOKUP[`${r.country}|${r.provider}`] = r;
  });

  // Populate Range dropdown
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
    rangeSel.innerHTML = '<option value="">All Ranges</option>' +
      uniqueRanges.map(r => `<option value="${zyEsc(r.name)}">${zyEsc(r.name)}</option>`).join('');
  }

  // Populate Client dropdown
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
  return Boolean(
    obj.is_whitenoise ||
    String(obj.provider || '').toLowerCase().includes('whitenoise') ||
    String(obj.payout_schedule || '').toLowerCase() === 'monthly30_5'
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
    const statusDisplay = `<span style="display:inline-flex;align-items:center;gap:4px;color:#10b981;font-weight:600;"><i class="fas fa-check-circle" style="color:#10b981;"></i> Active</span>`;
    const actionDisplay = isWn
      ? `<button type="button" class="apx-btn apx-btn-small" style="color:#4338ca;border-color:#c7d2fe;background:#eef2ff;font-weight:700;" onclick="zyAgentFetchWhitenoiseOtp(${Number(n.id)}, this)" title="Fetch live OTP"><i class="fas fa-bolt"></i> Fetch OTP</button>`
      : `<span style="color:#94a3b8;font-size:11px;">—</span>`;

    const numberHtml = typeof zyRenderNumberCopyBox === 'function'
      ? zyRenderNumberCopyBox(cleanNumber)
      : `<span style="font-family:monospace;font-weight:600;color:var(--brand-primary,#166534);">${zyEsc(cleanNumber)}</span>`;

    const r = [
      dateCell,
      { v: rangeName, h: `<span style="font-weight:600;">${zyEsc(rangeName)}</span>` },
      { v: cleanPrefix, h: cleanPrefix || '—' },
      { v: cleanNumber, h: numberHtml },
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
      if (!numStr.startsWith(startsWith)) return false;
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
      <select id="alloc-client-payterm" class="zy-input" style="width:100%;height:34px;" onchange="zyOnAllocPaytermChange()" ${hasWn ? 'disabled' : ''}>
        ${hasWn
          ? `<option value="Monthly" selected>Monthly (30/5) {W} — 5d Hold (Locked)</option>`
          : `<option value="Weekly" selected>Weekly (7/3) — 3 Day Hold</option>
             <option value="Biweekly">Biweekly (15/3) — 3 Day Hold</option>
             <option value="Monthly">Monthly (30/5) {W} — 5 Day Hold</option>`}
      </select>
      ${hasWn ? `<small style="display:block;margin-top:4px;color:#4338ca;font-weight:600;font-size:11px;">Monthly (30/5) {W} routes are locked to 5 day hold.</small>` : ''}
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
  if (!confirm(`Unallocate ${assigned.length} number(s) back to your agent pool?`)) return;

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
  if (!confirm(`Return ${selected.length} number(s) to your upstream holder?`)) return;

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
    const actionHtml = `
      <div style="display:inline-flex;align-items:center;gap:5px;">
        <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyViewClientDetails(${x.id})" title="View Details" style="color:#0284c7;border-color:#bae6fd;background:#f0f9ff;"><i class="fas fa-eye"></i></button>
        <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyEditClientModal(${x.id})" title="Edit Client" style="color:#059669;border-color:#a7f3d0;background:#ecfdf5;"><i class="fas fa-pen"></i></button>
        <button type="button" class="apx-btn apx-btn-icon apx-btn-small" onclick="zyToggleClientStatus(${x.id},'${x.status || 'active'}')" title="${isAct ? 'Deactivate Client' : 'Activate Client'}" style="color:${isAct ? '#d97706' : '#16a34a'};border-color:${isAct ? '#fde68a' : '#bbf7d0'};background:${isAct ? '#fffbeb' : '#f0fdf4'};">
          <i class="fas fa-${isAct ? 'pause' : 'play'}"></i>
        </button>
      </div>`;
    const r = [
      `<b>${zyEsc(x.username || '')}</b>${hasWnBadge}`,
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
      cols: ['Username', 'Name', 'Email', 'Contact', 'Skype', 'Status', 'Actions'], rows, check: true });
    zy2Render('dt-clients');
  }
}

function zyAddClientModal() {
  const wnToggle = window.ZY_WHITENOISE_ACCESS ? `
    <div style="margin-top:10px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 12px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;font-weight:700;color:#312e81;">
        <input type="checkbox" id="nc-wn-access">
        <span>Allow Monthly Route Access (CDR 2 &amp; Monthly 30/5 {W})</span>
      </label>
    </div>` : '';
  zyModal('Add New Client', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
      <div><label class="zy-lbl">Username *</label><input class="zy-input" id="nc-user" placeholder="Minimum 6 Characters" autocomplete="off"></div>
      <div><label class="zy-lbl">Password *</label><input class="zy-input" id="nc-pass" type="password" placeholder="Minimum 6 Characters" autocomplete="new-password"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
      <div><label class="zy-lbl">Full Name</label><input class="zy-input" id="nc-name" placeholder="Client Name"></div>
      <div><label class="zy-lbl">Email</label><input class="zy-input" id="nc-mail" type="email" placeholder="client@example.com"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px;">
      <div><label class="zy-lbl">Contact No.</label><input class="zy-input" id="nc-phone" placeholder="+44..."></div>
      <div><label class="zy-lbl">Skype ID</label><input class="zy-input" id="nc-skype" placeholder="Skype ID"></div>
    </div>
    ${wnToggle}`,
    `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
     <button class="zy-btn-blue" onclick="zySaveClient()"><i class="fas fa-user-plus" style="margin-right:4px;"></i> Create Client</button>`);
}

async function zySaveClient() {
  const wnEl = document.getElementById('nc-wn-access');
  const p = {
    username: document.getElementById('nc-user').value.trim(),
    password: document.getElementById('nc-pass').value,
    email: document.getElementById('nc-mail').value.trim(),
    skype_id: document.getElementById('nc-skype').value.trim(),
    contact_no: document.getElementById('nc-phone').value.trim(),
    full_name: document.getElementById('nc-name').value.trim(),
    agent_id: AGENT_ID
  };
  if (wnEl) p.whitenoise_access = Boolean(wnEl.checked);
  if (p.username.length < 6 || p.password.length < 6) { toast('Username and password need 6+ characters', 'error'); return; }
  const r = await apiFetch('/api/clients', { method: 'POST', body: JSON.stringify(p) });
  if (r && r.id) { closeModal(); zyFlash('Client Added.'); loadPage('my-clients'); }
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
  zyModal(`Edit Client — ${zyEsc(c.username)}`, `
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
    ${allocBlock}
  `,
  `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
   <button class="zy-btn-blue" onclick="zySaveEditClient(${id})">Save Changes</button>`);
};

window.zySaveEditClient = async function(id) {
  const p = {
    full_name: document.getElementById('ec-name').value.trim(),
    email: document.getElementById('ec-mail').value.trim(),
    skype_id: document.getElementById('ec-skype').value.trim(),
    phone: document.getElementById('ec-phone').value.trim()
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
  const line = (k, v) => `<div style="font-weight:700;font-size:11.5px;color:#64748b;margin-top:8px;text-transform:uppercase;letter-spacing:0.3px;">${k}</div><div style="font-size:13px;color:#0f172a;margin-bottom:4px;font-weight:500;">${zyEsc(String(v ?? '—'))}</div>`;
  zyModal(`Client Details — ${zyEsc(u.username)}`,
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">` +
    line('Username', u.username) +
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
  zyCrumb(['SMS CDR Reports']);

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
      const rows = data.map(g => [
        ...checkedBoxes.map(k => (k === 'client' || k === 'agent') ? (g[k] || '') : (g[k] || '—')),
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
        const maskedCli = zyMaskCli(s.cli || s.app || '—');
        const smsCellHtml = typeof zyRenderSmsCell === 'function' ? zyRenderSmsCell(s.message || '') : `<div class="zy-sms-cell">${zyEsc(s.message || '')}</div>`;
        const clName = cleanOrg(s.client || s.client_username || s.client_name || s.user);
        const numStr = String(s.number || '').trim();

        return [
          dtCell,
          zyEsc(s.provider || '—'),
          zyEsc(s.range_name || s.range_label || s.range || (s.country || '—')),
          { v: numStr, h: numStr ? `<span class="monospace" style="font-weight:600;">${zyEsc(numStr)}</span>` : '—' },
          { v: s.cli || '—', h: `<span class="monospace">${zyEsc(maskedCli)}</span>` },
          { v: s.message || '', h: smsCellHtml },
          { v: clName, h: clName ? zyEsc(clName) : '' },
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
  zyCrumb(['SMS & Analytics', 'CDR 2 (Monthly)']);

  try {
    const me = await apiFetch('/api/auth/me', { silent: true });
    if (typeof window.zyRefreshWhitenoiseNav === 'function') window.zyRefreshWhitenoiseNav(me);
    if (!me || !me.whitenoise_access) {
      c.innerHTML = `
        <div class="zy-panel" style="border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:42px 24px;text-align:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:#fef2f2;color:#ef4444;display:inline-flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:12px;">
            <i class="fas fa-lock"></i>
          </div>
          <h3 style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">CDR 2 Access Not Enabled</h3>
          <p style="max-width:460px;margin:0 auto;font-size:13px;color:#64748b;line-height:1.5;">
            Your Agent account does not currently have CDR 2 (Monthly 30/5 {W}) permission enabled. Contact Owner to enable CDR 2 Access for your account.
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
        <div class="page-title"><i class="fas fa-chart-column" style="color:#2563eb;"></i> CDR 2 — Monthly Route Stats</div>
        <div class="page-subtitle">Monthly (30/5) {W} · 5-day hold · Updated daily from official company stats report</div>
      </div>
      <div>
        <button type="button" class="btn btn-outline btn-sm" onclick="zyAgentExportCdr2Report()"><i class="fas fa-download"></i> Export CSV</button>
      </div>
    </div>

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

  const ranges = zyList(await apiFetch('/api/numbers/sms-ranges').catch(() => []))
    .filter(r => zyIsWhitenoiseObj(r));
  const rEl = document.getElementById('cdr2-range');
  if (rEl) {
    rEl.innerHTML = `<option value="">All Monthly Ranges</option>` +
      ranges.map(r => `<option value="${r.id}">${zyEsc(r.range_name || r.name || r.country || '')}${r.prefix ? ` (${zyEsc(r.prefix)})` : ''}</option>`).join('');
  }
  await zyFillClients('cdr2-client', 'All');
  zyAgentCdr2Load(1);
}

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
        ...checkedBoxes.map(k => (k === 'client' ? (g[k] || 'Pool') : (g[k] || '—'))),
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
        const maskedCli = zyMaskCli(s.cli || s.service || s.app || 'General');
        const clName = s.client || s.client_username || s.client_name || '';
        const numStr = String(s.number || '').trim();
        const clearLabel = s.clears_at ? `Clears ${String(s.clears_at).slice(0, 10)}` : 'Monthly (30/5) {W}';

        return [
          { v: dStr, h: `<span class="monospace" style="font-weight:600;">${zyEsc(dStr)}</span>` },
          zyEsc(s.range_name || s.range_label || s.range || s.country || '—'),
          { v: numStr, h: numStr ? `<span class="monospace" style="font-weight:600;">${zyEsc(numStr)}</span>` : '—' },
          { v: maskedCli, h: `<span class="monospace">${zyEsc(maskedCli)}</span>` },
          clName ? zyEsc(clName) : '<span style="color:#94a3b8;">Agent Pool</span>',
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

  let wnNoticeHtml = '';
  let holdNoticeHtml = '';
  try {
    const [earn, settings, payInfo] = await Promise.all([
      apiFetch(`/api/agent/${AGENT_ID}/earnings`),
      apiFetch('/api/settings').catch(() => ({})),
      apiFetch('/api/payments', { silent: true }).catch(() => null)
    ]);
    balUsd = Number(earn?.main_balance ?? earn?.balance ?? 0);
    thisWeekUsd = Number(earn?.this_week ?? 0);
    if (earn?.week_range) weekRangeStr = earn.week_range;
    if (settings?.min_payout != null) minPayout = Number(settings.min_payout);
    if (payInfo && payInfo.hold_summary) {
      const hs = payInfo.hold_summary;
      holdNoticeHtml = `
        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#1e293b;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <span><i class="fas fa-hourglass-half" style="color:#d97706;margin-right:6px;"></i> <b>Payout Hold Status:</b> Cleared <b>$${zyFmtMoney(Number(hs.cleared_usd || 0), 4)}</b> · On Hold <b>$${zyFmtMoney(Number(hs.held_usd || 0), 4)}</b>${hs.next_release_date ? ` · Next release: <b>${zyEsc(hs.next_release_date)}</b>` : ''}</span>
          <span style="font-size:11px;color:#475569;font-weight:600;">Weekly (7/3) 3d Hold · Biweekly (15/3) 3d Hold · Monthly (30/5) {W} 5d Hold</span>
        </div>`;
    }
    if (payInfo && (payInfo.whitenoise_access || window.ZY_WHITENOISE_ACCESS) && payInfo.monthly30_5) {
      const wn = payInfo.monthly30_5;
      const mc = payInfo.monthly_cycle || {};
      const cycleStart = wn.cycle_start || mc.start_date || '—';
      const cycleEnd = wn.cycle_end || mc.end_date || '—';
      const clearDate = wn.clear_date || mc.clear_date || wn.next_release_date || '—';
      wnNoticeHtml = `
        <div style="background:linear-gradient(135deg,#eef2ff,#f8fafc);border:1.5px solid #c7d2fe;border-radius:10px;padding:12px 14px;margin-bottom:14px;color:#1e1b4b;">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:800;color:#312e81;">
              <i class="fas fa-calendar-check" style="color:#4f46e5;margin-right:6px;"></i> Monthly Cycle (30/5) {W} Settlement Box
            </span>
            <span class="badge" style="background:#fff;color:#4338ca;border:1px solid #c7d2fe;font-weight:700;">Cycle: ${zyEsc(cycleStart)} → ${zyEsc(cycleEnd)}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;font-size:12px;">
            <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
              <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">Cleared (USD)</div>
              <div style="font-size:15px;font-weight:800;color:#059669;margin-top:2px;">$${zyFmtMoney(Number(wn.cleared_usd || 0), 4)}</div>
            </div>
            <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
              <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">On Hold (5d Hold)</div>
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
          <div style="font-size:11px;color:#4338ca;margin-top:8px;">All CDR 2 Monthly (30/5) {W} earnings within the active cycle (${zyEsc(cycleStart)} to ${zyEsc(cycleEnd)}) clear together on <b>${zyEsc(clearDate)}</b>.</div>
        </div>`;
    }
  } catch (e) { console.warn('Payment requests earnings fetch error:', e); }

  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title"><i class="fas fa-wallet" style="color:#2563eb;"></i> My Payment Requests</div>
        <div class="page-subtitle">Submit USD payout requests to Owner, track settlements, and monitor weekly accrued commissions.</div>
      </div>
    </div>

    <!-- Balance 2-Card Metric Row -->
    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px;margin-bottom:16px;">
      <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1px solid #cbd5e1;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.04);display:flex;flex-direction:column;justify-content:space-between;min-height:115px;">
        <div>
          <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.3px;">Main balance ($)</div>
          <div class="zy-crs-num" style="font-size:24px;font-weight:800;color:#0f172a;margin:4px 0 6px;">$<span id="bal-usd">${zyFmtMoney(balUsd, 2)}</span></div>
          <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:4px;">
            <i class="fas fa-info-circle" style="color:#0ea5e9;"></i> Min for payout: <strong>$${zyFmtMoney(minPayout, 2)}</strong>
          </div>
        </div>
        <div style="margin-top:12px;">
          <button type="button" class="sp-btn-primary" style="height:32px;padding:0 14px;font-size:12px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;background:#10b981;border:none;color:#fff;cursor:pointer;" onclick="zyAgentRequestPayoutModal(${balUsd}, ${minPayout})">
            <i class="fas fa-paper-plane"></i> Request payment
          </button>
        </div>
      </div>

      <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1px solid #cbd5e1;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.04);display:flex;flex-direction:column;justify-content:space-between;min-height:115px;">
        <div>
          <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.3px;">This Week Mon-Sun</div>
          <div class="zy-crs-num" style="font-size:24px;font-weight:800;color:#2563eb;margin:4px 0 6px;">$<span id="bal-week">${zyFmtMoney(thisWeekUsd, 4)}</span></div>
          <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:4px;">
            <i class="fas fa-calendar-alt" style="color:#8b5cf6;"></i> <span>${zyEsc(weekRangeStr)}</span>
          </div>
        </div>
        <div style="margin-top:12px;font-size:11.5px;color:#059669;font-weight:600;display:flex;align-items:center;gap:5px;">
          <i class="fas fa-check-circle"></i> Auto-settles to Main Balance at Sun 23:59:59 UTC
        </div>
      </div>
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

window.zyAgentRequestPayoutModal = async function(currentBal = 0) {
  let minPayout = 10;
  let bankAccounts = [];
  try {
    const [settings, banks] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch(`/api/bank-accounts?agent_id=${AGENT_ID}`)
    ]);
    minPayout = Number(settings?.min_payout ?? 10);
    bankAccounts = Array.isArray(banks) ? banks : (banks?.data || []);
  } catch (e) { console.warn('Payout modal settings fetch error:', e); }

  const bankOptions = bankAccounts.map(b => `<option value="${zyEsc(b.bank_name)} - ${zyEsc(b.account_no)}">${zyEsc(b.bank_name)} (${zyEsc(b.currency || 'USD')} - ${zyEsc(b.account_no)})</option>`).join('');

  zyModal('Request Payout', `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="color:#64748b;">Available USD Balance:</span>
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
      <input type="text" id="apr-notes" class="zy-input" style="width:100%;height:38px;" placeholder="Weekly traffic settlement">
    </div>
  `, `
    <button class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button class="sp-btn-primary" id="btn-submit-apr" onclick="zySubmitAgentPayout(${minPayout}, ${currentBal})"><i class="fas fa-paper-plane"></i> Submit Payout</button>
  `);
};

window.zySubmitAgentPayout = async function(minPayout, currentBal) {
  const amt = parseFloat(document.getElementById('apr-amount')?.value);
  const cur = document.getElementById('apr-cur')?.value || 'USD';
  const method = document.getElementById('apr-method')?.value;
  const wallet = document.getElementById('apr-wallet')?.value.trim();
  const notes = document.getElementById('apr-notes')?.value.trim();

  if (isNaN(amt) || amt <= 0) { toast('Please enter a valid payout amount', 'error'); return; }
  if (amt < minPayout) { toast(`Payment low. Minimum payout is $${zyFmtMoney(minPayout, 2)}`, 'error'); return; }
  if (amt > currentBal) { toast(`Amount cannot exceed available balance of $${zyFmtMoney(currentBal, 2)}`, 'error'); return; }
  if (!wallet) { toast('Please specify your wallet address or account details', 'error'); return; }

  const btn = document.getElementById('btn-submit-apr');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const res = await apiFetch('/api/payout-requests', {
      method: 'POST',
      body: JSON.stringify({
        amount: amt,
        currency: cur,
        method,
        wallet,
        notes,
        role: 'Agent',
        agent_id: AGENT_ID
      })
    });
    if (res && (res.id || res.success)) {
      closeModal();
      toast('Payout request submitted successfully', 'success');
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
    const fmtUsd = v => `$${zyFmtMoney(Number(v || 0), 2)}`;
    return [
      (ts || '').replace('T', ' ').slice(0, 19),
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
    cols: ['Date', 'Mode', 'Amount', 'Status', 'Address', 'Paid', 'Transaction', 'Remarks', 'Updated On'],
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
    const minPayoutPkr = Number(settings?.min_payout_pkr ?? 100);
    const wt = ratesRes?.weekly_target || {};
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
          <div style="flex:1;min-width:170px;">
            <label class="zy-lbl" for="crs-target-val">Weekly Target (PKR)</label>
            <input type="number" id="crs-target-val" class="zy-input zy-crs-num" min="0" step="100" value="${target}" style="height:34px;" placeholder="0 = unlimited">
          </div>
          <div style="flex:1;min-width:200px;">
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
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Client Min Payout</div>
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

    return [
      `<span class="monospace">#${Number(r.id || 0)}</span>`,
      `<strong>${zyEsc(r.username || r.user || 'Client')}</strong>`,
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
    cols: ['#', 'Client', 'Method', 'Amount (PKR)', 'Status', 'Account / IBAN / Wallet', 'Paid (PKR)', 'Transaction', 'Requested At', 'Actions'],
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
                  <option value="Biweekly">Biweekly (15/3) — 3 Day Hold</option>
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
    apiFetch(`/api/numbers?agent_id=${AGENT_ID}&limit=100000`).catch(() => ({ data: [] })),
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

/* ═══ DOWNLINE CLIENT NUMBER REQUESTS ═══════════════════════ */
async function pgClientRequests() {
  const c = document.getElementById('page-content');
  if (typeof zyCrumb === 'function') zyCrumb(['SMS Module', 'Number Requests']);
  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Number Requests</div>
        <div class="page-subtitle">Review and fulfill number inventory requests submitted by your downline Clients.</div>
      </div>
    </div>
    <div class="apx-card" style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:10px;overflow:hidden;">
      <div class="apx-card-header" style="height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:#f8fafc;border-bottom:1px solid #cbd5e1;">
        <span style="font-weight:700;font-size:13px;color:#1e293b;">
          <i class="fas fa-inbox" style="color:#2563eb;margin-right:6px;"></i> Downline Number Requests
        </span>
      </div>
      <div class="apx-card-body" id="agt-numreq-host" style="padding:14px;"><div class="zy-loading">Loading requests…</div></div>
    </div>`;
  try {
    const raw = await apiFetch('/api/agent-requests?scope=downline');
    const data = Array.isArray(raw) ? raw : (raw?.data || []);
    window._zyAgtNumRequestsCache = data;
    const host = document.getElementById('agt-numreq-host');
    if (!host) return;
    if (!data.length) {
      host.innerHTML = '<div style="padding:28px;text-align:center;color:#64748b;">No number requests from your clients yet.</div>';
      return;
    }
    const rows = data.map(r => {
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
        r.id || '—',
        `<strong>${zyEsc(r.requester_username || r.client_username || r.agent_username || 'Client')}</strong> <span class="badge badge-blue" style="font-size:10px;">${zyEsc(r.requester_role || 'Client')}</span>`,
        zyEsc(r.range_name || ('Range #' + (r.range_id || '—'))),
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
      cols: ['#', 'Requester', 'Range', 'App', 'Free', 'Qty', 'Client Rate', 'Notes', 'Status', 'Date', 'Actions'],
      rows
    });
    zy2Render('dt-agt-reqs');
  } catch (err) {
    const host = document.getElementById('agt-numreq-host');
    if (host) host.innerHTML = `<div class="text-danger" style="padding:20px;">Failed to load requests: ${zyEsc(err.message)}</div>`;
  }
}

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
      <i class="fas fa-circle-exclamation"></i> 0 free numbers available in your Agent Pool for "${rangeName}". Request numbers from Owner first.
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
  const reason = prompt('Optional rejection reason:') || 'Rejected by Agent';
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
  const map = {
    'dashboard': () => pgDashboard(),
    'sms-ranges': pgSmsRanges, 'sms-overview': pgSmsRanges, 'sms-ratecard': pgSmsRanges,
    'client-rate-set': pgClientRateSet,
    'my-sms-numbers': pgMySmsNumbers,
    'assign-to-client': pgMySmsNumbers,
    'transfer-history': pgAgentTransferHistory,
    'client-requests': pgClientRequests,
    'news-clients': pgNewsClients, 'notifications': pgNewsClients,
    'live-chat': () => { if (window.HumexLiveChat) window.HumexLiveChat.renderPage('page-content'); },
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
    'usd-statements': () => pgStatements('USD'), 'eur-statements': () => pgStatements('EUR'),
    'gbp-statements': () => pgStatements('GBP')
  };
  const prev = loadPage;
  loadPage = function (page) {
    if (page !== 'live-chat' && window.HumexLiveChat) window.HumexLiveChat.unmount();
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
