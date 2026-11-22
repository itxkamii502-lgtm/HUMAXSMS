// ═══════════════════════════════════════════════════════════════
//  FEATURES — Services, CLI, Number Transfer (Production Ready)
// ═══════════════════════════════════════════════════════════════

// ─── SERVICES MANAGER ────────────────────────────────────────────

async function searchServices() {
  const q = document.getElementById('svc-search')?.value || '';
  const status = document.getElementById('svc-status-filter')?.value || '';

  try {
    const data = await apiFetch(`/api/services?search=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`);
    const container = document.querySelector('.card > div:last-child');
    if (container) {
      container.innerHTML = (data || []).map(s => `
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
      `).join('') || `<div class="empty-state" style="grid-column:1/-1;padding:40px;">
        <i class="fas fa-search" style="font-size:40px;color:var(--text-muted);"></i>
        <p style="margin-top:12px;">No services found matching "${escapeHtml(q)}"</p>
      </div>`;
      toast(`Found ${data?.length || 0} results`, 'info');
    }
  } catch (err) {
    console.error('Search services error:', err);
    toast('Search failed', 'error');
  }
}

function filterServices() {
  searchServices();
}

function resetServiceFilters() {
  const searchInput = document.getElementById('svc-search');
  const statusSelect = document.getElementById('svc-status-filter');
  if (searchInput) searchInput.value = '';
  if (statusSelect) statusSelect.value = '';
  renderServicesManager();
  toast('Filters reset', 'info');
}

function exportServices() {
  toast('Exporting services...', 'info');
  zyDownloadFile('/api/services/export', 'services.csv');
}

async function openEditServiceModal(id) {
  try {
    const data = await apiFetch('/api/services');
    const s = (data || []).find(x => Number(x.id) === Number(id));
    if (!s) {
      toast('Service not found', 'error');
      return;
    }

    openModal(`Edit Service — ${escapeHtml(s.name)}`, `
      <form id="edit-service-form" onsubmit="saveService(event, ${Number(id)})">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Service Name <span class="text-danger">*</span></label>
            <input id="esvc-name" value="${escapeHtml(s.name || '')}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Icon Class</label>
            <input id="esvc-icon" value="${escapeHtml(s.icon || 'fas fa-mobile-screen')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Color</label>
            <input id="esvc-color" type="color" value="${escapeHtml(s.color || '#334155')}">
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select id="esvc-active">
              <option value="true" ${s.active !== false ? 'selected' : ''}>Active</option>
              <option value="false" ${s.active === false ? 'selected' : ''}>Inactive</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <input id="esvc-desc" value="${escapeHtml(s.description || '')}">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="esvc-submit-btn">
            <i class="fas fa-save"></i> Save
          </button>
        </div>
      </form>
    `);
  } catch (err) {
    console.error('Edit service error:', err);
    toast('Failed to load service details', 'error');
  }
}

async function saveService(event, id) {
  event.preventDefault();

  try {
    const name = document.getElementById('esvc-name').value.trim();

    if (!name) {
      toast('Service name is required', 'error');
      return;
    }

    const btn = document.getElementById('esvc-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Saving...';
    }

    const payload = {
      name,
      icon: document.getElementById('esvc-icon').value.trim() || 'fas fa-mobile-screen',
      color: document.getElementById('esvc-color').value || '#334155',
      description: document.getElementById('esvc-desc').value.trim() || '',
      active: document.getElementById('esvc-active').value === 'true'
    };

    const result = await apiFetch(`/api/services/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    if (result && result.id) {
      closeModal();
      toast(`Service "${name}" updated successfully`, 'success');
      renderServicesManager();
    } else {
      toast(result?.error || 'Failed to update service', 'error');
    }
  } catch (err) {
    console.error('Save service error:', err);
    toast('Error: ' + err.message, 'error');
  } finally {
    const btn = document.getElementById('esvc-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> Save';
    }
  }
}

async function deleteService(id) {
  if (!(await zyConfirm('Delete this service?', { title: 'Delete Service', confirmLabel: 'Delete', danger: true }))) return;

  try {
    const result = await apiFetch(`/api/services/${id}`, {
      method: 'DELETE'
    });

    if (result && result.success) {
      toast('Service deleted', 'warning');
      renderServicesManager();
    } else {
      toast(result?.error || 'Failed to delete service', 'error');
    }
  } catch (err) {
    console.error('Delete service error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

// ─── CLI MANAGER HELPERS ──────────────────────────────────────────

async function searchCli() {
  const q = document.getElementById('cli-search')?.value.trim() || '';
  const status = document.getElementById('cli-status-filter')?.value || '';

  try {
    const params = new URLSearchParams();
    if (q) params.append('search', q);
    if (status) params.append('status', status);

    const data = await apiFetch(`/api/cli-routes?${params.toString()}`) || [];
    const rows = Array.isArray(data) ? data : [];
    const wrap = document.querySelector('#tbl-cli-manager')?.closest('.table-wrap') || document.querySelector('.card .table-wrap');
    if (wrap) {
      wrap.outerHTML = buildTable(
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
      );
    }
  } catch (err) {
    console.error('Search CLI error:', err);
    toast('Search failed', 'error');
  }
}

function filterCli() {
  searchCli();
}

function resetCliFilters() {
  const searchInput = document.getElementById('cli-search');
  const statusSelect = document.getElementById('cli-status-filter');
  if (searchInput) searchInput.value = '';
  if (statusSelect) statusSelect.value = '';
  renderCliManager();
  toast('Filters reset', 'info');
}

function exportCli() {
  toast('Exporting CLI routes...', 'info');
  zyDownloadFile('/api/cli-routes/export', 'cli-routes.csv');
}

// ─── NUMBER TRANSFER HELPERS ─────────────────────────────────────



// ─── NUMBER TRANSFER HISTORY ──────────────────────────────────────

async function viewTransferDetail(transferId) {
  try {
    const data = await apiFetch(`/api/number-transfers/${transferId}`);
    if (!data) {
      toast('Transfer not found', 'error');
      return;
    }

    const t = data;
    openModal(`Transfer Details #${t.id}`, `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        ${[
          ['ID', t.id || '—'],
          ['From', `${t.from_username || '—'} (${t.from_role || '—'})`],
          ['To', `${t.to_username || '—'} (${t.to_role || '—'})`],
          ['Count', t.count || 0],
          ['Service', t.service || '—'],
          ['Notes', t.notes || '—'],
          ['Status', statusBadge(t.status)],
          ['Timestamp', fmtDate(t.timestamp)]
        ].map(([k, v]) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border);">
            <div class="text-muted fs-12">${k}</div>
            <div class="fw-600">${v}</div>
          </div>
        `).join('')}
      </div>
      <div class="form-actions" style="margin-top:16px;">
        <button class="btn btn-outline" onclick="closeModal()">Close</button>
      </div>
    `);
  } catch (err) {
    console.error('View transfer detail error:', err);
    toast('Failed to load transfer details', 'error');
  }
}

function exportTransferLog() {
  try {
    toast('Exporting transfer history...', 'info');
    zyDownloadFile('/api/number-transfers/export', 'number-transfers.csv');
  } catch (err) {
    console.error('Export error:', err);
    toast('Failed to export', 'error');
  }
}

function downloadTransferLog() {
  exportTransferLog();
}

// ─── NUMBERS: Download helper ─────────────────────────────────────
function downloadNumbersCSV(params = '') {
  try {
    const url = `/api/numbers/download${params ? '?' + params : ''}`;
    zyDownloadFile(url, 'numbers.csv');
    toast('Downloading numbers CSV...', 'info');
  } catch (err) {
    console.error('Download error:', err);
    toast('Failed to download', 'error');
  }
}

// ─── LEGACY FUNCTIONS ────────────────────────────────────────────
function pgn(cur, total, pages, fn) {
  return pagination(cur, total, 20, fn);
}
