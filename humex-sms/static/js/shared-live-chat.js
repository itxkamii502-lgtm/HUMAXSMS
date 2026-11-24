/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — WhatsApp-Style Role-Based Live Chat Engine
   - Strictly Role- & Tenant-Isolated (server-enforced)
   - Owner: 1-to-1 with Agents only
   - Agent: 1-to-1 with Owner + Own Clients + Admin-Controlled Client Groups
   - Client: 1-to-1 with Assigned Agent + Joined Agent Groups only
   - Text, Categorized Emoji Picker, Quote-Reply, Pin, Typing, Presence, Ticks
   - Tiered Alerts: Silent sidebar unread counter by default;
     Sound chime + Live alert toast when Admin/Authority sends a message
   ═══════════════════════════════════════════════════════════════ */
(function () {
  if (typeof window === 'undefined' || window.HumexLiveChat) return;

  const EMOJI_GROUPS = [
    {
      label: 'Smileys',
      icon: '😊',
      items: ['😀','😁','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😎','🤩','🤔','😐','🙄','😮','😢','😭','😤','😠','🙏','🤝','👍','👎','👏','🔥','✨','🎉','❤️','💯']
    },
    {
      label: 'Business',
      icon: '💼',
      items: ['✅','❌','⚠️','📌','📢','📣','💬','📱','📞','📩','📨','💰','💵','💸','💳','🏦','📊','📈','📉','🕒','⏰','📅','🔒','🔓','⭐','🚀','⚡','🎯','🧾','📝']
    },
    {
      label: 'Hands',
      icon: '👍',
      items: ['👋','🤚','✋','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪']
    }
  ];

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '✅'];

  const SENDER_COLORS = ['#0f766e', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#047857', '#0369a1', '#9333ea'];

  const state = {
    me: null,
    contacts: [],
    conversations: [],
    messagesByConv: new Map(), // convId -> Message[]
    hasMoreByConv: new Map(),
    typingByConv: new Map(),   // convId -> Map(actorKey -> { name, timer })
    activeConvId: null,
    search: '',
    filterTab: 'all',          // 'all' | 'unread' | 'owner' | 'clients' | 'groups' | 'channels' (Agent only)
    replyTo: null,             // { id, sender_name, body }
    emojiOpen: false,
    emojiTab: 0,
    drawerOpen: false,
    createModalOpen: false,
    createModalMode: 'group',  // 'group' | 'channel'
    createModalAvatar: '',     // base64 data URI preview during creation
    createModalSearch: '',
    reactionPickerMsgId: null,
    seenModal: null,           // { loading, convId, msgId, data, error }
    uploadingGroupAvatar: false,
    confirmDeleteGroup: false,
    mobileShowThread: false,
    mounted: false,
    containerId: 'page-content',
    loadingThread: false,
    sending: false,
    ws: null,
    wsConnected: false,
    wsAttempts: 0,
    wsReconnectTimer: null,
    typingSentTimer: null,
    isTypingActive: false,
    audioCtx: null,
    audioUnlocked: false,
    totalUnread: 0,
    pendingImages: [],
    dragDepth: 0,
    scheduleTickTimer: null,
    scheduleExpiryRefreshing: false,
    selectMode: false,
    selectedMsgIds: new Set(),
    expandedDeletedIds: new Set(),
    moreMenuOpen: false,
    viewportCleanup: null
  };

  function isGroupConv(c) {
    return Boolean(c && c.type === 'agent_group');
  }
  function isChannelConv(c) {
    return Boolean(c && c.type === 'agent_channel');
  }
  function isGroupOrChannel(c) {
    return Boolean(c && (c.type === 'agent_group' || c.type === 'agent_channel'));
  }

  const DEFAULT_CLOSE_MSG = '🌙 Good Night everyone! Group chat is now closed for the night. Rest well and recharge — chat will automatically reopen in the morning. Take care! ✨';
  const DEFAULT_OPEN_MSG = '☀️ Assalam-o-Alaikum everyone! Good morning & welcome back. The group is now open — wishing you a smooth, productive, and successful day ahead! 🚀';

  function formatTime12h(hhmm) {
    const parts = String(hhmm || '').split(':');
    if (parts.length !== 2) return String(hhmm || '');
    const h = Number(parts[0]);
    const m = String(parts[1]).padStart(2, '0');
    if (!Number.isFinite(h)) return String(hhmm || '');
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${suffix}`;
  }

  function formatCountdownHMS(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }

  function getRemainingScheduleSeconds(conv) {
    const st = conv && conv.schedule_state;
    if (!st || !st.enabled || !st.is_closed || !st.reopen_at_iso) return 0;
    const ms = new Date(st.reopen_at_iso).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  }

  function stopScheduleCountdownTick() {
    if (state.scheduleTickTimer) {
      clearInterval(state.scheduleTickTimer);
      state.scheduleTickTimer = null;
    }
  }

  function startScheduleCountdownTick() {
    stopScheduleCountdownTick();
    const conv = getActiveConv();
    if (!conv || conv.type !== 'agent_group' || !conv.schedule_state || !conv.schedule_state.enabled || !conv.schedule_state.is_closed) {
      return;
    }
    const updateDom = () => {
      const active = getActiveConv();
      if (!state.mounted || !active || !active.schedule_state || !active.schedule_state.is_closed) {
        stopScheduleCountdownTick();
        return;
      }
      const rem = getRemainingScheduleSeconds(active);
      const formatted = formatCountdownHMS(rem);
      document.querySelectorAll('[data-zy-sched-countdown]').forEach(el => {
        el.textContent = formatted;
      });
      if (rem <= 0 && !state.scheduleExpiryRefreshing) {
        state.scheduleExpiryRefreshing = true;
        stopScheduleCountdownTick();
        setTimeout(async () => {
          try {
            await fetchBootstrap(true);
            if (state.activeConvId) await loadMessages(state.activeConvId, { silent: true });
          } finally {
            state.scheduleExpiryRefreshing = false;
          }
        }, 1200);
      }
    };
    updateDom();
    state.scheduleTickTimer = setInterval(updateDom, 1000);
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/[\s_.-]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function renderAvatarInner(avatarUrl, label, isGroup, isOnline, isChannelFlag) {
    if (isGroup || isChannelFlag) {
      const iconHtml = isChannelFlag
        ? `<i class="fas fa-bullhorn"></i>`
        : `<i class="fas fa-users"></i>`;
      if (avatarUrl) {
        return `
          <span class="zy-chat-ava-fallback">${iconHtml}</span>
          <img class="zy-chat-ava-img" src="${esc(avatarUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">
        `;
      }
      return iconHtml;
    }
    const imgHtml = avatarUrl
      ? `<img class="zy-chat-ava-img" src="${esc(avatarUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
      : '';
    return `
      <span class="zy-chat-ava-fallback">${esc(initials(label))}</span>
      ${imgHtml}
      ${isOnline ? '<span class="zy-chat-dot-online" title="Online"></span>' : ''}
    `;
  }

  function colorForKey(key) {
    let h = 0;
    const s = String(key || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length];
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function formatDayLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) return 'Today';
    const yest = new Date(now.getTime() - 86400000);
    if (sameDay(d, yest)) return 'Yesterday';
    return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatInboxTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return formatTime(iso);
    }
    const yest = new Date(now.getTime() - 86400000);
    if (d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate()) {
      return 'Yesterday';
    }
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  }

  function formatLastSeen(iso) {
    if (!iso) return 'Offline';
    return `Last seen ${formatInboxTime(iso)} ${formatTime(iso)}`.trim();
  }

  async function reqJson(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ── Audio Chime (ONLY triggered for Admin/Authority messages) ──
  function unlockAudio() {
    if (state.audioUnlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!state.audioCtx) state.audioCtx = new AC();
      if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
      state.audioUnlocked = true;
    } catch (_) {}
  }
  ['click', 'keydown', 'touchstart'].forEach(ev => {
    window.addEventListener(ev, unlockAudio, { once: true, passive: true });
  });

  function playAdminAlertChime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!state.audioCtx) state.audioCtx = new AC();
      const ctx = state.audioCtx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      // Crisp two-note WhatsApp-inspired chime
      [
        { freq: 659.25, start: 0, dur: 0.14 },
        { freq: 880.0, start: 0.12, dur: 0.22 }
      ].forEach(n => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, now + n.start);
        gain.gain.setValueAtTime(0.001, now + n.start);
        gain.gain.exponentialRampToValueAtTime(0.18, now + n.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur + 0.02);
      });
    } catch (_) {}
  }

  function showAdminAlertToast(ev) {
    let stack = document.getElementById('zy-chat-alert-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'zy-chat-alert-stack';
      stack.className = 'zy-chat-alert-stack';
      document.body.appendChild(stack);
    }
    const msg = ev.message || {};
    const isChannel = ev.conversation_type === 'agent_channel';
    const isGroup = ev.conversation_type === 'agent_group';
    const roleTag = msg.sender_role === 'owner' ? 'Owner' : 'Agent Admin';
    const heading = isChannel
      ? `Announcement · ${esc(ev.conversation_title || 'Channel')}`
      : (isGroup
          ? `${esc(ev.conversation_title || 'Group')} · ${esc(msg.sender_name || roleTag)}`
          : `${esc(msg.sender_name || roleTag)} · ${roleTag}`);
    const snippetText = msg.image
      ? (msg.body ? `📷 ${String(msg.body).slice(0, 100)}` : '📷 Photo')
      : String(msg.body || '').slice(0, 110);
    const snippet = esc(snippetText);

    const el = document.createElement('div');
    el.className = 'zy-chat-alert-toast';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.innerHTML = `
      <div class="zy-chat-alert-ico"><i class="fas ${isChannel ? 'fa-bullhorn' : 'fa-comments'}"></i></div>
      <div class="zy-chat-alert-body">
        <div class="zy-chat-alert-title">${heading}</div>
        <div class="zy-chat-alert-text">${snippet}</div>
      </div>
      <button type="button" class="zy-chat-alert-close" aria-label="Dismiss">&times;</button>
    `;

    const dismiss = () => {
      el.classList.add('zy-chat-alert-out');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    };

    el.querySelector('.zy-chat-alert-close').addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });

    el.addEventListener('click', () => {
      dismiss();
      openConversationFromAnywhere(Number(ev.conversation_id));
    });

    stack.appendChild(el);
    setTimeout(dismiss, 6500);
  }

  function openConversationFromAnywhere(convId) {
    state.activeConvId = Number(convId);
    state.mobileShowThread = true;
    const isAlreadyOnChat = state.mounted && document.getElementById('zy-chat-shell');
    if (!isAlreadyOnChat && typeof window.loadPage === 'function') {
      window.loadPage('live-chat');
    } else if (isAlreadyOnChat) {
      selectConversation(convId);
    }
  }

  // ── Sidebar Unread Badge Sync ──
  function recomputeUnread() {
    state.totalUnread = state.conversations.reduce((s, c) => s + Number(c.unread_count || 0), 0);
    syncSidebarBadge();
  }

  function syncSidebarBadge() {
    const nav = document.getElementById('nav-live-chat');
    if (!nav) return;
    let badge = nav.querySelector('.zy-chat-nav-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'zy-chat-nav-badge';
      const caret = nav.querySelector('.zy-caret');
      if (caret) nav.insertBefore(badge, caret);
      else nav.appendChild(badge);
    }
    if (state.totalUnread > 0) {
      badge.textContent = state.totalUnread > 99 ? '99+' : String(state.totalUnread);
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '0';
      badge.style.display = 'none';
    }
  }

  // ── Bootstrap & Data Synchronization ──
  async function fetchBootstrap(silent = true) {
    try {
      const data = await reqJson('/api/chat/bootstrap');
      state.me = data.me || state.me;
      state.contacts = Array.isArray(data.contacts) ? data.contacts : [];
      state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
      if (state.activeConvId && !state.conversations.some(c => Number(c.id) === Number(state.activeConvId))) {
        state.activeConvId = null;
        state.drawerOpen = false;
      }
      recomputeUnread();
      if (state.mounted) renderWorkspace();
    } catch (err) {
      if (!silent && typeof toast === 'function') toast(err.message || 'Failed to load Live Chat', 'error');
    }
  }

  // ── Real-Time WebSocket Connection ──
  function connectWs() {
    if (window.__AUTH_BLOCKED__) return;
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      state.ws = ws;

      ws.onopen = () => {
        const wasReconnect = state.wsAttempts > 0;
        state.wsConnected = true;
        state.wsAttempts = 0;
        updateConnectionStatus();
        if (wasReconnect) {
          fetchBootstrap(true).then(() => {
            if (state.mounted && state.activeConvId) loadMessages(state.activeConvId, { silent: true });
          });
        }
      };

      ws.onmessage = (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch (_) { return; }
        if (!data || !data.type || !String(data.type).startsWith('chat:')) return;
        handleWsEvent(data);
      };

      ws.onclose = () => {
        state.wsConnected = false;
        state.ws = null;
        updateConnectionStatus();
        const delay = Math.min(15000, 1200 * Math.pow(1.6, Math.min(state.wsAttempts++, 6)));
        clearTimeout(state.wsReconnectTimer);
        state.wsReconnectTimer = setTimeout(connectWs, delay);
      };

      ws.onerror = () => { try { ws.close(); } catch (_) {} };
    } catch (_) {}
  }

  function sendWsFrame(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      try { state.ws.send(JSON.stringify(obj)); } catch (_) {}
    }
  }

  function updateConnectionStatus() {
    const el = document.getElementById('zy-chat-conn-status');
    if (!el) return;
    el.textContent = state.wsConnected ? 'Live' : 'Reconnecting...';
    el.className = `zy-chat-conn ${state.wsConnected ? 'is-live' : 'is-warn'}`;
  }

  function handleWsEvent(ev) {
    if (ev.type === 'chat:message' && ev.message) {
      const msg = ev.message;
      const convId = Number(ev.conversation_id);
      const isSelf = state.me && msg.sender_key === state.me.key;
      const isViewingThis = state.mounted && document.getElementById('zy-chat-shell') &&
        Number(state.activeConvId) === convId && !document.hidden;

      // Clear typing state for sender
      const tMap = state.typingByConv.get(convId);
      if (tMap && tMap.has(msg.sender_key)) {
        clearTimeout(tMap.get(msg.sender_key).timer);
        tMap.delete(msg.sender_key);
      }

      // Append idempotently if thread messages are loaded
      if (state.messagesByConv.has(convId)) {
        const arr = state.messagesByConv.get(convId);
        // Replace optimistic pending message if any or deduplicate by id
        const existingIdx = arr.findIndex(m => Number(m.id) === Number(msg.id));
        if (existingIdx === -1) {
          const optIdx = isSelf
            ? arr.findIndex(m => m._optimistic && (
                (ev.client_temp_id && m._clientTempId && m._clientTempId === ev.client_temp_id) ||
                (!m._isMedia && !msg.image && m.body === msg.body)
              ))
            : -1;
          if (optIdx !== -1) {
            const oldPreview = arr[optIdx]._localPreviewUrl;
            arr[optIdx] = msg;
            if (oldPreview && msg.image && msg.image.url) {
              preloadAndRevoke(msg.image.url, oldPreview);
            }
          } else {
            arr.push(msg);
          }
        }
      }

      const conv = state.conversations.find(c => Number(c.id) === convId);
      if (!conv) {
        // Brand new conversation initiated by someone else — re-bootstrap cleanly
        fetchBootstrap(true);
      } else {
        conv.last_message_id = Number(msg.id);
        conv.last_message_preview = msg.image
          ? (msg.body ? `📷 ${String(msg.body)}`.slice(0, 120) : '📷 Photo')
          : String(msg.body || '').slice(0, 120);
        conv.last_message_sender_key = msg.sender_key;
        conv.last_message_sender_name = msg.sender_name;
        conv.last_message_at = msg.created_at;
        if (!conv.read_cursors) conv.read_cursors = {};
        conv.read_cursors[msg.sender_key] = Number(msg.id);

        if (!isSelf) {
          if (isViewingThis) {
            conv.unread_count = 0;
            conv.read_cursors[state.me.key] = Number(msg.id);
            sendWsFrame({ type: 'chat:read', conversation_id: convId, last_read_id: Number(msg.id) });
          } else {
            conv.unread_count = Number(conv.unread_count || 0) + 1;
          }
        }
        state.conversations.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
        recomputeUnread();
      }

      // Tiered Sound & Alert Rule:
      // - Silent sidebar badge by default
      // - Sound + Live Alert popup ONLY when Admin/Authority sends message (Owner->Agent, Agent->Client/Group)
      if (!isSelf && ev.alert_priority === 'admin_alert' && !isViewingThis) {
        playAdminAlertChime();
        showAdminAlertToast(ev);
      }

      if (state.mounted) {
        renderInboxList();
        if (Number(state.activeConvId) === convId) {
          renderMessagesPane(true);
        }
      }
      return;
    }

    if (ev.type === 'chat:read') {
      const convId = Number(ev.conversation_id);
      const conv = state.conversations.find(c => Number(c.id) === convId);
      if (conv) {
        if (!conv.read_cursors) conv.read_cursors = {};
        conv.read_cursors[ev.actor_key] = Math.max(Number(conv.read_cursors[ev.actor_key] || 0), Number(ev.last_read_id || 0));
        if (state.me && ev.actor_key === state.me.key) {
          conv.unread_count = 0;
          recomputeUnread();
          if (state.mounted) renderInboxList();
        }
        if (state.mounted && Number(state.activeConvId) === convId) {
          const feed = document.getElementById('zy-chat-feed');
          const prevScroll = feed ? feed.scrollTop : null;
          renderMessagesPane(false);
          if (feed && prevScroll != null) feed.scrollTop = prevScroll;
        }
        if (state.seenModal && Number(state.seenModal.convId) === convId && !state.seenModal.loading) {
          refreshSeenModalData(convId, state.seenModal.msgId);
        }
      }
      return;
    }

    if (ev.type === 'chat:reaction') {
      const convId = Number(ev.conversation_id);
      const msgId = Number(ev.message_id);
      const arr = state.messagesByConv.get(convId);
      if (arr) {
        const target = arr.find(m => Number(m.id) === msgId);
        if (target) {
          target.reactions_summary = Array.isArray(ev.reactions_summary) ? ev.reactions_summary : [];
        }
      }
      if (state.mounted && Number(state.activeConvId) === convId) {
        const feed = document.getElementById('zy-chat-feed');
        const prevScroll = feed ? feed.scrollTop : null;
        renderMessagesPane(false);
        if (feed && prevScroll != null) feed.scrollTop = prevScroll;
      }
      if (state.seenModal && Number(state.seenModal.convId) === convId && Number(state.seenModal.msgId) === msgId) {
        refreshSeenModalData(convId, msgId);
      }
      return;
    }

    if (ev.type === 'chat:typing') {
      const convId = Number(ev.conversation_id);
      if (!state.typingByConv.has(convId)) state.typingByConv.set(convId, new Map());
      const map = state.typingByConv.get(convId);
      if (map.has(ev.actor_key)) clearTimeout(map.get(ev.actor_key).timer);
      if (ev.is_typing) {
        const timer = setTimeout(() => {
          map.delete(ev.actor_key);
          if (state.mounted) {
            renderInboxList();
            if (Number(state.activeConvId) === convId) updateThreadHeaderSubtitle();
          }
        }, 3500);
        map.set(ev.actor_key, { name: ev.sender_name || 'Someone', timer });
      } else {
        map.delete(ev.actor_key);
      }
      if (state.mounted) {
        renderInboxList();
        if (Number(state.activeConvId) === convId) updateThreadHeaderSubtitle();
      }
      return;
    }

    if (ev.type === 'chat:avatar_updated') {
      const newUrl = String(ev.avatar_url || '');
      if (state.me && state.me.key === ev.actor_key) {
        state.me.avatar_url = newUrl;
      }
      state.contacts.forEach(c => {
        if (c.key === ev.actor_key) c.avatar_url = newUrl;
      });
      state.conversations.forEach(conv => {
        if (conv.peer && conv.peer.key === ev.actor_key) {
          conv.peer.avatar_url = newUrl;
        }
        if (Array.isArray(conv.members)) {
          conv.members.forEach(m => {
            if (m.key === ev.actor_key) m.avatar_url = newUrl;
          });
        }
      });
      if (state.mounted) {
        renderInboxList();
        renderThreadArea(false);
      }
      return;
    }

    if (ev.type === 'chat:presence') {
      state.contacts.forEach(c => {
        if (c.key === ev.actor_key) {
          c.online = Boolean(ev.online);
          if (ev.last_seen) c.last_seen = ev.last_seen;
        }
      });
      state.conversations.forEach(conv => {
        if (conv.peer && conv.peer.key === ev.actor_key) {
          conv.peer.online = Boolean(ev.online);
          if (ev.last_seen) conv.peer.last_seen = ev.last_seen;
        }
        if (Array.isArray(conv.members)) {
          conv.members.forEach(m => {
            if (m.key === ev.actor_key) {
              m.online = Boolean(ev.online);
              if (ev.last_seen) m.last_seen = ev.last_seen;
            }
          });
        }
      });
      if (state.mounted) {
        renderInboxList();
        updateThreadHeaderSubtitle();
      }
      return;
    }

    if (ev.type === 'chat:message_deleted') {
      const convId = Number(ev.conversation_id);
      const msgId = Number(ev.message_id);
      const silentOrHidden = Boolean(ev.hidden_for_self || ev.silent_removed);
      const arr = state.messagesByConv.get(convId);
      if (arr) {
        const idx = arr.findIndex(m => Number(m.id) === msgId);
        if (idx !== -1) {
          if (silentOrHidden) {
            arr.splice(idx, 1);
            state.selectedMsgIds.delete(msgId);
            if (Number(state.reactionPickerMsgId) === msgId) state.reactionPickerMsgId = null;
          } else {
            const target = arr[idx];
            target.deleted = true;
            target.body = 'This message was deleted';
            target.image = null;
            target.reply_to = null;
            target.reactions_summary = [];
            if (ev.can_preview_deleted) {
              target.can_preview_deleted = true;
              target.deleted_preview_body = typeof ev.deleted_preview_body === 'string' ? ev.deleted_preview_body : '';
              target.deleted_preview_image = ev.deleted_preview_image || null;
              if (ev.deleted_by_role) target.deleted_by_role = ev.deleted_by_role;
              if (ev.deleted_at) target.deleted_at = ev.deleted_at;
            }
          }
        }
      }
      const conv = state.conversations.find(c => Number(c.id) === convId);
      if (conv) {
        if (Number(conv.pinned_message_id) === msgId) {
          conv.pinned_message_id = null;
          conv.pinned_message = null;
        }
        if (silentOrHidden && ev.last_message_preview !== undefined) {
          conv.last_message_id = Number(ev.last_message_id || 0);
          conv.last_message_preview = String(ev.last_message_preview || '');
        } else if (Number(conv.last_message_id) === msgId) {
          if (silentOrHidden && arr) {
            const latest = arr.length ? arr[arr.length - 1] : null;
            conv.last_message_id = latest ? Number(latest.id) : 0;
            conv.last_message_preview = latest
              ? (latest.deleted ? 'This message was deleted' : (latest.image ? (latest.body ? `📷 ${String(latest.body)}`.slice(0, 120) : '📷 Photo') : String(latest.body || '').slice(0, 120)))
              : '';
          } else {
            conv.last_message_preview = 'This message was deleted';
          }
        }
      }
      if (state.mounted) {
        renderInboxList();
        if (Number(state.activeConvId) === convId) renderThreadArea();
      }
      return;
    }

    if (ev.type === 'chat:group_created' || ev.type === 'chat:group_updated') {
      fetchBootstrap(true);
      return;
    }

    if (ev.type === 'chat:group_removed') {
      const convId = Number(ev.conversation_id);
      state.conversations = state.conversations.filter(c => Number(c.id) !== convId);
      state.messagesByConv.delete(convId);
      if (Number(state.activeConvId) === convId) {
        state.activeConvId = null;
        state.drawerOpen = false;
        state.mobileShowThread = false;
      }
      recomputeUnread();
      if (state.mounted) renderWorkspace();
    }
  }

  // ── Thread Operations ──
  async function loadMessages(convId, opts = {}) {
    convId = Number(convId);
    if (!opts.silent) {
      state.loadingThread = true;
      renderThreadArea();
    }
    try {
      const data = await reqJson(`/api/chat/conversations/${convId}/messages?limit=120`);
      state.messagesByConv.set(convId, Array.isArray(data.messages) ? data.messages : []);
      state.hasMoreByConv.set(convId, Boolean(data.has_more));
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === convId);
        if (idx !== -1) state.conversations[idx] = data.conversation;
        else state.conversations.unshift(data.conversation);
        recomputeUnread();
      }
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Could not load messages', 'error');
    } finally {
      state.loadingThread = false;
      if (state.mounted) {
        renderInboxList();
        renderThreadArea(true);
      }
    }
  }

  function syncChatUrlId(convId) {
    try {
      const u = new URL(window.location.href);
      const cid = Number(convId);
      if (Number.isInteger(cid) && cid > 0) {
        u.searchParams.set('chat', String(cid));
      } else {
        u.searchParams.delete('chat');
      }
      history.replaceState(history.state || { page: 'live-chat' }, '', u.pathname + u.search);
    } catch (_) {}
  }

  function closeProfileChat() {
    state.activeConvId = null;
    state.mobileShowThread = false;
    state.drawerOpen = false;
    state.confirmDeleteGroup = false;
    state.selectMode = false;
    state.selectedMsgIds.clear();
    state.emojiOpen = false;
    state.reactionPickerMsgId = null;
    state.seenModal = null;
    state.replyTo = null;
    clearPendingImages();
    syncChatUrlId(null);
    if (state.mounted) renderWorkspace();
  }

  function exitLiveChatToPanel() {
    syncChatUrlId(null);
    try { document.body.classList.remove('zy-is-live-chat'); } catch (_) {}
    if (typeof window.loadPage === 'function') {
      window.loadPage('dashboard');
    }
  }

  async function selectConversation(convId) {
    state.activeConvId = Number(convId);
    clearPendingImages();
    state.replyTo = null;
    state.emojiOpen = false;
    state.reactionPickerMsgId = null;
    state.seenModal = null;
    state.drawerOpen = false;
    state.confirmDeleteGroup = false;
    state.selectMode = false;
    state.selectedMsgIds.clear();
    state.expandedDeletedIds.clear();
    state.mobileShowThread = true;
    syncChatUrlId(state.activeConvId);
    const conv = state.conversations.find(c => Number(c.id) === Number(convId));
    if (conv && conv.unread_count > 0) {
      conv.unread_count = 0;
      recomputeUnread();
    }
    renderWorkspace();
    await loadMessages(convId);
    const inp = document.getElementById('zy-chat-input');
    if (inp) inp.focus();
  }

  async function openDirectWithContact(targetKey) {
    // Check if conversation already exists
    const existing = state.conversations.find(c =>
      (c.type === 'owner_agent' || c.type === 'agent_client') &&
      c.peer && c.peer.key === targetKey
    );
    if (existing) {
      return selectConversation(existing.id);
    }
    try {
      const data = await reqJson('/api/chat/direct', {
        method: 'POST',
        body: JSON.stringify({ target_key: targetKey })
      });
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === Number(data.conversation.id));
        if (idx === -1) state.conversations.unshift(data.conversation);
        else state.conversations[idx] = data.conversation;
        recomputeUnread();
        await selectConversation(data.conversation.id);
      }
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Cannot start chat', 'error');
    }
  }

  function formatByteSize(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function preloadAndRevoke(finalUrl, blobUrl) {
    if (!blobUrl) return;
    try {
      const pre = new Image();
      pre.onload = pre.onerror = () => {
        setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }, 1500);
      };
      pre.src = finalUrl;
    } catch (_) {
      try { URL.revokeObjectURL(blobUrl); } catch (__) {}
    }
  }

  function clearPendingImages() {
    if (Array.isArray(state.pendingImages)) {
      state.pendingImages.forEach(item => {
        if (item && item.previewUrl && !item._sent) {
          try { URL.revokeObjectURL(item.previewUrl); } catch (_) {}
        }
      });
    }
    state.pendingImages = [];
  }

  // Fast WhatsApp-style client-side image compression (WebP/JPEG max 1440px, ~60-180KB typical)
  async function compressImageFast(file) {
    const MAX_DIM = 1440;
    const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name || '');
    if (isGif && file.size <= 4 * 1024 * 1024) {
      return { blob: file, ext: 'gif', width: 0, height: 0, size: file.size };
    }

    let bmp = null;
    let imgEl = null;
    let origW = 0;
    let origH = 0;

    try {
      if (typeof createImageBitmap === 'function') {
        bmp = await createImageBitmap(file);
        origW = bmp.width;
        origH = bmp.height;
      } else {
        imgEl = await new Promise((resolve, reject) => {
          const im = new Image();
          const u = URL.createObjectURL(file);
          im.onload = () => { URL.revokeObjectURL(u); resolve(im); };
          im.onerror = () => { URL.revokeObjectURL(u); reject(new Error('Invalid image')); };
          im.src = u;
        });
        origW = imgEl.naturalWidth || imgEl.width;
        origH = imgEl.naturalHeight || imgEl.height;
      }
    } catch (_) {
      return { blob: file, ext: 'jpg', width: 0, height: 0, size: file.size };
    }

    // Already tiny and within max dimensions -> upload directly with zero delay
    if (file.size <= 120 * 1024 && origW <= MAX_DIM && origH <= MAX_DIM &&
        /^image\/(jpeg|png|webp)$/i.test(file.type || '')) {
      if (bmp && typeof bmp.close === 'function') bmp.close();
      const ext = file.type === 'image/png' ? 'png' : (file.type === 'image/webp' ? 'webp' : 'jpg');
      return { blob: file, ext, width: origW, height: origH, size: file.size };
    }

    const scale = Math.min(1, MAX_DIM / Math.max(origW || 1, origH || 1));
    const targetW = Math.max(1, Math.round(origW * scale));
    const targetH = Math.max(1, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp || imgEl, 0, 0, targetW, targetH);
    if (bmp && typeof bmp.close === 'function') bmp.close();

    const encode = (mime, quality) => new Promise(resolve => {
      try {
        canvas.toBlob(b => resolve(b), mime, quality);
      } catch (_) {
        resolve(null);
      }
    });

    // Prefer WebP for blazing fast upload speed; fallback to JPEG if browser lacks WebP encoder
    let outBlob = await encode('image/webp', 0.82);
    let outExt = 'webp';
    if (!outBlob || outBlob.type !== 'image/webp') {
      outBlob = await encode('image/jpeg', 0.82);
      outExt = 'jpg';
    }
    if (!outBlob || (outBlob.size > file.size && origW <= MAX_DIM && origH <= MAX_DIM)) {
      const origExt = file.type === 'image/png' ? 'png' : (file.type === 'image/webp' ? 'webp' : 'jpg');
      return { blob: file, ext: origExt, width: origW, height: origH, size: file.size };
    }
    return { blob: outBlob, ext: outExt, width: targetW, height: targetH, size: outBlob.size };
  }

  function queueImagesForPreview(fileList) {
    const conv = getActiveConv();
    if (!conv || !conv.can_send) return;
    const files = Array.from(fileList || []).filter(f => f && /^image\/(jpeg|jpg|png|webp|gif)$/i.test(f.type || ''));
    if (!files.length) {
      if (typeof toast === 'function') toast('Only JPG, PNG, WebP or GIF images are supported.', 'warning');
      return;
    }
    const maxSlots = Math.max(0, 5 - state.pendingImages.length);
    if (maxSlots <= 0) {
      if (typeof toast === 'function') toast('Maximum 5 photos can be queued at once.', 'warning');
      return;
    }

    const picked = files.slice(0, maxSlots);
    picked.forEach(file => {
      if (file.size > 20 * 1024 * 1024) {
        if (typeof toast === 'function') toast(`${file.name} is too large (max 20 MB).`, 'warning');
        return;
      }
      const item = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        blob: null,
        ext: 'webp',
        previewUrl: URL.createObjectURL(file),
        width: 0,
        height: 0,
        size: file.size,
        compressing: true,
        promise: null
      };
      item.promise = compressImageFast(file).then(res => {
        item.blob = res.blob;
        item.ext = res.ext;
        item.width = res.width;
        item.height = res.height;
        item.size = res.size;
        item.compressing = false;
        renderMediaStrip();
        return item;
      }).catch(() => {
        item.blob = file;
        item.compressing = false;
        renderMediaStrip();
        return item;
      });
      state.pendingImages.push(item);
    });

    state.emojiOpen = false;
    renderEmojiPopover();
    renderMediaStrip();
    const inp = document.getElementById('zy-chat-input');
    if (inp) inp.focus();
  }

  function renderMediaStrip() {
    const el = document.getElementById('zy-chat-media-strip');
    const inp = document.getElementById('zy-chat-input');
    if (inp) {
      inp.placeholder = state.pendingImages.length ? 'Add a caption...' : 'Type a message...';
    }
    if (!el) return;
    if (!state.pendingImages.length) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'flex';
    el.innerHTML = `
      <div class="zy-chat-media-thumbs">
        ${state.pendingImages.map(item => `
          <div class="zy-chat-media-thumb-card" data-pimg="${esc(item.id)}">
            <img src="${item.previewUrl}" alt="Preview">
            <button type="button" class="zy-chat-media-remove" data-rm-pimg="${esc(item.id)}" title="Remove"><i class="fas fa-times"></i></button>
            <span class="zy-chat-media-size">${item.compressing ? '<i class="fas fa-spinner fa-spin"></i>' : esc(formatByteSize(item.size))}</span>
          </div>
        `).join('')}
        ${state.pendingImages.length < 5 ? `
          <button type="button" class="zy-chat-media-add-more" id="zy-chat-media-add-more" title="Add another photo">
            <i class="fas fa-plus"></i>
          </button>
        ` : ''}
      </div>
    `;
    el.querySelectorAll('[data-rm-pimg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.rmPimg;
        const idx = state.pendingImages.findIndex(x => x.id === id);
        if (idx !== -1) {
          const [removed] = state.pendingImages.splice(idx, 1);
          if (removed && removed.previewUrl) {
            try { URL.revokeObjectURL(removed.previewUrl); } catch (_) {}
          }
          renderMediaStrip();
        }
      });
    });
    const addMore = document.getElementById('zy-chat-media-add-more');
    if (addMore) {
      addMore.addEventListener('click', () => {
        const fi = document.getElementById('zy-chat-file-input');
        if (fi) fi.click();
      });
    }
  }

  function uploadChatImageXhr(convId, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/chat/conversations/${convId}/messages-media`, true);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && typeof onProgress === 'function') {
          onProgress(Math.min(99, Math.max(5, Math.round((ev.loaded / ev.total) * 100))));
        }
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error while uploading image'));
      xhr.send(formData);
    });
  }

  async function sendPendingImages(captionText, replySnapshot) {
    const convId = Number(state.activeConvId);
    if (!convId || !state.pendingImages.length) return;

    const batch = state.pendingImages.splice(0, state.pendingImages.length);
    batch.forEach(item => { item._sent = true; });
    renderMediaStrip();

    if (!state.messagesByConv.has(convId)) state.messagesByConv.set(convId, []);
    const arr = state.messagesByConv.get(convId);

    // Push instant 0ms optimistic bubbles for every photo in the batch
    const tasks = batch.map((item, idx) => {
      const caption = idx === 0 ? captionText : '';
      const replyForThis = idx === 0 ? replySnapshot : null;
      const tempId = -(Date.now() + idx + Math.floor(Math.random() * 999));
      const clientTempId = `ct_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`;
      const optimistic = {
        id: tempId,
        conversation_id: convId,
        sender_key: state.me.key,
        sender_role: state.me.role,
        sender_name: state.me.display_name || state.me.username,
        body: caption,
        image: {
          url: item.previewUrl,
          width: item.width || undefined,
          height: item.height || undefined,
          size: item.size
        },
        reply_to: replyForThis ? {
          id: replyForThis.id,
          sender_name: replyForThis.sender_name,
          body_snippet: String(replyForThis.body || '').slice(0, 120)
        } : null,
        deleted: false,
        created_at: new Date().toISOString(),
        _optimistic: true,
        _isMedia: true,
        _clientTempId: clientTempId,
        _localPreviewUrl: item.previewUrl,
        _uploadProgress: 8
      };
      arr.push(optimistic);
      return { item, caption, replyForThis, tempId, clientTempId };
    });

    renderMessagesPane(true);

    // Upload all images concurrently for blazing-fast delivery
    await Promise.all(tasks.map(async ({ item, caption, replyForThis, tempId, clientTempId }) => {
      try {
        if (item.compressing && item.promise) {
          await item.promise;
        }
        const blobToSend = item.blob || item.file;
        const fd = new FormData();
        fd.append('image', blobToSend, `photo.${item.ext || 'webp'}`);
        if (caption) fd.append('body', caption);
        if (replyForThis && replyForThis.id) fd.append('reply_to_id', String(replyForThis.id));
        if (item.width) fd.append('width', String(item.width));
        if (item.height) fd.append('height', String(item.height));
        fd.append('client_temp_id', clientTempId);

        const data = await uploadChatImageXhr(convId, fd, (pct) => {
          const bar = document.querySelector(`[data-upload-bar="${tempId}"]`);
          if (bar) bar.style.width = `${pct}%`;
          const lbl = document.querySelector(`[data-upload-pct="${tempId}"]`);
          if (lbl) lbl.textContent = `${pct}%`;
        });

        const list = state.messagesByConv.get(convId) || [];
        const optIdx = list.findIndex(m => m.id === tempId || (m._clientTempId && m._clientTempId === clientTempId));
        if (data.message) {
          const dupIdx = list.findIndex(m => Number(m.id) === Number(data.message.id));
          if (dupIdx !== -1 && optIdx !== -1 && dupIdx !== optIdx) {
            list.splice(optIdx, 1);
          } else if (optIdx !== -1) {
            list[optIdx] = data.message;
          } else if (dupIdx === -1) {
            list.push(data.message);
          }
          if (data.message.image && data.message.image.url) {
            preloadAndRevoke(data.message.image.url, item.previewUrl);
          }
        }
        if (data.conversation) {
          const cIdx = state.conversations.findIndex(c => Number(c.id) === convId);
          if (cIdx !== -1) state.conversations[cIdx] = data.conversation;
          state.conversations.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
        }
        renderInboxList();
        if (Number(state.activeConvId) === convId) renderMessagesPane(true);
      } catch (err) {
        const list = state.messagesByConv.get(convId) || [];
        const optIdx = list.findIndex(m => m.id === tempId);
        if (optIdx !== -1) list.splice(optIdx, 1);
        try { URL.revokeObjectURL(item.previewUrl); } catch (_) {}
        if (Number(state.activeConvId) === convId) renderMessagesPane(false);
        if (typeof toast === 'function') toast(err.message || 'Failed to upload photo', 'error');
      }
    }));
  }

  function openImageLightbox(url, caption, sender, timeStr) {
    closeImageLightbox();
    const lb = document.createElement('div');
    lb.id = 'zy-chat-lightbox';
    lb.className = 'zy-chat-lightbox';
    lb.innerHTML = `
      <div class="zy-chat-lb-bar">
        <div class="zy-chat-lb-meta">
          <div class="zy-chat-lb-who">${esc(sender || 'Photo')}</div>
          ${timeStr ? `<div class="zy-chat-lb-time">${esc(timeStr)}</div>` : ''}
        </div>
        <div class="zy-chat-lb-actions">
          <a class="zy-chat-lb-btn" href="${esc(url)}" download title="Download"><i class="fas fa-download"></i></a>
          <button type="button" class="zy-chat-lb-btn" id="zy-chat-lb-close" title="Close"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="zy-chat-lb-stage">
        <img class="zy-chat-lb-img" src="${esc(url)}" alt="${esc(caption || 'Chat Photo')}">
      </div>
      ${caption ? `<div class="zy-chat-lb-caption">${esc(caption)}</div>` : ''}
    `;
    const onKey = (e) => {
      if (e.key === 'Escape') closeImageLightbox();
    };
    lb._escHandler = onKey;
    document.addEventListener('keydown', onKey);
    lb.addEventListener('click', (e) => {
      if (e.target === lb || e.target.classList.contains('zy-chat-lb-stage')) closeImageLightbox();
    });
    lb.querySelector('#zy-chat-lb-close').addEventListener('click', closeImageLightbox);
    document.body.appendChild(lb);
  }

  function closeImageLightbox() {
    const lb = document.getElementById('zy-chat-lightbox');
    if (lb) {
      if (lb._escHandler) document.removeEventListener('keydown', lb._escHandler);
      lb.remove();
    }
  }

  async function sendMessage() {
    if (!state.activeConvId) return;
    const input = document.getElementById('zy-chat-input');
    if (!input) return;
    const body = String(input.value || '').trim();
    const hasPendingPhotos = state.pendingImages.length > 0;
    if (!body && !hasPendingPhotos) return;

    const convId = Number(state.activeConvId);
    const replySnapshot = state.replyTo ? { ...state.replyTo } : null;

    if (hasPendingPhotos) {
      input.value = '';
      input.style.height = 'auto';
      state.replyTo = null;
      state.emojiOpen = false;
      stopTypingSignal(convId);
      renderReplyStrip();
      renderEmojiPopover();
      await sendPendingImages(body, replySnapshot);
      return;
    }

    if (state.sending) return;

    // Optimistic insert (text)
    const tempId = -Date.now();
    const optimistic = {
      id: tempId,
      conversation_id: convId,
      sender_key: state.me.key,
      sender_role: state.me.role,
      sender_name: state.me.display_name || state.me.username,
      body,
      reply_to: replySnapshot ? {
        id: replySnapshot.id,
        sender_name: replySnapshot.sender_name,
        body_snippet: String(replySnapshot.body || '').slice(0, 120)
      } : null,
      deleted: false,
      created_at: new Date().toISOString(),
      _optimistic: true
    };
    if (!state.messagesByConv.has(convId)) state.messagesByConv.set(convId, []);
    state.messagesByConv.get(convId).push(optimistic);

    input.value = '';
    input.style.height = 'auto';
    state.replyTo = null;
    state.emojiOpen = false;
    stopTypingSignal(convId);
    renderReplyStrip();
    renderEmojiPopover();
    renderMessagesPane(true);

    state.sending = true;
    try {
      const data = await reqJson(`/api/chat/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          reply_to_id: replySnapshot ? replySnapshot.id : null
        })
      });
      const arr = state.messagesByConv.get(convId) || [];
      const optIdx = arr.findIndex(m => m.id === tempId);
      if (data.message) {
        const dupIdx = arr.findIndex(m => Number(m.id) === Number(data.message.id));
        if (dupIdx !== -1 && optIdx !== -1 && dupIdx !== optIdx) {
          arr.splice(optIdx, 1);
        } else if (optIdx !== -1) {
          arr[optIdx] = data.message;
        } else if (dupIdx === -1) {
          arr.push(data.message);
        }
      }
      if (data.conversation) {
        const cIdx = state.conversations.findIndex(c => Number(c.id) === convId);
        if (cIdx !== -1) state.conversations[cIdx] = data.conversation;
        state.conversations.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
      }
      renderInboxList();
      renderMessagesPane(true);
    } catch (err) {
      // Rollback optimistic message
      const arr = state.messagesByConv.get(convId) || [];
      const optIdx = arr.findIndex(m => m.id === tempId);
      if (optIdx !== -1) arr.splice(optIdx, 1);
      input.value = body;
      renderMessagesPane(false);
      if (typeof toast === 'function') toast(err.message || 'Failed to send message', 'error');
    } finally {
      state.sending = false;
    }
  }

  function emitTypingSignal(convId) {
    if (!convId) return;
    if (!state.isTypingActive) {
      state.isTypingActive = true;
      sendWsFrame({ type: 'chat:typing', conversation_id: Number(convId), is_typing: true });
    }
    clearTimeout(state.typingSentTimer);
    state.typingSentTimer = setTimeout(() => stopTypingSignal(convId), 2000);
  }

  function stopTypingSignal(convId) {
    clearTimeout(state.typingSentTimer);
    if (state.isTypingActive && convId) {
      state.isTypingActive = false;
      sendWsFrame({ type: 'chat:typing', conversation_id: Number(convId), is_typing: false });
    }
  }

  async function deleteMessage(convId, msgId) {
    try {
      const data = await reqJson(`/api/chat/conversations/${convId}/messages/${msgId}?hide_self=1`, { method: 'DELETE' });
      const arr = state.messagesByConv.get(Number(convId));
      if (arr) {
        const idx = arr.findIndex(m => Number(m.id) === Number(msgId));
        if (idx !== -1) arr.splice(idx, 1);
      }
      state.selectedMsgIds.delete(Number(msgId));
      if (data && data.conversation) {
        const cIdx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (cIdx !== -1) state.conversations[cIdx] = data.conversation;
      }
      if (state.mounted) {
        renderInboxList();
        if (Number(state.activeConvId) === Number(convId)) renderThreadArea(false);
      }
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Cannot delete message', 'error');
    }
  }

  async function bulkDeleteSelectedMessages(convId) {
    const ids = Array.from(state.selectedMsgIds).map(Number).filter(n => n > 0);
    if (!ids.length) {
      if (typeof toast === 'function') toast('Select at least one message first', 'warning');
      return;
    }
    try {
      const data = await reqJson(`/api/chat/conversations/${convId}/messages/bulk-delete`, {
        method: 'POST',
        body: JSON.stringify({ message_ids: ids })
      });
      const idSet = new Set(ids);
      const arr = state.messagesByConv.get(Number(convId)) || [];
      state.messagesByConv.set(Number(convId), arr.filter(m => !idSet.has(Number(m.id))));
      state.selectedMsgIds.clear();
      state.selectMode = false;
      if (data && data.conversation) {
        const cIdx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (cIdx !== -1) state.conversations[cIdx] = data.conversation;
      }
      recomputeUnread();
      if (state.mounted) {
        renderInboxList();
        renderThreadArea(false);
      }
      if (typeof toast === 'function') {
        toast(`${ids.length} message${ids.length === 1 ? '' : 's'} deleted`, 'success');
      }
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to delete selected messages', 'error');
    }
  }

  async function clearChatHistory(convId) {
    const runClear = async () => {
      try {
        const data = await reqJson(`/api/chat/conversations/${convId}/clear-history`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        state.messagesByConv.set(Number(convId), []);
        state.selectedMsgIds.clear();
        state.selectMode = false;
        state.expandedDeletedIds.clear();
        if (data && data.conversation) {
          const cIdx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
          if (cIdx !== -1) state.conversations[cIdx] = data.conversation;
        }
        recomputeUnread();
        if (state.mounted) {
          renderInboxList();
          renderThreadArea(false);
        }
        if (typeof toast === 'function') toast('Chat history cleared', 'success');
      } catch (err) {
        if (typeof toast === 'function') toast(err.message || 'Failed to clear chat history', 'error');
      }
    };

    if (typeof window.zyConfirm === 'function') {
      const ok = await window.zyConfirm('Clear Chat History', 'Remove all messages in this chat from your view?');
      if (ok) await runClear();
    } else {
      await runClear();
    }
  }

  function updateSelectBarUi() {
    const bar = document.getElementById('zy-chat-select-bar');
    if (!bar) return;
    const cnt = state.selectedMsgIds.size;
    const cntEl = document.getElementById('zy-chat-sel-count');
    const delBtn = document.getElementById('zy-chat-sel-del');
    if (cntEl) cntEl.textContent = `${cnt} selected`;
    if (delBtn) delBtn.disabled = cnt === 0;
  }

  async function pinMessage(convId, msgId) {
    try {
      const data = await reqJson(`/api/chat/groups/${convId}/pin`, {
        method: 'POST',
        body: JSON.stringify({ message_id: msgId || null })
      });
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (idx !== -1) state.conversations[idx] = data.conversation;
        renderThreadArea(false);
      }
      if (typeof toast === 'function') toast(msgId ? 'Message pinned to group' : 'Pinned message cleared', 'success');
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to pin message', 'error');
    }
  }

  // ── Reactions, Seen Inspector & Group/Channel Avatar Helpers ──
  async function fileToAvatarDataUri(file) {
    if (!file) throw new Error('No image selected');
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.type || '')) {
      throw new Error('Only JPG, PNG, WebP or GIF images are allowed');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('Image is too large (max 10 MB)');
    }
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      const url = URL.createObjectURL(file);
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image file')); };
      im.src = url;
    });
    const w = img.naturalWidth || img.width || 1;
    const h = img.naturalHeight || img.height || 1;
    const side = Math.min(w, h);
    const sx = Math.floor((w - side) / 2);
    const sy = Math.floor((h - side) / 2);
    const outSize = Math.min(512, Math.max(128, side));
    const canvas = document.createElement('canvas');
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, outSize, outSize);
    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/webp', 0.86);
    } catch (_) {}
    if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    }
    return dataUrl;
  }

  async function uploadGroupAvatar(convId, file) {
    if (!file || state.uploadingGroupAvatar) return;
    state.uploadingGroupAvatar = true;
    renderThreadArea(false);
    try {
      const image = await fileToAvatarDataUri(file);
      const data = await reqJson(`/api/chat/groups/${convId}/avatar`, {
        method: 'POST',
        body: JSON.stringify({ image })
      });
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (idx !== -1) state.conversations[idx] = data.conversation;
      }
      if (typeof toast === 'function') toast('Photo updated successfully', 'success');
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to upload photo', 'error');
    } finally {
      state.uploadingGroupAvatar = false;
      if (state.mounted) {
        renderInboxList();
        renderThreadArea(false);
      }
    }
  }

  async function removeGroupAvatar(convId) {
    if (state.uploadingGroupAvatar) return;
    state.uploadingGroupAvatar = true;
    renderThreadArea(false);
    try {
      const data = await reqJson(`/api/chat/groups/${convId}/avatar`, {
        method: 'POST',
        body: JSON.stringify({ remove: true })
      });
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (idx !== -1) state.conversations[idx] = data.conversation;
      }
      if (typeof toast === 'function') toast('Photo removed', 'success');
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to remove photo', 'error');
    } finally {
      state.uploadingGroupAvatar = false;
      if (state.mounted) {
        renderInboxList();
        renderThreadArea(false);
      }
    }
  }

  async function toggleMessageReaction(convId, msgId, emoji) {
    convId = Number(convId);
    msgId = Number(msgId);
    state.reactionPickerMsgId = null;
    const arr = state.messagesByConv.get(convId);
    const msg = arr ? arr.find(m => Number(m.id) === msgId) : null;
    const prevSummary = msg && Array.isArray(msg.reactions_summary)
      ? msg.reactions_summary.map(r => ({ ...r }))
      : [];

    // Optimistic WhatsApp single-reaction toggle/switch
    if (msg) {
      const next = prevSummary.map(r => ({ ...r }));
      const mineIdx = next.findIndex(r => r.me);
      let togglingOff = false;
      if (mineIdx !== -1) {
        if (next[mineIdx].emoji === emoji) togglingOff = true;
        next[mineIdx].count = Math.max(0, Number(next[mineIdx].count || 1) - 1);
        next[mineIdx].me = false;
        if (next[mineIdx].count <= 0) next.splice(mineIdx, 1);
      }
      if (!togglingOff) {
        const targetIdx = next.findIndex(r => r.emoji === emoji);
        if (targetIdx !== -1) {
          next[targetIdx].count = Number(next[targetIdx].count || 0) + 1;
          next[targetIdx].me = true;
        } else {
          next.push({ emoji, count: 1, me: true });
        }
      }
      msg.reactions_summary = next;
      const feed = document.getElementById('zy-chat-feed');
      const prevScroll = feed ? feed.scrollTop : null;
      renderMessagesPane(false);
      if (feed && prevScroll != null) feed.scrollTop = prevScroll;
    }

    try {
      const data = await reqJson(`/api/chat/conversations/${convId}/messages/${msgId}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji })
      });
      if (msg && Array.isArray(data.reactions_summary)) {
        msg.reactions_summary = data.reactions_summary;
        const feed = document.getElementById('zy-chat-feed');
        const prevScroll = feed ? feed.scrollTop : null;
        renderMessagesPane(false);
        if (feed && prevScroll != null) feed.scrollTop = prevScroll;
      }
    } catch (err) {
      if (msg) {
        msg.reactions_summary = prevSummary;
        const feed = document.getElementById('zy-chat-feed');
        const prevScroll = feed ? feed.scrollTop : null;
        renderMessagesPane(false);
        if (feed && prevScroll != null) feed.scrollTop = prevScroll;
      }
      if (typeof toast === 'function') toast(err.message || 'Could not update reaction', 'error');
    }
  }

  async function refreshSeenModalData(convId, msgId) {
    try {
      const data = await reqJson(`/api/chat/conversations/${convId}/messages/${msgId}/seen`);
      if (state.seenModal && Number(state.seenModal.convId) === Number(convId) && Number(state.seenModal.msgId) === Number(msgId)) {
        state.seenModal.loading = false;
        state.seenModal.data = data;
        state.seenModal.error = '';
        renderSeenModalOverlay();
      }
    } catch (err) {
      if (state.seenModal && Number(state.seenModal.convId) === Number(convId) && Number(state.seenModal.msgId) === Number(msgId)) {
        state.seenModal.loading = false;
        state.seenModal.error = err.message || 'Failed to load message info';
        renderSeenModalOverlay();
      }
    }
  }

  function openMessageSeenModal(convId, msgId) {
    state.reactionPickerMsgId = null;
    state.seenModal = {
      loading: true,
      convId: Number(convId),
      msgId: Number(msgId),
      data: null,
      error: ''
    };
    renderSeenModalOverlay();
    refreshSeenModalData(convId, msgId);
  }

  function closeMessageSeenModal() {
    state.seenModal = null;
    renderSeenModalOverlay();
  }

  // ── Agent Group & Announcement Channel Admin Actions ──
  async function createGroupFromModal() {
    const isChannel = state.createModalMode === 'channel';
    const titleEl = document.getElementById('zy-cg-title');
    const descEl = document.getElementById('zy-cg-desc');
    const adminOnlyEl = document.getElementById('zy-cg-admin-only');
    const checks = Array.from(document.querySelectorAll('.zy-cg-member-cb:checked'));
    const title = titleEl ? titleEl.value.trim() : '';
    const description = descEl ? descEl.value.trim() : '';
    const admin_only = isChannel ? true : Boolean(adminOnlyEl && adminOnlyEl.checked);
    const member_client_ids = checks.map(cb => Number(cb.value)).filter(n => n > 0);

    if (!title) {
      if (typeof toast === 'function') toast(isChannel ? 'Please enter a channel name' : 'Please enter a group name', 'warning');
      return;
    }
    if (!member_client_ids.length) {
      if (typeof toast === 'function') toast('Select at least 1 of your clients', 'warning');
      return;
    }

    const submitBtn = document.getElementById('zy-cg-submit');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const payload = {
        title,
        description,
        admin_only,
        is_channel: isChannel,
        type: isChannel ? 'agent_channel' : 'agent_group',
        member_client_ids
      };
      if (state.createModalAvatar) payload.avatar = state.createModalAvatar;
      const data = await reqJson('/api/chat/groups', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      state.createModalOpen = false;
      state.createModalAvatar = '';
      state.createModalSearch = '';
      if (data.conversation) {
        state.conversations.unshift(data.conversation);
        recomputeUnread();
        await selectConversation(data.conversation.id);
      }
      if (typeof toast === 'function') {
        toast(isChannel ? `Announcement Channel "${title}" created` : `Group "${title}" created`, 'success');
      }
    } catch (err) {
      if (submitBtn) submitBtn.disabled = false;
      if (typeof toast === 'function') toast(err.message || (isChannel ? 'Failed to create channel' : 'Failed to create group'), 'error');
    }
  }

  async function saveGroupMeta(convId) {
    const conv = state.conversations.find(c => Number(c.id) === Number(convId));
    const isCh = isChannelConv(conv);
    const titleEl = document.getElementById('zy-gd-title');
    const descEl = document.getElementById('zy-gd-desc');
    const title = titleEl ? titleEl.value.trim() : '';
    const description = descEl ? descEl.value.trim() : '';
    if (!title) {
      if (typeof toast === 'function') toast(isCh ? 'Channel name cannot be empty' : 'Group name cannot be empty', 'warning');
      return;
    }
    try {
      const data = await reqJson(`/api/chat/groups/${convId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, description })
      });
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (idx !== -1) state.conversations[idx] = data.conversation;
        renderWorkspace();
      }
      if (typeof toast === 'function') toast(isCh ? 'Announcement Channel updated' : 'Group info updated', 'success');
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to update settings', 'error');
    }
  }

  async function toggleGroupAdminOnly(convId, nextVal) {
    try {
      const data = await reqJson(`/api/chat/groups/${convId}`, {
        method: 'PATCH',
        body: JSON.stringify({ admin_only: Boolean(nextVal) })
      });
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (idx !== -1) state.conversations[idx] = data.conversation;
        renderWorkspace();
      }
      if (typeof toast === 'function') {
        toast(nextVal ? 'Admin-only mode enabled (Clients muted)' : 'Open mode enabled (Members can chat via anonymous ID)', 'success');
      }
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to update setting', 'error');
    }
  }

  async function saveGroupSchedule(convId) {
    const enEl = document.getElementById('zy-gd-sched-enabled');
    const closeEl = document.getElementById('zy-gd-sched-close');
    const openEl = document.getElementById('zy-gd-sched-open');
    const closeMsgEl = document.getElementById('zy-gd-sched-close-msg');
    const openMsgEl = document.getElementById('zy-gd-sched-open-msg');

    const enabled = Boolean(enEl && enEl.checked);
    const close_time = (closeEl && closeEl.value) ? closeEl.value.trim() : '23:00';
    const open_time = (openEl && openEl.value) ? openEl.value.trim() : '09:00';
    const close_message = (closeMsgEl && closeMsgEl.value) ? closeMsgEl.value.trim() : DEFAULT_CLOSE_MSG;
    const open_message = (openMsgEl && openMsgEl.value) ? openMsgEl.value.trim() : DEFAULT_OPEN_MSG;

    if (enabled && close_time === open_time) {
      if (typeof toast === 'function') toast('Close time and Open time cannot be the same.', 'warning');
      return;
    }

    try {
      const data = await reqJson(`/api/chat/groups/${convId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          schedule: { enabled, close_time, open_time, close_message, open_message }
        })
      });
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (idx !== -1) state.conversations[idx] = data.conversation;
        await loadMessages(convId, { silent: true });
        renderWorkspace();
      }
      if (typeof toast === 'function') {
        toast(
          enabled
            ? `Auto schedule saved (${formatTime12h(close_time)} – ${formatTime12h(open_time)} PKT)`
            : 'Auto night/morning schedule disabled',
          'success'
        );
      }
    } catch (err) {
      const msg = typeof window.zyHumanizeError === 'function' ? window.zyHumanizeError(err) : (err.message || 'Failed to save schedule');
      if (typeof toast === 'function') toast(msg, 'error');
    }
  }

  async function updateGroupMembers(convId, addIds, removeIds) {
    const conv = state.conversations.find(c => Number(c.id) === Number(convId));
    const isCh = isChannelConv(conv);
    try {
      const data = await reqJson(`/api/chat/groups/${convId}/members`, {
        method: 'POST',
        body: JSON.stringify({ add_client_ids: addIds || [], remove_client_ids: removeIds || [] })
      });
      if (data.conversation) {
        const idx = state.conversations.findIndex(c => Number(c.id) === Number(convId));
        if (idx !== -1) state.conversations[idx] = data.conversation;
        renderWorkspace();
      }
      if (typeof toast === 'function') {
        const addCount = Array.isArray(addIds) ? addIds.length : 0;
        const lbl = isCh ? 'channel' : 'group';
        toast(addCount > 0 ? `${addCount} member${addCount === 1 ? '' : 's'} added to ${lbl}` : `Member removed from ${lbl}`, 'success');
      }
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to update members', 'error');
    }
  }

  async function deleteGroup(convId) {
    const conv = state.conversations.find(c => Number(c.id) === Number(convId));
    const isCh = isChannelConv(conv);
    try {
      await reqJson(`/api/chat/groups/${convId}`, { method: 'DELETE' });
      state.conversations = state.conversations.filter(c => Number(c.id) !== Number(convId));
      state.messagesByConv.delete(Number(convId));
      state.activeConvId = null;
      state.drawerOpen = false;
      state.confirmDeleteGroup = false;
      state.mobileShowThread = false;
      recomputeUnread();
      renderWorkspace();
      if (typeof toast === 'function') toast(isCh ? 'Announcement Channel deleted' : 'Group deleted', 'success');
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to delete', 'error');
    }
  }

  // ── Rendering Helpers ──
  function getActiveConv() {
    return state.conversations.find(c => Number(c.id) === Number(state.activeConvId)) || null;
  }

  function getTypingText(convId) {
    const map = state.typingByConv.get(Number(convId));
    if (!map || map.size === 0) return '';
    const names = Array.from(map.values()).map(v => v.name);
    if (names.length === 1) return `${names[0]} is typing...`;
    return `${names.slice(0, 2).join(', ')} typing...`;
  }

  function computeLiveAdminSeen(msg, conv) {
    if (!conv || !conv.can_manage || !isGroupOrChannel(conv) || msg._optimistic || msg.deleted) return null;
    const joinedAfter = (conv.member_joined_after_id && typeof conv.member_joined_after_id === 'object') ? conv.member_joined_after_id : {};
    const clientKeys = (conv.participants || []).filter(k =>
      String(k).startsWith('client:') &&
      k !== msg.sender_key &&
      Number(msg.id) > Number(joinedAfter[k] || 0)
    );
    const total = clientKeys.length;
    const cursors = conv.read_cursors || {};
    let seen = 0;
    for (let i = 0; i < clientKeys.length; i++) {
      if (Number(cursors[clientKeys[i]] || 0) >= Number(msg.id)) seen++;
    }
    if (typeof msg.seen_count === 'number' && msg.seen_count > seen && msg.seen_count <= total) {
      seen = msg.seen_count;
    }
    return { seen, total };
  }

  function computeTickHtml(msg, conv) {
    if (!state.me || msg.sender_key !== state.me.key) return '';
    if (msg._optimistic) {
      return '<span class="zy-chat-tick is-pending" title="Sending"><i class="far fa-clock"></i></span>';
    }
    const joinedAfter = (conv.member_joined_after_id && typeof conv.member_joined_after_id === 'object') ? conv.member_joined_after_id : {};
    const others = (conv.participants || []).filter(k =>
      k !== state.me.key &&
      (!isGroupOrChannel(conv) || !String(k).startsWith('client:') || Number(msg.id) > Number(joinedAfter[k] || 0))
    );
    const cursors = conv.read_cursors || {};
    const anySeen = others.some(k => Number(cursors[k] || 0) >= Number(msg.id));
    if (anySeen) {
      return '<span class="zy-chat-tick is-seen" title="Seen"><i class="fas fa-check-double"></i></span>';
    }
    const peerOnline = isGroupOrChannel(conv)
      ? (conv.members || []).some(m => m.key !== state.me.key && m.online)
      : Boolean(conv.peer && conv.peer.online);
    if (peerOnline) {
      return '<span class="zy-chat-tick is-delivered" title="Delivered"><i class="fas fa-check-double"></i></span>';
    }
    return '<span class="zy-chat-tick is-sent" title="Sent"><i class="fas fa-check"></i></span>';
  }

  function syncAgentTabBadges() {
    const unreadTabBadge = document.getElementById('zy-chat-unread-tab-cnt');
    if (!unreadTabBadge) return;
    const unreadChats = state.conversations.filter(c => Number(c.unread_count || 0) > 0).length;
    if (unreadChats > 0) {
      unreadTabBadge.textContent = unreadChats > 99 ? '99+' : String(unreadChats);
      unreadTabBadge.style.display = 'inline-flex';
    } else {
      unreadTabBadge.textContent = '0';
      unreadTabBadge.style.display = 'none';
    }
  }

  function renderInboxList() {
    const listEl = document.getElementById('zy-chat-inbox-list');
    if (!listEl) return;
    syncAgentTabBadges();

    const q = state.search.trim().toLowerCase();
    const isAgent = state.me && state.me.role === 'agent';

    const filteredConvs = state.conversations.filter(c => {
      if (isAgent) {
        if (state.filterTab === 'unread' && Number(c.unread_count || 0) <= 0) return false;
        if (state.filterTab === 'owner' && c.type !== 'owner_agent') return false;
        if (state.filterTab === 'clients' && c.type !== 'agent_client') return false;
        if (state.filterTab === 'groups' && c.type !== 'agent_group') return false;
        if (state.filterTab === 'channels' && c.type !== 'agent_channel') return false;
      }
      if (!q) return true;
      const hay = `${c.title || ''} ${c.last_message_preview || ''} ${(c.peer && c.peer.username) || ''}`.toLowerCase();
      return hay.includes(q);
    });

    // Contacts that do not yet have an open 1-to-1 thread
    const existingPeerKeys = new Set(
      state.conversations
        .filter(c => !isGroupOrChannel(c) && c.peer)
        .map(c => c.peer.key)
    );
    const availableContacts = state.contacts.filter(ct => {
      if (existingPeerKeys.has(ct.key)) return false;
      if (isAgent) {
        if (state.filterTab === 'unread' || state.filterTab === 'groups' || state.filterTab === 'channels') return false;
        if (state.filterTab === 'owner' && ct.role !== 'owner') return false;
        if (state.filterTab === 'clients' && ct.role !== 'client') return false;
      }
      if (!q) return true;
      return `${ct.display_name || ''} ${ct.username || ''}`.toLowerCase().includes(q);
    }).sort((a, b) => String(a.display_name || a.username || '').localeCompare(String(b.display_name || b.username || ''), undefined, { sensitivity: 'base' }));

    let html = '';

    const isClientActor = Boolean(state.me && state.me.role === 'client');
    if (filteredConvs.length) {
      html += filteredConvs.map(c => {
        const active = Number(c.id) === Number(state.activeConvId);
        const isCh = isChannelConv(c);
        const isGrp = isGroupConv(c);
        const isMulti = isCh || isGrp;
        const hideMembers = Boolean(isClientActor || c.hide_members);
        const isOnline = !isMulti && Boolean(c.peer && c.peer.online);
        const typingText = getTypingText(c.id);
        const schedClosed = isGrp && c.schedule_state && c.schedule_state.enabled && c.schedule_state.is_closed;

        let roleSub = '';
        if (isCh) {
          roleSub = hideMembers
            ? 'Announcement Channel'
            : `Announcement Channel · ${(c.members || []).length} members`;
        } else if (isGrp) {
          roleSub = hideMembers
            ? `Group${schedClosed ? ` · Closed until ${formatTime12h(c.schedule_state.open_time)}` : (c.admin_only ? ' · Admin only' : '')}`
            : `Group · ${(c.members || []).length} members${schedClosed ? ` · Closed until ${formatTime12h(c.schedule_state.open_time)}` : (c.admin_only ? ' · Admin only' : '')}`;
        } else {
          roleSub = c.peer && c.peer.role === 'owner' ? 'Owner' : (c.peer && c.peer.role === 'agent' ? 'Agent' : 'Client');
        }

        const previewHtml = typingText
          ? `<span class="zy-chat-typing-mini">${esc(typingText)}</span>`
          : esc(c.last_message_preview || (isCh ? 'Official announcements from Admin' : 'No messages yet'));

        const avaUrl = isMulti ? (c.avatar_url || '') : (c.peer ? (c.peer.avatar_url || '') : '');
        const avaBg = isCh ? '#b45309' : (isGrp ? '#0f766e' : colorForKey(c.peer ? c.peer.key : c.id));
        return `
          <button type="button" class="zy-chat-row ${active ? 'is-active' : ''} ${isCh ? 'is-channel-row' : ''}" data-conv-id="${c.id}">
            <div class="zy-chat-ava ${isCh ? 'is-channel' : (isGrp ? 'is-group' : '')} ${avaUrl ? 'has-img' : ''}" style="--ava-bg:${avaBg};">
              ${renderAvatarInner(avaUrl, c.title, isGrp, isOnline, isCh)}
            </div>
            <div class="zy-chat-row-body">
              <div class="zy-chat-row-top">
                <span class="zy-chat-row-name-wrap">
                  <span class="zy-chat-row-name">${esc(c.title)}</span>
                  ${isCh ? `<span class="zy-chat-ch-badge is-mini" title="Announcement Channel"><i class="fas fa-bullhorn"></i> Channel</span>` : ''}
                </span>
                <span class="zy-chat-row-time">${esc(formatInboxTime(c.last_message_at))}</span>
              </div>
              <div class="zy-chat-row-sub">${esc(roleSub)}</div>
              <div class="zy-chat-row-bottom">
                <span class="zy-chat-row-preview">${previewHtml}</span>
                ${c.unread_count > 0 ? `<span class="zy-chat-unread-pill">${c.unread_count > 99 ? '99+' : c.unread_count}</span>` : ''}
              </div>
            </div>
          </button>
        `;
      }).join('');
    }

    if (availableContacts.length) {
      const heading = state.me && state.me.role === 'owner'
        ? 'Agents Directory'
        : (state.me && state.me.role === 'agent' ? 'Start Direct Chat' : 'Your Assigned Agent');
      html += `<div class="zy-chat-sec-label">${esc(heading)}</div>`;
      html += availableContacts.map(ct => {
        const roleLabel = ct.role === 'owner' ? 'Owner' : (ct.role === 'agent' ? 'Agent' : 'My Client');
        const ctAvatar = ct.avatar_url || '';
        return `
          <button type="button" class="zy-chat-row is-contact" data-contact-key="${esc(ct.key)}">
            <div class="zy-chat-ava ${ctAvatar ? 'has-img' : ''}" style="--ava-bg:${colorForKey(ct.key)};">
              ${renderAvatarInner(ctAvatar, ct.display_name || ct.username, false, Boolean(ct.online), false)}
            </div>
            <div class="zy-chat-row-body">
              <div class="zy-chat-row-top">
                <span class="zy-chat-row-name-wrap">
                  <span class="zy-chat-row-name">${esc(ct.display_name || ct.username)}</span>
                </span>
                <span class="zy-chat-row-time">${ct.online ? 'Online' : ''}</span>
              </div>
              <div class="zy-chat-row-sub">${esc(roleLabel)} · Tap to open profile chat</div>
            </div>
          </button>
        `;
      }).join('');
    }

    if (!html) {
      let emptyMsg = 'No assigned agent or groups found for your account.';
      if (state.me && state.me.role === 'owner') {
        emptyMsg = 'No agents available yet.';
      } else if (state.me && state.me.role === 'agent') {
        if (state.filterTab === 'unread') emptyMsg = 'All caught up! No unread messages right now.';
        else if (state.filterTab === 'channels') emptyMsg = 'No Announcement Channels yet. Tap "+ Channel" to create one.';
        else if (state.filterTab === 'groups') emptyMsg = 'No Client Groups yet. Tap "+ Group" to create one.';
        else emptyMsg = 'No chats match your filter. Add clients or start a chat with Owner.';
      }
      html = `
        <div class="zy-chat-inbox-empty">
          <i class="far ${state.filterTab === 'unread' ? 'fa-circle-check' : 'fa-comments'}"></i>
          <div>${esc(emptyMsg)}</div>
        </div>
      `;
    }

    listEl.innerHTML = html;

    listEl.querySelectorAll('[data-conv-id]').forEach(btn => {
      btn.addEventListener('click', () => selectConversation(Number(btn.dataset.convId)));
    });
    listEl.querySelectorAll('[data-contact-key]').forEach(btn => {
      btn.addEventListener('click', () => openDirectWithContact(btn.dataset.contactKey));
    });
  }

  function updateThreadHeaderSubtitle() {
    const subEl = document.getElementById('zy-chat-thread-sub');
    if (!subEl) return;
    const conv = getActiveConv();
    if (!conv) return;
    const typing = getTypingText(conv.id);
    if (typing) {
      subEl.innerHTML = `<span class="zy-chat-typing-mini">${esc(typing)}</span>`;
      return;
    }
    const hideMembers = Boolean((state.me && state.me.role === 'client') || conv.hide_members);
    if (isChannelConv(conv)) {
      if (hideMembers) {
        subEl.textContent = 'Announcement Channel · Official updates from Admin';
      } else {
        const subCnt = Math.max(0, (conv.members || []).filter(m => m.role === 'client').length);
        const onlineCnt = (conv.members || []).filter(m => m.role === 'client' && m.online).length;
        const parts = ['Announcement Channel', `${subCnt} client${subCnt === 1 ? '' : 's'}`];
        if (onlineCnt > 0) parts.push(`${onlineCnt} online`);
        subEl.textContent = parts.join(' · ');
      }
    } else if (isGroupConv(conv)) {
      const parts = [];
      if (!hideMembers) {
        const onlineCnt = (conv.members || []).filter(m => m.online).length;
        parts.push(`${(conv.members || []).length} members`);
        if (onlineCnt > 0) parts.push(`${onlineCnt} online`);
      } else {
        parts.push('Group Chat');
      }
      if (conv.schedule_state && conv.schedule_state.enabled && conv.schedule_state.is_closed) {
        parts.push(`🌙 Closed · Reopens ${formatTime12h(conv.schedule_state.open_time)} PKT`);
      } else if (conv.schedule && conv.schedule.enabled) {
        parts.push(`Auto ${formatTime12h(conv.schedule.close_time)}–${formatTime12h(conv.schedule.open_time)} PKT`);
      }
      if (conv.admin_only) parts.push('Only Admin can send');
      subEl.textContent = parts.join(' · ');
    } else if (conv.peer) {
      subEl.textContent = conv.peer.online ? 'Online' : formatLastSeen(conv.peer.last_seen);
    }
  }

  function renderMessagesPane(scrollBottom) {
    const feed = document.getElementById('zy-chat-feed');
    if (!feed) return;
    const conv = getActiveConv();
    if (!conv) return;

    if (state.loadingThread && !state.messagesByConv.has(conv.id)) {
      feed.innerHTML = `
        <div class="zy-chat-skeleton-wrap">
          <div class="zy-chat-skel is-in"></div>
          <div class="zy-chat-skel is-out"></div>
          <div class="zy-chat-skel is-in"></div>
        </div>
      `;
      return;
    }

    const msgs = state.messagesByConv.get(conv.id) || [];
    const isCh = isChannelConv(conv);
    const isGrp = isGroupConv(conv);
    const isMulti = isCh || isGrp;

    if (!msgs.length) {
      feed.innerHTML = `
        <div class="zy-chat-thread-empty">
          <div class="zy-chat-thread-empty-card">
            <i class="fas ${isCh ? 'fa-bullhorn' : 'fa-lock'}"></i>
            <div class="zy-chat-empty-title">${isCh ? 'Announcement Channel' : 'Private Role-Isolated Chat'}</div>
            <div class="zy-chat-empty-desc">
              ${isCh
                ? (conv.can_manage
                    ? 'Post official broadcasts & updates here. All added clients will receive them privately and can react with emojis.'
                    : 'This is an official Announcement Channel from your Agent. Only Admin can post messages — tap any post to react.')
                : (isGrp
                    ? 'Messages in this group are private to your Agent and group members.'
                    : 'Send your first message below to start the conversation.')}
            </div>
          </div>
        </div>
      `;
      return;
    }

    let lastDay = '';
    const isGroupAdmin = Boolean(conv.can_manage);
    const isOwnerAdmin = Boolean(state.me && state.me.role === 'owner' && conv.type === 'owner_agent');
    const isAgentAdmin = Boolean(state.me && state.me.role === 'agent' && (conv.can_manage || conv.type === 'agent_client'));

    const html = msgs.map(m => {
      const dayLabel = formatDayLabel(m.created_at);
      let divider = '';
      if (dayLabel && dayLabel !== lastDay) {
        lastDay = dayLabel;
        divider = `<div class="zy-chat-day-sep"><span>${esc(dayLabel)}</span></div>`;
      }
      const isMine = state.me && m.sender_key === state.me.key;
      const canDelete = !m.deleted && (isMine || isGroupAdmin || isOwnerAdmin || isAgentAdmin);
      const isPinned = Number(conv.pinned_message_id) === Number(m.id);
      const isSelected = state.selectMode && state.selectedMsgIds.has(Number(m.id));
      const canPreviewDeleted = Boolean(m.deleted && m.can_preview_deleted);
      const isPreviewOpen = canPreviewDeleted && state.expandedDeletedIds.has(Number(m.id));
      const isReactOpen = Number(state.reactionPickerMsgId) === Number(m.id);
      const seenMeta = computeLiveAdminSeen(m, conv);

      const hidePeerClientIdentity = Boolean(isMulti && ((state.me && state.me.role === 'client') || conv.hide_members));
      const senderLabel = isMulti && !isMine
        ? (() => {
            if (m.sender_role === 'agent') {
              const badgeTxt = isCh ? 'Channel Admin' : 'Admin';
              return `<div class="zy-chat-sender" style="color:${colorForKey(m.sender_key)};">${esc(m.sender_name)} · ${badgeTxt}</div>`;
            }
            if (hidePeerClientIdentity) {
              const peerIdLabel = m.sender_chat_id ? `ID: ${m.sender_chat_id}` : (m.sender_name || 'Member');
              return `<div class="zy-chat-sender zy-chat-sender-id" style="color:${colorForKey(m.sender_key)};">${esc(peerIdLabel)}</div>`;
            }
            const idSuffix = m.sender_chat_id ? ` · ID ${m.sender_chat_id}` : '';
            return `<div class="zy-chat-sender" style="color:${colorForKey(m.sender_key)};">${esc(m.sender_name)}${esc(idSuffix)}</div>`;
          })()
        : '';

      const replyWho = (hidePeerClientIdentity && m.reply_to && m.reply_to.sender_role === 'client')
        ? (m.reply_to.sender_chat_id ? `ID: ${m.reply_to.sender_chat_id}` : (m.reply_to.sender_name || 'Member'))
        : (m.reply_to && m.reply_to.sender_name
            ? (m.reply_to.sender_chat_id && !hidePeerClientIdentity ? `${m.reply_to.sender_name} · ID ${m.reply_to.sender_chat_id}` : m.reply_to.sender_name)
            : 'Message');
      const replyBlock = m.reply_to && !m.deleted
        ? `<div class="zy-chat-quote" data-jump-msg="${m.reply_to.id}">
             <div class="zy-chat-quote-who">${esc(replyWho)}</div>
             <div class="zy-chat-quote-txt">${esc(m.reply_to.body_snippet || '')}</div>
           </div>`
        : '';

      const actionsHtml = !state.selectMode && !m.deleted && !m._optimistic
        ? `<div class="zy-chat-msg-actions ${isReactOpen ? 'is-force-show' : ''}">
             <button type="button" class="zy-chat-act-btn ${isReactOpen ? 'is-active' : ''}" data-act="react" data-mid="${m.id}" title="React"><i class="far fa-face-smile"></i></button>
             ${conv.can_send ? `<button type="button" class="zy-chat-act-btn" data-act="reply" data-mid="${m.id}" title="Reply"><i class="fas fa-reply"></i></button>` : ''}
             ${seenMeta ? `<button type="button" class="zy-chat-act-btn" data-act="seen" data-mid="${m.id}" title="Seen Info (${seenMeta.seen}/${seenMeta.total})"><i class="fas fa-eye"></i></button>` : ''}
             ${isGroupAdmin ? `<button type="button" class="zy-chat-act-btn ${isPinned ? 'is-pinned' : ''}" data-act="pin" data-mid="${m.id}" title="${isPinned ? 'Unpin' : 'Pin message'}"><i class="fas fa-thumbtack"></i></button>` : ''}
             ${canDelete ? `<button type="button" class="zy-chat-act-btn is-del" data-act="del" data-mid="${m.id}" title="Delete"><i class="fas fa-trash-can"></i></button>` : ''}
           </div>`
        : '';

      const reactPickerHtml = isReactOpen && !m.deleted && !m._optimistic
        ? `<div class="zy-chat-react-picker ${isMine ? 'is-right' : 'is-left'}" data-react-picker="${m.id}">
             ${QUICK_REACTIONS.map(em => {
               const mineActive = Array.isArray(m.reactions_summary) && m.reactions_summary.some(r => r.emoji === em && r.me);
               return `<button type="button" class="zy-chat-react-opt ${mineActive ? 'is-mine' : ''}" data-pick-react="${m.id}" data-emoji="${em}">${em}</button>`;
             }).join('')}
           </div>`
        : '';

      const reactionsSummary = !m.deleted && Array.isArray(m.reactions_summary) ? m.reactions_summary : [];
      const reactionsBarHtml = reactionsSummary.length
        ? `<div class="zy-chat-reactions ${isMine ? 'is-out' : 'is-in'}">
             ${reactionsSummary.map(r => `
               <button type="button" class="zy-chat-react-chip ${r.me ? 'is-mine' : ''}" data-chip-react="${m.id}" data-emoji="${esc(r.emoji)}" title="Tap to react">
                 <span class="zy-chat-react-em">${esc(r.emoji)}</span>
                 <span class="zy-chat-react-cnt">${Number(r.count || 1)}</span>
               </button>
             `).join('')}
           </div>`
        : '';

      const hasImage = !m.deleted && m.image && m.image.url;
      const hasCaption = Boolean(!m.deleted && m.body && String(m.body).trim());
      const imgOverlayMeta = hasImage && !hasCaption;

      const mediaHtml = hasImage
        ? `<div class="zy-chat-img-wrap ${m._optimistic ? 'is-uploading' : ''}" data-open-img="${esc(m.image.url)}" data-img-mid="${m.id}">
             <img class="zy-chat-img" src="${esc(m.image.url)}" alt="${esc(m.body || 'Photo')}" loading="lazy" decoding="async">
             ${m._optimistic ? `
               <div class="zy-chat-img-progress">
                 <div class="zy-chat-img-prog-track"><div class="zy-chat-img-prog-fill" data-upload-bar="${m.id}" style="width:${Number(m._uploadProgress || 10)}%;"></div></div>
                 <span class="zy-chat-img-prog-pct" data-upload-pct="${m.id}">${Number(m._uploadProgress || 10)}%</span>
               </div>
             ` : ''}
           </div>`
        : '';

      let textHtml = '';
      if (m.deleted) {
        if (canPreviewDeleted) {
          const prevImg = m.deleted_preview_image && m.deleted_preview_image.url ? m.deleted_preview_image : null;
          const prevBody = typeof m.deleted_preview_body === 'string' ? m.deleted_preview_body.trim() : '';
          textHtml = `
            <div class="zy-chat-del-audit">
              <div class="zy-chat-del-head">
                <span class="zy-chat-del-lbl"><i class="fas fa-ban"></i> Deleted by sender</span>
                <button type="button" class="zy-chat-del-toggle" data-toggle-del-preview="${m.id}">
                  <i class="fas ${isPreviewOpen ? 'fa-eye-slash' : 'fa-eye'}"></i>
                  <span>${isPreviewOpen ? 'Hide' : 'Preview'}</span>
                </button>
              </div>
              ${isPreviewOpen ? `
                <div class="zy-chat-del-preview-box">
                  <div class="zy-chat-del-preview-tag">Original message</div>
                  ${prevImg ? `<div class="zy-chat-img-wrap" data-open-del-img="${esc(prevImg.url)}" data-img-mid="${m.id}" style="margin-bottom:${prevBody ? '6px' : '0'};"><img class="zy-chat-img" src="${esc(prevImg.url)}" alt="Deleted photo" loading="lazy" decoding="async"></div>` : ''}
                  ${prevBody ? `<div class="zy-chat-del-preview-txt">${esc(prevBody).replace(/\n/g, '<br>')}</div>` : (!prevImg ? '<div class="zy-chat-del-preview-txt" style="opacity:.7;">(Empty message)</div>' : '')}
                </div>
              ` : ''}
            </div>`;
        } else {
          textHtml = `<div class="zy-chat-text"><i class="fas fa-ban"></i> This message was deleted</div>`;
        }
      } else if (hasCaption) {
        textHtml = `<div class="zy-chat-text">${esc(m.body).replace(/\n/g, '<br>')}</div>`;
      }

      const autoBadgeHtml = m.is_auto_schedule && !m.deleted
        ? `<div class="zy-chat-auto-tag ${m.auto_type === 'night_close' ? 'is-night' : 'is-morning'}">
             <i class="fas ${m.auto_type === 'night_close' ? 'fa-moon' : 'fa-sun'}"></i>
             <span>${m.auto_type === 'night_close' ? 'Scheduled Quiet Hours' : 'Auto Morning Opening'}</span>
           </div>`
        : '';

      const selectCheckboxHtml = state.selectMode && !m._optimistic
        ? `<label class="zy-chat-sel-chk-wrap" title="Select message">
             <input type="checkbox" class="zy-chat-sel-chk" data-sel-mid="${m.id}" ${isSelected ? 'checked' : ''}>
           </label>`
        : '';

      const seenPillHtml = seenMeta
        ? `<button type="button" class="zy-chat-seen-pill" data-open-seen="${m.id}" title="Seen by ${seenMeta.seen} of ${seenMeta.total} members — click for details">
             <i class="fas fa-eye"></i> ${seenMeta.seen}/${seenMeta.total}
           </button>`
        : '';

      return `
        ${divider}
        <div class="zy-chat-msg-row ${isMine ? 'is-out' : 'is-in'} ${state.selectMode ? 'is-selectable' : ''} ${isSelected ? 'is-selected' : ''} ${reactionsSummary.length ? 'has-reactions' : ''} ${isReactOpen ? 'has-react-open' : ''}" data-msg-id="${m.id}">
          ${selectCheckboxHtml}
          <div class="zy-chat-bubble-col ${isMine ? 'is-out' : 'is-in'}">
            ${reactPickerHtml}
            <div class="zy-chat-bubble ${isMine ? 'is-out' : 'is-in'} ${m.deleted ? 'is-deleted' : ''} ${canPreviewDeleted ? 'has-del-preview' : ''} ${hasImage ? 'has-image' : ''} ${imgOverlayMeta ? 'is-img-only' : ''} ${m.is_auto_schedule ? 'is-auto-sched' : ''}">
              ${actionsHtml}
              ${autoBadgeHtml}
              ${senderLabel}
              ${replyBlock}
              ${mediaHtml}
              ${textHtml}
              <div class="zy-chat-meta ${imgOverlayMeta ? 'is-img-overlay' : ''}">
                ${isPinned ? '<span class="zy-chat-pin-ico" title="Pinned"><i class="fas fa-thumbtack"></i></span>' : ''}
                ${seenPillHtml}
                <span class="zy-chat-ts">${esc(formatTime(m.created_at))}</span>
                ${computeTickHtml(m, conv)}
              </div>
            </div>
            ${reactionsBarHtml}
          </div>
        </div>
      `;
    }).join('');

    feed.innerHTML = html;

    // Bind selection mode toggling
    if (state.selectMode) {
      feed.querySelectorAll('.zy-chat-msg-row[data-msg-id]').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-toggle-del-preview]')) return;
          const mid = Number(row.dataset.msgId);
          if (!mid) return;
          const chk = row.querySelector('.zy-chat-sel-chk');
          if (e.target !== chk) {
            if (state.selectedMsgIds.has(mid)) state.selectedMsgIds.delete(mid);
            else state.selectedMsgIds.add(mid);
            if (chk) chk.checked = state.selectedMsgIds.has(mid);
          } else {
            if (chk.checked) state.selectedMsgIds.add(mid);
            else state.selectedMsgIds.delete(mid);
          }
          row.classList.toggle('is-selected', state.selectedMsgIds.has(mid));
          updateSelectBarUi();
        });
      });
    }

    // Bind upline deleted-message preview toggles
    feed.querySelectorAll('[data-toggle-del-preview]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mid = Number(btn.dataset.toggleDelPreview);
        if (state.expandedDeletedIds.has(mid)) state.expandedDeletedIds.delete(mid);
        else state.expandedDeletedIds.add(mid);
        const prevScroll = feed.scrollTop;
        renderMessagesPane(false);
        feed.scrollTop = prevScroll;
      });
    });

    // Bind deleted-preview photo lightbox zoom
    feed.querySelectorAll('[data-open-del-img]').forEach(wrap => {
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        const mid = Number(wrap.dataset.imgMid);
        const target = msgs.find(x => Number(x.id) === mid);
        openImageLightbox(
          wrap.dataset.openDelImg,
          target ? (target.deleted_preview_body || 'Deleted photo') : 'Deleted photo',
          target ? `${target.sender_name || ''} (Deleted)` : 'Deleted',
          target ? `${formatDayLabel(target.created_at)} · ${formatTime(target.created_at)}` : ''
        );
      });
    });

    // Bind photo lightbox zoom
    feed.querySelectorAll('[data-open-img]').forEach(wrap => {
      wrap.addEventListener('click', (e) => {
        if (state.selectMode || wrap.classList.contains('is-uploading')) return;
        e.stopPropagation();
        const mid = Number(wrap.dataset.imgMid);
        const target = msgs.find(x => Number(x.id) === mid);
        openImageLightbox(
          wrap.dataset.openImg,
          target ? (target.body || '') : '',
          target ? (target.sender_name || '') : '',
          target ? `${formatDayLabel(target.created_at)} · ${formatTime(target.created_at)}` : ''
        );
      });
    });

    // Bind quote jump
    feed.querySelectorAll('[data-jump-msg]').forEach(el => {
      el.addEventListener('click', () => {
        if (state.selectMode) return;
        jumpToMessage(Number(el.dataset.jumpMsg));
      });
    });

    // Bind Admin Seen Info pill
    feed.querySelectorAll('[data-open-seen]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMessageSeenModal(conv.id, Number(btn.dataset.openSeen));
      });
    });

    // Bind quick reaction picker buttons & existing reaction chips
    feed.querySelectorAll('[data-pick-react]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMessageReaction(conv.id, Number(btn.dataset.pickReact), btn.dataset.emoji);
      });
    });
    feed.querySelectorAll('[data-chip-react]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.selectMode) return;
        toggleMessageReaction(conv.id, Number(btn.dataset.chipReact), btn.dataset.emoji);
      });
    });

    // Bind actions
    feed.querySelectorAll('.zy-chat-act-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mid = Number(btn.dataset.mid);
        const act = btn.dataset.act;
        const target = msgs.find(x => Number(x.id) === mid);
        if (act === 'react') {
          state.reactionPickerMsgId = Number(state.reactionPickerMsgId) === mid ? null : mid;
          const prevScroll = feed.scrollTop;
          renderMessagesPane(false);
          feed.scrollTop = prevScroll;
        } else if (act === 'seen') {
          openMessageSeenModal(conv.id, mid);
        } else if (act === 'reply' && target) {
          const replyBody = target.image
            ? (target.body ? `📷 ${target.body}` : '📷 Photo')
            : target.body;
          state.replyTo = { id: target.id, sender_name: target.sender_name, body: replyBody };
          renderReplyStrip();
          const inp = document.getElementById('zy-chat-input');
          if (inp) inp.focus();
        } else if (act === 'pin') {
          const isAlreadyPinned = Number(conv.pinned_message_id) === mid;
          pinMessage(conv.id, isAlreadyPinned ? null : mid);
        } else if (act === 'del') {
          deleteMessage(conv.id, mid);
        }
      });
    });

    if (scrollBottom) {
      requestAnimationFrame(() => {
        feed.scrollTop = feed.scrollHeight;
      });
    }
  }

  function jumpToMessage(msgId) {
    const row = document.querySelector(`.zy-chat-msg-row[data-msg-id="${msgId}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('is-flash');
    setTimeout(() => row.classList.remove('is-flash'), 1400);
  }

  function renderReplyStrip() {
    const el = document.getElementById('zy-chat-reply-strip');
    if (!el) return;
    if (!state.replyTo) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'flex';
    el.innerHTML = `
      <div class="zy-chat-reply-bar">
        <div class="zy-chat-reply-who">Replying to ${esc(state.replyTo.sender_name)}</div>
        <div class="zy-chat-reply-txt">${esc(String(state.replyTo.body || '').slice(0, 120))}</div>
      </div>
      <button type="button" class="zy-chat-icon-btn" id="zy-chat-reply-cancel" aria-label="Cancel reply"><i class="fas fa-times"></i></button>
    `;
    const cancel = document.getElementById('zy-chat-reply-cancel');
    if (cancel) cancel.addEventListener('click', () => { state.replyTo = null; renderReplyStrip(); });
  }

  function renderEmojiPopover() {
    const el = document.getElementById('zy-chat-emoji-pop');
    if (!el) return;
    if (!state.emojiOpen) {
      el.style.display = 'none';
      return;
    }
    const grp = EMOJI_GROUPS[state.emojiTab] || EMOJI_GROUPS[0];
    el.style.display = 'flex';
    el.innerHTML = `
      <div class="zy-chat-emoji-tabs">
        ${EMOJI_GROUPS.map((g, i) => `<button type="button" class="zy-chat-emoji-tab ${i === state.emojiTab ? 'is-active' : ''}" data-etab="${i}">${g.icon} ${esc(g.label)}</button>`).join('')}
      </div>
      <div class="zy-chat-emoji-grid">
        ${grp.items.map(em => `<button type="button" class="zy-chat-emoji-btn" data-em="${em}">${em}</button>`).join('')}
      </div>
    `;
    el.querySelectorAll('[data-etab]').forEach(b => {
      b.addEventListener('click', () => { state.emojiTab = Number(b.dataset.etab); renderEmojiPopover(); });
    });
    el.querySelectorAll('[data-em]').forEach(b => {
      b.addEventListener('click', () => {
        const inp = document.getElementById('zy-chat-input');
        if (!inp) return;
        const em = b.dataset.em;
        const start = inp.selectionStart || inp.value.length;
        const end = inp.selectionEnd || inp.value.length;
        inp.value = inp.value.slice(0, start) + em + inp.value.slice(end);
        inp.focus();
        inp.setSelectionRange(start + em.length, start + em.length);
      });
    });
  }

  function renderGroupDrawerHtml(conv) {
    if (!state.drawerOpen || !conv || !isGroupOrChannel(conv)) return '';
    const isAdmin = Boolean(conv.can_manage);
    const isCh = isChannelConv(conv);
    const hideMembers = Boolean((state.me && state.me.role === 'client') || conv.hide_members);
    if (hideMembers && !isAdmin) return '';
    const memberKeys = new Set(conv.participants || []);
    const addableClients = isAdmin
      ? state.contacts
          .filter(c => c.role === 'client' && !memberKeys.has(c.key))
          .sort((a, b) => String(a.display_name || a.username || '').localeCompare(String(b.display_name || b.username || ''), undefined, { sensitivity: 'base' }))
      : [];
    const entityLabel = isCh ? 'Announcement Channel' : 'Group';
    const avaUrl = conv.avatar_url || '';

    return `
      <aside class="zy-chat-drawer" aria-label="${esc(entityLabel)} Settings">
        <div class="zy-chat-drawer-head">
          <span>${isAdmin ? `${entityLabel} Settings` : `${entityLabel} Info`}</span>
          <button type="button" class="zy-chat-icon-btn" id="zy-gd-close" aria-label="Close"><i class="fas fa-times"></i></button>
        </div>
        <div class="zy-chat-drawer-body">
          ${isAdmin ? `
            <div class="zy-gd-section">
              <div class="zy-gd-label">${isCh ? 'Channel Photo' : 'Group Photo'}</div>
              <div class="zy-gd-ava-row">
                <div class="zy-chat-ava is-gd-preview ${isCh ? 'is-channel' : 'is-group'} ${avaUrl ? 'has-img' : ''}" style="--ava-bg:${isCh ? '#b45309' : '#0f766e'};">
                  ${renderAvatarInner(avaUrl, conv.title, !isCh, false, isCh)}
                </div>
                <div class="zy-gd-ava-actions">
                  <input type="file" id="zy-gd-ava-input" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none;">
                  <button type="button" class="zy-gd-btn-ava" id="zy-gd-ava-pick" ${state.uploadingGroupAvatar ? 'disabled' : ''}>
                    <i class="fas ${state.uploadingGroupAvatar ? 'fa-spinner fa-spin' : 'fa-camera'}"></i>
                    <span>${state.uploadingGroupAvatar ? 'Saving...' : (avaUrl ? 'Change Photo' : 'Upload Photo')}</span>
                  </button>
                  ${avaUrl ? `
                    <button type="button" class="zy-gd-btn-ava-rm" id="zy-gd-ava-rm" ${state.uploadingGroupAvatar ? 'disabled' : ''}>
                      <i class="fas fa-trash-can"></i> Remove
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>
            <div class="zy-gd-section">
              <label class="zy-gd-label">${isCh ? 'Channel Name' : 'Group Name'}</label>
              <input type="text" id="zy-gd-title" class="zy-gd-input" maxlength="80" value="${esc(conv.title)}">
              <label class="zy-gd-label" style="margin-top:10px;">Description</label>
              <textarea id="zy-gd-desc" class="zy-gd-input" rows="2" maxlength="240" placeholder="Optional description">${esc(conv.description || '')}</textarea>
              <button type="button" class="zy-gd-btn-primary" id="zy-gd-save-meta">Save ${isCh ? 'Channel' : 'Group'} Info</button>
            </div>
            ${isCh ? `
              <div class="zy-gd-section zy-gd-ch-notice">
                <div class="zy-gd-ch-notice-head"><i class="fas fa-bullhorn"></i> Official Announcement Channel</div>
                <div class="zy-gd-toggle-sub">Only you (Admin) can send messages here. Clients can read all posts and react with emojis. Member count &amp; subscriber list stay completely hidden from clients.</div>
              </div>
            ` : `
              <div class="zy-gd-section">
                <label class="zy-gd-toggle-row">
                  <div>
                    <div class="zy-gd-toggle-title">Only Admin Can Send</div>
                    <div class="zy-gd-toggle-sub">ON = Admin only · OFF = Members chat via anonymous ID</div>
                  </div>
                  <input type="checkbox" id="zy-gd-admin-only" ${conv.admin_only ? 'checked' : ''}>
                </label>
              </div>
              <div class="zy-gd-section zy-gd-sched-box">
                <label class="zy-gd-toggle-row" style="margin-bottom:8px;">
                  <div>
                    <div class="zy-gd-toggle-title"><i class="fas fa-moon" style="color:#6366f1;margin-right:4px;"></i> Auto Night Close &amp; Morning Open</div>
                    <div class="zy-gd-toggle-sub">Daily quiet hours (PKT) with countdown &amp; auto messages</div>
                  </div>
                  <input type="checkbox" id="zy-gd-sched-enabled" ${conv.schedule && conv.schedule.enabled ? 'checked' : ''}>
                </label>
                <div id="zy-gd-sched-fields" style="display:${conv.schedule && conv.schedule.enabled ? 'block' : 'none'};margin-top:8px;">
                  <div class="zy-gd-time-grid">
                    <div>
                      <label class="zy-gd-label" for="zy-gd-sched-close">Close Time (PKT)</label>
                      <input type="time" id="zy-gd-sched-close" class="zy-gd-input" value="${esc((conv.schedule && conv.schedule.close_time) || '23:00')}">
                    </div>
                    <div>
                      <label class="zy-gd-label" for="zy-gd-sched-open">Open Time (PKT)</label>
                      <input type="time" id="zy-gd-sched-open" class="zy-gd-input" value="${esc((conv.schedule && conv.schedule.open_time) || '09:00')}">
                    </div>
                  </div>
                  <label class="zy-gd-label" for="zy-gd-sched-close-msg" style="margin-top:10px;">Night Close Message (Auto Sent)</label>
                  <textarea id="zy-gd-sched-close-msg" class="zy-gd-input" rows="3" maxlength="500" placeholder="Good Night message...">${esc((conv.schedule && conv.schedule.close_message) || DEFAULT_CLOSE_MSG)}</textarea>
                  <label class="zy-gd-label" for="zy-gd-sched-open-msg" style="margin-top:10px;">Morning Open Message (Auto Sent)</label>
                  <textarea id="zy-gd-sched-open-msg" class="zy-gd-input" rows="3" maxlength="500" placeholder="Assalam-o-Alaikum morning message...">${esc((conv.schedule && conv.schedule.open_message) || DEFAULT_OPEN_MSG)}</textarea>
                </div>
                <button type="button" class="zy-gd-btn-primary" id="zy-gd-save-sched" style="margin-top:10px;">
                  <i class="fas fa-clock"></i> Save Schedule
                </button>
              </div>
            `}
            <div class="zy-gd-section">
              <div class="zy-gd-label">Add My Clients</div>
              ${addableClients.length ? `
                <div class="zy-gd-add-row">
                  <select id="zy-gd-add-select" class="zy-gd-input">
                    <option value="">Select client to add...</option>
                    ${addableClients.map(c => `<option value="${c.id}">${esc(c.display_name || c.username)}${c.chat_id ? ` (ID: ${esc(c.chat_id)})` : ''}</option>`).join('')}
                  </select>
                  <button type="button" class="zy-gd-btn-add" id="zy-gd-add-btn">Add</button>
                </div>
                ${addableClients.length > 1 ? `
                  <button type="button" class="zy-gd-btn-add-all" id="zy-gd-add-all-btn">
                    <i class="fas fa-user-plus"></i> Add All Remaining (${addableClients.length})
                  </button>
                ` : ''}
                <div class="zy-gd-muted" style="margin-top:6px;">Newly added clients will only see new messages sent after they are added (previous chat history stays hidden).</div>
              ` : `<div class="zy-gd-muted">All of your assigned clients are already in this ${isCh ? 'channel' : 'group'}.</div>`}
            </div>
          ` : `
            <div class="zy-gd-section">
              <div class="zy-gd-ro-title">${esc(conv.title)}</div>
              ${conv.description ? `<div class="zy-gd-muted">${esc(conv.description)}</div>` : ''}
            </div>
          `}

          <div class="zy-gd-section">
            <div class="zy-gd-label">${isCh ? 'Subscribers & Admin' : 'Members'} (${(conv.members || []).length})</div>
            <div class="zy-gd-members">
              ${(conv.members || []).map(m => `
                <div class="zy-gd-member-row">
                  <div class="zy-chat-ava is-sm ${m.avatar_url ? 'has-img' : ''}" style="--ava-bg:${colorForKey(m.key)};">
                    ${renderAvatarInner(m.avatar_url || '', m.display_name || m.username, false, Boolean(m.online), false)}
                  </div>
                  <div class="zy-gd-member-info">
                    <div class="zy-gd-member-name">${esc(m.display_name || m.username)}${m.role === 'client' && m.chat_id ? ` <span style="font-size:11px;font-weight:700;color:#2563eb;font-family:monospace;">(ID: ${esc(m.chat_id)})</span>` : ''}</div>
                    <div class="zy-gd-member-sub">${m.role === 'agent' ? (isCh ? 'Channel Admin (Agent)' : 'Group Admin (Agent)') : (m.online ? 'Client · Online' : 'Client')}</div>
                  </div>
                  ${isAdmin && m.role === 'client'
                    ? `<button type="button" class="zy-gd-remove-btn" data-remove-cid="${m.id}" title="Remove client"><i class="fas fa-user-minus"></i></button>`
                    : ''}
                </div>
              `).join('')}
            </div>
          </div>

          ${isAdmin ? `
            <div class="zy-gd-section zy-gd-danger">
              ${state.confirmDeleteGroup ? `
                <div class="zy-gd-confirm-box">
                  <div class="zy-gd-confirm-txt">Delete this ${isCh ? 'Announcement Channel' : 'group'} and all its messages permanently?</div>
                  <div class="zy-gd-confirm-btns">
                    <button type="button" class="zy-gd-btn-danger" id="zy-gd-del-confirm">Yes, Delete</button>
                    <button type="button" class="zy-gd-btn-cancel" id="zy-gd-del-cancel">Cancel</button>
                  </div>
                </div>
              ` : `<button type="button" class="zy-gd-btn-danger-outline" id="zy-gd-del-btn"><i class="fas fa-trash-can"></i> Delete ${isCh ? 'Announcement Channel' : 'Group'}</button>`}
            </div>
          ` : ''}
        </div>
      </aside>
    `;
  }

  function renderCreateGroupModalHtml() {
    if (!state.createModalOpen || !state.me || state.me.role !== 'agent') return '';
    const isCh = state.createModalMode === 'channel';
    const myClients = state.contacts
      .filter(c => c.role === 'client')
      .sort((a, b) => String(a.display_name || a.username || '').localeCompare(String(b.display_name || b.username || ''), undefined, { sensitivity: 'base' }));
    const avaPreview = state.createModalAvatar || '';

    return `
      <div class="zy-chat-modal-backdrop" id="zy-cg-backdrop">
        <div class="zy-chat-modal" role="dialog" aria-modal="true" aria-label="${isCh ? 'Create Announcement Channel' : 'Create Client Group'}">
          <div class="zy-chat-modal-head">
            <span><i class="fas ${isCh ? 'fa-bullhorn' : 'fa-users'}" style="margin-right:6px;"></i>${isCh ? 'New Announcement Channel' : 'New Client Group'}</span>
            <button type="button" class="zy-chat-icon-btn" id="zy-cg-close" aria-label="Close"><i class="fas fa-times"></i></button>
          </div>
          <div class="zy-chat-modal-body">
            <div class="zy-cg-mode-switch" role="tablist">
              <button type="button" class="zy-cg-mode-btn ${!isCh ? 'is-active' : ''}" data-cg-mode="group">
                <i class="fas fa-users"></i> Client Group
              </button>
              <button type="button" class="zy-cg-mode-btn ${isCh ? 'is-active is-ch' : ''}" data-cg-mode="channel">
                <i class="fas fa-bullhorn"></i> Announcement Channel
              </button>
            </div>

            <div class="zy-gd-ava-row" style="margin-top:12px;">
              <div class="zy-chat-ava is-gd-preview ${isCh ? 'is-channel' : 'is-group'} ${avaPreview ? 'has-img' : ''}" style="--ava-bg:${isCh ? '#b45309' : '#0f766e'};">
                ${renderAvatarInner(avaPreview, isCh ? 'CH' : 'GR', !isCh, false, isCh)}
              </div>
              <div class="zy-gd-ava-actions">
                <input type="file" id="zy-cg-ava-input" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none;">
                <button type="button" class="zy-gd-btn-ava" id="zy-cg-ava-pick">
                  <i class="fas fa-camera"></i>
                  <span>${avaPreview ? 'Change Photo' : `Add ${isCh ? 'Channel' : 'Group'} Photo`}</span>
                </button>
                ${avaPreview ? `<button type="button" class="zy-gd-btn-ava-rm" id="zy-cg-ava-rm"><i class="fas fa-times"></i> Remove</button>` : ''}
              </div>
            </div>

            <label class="zy-gd-label" style="margin-top:12px;">${isCh ? 'Announcement Channel Name' : 'Group Name'}</label>
            <input type="text" id="zy-cg-title" class="zy-gd-input" maxlength="80" placeholder="${isCh ? 'e.g. Official Rates & Announcements' : 'e.g. VIP Clients Chat'}">
            <label class="zy-gd-label" style="margin-top:10px;">Description (Optional)</label>
            <input type="text" id="zy-cg-desc" class="zy-gd-input" maxlength="240" placeholder="${isCh ? 'Broadcast-only announcements for my clients' : 'Updates and anonymous ID chat for my clients'}">

            ${isCh ? `
              <div class="zy-gd-ch-notice" style="margin-top:12px;">
                <div class="zy-gd-ch-notice-head"><i class="fas fa-bullhorn"></i> WhatsApp-Style Announcement Channel</div>
                <div class="zy-gd-toggle-sub">Only you (Admin) can send messages. Members &amp; counts are strictly hidden from clients. Clients can react with emojis on every post.</div>
              </div>
            ` : `
              <label class="zy-gd-toggle-row" style="margin-top:12px;">
                <div>
                  <div class="zy-gd-toggle-title">Only Admin Can Send</div>
                  <div class="zy-gd-toggle-sub">OFF = Clients chat via anonymous ID · ON = Admin only (toggle anytime)</div>
                </div>
                <input type="checkbox" id="zy-cg-admin-only">
              </label>
            `}

            <div class="zy-cg-clients-head" style="margin-top:14px;">
              <div class="zy-gd-label" style="margin:0;">Select Your Clients (${myClients.length} available)</div>
              ${myClients.length ? `<button type="button" class="zy-cg-selall-btn" id="zy-cg-sel-all">Select All</button>` : ''}
            </div>
            ${myClients.length ? `
              <input type="text" id="zy-cg-client-search" class="zy-gd-input" placeholder="Search clients by name or ID..." value="${esc(state.createModalSearch)}" style="margin:6px 0 8px;">
              <div class="zy-cg-checklist" id="zy-cg-checklist">
                ${myClients.map(c => `
                  <label class="zy-cg-check-item" data-cg-hay="${esc(`${c.display_name || ''} ${c.username || ''} ${c.chat_id || ''}`.toLowerCase())}">
                    <input type="checkbox" class="zy-cg-member-cb" value="${c.id}">
                    <span class="zy-cg-check-name">${esc(c.display_name || c.username)}${c.chat_id ? ` <small style="color:#2563eb;font-family:monospace;">(ID: ${esc(c.chat_id)})</small>` : ''}</span>
                    <span class="zy-cg-check-sub">${c.online ? 'Online' : 'Offline'}</span>
                  </label>
                `).join('')}
              </div>
            ` : `<div class="zy-gd-muted" style="padding:12px 0;">You do not have any assigned clients yet. Add clients first to create a ${isCh ? 'channel' : 'group'}.</div>`}
          </div>
          <div class="zy-chat-modal-foot">
            <button type="button" class="zy-gd-btn-cancel" id="zy-cg-cancel">Cancel</button>
            <button type="button" class="zy-gd-btn-primary" id="zy-cg-submit" ${!myClients.length ? 'disabled' : ''}>
              ${isCh ? 'Create Announcement Channel' : 'Create Group'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderSeenModalHtml() {
    const sm = state.seenModal;
    if (!sm) return '';
    const d = sm.data;
    return `
      <div class="zy-chat-modal-backdrop" id="zy-seen-backdrop">
        <div class="zy-chat-modal zy-chat-seen-modal" role="dialog" aria-modal="true" aria-label="Message Seen Info">
          <div class="zy-chat-modal-head">
            <span><i class="fas fa-eye" style="margin-right:6px;color:#0ea5e9;"></i>Message Seen Info</span>
            <button type="button" class="zy-chat-icon-btn" id="zy-seen-close" aria-label="Close"><i class="fas fa-times"></i></button>
          </div>
          <div class="zy-chat-modal-body">
            ${sm.loading ? `
              <div class="zy-seen-loading"><i class="fas fa-spinner fa-spin"></i> Loading member read status...</div>
            ` : sm.error ? `
              <div class="zy-seen-error"><i class="fas fa-circle-exclamation"></i> ${esc(sm.error)}</div>
            ` : d ? `
              <div class="zy-seen-summary-grid">
                <div class="zy-seen-stat is-total">
                  <div class="zy-seen-stat-val">${Number(d.total_members || 0)}</div>
                  <div class="zy-seen-stat-lbl">Total Clients</div>
                </div>
                <div class="zy-seen-stat is-seen">
                  <div class="zy-seen-stat-val">${Number(d.seen_count || 0)}</div>
                  <div class="zy-seen-stat-lbl">Seen</div>
                </div>
                <div class="zy-seen-stat is-unseen">
                  <div class="zy-seen-stat-val">${Number(d.unseen_count || 0)}</div>
                  <div class="zy-seen-stat-lbl">Not Seen Yet</div>
                </div>
              </div>

              <div class="zy-seen-sec">
                <div class="zy-seen-sec-head is-seen">
                  <i class="fas fa-check-double"></i> Seen By (${(d.seen || []).length})
                </div>
                ${(d.seen && d.seen.length) ? `
                  <div class="zy-seen-list">
                    ${d.seen.map(u => `
                      <div class="zy-seen-row">
                        <div class="zy-chat-ava is-sm ${u.avatar_url ? 'has-img' : ''}" style="--ava-bg:${colorForKey(u.key)};">
                          ${renderAvatarInner(u.avatar_url || '', u.display_name || u.username, false, Boolean(u.online), false)}
                        </div>
                        <div class="zy-seen-info">
                          <div class="zy-seen-name">${esc(u.display_name || u.username)}${u.chat_id ? ` <span class="zy-seen-id">ID: ${esc(u.chat_id)}</span>` : ''}</div>
                          <div class="zy-seen-sub">${u.seen_at ? `Seen ${esc(formatInboxTime(u.seen_at))} · ${esc(formatTime(u.seen_at))}` : 'Seen'}</div>
                        </div>
                        <span class="zy-seen-tick is-ok"><i class="fas fa-check-double"></i></span>
                      </div>
                    `).join('')}
                  </div>
                ` : `<div class="zy-gd-muted" style="padding:8px 2px;">No members have seen this message yet.</div>`}
              </div>

              <div class="zy-seen-sec">
                <div class="zy-seen-sec-head is-unseen">
                  <i class="far fa-clock"></i> Not Seen Yet (${(d.unseen || []).length})
                </div>
                ${(d.unseen && d.unseen.length) ? `
                  <div class="zy-seen-list">
                    ${d.unseen.map(u => `
                      <div class="zy-seen-row">
                        <div class="zy-chat-ava is-sm ${u.avatar_url ? 'has-img' : ''}" style="--ava-bg:${colorForKey(u.key)};">
                          ${renderAvatarInner(u.avatar_url || '', u.display_name || u.username, false, Boolean(u.online), false)}
                        </div>
                        <div class="zy-seen-info">
                          <div class="zy-seen-name">${esc(u.display_name || u.username)}${u.chat_id ? ` <span class="zy-seen-id">ID: ${esc(u.chat_id)}</span>` : ''}</div>
                          <div class="zy-seen-sub">${u.online ? 'Online · Unread' : 'Offline · Unread'}</div>
                        </div>
                        <span class="zy-seen-tick is-wait"><i class="far fa-clock"></i></span>
                      </div>
                    `).join('')}
                  </div>
                ` : `<div class="zy-gd-muted" style="padding:8px 2px;">All members have seen this message!</div>`}
              </div>

              ${Array.isArray(d.reactions_detail) && d.reactions_detail.length ? `
                <div class="zy-seen-sec">
                  <div class="zy-seen-sec-head">
                    <i class="far fa-face-smile"></i> Reactions (${d.reactions_detail.length})
                  </div>
                  <div class="zy-seen-list">
                    ${d.reactions_detail.map(r => `
                      <div class="zy-seen-row">
                        <div class="zy-seen-info">
                          <div class="zy-seen-name">${esc(r.display_name || r.username)}${r.chat_id ? ` <span class="zy-seen-id">ID: ${esc(r.chat_id)}</span>` : ''}</div>
                          <div class="zy-seen-sub">${r.role === 'agent' ? 'Admin' : 'Client'}</div>
                        </div>
                        <span class="zy-seen-react-em">${esc(r.emoji)}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            ` : ''}
          </div>
          <div class="zy-chat-modal-foot">
            <button type="button" class="zy-gd-btn-primary" id="zy-seen-ok">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderSeenModalOverlay() {
    let host = document.getElementById('zy-seen-modal-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'zy-seen-modal-host';
      document.body.appendChild(host);
    }
    if (!state.seenModal) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = renderSeenModalHtml();
    const closeBtn = document.getElementById('zy-seen-close');
    const okBtn = document.getElementById('zy-seen-ok');
    const bd = document.getElementById('zy-seen-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', closeMessageSeenModal);
    if (okBtn) okBtn.addEventListener('click', closeMessageSeenModal);
    if (bd) {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeMessageSeenModal();
      });
    }
  }

  function renderThreadArea(scrollBottom = false) {
    const rightEl = document.getElementById('zy-chat-right');
    if (!rightEl) return;
    const conv = getActiveConv();

    if (!conv) {
      const roleHint = state.me && state.me.role === 'owner'
        ? 'Select any Agent from the left to chat directly 1-to-1.'
        : (state.me && state.me.role === 'agent'
            ? 'Chat privately with the Owner, message your Clients 1-to-1, or create a Client Group or Announcement Channel.'
            : 'Select your Agent, a joined Group, or an Announcement Channel from the left.');
      rightEl.innerHTML = `
        <div class="zy-chat-welcome">
          <div class="zy-chat-welcome-ico"><i class="fab fa-whatsapp"></i></div>
          <div class="zy-chat-welcome-title">Live Chat Workspace</div>
          <div class="zy-chat-welcome-sub">${esc(roleHint)}</div>
        </div>
      `;
      return;
    }

    const isCh = isChannelConv(conv);
    const isGrp = isGroupConv(conv);
    const isMulti = isCh || isGrp;
    const hideGroupDrawer = Boolean(isMulti && !conv.can_manage && ((state.me && state.me.role === 'client') || conv.hide_members));
    const isOnline = !isMulti && Boolean(conv.peer && conv.peer.online);
    const pinned = conv.pinned_message;
    const headAvaUrl = isMulti ? (conv.avatar_url || '') : (conv.peer ? (conv.peer.avatar_url || '') : '');
    const headAvaBg = isCh ? '#b45309' : (isGrp ? '#0f766e' : colorForKey(conv.peer ? conv.peer.key : conv.id));
    state.moreMenuOpen = false;

    const lockedBarText = (() => {
      if (isCh || conv.lock_reason === 'announcement_channel') {
        return 'Announcement Channel · Only Admin can post messages here. Tap any message to react with emojis.';
      }
      if (conv.lock_reason === 'scheduled_closed') {
        return `Messaging is paused for quiet hours · Auto-opens in <strong data-zy-sched-countdown>${esc(formatCountdownHMS(getRemainingScheduleSeconds(conv)))}</strong> (${esc(formatTime12h(conv.schedule_state && conv.schedule_state.open_time))} PKT)`;
      }
      return 'Only your Agent (Group Admin) can send messages in this group. Tap any message to react.';
    })();

    rightEl.innerHTML = `
      <div class="zy-chat-thread-col">
        <div class="zy-chat-thread-head">
          <button type="button" class="zy-chat-back-btn zy-chat-back-profile" id="zy-chat-back" title="Back to Chats" aria-label="Back to chats">
            <i class="fas fa-arrow-left"></i>
            <span class="zy-chat-back-txt">Chats</span>
          </button>
          <div class="zy-chat-ava is-profile-ava ${isCh ? 'is-channel' : (isGrp ? 'is-group' : '')} ${headAvaUrl ? 'has-img is-clickable' : ''}" id="zy-chat-head-ava" style="--ava-bg:${headAvaBg};" ${headAvaUrl ? 'role="button" tabindex="0" title="View Photo"' : ''}>
            ${renderAvatarInner(headAvaUrl, conv.title, isGrp, isOnline, isCh)}
          </div>
          <div class="zy-chat-thread-meta" id="zy-chat-head-meta" ${(isMulti && !hideGroupDrawer) ? 'role="button" tabindex="0"' : ''}>
            <div class="zy-chat-thread-name-row">
              <span class="zy-chat-thread-name">${esc(conv.title)}</span>
              ${isCh ? `<span class="zy-chat-ch-badge"><i class="fas fa-bullhorn"></i> Announcement Channel</span>` : ''}
            </div>
            <div class="zy-chat-thread-sub" id="zy-chat-thread-sub"></div>
          </div>
          <div class="zy-chat-thread-actions zy-chat-thread-actions-inline">
            <button type="button" class="zy-chat-head-btn ${state.selectMode ? 'is-active' : ''}" id="zy-chat-select-btn" title="${state.selectMode ? 'Exit Selection' : 'Select Messages to Delete'}">
              <i class="fas ${state.selectMode ? 'fa-times' : 'fa-check-double'}"></i>
              <span>${state.selectMode ? 'Cancel' : 'Select'}</span>
            </button>
            <button type="button" class="zy-chat-head-btn is-danger" id="zy-chat-clear-btn" title="Clear Chat History">
              <i class="fas fa-eraser"></i>
              <span>Clear</span>
            </button>
            ${(isMulti && !hideGroupDrawer) ? `
              <button type="button" class="zy-chat-head-btn" id="zy-chat-group-info-btn" title="${conv.can_manage ? (isCh ? 'Channel Settings' : 'Group Admin Settings') : 'Info'}">
                <i class="fas ${conv.can_manage ? 'fa-sliders' : 'fa-circle-info'}"></i>
                <span>${conv.can_manage ? 'Manage' : 'Info'}</span>
              </button>
            ` : ''}
            <button type="button" class="zy-chat-head-btn zy-chat-exit-btn" id="zy-chat-thread-exit-panel" title="Back to Panel Dashboard">
              <i class="fas fa-house"></i>
              <span>Panel</span>
            </button>
          </div>
          <div class="zy-chat-more-wrap">
            <button type="button" class="zy-chat-more-btn" id="zy-chat-more-btn" aria-label="Chat options" title="Options">
              <i class="fas fa-ellipsis-vertical"></i>
            </button>
            <div class="zy-chat-more-menu" id="zy-chat-more-menu" style="display:none;">
              <button type="button" class="zy-chat-more-item ${state.selectMode ? 'is-active' : ''}" id="zy-chat-mob-select">
                <i class="fas ${state.selectMode ? 'fa-times' : 'fa-check-double'}"></i>
                <span>${state.selectMode ? 'Cancel Select' : 'Select Messages'}</span>
              </button>
              <button type="button" class="zy-chat-more-item is-danger" id="zy-chat-mob-clear">
                <i class="fas fa-eraser"></i>
                <span>Clear Chat</span>
              </button>
              ${(isMulti && !hideGroupDrawer) ? `
                <button type="button" class="zy-chat-more-item" id="zy-chat-mob-group-info">
                  <i class="fas ${conv.can_manage ? 'fa-sliders' : 'fa-circle-info'}"></i>
                  <span>${conv.can_manage ? (isCh ? 'Channel Settings' : 'Group Manage') : 'Info'}</span>
                </button>
              ` : ''}
              <button type="button" class="zy-chat-more-item" id="zy-chat-mob-exit-panel">
                <i class="fas fa-house"></i>
                <span>Back to Panel</span>
              </button>
            </div>
          </div>
        </div>

        ${pinned ? `
          <div class="zy-chat-pinned-bar" id="zy-chat-pinned-bar">
            <div class="zy-chat-pinned-left" data-jump-pin="${pinned.id}">
              <i class="fas fa-thumbtack"></i>
              <div class="zy-chat-pinned-content">
                <span class="zy-chat-pinned-who">Pinned · ${esc(pinned.sender_name)}</span>
                <span class="zy-chat-pinned-txt">${esc(pinned.body)}</span>
              </div>
            </div>
            ${conv.can_manage ? `<button type="button" class="zy-chat-icon-btn" id="zy-chat-unpin-btn" title="Unpin message"><i class="fas fa-times"></i></button>` : ''}
          </div>
        ` : ''}

        <div class="zy-chat-feed" id="zy-chat-feed"></div>
        <div class="zy-chat-drop-overlay" id="zy-chat-drop-overlay" style="display:none;">
          <div class="zy-chat-drop-card">
            <i class="far fa-image"></i>
            <span>Drop photo to send</span>
          </div>
        </div>

        ${(isGrp && conv.schedule_state && conv.schedule_state.enabled && conv.schedule_state.is_closed) ? `
          <div class="zy-chat-night-banner" id="zy-chat-night-banner">
            <div class="zy-chat-night-ico"><i class="fas fa-moon"></i></div>
            <div class="zy-chat-night-body">
              <div class="zy-chat-night-head">
                <span class="zy-chat-night-title">Group Closed · Quiet Hours</span>
                <span class="zy-chat-night-timer" title="Time remaining until auto-open">
                  <i class="far fa-clock"></i>
                  <span data-zy-sched-countdown>${esc(formatCountdownHMS(getRemainingScheduleSeconds(conv)))}</span>
                </span>
              </div>
              <div class="zy-chat-night-msg">${esc((conv.schedule_state && conv.schedule_state.close_message) || DEFAULT_CLOSE_MSG)}</div>
              <div class="zy-chat-night-sub">
                Reopens automatically at <strong>${esc(formatTime12h(conv.schedule_state.open_time))} PKT</strong>
                ${conv.can_manage ? ' · Clients are muted (Admin can still post or edit schedule in Manage)' : ''}
              </div>
            </div>
          </div>
        ` : ''}

        ${state.selectMode ? `
          <div class="zy-chat-select-bar" id="zy-chat-select-bar">
            <span class="zy-chat-sel-count" id="zy-chat-sel-count">${state.selectedMsgIds.size} selected</span>
            <div class="zy-chat-sel-actions">
              <button type="button" class="zy-chat-sel-btn" id="zy-chat-sel-all">Select All</button>
              <button type="button" class="zy-chat-sel-btn is-danger" id="zy-chat-sel-del" ${state.selectedMsgIds.size === 0 ? 'disabled' : ''}>
                <i class="fas fa-trash-can"></i> Delete Selected
              </button>
              <button type="button" class="zy-chat-sel-btn" id="zy-chat-sel-cancel">Cancel</button>
            </div>
          </div>
        ` : ''}

        ${conv.can_send ? `
          <div class="zy-chat-composer-wrap">
            <div class="zy-chat-emoji-pop" id="zy-chat-emoji-pop" style="display:none;"></div>
            <div class="zy-chat-reply-strip" id="zy-chat-reply-strip" style="display:none;"></div>
            <div class="zy-chat-media-strip" id="zy-chat-media-strip" style="display:none;"></div>
            <div class="zy-chat-composer">
              <button type="button" class="zy-chat-icon-btn" id="zy-chat-emoji-toggle" title="Emoji" aria-label="Emoji"><i class="far fa-face-smile"></i></button>
              <button type="button" class="zy-chat-icon-btn" id="zy-chat-img-btn" title="Send Photo" aria-label="Send Photo"><i class="far fa-image"></i></button>
              <input type="file" id="zy-chat-file-input" accept="image/jpeg,image/png,image/webp,image/gif" multiple style="display:none;">
              <textarea id="zy-chat-input" class="zy-chat-input" rows="1" maxlength="2000" placeholder="${isCh ? 'Post an announcement to all clients...' : 'Type a message...'}"></textarea>
              <button type="button" class="zy-chat-send-btn" id="zy-chat-send" title="Send" aria-label="Send"><i class="fas fa-paper-plane"></i></button>
            </div>
          </div>
        ` : `
          <div class="zy-chat-locked-bar ${isCh ? 'is-channel-lock' : (conv.lock_reason === 'scheduled_closed' ? 'is-night-lock' : '')}">
            <i class="fas ${isCh ? 'fa-bullhorn' : (conv.lock_reason === 'scheduled_closed' ? 'fa-moon' : 'fa-lock')}"></i>
            <span>${lockedBarText}</span>
          </div>
        `}
      </div>
      ${renderGroupDrawerHtml(conv)}
    `;

    updateThreadHeaderSubtitle();
    renderMessagesPane(scrollBottom);
    renderReplyStrip();
    renderMediaStrip();
    renderEmojiPopover();
    startScheduleCountdownTick();

    // Wire header & composer events
    const backBtn = document.getElementById('zy-chat-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        closeProfileChat();
      });
    }
    const threadExitBtn = document.getElementById('zy-chat-thread-exit-panel');
    if (threadExitBtn) {
      threadExitBtn.addEventListener('click', () => {
        exitLiveChatToPanel();
      });
    }

    const infoBtn = document.getElementById('zy-chat-group-info-btn');
    const headMeta = document.getElementById('zy-chat-head-meta');
    const toggleDrawer = () => {
      if (!isMulti || hideGroupDrawer) return;
      state.drawerOpen = !state.drawerOpen;
      state.confirmDeleteGroup = false;
      renderThreadArea(false);
    };
    if (infoBtn) infoBtn.addEventListener('click', toggleDrawer);
    if (headMeta && isMulti && !hideGroupDrawer) headMeta.addEventListener('click', toggleDrawer);
    const headAva = document.getElementById('zy-chat-head-ava');
    if (headAva && headAvaUrl) {
      headAva.addEventListener('click', () => openImageLightbox(headAvaUrl, '', conv.title, isCh ? 'Channel Photo' : (isGrp ? 'Group Photo' : 'Profile Photo')));
    }

    const selectBtn = document.getElementById('zy-chat-select-btn');
    const toggleSelectMode = () => {
      state.selectMode = !state.selectMode;
      state.selectedMsgIds.clear();
      state.reactionPickerMsgId = null;
      renderThreadArea(false);
    };
    if (selectBtn) selectBtn.addEventListener('click', toggleSelectMode);
    const clearBtn = document.getElementById('zy-chat-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => clearChatHistory(conv.id));
    }

    // Mobile 3-dot overflow menu wiring
    const moreBtn = document.getElementById('zy-chat-more-btn');
    const moreMenu = document.getElementById('zy-chat-more-menu');
    const closeMoreMenu = () => {
      state.moreMenuOpen = false;
      if (moreMenu) moreMenu.style.display = 'none';
    };
    if (moreBtn && moreMenu) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.moreMenuOpen = !state.moreMenuOpen;
        moreMenu.style.display = state.moreMenuOpen ? 'flex' : 'none';
      });
    }
    const mobSel = document.getElementById('zy-chat-mob-select');
    if (mobSel) mobSel.addEventListener('click', () => { closeMoreMenu(); toggleSelectMode(); });
    const mobClr = document.getElementById('zy-chat-mob-clear');
    if (mobClr) mobClr.addEventListener('click', () => { closeMoreMenu(); clearChatHistory(conv.id); });
    const mobInfo = document.getElementById('zy-chat-mob-group-info');
    if (mobInfo) mobInfo.addEventListener('click', () => { closeMoreMenu(); toggleDrawer(); });
    const mobExit = document.getElementById('zy-chat-mob-exit-panel');
    if (mobExit) mobExit.addEventListener('click', () => { closeMoreMenu(); exitLiveChatToPanel(); });
    const selAllBtn = document.getElementById('zy-chat-sel-all');
    if (selAllBtn) {
      selAllBtn.addEventListener('click', () => {
        const list = state.messagesByConv.get(Number(conv.id)) || [];
        const allIds = list.filter(m => !m._optimistic).map(m => Number(m.id));
        const allSelected = allIds.length > 0 && allIds.every(id => state.selectedMsgIds.has(id));
        state.selectedMsgIds.clear();
        if (!allSelected) allIds.forEach(id => state.selectedMsgIds.add(id));
        renderMessagesPane(false);
        updateSelectBarUi();
      });
    }
    const selDelBtn = document.getElementById('zy-chat-sel-del');
    if (selDelBtn) {
      selDelBtn.addEventListener('click', () => bulkDeleteSelectedMessages(conv.id));
    }
    const selCancelBtn = document.getElementById('zy-chat-sel-cancel');
    if (selCancelBtn) {
      selCancelBtn.addEventListener('click', () => {
        state.selectMode = false;
        state.selectedMsgIds.clear();
        renderThreadArea(false);
      });
    }

    const pinJump = rightEl.querySelector('[data-jump-pin]');
    if (pinJump) pinJump.addEventListener('click', () => jumpToMessage(Number(pinJump.dataset.jumpPin)));
    const unpinBtn = document.getElementById('zy-chat-unpin-btn');
    if (unpinBtn) unpinBtn.addEventListener('click', () => pinMessage(conv.id, null));

    const emojiBtn = document.getElementById('zy-chat-emoji-toggle');
    if (emojiBtn) {
      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.emojiOpen = !state.emojiOpen;
        renderEmojiPopover();
      });
    }

    const imgBtn = document.getElementById('zy-chat-img-btn');
    const fileInput = document.getElementById('zy-chat-file-input');
    if (imgBtn && fileInput) {
      imgBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length) {
          queueImagesForPreview(fileInput.files);
          fileInput.value = '';
        }
      });
    }

    // Drag & Drop photos directly onto thread pane
    if (conv.can_send) {
      const threadCol = rightEl.querySelector('.zy-chat-thread-col');
      const dropOverlay = document.getElementById('zy-chat-drop-overlay');
      if (threadCol && dropOverlay) {
        let dragDepth = 0;
        const hasImageFiles = (e) => {
          const dt = e.dataTransfer;
          if (!dt) return false;
          if (dt.types && Array.from(dt.types).includes('Files')) return true;
          return false;
        };
        threadCol.addEventListener('dragenter', (e) => {
          if (!hasImageFiles(e)) return;
          e.preventDefault();
          dragDepth++;
          dropOverlay.style.display = 'flex';
        });
        threadCol.addEventListener('dragover', (e) => {
          if (!hasImageFiles(e)) return;
          e.preventDefault();
        });
        threadCol.addEventListener('dragleave', (e) => {
          if (!hasImageFiles(e)) return;
          dragDepth = Math.max(0, dragDepth - 1);
          if (dragDepth === 0) dropOverlay.style.display = 'none';
        });
        threadCol.addEventListener('drop', (e) => {
          e.preventDefault();
          dragDepth = 0;
          dropOverlay.style.display = 'none';
          const files = e.dataTransfer && e.dataTransfer.files;
          if (files && files.length) queueImagesForPreview(files);
        });
      }
    }

    const inp = document.getElementById('zy-chat-input');
    const sendBtn = document.getElementById('zy-chat-send');
    if (inp) {
      inp.addEventListener('focus', () => {
        setTimeout(() => {
          syncChatViewport();
          const feed = document.getElementById('zy-chat-feed');
          if (feed) feed.scrollTop = feed.scrollHeight;
        }, 120);
      });
      inp.addEventListener('input', () => {
        inp.style.height = 'auto';
        inp.style.height = Math.min(84, inp.scrollHeight) + 'px';
        emitTypingSignal(conv.id);
      });
      inp.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const pastedImgs = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'file' && /^image\//.test(items[i].type || '')) {
            const f = items[i].getAsFile();
            if (f) pastedImgs.push(f);
          }
        }
        if (pastedImgs.length) {
          e.preventDefault();
          queueImagesForPreview(pastedImgs);
        }
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    // Wire drawer controls
    const gdClose = document.getElementById('zy-gd-close');
    if (gdClose) gdClose.addEventListener('click', () => { state.drawerOpen = false; renderThreadArea(false); });
    const gdAvaPick = document.getElementById('zy-gd-ava-pick');
    const gdAvaInput = document.getElementById('zy-gd-ava-input');
    if (gdAvaPick && gdAvaInput) {
      gdAvaPick.addEventListener('click', () => gdAvaInput.click());
      gdAvaInput.addEventListener('change', () => {
        const f = gdAvaInput.files && gdAvaInput.files[0];
        gdAvaInput.value = '';
        if (f) uploadGroupAvatar(conv.id, f);
      });
    }
    const gdAvaRm = document.getElementById('zy-gd-ava-rm');
    if (gdAvaRm) gdAvaRm.addEventListener('click', () => removeGroupAvatar(conv.id));
    const gdSave = document.getElementById('zy-gd-save-meta');
    if (gdSave) gdSave.addEventListener('click', () => saveGroupMeta(conv.id));
    const gdAdminOnly = document.getElementById('zy-gd-admin-only');
    if (gdAdminOnly) gdAdminOnly.addEventListener('change', (e) => toggleGroupAdminOnly(conv.id, e.target.checked));
    const gdSchedToggle = document.getElementById('zy-gd-sched-enabled');
    const gdSchedFields = document.getElementById('zy-gd-sched-fields');
    if (gdSchedToggle && gdSchedFields) {
      gdSchedToggle.addEventListener('change', (e) => {
        gdSchedFields.style.display = e.target.checked ? 'block' : 'none';
      });
    }
    const gdSaveSched = document.getElementById('zy-gd-save-sched');
    if (gdSaveSched) gdSaveSched.addEventListener('click', () => saveGroupSchedule(conv.id));
    const gdAddBtn = document.getElementById('zy-gd-add-btn');
    if (gdAddBtn) {
      gdAddBtn.addEventListener('click', () => {
        const sel = document.getElementById('zy-gd-add-select');
        const cid = sel ? Number(sel.value) : 0;
        if (!cid) return;
        updateGroupMembers(conv.id, [cid], []);
      });
    }
    const gdAddAllBtn = document.getElementById('zy-gd-add-all-btn');
    if (gdAddAllBtn) {
      gdAddAllBtn.addEventListener('click', () => {
        const memberKeys = new Set(conv.participants || []);
        const ids = state.contacts
          .filter(c => c.role === 'client' && !memberKeys.has(c.key))
          .map(c => Number(c.id))
          .filter(n => n > 0);
        if (ids.length) updateGroupMembers(conv.id, ids, []);
      });
    }
    rightEl.querySelectorAll('[data-remove-cid]').forEach(btn => {
      btn.addEventListener('click', () => updateGroupMembers(conv.id, [], [Number(btn.dataset.removeCid)]));
    });
    const gdDel = document.getElementById('zy-gd-del-btn');
    if (gdDel) gdDel.addEventListener('click', () => { state.confirmDeleteGroup = true; renderThreadArea(false); });
    const gdDelCancel = document.getElementById('zy-gd-del-cancel');
    if (gdDelCancel) gdDelCancel.addEventListener('click', () => { state.confirmDeleteGroup = false; renderThreadArea(false); });
    const gdDelConfirm = document.getElementById('zy-gd-del-confirm');
    if (gdDelConfirm) gdDelConfirm.addEventListener('click', () => deleteGroup(conv.id));
  }

  function renderWorkspace() {
    const root = document.getElementById(state.containerId);
    if (!root) { state.mounted = false; return; }
    const isAgent = state.me && state.me.role === 'agent';
    const isProfileOpen = Boolean(state.mobileShowThread && state.activeConvId);
    const unreadChatsCount = state.conversations.filter(c => Number(c.unread_count || 0) > 0).length;

    root.innerHTML = `
      <div class="zy-chat-shell ${isProfileOpen ? 'is-mobile-thread is-profile-open' : ''}" id="zy-chat-shell">
        <aside class="zy-chat-left">
          <div class="zy-chat-left-head">
            <div class="zy-chat-left-title-wrap">
              <button type="button" class="zy-chat-exit-btn" id="zy-chat-exit-panel" title="Back to Panel Dashboard">
                <i class="fas fa-arrow-left"></i>
                <span>Panel</span>
              </button>
              <span class="zy-chat-left-title">Live Chat</span>
              <span class="zy-chat-conn ${state.wsConnected ? 'is-live' : 'is-warn'}" id="zy-chat-conn-status">${state.wsConnected ? 'Live' : 'Reconnecting...'}</span>
            </div>
            ${isAgent ? `
              <div class="zy-chat-head-create-btns">
                <button type="button" class="zy-chat-new-grp-btn" id="zy-chat-new-group" title="Create Client Group"><i class="fas fa-users-line"></i> Group</button>
                <button type="button" class="zy-chat-new-grp-btn is-ch" id="zy-chat-new-channel" title="Create Announcement Channel"><i class="fas fa-bullhorn"></i> Channel</button>
              </div>
            ` : ''}
          </div>
          <div class="zy-chat-search-wrap">
            <i class="fas fa-magnifying-glass"></i>
            <input type="text" id="zy-chat-search" class="zy-chat-search" placeholder="Search chats or contacts..." value="${esc(state.search)}">
          </div>
          ${isAgent ? `
            <div class="zy-chat-tabs" role="tablist">
              ${[
                ['all', 'All'],
                ['unread', 'Unread'],
                ['clients', 'Clients'],
                ['groups', 'Groups'],
                ['channels', 'Channels'],
                ['owner', 'Owner']
              ].map(([k, lbl]) => `
                <button type="button" class="zy-chat-tab ${state.filterTab === k ? 'is-active' : ''}" data-ftab="${k}">
                  <span>${lbl}</span>
                  ${k === 'unread' ? `<span class="zy-chat-tab-cnt" id="zy-chat-unread-tab-cnt" style="display:${unreadChatsCount > 0 ? 'inline-flex' : 'none'};">${unreadChatsCount > 99 ? '99+' : unreadChatsCount}</span>` : ''}
                </button>
              `).join('')}
            </div>
          ` : ''}
          <div class="zy-chat-inbox-list" id="zy-chat-inbox-list"></div>
        </aside>
        <section class="zy-chat-right" id="zy-chat-right"></section>
      </div>
      ${renderCreateGroupModalHtml()}
    `;

    const exitPanelBtn = document.getElementById('zy-chat-exit-panel');
    if (exitPanelBtn) {
      exitPanelBtn.addEventListener('click', () => exitLiveChatToPanel());
    }

    const searchInp = document.getElementById('zy-chat-search');
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        state.search = e.target.value || '';
        renderInboxList();
      });
    }

    root.querySelectorAll('[data-ftab]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filterTab = btn.dataset.ftab;
        root.querySelectorAll('[data-ftab]').forEach(b => b.classList.toggle('is-active', b.dataset.ftab === state.filterTab));
        renderInboxList();
      });
    });

    const newGrpBtn = document.getElementById('zy-chat-new-group');
    if (newGrpBtn) {
      newGrpBtn.addEventListener('click', () => {
        state.createModalMode = 'group';
        state.createModalAvatar = '';
        state.createModalSearch = '';
        state.createModalOpen = true;
        renderWorkspace();
      });
    }
    const newChBtn = document.getElementById('zy-chat-new-channel');
    if (newChBtn) {
      newChBtn.addEventListener('click', () => {
        state.createModalMode = 'channel';
        state.createModalAvatar = '';
        state.createModalSearch = '';
        state.createModalOpen = true;
        renderWorkspace();
      });
    }

    // Wire Create Group / Announcement Channel Modal
    const cgClose = document.getElementById('zy-cg-close');
    const cgCancel = document.getElementById('zy-cg-cancel');
    const cgBackdrop = document.getElementById('zy-cg-backdrop');
    const cgSubmit = document.getElementById('zy-cg-submit');
    const closeCreate = () => {
      state.createModalOpen = false;
      state.createModalAvatar = '';
      state.createModalSearch = '';
      renderWorkspace();
    };
    if (cgClose) cgClose.addEventListener('click', closeCreate);
    if (cgCancel) cgCancel.addEventListener('click', closeCreate);
    if (cgBackdrop) {
      cgBackdrop.addEventListener('click', (e) => {
        if (e.target === cgBackdrop && typeof window.zyNudgeModal === 'function') {
          window.zyNudgeModal(cgBackdrop.querySelector('.zy-cg-modal, .zy-chat-modal') || cgBackdrop.firstElementChild);
        }
      });
    }
    root.querySelectorAll('[data-cg-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.cgMode === 'channel' ? 'channel' : 'group';
        if (state.createModalMode !== nextMode) {
          state.createModalMode = nextMode;
          renderWorkspace();
        }
      });
    });
    const cgAvaPick = document.getElementById('zy-cg-ava-pick');
    const cgAvaInput = document.getElementById('zy-cg-ava-input');
    if (cgAvaPick && cgAvaInput) {
      cgAvaPick.addEventListener('click', () => cgAvaInput.click());
      cgAvaInput.addEventListener('change', async () => {
        const f = cgAvaInput.files && cgAvaInput.files[0];
        cgAvaInput.value = '';
        if (!f) return;
        try {
          state.createModalAvatar = await fileToAvatarDataUri(f);
          renderWorkspace();
        } catch (err) {
          if (typeof toast === 'function') toast(err.message || 'Invalid image', 'error');
        }
      });
    }
    const cgAvaRm = document.getElementById('zy-cg-ava-rm');
    if (cgAvaRm) {
      cgAvaRm.addEventListener('click', () => {
        state.createModalAvatar = '';
        renderWorkspace();
      });
    }
    const cgClientSearch = document.getElementById('zy-cg-client-search');
    if (cgClientSearch) {
      cgClientSearch.addEventListener('input', (e) => {
        const q = String(e.target.value || '').trim().toLowerCase();
        state.createModalSearch = e.target.value || '';
        document.querySelectorAll('#zy-cg-checklist .zy-cg-check-item').forEach(row => {
          const hay = row.dataset.cgHay || '';
          row.style.display = !q || hay.includes(q) ? '' : 'none';
        });
      });
    }
    const cgSelAll = document.getElementById('zy-cg-sel-all');
    if (cgSelAll) {
      cgSelAll.addEventListener('click', () => {
        const visibleCbs = Array.from(document.querySelectorAll('#zy-cg-checklist .zy-cg-check-item'))
          .filter(r => r.style.display !== 'none')
          .map(r => r.querySelector('.zy-cg-member-cb'))
          .filter(Boolean);
        const allChecked = visibleCbs.length > 0 && visibleCbs.every(cb => cb.checked);
        visibleCbs.forEach(cb => { cb.checked = !allChecked; });
        cgSelAll.textContent = allChecked ? 'Select All' : 'Clear All';
      });
    }
    if (cgSubmit) cgSubmit.addEventListener('click', createGroupFromModal);

    renderInboxList();
    renderThreadArea(true);
    renderSeenModalOverlay();
  }

  // Close emoji popover, reaction picker & mobile more menu on outside click
  document.addEventListener('click', (e) => {
    if (state.emojiOpen) {
      const pop = document.getElementById('zy-chat-emoji-pop');
      const btn = document.getElementById('zy-chat-emoji-toggle');
      if (pop && !pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
        state.emojiOpen = false;
        renderEmojiPopover();
      }
    }
    if (state.reactionPickerMsgId != null) {
      if (!e.target.closest('.zy-chat-react-picker') && !e.target.closest('[data-act="react"]')) {
        state.reactionPickerMsgId = null;
        const feed = document.getElementById('zy-chat-feed');
        const prevScroll = feed ? feed.scrollTop : null;
        renderMessagesPane(false);
        if (feed && prevScroll != null) feed.scrollTop = prevScroll;
      }
    }
    if (state.moreMenuOpen) {
      const menu = document.getElementById('zy-chat-more-menu');
      const mBtn = document.getElementById('zy-chat-more-btn');
      if (menu && !menu.contains(e.target) && (!mBtn || !mBtn.contains(e.target))) {
        state.moreMenuOpen = false;
        menu.style.display = 'none';
      }
    }
  });

  // Pin Live Chat shell to visualViewport so mobile keyboard NEVER pushes top bar / username off-screen
  function syncChatViewport() {
    try {
      const vv = window.visualViewport;
      const h = vv ? Math.round(vv.height) : window.innerHeight;
      const top = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
      const rootStyle = document.documentElement.style;
      if (h > 180) rootStyle.setProperty('--zy-chat-vvh', `${h}px`);
      rootStyle.setProperty('--zy-chat-vvt', `${top}px`);
      if (state.mounted && window.innerWidth <= 768) {
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      }
    } catch (_) {}
  }

  function bindViewportPin() {
    unbindViewportPin();
    syncChatViewport();
    const onVpChange = () => {
      syncChatViewport();
      const feed = document.getElementById('zy-chat-feed');
      if (feed && document.activeElement && document.activeElement.id === 'zy-chat-input') {
        feed.scrollTop = feed.scrollHeight;
      }
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onVpChange);
      window.visualViewport.addEventListener('scroll', onVpChange);
    }
    window.addEventListener('resize', onVpChange);
    state.viewportCleanup = () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onVpChange);
        window.visualViewport.removeEventListener('scroll', onVpChange);
      }
      window.removeEventListener('resize', onVpChange);
      try {
        document.documentElement.style.removeProperty('--zy-chat-vvh');
        document.documentElement.style.removeProperty('--zy-chat-vvt');
      } catch (_) {}
    };
  }

  function unbindViewportPin() {
    if (typeof state.viewportCleanup === 'function') {
      try { state.viewportCleanup(); } catch (_) {}
      state.viewportCleanup = null;
    }
  }

  // Public API
  const HumexLiveChat = {
    async renderPage(containerId = 'page-content') {
      state.containerId = containerId;
      state.mounted = true;
      try {
        document.documentElement.classList.add('zy-is-live-chat-html');
        document.body.classList.add('zy-is-live-chat');
      } catch (_) {}
      bindViewportPin();
      if (typeof window.zyUpdateBreadcrumb === 'function') {
        window.zyUpdateBreadcrumb('live-chat', 'Live Chat');
      }
      // Check if URL has ?chat=<id> to auto-open that profile chat directly
      let urlChatId = null;
      try {
        const m = String(window.location.search || '').match(/[?&]chat=(\d+)/);
        if (m) {
          const parsed = Number(m[1]);
          if (Number.isInteger(parsed) && parsed > 0) urlChatId = parsed;
        }
      } catch (_) {}
      if (urlChatId && !state.activeConvId) {
        state.activeConvId = urlChatId;
        state.mobileShowThread = true;
      }
      renderWorkspace();
      await fetchBootstrap(false);
      connectWs();
      const isDesktopVp = window.innerWidth > 768;
      if (state.activeConvId && state.conversations.some(c => Number(c.id) === Number(state.activeConvId))) {
        state.mobileShowThread = true;
        syncChatUrlId(state.activeConvId);
        renderWorkspace();
        await loadMessages(state.activeConvId, { silent: true });
      } else if (isDesktopVp && state.conversations.length > 0) {
        // Desktop split-pane: automatically open the most recent thread on the right pane
        await selectConversation(state.conversations[0].id);
      } else if (urlChatId) {
        syncChatUrlId(null);
      }
    },
    unmount() {
      state.mounted = false;
      state.emojiOpen = false;
      state.reactionPickerMsgId = null;
      state.seenModal = null;
      state.moreMenuOpen = false;
      renderSeenModalOverlay();
      unbindViewportPin();
      try {
        document.documentElement.classList.remove('zy-is-live-chat-html');
        document.body.classList.remove('zy-is-live-chat');
      } catch (_) {}
      stopScheduleCountdownTick();
    },
    refreshBadge: () => fetchBootstrap(true),
    getUnreadCount: () => state.totalUnread,
    openConversation: openConversationFromAnywhere
  };

  window.HumexLiveChat = HumexLiveChat;

  // Boot background live sync + sidebar unread counter badge on every panel page
  function initBackground() {
    if (window.__AUTH_BLOCKED__) return;
    syncSidebarBadge();
    fetchBootstrap(true);
    connectWs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initBackground, 250));
  } else {
    setTimeout(initBackground, 250);
  }
})();
