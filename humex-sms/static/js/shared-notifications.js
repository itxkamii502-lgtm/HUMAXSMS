/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Real-Time Role-Aware Notification Engine (V1)
   - Bell Popover showing strictly latest 5 notifications + "Show All"
   - Live WebSocket delivery (same-second badge, popover, page & banner)
   - Full Notifications Center Page with filters, search & role isolation
   - Per-user Notification Settings (Live Banner, Sound Chime, Categories)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  if (typeof window === 'undefined' || window.HumexNotifications) return;

  function detectRole() {
    const p = (location.pathname || '').toLowerCase();
    if (p.includes('/ints/client') || p.endsWith('client.html') || p.includes('/client')) return 'client';
    if (p.includes('/ints/agent') || p.endsWith('agent.html') || p.includes('/agent')) return 'agent';
    return 'owner';
  }

  const ROLE = detectRole();
  const SHOW_ALL_ROUTE = ROLE === 'client' ? 'news' : 'notifications';

  const DEFAULT_PREFS = {
    live_toast: true,
    sound_enabled: true,
    categories: {
      numbers: true,
      requests: true,
      payments: true,
      system: true
    }
  };

  function normalizePrefs(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const cats = (src.categories && typeof src.categories === 'object') ? src.categories : {};
    return {
      live_toast: src.live_toast !== false,
      sound_enabled: src.sound_enabled !== false,
      categories: {
        numbers: cats.numbers !== false,
        requests: cats.requests !== false,
        payments: cats.payments !== false,
        system: cats.system !== false
      }
    };
  }

  const state = {
    topFive: [],
    unreadCount: 0,
    totalCount: 0,
    prefs: normalizePrefs(DEFAULT_PREFS),
    dropdownOpen: false,
    ws: null,
    wsConnected: false,
    wsAttempts: 0,
    wsReconnectTimer: null,
    pollTimer: null,
    seenIds: new Set(),
    audioCtx: null,
    page: {
      mounted: false,
      containerId: 'page-content',
      tab: 'all',
      scope: 'mine',
      search: '',
      items: [],
      loading: false
    }
  };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function reqJson(url, opts = {}) {
    if (typeof window.apiFetch === 'function' && !opts.rawFetch) {
      return window.apiFetch(url, { silent: true, ...opts });
    }
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function inferCategory(n) {
    const raw = String((n && (n.category || (n.metadata && n.metadata.category))) || '').toLowerCase();
    if (['numbers', 'requests', 'payments', 'system'].includes(raw)) return raw;
    const t = String((n && n.type) || '').toLowerCase();
    if (t === 'allocation' || t === 'revocation' || t === 'numbers') return 'numbers';
    if (t === 'request' || t === 'request_approved' || t === 'request_rejected') return 'requests';
    if (t === 'payout' || t === 'payment') return 'payments';
    return 'system';
  }

  function visualMeta(n) {
    const t = String((n && n.type) || '').toLowerCase();
    const st = String((n && (n.status || (n.metadata && n.metadata.status))) || '').toLowerCase();
    const cat = inferCategory(n);

    if (t === 'request_rejected' || st === 'rejected') {
      return { icon: 'fa-circle-xmark', tone: 'danger', label: 'Rejected' };
    }
    if (t === 'revocation' || st === 'revoked') {
      return { icon: 'fa-rotate-left', tone: 'warning', label: 'Recalled' };
    }
    if (t === 'request_approved' || st === 'approved' || st === 'fulfilled' || st === 'paid') {
      return { icon: 'fa-circle-check', tone: 'success', label: st === 'paid' ? 'Paid' : 'Approved' };
    }
    if (t === 'allocation' || cat === 'numbers') {
      return { icon: 'fa-sim-card', tone: 'success', label: 'Numbers' };
    }
    if (t === 'request' || cat === 'requests') {
      return { icon: 'fa-inbox', tone: 'primary', label: 'Request' };
    }
    if (t === 'payout' || t === 'payment' || cat === 'payments') {
      return { icon: 'fa-wallet', tone: 'info', label: 'Payment' };
    }
    return { icon: 'fa-bullhorn', tone: 'neutral', label: 'System' };
  }

  function relativeTime(iso) {
    if (!iso) return 'Just now';
    const ts = new Date(iso).getTime();
    if (isNaN(ts)) return String(iso).slice(0, 16);
    const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 10) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return String(iso).replace('T', ' ').slice(0, 10);
  }

  function formatUtcTime(iso) {
    if (!iso) return '—';
    return String(iso).replace('T', ' ').slice(0, 19) + ' UTC';
  }

  function buildChipsHtml(n, includeRecipient = false) {
    const chips = [];
    const rangeName = n.range_name || (n.metadata && n.metadata.range_name) || '';
    const payterm = n.payterm || (n.metadata && n.metadata.payterm) || '';
    const rateLabel = n.rate_label || (n.metadata && n.metadata.rate_label) || '';
    const qty = Number(n.count || (n.metadata && n.metadata.count) || 0);
    const status = n.status || (n.metadata && n.metadata.status) || '';

    if (rangeName) {
      chips.push(`<span class="zy-notif-chip chip-range"><i class="fas fa-layer-group"></i> ${esc(rangeName)}</span>`);
    }
    if (payterm) {
      chips.push(`<span class="zy-notif-chip chip-term"><i class="fas fa-calendar-week"></i> ${esc(payterm)}</span>`);
    }
    if (qty > 0) {
      chips.push(`<span class="zy-notif-chip chip-qty"><i class="fas fa-hashtag"></i> ${qty.toLocaleString()}</span>`);
    }
    if (rateLabel) {
      chips.push(`<span class="zy-notif-chip chip-rate"><i class="fas fa-tag"></i> ${esc(rateLabel)}</span>`);
    }
    if (status) {
      const sLow = String(status).toLowerCase();
      const cls = (sLow === 'approved' || sLow === 'fulfilled' || sLow === 'paid' || sLow === 'allocated' || sLow === 'resolved')
        ? 'chip-ok'
        : (sLow === 'rejected' || sLow === 'revoked' ? 'chip-bad' : 'chip-pending');
      const lbl = String(status).charAt(0).toUpperCase() + String(status).slice(1);
      chips.push(`<span class="zy-notif-chip ${cls}">${esc(lbl)}</span>`);
    }
    if (includeRecipient && n.recipient_role) {
      const rec = n.recipient_username ? `${n.recipient_role}: ${n.recipient_username}` : n.recipient_role;
      chips.push(`<span class="zy-notif-chip chip-role"><i class="fas fa-user"></i> ${esc(rec)}</span>`);
    }
    return chips.length ? `<div class="zy-notif-chips">${chips.join('')}</div>` : '';
  }

  function updateBadge(pulse = false) {
    const count = Math.max(0, Number(state.unreadCount || 0));
    if (typeof window.zyUpdateNotificationBadge === 'function') {
      window.zyUpdateNotificationBadge(count);
    } else {
      document.querySelectorAll('.zy-bell-badge').forEach(el => {
        if (count > 0) {
          el.textContent = count > 99 ? '99+' : String(count);
          el.style.display = 'inline-flex';
        } else {
          el.textContent = '0';
          el.style.display = 'none';
        }
      });
    }
    if (pulse) {
      document.querySelectorAll('.zy-bell-btn').forEach(btn => {
        btn.classList.remove('zy-bell-pulse');
        void btn.offsetWidth;
        btn.classList.add('zy-bell-pulse');
      });
    }
  }

  function playChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!state.audioCtx) state.audioCtx = new AudioCtx();
      const ctx = state.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const playTone = (freq, start, dur, vol) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(vol, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      };
      playTone(880, now, 0.14, 0.08);
      playTone(1174.66, now + 0.11, 0.22, 0.07);
    } catch (e) {}
  }

  function ensureLiveStack() {
    let stack = document.getElementById('zy-notif-live-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'zy-notif-live-stack';
      stack.className = 'zy-notif-live-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showLiveBanner(notif) {
    if (!notif) return;
    const cat = inferCategory(notif);
    if (!state.prefs.live_toast) return;
    if (state.prefs.categories && state.prefs.categories[cat] === false) return;

    const stack = ensureLiveStack();
    const vm = visualMeta(notif);
    const toast = document.createElement('div');
    toast.className = `zy-notif-live-toast tone-${vm.tone}`;
    toast.innerHTML = `
      <div class="zy-nlt-icon tone-${vm.tone}"><i class="fas ${vm.icon}"></i></div>
      <div class="zy-nlt-body">
        <div class="zy-nlt-head">
          <span class="zy-nlt-title">${esc(notif.title || 'New Notification')}</span>
          <span class="zy-nlt-time">Live</span>
        </div>
        <div class="zy-nlt-msg">${esc(notif.message || notif.body || '')}</div>
        ${buildChipsHtml(notif, false)}
      </div>
      <button type="button" class="zy-nlt-close" aria-label="Dismiss"><i class="fas fa-times"></i></button>
    `;

    const dismiss = () => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 220);
    };

    toast.querySelector('.zy-nlt-close').addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });

    toast.addEventListener('click', () => {
      dismiss();
      openNotificationTarget(notif);
    });

    stack.prepend(toast);
    while (stack.children.length > 3) {
      stack.lastElementChild.remove();
    }

    let timer = setTimeout(dismiss, 6500);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 3200); });
  }

  function resolveSafeRoute(actionPage) {
    const target = String(actionPage || '').trim();
    if (!target) return SHOW_ALL_ROUTE;
    if (ROLE === 'client') {
      if (target === 'notifications') return 'news';
      return target;
    }
    return target;
  }

  async function markSingleRead(id, silent = false) {
    if (!id) return;
    const targetId = Number(id);
    const itemTop = state.topFive.find(n => Number(n.id) === targetId);
    const itemPage = state.page.items.find(n => Number(n.id) === targetId);
    const wasUnread = (itemTop && !itemTop.read) || (itemPage && !itemPage.read);

    if (itemTop) itemTop.read = true;
    if (itemPage) itemPage.read = true;
    if (wasUnread) {
      state.unreadCount = Math.max(0, state.unreadCount - 1);
      updateBadge(false);
    }
    if (state.dropdownOpen) renderDropdownContent();
    if (state.page.mounted) renderPageListOnly();

    try {
      await reqJson(`/api/notifications/${targetId}/read`, { method: 'POST', body: JSON.stringify({}) });
    } catch (e) {
      if (!silent) console.warn('Mark read failed:', e);
    }
  }

  async function openNotificationTarget(notif) {
    if (!notif) return;
    if (!notif.read && notif.id) {
      markSingleRead(notif.id, true);
    }
    closeDropdown();
    const route = resolveSafeRoute(notif.action_page || (notif.metadata && notif.metadata.action_page));
    if (typeof window.loadPage === 'function' && route) {
      window.loadPage(route);
    }
  }

  async function markAllRead() {
    try {
      const payload = ROLE === 'owner'
        ? { role: state.page.mounted && state.page.scope === 'all' ? '' : 'owner', scope: state.page.mounted ? state.page.scope : 'mine' }
        : {};
      await reqJson('/api/notifications/mark-all-read', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      state.topFive.forEach(n => { n.read = true; });
      state.page.items.forEach(n => { n.read = true; });
      state.unreadCount = 0;
      updateBadge(false);
      if (state.dropdownOpen) renderDropdownContent();
      if (state.page.mounted) renderPageListOnly();
      if (typeof window.showToast === 'function') {
        window.showToast('All notifications marked as read', 'success');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to mark all as read', 'error');
      }
    }
  }

  async function deleteSingle(id) {
    if (!id) return;
    const targetId = Number(id);
    try {
      await reqJson(`/api/notifications/${targetId}`, { method: 'DELETE' });
      const wasUnread = state.page.items.some(n => Number(n.id) === targetId && !n.read)
        || state.topFive.some(n => Number(n.id) === targetId && !n.read);
      state.topFive = state.topFive.filter(n => Number(n.id) !== targetId);
      state.page.items = state.page.items.filter(n => Number(n.id) !== targetId);
      if (wasUnread) state.unreadCount = Math.max(0, state.unreadCount - 1);
      state.totalCount = Math.max(0, state.totalCount - 1);
      updateBadge(false);
      if (state.dropdownOpen) renderDropdownContent();
      if (state.page.mounted) renderPageListOnly();
      refreshHeaderFeed(true);
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Unable to remove notification', 'error');
      }
    }
  }

  async function clearAllNotifications(clearAllRoles = false) {
    try {
      const body = ROLE === 'owner'
        ? (clearAllRoles ? { clear_all: true } : { role: 'owner' })
        : {};
      await reqJson('/api/notifications/clear', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      state.topFive = [];
      state.page.items = [];
      state.unreadCount = 0;
      state.totalCount = 0;
      updateBadge(false);
      if (state.dropdownOpen) renderDropdownContent();
      if (state.page.mounted) renderPageListOnly();
      if (typeof window.closeModal === 'function') window.closeModal();
      if (typeof window.showToast === 'function') {
        window.showToast('Notifications cleared', 'success');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to clear notifications', 'error');
      }
    }
  }

  function promptClearAll() {
    const isAllScope = ROLE === 'owner' && state.page.scope === 'all';
    const bodyHtml = `
      <div style="padding:6px 2px;">
        <p style="margin:0 0 14px;color:var(--sp-text-secondary,#475569);font-size:13.5px;line-height:1.5;">
          ${isAllScope
            ? 'Clear all notifications across all roles? This removes stored notification history.'
            : 'Clear all notifications from your inbox? This action cannot be undone.'}
        </p>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
          <button type="button" class="btn btn-danger btn-sm" id="zy-confirm-clear-notifs">
            <i class="fas fa-trash-can"></i> Clear Notifications
          </button>
        </div>
      </div>
    `;
    if (typeof window.openModal === 'function') {
      window.openModal('Clear Notifications', bodyHtml);
    } else if (typeof window.zyModal === 'function') {
      window.zyModal('Clear Notifications', bodyHtml);
    } else {
      clearAllNotifications(isAllScope);
      return;
    }
    setTimeout(() => {
      const btn = document.getElementById('zy-confirm-clear-notifs');
      if (btn) btn.addEventListener('click', () => clearAllNotifications(isAllScope));
    }, 30);
  }

  async function refreshHeaderFeed(silent = true) {
    if (window.__AUTH_BLOCKED__) return;
    try {
      const data = await reqJson('/api/notifications/header-feed');
      if (!data) return;
      const list = Array.isArray(data.notifications) ? data.notifications.slice(0, 5) : [];
      state.topFive = list;
      state.unreadCount = Number(data.unread_count || 0);
      state.totalCount = Number(data.total_count != null ? data.total_count : list.length);
      if (data.preferences) {
        state.prefs = normalizePrefs(data.preferences);
      }
      list.forEach(n => { if (n && n.id) state.seenIds.add(Number(n.id)); });
      updateBadge(false);
      if (state.dropdownOpen) renderDropdownContent();
    } catch (e) {
      if (!silent) console.warn('Header feed error:', e);
    }
  }

  /* ── Bell Popover Dropdown (Strictly Top 5 + Show All) ── */
  function ensurePopoverEl() {
    let pop = document.getElementById('zy-notif-popover');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'zy-notif-popover';
      pop.className = 'zy-notif-popover';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Recent Notifications');
      pop.addEventListener('click', e => e.stopPropagation());
      document.body.appendChild(pop);
    }
    return pop;
  }

  function positionPopover(pop, triggerEl) {
    const rect = triggerEl ? triggerEl.getBoundingClientRect() : { bottom: 56, right: window.innerWidth - 16 };
    const vw = window.innerWidth;
    const width = Math.min(390, vw - 20);
    pop.style.width = `${width}px`;
    const top = Math.max(52, rect.bottom + 8);
    let left = rect.right - width;
    if (left < 10) left = 10;
    if (left + width > vw - 10) left = vw - width - 10;
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }

  function renderDropdownContent() {
    const pop = ensurePopoverEl();
    const items = state.topFive.slice(0, 5);
    const roleTitle = ROLE.charAt(0).toUpperCase() + ROLE.slice(1);

    const listHtml = items.length > 0
      ? items.map(n => {
          const vm = visualMeta(n);
          const unreadCls = n.read ? '' : 'is-unread';
          return `
            <div class="zy-np-item ${unreadCls}" data-notif-id="${Number(n.id)}">
              <div class="zy-np-icon tone-${vm.tone}"><i class="fas ${vm.icon}"></i></div>
              <div class="zy-np-content">
                <div class="zy-np-row">
                  <span class="zy-np-title">${esc(n.title || 'Notification')}</span>
                  <span class="zy-np-time">${esc(relativeTime(n.created || n.timestamp))}</span>
                </div>
                <div class="zy-np-msg">${esc(n.message || n.body || '')}</div>
                ${buildChipsHtml(n, false)}
              </div>
              ${!n.read ? '<span class="zy-np-dot" title="Unread"></span>' : ''}
            </div>
          `;
        }).join('')
      : `
        <div class="zy-np-empty">
          <div class="zy-np-empty-ic"><i class="fas fa-bell-slash"></i></div>
          <div class="zy-np-empty-title">You're all caught up</div>
          <div class="zy-np-empty-sub">Live ${esc(roleTitle)} alerts will appear here the second they happen.</div>
        </div>
      `;

    const extraCount = state.totalCount > 5 ? ` (${state.totalCount})` : '';

    pop.innerHTML = `
      <div class="zy-np-header">
        <div class="zy-np-hleft">
          <span class="zy-np-htitle">Notifications</span>
          ${state.unreadCount > 0 ? `<span class="zy-np-hcount">${state.unreadCount} new</span>` : ''}
        </div>
        <div class="zy-np-hactions">
          ${state.unreadCount > 0 ? `<button type="button" class="zy-np-act" id="zy-np-mark-all" title="Mark all as read"><i class="fas fa-check-double"></i> Mark read</button>` : ''}
          <button type="button" class="zy-np-gear" id="zy-np-settings" title="Notification Settings" aria-label="Notification Settings"><i class="fas fa-sliders"></i></button>
        </div>
      </div>
      <div class="zy-np-list">${listHtml}</div>
      <div class="zy-np-footer">
        <button type="button" class="zy-np-showall" id="zy-np-show-all">
          <span>Show All Notifications${extraCount}</span>
          <i class="fas fa-arrow-right"></i>
        </button>
      </div>
    `;

    const markAllBtn = pop.querySelector('#zy-np-mark-all');
    if (markAllBtn) markAllBtn.addEventListener('click', () => markAllRead());

    const settingsBtn = pop.querySelector('#zy-np-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        closeDropdown();
        openSettingsModal();
      });
    }

    const showAllBtn = pop.querySelector('#zy-np-show-all');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        closeDropdown();
        if (typeof window.loadPage === 'function') {
          window.loadPage(SHOW_ALL_ROUTE);
        }
      });
    }

    pop.querySelectorAll('.zy-np-item').forEach(row => {
      row.addEventListener('click', () => {
        const nid = Number(row.getAttribute('data-notif-id'));
        const found = state.topFive.find(x => Number(x.id) === nid);
        if (found) openNotificationTarget(found);
      });
    });
  }

  function closeDropdown() {
    state.dropdownOpen = false;
    const pop = document.getElementById('zy-notif-popover');
    if (pop) pop.classList.remove('is-open');
    document.querySelectorAll('.zy-bell-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  function toggleDropdown(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const trigger = (event && event.currentTarget) || document.querySelector('.zy-bell-btn');
    if (state.dropdownOpen) {
      closeDropdown();
      return;
    }
    const pop = ensurePopoverEl();
    state.dropdownOpen = true;
    renderDropdownContent();
    positionPopover(pop, trigger);
    pop.classList.add('is-open');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    refreshHeaderFeed(true);
  }

  document.addEventListener('click', (e) => {
    if (!state.dropdownOpen) return;
    if (e.target && (e.target.closest('#zy-notif-popover') || e.target.closest('.zy-bell-btn'))) return;
    closeDropdown();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.dropdownOpen) closeDropdown();
  });

  window.addEventListener('resize', () => {
    if (!state.dropdownOpen) return;
    const pop = document.getElementById('zy-notif-popover');
    const btn = document.querySelector('.zy-bell-btn');
    if (pop && btn) positionPopover(pop, btn);
  });

  /* ── Full Notifications Center Page ── */
  async function loadPageData() {
    state.page.loading = true;
    renderPageListOnly();
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '150');
      if (ROLE === 'owner' && state.page.scope === 'all') {
        qs.set('scope', 'all');
      }
      const res = await reqJson(`/api/notifications?${qs.toString()}`);
      state.page.items = Array.isArray(res && res.data) ? res.data : [];
      if (ROLE !== 'owner' || state.page.scope === 'mine') {
        state.unreadCount = Number((res && res.unread_count) || 0);
        state.totalCount = Number((res && res.total) || state.page.items.length);
        state.topFive = state.page.items.slice(0, 5);
        updateBadge(false);
      }
    } catch (err) {
      console.warn('Failed to load notifications page:', err);
    } finally {
      state.page.loading = false;
      renderPageListOnly();
    }
  }

  function filteredPageItems() {
    const tab = state.page.tab;
    const q = String(state.page.search || '').trim().toLowerCase();
    return state.page.items.filter(n => {
      if (tab === 'unread' && n.read) return false;
      if (['numbers', 'requests', 'payments', 'system'].includes(tab)) {
        if (inferCategory(n) !== tab) return false;
      }
      if (q) {
        const hay = [
          n.title, n.message, n.body, n.range_name, n.payterm,
          n.rate_label, n.actor_name, n.recipient_username, n.status
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderPageListOnly() {
    const root = document.getElementById('zy-notif-page-root');
    if (!root) {
      state.page.mounted = false;
      return;
    }

    const unreadInList = state.page.items.filter(n => !n.read).length;
    const unreadPill = root.querySelector('#zy-np-tab-unread-count');
    if (unreadPill) {
      unreadPill.textContent = unreadInList > 0 ? String(unreadInList) : '';
      unreadPill.style.display = unreadInList > 0 ? 'inline-flex' : 'none';
    }

    const totalEl = root.querySelector('#zy-np-summary-count');
    const visible = filteredPageItems();
    if (totalEl) {
      totalEl.textContent = `${visible.length} of ${state.page.items.length} notifications`;
    }

    const listEl = root.querySelector('#zy-notif-page-list');
    if (!listEl) return;

    if (state.page.loading) {
      listEl.innerHTML = `<div class="zy-np-page-empty"><i class="fas fa-spinner fa-spin"></i> Loading notifications...</div>`;
      return;
    }

    if (!visible.length) {
      listEl.innerHTML = `
        <div class="zy-np-page-empty">
          <div class="zy-np-empty-ic"><i class="fas fa-bell-slash"></i></div>
          <div class="zy-np-empty-title">No notifications found</div>
          <div class="zy-np-empty-sub">${state.page.search || state.page.tab !== 'all'
            ? 'Try clearing your filter or search query.'
            : 'Real-time activity alerts for your account will appear here instantly.'}</div>
        </div>
      `;
      return;
    }

    const showRecipientChip = ROLE === 'owner' && state.page.scope === 'all';
    listEl.innerHTML = visible.map(n => {
      const vm = visualMeta(n);
      const unreadCls = n.read ? '' : 'is-unread';
      const hasAction = !!(n.action_page || (n.metadata && n.metadata.action_page));
      return `
        <div class="zy-notif-row ${unreadCls}" data-id="${Number(n.id)}">
          <div class="zy-notif-row-icon tone-${vm.tone}">
            <i class="fas ${vm.icon}"></i>
          </div>
          <div class="zy-notif-row-main">
            <div class="zy-notif-row-top">
              <div class="zy-notif-row-title-wrap">
                ${!n.read ? '<span class="zy-np-dot"></span>' : ''}
                <span class="zy-notif-row-title">${esc(n.title || 'Notification')}</span>
                <span class="zy-notif-cat-tag tone-${vm.tone}">${esc(vm.label)}</span>
              </div>
              <span class="zy-notif-row-time" title="${esc(formatUtcTime(n.created || n.timestamp))}">
                <i class="far fa-clock"></i> ${esc(relativeTime(n.created || n.timestamp))}
              </span>
            </div>
            <div class="zy-notif-row-msg">${esc(n.message || n.body || '')}</div>
            ${buildChipsHtml(n, showRecipientChip)}
            <div class="zy-notif-row-foot">
              <span class="zy-notif-actor">
                <i class="fas fa-user-check"></i> ${esc(n.actor_name || n.actor_role || 'System')}
                <span class="zy-notif-utc">&middot; ${esc(formatUtcTime(n.created || n.timestamp))}</span>
              </span>
              <div class="zy-notif-row-actions">
                ${hasAction ? `<button type="button" class="zy-nr-btn primary" data-act="open" data-id="${Number(n.id)}"><i class="fas fa-arrow-up-right-from-square"></i> Open</button>` : ''}
                ${!n.read ? `<button type="button" class="zy-nr-btn" data-act="read" data-id="${Number(n.id)}"><i class="fas fa-check"></i> Mark Read</button>` : ''}
                <button type="button" class="zy-nr-btn danger" data-act="delete" data-id="${Number(n.id)}" title="Delete"><i class="fas fa-trash-can"></i></button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.zy-nr-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.getAttribute('data-act');
        const id = Number(btn.getAttribute('data-id'));
        const item = state.page.items.find(x => Number(x.id) === id);
        if (act === 'open' && item) openNotificationTarget(item);
        else if (act === 'read') markSingleRead(id);
        else if (act === 'delete') deleteSingle(id);
      });
    });

    listEl.querySelectorAll('.zy-notif-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = Number(row.getAttribute('data-id'));
        const item = state.page.items.find(x => Number(x.id) === id);
        if (item && !item.read) markSingleRead(id, true);
      });
    });
  }

  function renderPage(containerId = 'page-content') {
    const c = document.getElementById(containerId);
    if (!c) return;
    closeDropdown();
    state.page.mounted = true;
    state.page.containerId = containerId;
    state.page.tab = 'all';
    state.page.search = '';

    if (typeof window.zyCrumb === 'function') {
      window.zyCrumb(['Notifications']);
    }
    const bc = document.getElementById('breadcrumb');
    if (bc) bc.textContent = 'Notifications';

    const roleSubtitle = ROLE === 'owner'
      ? 'Live Owner alerts for Agent requests, approvals, payouts, and platform events.'
      : ROLE === 'agent'
        ? 'Real-time updates for number allocations, Client requests, and payout approvals.'
        : 'Real-time updates for allocated numbers, rates, payterms, and PKR payouts.';

    const ownerControls = ROLE === 'owner'
      ? `
        <div class="zy-notif-scope-switch" role="group" aria-label="Notification Scope">
          <button type="button" class="zy-scope-btn ${state.page.scope === 'mine' ? 'active' : ''}" data-scope="mine">My Notifications</button>
          <button type="button" class="zy-scope-btn ${state.page.scope === 'all' ? 'active' : ''}" data-scope="all">All Roles Activity</button>
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="zy-np-broadcast-btn">
          <i class="fas fa-bullhorn"></i> Broadcast Hub
        </button>
      `
      : '';

    c.innerHTML = `
      <div class="zy-notif-page" id="zy-notif-page-root">
        <div class="page-header zy-notif-page-head">
          <div>
            <div class="page-title">
              <i class="fas fa-bell" style="color:var(--theme-btn-primary,#2563eb);"></i>
              Notifications Center
              <span class="zy-notif-live-pill ${state.wsConnected ? 'is-online' : ''}" id="zy-notif-live-pill">
                <span class="dot"></span> Live
              </span>
            </div>
            <div class="page-subtitle">${esc(roleSubtitle)}</div>
          </div>
          <div class="zy-notif-head-actions">
            ${ownerControls}
            <button type="button" class="btn btn-outline btn-sm" id="zy-np-open-settings">
              <i class="fas fa-sliders"></i> Settings
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="zy-np-mark-all-page">
              <i class="fas fa-check-double"></i> Mark All Read
            </button>
            <button type="button" class="btn btn-danger btn-sm" id="zy-np-clear-all-page">
              <i class="fas fa-trash-can"></i> Clear
            </button>
          </div>
        </div>

        <div class="card zy-panel zy-notif-card">
          <div class="zy-notif-toolbar">
            <div class="zy-notif-tabs" role="tablist">
              <button type="button" class="zy-ntab active" data-tab="all">All</button>
              <button type="button" class="zy-ntab" data-tab="unread">Unread <span class="zy-ntab-cnt" id="zy-np-tab-unread-count" style="display:none;"></span></button>
              <button type="button" class="zy-ntab" data-tab="numbers"><i class="fas fa-sim-card"></i> Numbers</button>
              <button type="button" class="zy-ntab" data-tab="requests"><i class="fas fa-inbox"></i> Requests</button>
              <button type="button" class="zy-ntab" data-tab="payments"><i class="fas fa-wallet"></i> Payments</button>
              <button type="button" class="zy-ntab" data-tab="system"><i class="fas fa-bullhorn"></i> System</button>
            </div>
            <div class="zy-notif-search-wrap">
              <input type="search" id="zy-notif-search-input" class="zy-notif-search" placeholder="Search range, term, rate, or message...">
              <span class="zy-notif-summary-count" id="zy-np-summary-count"></span>
            </div>
          </div>
          <div class="zy-notif-list" id="zy-notif-page-list"></div>
        </div>
      </div>
    `;

    const root = document.getElementById('zy-notif-page-root');
    root.querySelectorAll('.zy-ntab').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        root.querySelectorAll('.zy-ntab').forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');
        state.page.tab = tabBtn.getAttribute('data-tab') || 'all';
        renderPageListOnly();
      });
    });

    root.querySelectorAll('.zy-scope-btn').forEach(sBtn => {
      sBtn.addEventListener('click', () => {
        root.querySelectorAll('.zy-scope-btn').forEach(b => b.classList.remove('active'));
        sBtn.classList.add('active');
        state.page.scope = sBtn.getAttribute('data-scope') || 'mine';
        loadPageData();
      });
    });

    const searchInput = root.querySelector('#zy-notif-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.page.search = e.target.value || '';
        renderPageListOnly();
      });
    }

    const settingsBtn = root.querySelector('#zy-np-open-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);

    const markAllBtn = root.querySelector('#zy-np-mark-all-page');
    if (markAllBtn) markAllBtn.addEventListener('click', markAllRead);

    const clearAllBtn = root.querySelector('#zy-np-clear-all-page');
    if (clearAllBtn) clearAllBtn.addEventListener('click', promptClearAll);

    const bcastBtn = root.querySelector('#zy-np-broadcast-btn');
    if (bcastBtn) bcastBtn.addEventListener('click', () => {
      if (typeof window.loadPage === 'function') window.loadPage('announcements');
    });

    loadPageData();
  }

  /* ── Per-User Notification Settings Modal ── */
  async function openSettingsModal() {
    try {
      const res = await reqJson('/api/notifications/preferences');
      if (res && res.preferences) state.prefs = normalizePrefs(res.preferences);
    } catch (e) {}

    const p = state.prefs;
    const html = `
      <div class="zy-np-prefs-wrap">
        <div class="zy-np-pref-section-title">Delivery & Real-Time Alerts</div>
        <label class="zy-np-pref-row">
          <div>
            <div class="zy-np-pref-name">Live Alert Banner</div>
            <div class="zy-np-pref-desc">Show an instant top-right alert popup the same second an event occurs.</div>
          </div>
          <input type="checkbox" id="zy-pref-live-toast" ${p.live_toast ? 'checked' : ''}>
        </label>
        <label class="zy-np-pref-row">
          <div>
            <div class="zy-np-pref-name">Notification Sound Chime</div>
            <div class="zy-np-pref-desc">Play a subtle alert tone when a new live notification arrives.</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button type="button" class="btn btn-outline btn-xs" id="zy-pref-test-sound" title="Preview chime"><i class="fas fa-volume-high"></i> Test</button>
            <input type="checkbox" id="zy-pref-sound" ${p.sound_enabled ? 'checked' : ''}>
          </div>
        </label>

        <div class="zy-np-pref-section-title" style="margin-top:16px;">Notification Categories</div>
        <label class="zy-np-pref-row">
          <div>
            <div class="zy-np-pref-name"><i class="fas fa-sim-card" style="color:#16a34a;margin-right:6px;"></i>Number Allocations & Recalls</div>
            <div class="zy-np-pref-desc">Range, Payterm, Quantity, and Rate updates when numbers are added or recalled.</div>
          </div>
          <input type="checkbox" id="zy-pref-cat-numbers" ${p.categories.numbers ? 'checked' : ''}>
        </label>
        <label class="zy-np-pref-row">
          <div>
            <div class="zy-np-pref-name"><i class="fas fa-inbox" style="color:#2563eb;margin-right:6px;"></i>Requests & Approvals</div>
            <div class="zy-np-pref-desc">Live alerts when number requests arrive, are accepted, or rejected.</div>
          </div>
          <input type="checkbox" id="zy-pref-cat-requests" ${p.categories.requests ? 'checked' : ''}>
        </label>
        <label class="zy-np-pref-row">
          <div>
            <div class="zy-np-pref-name"><i class="fas fa-wallet" style="color:#0284c7;margin-right:6px;"></i>Payments & Payouts</div>
            <div class="zy-np-pref-desc">Payout submissions, payment confirmations, and rejection notices.</div>
          </div>
          <input type="checkbox" id="zy-pref-cat-payments" ${p.categories.payments ? 'checked' : ''}>
        </label>
        <label class="zy-np-pref-row">
          <div>
            <div class="zy-np-pref-name"><i class="fas fa-bullhorn" style="color:#64748b;margin-right:6px;"></i>System & Support</div>
            <div class="zy-np-pref-desc">Support tickets, announcements, and platform notices.</div>
          </div>
          <input type="checkbox" id="zy-pref-cat-system" ${p.categories.system ? 'checked' : ''}>
        </label>

        <div class="zy-np-pref-footer">
          <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" id="zy-pref-save-btn">
            <i class="fas fa-floppy-disk"></i> Save Preferences
          </button>
        </div>
      </div>
    `;

    if (typeof window.openModal === 'function') {
      window.openModal('Notification Settings', html);
    } else if (typeof window.zyModal === 'function') {
      window.zyModal('Notification Settings', html);
    }

    setTimeout(() => {
      const testBtn = document.getElementById('zy-pref-test-sound');
      if (testBtn) {
        testBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          playChime();
        });
      }
      const saveBtn = document.getElementById('zy-pref-save-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const next = normalizePrefs({
            live_toast: !!document.getElementById('zy-pref-live-toast')?.checked,
            sound_enabled: !!document.getElementById('zy-pref-sound')?.checked,
            categories: {
              numbers: !!document.getElementById('zy-pref-cat-numbers')?.checked,
              requests: !!document.getElementById('zy-pref-cat-requests')?.checked,
              payments: !!document.getElementById('zy-pref-cat-payments')?.checked,
              system: !!document.getElementById('zy-pref-cat-system')?.checked
            }
          });
          saveBtn.disabled = true;
          try {
            const saved = await reqJson('/api/notifications/preferences', {
              method: 'POST',
              body: JSON.stringify({ preferences: next })
            });
            state.prefs = normalizePrefs((saved && saved.preferences) || next);
            if (typeof window.closeModal === 'function') window.closeModal();
            if (typeof window.showToast === 'function') {
              window.showToast('Notification preferences saved', 'success');
            }
          } catch (err) {
            if (typeof window.showToast === 'function') {
              window.showToast('Failed to save preferences', 'error');
            }
          } finally {
            saveBtn.disabled = false;
          }
        });
      }
    }, 30);
  }

  /* ── Real-Time WebSocket Engine ── */
  function handleIncomingNotification(notif) {
    if (!notif || typeof notif !== 'object') return;
    const nid = Number(notif.id || 0);
    if (nid && state.seenIds.has(nid)) return;
    if (nid) state.seenIds.add(nid);

    const enriched = {
      ...notif,
      category: inferCategory(notif)
    };

    state.topFive = [enriched, ...state.topFive.filter(x => Number(x.id) !== nid)].slice(0, 5);
    if (!enriched.read) state.unreadCount += 1;
    state.totalCount += 1;
    updateBadge(true);

    if (state.dropdownOpen) {
      renderDropdownContent();
    }

    if (state.page.mounted && document.getElementById('zy-notif-page-root')) {
      state.page.items = [enriched, ...state.page.items.filter(x => Number(x.id) !== nid)];
      renderPageListOnly();
    }

    const cat = enriched.category;
    const catAllowed = !state.prefs.categories || state.prefs.categories[cat] !== false;
    if (catAllowed) {
      if (state.prefs.sound_enabled) playChime();
      if (state.prefs.live_toast) showLiveBanner(enriched);
    }
  }

  function updateLiveIndicator(connected) {
    state.wsConnected = connected;
    const pill = document.getElementById('zy-notif-live-pill');
    if (pill) pill.classList.toggle('is-online', connected);
  }

  let _notifSharedBound = false;
  function connectWs() {
    if (window.__AUTH_BLOCKED__) return;
    if (window.ZySharedWs && typeof window.ZySharedWs.subscribe === 'function') {
      if (!_notifSharedBound) {
        _notifSharedBound = true;
        window.ZySharedWs.onStatus((isUp) => {
          updateLiveIndicator(Boolean(isUp));
        });
        window.ZySharedWs.subscribe((data) => {
          if (data && data.type === 'notification' && data.notification) {
            handleIncomingNotification(data.notification);
          }
        });
      }
      window.ZySharedWs.connect();
      return;
    }
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/notifications`);
      state.ws = ws;

      ws.onopen = () => {
        state.wsAttempts = 0;
        updateLiveIndicator(true);
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data && data.type === 'notification' && data.notification) {
            handleIncomingNotification(data.notification);
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        updateLiveIndicator(false);
        state.ws = null;
        if (window.__AUTH_BLOCKED__) return;
        state.wsAttempts = Math.min(state.wsAttempts + 1, 6);
        const delay = Math.min(15000, 1500 * Math.pow(1.6, state.wsAttempts - 1));
        clearTimeout(state.wsReconnectTimer);
        state.wsReconnectTimer = setTimeout(connectWs, delay);
      };

      ws.onerror = () => {
        try { ws.close(); } catch (e) {}
      };
    } catch (e) {}
  }

  function boot() {
    if (window.__AUTH_BLOCKED__) return;
    refreshHeaderFeed(true);
    connectWs();
    if (!state.pollTimer) {
      state.pollTimer = setInterval(() => {
        if (!document.hidden && !window.__AUTH_BLOCKED__) {
          refreshHeaderFeed(true);
        }
      }, 45000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 180));
  } else {
    setTimeout(boot, 180);
  }

  window.HumexNotifications = {
    role: ROLE,
    showAllRoute: SHOW_ALL_ROUTE,
    toggleDropdown,
    closeDropdown,
    renderPage,
    openSettingsModal,
    refresh: refreshHeaderFeed,
    markAllRead,
    markSingleRead,
    deleteSingle,
    clearAll: promptClearAll
  };
})();
