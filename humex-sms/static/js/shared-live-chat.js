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
    filterTab: 'all',          // 'all' | 'owner' | 'clients' | 'groups' (Agent only)
    replyTo: null,             // { id, sender_name, body }
    emojiOpen: false,
    emojiTab: 0,
    drawerOpen: false,
    createModalOpen: false,
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
    totalUnread: 0
  };

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
    const isGroup = ev.conversation_type === 'agent_group';
    const roleTag = msg.sender_role === 'owner' ? 'Owner' : 'Agent Admin';
    const heading = isGroup
      ? `${esc(ev.conversation_title || 'Group')} · ${esc(msg.sender_name || roleTag)}`
      : `${esc(msg.sender_name || roleTag)} · ${roleTag}`;
    const snippet = esc(String(msg.body || '').slice(0, 110));

    const el = document.createElement('div');
    el.className = 'zy-chat-alert-toast';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.innerHTML = `
      <div class="zy-chat-alert-ico"><i class="fas fa-comments"></i></div>
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
          const optIdx = isSelf ? arr.findIndex(m => m._optimistic && m.body === msg.body) : -1;
          if (optIdx !== -1) arr[optIdx] = msg;
          else arr.push(msg);
        }
      }

      const conv = state.conversations.find(c => Number(c.id) === convId);
      if (!conv) {
        // Brand new conversation initiated by someone else — re-bootstrap cleanly
        fetchBootstrap(true);
      } else {
        conv.last_message_id = Number(msg.id);
        conv.last_message_preview = String(msg.body || '').slice(0, 120);
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
      const conv = state.conversations.find(c => Number(c.id) === Number(ev.conversation_id));
      if (conv) {
        if (!conv.read_cursors) conv.read_cursors = {};
        conv.read_cursors[ev.actor_key] = Math.max(Number(conv.read_cursors[ev.actor_key] || 0), Number(ev.last_read_id || 0));
        if (state.me && ev.actor_key === state.me.key) {
          conv.unread_count = 0;
          recomputeUnread();
        }
        if (state.mounted && Number(state.activeConvId) === Number(ev.conversation_id)) {
          renderMessagesPane(false);
        }
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
      const arr = state.messagesByConv.get(convId);
      if (arr) {
        const target = arr.find(m => Number(m.id) === msgId);
        if (target) {
          target.deleted = true;
          target.body = 'This message was deleted';
          target.reply_to = null;
        }
      }
      const conv = state.conversations.find(c => Number(c.id) === convId);
      if (conv) {
        if (Number(conv.pinned_message_id) === msgId) {
          conv.pinned_message_id = null;
          conv.pinned_message = null;
        }
        if (Number(conv.last_message_id) === msgId) {
          conv.last_message_preview = 'This message was deleted';
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

  async function selectConversation(convId) {
    state.activeConvId = Number(convId);
    state.replyTo = null;
    state.emojiOpen = false;
    state.drawerOpen = false;
    state.confirmDeleteGroup = false;
    state.mobileShowThread = true;
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

  async function sendMessage() {
    if (state.sending || !state.activeConvId) return;
    const input = document.getElementById('zy-chat-input');
    if (!input) return;
    const body = String(input.value || '').trim();
    if (!body) return;

    const convId = Number(state.activeConvId);
    const replySnapshot = state.replyTo ? { ...state.replyTo } : null;

    // Optimistic insert
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
      await reqJson(`/api/chat/conversations/${convId}/messages/${msgId}`, { method: 'DELETE' });
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Cannot delete message', 'error');
    }
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

  // ── Agent Group Admin Actions ──
  async function createGroupFromModal() {
    const titleEl = document.getElementById('zy-cg-title');
    const descEl = document.getElementById('zy-cg-desc');
    const adminOnlyEl = document.getElementById('zy-cg-admin-only');
    const checks = Array.from(document.querySelectorAll('.zy-cg-member-cb:checked'));
    const title = titleEl ? titleEl.value.trim() : '';
    const description = descEl ? descEl.value.trim() : '';
    const admin_only = Boolean(adminOnlyEl && adminOnlyEl.checked);
    const member_client_ids = checks.map(cb => Number(cb.value)).filter(n => n > 0);

    if (!title) {
      if (typeof toast === 'function') toast('Please enter a group name', 'warning');
      return;
    }
    if (!member_client_ids.length) {
      if (typeof toast === 'function') toast('Select at least 1 of your clients', 'warning');
      return;
    }

    try {
      const data = await reqJson('/api/chat/groups', {
        method: 'POST',
        body: JSON.stringify({ title, description, admin_only, member_client_ids })
      });
      state.createModalOpen = false;
      if (data.conversation) {
        state.conversations.unshift(data.conversation);
        recomputeUnread();
        await selectConversation(data.conversation.id);
      }
      if (typeof toast === 'function') toast(`Group "${title}" created`, 'success');
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to create group', 'error');
    }
  }

  async function saveGroupMeta(convId) {
    const titleEl = document.getElementById('zy-gd-title');
    const descEl = document.getElementById('zy-gd-desc');
    const title = titleEl ? titleEl.value.trim() : '';
    const description = descEl ? descEl.value.trim() : '';
    if (!title) {
      if (typeof toast === 'function') toast('Group name cannot be empty', 'warning');
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
      if (typeof toast === 'function') toast('Group info updated', 'success');
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to update group', 'error');
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
        toast(nextVal ? 'Admin-only mode enabled (Clients muted)' : 'All group members can now send messages', 'success');
      }
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to update setting', 'error');
    }
  }

  async function updateGroupMembers(convId, addIds, removeIds) {
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
        toast(addIds && addIds.length ? 'Member added to group' : 'Member removed from group', 'success');
      }
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to update members', 'error');
    }
  }

  async function deleteGroup(convId) {
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
      if (typeof toast === 'function') toast('Group deleted', 'success');
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || 'Failed to delete group', 'error');
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

  function computeTickHtml(msg, conv) {
    if (!state.me || msg.sender_key !== state.me.key) return '';
    if (msg._optimistic) {
      return '<span class="zy-chat-tick is-pending" title="Sending"><i class="far fa-clock"></i></span>';
    }
    const others = (conv.participants || []).filter(k => k !== state.me.key);
    const cursors = conv.read_cursors || {};
    const anySeen = others.some(k => Number(cursors[k] || 0) >= Number(msg.id));
    if (anySeen) {
      return '<span class="zy-chat-tick is-seen" title="Seen"><i class="fas fa-check-double"></i></span>';
    }
    const peerOnline = conv.type === 'agent_group'
      ? (conv.members || []).some(m => m.key !== state.me.key && m.online)
      : Boolean(conv.peer && conv.peer.online);
    if (peerOnline) {
      return '<span class="zy-chat-tick is-delivered" title="Delivered"><i class="fas fa-check-double"></i></span>';
    }
    return '<span class="zy-chat-tick is-sent" title="Sent"><i class="fas fa-check"></i></span>';
  }

  function renderInboxList() {
    const listEl = document.getElementById('zy-chat-inbox-list');
    if (!listEl) return;

    const q = state.search.trim().toLowerCase();
    const isAgent = state.me && state.me.role === 'agent';

    const filteredConvs = state.conversations.filter(c => {
      if (isAgent) {
        if (state.filterTab === 'owner' && c.type !== 'owner_agent') return false;
        if (state.filterTab === 'clients' && c.type !== 'agent_client') return false;
        if (state.filterTab === 'groups' && c.type !== 'agent_group') return false;
      }
      if (!q) return true;
      const hay = `${c.title || ''} ${c.last_message_preview || ''} ${(c.peer && c.peer.username) || ''}`.toLowerCase();
      return hay.includes(q);
    });

    // Contacts that do not yet have an open 1-to-1 thread
    const existingPeerKeys = new Set(
      state.conversations
        .filter(c => c.type !== 'agent_group' && c.peer)
        .map(c => c.peer.key)
    );
    const availableContacts = state.contacts.filter(ct => {
      if (existingPeerKeys.has(ct.key)) return false;
      if (isAgent) {
        if (state.filterTab === 'owner' && ct.role !== 'owner') return false;
        if (state.filterTab === 'clients' && ct.role !== 'client') return false;
        if (state.filterTab === 'groups') return false;
      }
      if (!q) return true;
      return `${ct.display_name || ''} ${ct.username || ''}`.toLowerCase().includes(q);
    });

    let html = '';

    if (filteredConvs.length) {
      html += filteredConvs.map(c => {
        const active = Number(c.id) === Number(state.activeConvId);
        const isGroup = c.type === 'agent_group';
        const isOnline = !isGroup && Boolean(c.peer && c.peer.online);
        const typingText = getTypingText(c.id);
        const roleSub = isGroup
          ? `Group · ${(c.members || []).length} members${c.admin_only ? ' · Admin only' : ''}`
          : (c.peer && c.peer.role === 'owner' ? 'Owner' : (c.peer && c.peer.role === 'agent' ? 'Agent' : 'Client'));

        const previewHtml = typingText
          ? `<span class="zy-chat-typing-mini">${esc(typingText)}</span>`
          : esc(c.last_message_preview || 'No messages yet');

        return `
          <button type="button" class="zy-chat-row ${active ? 'is-active' : ''}" data-conv-id="${c.id}">
            <div class="zy-chat-ava ${isGroup ? 'is-group' : ''}" style="--ava-bg:${isGroup ? '#0f766e' : colorForKey(c.peer ? c.peer.key : c.id)};">
              ${isGroup ? '<i class="fas fa-users"></i>' : esc(initials(c.title))}
              ${isOnline ? '<span class="zy-chat-dot-online" title="Online"></span>' : ''}
            </div>
            <div class="zy-chat-row-body">
              <div class="zy-chat-row-top">
                <span class="zy-chat-row-name">${esc(c.title)}</span>
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
        return `
          <button type="button" class="zy-chat-row is-contact" data-contact-key="${esc(ct.key)}">
            <div class="zy-chat-ava" style="--ava-bg:${colorForKey(ct.key)};">
              ${esc(initials(ct.display_name || ct.username))}
              ${ct.online ? '<span class="zy-chat-dot-online" title="Online"></span>' : ''}
            </div>
            <div class="zy-chat-row-body">
              <div class="zy-chat-row-top">
                <span class="zy-chat-row-name">${esc(ct.display_name || ct.username)}</span>
                <span class="zy-chat-row-time">${ct.online ? 'Online' : ''}</span>
              </div>
              <div class="zy-chat-row-sub">${esc(roleLabel)} · Tap to start chat</div>
            </div>
          </button>
        `;
      }).join('');
    }

    if (!html) {
      const emptyMsg = state.me && state.me.role === 'owner'
        ? 'No agents available yet.'
        : (state.me && state.me.role === 'agent'
            ? 'No chats match your filter. Add clients or start a chat with Owner.'
            : 'No assigned agent or groups found for your account.');
      html = `
        <div class="zy-chat-inbox-empty">
          <i class="far fa-comments"></i>
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
    if (conv.type === 'agent_group') {
      const onlineCnt = (conv.members || []).filter(m => m.online).length;
      const parts = [`${(conv.members || []).length} members`];
      if (onlineCnt > 0) parts.push(`${onlineCnt} online`);
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
    if (!msgs.length) {
      feed.innerHTML = `
        <div class="zy-chat-thread-empty">
          <div class="zy-chat-thread-empty-card">
            <i class="fas fa-lock"></i>
            <div class="zy-chat-empty-title">Private Role-Isolated Chat</div>
            <div class="zy-chat-empty-desc">
              ${conv.type === 'agent_group'
                ? 'Messages in this group are private to your Agent and group members.'
                : 'Send your first message below to start the conversation.'}
            </div>
          </div>
        </div>
      `;
      return;
    }

    let lastDay = '';
    const isGroup = conv.type === 'agent_group';
    const isGroupAdmin = Boolean(conv.can_manage);

    const html = msgs.map(m => {
      const dayLabel = formatDayLabel(m.created_at);
      let divider = '';
      if (dayLabel && dayLabel !== lastDay) {
        lastDay = dayLabel;
        divider = `<div class="zy-chat-day-sep"><span>${esc(dayLabel)}</span></div>`;
      }
      const isMine = state.me && m.sender_key === state.me.key;
      const canDelete = !m.deleted && (isMine || isGroupAdmin);
      const isPinned = Number(conv.pinned_message_id) === Number(m.id);

      const senderLabel = isGroup && !isMine
        ? `<div class="zy-chat-sender" style="color:${colorForKey(m.sender_key)};">${esc(m.sender_name)}${m.sender_role === 'agent' ? ' · Admin' : ''}</div>`
        : '';

      const replyBlock = m.reply_to && !m.deleted
        ? `<div class="zy-chat-quote" data-jump-msg="${m.reply_to.id}">
             <div class="zy-chat-quote-who">${esc(m.reply_to.sender_name || 'Message')}</div>
             <div class="zy-chat-quote-txt">${esc(m.reply_to.body_snippet || '')}</div>
           </div>`
        : '';

      const actionsHtml = !m.deleted && !m._optimistic
        ? `<div class="zy-chat-msg-actions">
             <button type="button" class="zy-chat-act-btn" data-act="reply" data-mid="${m.id}" title="Reply"><i class="fas fa-reply"></i></button>
             ${isGroupAdmin ? `<button type="button" class="zy-chat-act-btn ${isPinned ? 'is-pinned' : ''}" data-act="pin" data-mid="${m.id}" title="${isPinned ? 'Unpin' : 'Pin message'}"><i class="fas fa-thumbtack"></i></button>` : ''}
             ${canDelete ? `<button type="button" class="zy-chat-act-btn is-del" data-act="del" data-mid="${m.id}" title="Delete"><i class="fas fa-trash-can"></i></button>` : ''}
           </div>`
        : '';

      return `
        ${divider}
        <div class="zy-chat-msg-row ${isMine ? 'is-out' : 'is-in'}" data-msg-id="${m.id}">
          <div class="zy-chat-bubble ${isMine ? 'is-out' : 'is-in'} ${m.deleted ? 'is-deleted' : ''}">
            ${actionsHtml}
            ${senderLabel}
            ${replyBlock}
            <div class="zy-chat-text">${m.deleted ? '<i class="fas fa-ban"></i> This message was deleted' : esc(m.body).replace(/\n/g, '<br>')}</div>
            <div class="zy-chat-meta">
              ${isPinned ? '<span class="zy-chat-pin-ico" title="Pinned"><i class="fas fa-thumbtack"></i></span>' : ''}
              <span class="zy-chat-ts">${esc(formatTime(m.created_at))}</span>
              ${computeTickHtml(m, conv)}
            </div>
          </div>
        </div>
      `;
    }).join('');

    feed.innerHTML = html;

    // Bind quote jump
    feed.querySelectorAll('[data-jump-msg]').forEach(el => {
      el.addEventListener('click', () => jumpToMessage(Number(el.dataset.jumpMsg)));
    });
    // Bind actions
    feed.querySelectorAll('.zy-chat-act-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mid = Number(btn.dataset.mid);
        const act = btn.dataset.act;
        const target = msgs.find(x => Number(x.id) === mid);
        if (act === 'reply' && target) {
          state.replyTo = { id: target.id, sender_name: target.sender_name, body: target.body };
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
    if (!state.drawerOpen || !conv || conv.type !== 'agent_group') return '';
    const isAdmin = Boolean(conv.can_manage);
    const memberKeys = new Set(conv.participants || []);
    const addableClients = isAdmin
      ? state.contacts.filter(c => c.role === 'client' && !memberKeys.has(c.key))
      : [];

    return `
      <aside class="zy-chat-drawer" aria-label="Group Info">
        <div class="zy-chat-drawer-head">
          <span>${isAdmin ? 'Group Admin Settings' : 'Group Info'}</span>
          <button type="button" class="zy-chat-icon-btn" id="zy-gd-close" aria-label="Close"><i class="fas fa-times"></i></button>
        </div>
        <div class="zy-chat-drawer-body">
          ${isAdmin ? `
            <div class="zy-gd-section">
              <label class="zy-gd-label">Group Name</label>
              <input type="text" id="zy-gd-title" class="zy-gd-input" maxlength="80" value="${esc(conv.title)}">
              <label class="zy-gd-label" style="margin-top:10px;">Description</label>
              <textarea id="zy-gd-desc" class="zy-gd-input" rows="2" maxlength="240" placeholder="Optional group description">${esc(conv.description || '')}</textarea>
              <button type="button" class="zy-gd-btn-primary" id="zy-gd-save-meta">Save Group Info</button>
            </div>
            <div class="zy-gd-section">
              <label class="zy-gd-toggle-row">
                <div>
                  <div class="zy-gd-toggle-title">Only Admin Can Send</div>
                  <div class="zy-gd-toggle-sub">Restrict clients from sending messages</div>
                </div>
                <input type="checkbox" id="zy-gd-admin-only" ${conv.admin_only ? 'checked' : ''}>
              </label>
            </div>
            <div class="zy-gd-section">
              <div class="zy-gd-label">Add My Clients</div>
              ${addableClients.length ? `
                <div class="zy-gd-add-row">
                  <select id="zy-gd-add-select" class="zy-gd-input">
                    <option value="">Select client to add...</option>
                    ${addableClients.map(c => `<option value="${c.id}">${esc(c.display_name || c.username)}</option>`).join('')}
                  </select>
                  <button type="button" class="zy-gd-btn-add" id="zy-gd-add-btn">Add</button>
                </div>
              ` : '<div class="zy-gd-muted">All of your assigned clients are already in this group.</div>'}
            </div>
          ` : `
            <div class="zy-gd-section">
              <div class="zy-gd-ro-title">${esc(conv.title)}</div>
              ${conv.description ? `<div class="zy-gd-muted">${esc(conv.description)}</div>` : ''}
            </div>
          `}

          <div class="zy-gd-section">
            <div class="zy-gd-label">Members (${(conv.members || []).length})</div>
            <div class="zy-gd-members">
              ${(conv.members || []).map(m => `
                <div class="zy-gd-member-row">
                  <div class="zy-chat-ava is-sm" style="--ava-bg:${colorForKey(m.key)};">
                    ${esc(initials(m.display_name || m.username))}
                    ${m.online ? '<span class="zy-chat-dot-online"></span>' : ''}
                  </div>
                  <div class="zy-gd-member-info">
                    <div class="zy-gd-member-name">${esc(m.display_name || m.username)}</div>
                    <div class="zy-gd-member-sub">${m.role === 'agent' ? 'Group Admin (Agent)' : (m.online ? 'Client · Online' : 'Client')}</div>
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
                  <div class="zy-gd-confirm-txt">Delete this group and all its messages permanently?</div>
                  <div class="zy-gd-confirm-btns">
                    <button type="button" class="zy-gd-btn-danger" id="zy-gd-del-confirm">Yes, Delete</button>
                    <button type="button" class="zy-gd-btn-cancel" id="zy-gd-del-cancel">Cancel</button>
                  </div>
                </div>
              ` : `<button type="button" class="zy-gd-btn-danger-outline" id="zy-gd-del-btn"><i class="fas fa-trash-can"></i> Delete Group</button>`}
            </div>
          ` : ''}
        </div>
      </aside>
    `;
  }

  function renderCreateGroupModalHtml() {
    if (!state.createModalOpen || !state.me || state.me.role !== 'agent') return '';
    const myClients = state.contacts.filter(c => c.role === 'client');
    return `
      <div class="zy-chat-modal-backdrop" id="zy-cg-backdrop">
        <div class="zy-chat-modal" role="dialog" aria-modal="true" aria-label="Create Client Group">
          <div class="zy-chat-modal-head">
            <span>New Client Group</span>
            <button type="button" class="zy-chat-icon-btn" id="zy-cg-close" aria-label="Close"><i class="fas fa-times"></i></button>
          </div>
          <div class="zy-chat-modal-body">
            <label class="zy-gd-label">Group Name</label>
            <input type="text" id="zy-cg-title" class="zy-gd-input" maxlength="80" placeholder="e.g. VIP Rates & Updates">
            <label class="zy-gd-label" style="margin-top:12px;">Description (Optional)</label>
            <input type="text" id="zy-cg-desc" class="zy-gd-input" maxlength="240" placeholder="Announcements and support for my clients">
            <label class="zy-gd-toggle-row" style="margin-top:12px;">
              <div>
                <div class="zy-gd-toggle-title">Only Admin Can Send</div>
                <div class="zy-gd-toggle-sub">Announcement mode (you can change anytime)</div>
              </div>
              <input type="checkbox" id="zy-cg-admin-only">
            </label>
            <div class="zy-gd-label" style="margin-top:14px;">Select Your Clients (${myClients.length} available)</div>
            ${myClients.length ? `
              <div class="zy-cg-checklist">
                ${myClients.map(c => `
                  <label class="zy-cg-check-item">
                    <input type="checkbox" class="zy-cg-member-cb" value="${c.id}">
                    <span class="zy-cg-check-name">${esc(c.display_name || c.username)}</span>
                    <span class="zy-cg-check-sub">${c.online ? 'Online' : 'Offline'}</span>
                  </label>
                `).join('')}
              </div>
            ` : `<div class="zy-gd-muted" style="padding:12px 0;">You do not have any assigned clients yet. Add clients first to create a group.</div>`}
          </div>
          <div class="zy-chat-modal-foot">
            <button type="button" class="zy-gd-btn-cancel" id="zy-cg-cancel">Cancel</button>
            <button type="button" class="zy-gd-btn-primary" id="zy-cg-submit" ${!myClients.length ? 'disabled' : ''}>Create Group</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderThreadArea(scrollBottom = false) {
    const rightEl = document.getElementById('zy-chat-right');
    if (!rightEl) return;
    const conv = getActiveConv();

    if (!conv) {
      const roleHint = state.me && state.me.role === 'owner'
        ? 'Select any Agent from the left to chat directly 1-to-1.'
        : (state.me && state.me.role === 'agent'
            ? 'Chat privately with the Owner, message your Clients 1-to-1, or create a private Client Group.'
            : 'Select your Agent or a joined Group from the left to start chatting.');
      rightEl.innerHTML = `
        <div class="zy-chat-welcome">
          <div class="zy-chat-welcome-ico"><i class="fab fa-whatsapp"></i></div>
          <div class="zy-chat-welcome-title">Live Chat Workspace</div>
          <div class="zy-chat-welcome-sub">${esc(roleHint)}</div>
        </div>
      `;
      return;
    }

    const isGroup = conv.type === 'agent_group';
    const isOnline = !isGroup && Boolean(conv.peer && conv.peer.online);
    const pinned = conv.pinned_message;

    rightEl.innerHTML = `
      <div class="zy-chat-thread-col">
        <div class="zy-chat-thread-head">
          <button type="button" class="zy-chat-back-btn" id="zy-chat-back" aria-label="Back to chats"><i class="fas fa-arrow-left"></i></button>
          <div class="zy-chat-ava ${isGroup ? 'is-group' : ''}" style="--ava-bg:${isGroup ? '#0f766e' : colorForKey(conv.peer ? conv.peer.key : conv.id)};">
            ${isGroup ? '<i class="fas fa-users"></i>' : esc(initials(conv.title))}
            ${isOnline ? '<span class="zy-chat-dot-online"></span>' : ''}
          </div>
          <div class="zy-chat-thread-meta" id="zy-chat-head-meta" ${isGroup ? 'role="button" tabindex="0"' : ''}>
            <div class="zy-chat-thread-name">${esc(conv.title)}</div>
            <div class="zy-chat-thread-sub" id="zy-chat-thread-sub"></div>
          </div>
          <div class="zy-chat-thread-actions">
            ${isGroup ? `
              <button type="button" class="zy-chat-head-btn" id="zy-chat-group-info-btn" title="${conv.can_manage ? 'Group Admin Settings' : 'Group Info'}">
                <i class="fas ${conv.can_manage ? 'fa-sliders' : 'fa-circle-info'}"></i>
                <span>${conv.can_manage ? 'Manage' : 'Info'}</span>
              </button>
            ` : ''}
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

        ${conv.can_send ? `
          <div class="zy-chat-composer-wrap">
            <div class="zy-chat-emoji-pop" id="zy-chat-emoji-pop" style="display:none;"></div>
            <div class="zy-chat-reply-strip" id="zy-chat-reply-strip" style="display:none;"></div>
            <div class="zy-chat-composer">
              <button type="button" class="zy-chat-icon-btn" id="zy-chat-emoji-toggle" title="Emoji" aria-label="Emoji"><i class="far fa-face-smile"></i></button>
              <textarea id="zy-chat-input" class="zy-chat-input" rows="1" maxlength="2000" placeholder="Type a message..."></textarea>
              <button type="button" class="zy-chat-send-btn" id="zy-chat-send" title="Send" aria-label="Send"><i class="fas fa-paper-plane"></i></button>
            </div>
          </div>
        ` : `
          <div class="zy-chat-locked-bar">
            <i class="fas fa-lock"></i>
            <span>Only your Agent (Group Admin) can send messages in this group.</span>
          </div>
        `}
      </div>
      ${renderGroupDrawerHtml(conv)}
    `;

    updateThreadHeaderSubtitle();
    renderMessagesPane(scrollBottom);
    renderReplyStrip();
    renderEmojiPopover();

    // Wire header & composer events
    const backBtn = document.getElementById('zy-chat-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        state.mobileShowThread = false;
        const shell = document.getElementById('zy-chat-shell');
        if (shell) shell.classList.remove('is-mobile-thread');
      });
    }

    const infoBtn = document.getElementById('zy-chat-group-info-btn');
    const headMeta = document.getElementById('zy-chat-head-meta');
    const toggleDrawer = () => {
      if (!isGroup) return;
      state.drawerOpen = !state.drawerOpen;
      state.confirmDeleteGroup = false;
      renderThreadArea(false);
    };
    if (infoBtn) infoBtn.addEventListener('click', toggleDrawer);
    if (headMeta && isGroup) headMeta.addEventListener('click', toggleDrawer);

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

    const inp = document.getElementById('zy-chat-input');
    const sendBtn = document.getElementById('zy-chat-send');
    if (inp) {
      inp.addEventListener('input', () => {
        inp.style.height = 'auto';
        inp.style.height = Math.min(120, inp.scrollHeight) + 'px';
        emitTypingSignal(conv.id);
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
    const gdSave = document.getElementById('zy-gd-save-meta');
    if (gdSave) gdSave.addEventListener('click', () => saveGroupMeta(conv.id));
    const gdAdminOnly = document.getElementById('zy-gd-admin-only');
    if (gdAdminOnly) gdAdminOnly.addEventListener('change', (e) => toggleGroupAdminOnly(conv.id, e.target.checked));
    const gdAddBtn = document.getElementById('zy-gd-add-btn');
    if (gdAddBtn) {
      gdAddBtn.addEventListener('click', () => {
        const sel = document.getElementById('zy-gd-add-select');
        const cid = sel ? Number(sel.value) : 0;
        if (!cid) return;
        updateGroupMembers(conv.id, [cid], []);
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

    root.innerHTML = `
      <div class="zy-chat-shell ${state.mobileShowThread && state.activeConvId ? 'is-mobile-thread' : ''}" id="zy-chat-shell">
        <aside class="zy-chat-left">
          <div class="zy-chat-left-head">
            <div class="zy-chat-left-title-wrap">
              <span class="zy-chat-left-title">Live Chat</span>
              <span class="zy-chat-conn ${state.wsConnected ? 'is-live' : 'is-warn'}" id="zy-chat-conn-status">${state.wsConnected ? 'Live' : 'Reconnecting...'}</span>
            </div>
            ${isAgent ? `<button type="button" class="zy-chat-new-grp-btn" id="zy-chat-new-group"><i class="fas fa-users-line"></i> New Group</button>` : ''}
          </div>
          <div class="zy-chat-search-wrap">
            <i class="fas fa-magnifying-glass"></i>
            <input type="text" id="zy-chat-search" class="zy-chat-search" placeholder="Search chats or contacts..." value="${esc(state.search)}">
          </div>
          ${isAgent ? `
            <div class="zy-chat-tabs" role="tablist">
              ${[
                ['all', 'All'],
                ['owner', 'Owner'],
                ['clients', 'Clients'],
                ['groups', 'Groups']
              ].map(([k, lbl]) => `<button type="button" class="zy-chat-tab ${state.filterTab === k ? 'is-active' : ''}" data-ftab="${k}">${lbl}</button>`).join('')}
            </div>
          ` : ''}
          <div class="zy-chat-inbox-list" id="zy-chat-inbox-list"></div>
        </aside>
        <section class="zy-chat-right" id="zy-chat-right"></section>
      </div>
      ${renderCreateGroupModalHtml()}
    `;

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
        state.createModalOpen = true;
        renderWorkspace();
      });
    }

    // Wire Create Group Modal
    const cgClose = document.getElementById('zy-cg-close');
    const cgCancel = document.getElementById('zy-cg-cancel');
    const cgBackdrop = document.getElementById('zy-cg-backdrop');
    const cgSubmit = document.getElementById('zy-cg-submit');
    const closeCreate = () => { state.createModalOpen = false; renderWorkspace(); };
    if (cgClose) cgClose.addEventListener('click', closeCreate);
    if (cgCancel) cgCancel.addEventListener('click', closeCreate);
    if (cgBackdrop) cgBackdrop.addEventListener('click', (e) => { if (e.target === cgBackdrop) closeCreate(); });
    if (cgSubmit) cgSubmit.addEventListener('click', createGroupFromModal);

    renderInboxList();
    renderThreadArea(true);
  }

  // Close emoji popover on outside click
  document.addEventListener('click', (e) => {
    if (!state.emojiOpen) return;
    const pop = document.getElementById('zy-chat-emoji-pop');
    const btn = document.getElementById('zy-chat-emoji-toggle');
    if (pop && !pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
      state.emojiOpen = false;
      renderEmojiPopover();
    }
  });

  // Public API
  const HumexLiveChat = {
    async renderPage(containerId = 'page-content') {
      state.containerId = containerId;
      state.mounted = true;
      if (typeof window.zyUpdateBreadcrumb === 'function') {
        window.zyUpdateBreadcrumb('live-chat', 'Live Chat');
      }
      renderWorkspace();
      await fetchBootstrap(false);
      connectWs();
      if (state.activeConvId) {
        await loadMessages(state.activeConvId, { silent: true });
      }
    },
    unmount() {
      state.mounted = false;
      state.emojiOpen = false;
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
