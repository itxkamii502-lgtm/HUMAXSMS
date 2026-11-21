/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — CLIENT pages. Requires shared-ui-kit.js
   ═══════════════════════════════════════════════════════════════ */

let ZY_RANGES = [], ZY_NUMROWS = [];

/* ═══ 1. SMS RANGES & RATECARD MASTER CATALOG ═════════════════════════ */
let ZY_CLIENT_RANGE_LIST = [];

async function pgSmsRanges() {
  const c = document.getElementById('page-content');
  zyCrumb(['SMS Module', 'Ranges & Rate Card']);
  c.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title" style="font-size:18px;font-weight:800;color:#0f172a;">
          <i class="fas fa-table-list" style="color:#0ea5e9;margin-right:6px;"></i> Ranges &amp; Rate Card (PKR)
        </div>
        <div class="page-subtitle" style="font-size:12.5px;color:#64748b;">
          Agent-approved termination ranges priced in PKR. Unlimited ranges — per range limit: <b>25/day</b>, <b>50 max held</b>, <b>3x/week</b>.
        </div>
      </div>
    </div>
    <div class="apx-card" style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div class="apx-card-body" id="cl-ranges-table-host" style="padding:14px;"><div class="zy-loading">Loading termination ranges…</div></div>
    </div>`;

  try {
    const [rateCardRes, myNumsRes, policy] = await Promise.all([
      apiFetch('/api/client/rate-card').catch(() => ({ ranges: [] })),
      apiFetch(`/api/numbers?client_id=${CLIENT_ID}&limit=1`).catch(() => ({ total: 0, data: [] })),
      typeof zyFetchAllocPolicy === 'function' ? zyFetchAllocPolicy() : Promise.resolve({ mode: 'request' })
    ]);

    const list = Array.isArray(rateCardRes?.ranges) ? rateCardRes.ranges : [];
    const fx = Number(rateCardRes?.usd_to_pkr_rate || window._zyClientFx || 280);
    window._zyClientFx = fx;

    ZY_CLIENT_RANGE_LIST = list;
    window._zyClPolicy = policy || { mode: 'request' };
    const isSelfAlloc = window._zyClPolicy.mode === 'self_allocate';

    const host = document.getElementById('cl-ranges-table-host');
    if (!host) return;
    if (!list.length) {
      host.innerHTML = typeof zyEmptyState === 'function'
        ? zyEmptyState('fa-layer-group', 'No Published PKR Ranges Yet', 'Your Agent has not set PKR client rates for any range yet. Once your Agent publishes a range rate, it will appear here.')
        : `<div style="padding:36px 20px;text-align:center;color:#64748b;">No ranges published by your Agent yet.</div>`;
      return;
    }

    const naHtml = `<span class="zy-na">N/A</span>`;

    const rows = list.map((r, i) => {
      const rName = r.range_name || r.name || r.country || '—';
      const rId = r.range_id || r.id || null;
      const countryPrefix = [r.country || '', r.prefix ? `+${String(r.prefix).replace(/^\+/, '')}` : ''].filter(Boolean).join(' · ') || '—';
      const ptsPkr = r.payterms_pkr || {};
      const ptInfo = typeof zyResolveRangeActivePayterms === 'function'
        ? zyResolveRangeActivePayterms(r)
        : { active: [r.payterm || 'Weekly'], primary: r.payterm || 'Weekly', isWn: Boolean(r.is_whitenoise) };
      const clientRatePkr = Number(r.client_rate_pkr ?? r.rate ?? r.payout ?? 0);
      const hasWeekly = ptInfo.active.includes('Weekly') && (ptsPkr['Weekly'] != null || ptsPkr['7/3'] != null || clientRatePkr > 0);
      const hasMonthly = ptInfo.active.includes('Monthly') && (ptsPkr['Monthly'] != null || ptsPkr['30/5'] != null || clientRatePkr > 0);
      const weeklyRatePkr = hasWeekly ? Number(ptsPkr['Weekly'] ?? ptsPkr['7/3'] ?? clientRatePkr) : null;
      const monthlyRatePkr = hasMonthly ? Number(ptsPkr['Monthly'] ?? ptsPkr['30/5'] ?? clientRatePkr) : null;

      const heldCount = Number(r.held_count || 0);
      const roomCount = Math.max(0, Number(r.available || 0));
      const dailyLimitNums = Number(r.daily_numbers_limit || 25);
      const maxHoldNums = Number(r.max_hold_limit || 50);
      const weeklyLimitAdds = Number(r.weekly_adds_limit || 3);
      const todayNums = Number(r.today_numbers || 0);
      const weeklyUsed = Number(r.weekly_adds_used || 0);
      const maxReqNow = r.max_requestable_now != null ? Number(r.max_requestable_now) : Math.max(0, Math.min(dailyLimitNums - todayNums, maxHoldNums - heldCount));
      const rawAllowed = Array.isArray(r.allowed_quantities) && r.allowed_quantities.length ? r.allowed_quantities : [25];
      const allowedQty = rawAllowed.filter(q => Number(q) > 0 && Number(q) <= dailyLimitNums);
      const displayBatch = allowedQty.length ? allowedQty : [dailyLimitNums];
      const hasPendingReq = Boolean(r.has_pending_request || Number(r.pending_request_count || 0) > 0 || r.block_reason === 'pending_request');
      const reqBlocked = r.can_request_now === false || r.requested_today === true || r.can_request_today === false || maxReqNow <= 0 || hasPendingReq;
      const blockReason = r.block_reason || (hasPendingReq ? 'pending_request' : (r.requested_today ? 'daily_limit' : ''));

      let lockLabel = 'Requested Today';
      let lockTip = 'Daily limit reached: 25 numbers per range per UTC day (resets 05:00 AM PKT).';
      if (blockReason === 'hold_limit') {
        lockLabel = `Hold Full (${heldCount}/${maxHoldNums})`;
        lockTip = `Maximum ${maxHoldNums} active numbers held in this range. Return numbers to add more.`;
      } else if (blockReason === 'weekly_limit') {
        lockLabel = `Weekly (${weeklyUsed}/${weeklyLimitAdds})`;
        lockTip = `Maximum ${weeklyLimitAdds} additions per week reached for this range.`;
      } else if (blockReason === 'daily_limit') {
        lockLabel = `Daily (${todayNums}/${dailyLimitNums})`;
        lockTip = `Daily limit of ${dailyLimitNums} numbers per range reached today. Resets at 00:00 UTC (05:00 AM PKT).`;
      } else if (blockReason === 'pending_request') {
        lockLabel = 'Pending Approval';
        lockTip = 'You already have a pending request on this range. Please wait for your Agent to review it.';
      }

      const quotaHtml = reqBlocked
        ? `<div class="zy-quota-mini"><span class="zy-cl-rc-lock" title="${zyEsc(lockTip)}"><i class="fas ${blockReason === 'pending_request' ? 'fa-clock' : 'fa-lock'}"></i> ${zyEsc(lockLabel)}</span><div class="zy-quota-sub">Held ${heldCount}/${maxHoldNums} · Wk ${weeklyUsed}/${weeklyLimitAdds}</div></div>`
        : `<div class="zy-quota-mini"><span class="zy-cl-rc-ready"><i class="fas fa-check-circle"></i> Ready (${maxReqNow} left)</span><div class="zy-quota-sub">Held ${heldCount}/${maxHoldNums} · Wk ${weeklyUsed}/${weeklyLimitAdds}</div></div>`;

      let actionBtnHtml = '';
      if (isSelfAlloc) {
        if (reqBlocked) {
          actionBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#94a3b8;border-color:#cbd5e1;background:#f8fafc;cursor:not-allowed;" disabled title="${zyEsc(lockTip)}"><i class="fas fa-lock"></i> ${zyEsc(lockLabel)}</button>`;
        } else if (roomCount <= 0) {
          actionBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#94a3b8;border-color:#cbd5e1;background:#f8fafc;cursor:not-allowed;" disabled title="No free numbers are currently available from your Agent in this range."><i class="fas fa-ban"></i> Out of Stock</button>`;
        } else {
          actionBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#059669;border-color:#a7f3d0;background:#ecfdf5;" onclick="zyOpenSelfAllocateModal('${zyEsc(rName)}', ${rId || 'null'}, window._zyClPolicy, pgSmsRanges, ZY_CLIENT_RANGE_LIST[${i}])" title="Self-Allocate Numbers (${roomCount.toLocaleString()} free)"><i class="fas fa-bolt"></i> Self-Allocate</button>`;
        }
      } else if (reqBlocked) {
        const isPend = blockReason === 'pending_request';
        actionBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="${isPend ? 'color:#b45309;border-color:#fde68a;background:#fffbeb;' : 'color:#94a3b8;border-color:#cbd5e1;background:#f8fafc;'}cursor:not-allowed;" disabled title="${zyEsc(lockTip)}"><i class="fas ${isPend ? 'fa-clock' : 'fa-lock'}"></i> ${zyEsc(lockLabel)}</button>`;
      } else {
        actionBtnHtml = `<button type="button" class="apx-btn apx-btn-small" style="color:#2563eb;border-color:#bfdbfe;background:#eff6ff;font-weight:700;" onclick="zyOpenClientRateCardRequestModal(${i})" title="Request Numbers (up to ${maxReqNow} now)"><i class="fas fa-phone-volume"></i> Request</button>`;
      }

      const returnBtnHtml = heldCount > 0
        ? `<button type="button" class="apx-btn apx-btn-small zy-btn-return-range" onclick="zyOpenRangeReturnModal(${rId || 'null'}, '${zyEsc(rName)}', pgSmsRanges)" title="Return numbers from ${zyEsc(rName)} by date"><i class="fas fa-rotate-left"></i> Return (${heldCount})</button>`
        : `<button type="button" class="apx-btn apx-btn-small zy-btn-return-range" disabled title="No numbers held in this range to return"><i class="fas fa-rotate-left"></i> Return</button>`;

      const isWn = ptInfo.isWn;
      const paytermHtml = isWn
        ? `<span class="zy-payterm-badge zy-pt-monthly"><i class="fas fa-calendar-check"></i> Monthly (30/5) {W}</span>`
        : (typeof zyPaytermBadge === 'function'
            ? zyPaytermBadge('Weekly')
            : `<span class="badge badge-purple" style="font-size:10.5px;">Weekly (7/3)</span>`);
      const routeHighlightTag = isWn
        ? ` <span class="zy-wn-route-tag"><i class="fas fa-calendar-check"></i> {W} Monthly Route</span>`
        : '';

      return [
        { v: rName, h: `<div class="${isWn ? 'zy-wn-cell-accent' : ''}" style="min-width:140px;"><strong style="color:#0f172a;">${i + 1}. ${zyEsc(rName)}</strong>${routeHighlightTag}<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px;font-size:11px;"><span class="monospace" style="font-weight:600;color:#2563eb;">${zyEsc(countryPrefix)}</span><span style="color:#94a3b8;">·</span><span style="font-weight:700;color:#059669;">PKR</span><span style="color:#94a3b8;">·</span>${r.active !== false ? '<span style="color:#10b981;font-weight:700;">Active</span>' : '<span style="color:#ef4444;font-weight:700;">Inactive</span>'}</div></div>` },
        paytermHtml,
        weeklyRatePkr !== null ? `<span class="zy-cl-rc-rate">Rs. ${zyFmtMoney(weeklyRatePkr, 4)}</span>` : naHtml,
        monthlyRatePkr !== null ? `<span class="monospace" style="font-weight:700;color:#7c3aed;">Rs. ${zyFmtMoney(monthlyRatePkr, 4)}</span>` : naHtml,
        `<span class="monospace" style="font-size:11.5px;" title="Your Held: ${heldCount}/${maxHoldNums} · Agent Free Pool: ${roomCount}"><b>${heldCount}/${maxHoldNums}</b> · <span style="color:${roomCount > 0 ? '#10b981' : '#dc2626'};font-weight:700;">${roomCount.toLocaleString()}</span></span>`,
        `<span class="monospace" style="font-weight:700;color:#334155;">${zyEsc(displayBatch.join(' / '))} / day</span>`,
        { v: reqBlocked ? 'locked' : 'ready', h: quotaHtml },
        { v: '', h: `<div style="display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;">
          <button type="button" class="apx-btn apx-btn-icon apx-btn-small" style="color:#0284c7;border-color:#bae6fd;background:#f0f9ff;" onclick="zyViewClientRange(${i})" title="View Details"><i class="fas fa-eye"></i></button>
          ${actionBtnHtml}
          ${returnBtnHtml}
        </div>` }
      ];
    });

    host.innerHTML = zyDT2('dt-cl-ranges', {
      cols: ['Range & Country', 'Payterm', 'Weekly (7/3)', 'Monthly (30/5) {W}', 'Held / Pool', 'Allowed Batch', 'Today Quota', 'Actions'],
      rows
    });
    zy2Render('dt-cl-ranges');
  } catch (err) {
    console.error('Failed to load client ranges:', err);
    const host = document.getElementById('cl-ranges-table-host');
    if (host) host.innerHTML = `<div class="text-danger" style="padding:20px;text-align:center;">Failed to load Ranges Rate Card: ${zyEsc(err.message || 'Network error')}</div>`;
  }
}

window.zyOpenClientRateCardRequestModal = function(i) {
  const r = ZY_CLIENT_RANGE_LIST[i];
  if (!r) return;
  const rName = r.range_name || r.name || r.country || 'Range';
  const rId = r.range_id || r.id;
  const clientRatePkr = Number(r.client_rate_pkr ?? r.rate ?? r.payout ?? 0);
  const dailyLimitNums = Number(r.daily_numbers_limit || 25);
  const maxHoldNums = Number(r.max_hold_limit || 50);
  const weeklyLimitAdds = Number(r.weekly_adds_limit || 3);
  const heldCount = Number(r.held_count || 0);
  const todayNums = Number(r.today_numbers || 0);
  const weeklyUsed = Number(r.weekly_adds_used || 0);
  const maxReqNow = r.max_requestable_now != null ? Number(r.max_requestable_now) : Math.max(0, Math.min(dailyLimitNums - todayNums, maxHoldNums - heldCount));

  if (r.has_pending_request || r.block_reason === 'pending_request') {
    toast(`You already have a pending request for "${rName}". Please wait for your Agent to review it first.`, 'warning');
    return;
  }
  if (r.can_request_now === false || maxReqNow <= 0) {
    if (r.block_reason === 'hold_limit') {
      toast(`Holding limit reached for "${rName}" (${heldCount}/${maxHoldNums}). Return numbers first to request more.`, 'error');
    } else if (r.block_reason === 'weekly_limit') {
      toast(`Weekly limit reached for "${rName}" (${weeklyUsed}/${weeklyLimitAdds} additions in 7 days).`, 'error');
    } else {
      toast(`Daily limit reached for "${rName}" (${todayNums}/${dailyLimitNums} numbers today). Resets at 00:00 UTC (05:00 AM PKT).`, 'error');
    }
    return;
  }

  const rawAllowed = Array.isArray(r.allowed_quantities) && r.allowed_quantities.length ? r.allowed_quantities : [25];
  let selectableQtys = rawAllowed.map(Number).filter(q => q > 0 && q <= maxReqNow);
  if (!selectableQtys.length) selectableQtys = [maxReqNow];
  const defaultQty = selectableQtys[0];

  const ptInfo = typeof zyResolveRangeActivePayterms === 'function'
    ? zyResolveRangeActivePayterms(r)
    : { active: [r.is_whitenoise ? 'Monthly' : 'Weekly'], primary: r.is_whitenoise ? 'Monthly' : 'Weekly', isWn: Boolean(r.is_whitenoise), labels: { Weekly: 'Weekly (7/3) — 3 Day Hold', Monthly: 'Monthly (30/5) {W} — 5 Day Hold' } };
  const isLockedPt = ptInfo.active.length === 1;
  const ptOptionsHtml = ptInfo.active.map(pt =>
    `<option value="${zyEsc(pt)}" ${pt === ptInfo.primary ? 'selected' : ''}>${zyEsc((ptInfo.labels && ptInfo.labels[pt]) || pt)}${isLockedPt ? ' (Locked)' : ''}</option>`
  ).join('');

  const qtyButtonsHtml = selectableQtys.map((q, idx) => `
    <button type="button" class="zy-qty-card ${idx === 0 ? 'active' : ''}" data-qty="${Number(q)}" onclick="zySelectReqQty(this, ${Number(q)})">
      <span class="zy-qty-num">${Number(q)}</span>
      <span class="zy-qty-lbl">Numbers Batch</span>
    </button>`).join('');

  zyModal(`Request Numbers: ${zyEsc(rName)}`, `
    <div id="cl-rc-err" class="zy-modal-alert is-error" style="display:none;"></div>
    <div class="zy-modal-summary-card" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;color:#0f172a;font-size:14.5px;">${zyEsc(rName)}</div>
          <div style="font-size:11.5px;color:#64748b;margin-top:2px;">${zyEsc(r.country || 'International')} · Prefix: <b class="monospace">${zyEsc(r.prefix || '—')}</b></div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Client Rate</div>
          <div class="zy-cl-rc-rate" style="font-size:15px;">Rs. ${zyFmtMoney(clientRatePkr, 4)} / SMS</div>
        </div>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1;font-size:11.5px;color:#475569;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
        <span>Agent Free Pool: <b style="color:${Number(r.available || 0) > 0 ? '#059669' : '#dc2626'};">${Number(r.available || 0).toLocaleString()}</b></span>
        <span>Held: <b>${heldCount}/${maxHoldNums}</b></span>
        <span>Today: <b>${todayNums}/${dailyLimitNums}</b></span>
        <span>Week: <b>${weeklyUsed}/${weeklyLimitAdds}</b></span>
      </div>
    </div>

    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:8px;">Select Allowed Number Batch (Max ${maxReqNow} now) *</label>
      <input type="hidden" id="cl-rc-qty" value="${Number(defaultQty)}">
      <div class="zy-qty-grid">${qtyButtonsHtml}</div>
    </div>

    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">Payment Term</label>
      <select id="cl-rc-payterm" class="zy-select-pill" ${isLockedPt ? 'disabled' : ''}>${ptOptionsHtml}</select>
      ${isLockedPt ? `<div style="font-size:11px;color:#4338ca;font-weight:600;margin-top:4px;">Only <b>${zyEsc(ptInfo.primary)}</b> is active on this range.</div>` : ''}
    </div>

    <div style="margin-bottom:6px;">
      <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">Notes for Agent (Optional)</label>
      <input type="text" id="cl-rc-notes" class="zy-select-pill" placeholder="e.g. WhatsApp / OTP traffic batch">
    </div>
  `, `
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;width:100%;">
      <button type="button" class="zy-btn-pill-cancel" onclick="closeModal()">Cancel</button>
      <button type="button" class="zy-btn-pill-submit" id="zy-cl-rc-submit" onclick="zySubmitClientRateCardRequest(${Number(rId)}, '${zyEsc(rName)}')">
        <i class="fas fa-paper-plane"></i> Submit Request
      </button>
    </div>
  `);
};

window.zySelectReqQty = function(btn, qty) {
  const inp = document.getElementById('cl-rc-qty');
  if (inp) inp.value = String(qty);
  document.querySelectorAll('.zy-qty-card').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
};

window.zySubmitClientRateCardRequest = async function(rangeId, rangeName) {
  const qty = parseInt(document.getElementById('cl-rc-qty')?.value || '0', 10);
  const payterm = document.getElementById('cl-rc-payterm')?.value || 'Weekly';
  const notes = (document.getElementById('cl-rc-notes')?.value || '').trim();
  const btn = document.getElementById('zy-cl-rc-submit');
  if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('cl-rc-err', '');
  if (!qty || qty <= 0) {
    if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('cl-rc-err', 'Please select an allowed number batch before submitting.');
    else toast('Please select an allowed number quantity (up to 25/day)', 'error');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  try {
    const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
    const response = await fetch('/api/numbers/request', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}`, 'X-Session-Token': token } : {})
      },
      body: JSON.stringify({
        range_id: Number(rangeId) || rangeId,
        range_name: rangeName,
        quantity: qty,
        payterm,
        notes,
        urgency: 'normal'
      })
    });
    const rawText = await response.text();
    let res = null;
    try { res = JSON.parse(rawText); } catch (_) {}
    if (!response.ok || !res || res.error) {
      const cleanMsg = typeof window.zyHumanizeError === 'function'
        ? window.zyHumanizeError((res && (res.error || res.message)) || rawText, response.status)
        : ((res && res.error) || 'Unable to submit your request right now.');
      throw new Error(cleanMsg);
    }
    closeModal();
    toast(`Requested ${qty} numbers in "${rangeName}" (${payterm}) at Rs. ${zyFmtMoney(Number(res.request?.client_rate_pkr || 0), 4)} PKR`, 'success');
    pgSmsRanges();
  } catch (err) {
    const cleanMsg = typeof window.zyHumanizeError === 'function'
      ? window.zyHumanizeError(err.message || err)
      : (err.message || 'Unable to submit your request.');
    if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('cl-rc-err', cleanMsg);
    else toast(cleanMsg, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Request'; }
  }
};

/* 3-Column Range Specification Modal matching Owner & Agent (100% PKR) */
function zyViewClientRange(i) {
  const r = ZY_CLIENT_RANGE_LIST[i] || {};
  const rName = r.name || r.range_name || r.country || 'Details';
  const rId = r.range_id || r.id || null;
  const clientRatePkr = Number(r.client_rate_pkr ?? r.rate ?? r.payout ?? 0);
  const ptsPkr = r.payterms_pkr || {};
  const ptInfo = typeof zyResolveRangeActivePayterms === 'function'
    ? zyResolveRangeActivePayterms(r)
    : { active: [r.payterm || 'Weekly'], primary: r.payterm || 'Weekly', isWn: Boolean(r.is_whitenoise) };
  const hasWeekly = ptInfo.active.includes('Weekly') && (ptsPkr['Weekly'] != null || ptsPkr['7/3'] != null || clientRatePkr > 0);
  const hasMonthly = ptInfo.active.includes('Monthly') && (ptsPkr['Monthly'] != null || ptsPkr['30/5'] != null || clientRatePkr > 0);
  const weeklyVal = hasWeekly ? Number(ptsPkr['Weekly'] ?? ptsPkr['7/3'] ?? clientRatePkr) : null;
  const monthlyVal = hasMonthly ? Number(ptsPkr['Monthly'] ?? ptsPkr['30/5'] ?? clientRatePkr) : null;

  const heldCount = Number(r.held_count || 0);
  const dailyLimitNums = Number(r.daily_numbers_limit || 25);
  const maxHoldNums = Number(r.max_hold_limit || 50);
  const weeklyLimitAdds = Number(r.weekly_adds_limit || 3);
  const todayNums = Number(r.today_numbers || 0);
  const weeklyUsed = Number(r.weekly_adds_used || 0);
  const reqBlocked = r.can_request_now === false || r.requested_today === true || r.can_request_today === false;
  const roomCount = Math.max(0, Number(r.available || 0));
  const naCell = `<span class="zy-na">N/A</span>`;

  zyModal(`Range Specification: ${zyEsc(rName)}`, `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;margin-bottom:12px;">
      <!-- Col 1: General Info -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-tower-broadcast" style="color:#0284c7;margin-right:4px;"></i> General Info
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Range Name:</span> <b>${zyEsc(rName)}</b> ${ptInfo.isWn ? '<span class="zy-wn-route-tag">{W} Monthly Route</span>' : ''}</div>
          <div><span style="color:#64748b;">Country:</span> <b>${zyEsc(r.country || '—')}</b></div>
          <div><span style="color:#64748b;">Prefix:</span> <b class="monospace" style="color:#2563eb;">${zyEsc(r.prefix || '—')}</b></div>
          <div><span style="color:#64748b;">Currency:</span> <b style="color:#059669;">PKR</b></div>
          <div><span style="color:#64748b;">Active Payterm:</span> <b class="badge badge-purple" style="font-size:10.5px;">${ptInfo.isWn ? 'Monthly (30/5) {W}' : 'Weekly (7/3)'}</b></div>
        </div>
      </div>

      <!-- Col 2: Limits & Routing -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-sliders" style="color:#10b981;margin-right:4px;"></i> Limits &amp; Routing
        </h5>
        <div style="font-size:12px;line-height:22px;">
          <div><span style="color:#64748b;">Status:</span> ${r.active !== false ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Inactive</span>'}</div>
          <div><span style="color:#64748b;">Max SMS / Day:</span> <b>${r.max_sms_day != null ? r.max_sms_day : 'Unlimited'}</b></div>
          <div><span style="color:#64748b;">Daily Limit (Range):</span> <b>${todayNums} / ${dailyLimitNums} numbers</b></div>
          <div><span style="color:#64748b;">Holding Limit (Range):</span> <b>${heldCount} / ${maxHoldNums} active</b></div>
          <div><span style="color:#64748b;">Weekly Limit (Range):</span> <b>${weeklyUsed} / ${weeklyLimitAdds} additions</b></div>
          <div><span style="color:#64748b;">Room in Agent Pool:</span> <b style="color:#10b981;">${roomCount.toLocaleString()} numbers</b></div>
          <div><span style="color:#64748b;">Allowed CLIs:</span> <small style="display:block;color:#64748b;line-height:1.3;margin-top:2px;">${zyEsc(r.cli_list || 'All CLIs')}</small></div>
        </div>
      </div>

      <!-- Col 3: PKR Payterms Rate Card -->
      <div style="background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <h5 style="margin:0 0 10px 0;font-size:12px;font-weight:700;text-transform:uppercase;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
          <i class="fas fa-coins" style="color:#d97706;margin-right:4px;"></i> Payterms Rate Card (PKR)
        </h5>
        <table style="width:100%;font-size:11.5px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #cbd5e1;text-align:left;color:#64748b;">
              <th style="padding:3px 0;">Schedule</th>
              <th style="padding:3px 0;text-align:right;">Payout (PKR)</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px dashed #e2e8f0;"><td style="padding:6px 0;">Weekly (7/3) · 3d Hold</td><td style="text-align:right;font-weight:700;color:#059669;font-family:monospace;">${weeklyVal !== null ? 'Rs. ' + zyFmtMoney(weeklyVal, 4) : naCell}</td></tr>
            <tr style="${monthlyVal !== null ? 'background:#eef2ff;' : ''}"><td style="padding:6px 4px;color:${monthlyVal !== null ? '#4338ca' : '#64748b'};">Monthly (30/5) {W} · 5d Hold</td><td style="text-align:right;padding-right:4px;font-weight:700;color:#4338ca;font-family:monospace;">${monthlyVal !== null ? 'Rs. ' + zyFmtMoney(monthlyVal, 4) : naCell}</td></tr>
          </tbody>
        </table>
      </div>
    </div>`,
    `<button class="zy-btn-grey" onclick="closeModal()">Close</button>
     ${heldCount > 0 ? `<button class="zy-btn-grey" style="color:#dc2626;border-color:#fecaca;" onclick="closeModal();zyOpenRangeReturnModal(${rId || 'null'}, '${zyEsc(rName)}', pgSmsRanges)"><i class="fas fa-rotate-left"></i> Return (${heldCount})</button>` : ''}
     ${(window._zyClPolicy && window._zyClPolicy.mode === 'self_allocate')
       ? (reqBlocked
         ? `<button class="zy-btn-grey" disabled><i class="fas fa-lock"></i> Limit Reached</button>`
         : `<button class="zy-btn-blue" onclick="closeModal();zyOpenSelfAllocateModal('${zyEsc(rName)}', ${rId || 'null'}, window._zyClPolicy, pgSmsRanges, ZY_CLIENT_RANGE_LIST[${i}])"><i class="fas fa-bolt"></i> Self-Allocate Numbers</button>`)
       : (reqBlocked
         ? `<button class="zy-btn-grey" disabled><i class="fas fa-lock"></i> Limit Reached</button>`
         : `<button class="zy-btn-blue" onclick="closeModal();zyOpenClientRateCardRequestModal(${i})"><i class="fas fa-phone-volume"></i> Request Numbers</button>`)}`);
}

/* ═══ MY SMS NUMBERS ════════════════════════════════════════ */
async function pgMyNumbers() {
  const c = document.getElementById('page-content');
  zyCrumb(['My SMS Numbers']);
  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-mobile-screen" style="color:#2563eb;"></i> My SMS Numbers Pool</div>
        <div class="page-subtitle">Active numbers allocated to your client account. (SD: Daily, SW: Weekly)</div>
      </div>
    </div>
    <div class="card apx-card" style="margin-top:10px;">
      <div class="card-header apx-card-header">
        <span class="card-title"><i class="fas fa-mobile-screen" style="color:#10b981;margin-right:6px;"></i> My SMS Numbers Pool</span>
      </div>
      <div class="zy-filter-grid zy-cl-num-toolbar">
        <div class="zy-cl-num-top-row">
          <div class="zy-cl-num-field zy-cl-num-range-field">
            <select id="num-range" class="zy-filter-input zy-cl-num-input" aria-label="Range" onchange="zyClientNumFilter()">
              <option value="">All Ranges</option>
            </select>
          </div>
          <div class="zy-cl-num-field" style="min-width:140px;">
            <select id="num-route-type" class="zy-filter-input zy-cl-num-input" aria-label="Route Type" onchange="zyClientNumFilter()">
              <option value="">All Routes</option>
              <option value="weekly">Weekly (7/3) Routes</option>
              <option value="monthly">Monthly {W} (30/5) Routes</option>
            </select>
          </div>
          <button type="button" class="zy-btn-blue-solid zy-cl-num-filter-btn" onclick="zyClientNumFilter()">
            <i class="fas fa-filter"></i> Filter
          </button>
        </div>
        <div class="zy-cl-num-search-row">
          <input type="text" id="num-starts-with" class="zy-filter-input zy-cl-num-input zy-cl-num-search-input"
            placeholder="Search number or range..."
            aria-label="Search number or range"
            autocomplete="off"
            oninput="zyClientNumFilter()"
            onkeydown="if(event.key==='Enter'){event.preventDefault();zyClientNumFilter();}">
        </div>
        <div class="zy-cl-num-meta-bar">
          <span class="zy-cl-num-count"><i class="fas fa-sim-card" style="color:#2563eb;"></i> <b id="cl-num-count">0</b> numbers</span>
          <div class="zy-cl-num-tools">
            <button type="button" class="zy-btn-pill zy-cols-btn zy-cl-num-cols-btn" onclick="zy2Cols('dt-numbers', this)">
              <i class="fas fa-columns"></i> Columns
            </button>
            <div class="zy-cl-num-show">
              <span class="zy-cl-num-show-lbl">Show</span>
              <select id="cl-num-per-page" aria-label="Show records" onchange="zy2Size('dt-numbers', this.value)">
                <option value="10">10</option>
                <option value="25" selected>25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="apx-card-body zy-panel-body" id="cl-numbers-table-host" style="padding:0 12px 12px 12px;"><div class="zy-loading">Loading numbers…</div></div>
    </div>`;

  const [nums, rateCardRes] = await Promise.all([
    apiFetch(`/api/numbers?client_id=${CLIENT_ID}&limit=100000`),
    apiFetch('/api/client/rate-card').catch(() => ({ ranges: [] }))
  ]);
  ZY_RANGES = Array.isArray(rateCardRes?.ranges) ? rateCardRes.ranges : [];
  if (rateCardRes?.usd_to_pkr_rate) window._zyClientFx = Number(rateCardRes.usd_to_pkr_rate);
  window._zyClientRawNums = zyList(nums);

  const rangeSel = document.getElementById('num-range');
  if (rangeSel) {
    const uniqueRanges = Array.from(new Set(window._zyClientRawNums.map(n => n.range_name || n.range || n.country || '').filter(Boolean)));
    rangeSel.innerHTML = '<option value="">All Ranges</option>' +
      uniqueRanges.map(r => `<option value="${zyEsc(r)}">${zyEsc(r)}</option>`).join('');
  }

  zyRenderClientNumbers(window._zyClientRawNums);
}

function zyClientIsWhitenoiseObj(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Boolean(
    obj.is_whitenoise ||
    String(obj.provider || '').toLowerCase().includes('whitenoise') ||
    String(obj.payout_schedule || '').toLowerCase() === 'monthly30_5'
  );
}

window.zyClientFetchWhitenoiseOtp = async function(id, btn) {
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
      toast(nNew > 0 ? `Fetched ${nNew} new OTP SMS (matched: ${nTotal})` : `Checked live feed (${nTotal} matched, 0 new)`, nNew > 0 ? 'success' : 'info');
      if (nNew > 0 && typeof pgMyNumbers === 'function') pgMyNumbers();
    } else {
      toast(res?.error || 'Live OTP fetch failed', 'error');
    }
  } catch (err) {
    toast(err.message || 'Live OTP fetch failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = prevHtml || '<i class="fas fa-bolt"></i> Fetch OTP'; }
  }
};

function zyRenderClientNumbers(list) {
  const fx = Number(window._zyClientFx || 280);
  ZY_NUMROWS = (list || []).map(n => {
    const dateCell = typeof zyFormatNumberDateCell === 'function'
      ? zyFormatNumberDateCell(n, 'client')
      : { v: String(n.assigned_at || n.created || '').slice(0, 10), h: String(n.assigned_at || n.created || '—').slice(0, 10) };
    const rangeName = n.range_name || n.range || `${n.country || ''} ${n.provider || ''}`.trim() || '—';
    const cleanPrefix = String(n.prefix || '').trim().replace(/^\++/, '');
    const cleanNumber = String(n.number || '').trim().replace(/^\++/, '');
    const numHtml = typeof zyRenderNumberCopyBox === 'function'
      ? zyRenderNumberCopyBox(cleanNumber)
      : (cleanNumber ? `<span style="font-family:monospace;font-weight:600;color:var(--sp-primary,#166534);">${zyEsc(cleanNumber)}</span>` : '—');
    const ratePkr = n.client_rate_pkr != null
      ? Number(n.client_rate_pkr)
      : (n.payout != null ? Number(n.payout) * fx : null);
    const isWn = zyClientIsWhitenoiseObj(n);
    const rawTerm = isWn ? 'Monthly' : (n.client_payterm || n.payterm || 'Weekly');
    const termBadge = isWn
      ? `<span class="zy-payterm-badge zy-pt-monthly"><i class="fas fa-calendar-check"></i> Monthly (30/5) {W}</span>`
      : (typeof zyPaytermBadge === 'function'
        ? zyPaytermBadge(rawTerm)
        : `<span class="badge" style="background:var(--sp-bg-subtle);">${zyEsc(rawTerm)}</span>`);
    const actionHtml = isWn
      ? `<button type="button" class="apx-btn apx-btn-small" style="color:#4338ca;border-color:#c7d2fe;background:#eef2ff;font-weight:700;" onclick="zyClientFetchWhitenoiseOtp(${Number(n.id)}, this)" title="Fetch Live OTP"><i class="fas fa-bolt"></i> Fetch OTP</button>`
      : `<span style="color:#94a3b8;font-size:11px;">—</span>`;

    const rangeCellHtml = isWn
      ? `<div class="zy-wn-cell-accent"><span style="font-weight:600;">${zyEsc(rangeName)}</span> <span class="zy-wn-route-tag"><i class="fas fa-calendar-check"></i> {W} Monthly</span></div>`
      : `<span style="font-weight:600;">${zyEsc(rangeName)}</span>`;

    const r = [
      dateCell,
      { v: rangeName, h: rangeCellHtml },
      { v: cleanPrefix, h: cleanPrefix || '—' },
      { v: cleanNumber, h: numHtml },
      { v: isWn ? 'Monthly (30/5) {W}' : 'Weekly (7/3)', h: termBadge },
      { v: ratePkr ?? '', h: ratePkr != null ? `<span class="zy-cl-rc-rate">Rs. ${zyFmtMoney(Number(ratePkr), 4)}</span>` : '—' },
      { v: (n.sms_daily || 0) + (n.sms_weekly || 0), h: `SD: <b>${n.sms_daily || 0}</b> | SW: <b>${n.sms_weekly || 0}</b>` },
      { v: isWn ? 'fetch' : '', h: actionHtml }
    ];
    r.__id = n.id;
    return r;
  });

  const cntEl = document.getElementById('cl-num-count');
  if (cntEl) cntEl.textContent = ZY_NUMROWS.length.toLocaleString();

  const perPage = Number(document.getElementById('cl-num-per-page')?.value || 25) || 25;
  const body = document.querySelector('#page-content .zy-panel-body');
  if (body) {
    body.innerHTML = zyDT2('dt-numbers', {
      cols: ['Date', 'Range', 'Prefix', 'Number', 'My Payterm', 'My Rate (PKR)', 'Limits', 'Actions'],
      rows: ZY_NUMROWS,
      check: true,
      perPage,
      hideToolbar: true
    });
    zy2Render('dt-numbers');
  }
}

function zyClientNumFilter() {
  const rVal = (document.getElementById('num-range')?.value || '').toLowerCase();
  const routeType = (document.getElementById('num-route-type')?.value || '').toLowerCase();
  const q = (document.getElementById('num-starts-with')?.value || '').trim().toLowerCase();
  const qDigits = q.replace(/[^\d]/g, '');

  const filtered = (window._zyClientRawNums || []).filter(n => {
    const r = (n.range_name || n.range || n.country || '').toLowerCase();
    if (rVal && !r.includes(rVal)) return false;
    if (routeType) {
      const isWn = zyClientIsWhitenoiseObj(n);
      if (routeType === 'monthly' && !isWn) return false;
      if (routeType === 'weekly' && isWn) return false;
    }
    if (q) {
      const num = String(n.number || '').toLowerCase();
      const numDigits = num.replace(/[^\d]/g, '');
      const prefix = String(n.prefix || '').toLowerCase();
      const matchText = num.includes(q) || r.includes(q) || prefix.includes(q);
      const matchDigits = qDigits.length >= 2 && numDigits.includes(qDigits);
      if (!matchText && !matchDigits) return false;
    }
    return true;
  });

  zyRenderClientNumbers(filtered);
}

function zyResetClientNumFilter() {
  const r = document.getElementById('num-range');
  const sw = document.getElementById('num-starts-with');
  if (r) r.value = '';
  if (sw) sw.value = '';
  zyRenderClientNumbers(window._zyClientRawNums || []);
}

window.zyClientReturnSelected = async function() {
  const ids = zy2Checked('dt-numbers');
  if (!ids.length) { toast('Please select at least one number to return', 'error'); return; }
  if (!confirm(`Return ${ids.length} selected number(s) back to agent pool?`)) return;

  try {
    for (const id of ids) {
      await apiFetch(`/api/numbers/${id}/return`, { method: 'POST' });
    }
    toast(`Successfully returned ${ids.length} number(s) to agent pool`, 'success');
    pgMyNumbers();
  } catch (err) {
    toast(err.message || 'Failed to return numbers', 'error');
  }
};

/* ═══ SMS CDR STATS (CDR & STATISTICS V5) ══════════════════════ */
async function pgMySms() {
  const c = document.getElementById('page-content');
  zyCrumb(['CDR & Statistics']);

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

  const chipsHtml = groupChips.map(g => `
    <label class="zy-chip-pill" for="grp-cli-${g.id}">
      <input type="checkbox" id="grp-cli-${g.id}" class="grp-chk" value="${g.val}" onchange="this.closest('.zy-chip-pill').classList.toggle('active', this.checked)">
      ${g.label}
    </label>
  `).join('');

  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-chart-column" style="color:#2563eb;"></i> CDR &amp; Statistics</div>
        <div class="page-subtitle">Here You can view all the call detail records, traffic stats, and export reports.</div>
      </div>
    </div>

    <div class="zy-filter-grid" data-cdr-compact="1">
      <div class="zy-filter-grid-fields">
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-from">From</label>
          <input type="text" id="rp-from" class="zy-filter-input" value="${defaultFrom}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-to">To</label>
          <input type="text" id="rp-to" class="zy-filter-input" value="${defaultTo}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-range">Range</label>
          <select id="rp-range" class="zy-filter-input">
            <option value="">Filter Range</option>
          </select>
        </div>
      </div>

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
            placeholder="Search Date, Provider, Range, Number, CLI, SMS, PKR, Cause..."
            autocomplete="off"
            oninput="zyHandleCdrSearchInput(this, 'rp-search-clear', () => pgMySmsLoad(1))"
            onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._zyCdrSearchTimer){clearTimeout(window._zyCdrSearchTimer);}pgMySmsLoad(1);}">
          <button type="button" id="rp-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearCdrSearch('rp-search', 'rp-search-clear', () => pgMySmsLoad(1))">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="zy-table-toolbar zy-cdr-control-bar">
        <div class="zy-cdr-actions-left">
          <button type="button" class="zy-btn-blue-solid" id="btn-show-report" onclick="pgMySmsLoad(1)">
            <i class="fas fa-chart-column"></i> Show Report
          </button>
        </div>
        <div class="zy-toolbar-right">
          <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('dt-cdr', this)"><i class="fas fa-columns"></i> Columns</button>
          <div class="zy-toolbar-select-wrap">
            <label class="zy-toolbar-label" for="rp-limit">Show Records</label>
            <select id="rp-limit" class="zy-toolbar-select" onchange="pgMySmsLoad(1)">
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
        <div class="zy-loading" style="padding:40px;text-align:center;color:#64748b;">Loading CDR records…</div>
      </div>
    </div>`;

  const rateCardRes = await apiFetch('/api/client/rate-card').catch(() => ({ ranges: [] }));
  const ranges = Array.isArray(rateCardRes?.ranges) ? rateCardRes.ranges : [];
  if (rateCardRes?.usd_to_pkr_rate) window._zyClientFx = Number(rateCardRes.usd_to_pkr_rate);
  ZY_RANGES = ranges;
  const rEl = document.getElementById('rp-range');
  if (rEl) {
    rEl.innerHTML = `<option value="">Filter Range</option>` +
      ranges.map(r => `<option value="${r.range_id || r.id}">${zyEsc(r.range_name || r.name || r.country || '')}${r.prefix ? ` (${zyEsc(r.prefix)})` : ''}</option>`).join('');
  }
  // Auto-run first load
  pgMySmsLoad(1);
}

window.zyClientExportReport = function() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const checkedBoxes = Array.from(document.querySelectorAll('.grp-chk:checked')).map(cb => cb.value);
  zyExportCdrStream({
    client_id: typeof CLIENT_ID !== 'undefined' ? CLIENT_ID : '',
    date_from: val('rp-from'),
    date_to: val('rp-to'),
    range: val('rp-range'),
    search: val('rp-search').trim(),
    status: val('rp-status') !== 'All' ? val('rp-status') : '',
    group_by: checkedBoxes.join(',')
  });
};

async function pgMySmsLoad(page = 1) {
  const targetPage = typeof page === 'number' ? page : 1;

  const body = document.getElementById('rp-body');
  if (!body) return;

  if (window._clientCdrAbortController) {
    try { window._clientCdrAbortController.abort(); } catch (_) {}
  }
  window._clientCdrAbortController = new AbortController();
  const reqSignal = window._clientCdrAbortController.signal;

  if (typeof zySkeleton === 'function') {
    body.innerHTML = zySkeleton('report');
  } else {
    body.innerHTML = `<div class="zy-loading" style="padding:40px;text-align:center;color:#64748b;">
      <div style="display:inline-block;margin-bottom:8px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:#0ea5e9;"></i></div>
      <div>Loading report…</div>
    </div>`;
  }

  const val = id => (document.getElementById(id) || {}).value || '';
  const from = val('rp-from'), to = val('rp-to');
  const rangeId = val('rp-range');
  const search = val('rp-search').trim();

  const checkedBoxes = Array.from(document.querySelectorAll('.grp-chk:checked')).map(cb => cb.value);

  const params = new URLSearchParams();
  if (typeof CLIENT_ID !== 'undefined' && CLIENT_ID) params.append('client_id', CLIENT_ID);
  if (from) params.append('date_from', from);
  if (to) params.append('date_to', to);
  if (rangeId) params.append('range', rangeId);
  if (search) params.append('search', search);
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

    const sum = logs && logs.summary ? logs.summary : {};
    const fx = Number(sum.usd_to_pkr_rate || window._zyClientFx || 280);

    if (logs && logs.grouped && checkedBoxes.length) {
      const keyLabels = {
        hour: 'Hour',
        day: 'Day',
        date: 'Date',
        month: 'Month',
        range: 'Range',
        number: 'Number',
        cli: 'CLI',
        status: 'Status'
      };
      const cols = [
        ...checkedBoxes.map(k => keyLabels[k] || k),
        'SMS Count',
        'Currency',
        'My Payout (PKR)'
      ];
      const rows = data.map(g => {
        const gPkr = g.client_payout_pkr != null
          ? Number(g.client_payout_pkr)
          : (g.payout_pkr != null ? Number(g.payout_pkr) : (Number(g.client_payout || g.payout || 0) * fx));
        return [
          ...checkedBoxes.map(k => g[k] || '—'),
          g.sms_count || 0,
          'PKR',
          `Rs. ${zyFmtMoney(gPkr, 4)}`
        ];
      });

      const totalSms = (sum && sum.total_sms != null) ? sum.total_sms : data.reduce((s, g) => s + (g.sms_count || 0), 0);
      const totalPayoutPkr = (sum && sum.client_payout_pkr != null)
        ? Number(sum.client_payout_pkr)
        : (sum && sum.payout_pkr != null ? Number(sum.payout_pkr) : data.reduce((s, g) => s + (Number(g.client_payout_pkr != null ? g.client_payout_pkr : ((g.client_payout || g.payout || 0) * fx)) || 0), 0));
      const totalGroups = logs.total != null ? logs.total : ((sum && sum.total_groups != null) ? sum.total_groups : data.length);

      const footTds = [
        `<td><b>Total Groups: ${Number(totalGroups).toLocaleString()}</b></td>`,
        ...Array(Math.max(0, checkedBoxes.length - 1)).fill('<td></td>'),
        `<td><span class="zy-total-badge"><i class="fas fa-comment-sms"></i> Total SMS: <b>${totalSms.toLocaleString()}</b></span></td>`,
        `<td><span class="badge" style="background:var(--sp-bg-subtle);">PKR</span></td>`,
        `<td><b>Rs. ${zyFmtMoney(totalPayoutPkr, 4)}</b></td>`
      ];

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
        onPageChange: (p) => pgMySmsLoad(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('rp-limit');
          if (sel) sel.value = String(s);
          pgMySmsLoad(1);
        },
        footRow: footTds.join('')
      });
      zy2Render('dt-cdr');
    } else {
      const cols = ['Date', 'Provider', 'Range', 'Number', 'CLI', 'SMS', 'Currency', 'My Payout (PKR)', 'Cause'];
      const rows = data.map(s => {
        const dtCell = typeof zyFormatDateTimeStacked === 'function'
          ? zyFormatDateTimeStacked(s.timestamp || s.date)
          : { v: (s.timestamp || s.date || '').replace('T', ' ').slice(0, 19), h: (s.timestamp || s.date || '').replace('T', ' ').slice(0, 19) };
        const myPkr = s.client_amount_pkr != null
          ? Number(s.client_amount_pkr)
          : (s.my_payout_pkr != null
            ? Number(s.my_payout_pkr)
            : ((parseFloat(s.client_payout != null ? s.client_payout : (s.client_amount != null ? s.client_amount : (s.client_rate != null ? s.client_rate : (s.my_payout || 0)))) || 0) * (Number(s.fx_usd_to_pkr) || fx)));
        const causeVal = (s.cause || (s.status === 'delivered' || s.status === 'success' ? 'Success' : (s.status || '—')));

        const maskedCli = typeof zyMaskCli === 'function' ? zyMaskCli(s.cli || s.app || '—') : (s.cli || s.app || '—');
        const smsCellHtml = typeof zyRenderSmsCell === 'function' ? zyRenderSmsCell(s.message || '') : `<div class="zy-sms-cell">${typeof zyEsc === 'function' ? zyEsc(s.message || '') : (s.message || '')}</div>`;
        const numStr = String(s.number || '').trim();

        return [
          dtCell,
          zyEsc(s.provider || '—'),
          zyEsc(s.range_name || s.range_label || s.range || (s.country || '—')),
          { v: numStr, h: numStr ? `<span class="monospace" style="font-weight:600;">${zyEsc(numStr)}</span>` : '—' },
          { v: s.cli || '—', h: `<span class="monospace">${zyEsc(maskedCli)}</span>` },
          { v: s.message || '', h: smsCellHtml },
          'PKR',
          { v: myPkr, h: `<span class="zy-cl-rc-rate">Rs. ${zyFmtMoney(myPkr, 4)}</span>` },
          zyEsc(causeVal)
        ];
      });

      const totalSms = (sum.total_sms != null) ? sum.total_sms : (logs.total != null ? logs.total : rows.length);
      const totalPayoutPkr = (sum.client_payout_pkr != null)
        ? Number(sum.client_payout_pkr)
        : data.reduce((acc, s) => acc + (s.client_amount_pkr != null ? Number(s.client_amount_pkr) : ((parseFloat(s.client_payout != null ? s.client_payout : (s.client_rate || 0)) || 0) * (Number(s.fx_usd_to_pkr) || fx))), 0);

      const footRow = `<td><b>Total SMS<br>${totalSms.toLocaleString()}</b></td>` +
        '<td></td>'.repeat(5) +
        `<td><span class="badge" style="background:var(--sp-bg-subtle);">PKR</span></td>` +
        `<td><b>My Payout (PKR)<br>Rs. ${zyFmtMoney(totalPayoutPkr, 4)}</b></td>` +
        '<td></td>';

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
        onPageChange: (p) => pgMySmsLoad(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('rp-limit');
          if (sel) sel.value = String(s);
          pgMySmsLoad(1);
        },
        footRow
      });
      zy2Render('dt-cdr');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('Client CDR load error:', err);
    body.innerHTML = '<div class="zy-empty" style="padding:40px;text-align:center;color:#ef4444;">Failed to load CDR records. Please try again.</div>';
  }
}

/* ═══ CDR 2 (MONTHLY ROUTE — EXCEL DAILY STATS · PKR · MONTHLY 30/5 {W}) ═══ */
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
            CDR 2 (Monthly 30/5 {W}) access is not enabled for your account. Please ask your Agent to enable CDR 2 Access for you.
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
    { id: 'number', label: 'Number', val: 'number' },
    { id: 'cli', label: 'Service / CLI', val: 'cli' }
  ];

  const chipsHtml = groupChips.map(g => `
    <label class="zy-chip-pill" for="grp-cl-cdr2-${g.id}">
      <input type="checkbox" id="grp-cl-cdr2-${g.id}" class="cdr2-grp-chk" value="${g.val}" onchange="this.closest('.zy-chip-pill').classList.toggle('active', this.checked)">
      ${g.label}
    </label>`).join('');

  c.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="page-title"><i class="fas fa-chart-column" style="color:#2563eb;"></i> CDR 2 — Monthly Route Stats</div>
        <div class="page-subtitle">Monthly (30/5) {W} · PKR Earnings · Updated daily from official report · Historical dates preserved</div>
      </div>
      <div>
        <button type="button" class="btn btn-outline btn-sm" onclick="zyClientExportCdr2Report()"><i class="fas fa-download"></i> Export CSV</button>
      </div>
    </div>

    <div id="cdr2-daily-banner" style="margin-bottom:10px;"></div>

    <div class="zy-filter-grid" data-cdr-compact="1">
      <div class="zy-cdr-head-row">
        <span><i class="fas fa-sliders" style="color:#2563eb;margin-right:6px;"></i> Daily Stats Filters</span>
        <span id="cdr2-sync-status" style="font-size:12px;color:#64748b;">Daily company report · Monthly (30/5) {W}</span>
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
      </div>

      <div class="zy-groupby-card">
        <div class="zy-groupby-title"><i class="fas fa-layer-group" style="font-size:11px;color:var(--sp-text-muted,#64748b);"></i> Group By :</div>
        <div class="zy-groupby-chips">${chipsHtml}</div>
        <div class="zy-groupby-search-wrap">
          <input type="text" id="cdr2-search" class="zy-groupby-search-input"
            placeholder="Search Date, Range, Number, Service, PKR..."
            autocomplete="off"
            oninput="zyHandleCdrSearchInput(this, 'cdr2-search-clear', () => pgClientCdr2Load(1))"
            onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._zyCdrSearchTimer){clearTimeout(window._zyCdrSearchTimer);}pgClientCdr2Load(1);}">
          <button type="button" id="cdr2-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearCdrSearch('cdr2-search', 'cdr2-search-clear', () => pgClientCdr2Load(1))">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="zy-table-toolbar zy-cdr-control-bar">
        <div class="zy-cdr-actions-left" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="zy-btn-blue-solid" id="btn-show-cdr2" onclick="pgClientCdr2Load(1)"><i class="fas fa-chart-column"></i> Show Report</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="zyResetClientCdr2Filters()"><i class="fas fa-rotate-left"></i> Reset</button>
        </div>
        <div class="zy-toolbar-right">
          <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('dt-cdr2', this)"><i class="fas fa-columns"></i> Columns</button>
          <div class="zy-toolbar-select-wrap">
            <label class="zy-toolbar-label" for="cdr2-limit">Show Records</label>
            <select id="cdr2-limit" class="zy-toolbar-select" onchange="pgClientCdr2Load(1)">
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

  const [rateCardRes, cdr2Status] = await Promise.all([
    apiFetch('/api/client/rate-card').catch(() => ({ ranges: [] })),
    apiFetch('/api/cdr2/status', { silent: true }).catch(() => null)
  ]);
  if (rateCardRes?.usd_to_pkr_rate) window._zyClientFx = Number(rateCardRes.usd_to_pkr_rate);
  const ranges = (Array.isArray(rateCardRes?.ranges) ? rateCardRes.ranges : []).filter(r => zyClientIsWhitenoiseObj(r));
  const rEl = document.getElementById('cdr2-range');
  if (rEl) {
    rEl.innerHTML = `<option value="">All Monthly Ranges</option>` +
      ranges.map(r => `<option value="${r.range_id || r.id}">${zyEsc(r.range_name || r.name || r.country || '')}${r.prefix ? ` (${zyEsc(r.prefix)})` : ''}</option>`).join('');
  }
  if (cdr2Status && typeof window.zyRenderCdr2DailyBanner === 'function') {
    window.zyRenderCdr2DailyBanner('cdr2-daily-banner', cdr2Status);
  }
  if (cdr2Status && !cdr2Status.terms_accepted && typeof window.zyOpenCdr2TermsModal === 'function') {
    window.zyOpenCdr2TermsModal({
      viewOnly: false,
      onAccepted: () => pgClientCdr2Load(1)
    });
  } else {
    pgClientCdr2Load(1);
  }
}

window.zyResetClientCdr2Filters = function() {
  const today = (typeof zyToday === 'function' ? zyToday() : new Date().toISOString().slice(0, 10));
  const f = document.getElementById('cdr2-from'); if (f) f.value = `${today.slice(0, 7)}-01 00:00:00`;
  const t = document.getElementById('cdr2-to'); if (t) t.value = `${today} 23:59:59`;
  ['cdr2-range', 'cdr2-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const clr = document.getElementById('cdr2-search-clear');
  if (clr) clr.style.display = 'none';
  document.querySelectorAll('.cdr2-grp-chk').forEach(cb => {
    cb.checked = false;
    cb.closest('.zy-chip-pill')?.classList.remove('active');
  });
  pgClientCdr2Load(1);
};

window.zyClientExportCdr2Report = function() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const checkedBoxes = Array.from(document.querySelectorAll('.cdr2-grp-chk:checked')).map(cb => cb.value);
  const p = new URLSearchParams({ export: 'csv' });
  if (typeof CLIENT_ID !== 'undefined' && CLIENT_ID) p.set('client_id', CLIENT_ID);
  if (val('cdr2-from')) p.set('date_from', val('cdr2-from'));
  if (val('cdr2-to')) p.set('date_to', val('cdr2-to'));
  if (val('cdr2-range')) p.set('range', val('cdr2-range'));
  if (val('cdr2-search').trim()) p.set('search', val('cdr2-search').trim());
  if (checkedBoxes.length) p.set('group_by', checkedBoxes.join(','));
  if (typeof zyDownloadFile === 'function') zyDownloadFile(`/api/cdr2/export?${p.toString()}`, 'cdr2_monthly.csv');
};

async function pgClientCdr2Load(page = 1) {
  const targetPage = typeof page === 'number' ? page : 1;
  const body = document.getElementById('cdr2-body');
  if (!body) return;

  if (window._clientCdr2AbortController) {
    try { window._clientCdr2AbortController.abort(); } catch (_) {}
  }
  window._clientCdr2AbortController = new AbortController();
  const reqSignal = window._clientCdr2AbortController.signal;

  const val = id => (document.getElementById(id) || {}).value || '';
  const from = val('cdr2-from'), to = val('cdr2-to');
  const rangeId = val('cdr2-range');
  const search = val('cdr2-search').trim();

  body.innerHTML = `<div class="zy-loading" style="padding:36px;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin fa-lg" style="color:#2563eb;"></i><div style="margin-top:8px;">Loading CDR 2 daily stats…</div></div>`;

  const checkedBoxes = Array.from(document.querySelectorAll('.cdr2-grp-chk:checked')).map(cb => cb.value);
  const params = new URLSearchParams();
  if (typeof CLIENT_ID !== 'undefined' && CLIENT_ID) params.append('client_id', CLIENT_ID);
  if (from) params.append('date_from', from);
  if (to) params.append('date_to', to);
  if (rangeId) params.append('range', rangeId);
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
    const sum = logs.summary || {};
    const fx = Number(sum.usd_to_pkr_rate || window._zyClientFx || 280);

    if (!data.length) {
      body.innerHTML = `
        <div style="padding:40px 24px;text-align:center;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">
          <i class="fas fa-chart-column" style="font-size:26px;color:#94a3b8;margin-bottom:8px;"></i>
          <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:4px;">No Daily Stats Yet for Selected Dates</div>
          <div style="font-size:13px;color:#64748b;">Your Monthly Route (CDR 2) SMS counts &amp; PKR earnings update daily after the company report is uploaded.</div>
        </div>`;
      return;
    }

    if (logs && logs.grouped && checkedBoxes.length) {
      const keyLabels = { date: 'Date', month: 'Month', range: 'Range', number: 'Number', cli: 'Service / CLI' };
      const cols = [...checkedBoxes.map(k => keyLabels[k] || k), 'SMS Count', 'Cycle', 'My Earnings (PKR)'];
      const rows = data.map(g => {
        const gPkr = g.client_payout_pkr != null ? Number(g.client_payout_pkr) : (Number(g.client_payout || g.payout || 0) * fx);
        return [
          ...checkedBoxes.map(k => g[k] || '—'),
          { v: g.sms_count || 0, h: `<span class="monospace" style="font-weight:700;">${Number(g.sms_count || 0).toLocaleString()}</span>` },
          'Monthly (30/5) {W}',
          { v: gPkr, h: `<span class="monospace" style="color:#059669;font-weight:700;">Rs. ${zyFmtMoney(gPkr, 2)}</span>` }
        ];
      });
      const totalGroups = logs.total != null ? logs.total : (sum.total_groups != null ? sum.total_groups : data.length);
      const totalSms = sum.total_sms != null ? sum.total_sms : data.reduce((s, g) => s + (g.sms_count || 0), 0);
      const totalPkr = sum.client_payout_pkr != null ? Number(sum.client_payout_pkr) : data.reduce((s, g) => s + (Number(g.client_payout_pkr ?? ((g.client_payout || g.payout || 0) * fx)) || 0), 0);

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
        onPageChange: (p) => pgClientCdr2Load(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('cdr2-limit');
          if (sel) sel.value = String(s);
          pgClientCdr2Load(1);
        },
        footRow: `<td><b>Total Groups: ${Number(totalGroups).toLocaleString()}</b></td>` + '<td></td>'.repeat(Math.max(0, checkedBoxes.length - 1)) +
          `<td class="monospace"><b>${totalSms.toLocaleString()}</b></td><td><b>Monthly (30/5) {W}</b></td><td class="monospace" style="color:#059669;"><b>Rs. ${zyFmtMoney(totalPkr, 2)}</b></td>`
      });
      zy2Render('dt-cdr2');
    } else {
      const cols = ['Date', 'Range', 'Number', 'Service / CLI', 'SMS Count', 'Rate (PKR)', 'My Earnings (PKR)', 'Cycle'];
      const rows = data.map(s => {
        const dStr = s.date_ymd || String(s.date || s.timestamp || '').replace('T', ' ').slice(0, 10);
        const smsCnt = Number(s.sms_count) > 0 ? Math.round(Number(s.sms_count)) : 1;
        const myPkr = s.client_amount_pkr != null
          ? Number(s.client_amount_pkr)
          : (s.my_payout_pkr != null ? Number(s.my_payout_pkr) : ((parseFloat(s.client_payout ?? s.client_rate ?? 0) || 0) * (Number(s.fx_usd_to_pkr) || fx)));
        const unitPkr = Number(s.unit_client_rate_pkr != null ? s.unit_client_rate_pkr : (smsCnt > 0 ? myPkr / smsCnt : 0));
        const maskedCli = typeof zyMaskCli === 'function' ? zyMaskCli(s.cli || s.service || s.app || 'General') : (s.cli || s.service || s.app || 'General');
        const numStr = String(s.number || '').trim();
        const clearLabel = s.clears_at ? `Clears ${String(s.clears_at).slice(0, 10)}` : 'Monthly (30/5) {W}';

        return [
          { v: dStr, h: `<span class="monospace" style="font-weight:600;">${zyEsc(dStr)}</span>` },
          zyEsc(s.range_name || s.range_label || s.range || s.country || '—'),
          { v: numStr, h: numStr ? `<span class="monospace" style="font-weight:600;">${zyEsc(numStr)}</span>` : '—' },
          { v: maskedCli, h: `<span class="monospace">${zyEsc(maskedCli)}</span>` },
          { v: smsCnt, h: `<span class="monospace" style="font-weight:700;">${smsCnt.toLocaleString()}</span>` },
          { v: unitPkr, h: `<span class="monospace" style="color:#64748b;">Rs. ${zyFmtMoney(unitPkr, 2)}</span>` },
          { v: myPkr, h: `<span class="monospace" style="color:#059669;font-weight:700;">Rs. ${zyFmtMoney(myPkr, 2)}</span>` },
          `<span style="font-size:11.5px;color:#4338ca;font-weight:600;">${zyEsc(clearLabel)}</span>`
        ];
      });

      const totalSms = sum.total_sms != null ? sum.total_sms : data.reduce((a, s) => a + (Number(s.sms_count) || 1), 0);
      const totalPkr = sum.client_payout_pkr != null ? Number(sum.client_payout_pkr) : data.reduce((a, s) => a + (Number(s.client_amount_pkr ?? ((parseFloat(s.client_payout ?? s.client_rate ?? 0) || 0) * (Number(s.fx_usd_to_pkr) || fx))) || 0), 0);

      body.innerHTML = zyDT2('dt-cdr2', {
        cols, rows, hideToolbar: true, sort: 0, dir: -1, perPage: effectiveLimit, serverMode: true,
        totalRecords: logs.total != null ? logs.total : data.length,
        totalPages: logs.total_pages || 1,
        page: logs.page || targetPage,
        onPageChange: (p) => pgClientCdr2Load(p),
        onSizeChange: (s) => {
          const sel = document.getElementById('cdr2-limit');
          if (sel) sel.value = String(s);
          pgClientCdr2Load(1);
        },
        footRow: `<td><b>Rows: ${Number(logs.total || data.length).toLocaleString()}</b></td>` + '<td></td>'.repeat(3) +
          `<td class="monospace"><b>${totalSms.toLocaleString()}</b></td><td></td>` +
          `<td class="monospace" style="color:#059669;"><b>Rs. ${zyFmtMoney(totalPkr, 2)}</b></td>` +
          `<td><b>Monthly (30/5) {W}</b></td>`
      });
      zy2Render('dt-cdr2');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error('Client CDR 2 load error:', err);
    body.innerHTML = `<div class="zy-empty" style="padding:40px;text-align:center;color:#ef4444;">${zyEsc(err.message || 'Failed to load CDR 2 records.')}</div>`;
  }
}

/* ═══ CREDIT NOTES ═══════════════════════════════════════════ */
async function pgClientCreditNotes() {
  const c = document.getElementById('page-content');
  zyCrumb(['Credit Notes']);
  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-file-invoice" style="color:#2563eb;"></i> My Credit Notes</div>
        <div class="page-subtitle">Review your earned credit notes and download official settlement vouchers.</div>
      </div>
    </div>
    <div class="card zy-panel">
      <div class="card-header zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;">
        <span class="card-title">My Credit Notes</span>
      </div>
      <div class="card-body zy-panel-body" id="ccn-body"><div class="zy-loading">Loading…</div></div>
    </div>`;
  pgClientCreditNotesLoad();
}

async function pgClientCreditNotesLoad() {
  const body = document.getElementById('ccn-body');
  if (!body) return;
  body.innerHTML = `<div class="zy-loading">Loading…</div>`;
  const [cnRes, settings] = await Promise.all([
    apiFetch('/api/credit-notes?limit=500'),
    apiFetch('/api/settings').catch(() => ({}))
  ]);
  const fx = Number(settings?.usd_to_pkr_rate || window._zyClientFx || 280);
  const list = zyList(cnRes);
  const rows = list.map(n => {
    const due = new Date(String(n.date || n.created || '').slice(0, 10));
    due.setDate(due.getDate() + 1);
    const isPkr = String(n.currency || '').toUpperCase() === 'PKR';
    const amtPkr = isPkr ? Number(n.amount || 0) : (Number(n.amount || 0) * (Number(n.fx_usd_to_pkr) || fx));
    return [
      (n.date || n.created || '').slice(0, 10),
      zyEsc(n.reason || 'SMS Settlement Credit Note'),
      zyEsc(n.term || 'Weekly'),
      'PKR',
      `<span class="zy-cl-rc-rate">Rs. ${zyFmtMoney(amtPkr, 2)}</span>`,
      isNaN(due) ? '' : due.toISOString().slice(0, 10),
      { v: '', h: `<button class="zy-rowbtn" onclick="zyClientCreditPdf(${Number(n.id)})" title="Download Voucher"><i class="fas fa-file-invoice" style="color:var(--sp-primary);"></i></button>` }
    ];
  });
  body.innerHTML = zyDT2('dt-ccn', {
    cols: ['Date', 'Description', 'Term', 'Currency', 'Amount (PKR)', 'Due Date', 'Voucher'], rows, sort: 0, dir: -1 });
  zy2Render('dt-ccn');
}

async function zyClientCreditPdf(id) {
  try {
    const res = await fetch(`/api/credit-notes/${Number(id)}/pdf`, { credentials: 'include' });
    if (!res.ok) { if (typeof toast === 'function') toast('Unable to open voucher', 'error'); return; }
    const html = await res.text();
    if (typeof window.zyPrintHtml === 'function') window.zyPrintHtml(html);
  } catch (_) {
    if (typeof toast === 'function') toast('Unable to open voucher', 'error');
  }
}

/* ═══ PAYMENT REQUESTS (100% PKR WALLET) ═══════════════════════ */
async function pgClientPaymentRequests() {
  const c = document.getElementById('page-content');
  zyCrumb(['Payment Requests']);

  let availBalPkr = 0;
  let mainBalPkr = 0;
  let pendingHoldPkr = 0;
  let thisWeekPkr = 0;
  let weekRangeStr = 'UTC Mon – Sun';
  let minPayoutPkr = 100;
  let fxRate = Number(window._zyClientFx || 280);

  let payInfo = null;
  try {
    const [balRes, earn, settings, pRes] = await Promise.all([
      apiFetch('/api/payments/balance').catch(() => null),
      apiFetch(`/api/client/${CLIENT_ID}/earnings`).catch(() => null),
      apiFetch('/api/settings').catch(() => ({})),
      apiFetch('/api/payments', { silent: true }).catch(() => null)
    ]);
    payInfo = pRes;
    fxRate = Number(settings?.usd_to_pkr_rate || balRes?.usd_to_pkr_rate || earn?.usd_to_pkr_rate || 280);
    window._zyClientFx = fxRate;
    mainBalPkr = Number(
      balRes?.main_balance_pkr ?? balRes?.balance_pkr ?? earn?.main_balance_pkr ?? (Number(earn?.main_balance ?? 0) * fxRate)
    );
    pendingHoldPkr = Number(balRes?.pending_hold_pkr || 0);
    availBalPkr = Number(
      balRes?.available_balance_pkr != null
        ? balRes.available_balance_pkr
        : (earn?.available_balance_pkr != null ? earn.available_balance_pkr : Math.max(0, mainBalPkr - pendingHoldPkr))
    );
    thisWeekPkr = Number(earn?.this_week_pkr != null ? earn.this_week_pkr : (Number(earn?.this_week ?? 0) * fxRate));
    if (earn?.week_range) weekRangeStr = earn.week_range;
    if (settings?.min_payout_pkr != null) minPayoutPkr = Number(settings.min_payout_pkr);
    else if (settings?.min_payout != null) minPayoutPkr = Number(settings.min_payout);
  } catch (e) {
    availBalPkr = Number(CLIENT_USER?.balance_pkr ?? (Number(CLIENT_USER?.balance || 0) * fxRate));
    mainBalPkr = availBalPkr;
  }

  const hs = payInfo && payInfo.hold_summary ? payInfo.hold_summary : null;
  const m305 = payInfo && payInfo.monthly30_5 ? payInfo.monthly30_5 : null;
  const mc = (payInfo && payInfo.monthly_cycle) ? payInfo.monthly_cycle : {};
  const holdNoticeHtml = hs
    ? `<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:12px;color:#1e293b;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
         <span><i class="fas fa-hourglass-half" style="color:#d97706;margin-right:6px;"></i> <b>Payterm Hold Summary (PKR):</b> Cleared: <b style="color:#059669;">Rs. ${zyFmtMoney(Number(hs.cleared_pkr || 0), 4)}</b> · On Hold: <b style="color:#d97706;">Rs. ${zyFmtMoney(Number(hs.held_pkr || 0), 4)}</b> (Next release: <b>${zyEsc(hs.next_release_date || '—')}</b>)</span>
         <span style="font-size:11px;color:#64748b;">Weekly 7/3 (3d) · Monthly 30/5 {W} (5d)</span>
       </div>`
    : '';
  const m305Start = m305?.cycle_start || mc.start_date || '—';
  const m305End = m305?.cycle_end || mc.end_date || '—';
  const m305Clear = m305?.clear_date || mc.clear_date || m305?.next_release_date || '—';
  const wnNoticeHtml = holdNoticeHtml + ((payInfo && (payInfo.whitenoise_access || window.ZY_WHITENOISE_ACCESS) && m305)
    ? `<div style="background:linear-gradient(135deg,#eef2ff,#f8fafc);border:1.5px solid #c7d2fe;border-radius:10px;padding:12px 14px;margin-bottom:14px;color:#1e1b4b;">
         <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
           <span style="font-size:13px;font-weight:800;color:#312e81;">
             <i class="fas fa-calendar-check" style="color:#4f46e5;margin-right:6px;"></i> Monthly Cycle (30/5) {W} Settlement Box
           </span>
           <span class="badge" style="background:#fff;color:#4338ca;border:1px solid #c7d2fe;font-weight:700;">Cycle: ${zyEsc(m305Start)} → ${zyEsc(m305End)}</span>
         </div>
         <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;font-size:12px;">
           <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
             <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">Cleared Ready (PKR)</div>
             <div style="font-size:15px;font-weight:800;color:#059669;margin-top:2px;">Rs. ${zyFmtMoney(Number(m305.cleared_pkr || 0), 4)}</div>
           </div>
           <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
             <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">Held in Cycle (5d Hold)</div>
             <div style="font-size:15px;font-weight:800;color:#d97706;margin-top:2px;">Rs. ${zyFmtMoney(Number(m305.held_pkr || 0), 4)}</div>
           </div>
           <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
             <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">Company Clear Date</div>
             <div style="font-size:14px;font-weight:800;color:#4338ca;margin-top:2px;">${zyEsc(m305Clear)}</div>
           </div>
           <div style="background:#fff;border:1px solid #e0e7ff;border-radius:8px;padding:8px 10px;">
             <div style="color:#64748b;font-size:10.5px;font-weight:700;text-transform:uppercase;">Cycle SMS Count</div>
             <div style="font-size:15px;font-weight:800;color:#0f172a;margin-top:2px;">${Number(m305.sms_count || 0).toLocaleString()}</div>
           </div>
         </div>
         <div style="font-size:11px;color:#4338ca;margin-top:8px;">All Monthly (30/5) {W} earnings from <b>${zyEsc(m305Start)}</b> to <b>${zyEsc(m305End)}</b> settle together on <b>${zyEsc(m305Clear)}</b>.</div>
       </div>`
    : '');

  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title"><i class="fas fa-wallet" style="color:#2563eb;"></i> Payment Requests (PKR)</div>
        <div class="page-subtitle">View your PKR account balance and submit local payout requests to your Agent.</div>
      </div>
    </div>

    <!-- HUMEX SMS 2-Card Metric Row (PKR Only) -->
    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px;margin-bottom:16px;">
      <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1px solid #cbd5e1;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.04);display:flex;flex-direction:column;justify-content:space-between;min-height:115px;">
        <div>
          <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.3px;">Available Balance (PKR)</div>
          <div style="font-size:24px;font-weight:800;color:#0f172a;margin:4px 0 6px;font-variant-numeric:tabular-nums;">Rs. <span id="cpr-bal-val">${availBalPkr.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></div>
          <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span><i class="fas fa-info-circle" style="color:#0ea5e9;"></i> Min payout: <strong>Rs. ${zyFmtMoney(minPayoutPkr, 2)} PKR</strong></span>
            ${pendingHoldPkr > 0 ? `<span style="color:#d97706;">· Pending Hold: <b>Rs. ${zyFmtMoney(pendingHoldPkr, 4)}</b></span>` : ''}
          </div>
        </div>
        <div style="margin-top:12px;">
          <button type="button" class="sp-btn-primary" style="height:32px;padding:0 14px;font-size:12px;font-weight:700;border-radius:6px;display:inline-flex;align-items:center;gap:6px;background:#10b981;border:none;color:#fff;cursor:pointer;" onclick="zyClientRequestPayoutModal(${availBalPkr}, ${minPayoutPkr})">
            <i class="fas fa-paper-plane"></i> Request PKR Payout
          </button>
        </div>
      </div>

      <div class="sp-card" style="padding:14px 16px;border-radius:10px;border:1px solid #cbd5e1;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.04);display:flex;flex-direction:column;justify-content:space-between;min-height:115px;">
        <div>
          <div style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.3px;">This Week Mon-Sun (PKR)</div>
          <div style="font-size:24px;font-weight:800;color:#2563eb;margin:4px 0 6px;font-variant-numeric:tabular-nums;">Rs. <span id="cpr-week-val">${thisWeekPkr.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></div>
          <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:4px;">
            <i class="fas fa-calendar-alt" style="color:#8b5cf6;"></i> <span>${zyEsc(weekRangeStr)}</span>
          </div>
        </div>
        <div style="margin-top:12px;font-size:11.5px;color:#059669;font-weight:600;display:flex;align-items:center;gap:5px;">
          <i class="fas fa-check-circle"></i> Settled directly in PKR by your Agent
        </div>
      </div>
    </div>
    ${wnNoticeHtml}

    <div class="zy-panel">
      <div class="zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;">
        <span>My PKR Payout Requests</span>
      </div>
      <div class="zy-panel-body" id="cpr-body"><div class="zy-loading">Loading…</div></div>
    </div>`;

  pgClientPaymentRequestsLoad();
}

window.zyUpdateClientMethodHint = function() {
  const m = document.getElementById('cpr-method')?.value || '';
  const wInp = document.getElementById('cpr-wallet');
  if (!wInp) return;
  if (m.includes('Bank')) {
    wInp.placeholder = 'Bank Name, Account Title & 24-digit IBAN (PK...)';
  } else {
    wInp.placeholder = `${m} Mobile Number (03XX-XXXXXXX) & Account Title`;
  }
};

window.zyClientRequestPayoutModal = async function(currentBalPkr = 0, passedMinPkr = null) {
  let minPayoutPkr = passedMinPkr != null ? Number(passedMinPkr) : 100;
  try {
    const settings = await apiFetch('/api/settings');
    if (settings?.min_payout_pkr != null) minPayoutPkr = Number(settings.min_payout_pkr);
    else if (settings?.min_payout != null) minPayoutPkr = Number(settings.min_payout);
  } catch (e) { console.warn('Client settings fetch error:', e); }

  const savedDetails = (window.CLIENT_USER && (CLIENT_USER.iban || CLIENT_USER.wallet || CLIENT_USER.account_number)) || '';
  const defaultAmt = currentBalPkr >= minPayoutPkr ? zyFmtMoney(currentBalPkr, 2) : zyFmtMoney(minPayoutPkr, 2);

  zyModal('Request PKR Payout', `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="color:#64748b;">Available Balance (PKR):</span>
        <strong style="color:#10b981;font-size:15px;">Rs. ${Number(currentBalPkr).toLocaleString('en-US', { maximumFractionDigits: 2 })} PKR</strong>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:#64748b;">Minimum Payout:</span>
        <strong>Rs. ${zyFmtMoney(Number(minPayoutPkr), 2)} PKR</strong>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">Payout Amount (PKR) *</label>
      <input type="number" id="cpr-amount" class="zy-input" style="width:100%;height:38px;" step="0.01" min="${minPayoutPkr}" max="${Math.max(minPayoutPkr, currentBalPkr)}" value="${defaultAmt}">
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">PKR Payment Method *</label>
      <select id="cpr-method" class="zy-input" style="width:100%;height:38px;" onchange="zyUpdateClientMethodHint()">
        <option value="Bank Transfer (IBAN)" selected>Bank Transfer (IBAN)</option>
        <option value="JazzCash">JazzCash</option>
        <option value="Easypaisa">Easypaisa</option>
        <option value="SadaPay / NayaPay">SadaPay / NayaPay</option>
      </select>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="zy-lbl" style="font-weight:600;">IBAN / Mobile Wallet &amp; Account Title *</label>
      <input type="text" id="cpr-wallet" class="zy-input" style="width:100%;height:38px;" value="${zyEsc(savedDetails)}" placeholder="Bank Name, Account Title &amp; 24-digit IBAN (PK...)">
    </div>
    <div class="form-group" style="margin-bottom:8px;">
      <label class="zy-lbl" style="font-weight:600;">Notes (Optional)</label>
      <input type="text" id="cpr-notes" class="zy-input" style="width:100%;height:38px;" placeholder="Weekly PKR payout request">
    </div>
  `, `
    <button class="zy-btn-grey" onclick="closeModal()">Cancel</button>
    <button class="sp-btn-primary" id="btn-submit-cpr" onclick="zySubmitClientPayout(${minPayoutPkr}, ${currentBalPkr})"><i class="fas fa-paper-plane"></i> Submit PKR Request</button>
  `);
};

window.zySubmitClientPayout = async function(minPayoutPkr, currentBalPkr) {
  const amt = parseFloat(document.getElementById('cpr-amount')?.value);
  const method = document.getElementById('cpr-method')?.value;
  const wallet = document.getElementById('cpr-wallet')?.value.trim();
  const notes = document.getElementById('cpr-notes')?.value.trim();

  if (isNaN(amt) || amt <= 0) { toast('Please enter a valid PKR payout amount', 'error'); return; }
  if (amt < minPayoutPkr) { toast(`Payment low. Minimum payout is Rs. ${zyFmtMoney(minPayoutPkr, 2)} PKR`, 'error'); return; }
  if (amt > currentBalPkr) { toast(`Amount cannot exceed available balance of Rs. ${zyFmtMoney(currentBalPkr, 2)} PKR`, 'error'); return; }
  if (!wallet) { toast('Please provide your IBAN / JazzCash / Easypaisa account details', 'error'); return; }

  const btn = document.getElementById('btn-submit-cpr');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const res = await apiFetch('/api/payout-requests', {
      method: 'POST',
      body: JSON.stringify({
        amount: amt,
        currency: 'PKR',
        method,
        wallet,
        notes,
        role: 'Client',
        client_id: CLIENT_ID
      })
    });
    if (res && (res.id || res.success)) {
      closeModal();
      toast('PKR payout request submitted to your Agent', 'success');
      pgClientPaymentRequests();
    } else {
      toast(res?.error || 'Failed to submit payout request', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit PKR Request'; }
    }
  } catch (err) {
    toast(err.message || 'Error submitting payout request', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit PKR Request'; }
  }
};

async function pgClientPaymentRequestsLoad() {
  const body = document.getElementById('cpr-body');
  if (!body) return;
  body.innerHTML = `<div class="zy-loading">Loading…</div>`;
  const fx = Number(window._zyClientFx || 280);
  const list = zyList(await apiFetch(`/api/payout-requests?client_id=${CLIENT_ID}&limit=200`));
  const rows = list.map(r => {
    const ts = r.timestamp || r.created || r.created_at || r.date;
    const isPaid = (r.status || '').toLowerCase() === 'paid';
    const isRejected = (r.status || '').toLowerCase() === 'rejected';
    const statusClass = isPaid ? 'status-active' : (isRejected ? 'status-inactive' : 'status-pending');
    const statusLabel = (r.status || 'Pending').toUpperCase();
    const isPkr = String(r.currency || '').toUpperCase() === 'PKR';
    const amtPkr = isPkr ? Number(r.amount || 0) : (Number(r.amount || 0) * (Number(r.fx_usd_to_pkr) || fx));
    const paidPkr = isPkr ? Number(r.paid_amount || r.amount || 0) : (Number(r.paid_amount || r.amount || 0) * (Number(r.fx_usd_to_pkr) || fx));

    return [
      (ts || '').replace('T', ' ').slice(0, 19),
      zyEsc(r.method || r.mode || 'Bank Transfer (IBAN)'),
      `<span class="zy-cl-rc-rate">Rs. ${zyFmtMoney(amtPkr, 2)}</span>`,
      { v: r.status || 'Pending', h: `<span class="badge ${statusClass}">${statusLabel}</span>` },
      zyEsc(r.wallet || r.address || '—'),
      isPaid ? `Rs. ${zyFmtMoney(paidPkr, 2)}` : '—',
      zyEsc(r.txid || r.transaction_id || '—'),
      zyEsc(r.notes || r.remarks || '—'),
      r.updated_at ? zyDateOnly(r.updated_at) : (r.paid_at ? zyDateOnly(r.paid_at) : (isPaid ? 'Paid' : '—'))
    ];
  });
  body.innerHTML = zyDT2('dt-cpr', {
    cols: ['Date', 'Method', 'Amount (PKR)', 'Status', 'Account / Wallet', 'Paid (PKR)', 'Transaction', 'Remarks', 'Updated On'],
    rows,
    sort: 0,
    dir: -1
  });
  zy2Render('dt-cpr');
}

/* ═══ CLIENT NOTIFICATIONS CENTER (Live Role-Aware Engine) ═══ */
async function pgClientNotifications() {
  if (window.HumexNotifications && typeof window.HumexNotifications.renderPage === 'function') {
    window.HumexNotifications.renderPage('page-content');
    return;
  }
  const c = document.getElementById('page-content');
  zyCrumb(['Notifications']);
  c.innerHTML = `<div class="card zy-panel"><div class="card-body zy-panel-body" style="text-align:center;padding:48px 20px;">Loading Notifications...</div></div>`;
}

async function pgClientNotificationsLoad() {
  if (window.HumexNotifications) return window.HumexNotifications.refresh();
}
window.zyClientMarkSingleRead = async function(id) {
  if (window.HumexNotifications) return window.HumexNotifications.markSingleRead(id);
};
window.zyClientMarkAllRead = async function() {
  if (window.HumexNotifications) return window.HumexNotifications.markAllRead();
};
window.zyClientWipeNotifications = async function() {
  if (window.HumexNotifications) return window.HumexNotifications.clearAll();
};

/* ── router ─────────────────────────────────────────────────── */
(function zyHookClientPages() {
  const map = {
    'dashboard': () => pgDashboard(),
    'my-numbers': pgMyNumbers,
    'sms-overview': pgSmsRanges,
    'sms-ranges': pgSmsRanges,
    'sms-ratecard': pgSmsRanges,
    'my-sms': pgMySms,
    'cdr2': pgCdr2,
    'my-earnings': pgClientCreditNotes,
    'payout-requests': pgClientPaymentRequests,
    'my-balance': pgClientPaymentRequests,
    'news': pgClientNotifications,
    'notifications': pgClientNotifications,
    'live-chat': () => { if (window.HumexLiveChat) window.HumexLiveChat.renderPage('page-content'); },
    'my-profile': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', 'details'); },
    'profile': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', 'details'); },
    'profile-security': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', 'security'); },
    '2fa': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', '2fa'); },
    'audit-logs': () => { if (window.HumexProfile) window.HumexProfile.render('page-content', 'audit'); }
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
      try { sessionStorage.setItem('client_current_page', page); } catch (e) {}
      map[page]();
      return;
    }
    prev(page);
    if (typeof zySyncAccordionActive === 'function') zySyncAccordionActive(page);
    if (window.zyCloseSidebar) window.zyCloseSidebar();
  };
})();
