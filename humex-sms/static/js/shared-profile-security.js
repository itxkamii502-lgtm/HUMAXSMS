/* ═══════════════════════════════════════════════════════════════════
   HUMEX SMS — Self-Service Profile, Theme & Security Engine
   Shared across Owner, Agent & Client portals:
   1. Personal Details (Full name, Email, Phone/WhatsApp, Teams/Telegram)
   2. Account Login & Status (Username, Role, Status)
   3. Appearance & Theme Mode (Light / Dark / System sync)
   4. Change Password (Current, New, Confirm + min 8 char validation)
   5. Two-Factor Authentication (QR Code, Secret, Backup Recovery Codes)
   6. Account Audit Log (Role-scoped security & profile activity)
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
        <button type="button" id="tab-btn-audit" class="zy-pro-tab" onclick="window.HumexProfile.switchTab('audit')">
          <i class="far fa-file-lines"></i> Audit Log
        </button>
      </div>

      <div id="pro-tab-details" class="zy-pro-shell">

        <!-- CARD 0: PROFILE PHOTO (LIVE CHAT DP) -->
        <div class="zy-pro-card zy-pro-ava-card">
          <div class="zy-pro-ava-layout">
            <div class="zy-pro-ava-preview-wrap" onclick="window.HumexProfile.triggerAvatarPick()" title="Click to upload or change profile photo">
              <div class="zy-pro-ava-ring" id="pro-ava-preview">
                ${user.avatar_url
                  ? `<img src="${escapeHtml(user.avatar_url)}" alt="Profile Photo" class="zy-pro-ava-img">`
                  : `<span class="zy-pro-ava-initials">${escapeHtml(String(user.full_name || user.username || 'U').trim().slice(0, 2).toUpperCase())}</span>`}
              </div>
              <span class="zy-pro-ava-cam-badge"><i class="fas fa-camera"></i></span>
            </div>
            <div class="zy-pro-ava-info">
              <div class="zy-pro-card-title">PROFILE PHOTO (LIVE CHAT DP)</div>
              <div class="zy-pro-card-sub">Your profile picture appears automatically in Live Chat. Any photo size is cleanly auto-fitted &amp; cropped like WhatsApp.</div>
              <div class="zy-pro-ava-actions">
                <input type="file" id="pro-ava-file-input" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none;" onchange="window.HumexProfile.handleAvatarFile(this)">
                <button type="button" class="zy-pro-btn zy-pro-btn-primary" onclick="window.HumexProfile.triggerAvatarPick()">
                  <i class="fas fa-camera"></i> ${user.avatar_url ? 'Change Photo' : 'Upload Photo'}
                </button>
                <button type="button" id="pro-ava-remove-btn" class="zy-pro-btn zy-pro-btn-outline-danger" style="display:${user.avatar_url ? 'inline-flex' : 'none'};" onclick="window.HumexProfile.removeAvatar()">
                  <i class="fas fa-trash-can"></i> Remove
                </button>
              </div>
            </div>
          </div>
        </div>

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

      <!-- TAB 2: AUDIT LOG -->
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
    if (typeof window.setManualThemeOverride === 'function') {
      window.setManualThemeOverride(cleanMode === 'system' ? null : cleanMode);
    } else {
      try {
        if (cleanMode === 'light' || cleanMode === 'dark') {
          const now = new Date();
          const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
          localStorage.setItem('theme_manual_override', JSON.stringify({ mode: cleanMode, date: todayStr }));
          localStorage.setItem('theme', cleanMode);
        } else {
          localStorage.removeItem('theme_manual_override');
          localStorage.removeItem('theme');
        }
      } catch (e) {}
    }

    if (typeof window.applyThemePreference === 'function') {
      window.applyThemePreference(cleanMode === 'system' ? undefined : cleanMode);
    } else {
      const h = new Date().getHours();
      const effective = cleanMode === 'system' ? ((h >= 6 && h < 18) ? 'light' : 'dark') : cleanMode;
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
      const label = cleanMode === 'system' ? 'Auto (6 AM Light / 6 PM Dark)' : `${cleanMode.charAt(0).toUpperCase() + cleanMode.slice(1)} (Today — Auto resumes tomorrow)`;
      showToast(`Theme set to ${label}`, 'success');
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
    const audit = document.getElementById('pro-tab-audit');
    const btnDetails = document.getElementById('tab-btn-details');
    const btnAudit = document.getElementById('tab-btn-audit');

    const isAudit = tabName === 'audit' || tabName === 'audit-logs';

    if (details) details.style.display = !isAudit ? 'flex' : 'none';
    if (audit) audit.style.display = isAudit ? 'flex' : 'none';

    if (btnDetails) btnDetails.classList.toggle('active', !isAudit);
    if (btnAudit) btnAudit.classList.toggle('active', isAudit);

    if (isAudit) {
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

  // ── WHATSAPP-STYLE PROFILE PHOTO CROPPER & UPLOAD ───────────────
  function triggerAvatarPick() {
    const inp = document.getElementById('pro-ava-file-input');
    if (inp) {
      inp.value = '';
      inp.click();
    }
  }

  function handleAvatarFile(inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.type || '')) {
      showToast('Please select a JPG, PNG, WEBP, or GIF photo.', 'error');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      showToast('Image is too large. Please choose a photo under 12 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => openAvatarCropperModal(img);
      img.onerror = () => showToast('Could not read that image file.', 'error');
      img.src = String(reader.result || '');
    };
    reader.onerror = () => showToast('Could not read that image file.', 'error');
    reader.readAsDataURL(file);
  }

  function closeAvatarCropperModal() {
    const old = document.getElementById('zy-ava-crop-backdrop');
    if (old) old.remove();
  }

  function openAvatarCropperModal(img) {
    closeAvatarCropperModal();

    const STAGE = 260;
    const natW = img.naturalWidth || img.width || 1;
    const natH = img.naturalHeight || img.height || 1;
    // Base scale covers the 260x260 circle completely (WhatsApp fit)
    const baseScale = Math.max(STAGE / natW, STAGE / natH);
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let originX = 0;
    let originY = 0;

    const backdrop = document.createElement('div');
    backdrop.id = 'zy-ava-crop-backdrop';
    backdrop.className = 'zy-ava-crop-backdrop';
    backdrop.innerHTML = `
      <div class="zy-ava-crop-modal" role="dialog" aria-modal="true" aria-label="Adjust Profile Photo">
        <div class="zy-ava-crop-head">
          <div>
            <div class="zy-ava-crop-title"><i class="fas fa-crop-simple"></i> Adjust Profile Photo</div>
            <div class="zy-ava-crop-sub">Drag to position &amp; zoom — fits cleanly in Live Chat like WhatsApp</div>
          </div>
          <button type="button" class="zy-ava-crop-x" id="zy-ava-crop-close" aria-label="Close"><i class="fas fa-times"></i></button>
        </div>
        <div class="zy-ava-crop-body">
          <div class="zy-ava-crop-stage" id="zy-ava-crop-stage">
            <canvas id="zy-ava-crop-canvas" width="${STAGE}" height="${STAGE}"></canvas>
            <div class="zy-ava-crop-mask" aria-hidden="true"></div>
          </div>
          <div class="zy-ava-crop-zoom-row">
            <i class="fas fa-magnifying-glass-minus"></i>
            <input type="range" id="zy-ava-crop-zoom" min="1" max="3" step="0.02" value="1">
            <i class="fas fa-magnifying-glass-plus"></i>
            <button type="button" class="zy-ava-crop-reset" id="zy-ava-crop-reset" title="Reset Fit">Reset</button>
          </div>
        </div>
        <div class="zy-ava-crop-foot">
          <button type="button" class="zy-pro-btn zy-pro-btn-secondary" id="zy-ava-crop-cancel">Cancel</button>
          <button type="button" class="zy-pro-btn zy-pro-btn-primary" id="zy-ava-crop-save">
            <i class="fas fa-check"></i> Save Profile Photo
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const canvas = document.getElementById('zy-ava-crop-canvas');
    const ctx = canvas.getContext('2d');
    const zoomSlider = document.getElementById('zy-ava-crop-zoom');
    const stage = document.getElementById('zy-ava-crop-stage');

    function clampOffsets() {
      const scale = baseScale * zoom;
      const drawW = natW * scale;
      const drawH = natH * scale;
      const maxX = Math.max(0, (drawW - STAGE) / 2);
      const maxY = Math.max(0, (drawH - STAGE) / 2);
      if (offsetX > maxX) offsetX = maxX;
      if (offsetX < -maxX) offsetX = -maxX;
      if (offsetY > maxY) offsetY = maxY;
      if (offsetY < -maxY) offsetY = -maxY;
    }

    function drawPreview() {
      clampOffsets();
      const scale = baseScale * zoom;
      const drawW = natW * scale;
      const drawH = natH * scale;
      const x = (STAGE - drawW) / 2 + offsetX;
      const y = (STAGE - drawH) / 2 + offsetY;
      ctx.clearRect(0, 0, STAGE, STAGE);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, STAGE, STAGE);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, drawW, drawH);
    }

    drawPreview();

    zoomSlider.addEventListener('input', () => {
      zoom = parseFloat(zoomSlider.value) || 1;
      drawPreview();
    });

    document.getElementById('zy-ava-crop-reset').addEventListener('click', () => {
      zoom = 1;
      offsetX = 0;
      offsetY = 0;
      zoomSlider.value = '1';
      drawPreview();
    });

    stage.addEventListener('pointerdown', (e) => {
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      originX = offsetX;
      originY = offsetY;
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    });
    stage.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      offsetX = originX + (e.clientX - dragStartX);
      offsetY = originY + (e.clientY - dragStartY);
      drawPreview();
    });
    const stopDrag = () => { dragging = false; };
    stage.addEventListener('pointerup', stopDrag);
    stage.addEventListener('pointercancel', stopDrag);

    document.getElementById('zy-ava-crop-close').addEventListener('click', closeAvatarCropperModal);
    document.getElementById('zy-ava-crop-cancel').addEventListener('click', closeAvatarCropperModal);

    document.getElementById('zy-ava-crop-save').addEventListener('click', async () => {
      const saveBtn = document.getElementById('zy-ava-crop-save');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      }
      try {
        // Render crisp 384x384 high-res square DP for WhatsApp-quality sharpness
        const OUT = 384;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = OUT;
        outCanvas.height = OUT;
        const octx = outCanvas.getContext('2d');
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, OUT, OUT);
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';

        const ratio = OUT / STAGE;
        const scale = baseScale * zoom * ratio;
        const drawW = natW * scale;
        const drawH = natH * scale;
        const x = (OUT - drawW) / 2 + offsetX * ratio;
        const y = (OUT - drawH) / 2 + offsetY * ratio;
        octx.drawImage(img, x, y, drawW, drawH);

        const dataUrl = outCanvas.toDataURL('image/jpeg', 0.88);
        const res = await fetch('/api/user/profile/avatar', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          showToast(data.error || 'Failed to save profile photo.', 'error');
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Save Profile Photo';
          }
          return;
        }

        const newUrl = data.avatar_url || '';
        if (activeProfileUser) activeProfileUser.avatar_url = newUrl;
        syncCachedUser({ avatar_url: newUrl });
        updateProfileAvatarDom(newUrl);
        if (window.HumexLiveChat && typeof window.HumexLiveChat.refreshBadge === 'function') {
          window.HumexLiveChat.refreshBadge();
        }
        closeAvatarCropperModal();
        showToast('Profile photo updated for Live Chat!', 'success');
      } catch (err) {
        showToast('Network error while uploading profile photo.', 'error');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fas fa-check"></i> Save Profile Photo';
        }
      }
    });
  }

  function updateProfileAvatarDom(avatarUrl) {
    const ring = document.getElementById('pro-ava-preview');
    const rmBtn = document.getElementById('pro-ava-remove-btn');
    const user = activeProfileUser || getCachedUser();
    if (ring) {
      if (avatarUrl) {
        ring.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="Profile Photo" class="zy-pro-ava-img">`;
      } else {
        const init = String((user && (user.full_name || user.username)) || 'U').trim().slice(0, 2).toUpperCase();
        ring.innerHTML = `<span class="zy-pro-ava-initials">${escapeHtml(init)}</span>`;
      }
    }
    if (rmBtn) rmBtn.style.display = avatarUrl ? 'inline-flex' : 'none';
  }

  async function removeAvatar() {
    const rmBtn = document.getElementById('pro-ava-remove-btn');
    if (rmBtn) rmBtn.disabled = true;
    try {
      const res = await fetch('/api/user/profile/avatar', {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (activeProfileUser) activeProfileUser.avatar_url = '';
        syncCachedUser({ avatar_url: '' });
        updateProfileAvatarDom('');
        if (window.HumexLiveChat && typeof window.HumexLiveChat.refreshBadge === 'function') {
          window.HumexLiveChat.refreshBadge();
        }
        showToast('Profile photo removed.', 'info');
      } else {
        showToast(data.error || 'Failed to remove profile photo.', 'error');
      }
    } catch (err) {
      showToast('Network error while removing profile photo.', 'error');
    } finally {
      if (rmBtn) rmBtn.disabled = false;
    }
  }

  window.HumexProfile = {
    render: renderProfileView,
    switchTab: switchProfileTab,
    setThemePreference,
    selectPortalTheme,
    loadAuditLogs,
    copyText,
    copyBackupCodes,
    finish2FASetup,
    renderTab: (tab, containerId) => renderProfileView(containerId, tab),
    savePersonal,
    changePassword,
    start2FASetup,
    confirmEnable2FA,
    disable2FA,
    triggerAvatarPick,
    handleAvatarFile,
    removeAvatar
  };

})(window);
