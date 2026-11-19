/* ═══════════════════════════════════════════════════════════════════
   HUMEX SMS — Self-Service Profile, Theme, Security & API Engine
   Shared across Owner, Agent & Client portals:
   1. Personal Details (Full name, Email, Phone/WhatsApp, Teams/Telegram)
   2. Account Login & Status (Username, Role, Status)
   3. Appearance & Theme Mode (Light / Dark / System sync)
   4. Change Password (Current, New, Confirm + min 8 char validation)
   5. Two-Factor Authentication (QR Code, Secret, Backup Recovery Codes)
   6. REST API Integration & Scoped Tokens (Owner/Agent scoped, Client info)
   7. Account Audit Log (Role-scoped security & profile activity)
   ═══════════════════════════════════════════════════════════════════ */

(function (window) {
  'use strict';

  let activeProfileUser = null;

  function getCachedUser() {
    try {
      return JSON.parse(sessionStorage.getItem('admin_user') || localStorage.getItem('admin_user') || '{}');
    } catch (e) {
      return {};
    }
  }

  function syncCachedUser(patch) {
    try {
      const s = sessionStorage.getItem('admin_user');
      if (s) {
        const parsed = JSON.parse(s);
        sessionStorage.setItem('admin_user', JSON.stringify({ ...parsed, ...patch }));
      }
      const l = localStorage.getItem('admin_user');
      if (l) {
        const parsedL = JSON.parse(l);
        localStorage.setItem('admin_user', JSON.stringify({ ...parsedL, ...patch }));
      }
    } catch (e) {}
  }

  function getCurrentThemeChoice(user) {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch (e) {}
    if (user && (user.theme_mode === 'light' || user.theme_mode === 'dark' || user.theme_mode === 'system')) {
      return user.theme_mode;
    }
    if (typeof window.getThemePreference === 'function') {
      return window.getThemePreference();
    }
    return 'system';
  }

  function formatAuditDate(raw) {
    if (!raw) return '—';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

  async function loadUserProfile() {
    try {
      const res = await fetch('/api/user/profile', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.user) {
          activeProfileUser = data.user;
          return data.user;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch profile from server:', e);
    }
    const cached = getCachedUser();
    activeProfileUser = cached;
    return cached;
  }

  async function renderProfileView(containerId = 'page-content', initialTab = 'details') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; min-height: 280px;">
        <div class="spinner"></div>
      </div>
    `;

    const user = await loadUserProfile();
    const is2fa = !!user.two_fa;
    const themeChoice = getCurrentThemeChoice(user);
    if (window.BrandTheme && typeof window.BrandTheme.setUserTheme === 'function') {
      window.BrandTheme.setUserTheme(user.theme_key, user.theme_mode);
    }

    const catalogThemes = (window.BrandTheme && typeof window.BrandTheme.getThemes === 'function')
      ? window.BrandTheme.getThemes()
      : [];
    const activeCatalogKey = (user.theme_key && catalogThemes.some(t => t.key === user.theme_key))
      ? user.theme_key
      : '';

    // Sync user's saved theme_mode on first visit if localStorage has no override
    try {
      if (!localStorage.getItem('theme') && (user.theme_mode === 'light' || user.theme_mode === 'dark' || user.theme_mode === 'system')) {
        localStorage.setItem('theme', user.theme_mode);
        if (typeof window.applyThemePreference === 'function') {
          window.applyThemePreference(user.theme_mode);
        }
      }
    } catch (e) {}

    const statusText = String(user.status || 'active').toUpperCase();
    const isStatusActive = statusText === 'ACTIVE';

    container.innerHTML = `
      <div class="zy-pro-header">
        <div>
          <div class="zy-pro-title">Account &amp; Profile</div>
          <div class="zy-pro-subtitle">Manage your personal details, appearance, password, 2FA security, and activity</div>
        </div>
        <span class="zy-pro-pill ${is2fa ? 'is-on' : 'is-off'}">
          <i class="fas ${is2fa ? 'fa-shield-halved' : 'fa-shield'}"></i>
          ${is2fa ? '2FA Protected' : '2FA Off'}
        </span>
      </div>

      <div class="zy-pro-tabs">
        <button type="button" id="tab-btn-details" class="zy-pro-tab active" onclick="window.HumexProfile.switchTab('details')">
          <i class="far fa-user"></i> My Profile
        </button>
        <button type="button" id="tab-btn-api" class="zy-pro-tab" onclick="window.HumexProfile.switchTab('api')">
          <i class="fas fa-key"></i> REST API
        </button>
        <button type="button" id="tab-btn-audit" class="zy-pro-tab" onclick="window.HumexProfile.switchTab('audit')">
          <i class="far fa-file-lines"></i> Audit Log
        </button>
      </div>

      <div id="pro-tab-details" class="zy-pro-shell">

        <!-- CARD 1: PERSONAL DETAILS -->
        <div class="zy-pro-card">
          <div class="zy-pro-card-head">
            <div>
              <div class="zy-pro-card-title">PERSONAL DETAILS</div>
              <div class="zy-pro-card-sub">Keep your contact info up to date for support and payout reconciliation</div>
            </div>
          </div>

          <form id="pro-personal-form" onsubmit="window.HumexProfile.savePersonal(event)">
            <div class="zy-pro-grid-2">
              <div class="zy-pro-field">
                <label class="zy-pro-label" for="pro-fullname">Full name</label>
                <input type="text" id="pro-fullname" class="zy-pro-input" value="${escapeHtml(user.full_name || '')}" placeholder="Your Full Name">
              </div>

              <div class="zy-pro-field">
                <label class="zy-pro-label" for="pro-email">Email</label>
                <input type="email" id="pro-email" class="zy-pro-input" value="${escapeHtml(user.email || '')}" placeholder="name@domain.com">
              </div>
            </div>

            <div class="zy-pro-grid-2">
              <div class="zy-pro-field">
                <label class="zy-pro-label" for="pro-phone">Contact (phone / WhatsApp)</label>
                <input type="text" id="pro-phone" class="zy-pro-input" value="${escapeHtml(user.phone || '')}" placeholder="+92 300 1234567">
                <div class="zy-pro-hint">Used for account notifications and payout support.</div>
              </div>

              <div class="zy-pro-field">
                <label class="zy-pro-label" for="pro-teams">Teams / Telegram</label>
                <input type="text" id="pro-teams" class="zy-pro-input" value="${escapeHtml(user.teams || '')}" placeholder="@username or handle">
              </div>
            </div>

            <button type="submit" id="pro-personal-save-btn" class="zy-pro-btn zy-pro-btn-primary">
              <i class="fas fa-check"></i> Save changes
            </button>
          </form>
        </div>

        <!-- CARD 2: ACCOUNT LOGIN -->
        <div class="zy-pro-card">
          <div class="zy-pro-card-head">
            <div>
              <div class="zy-pro-card-title">ACCOUNT LOGIN</div>
              <div class="zy-pro-card-sub">Your sign-in identity and assigned workspace role</div>
            </div>
            <span class="zy-pro-pill ${isStatusActive ? 'is-on' : 'is-off'}">${escapeHtml(statusText)}</span>
          </div>
          <div class="zy-pro-grid-2">
            <div>
              <label class="zy-pro-label">Username</label>
              <input type="text" class="zy-pro-input" value="${escapeHtml(user.username || '')}" readonly>
              <div class="zy-pro-hint">Username can only be changed by an administrator.</div>
            </div>
            <div>
              <label class="zy-pro-label">Role</label>
              <input type="text" class="zy-pro-input is-role" value="${escapeHtml(user.role || 'User')}" readonly>
            </div>
          </div>
        </div>

        <!-- CARD 3: APPEARANCE & THEME -->
        <div id="pro-theme-card" class="zy-pro-card">
          <div class="zy-pro-card-head">
            <div>
              <div class="zy-pro-card-title">APPEARANCE &amp; THEME</div>
              <div class="zy-pro-card-sub">Choose your Display Mode and select an Owner-approved Portal Theme</div>
            </div>
          </div>

          <div style="font-size:12px; font-weight:700; color:var(--sp-text-secondary); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.4px;">Display Mode</div>
          <div class="zy-pro-theme-grid" style="margin-bottom:20px;">
            <button type="button" id="theme-opt-light" class="zy-pro-theme-opt ${themeChoice === 'light' ? 'active' : ''}" onclick="window.HumexProfile.setThemePreference('light')">
              <span class="zy-pro-theme-ic"><i class="fas fa-sun"></i></span>
              <div>
                <div style="font-size:13px; font-weight:700;">Light</div>
                <div style="font-size:11.5px; color:var(--sp-text-muted);">Crisp white workspace</div>
              </div>
            </button>
            <button type="button" id="theme-opt-dark" class="zy-pro-theme-opt ${themeChoice === 'dark' ? 'active' : ''}" onclick="window.HumexProfile.setThemePreference('dark')">
              <span class="zy-pro-theme-ic"><i class="fas fa-moon"></i></span>
              <div>
                <div style="font-size:13px; font-weight:700;">Dark</div>
                <div style="font-size:11.5px; color:var(--sp-text-muted);">Low-glare slate surface</div>
              </div>
            </button>
            <button type="button" id="theme-opt-system" class="zy-pro-theme-opt ${themeChoice === 'system' ? 'active' : ''}" onclick="window.HumexProfile.setThemePreference('system')">
              <span class="zy-pro-theme-ic"><i class="fas fa-desktop"></i></span>
              <div>
                <div style="font-size:13px; font-weight:700;">System</div>
                <div style="font-size:11.5px; color:var(--sp-text-muted);">Matches device setting</div>
              </div>
            </button>
          </div>

          <div style="border-top:1px solid var(--sp-border, #e2e8f0); padding-top:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:10px;">
              <div>
                <div style="font-size:12px; font-weight:700; color:var(--sp-text-secondary); text-transform:uppercase; letter-spacing:0.4px;">Portal Theme (Owner-Approved)</div>
                <div style="font-size:11.5px; color:var(--sp-text-muted);">Updates your header, sidebar, table headers, and buttons without affecting other users</div>
              </div>
            </div>
            <div class="zy-pro-catalog-grid" id="pro-catalog-grid">
              <button type="button" class="zy-pro-catalog-card ${!activeCatalogKey ? 'active' : ''}" data-theme-key="" onclick="window.HumexProfile.selectPortalTheme('')">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                  <strong style="font-size:13px;">System Default</strong>
                  <span class="zy-pro-theme-badge">${!activeCatalogKey ? 'Active' : 'Owner Default'}</span>
                </div>
                <div style="font-size:11.5px; color:var(--sp-text-muted); text-align:left;">Follow the Owner's active default theme automatically</div>
              </button>
              ${catalogThemes.map(t => `
                <button type="button" class="zy-pro-catalog-card ${activeCatalogKey === t.key ? 'active' : ''}" data-theme-key="${escapeHtml(t.key)}" onclick="window.HumexProfile.selectPortalTheme('${escapeHtml(t.key)}')">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                    <strong style="font-size:13px;">${escapeHtml(t.name)}</strong>
                    ${activeCatalogKey === t.key ? '<span class="zy-pro-theme-badge">Active</span>' : ''}
                  </div>
                  <div class="zy-pro-swatch-strip">
                    <span title="Structure" style="background:${escapeHtml(t.structure_bg)};"></span>
                    <span title="Table Header" style="background:${escapeHtml(t.structure_table_bg)};"></span>
                    <span title="Buttons" style="background:${escapeHtml(t.primary_btn)};"></span>
                    <span title="Export / Warn" style="background:${escapeHtml(t.warning_btn)};"></span>
                  </div>
                  <div style="font-size:11px; color:var(--sp-text-muted); text-align:left;">${escapeHtml(t.description || '')}</div>
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- CARD 4: CHANGE PASSWORD -->
        <div id="pro-pwd-card" class="zy-pro-card">
          <div class="zy-pro-card-head">
            <div>
              <div class="zy-pro-card-title">CHANGE PASSWORD</div>
              <div class="zy-pro-card-sub">Update your login password anytime</div>
            </div>
            <span class="zy-pro-hint" style="margin-top:0;">Minimum 8 characters</span>
          </div>

          <form id="pro-pwd-form" onsubmit="window.HumexProfile.changePassword(event)">
            <div class="zy-pro-field">
              <label class="zy-pro-label" for="pro-curr-pwd">Current password</label>
              <input type="password" id="pro-curr-pwd" class="zy-pro-input" required placeholder="Enter current password" autocomplete="current-password">
            </div>
            <div class="zy-pro-grid-2">
              <div class="zy-pro-field">
                <label class="zy-pro-label" for="pro-new-pwd">New password</label>
                <input type="password" id="pro-new-pwd" class="zy-pro-input" minlength="8" required placeholder="At least 8 characters" autocomplete="new-password">
              </div>
              <div class="zy-pro-field">
                <label class="zy-pro-label" for="pro-conf-pwd">Confirm new password</label>
                <input type="password" id="pro-conf-pwd" class="zy-pro-input" minlength="8" required placeholder="Repeat new password" autocomplete="new-password">
              </div>
            </div>
            <button type="submit" class="zy-pro-btn zy-pro-btn-primary">
              <i class="fas fa-lock"></i> Update password
            </button>
          </form>
        </div>

        <!-- CARD 5: TWO-FACTOR AUTHENTICATION (2FA) -->
        <div id="pro-2fa-card" class="zy-pro-card">
          <div class="zy-pro-card-head">
            <div>
              <div class="zy-pro-card-title">TWO-FACTOR AUTHENTICATION</div>
              <div class="zy-pro-card-sub">Protect logins with TOTP authenticator verification</div>
            </div>
            <span id="2fa-status-pill" class="zy-pro-pill ${is2fa ? 'is-on' : 'is-off'}">
              ${is2fa ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          <p style="font-size:13px; color:var(--sp-text-secondary); margin-top:0; margin-bottom:16px; line-height:1.5;">
            Use an authenticator app (Google Authenticator, 1Password, Authy) to generate a 6-digit verification code on every login.
          </p>

          ${is2fa ? `
            <!-- DISABLE 2FA SECTION -->
            <div id="2fa-disable-wrap" style="max-width:440px;">
              ${user.two_fa_backup_count ? `
                <div class="zy-pro-notice" style="margin-bottom:14px;">
                  <i class="fas fa-key" style="color:var(--brand-primary); margin-right:6px;"></i>
                  <strong>${Number(user.two_fa_backup_count)}</strong> recovery backup code(s) currently active on your account.
                </div>
              ` : ''}
              <div class="zy-pro-field">
                <label class="zy-pro-label" for="2fa-dis-pwd">Account Password</label>
                <input type="password" id="2fa-dis-pwd" class="zy-pro-input" placeholder="Enter password to confirm">
              </div>
              <div class="zy-pro-field">
                <label class="zy-pro-label" for="2fa-dis-code">Current 2FA or Backup Code</label>
                <input type="text" id="2fa-dis-code" class="zy-pro-input is-mono" placeholder="6-digit code or BK-XXXX-XXXX" maxlength="20" style="font-weight:700; letter-spacing:1.5px;">
              </div>
              <div style="font-size:12px; color:#ef4444; margin-bottom:12px;">Disabling 2FA reduces account security.</div>
              <button type="button" onclick="window.HumexProfile.disable2FA()" class="zy-pro-btn zy-pro-btn-danger">
                Disable 2FA
              </button>
            </div>
          ` : `
            <!-- SETUP 2FA SECTION -->
            <div id="2fa-setup-trigger-wrap" style="max-width:440px;">
              <div class="zy-pro-field">
                <label class="zy-pro-label" for="2fa-setup-pwd">Confirm your password to start setup</label>
                <input type="password" id="2fa-setup-pwd" class="zy-pro-input" placeholder="Enter your password">
              </div>
              <button type="button" onclick="window.HumexProfile.start2FASetup()" class="zy-pro-btn zy-pro-btn-outline">
                <i class="fas fa-shield-alt"></i> Set up 2FA
              </button>
            </div>

            <!-- REVEALED 2FA SETUP WIZARD (QR CODE + SECRET + BACKUP CODES) -->
            <div id="2fa-wizard" class="zy-pro-wizard" style="display:none;">
              <div id="2fa-wizard-step1" style="display:flex; flex-direction:column; align-items:center; text-align:center;">
                <div style="font-size:14px; font-weight:700; color:var(--sp-text-primary); margin-bottom:12px;">Scan the QR code with your authenticator app</div>

                <div id="2fa-qr-container" class="zy-pro-qr-box">
                  <img id="2fa-qr-img" src="" alt="2FA QR Code" style="width:180px; height:180px; display:block;">
                </div>

                <div style="font-size:12px; color:var(--sp-text-muted); margin-bottom:6px;">Or enter the secret key manually:</div>
                <div class="zy-pro-secret">
                  <span id="2fa-secret-code">--------</span>
                  <button type="button" class="zy-pro-btn zy-pro-btn-outline" style="height:28px; padding:0 10px; font-size:11.5px;" onclick="window.HumexProfile.copyText(document.getElementById('2fa-secret-code').textContent, 'Secret key copied!')">Copy</button>
                </div>

                <div style="width:100%; max-width:340px; text-align:left;">
                  <label class="zy-pro-label" for="2fa-confirm-code">Enter the current 6-digit code</label>
                  <div style="display:flex; gap:8px;">
                    <input type="text" id="2fa-confirm-code" class="zy-pro-input is-mono" placeholder="000000" maxlength="6"
                      style="flex:1; font-size:16px; font-weight:700; letter-spacing:3px; text-align:center;">
                    <button type="button" onclick="window.HumexProfile.confirmEnable2FA()" class="zy-pro-btn zy-pro-btn-primary">
                      Confirm + Enable
                    </button>
                  </div>
                  <div id="2fa-wizard-err" style="font-size:12px; color:#ef4444; font-weight:600; margin-top:6px; display:none;"></div>
                </div>
              </div>

              <div id="2fa-backup-codes-box" class="zy-pro-backup-box" style="display:none;">
                <div style="font-size:14px; font-weight:700; color:#10b981; margin-bottom:4px;">
                  <i class="fas fa-circle-check"></i> Two-Factor Authentication Enabled!
                </div>
                <div style="font-size:12.5px; color:var(--sp-text-secondary); line-height:1.45;">
                  Save these one-time <strong>Backup Recovery Codes</strong> safely. Each code can be used if you lose access to your authenticator app.
                </div>
                <div id="2fa-backup-codes-list" class="zy-pro-backup-grid"></div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                  <button type="button" class="zy-pro-btn zy-pro-btn-outline" onclick="window.HumexProfile.copyBackupCodes()">
                    <i class="far fa-copy"></i> Copy All Codes
                  </button>
                  <button type="button" class="zy-pro-btn zy-pro-btn-primary" onclick="window.HumexProfile.finish2FASetup()">
                    I have saved my codes
                  </button>
                </div>
              </div>
            </div>
          `}
        </div>

      </div>

      <!-- TAB 2: REST API -->
      <div id="pro-tab-api" class="zy-pro-shell" style="display:none;">
        <div class="zy-pro-card">
          <div class="zy-pro-card-head">
            <div>
              <div class="zy-pro-card-title">REST API INTEGRATION</div>
              <div class="zy-pro-card-sub">Live REST API endpoints and scoped bearer tokens for automated SMS &amp; CDR retrieval</div>
            </div>
          </div>

          <div class="zy-pro-field">
            <label class="zy-pro-label" for="pro-api-endpoint-val">SMS Logs Endpoint (GET)</label>
            <div style="display:flex; gap:8px;">
              <input type="text" id="pro-api-endpoint-val" class="zy-pro-input is-mono" readonly value="${escapeHtml(window.location.origin)}/api/sms" style="flex:1;">
              <button type="button" class="zy-pro-btn zy-pro-btn-outline" onclick="window.HumexProfile.copyText(document.getElementById('pro-api-endpoint-val').value, 'Endpoint copied!')">Copy</button>
            </div>
            <div class="zy-pro-hint">Authenticate requests with header <code>X-API-Token: &lt;token&gt;</code> or <code>Authorization: Bearer &lt;token&gt;</code>. Query stats via <code>/crapi/viewstats</code>.</div>
          </div>

          <div id="pro-api-tokens-wrap">
            <div class="zy-pro-empty">Loading API tokens...</div>
          </div>
        </div>
      </div>

      <!-- TAB 3: AUDIT LOG -->
      <div id="pro-tab-audit" class="zy-pro-shell" style="display:none;">
        <div class="zy-pro-card">
          <div class="zy-pro-card-head">
            <div>
              <div class="zy-pro-card-title">ACCOUNT AUDIT LOG</div>
              <div class="zy-pro-card-sub">Real-time security events, profile updates, and account activity</div>
            </div>
            <button type="button" class="zy-pro-btn zy-pro-btn-outline" style="height:32px; padding:0 12px; font-size:12px;" onclick="window.HumexProfile.loadAuditLogs()">
              <i class="fas fa-rotate-right"></i> Refresh
            </button>
          </div>
          <div id="pro-audit-table-wrap">
            <div class="zy-pro-empty">Loading audit logs...</div>
          </div>
        </div>
      </div>
    `;

    switchProfileTab(initialTab);
  }

  async function setThemePreference(mode) {
    const cleanMode = (mode === 'light' || mode === 'dark' || mode === 'system') ? mode : 'system';
    try {
      localStorage.setItem('theme', cleanMode);
    } catch (e) {}

    if (typeof window.applyThemePreference === 'function') {
      window.applyThemePreference(cleanMode);
    } else {
      const effective = cleanMode === 'system'
        ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : cleanMode;
      document.documentElement.setAttribute('data-theme', effective);
      document.body.classList.remove('dark', 'light');
      document.body.classList.add(effective, 'rmsui');
    }

    ['light', 'dark', 'system'].forEach(opt => {
      const el = document.getElementById(`theme-opt-${opt}`);
      if (el) el.classList.toggle('active', opt === cleanMode);
    });

    syncCachedUser({ theme_mode: cleanMode });

    try {
      await fetch('/api/user/profile/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_mode: cleanMode })
      });
      showToast(`Theme set to ${cleanMode.charAt(0).toUpperCase() + cleanMode.slice(1)}`, 'success');
    } catch (e) {}
  }

  async function selectPortalTheme(themeKey) {
    const cleanKey = themeKey ? String(themeKey).trim() : '';
    try {
      const res = await fetch('/api/user/profile/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_key: cleanKey || 'default' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data?.error || 'Could not update portal theme', 'error');
        return;
      }

      const savedKey = (data.user && data.user.theme_key) ? data.user.theme_key : cleanKey;
      if (window.BrandTheme && typeof window.BrandTheme.setUserTheme === 'function') {
        window.BrandTheme.setUserTheme(savedKey);
      }
      activeProfileUser = { ...(activeProfileUser || {}), theme_key: savedKey };
      syncCachedUser({ theme_key: savedKey });

      document.querySelectorAll('#pro-catalog-grid .zy-pro-catalog-card').forEach(card => {
        const key = card.getAttribute('data-theme-key') || '';
        const isActive = key === savedKey;
        card.classList.toggle('active', isActive);
        const existingBadge = card.querySelector('.zy-pro-theme-badge');
        if (key === '') {
          if (existingBadge) existingBadge.textContent = isActive ? 'Active' : 'Owner Default';
        } else {
          if (isActive && !existingBadge) {
            const headRow = card.querySelector('div');
            if (headRow) {
              const span = document.createElement('span');
              span.className = 'zy-pro-theme-badge';
              span.textContent = 'Active';
              headRow.appendChild(span);
            }
          } else if (!isActive && existingBadge) {
            existingBadge.remove();
          }
        }
      });

      const found = (window.BrandTheme?.getThemes?.() || []).find(t => t.key === savedKey);
      showToast(found ? `Portal theme switched to ${found.name}` : 'Portal theme set to System Default', 'success');
    } catch (e) {
      showToast('Network error updating portal theme', 'error');
    }
  }

  function switchProfileTab(tabName) {
    const details = document.getElementById('pro-tab-details');
    const api = document.getElementById('pro-tab-api');
    const audit = document.getElementById('pro-tab-audit');
    const btnDetails = document.getElementById('tab-btn-details');
    const btnApi = document.getElementById('tab-btn-api');
    const btnAudit = document.getElementById('tab-btn-audit');

    const isApi = tabName === 'api' || tabName === 'api-tokens';
    const isAudit = tabName === 'audit' || tabName === 'audit-logs';

    if (details) details.style.display = (!isApi && !isAudit) ? 'flex' : 'none';
    if (api) api.style.display = isApi ? 'flex' : 'none';
    if (audit) audit.style.display = isAudit ? 'flex' : 'none';

    if (btnDetails) btnDetails.classList.toggle('active', !isApi && !isAudit);
    if (btnApi) btnApi.classList.toggle('active', isApi);
    if (btnAudit) btnAudit.classList.toggle('active', isAudit);

    if (isApi) {
      loadApiTokens();
    } else if (isAudit) {
      loadAuditLogs();
    } else if (tabName === 'security' || tabName === 'password' || tabName === 'profile-security' || tabName === '2fa') {
      const targetId = tabName === '2fa' ? 'pro-2fa-card' : 'pro-pwd-card';
      setTimeout(() => {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('is-highlighted');
          setTimeout(() => el.classList.remove('is-highlighted'), 1800);
        }
      }, 60);
    }
  }

  async function loadApiTokens() {
    const wrap = document.getElementById('pro-api-tokens-wrap');
    if (!wrap) return;

    const user = activeProfileUser || getCachedUser();
    const roleLower = String(user.role || '').toLowerCase();
    const isOwner = roleLower === 'owner' || roleLower === 'admin';
    const isClient = roleLower === 'client';

    if (isClient) {
      wrap.innerHTML = `<div class="zy-pro-notice">
        <i class="fas fa-circle-info" style="color:var(--brand-primary); margin-right:6px;"></i>
        API bearer tokens are provisioned and managed by your Agent or Owner. Contact your Agent if you need automated CDR access credentials.
      </div>`;
      return;
    }

    try {
      const res = await fetch('/api/tokens', { credentials: 'include' });
      if (res.status === 403) {
        wrap.innerHTML = `<div class="zy-pro-notice">
          API tokens are issued and managed by your Agent or Owner via the <b>REST API Keys</b> screen.
        </div>`;
        return;
      }
      if (!res.ok) {
        wrap.innerHTML = `<div class="zy-pro-notice" style="color:#ef4444;">Unable to load API tokens.</div>`;
        return;
      }
      const tokens = await res.json();
      const list = Array.isArray(tokens) ? tokens : (tokens.data || []);

      let agents = [];
      if (isOwner) {
        const agRes = await fetch('/api/agents?limit=200', { credentials: 'include' });
        const agData = agRes.ok ? await agRes.json() : { data: [] };
        agents = Array.isArray(agData) ? agData : (agData.data || []);
      }

      wrap.innerHTML = `
        <form onsubmit="window.HumexProfile.createApiToken(event)" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">
          <input type="text" id="pro-new-tok-name" class="zy-pro-input" placeholder="Token label (e.g. Production Pull)" required style="flex:1; min-width:180px;">
          ${(isOwner && agents.length) ? `
            <select id="pro-new-tok-agent" class="zy-pro-input" style="width:auto; min-width:170px;">
              <option value="">All Chain (Owner)</option>
              ${agents.map(a => `<option value="${Number(a.id)}">${escapeHtml(a.username)}</option>`).join('')}
            </select>
          ` : ''}
          <button type="submit" class="zy-pro-btn zy-pro-btn-primary">
            <i class="fas fa-plus"></i> Create Token
          </button>
        </form>
        <div id="pro-created-token-box" class="zy-pro-backup-box" style="display:none; margin-top:0; margin-bottom:16px;">
          <div style="font-size:12.5px; font-weight:700; color:#10b981; margin-bottom:8px;">Copy your new API token now — it will only be shown once:</div>
          <div style="display:flex; gap:8px;">
            <input type="text" id="pro-created-token-val" class="zy-pro-input is-mono" readonly style="flex:1;">
            <button type="button" class="zy-pro-btn zy-pro-btn-outline" onclick="window.HumexProfile.copyText(document.getElementById('pro-created-token-val').value, 'Token copied!')">Copy</button>
          </div>
        </div>
        ${list.length ? `
          <div class="zy-pro-table-wrap">
            <table class="zy-pro-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Scope</th>
                  <th>Token Preview</th>
                  <th>Calls</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${list.map(t => `
                  <tr>
                    <td style="font-weight:600;">${escapeHtml(t.name || 'API Key')}</td>
                    <td>${escapeHtml(t.agent_username || (isOwner ? 'All Chain' : (user.username || 'Agent')))}</td>
                    <td style="font-family:monospace;">${escapeHtml(t.token_masked || ('••••••••' + (t.token_hint || '')))}</td>
                    <td style="font-variant-numeric:tabular-nums;">${Number(t.calls || 0)}</td>
                    <td style="white-space:nowrap; font-variant-numeric:tabular-nums;">${escapeHtml((t.created || '').slice(0, 10) || '—')}</td>
                    <td>
                      <button type="button" class="zy-pro-btn-revoke" onclick="window.HumexProfile.revokeApiToken(${Number(t.id)})">Revoke</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<div class="zy-pro-empty">No API tokens created yet.</div>`}
      `;
    } catch (err) {
      wrap.innerHTML = `<div class="zy-pro-notice" style="color:#ef4444;">Failed to load API tokens.</div>`;
    }
  }

  async function createApiToken(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('pro-new-tok-name')?.value.trim();
    const agentSel = document.getElementById('pro-new-tok-agent');
    const agent_id = agentSel && agentSel.value ? Number(agentSel.value) : null;
    if (!name) return;
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...(agent_id ? { agent_id } : {}) })
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to create API token.', 'error');
        return;
      }
      await loadApiTokens();
      if (data.token) {
        const box = document.getElementById('pro-created-token-box');
        const val = document.getElementById('pro-created-token-val');
        if (val) val.value = data.token;
        if (box) box.style.display = 'block';
      }
      showToast('API token created!', 'success');
    } catch (err) {
      showToast('Network error creating API token.', 'error');
    }
  }

  async function revokeApiToken(id) {
    try {
      const res = await fetch(`/api/tokens/${Number(id)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to revoke token.', 'error');
        return;
      }
      showToast('API token revoked.', 'info');
      loadApiTokens();
    } catch (err) {
      showToast('Network error revoking API token.', 'error');
    }
  }

  function copyText(text, successMsg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(successMsg || 'Copied!', 'success')).catch(() => {});
    }
  }

  function copyBackupCodes() {
    const items = Array.from(document.querySelectorAll('#2fa-backup-codes-list .zy-pro-backup-code'))
      .map(el => el.textContent.trim())
      .filter(Boolean);
    if (!items.length) return;
    copyText(items.join('\n'), 'Backup recovery codes copied!');
  }

  function finish2FASetup() {
    renderProfileView('page-content', 'details');
  }

  async function loadAuditLogs() {
    const wrap = document.getElementById('pro-audit-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="zy-pro-empty"><div class="spinner" style="margin:0 auto 10px;"></div>Loading audit logs...</div>';
    try {
      const res = await fetch('/api/audit-logs?limit=50', { credentials: 'include' });
      let data = [];
      if (res.ok) {
        const json = await res.json();
        data = Array.isArray(json) ? json : (json.data || json.logs || json.records || []);
      }
      if (!data.length) {
        wrap.innerHTML = '<div class="zy-pro-empty"><i class="far fa-folder-open" style="font-size:24px; display:block; margin-bottom:8px;"></i>No audit logs recorded yet.</div>';
        return;
      }
      const rowsHtml = data.map(item => `
        <tr>
          <td style="white-space:nowrap; font-variant-numeric:tabular-nums; color:var(--sp-text-secondary);">${escapeHtml(formatAuditDate(item.created_at || item.timestamp || item.created))}</td>
          <td style="font-weight:600;">${escapeHtml(item.action || item.event || '—')}</td>
          <td>${escapeHtml(item.actor || item.username || item.user || 'User')}</td>
          <td style="font-family:monospace; color:var(--sp-text-secondary);">${escapeHtml(item.module ? `${item.module} · ${item.ip || item.ip_address || '127.0.0.1'}` : (item.ip || item.ip_address || '—'))}</td>
          <td style="color:var(--sp-text-secondary);">${escapeHtml(item.details || item.note || item.message || '—')}</td>
        </tr>
      `).join('');
      wrap.innerHTML = `
        <div class="zy-pro-table-wrap">
          <table class="zy-pro-table">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Action</th>
                <th>User</th>
                <th>Module / IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      wrap.innerHTML = '<div class="zy-pro-empty" style="color:#ef4444;">Failed to load audit logs.</div>';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  function showToast(msg, type = 'info') {
    if (typeof window.toast === 'function') {
      window.toast(msg, type);
    } else if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    }
  }

  async function savePersonal(e) {
    if (e) e.preventDefault();
    const full_name = document.getElementById('pro-fullname')?.value.trim() || '';
    const email = document.getElementById('pro-email')?.value.trim() || '';
    const phone = document.getElementById('pro-phone')?.value.trim() || '';
    const teams = document.getElementById('pro-teams')?.value.trim() || '';

    if (email && (!email.includes('@') || !email.includes('.'))) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }

    const btn = document.getElementById('pro-personal-save-btn');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch('/api/user/profile/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, email, phone, teams })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const updatedPatch = data.user || { full_name, email, phone, teams };
        activeProfileUser = { ...(activeProfileUser || {}), ...updatedPatch };
        syncCachedUser(updatedPatch);
        showToast('Personal details saved successfully!', 'success');
      } else {
        showToast(data.error || 'Failed to save profile.', 'error');
      }
    } catch (err) {
      showToast('Network error while saving profile.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function changePassword(e) {
    if (e) e.preventDefault();
    const current_password = document.getElementById('pro-curr-pwd')?.value || '';
    const new_password = document.getElementById('pro-new-pwd')?.value || '';
    const conf_password = document.getElementById('pro-conf-pwd')?.value || '';

    if (new_password.length < 8) {
      showToast('New password must be at least 8 characters long.', 'error');
      return;
    }
    if (conf_password !== new_password) {
      showToast('New password and confirmation do not match.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/user/password/change', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password, new_password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Password updated successfully!', 'success');
        document.getElementById('pro-pwd-form')?.reset();
      } else {
        showToast(data.error || 'Failed to update password.', 'error');
      }
    } catch (err) {
      showToast('Network error while updating password.', 'error');
    }
  }

  async function start2FASetup() {
    const pwd = document.getElementById('2fa-setup-pwd')?.value.trim();
    if (!pwd) {
      showToast('Please enter your account password to begin 2FA setup.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/user/2fa/setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const trigger = document.getElementById('2fa-setup-trigger-wrap');
        const wizard = document.getElementById('2fa-wizard');
        const qrImg = document.getElementById('2fa-qr-img');
        const secretCode = document.getElementById('2fa-secret-code');

        if (trigger) trigger.style.display = 'none';
        if (wizard) wizard.style.display = 'block';
        if (qrImg) qrImg.src = data.qr;
        if (secretCode) secretCode.textContent = data.secret;

        const codeInp = document.getElementById('2fa-confirm-code');
        if (codeInp) codeInp.focus();
      } else {
        showToast(data.error || 'Password incorrect.', 'error');
      }
    } catch (err) {
      showToast('Network error while setting up 2FA.', 'error');
    }
  }

  async function confirmEnable2FA() {
    const code = document.getElementById('2fa-confirm-code')?.value.trim();
    const errBox = document.getElementById('2fa-wizard-err');
    if (errBox) errBox.style.display = 'none';
    if (!code || code.length !== 6) {
      if (errBox) {
        errBox.textContent = 'Please enter a valid 6-digit code.';
        errBox.style.display = 'block';
      }
      return;
    }

    try {
      const res = await fetch('/api/user/2fa/enable', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        syncCachedUser({ two_fa: true });
        showToast('Two-Factor Authentication is now enabled!', 'success');
        const codes = Array.isArray(data.backup_codes) ? data.backup_codes : [];
        const step1 = document.getElementById('2fa-wizard-step1');
        const backupBox = document.getElementById('2fa-backup-codes-box');
        const backupList = document.getElementById('2fa-backup-codes-list');
        const pill = document.getElementById('2fa-status-pill');
        if (codes.length && backupBox && backupList) {
          if (step1) step1.style.display = 'none';
          if (pill) {
            pill.textContent = 'Enabled';
            pill.className = 'zy-pro-pill is-on';
          }
          backupList.innerHTML = codes.map(c => `<div class="zy-pro-backup-code">${escapeHtml(c)}</div>`).join('');
          backupBox.style.display = 'block';
        } else {
          renderProfileView('page-content', 'details');
        }
      } else {
        if (errBox) {
          errBox.textContent = data.error || 'Invalid 6-digit code.';
          errBox.style.display = 'block';
        }
      }
    } catch (err) {
      showToast('Network error while enabling 2FA.', 'error');
    }
  }

  async function disable2FA() {
    const pwd = document.getElementById('2fa-dis-pwd')?.value.trim();
    const code = document.getElementById('2fa-dis-code')?.value.trim();
    if (!pwd || !code) {
      showToast('Please enter both password and current 2FA or backup code.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/user/2fa/disable', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd, code })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        syncCachedUser({ two_fa: false });
        showToast('Two-Factor Authentication has been disabled.', 'info');
        renderProfileView('page-content', 'details');
      } else {
        showToast(data.error || 'Invalid password or code.', 'error');
      }
    } catch (err) {
      showToast('Network error while disabling 2FA.', 'error');
    }
  }

  window.HumexProfile = {
    render: renderProfileView,
    switchTab: switchProfileTab,
    setThemePreference,
    selectPortalTheme,
    loadAuditLogs,
    loadApiTokens,
    createApiToken,
    revokeApiToken,
    copyText,
    copyBackupCodes,
    finish2FASetup,
    renderTab: (tab, containerId) => renderProfileView(containerId, tab),
    savePersonal,
    changePassword,
    start2FASetup,
    confirmEnable2FA,
    disable2FA
  };

})(window);
