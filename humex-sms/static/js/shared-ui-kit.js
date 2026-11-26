/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — Owner, Agent & Client Panel Inner Pages Kit
   Same layout as the reference panel: breadcrumb > intro line >
   panel > DataTable toolbar (Search / Show Records / exports) >
   table > "Showing x to y of z entries" + pager.
   Loaded AFTER panel shell
   ═══════════════════════════════════════════════════════════════ */

function zyPrintHtml(htmlContent) {
  const html = String(htmlContent || '');
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (_) {}
    setTimeout(() => { try { frame.remove(); } catch (_) {} }, 1500);
  }, 150);
}
window.zyPrintHtml = zyPrintHtml;

function zyDownloadFile(url, filename) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
window.zyDownloadFile = zyDownloadFile;

/* ── breadcrumb with sub levels ─────────────────────────────── */
function zyCrumb(parts) {
  const host = document.querySelector('.zy-crumb-left') || document.querySelector('.zy-crumb');
  if (!host) return;
  const arr = Array.isArray(parts) ? parts : [];
  const dashHref = (typeof window.zyPageUrl === 'function') ? window.zyPageUrl('dashboard') : '#';
  host.innerHTML = `<a href="${zyEsc(dashHref)}" data-page="dashboard" onclick="return window.zyNavClick ? window.zyNavClick(event, 'dashboard') : (event.preventDefault(), loadPage('dashboard'), false)">Home</a>` +
    arr.map((p, i) => `<span class="zy-sep">&raquo;</span>` +
      (i < arr.length - 1
        ? `<a>${zyEsc(p)}</a>`
        : `<span id="breadcrumb" class="zy-breadcrumb-current" data-breadcrumb="1">${zyEsc(p)}</span>`)).join('');
  const topBc = document.getElementById('breadcrumb');
  if (topBc && !host.contains(topBc) && arr.length) topBc.textContent = String(arr[arr.length - 1] || '');
}

/* ── DataTable with full toolbar ────────────────────────────── */
const ZYT2 = {};
if (typeof window !== 'undefined') window.ZYT2 = ZYT2;
function zyDT2(id, cfg) {
  let existingHidden = {};
  if (ZYT2[id] && ZYT2[id].cols && cfg.cols && ZYT2[id].cols.join(',') === cfg.cols.join(',')) {
    existingHidden = ZYT2[id].hiddenCols || {};
  }
  ZYT2[id] = Object.assign({
    cols: [], rows: [], page: 1, perPage: 25, sort: 0, dir: 1,
    search: '', check: false, ids: [], total: null
  }, cfg);
  ZYT2[id].hiddenCols = Object.assign({}, existingHidden, cfg.hiddenCols || {});
  return `<div class="zy-dt2" id="${id}"></div>`;
}
function zyCell2(c) { return (c && typeof c === 'object') ? c : { v: c, h: c }; }
function zyColClass(colName) {
  if (!colName || typeof colName !== 'string') return '';
  const cn = colName.trim().toLowerCase();
  if (
    cn.includes('payout') || cn.includes('profit') || cn.includes('rate') ||
    cn.includes('cost') || cn.includes('revenue') || cn.includes('balance') ||
    cn.includes('price') || cn.includes('amount') ||
    cn === 'sms count' || cn === 'total sms' || cn === 'calls' || cn === 'count'
  ) {
    return 'col-money text-right';
  }
  if (cn === 'date' || cn === 'date time' || cn === 'datetime' || cn === 'timestamp' || cn === 'time') {
    return 'col-date col-fit text-center';
  }
  if (cn === 'number' || cn === 'phone' || cn === 'cli' || cn === 'ip' || cn === 'ip address' || cn.includes('phone') || cn.includes('number')) {
    return 'col-mono';
  }
  if (cn === 'status' || cn === 'cause' || cn === 'state' || cn === 'type' || cn === 'provider') {
    return 'col-status text-center';
  }
  if (cn === 'client' || cn === 'client username' || cn === 'username' || cn === 'agent') {
    return 'col-client text-left';
  }
  if (cn === 'sms' || cn === 'message' || cn === 'sms message' || cn === 'range') {
    return 'text-left';
  }
  if (cn === 'currency' || cn === 'curr.' || cn === 'curr') {
    return 'col-curr text-center';
  }
  return '';
}
function zy2Data(t) {
  let rows = t.rows;
  if (t.search) {
    const q = t.search.toLowerCase();
    rows = rows.filter(r => r.some(c => String(zyCell2(c).v ?? '').toLowerCase().includes(q)));
  }
  return rows.slice().sort((a, b) => {
    const x = zyCell2(a[t.sort]).v, y = zyCell2(b[t.sort]).v;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * t.dir;
    return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }) * t.dir;
  });
}
function zySortIc(on, dir) {
  const isAsc = on && dir === 1;
  const isDesc = on && dir === -1;
  const stateCls = on ? (isAsc ? 'zy-sort-asc sorted' : 'zy-sort-desc sorted') : 'zy-sort-neutral';
  const title = on ? (isAsc ? 'Sorted ascending' : 'Sorted descending') : 'Click to sort column';
  return `<span class="zy-sort ${stateCls}" title="${title}" aria-hidden="true">` +
    `<svg class="zy-sort-svg" width="9" height="13" viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg">` +
      `<path class="zy-sort-arr zy-sort-arr-up" d="M5 2L1.8 6.2H8.2L5 2Z" fill="currentColor"/>` +
      `<path class="zy-sort-arr zy-sort-arr-down" d="M5 12L8.2 7.8H1.8L5 12Z" fill="currentColor"/>` +
    `</svg>` +
  `</span>`;
}
const ZY_ICON_BASE = window.ZY_ICON_BASE || '/static/img/icons/';
function zyImg(n, cls) {
  const src = (window.ZY_ICONS_DATA && window.ZY_ICONS_DATA[n]) || (ZY_ICON_BASE + n + '.png');
  return `<img class="${cls || ''}" src="${src}" alt="">`;
}
function zy2Render(id) {
  const t = ZYT2[id], host = document.getElementById(id);
  if (!t || !host) return;
  t.hiddenCols = t.hiddenCols || {};
  const isColVisible = (i) => !t.hiddenCols[i];
  const visibleColsCount = t.cols.filter((_, i) => isColVisible(i)).length;

  let slice = [];
  let total = 0;
  let pages = 1;
  let page = 1;
  let from = 0;
  let to = 0;

  if (t.serverMode) {
    total = t.totalRecords != null ? t.totalRecords : t.rows.length;
    pages = t.totalPages || Math.max(1, Math.ceil(total / (t.perPage || 25)));
    page = t.page = Math.max(1, Math.min(t.page || 1, pages));
    from = (total > 0 && t.rows.length > 0) ? (page - 1) * (t.perPage || 25) + 1 : 0;
    to = from > 0 ? Math.min(total, from + t.rows.length - 1) : 0;
    if (t.sort != null && t.sort >= 0 && Array.isArray(t.rows)) {
      slice = [...t.rows].sort((a, b) => {
        const va = zyCell2(a[t.sort]).v;
        const vb = zyCell2(b[t.sort]).v;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * (t.dir || 1);
        return String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true }) * (t.dir || 1);
      });
    } else {
      slice = t.rows;
    }
  } else {
    const rows = zy2Data(t);
    total = rows.length;
    pages = Math.max(1, Math.ceil(total / t.perPage));
    page = t.page = Math.min(t.page, pages);
    from = total ? (page - 1) * t.perPage + 1 : 0;
    to = Math.min(total, page * t.perPage);
    slice = rows.slice((page - 1) * t.perPage, page * t.perPage);
  }

  const nums = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) nums.push(i);
  } else {
    nums.push(1);
    if (page > 3) nums.push('...');
    const start = Math.max(2, page - 1);
    const end = Math.min(pages - 1, page + 1);
    for (let i = start; i <= end; i++) {
      if (!nums.includes(i)) nums.push(i);
    }
    if (page < pages - 2) nums.push('...');
    if (!nums.includes(pages)) nums.push(pages);
  }

  const pagerButtons = nums.map(n => {
    if (n === '...') return `<span class="zy-pager-ellipsis" style="display:inline-flex;align-items:center;padding:0 6px;color:#94a3b8;font-size:12px;">…</span>`;
    return `<button class="${n === page ? 'on active' : ''}" onclick="zy2Page('${id}',${n})">${n}</button>`;
  }).join('');

  const head =
    (t.check ? `<th class="zy-cbcol"><input type="checkbox" onclick="zy2All('${id}',this)">${zyImg('ui_sort_asc','zy-cbsort')}</th>` : '') +
    t.cols.map((c, i) => {
      if (!isColVisible(i)) return '';
      const cName = typeof c === 'string' ? c : (c && (c.title || c.name || c.label || '')) || '';
      const cls = `${i === t.sort ? 'sorted' : ''} ${zyColClass(cName)}`.trim();
      return `<th class="${cls}" onclick="zy2Sort('${id}',${i})">${c}${zySortIc(i === t.sort, t.dir)}</th>`;
    }).join('');

  const body = slice.length ? slice.map((r, ri) => `<tr>` +
      (t.check ? `<td class="zy-cbcol"><input type="checkbox" class="zy-cb-${id}" value="${r.__id ?? ri}"></td>` : '') +
      r.map((c, i) => {
        if (!isColVisible(i)) return '';
        const cName = typeof t.cols[i] === 'string' ? t.cols[i] : (t.cols[i] && (t.cols[i].title || t.cols[i].name || t.cols[i].label || '')) || '';
        const cls = `${i === t.sort ? 'sorted' : ''} ${zyColClass(cName)}`.trim();
        return `<td class="${cls}">${zyCell2(c).h ?? ''}</td>`;
      }).join('') +
      `</tr>`).join('')
    : `<tr><td class="zy-empty zy-empty-cell" colspan="${visibleColsCount + (t.check ? 1 : 0)}">${
        t.search
          ? (typeof zyEmptyState === 'function'
              ? zyEmptyState({ icon: 'fa-magnifying-glass', title: 'No matching records', desc: `No entries match "${t.search.replace(/"/g, '&quot;')}".`, actionLabel: 'Clear Search', actionOnClick: `zy2Search('${id}','')` })
              : 'No matching records')
          : (typeof zyEmptyState === 'function'
              ? zyEmptyState({ icon: 'fa-inbox', title: 'No data available', desc: 'There are no records in this view.' })
              : 'No data available in table')
      }</td></tr>`;

  let footHtml = '';
  if (t.footRow) {
    const tdMatches = t.footRow.match(/<td[\s\S]*?<\/td>/gi) || [];
    const neededCols = visibleColsCount + (t.check ? 1 : 0);
    const textOf = (html) => String(html || '').replace(/<[^>]+>/g, '').trim();

    if (tdMatches.length === t.cols.length) {
      const firstVisColIdx = t.cols.findIndex((_, idx) => isColVisible(idx));
      let visibleTds = [];
      t.cols.forEach((col, i) => {
        if (!isColVisible(i)) return;
        let td = tdMatches[i];
        if (!isColVisible(0) && i === firstVisColIdx && textOf(tdMatches[0]).length > 0 && textOf(td).length === 0) {
          td = tdMatches[0];
        }
        const cName = typeof col === 'string' ? col : (col && (col.title || col.name || col.label || '')) || '';
        const alignCls = zyColClass(cName);
        if (alignCls) {
          td = td.replace(/^<td(?:\s+class="([^"]*)")?/i, (m, existing) => {
            const merged = `${existing || ''} ${alignCls}`.trim();
            return `<td class="${merged}"`;
          });
        }
        visibleTds.push(td);
      });
      if (t.check) visibleTds.unshift('<td class="zy-cbcol"></td>');
      footHtml = `<tfoot><tr>${visibleTds.join('')}</tr></tfoot>`;
    } else if (tdMatches.length > 0) {
      const isCellEmpty = (c) => textOf(c).length === 0;
      const firstEmpty = tdMatches.findIndex(isCellEmpty);
      let lastEmpty = -1;
      for (let j = tdMatches.length - 1; j >= 0; j--) {
        if (isCellEmpty(tdMatches[j])) { lastEmpty = j; break; }
      }
      const headCells = firstEmpty > -1 ? tdMatches.slice(0, firstEmpty) : (tdMatches.length ? [tdMatches[0]] : []);
      const tailCells = (lastEmpty > -1 && lastEmpty < tdMatches.length - 1) ? tdMatches.slice(lastEmpty + 1) : [];

      let dataCells = [];
      const spacersNeeded = Math.max(0, visibleColsCount - (headCells.length + tailCells.length));

      if (headCells.length + tailCells.length <= visibleColsCount) {
        dataCells = [...headCells, ...Array(spacersNeeded).fill('<td></td>'), ...tailCells];
      } else {
        const availForTail = Math.max(0, visibleColsCount - headCells.length);
        if (availForTail > 0) {
          dataCells = [...headCells, ...tailCells.slice(tailCells.length - availForTail)];
        } else {
          dataCells = headCells.slice(0, visibleColsCount);
        }
      }

      while (dataCells.length < visibleColsCount) dataCells.push('<td></td>');
      if (dataCells.length > visibleColsCount) dataCells = dataCells.slice(0, visibleColsCount);

      if (t.check) dataCells.unshift('<td class="zy-cbcol"></td>');
      footHtml = `<tfoot><tr>${dataCells.join('')}</tr></tfoot>`;
    } else {
      footHtml = `<tfoot><tr>${t.footRow}</tr></tfoot>`;
    }
  }

  const hideInternalControls = !!(t.noTopBar || t.hideToolbar || id === 'dt-cdr');

  host.innerHTML = `
    ${!hideInternalControls ? `
    <div class="zy-dt2-top">
      <div class="zy-dt2-right">
        <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zy2Cols('${id}', this)"><i class="fas fa-columns"></i> Columns</button>
        <div class="zy-show">
          <div class="zy-show-lbl">Show Records</div>
          <select onchange="zy2Size('${id}',this.value)">
            ${[10, 25, 50, 100, 500, 1000, 2000, 5000, 10000].map(n => `<option ${n === t.perPage ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>` : ''}
    <div class="zy-dt-wrap apx-table-scroll"><table class="zy-dt zy-dt2-table apx-table">
      <thead><tr>${head}</tr></thead><tbody>${body}</tbody>
      ${footHtml}
    </table></div>
    <div class="zy-dt2-foot">
      <div class="zy-info">Showing ${from ? from.toLocaleString() : 0} to ${to ? to.toLocaleString() : 0} of ${total.toLocaleString()} entries</div>
      <div class="zy-pager">
        <button ${page <= 1 ? 'disabled' : ''} onclick="zy2Page('${id}',1)" title="First Page">«</button>
        <button ${page <= 1 ? 'disabled' : ''} onclick="zy2Page('${id}',${page - 1})" title="Previous Page">‹</button>
        ${pagerButtons}
        <button ${page >= pages ? 'disabled' : ''} onclick="zy2Page('${id}',${page + 1})" title="Next Page">›</button>
        <button ${page >= pages ? 'disabled' : ''} onclick="zy2Page('${id}',${pages})" title="Last Page">»</button>
      </div>
    </div>`;
}
function zy2Sort(id, i) {
  const t = ZYT2[id];
  if (!t) return;
  if (t.sort === i) t.dir = -t.dir; else { t.sort = i; t.dir = 1; }
  t.page = 1;
  zy2Render(id);
}
function zy2Page(id, p) {
  const t = ZYT2[id];
  if (!t) return;
  const targetPage = Math.max(1, p);
  if (t.serverMode && typeof t.onPageChange === 'function') {
    t.page = targetPage;
    t.onPageChange(targetPage);
    return;
  }
  t.page = targetPage;
  zy2Render(id);
}
function zy2Size(id, v) {
  const t = ZYT2[id];
  if (!t) return;
  const newSize = parseInt(v, 10) || 25;
  t.perPage = newSize;
  t.page = 1;
  if (t.serverMode && typeof t.onSizeChange === 'function') {
    t.onSizeChange(newSize);
    return;
  }
  zy2Render(id);
}
function zy2Search(id, v) { const t = ZYT2[id]; if (!t) return; t.search = v; t.page = 1; zy2Render(id); const el = document.querySelector(`#${id} .zy-search input`); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }
function zy2All(id, el) {
  document.querySelectorAll(`.zy-cb-${id}`).forEach(c => c.checked = el.checked);
  if (typeof window.zySyncSelectionBar === 'function') window.zySyncSelectionBar(id);
}
function zy2Checked(id) { return Array.from(document.querySelectorAll(`.zy-cb-${id}`)).filter(c => c.checked).map(c => c.value); }

if (typeof document !== 'undefined') {
  document.addEventListener('change', e => {
    if (e.target && e.target.type === 'checkbox') {
      const cls = Array.from(e.target.classList || []).find(c => c.startsWith('zy-cb-'));
      if (cls && typeof window.zySyncSelectionBar === 'function') {
        window.zySyncSelectionBar(cls.replace('zy-cb-', ''));
      }
    }
  });
}

function zy2Cols(id, anchorEl) {
  let t = ZYT2[id];
  // Auto-resolve aliases if not directly matched
  if (!t) {
    if (id === 'dt-cdr') t = ZYT2['dt-reports'] || ZYT2['dt-my-sms'] || ZYT2['dt-testcdr'] || ZYT2['dt-stats'];
    else if (id === 'dt-reports') t = ZYT2['dt-cdr'];
    else if (id === 'dt-my-sms') t = ZYT2['dt-cdr'] || ZYT2['dt-reports'];
    else if (id === 'dt-testnums') t = ZYT2['dt-testnums'];
    else if (id === 'dt-testlog') t = ZYT2['dt-testlog'];
  }

  // If table is a standard HTML table in DOM (not in ZYT2)
  if (!t) {
    let table = document.getElementById(id) || document.querySelector('#' + id);
    if (!table && anchorEl) {
      table = anchorEl.closest('.card, .zy-panel, .panel-box, .table-wrap, .zy-dt-wrap')?.querySelector('table') ||
              document.querySelector(`table[data-table-id="${id}"]`) ||
              anchorEl.parentElement?.parentElement?.querySelector('table') ||
              anchorEl.parentElement?.parentElement?.nextElementSibling?.querySelector('table');
    }
    if (!table) table = document.querySelector('table');
    if (table) {
      zyHtmlTableCols(table, id, anchorEl);
      return;
    }
    return;
  }

  t.hiddenCols = t.hiddenCols || {};

  const existing = document.getElementById('zy-cols-popover');
  if (existing) {
    const wasSame = existing._targetId === id;
    existing.remove();
    if (wasSame) return;
  }

  const btn = anchorEl || (typeof event !== 'undefined' && event?.currentTarget) || document.querySelector(`#${id} .zy-cols`) || document.getElementById(id);
  const isDark = document.body.classList.contains('dark') || document.documentElement.getAttribute('data-theme') === 'dark';
  const popBg = isDark ? '#1e293b' : '#ffffff';
  const popBorder = isDark ? '#334155' : '#cbd5e1';
  const popText = isDark ? '#f8fafc' : '#1e293b';
  const popMuted = isDark ? '#94a3b8' : '#64748b';
  const hoverBg = isDark ? '#334155' : '#f1f5f9';

  const pop = document.createElement('div');
  pop.id = 'zy-cols-popover';
  pop._targetId = id;
  pop.style.cssText = `position:absolute;z-index:99999;background:${popBg};border:1px solid ${popBorder};border-radius:8px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.25),0 8px 10px -6px rgba(0,0,0,0.15);width:230px;padding:10px 12px;font-family:inherit;font-size:13px;color:${popText};`;

  if (btn && btn.getBoundingClientRect) {
    const rect = btn.getBoundingClientRect();
    pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    const leftPos = rect.right + window.scrollX - 230;
    pop.style.left = Math.max(10, leftPos) + 'px';
  } else {
    pop.style.top = '120px';
    pop.style.right = '20px';
  }

  const items = t.cols.map((c, i) => {
    const isChecked = !t.hiddenCols[i];
    return `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 6px;cursor:pointer;border-radius:4px;user-select:none;color:${popText};font-size:12.5px;transition:background 0.15s;" onmouseover="this.style.background='${hoverBg}'" onmouseout="this.style.background='transparent'">
        <input type="checkbox" id="zy2-chk-${id}-${i}" ${isChecked ? 'checked' : ''} onchange="zy2ToggleCol('${id}', ${i}, this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:#2563eb;">
        <span>${c}</span>
      </label>
    `;
  }).join('');

  pop.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${popBorder};">
      <span style="font-size:11px;font-weight:700;color:${popMuted};text-transform:uppercase;letter-spacing:0.5px;">Show / Hide Columns</span>
      <button type="button" onclick="document.getElementById('zy-cols-popover')?.remove()" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:16px;padding:0 4px;line-height:1;">&times;</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <a href="javascript:void(0)" onclick="zy2SetAllCols('${id}', true)" style="font-size:11px;font-weight:600;color:#2563eb;text-decoration:none;">Show All</a>
      <span style="color:${popBorder};">|</span>
      <a href="javascript:void(0)" onclick="zy2ResetCols('${id}')" style="font-size:11px;font-weight:600;color:${popMuted};text-decoration:none;">Reset</a>
    </div>
    <div style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;">
      ${items}
    </div>
  `;

  document.body.appendChild(pop);

  setTimeout(() => {
    const onDocClick = (e) => {
      if (!pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
        pop.remove();
        document.removeEventListener('click', onDocClick);
      }
    };
    document.addEventListener('click', onDocClick);
  }, 10);
}

function zyHtmlTableCols(table, id, anchorEl) {
  const existing = document.getElementById('zy-cols-popover');
  if (existing) {
    const wasSame = existing._targetId === id;
    existing.remove();
    if (wasSame) return;
  }

  // Extract column headers
  const ths = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
  if (!ths.length) return;
  const colNames = ths.map(th => th.textContent.replace(/[▲▼↑↓]/g, '').trim());

  table._hiddenCols = table._hiddenCols || {};

  const btn = anchorEl || (typeof event !== 'undefined' && event?.currentTarget) || document.getElementById(id);
  const isDark = document.body.classList.contains('dark') || document.documentElement.getAttribute('data-theme') === 'dark';
  const popBg = isDark ? '#1e293b' : '#ffffff';
  const popBorder = isDark ? '#334155' : '#cbd5e1';
  const popText = isDark ? '#f8fafc' : '#1e293b';
  const popMuted = isDark ? '#94a3b8' : '#64748b';
  const hoverBg = isDark ? '#334155' : '#f1f5f9';

  const pop = document.createElement('div');
  pop.id = 'zy-cols-popover';
  pop._targetId = id;
  pop.style.cssText = `position:absolute;z-index:99999;background:${popBg};border:1px solid ${popBorder};border-radius:8px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.25),0 8px 10px -6px rgba(0,0,0,0.15);width:230px;padding:10px 12px;font-family:inherit;font-size:13px;color:${popText};`;

  if (btn && btn.getBoundingClientRect) {
    const rect = btn.getBoundingClientRect();
    pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    const leftPos = rect.right + window.scrollX - 230;
    pop.style.left = Math.max(10, leftPos) + 'px';
  } else {
    pop.style.top = '120px';
    pop.style.right = '20px';
  }

  const items = colNames.map((c, i) => {
    const isChecked = !table._hiddenCols[i];
    return `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 6px;cursor:pointer;border-radius:4px;user-select:none;color:${popText};font-size:12.5px;transition:background 0.15s;" onmouseover="this.style.background='${hoverBg}'" onmouseout="this.style.background='transparent'">
        <input type="checkbox" id="zy-html-chk-${id}-${i}" ${isChecked ? 'checked' : ''} onchange="zyToggleHtmlCol('${id}', ${i}, this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:#2563eb;">
        <span>${c || ('Col ' + (i + 1))}</span>
      </label>
    `;
  }).join('');

  pop.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${popBorder};">
      <span style="font-size:11px;font-weight:700;color:${popMuted};text-transform:uppercase;letter-spacing:0.5px;">Show / Hide Columns</span>
      <button type="button" onclick="document.getElementById('zy-cols-popover')?.remove()" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:16px;padding:0 4px;line-height:1;">&times;</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <a href="javascript:void(0)" onclick="zySetAllHtmlCols('${id}', true)" style="font-size:11px;font-weight:600;color:#2563eb;text-decoration:none;">Show All</a>
      <span style="color:${popBorder};">|</span>
      <a href="javascript:void(0)" onclick="zySetAllHtmlCols('${id}', false)" style="font-size:11px;font-weight:600;color:${popMuted};text-decoration:none;">Reset</a>
    </div>
    <div style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;">
      ${items}
    </div>
  `;

  document.body.appendChild(pop);

  setTimeout(() => {
    const onDocClick = (e) => {
      if (!pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
        pop.remove();
        document.removeEventListener('click', onDocClick);
      }
    };
    document.addEventListener('click', onDocClick);
  }, 10);
}

function zyToggleHtmlCol(id, colIndex, isVisible) {
  let table = document.getElementById(id) || document.querySelector('#' + id);
  if (!table) table = document.querySelector(`table[data-table-id="${id}"]`) || document.querySelector('table');
  if (!table) return;

  table._hiddenCols = table._hiddenCols || {};
  const ths = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
  const totalCols = ths.length;

  if (isVisible) {
    delete table._hiddenCols[colIndex];
  } else {
    const visibleCount = totalCols - Object.keys(table._hiddenCols).length;
    if (visibleCount <= 1) {
      if (typeof toast === 'function') toast('At least one column must remain visible', 'warning');
      const cb = document.getElementById(`zy-html-chk-${id}-${colIndex}`);
      if (cb) cb.checked = true;
      return;
    }
    table._hiddenCols[colIndex] = true;
  }

  zyApplyHtmlColVisibility(table);
}

function zyApplyHtmlColVisibility(table) {
  if (!table) return;
  table._hiddenCols = table._hiddenCols || {};
  const rows = Array.from(table.querySelectorAll('thead tr, tbody tr'));
  rows.forEach(tr => {
    const cells = Array.from(tr.children);
    cells.forEach((cell, idx) => {
      if (table._hiddenCols[idx]) {
        cell.style.display = 'none';
      } else {
        cell.style.display = '';
      }
    });
  });

  // Handle tfoot rows: if normal cells, toggle display; if single colspan cell, update colspan dynamically
  const footRows = Array.from(table.querySelectorAll('tfoot tr'));
  const ths = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
  const visibleCount = Math.max(1, ths.length - Object.keys(table._hiddenCols).length);

  footRows.forEach(tr => {
    const cells = Array.from(tr.children);
    if (cells.length === 1 && cells[0].hasAttribute('colspan')) {
      cells[0].colSpan = visibleCount;
    } else {
      cells.forEach((cell, idx) => {
        if (table._hiddenCols[idx]) {
          cell.style.display = 'none';
        } else {
          cell.style.display = '';
        }
      });
    }
  });
}

function zySetAllHtmlCols(id, visible) {
  let table = document.getElementById(id) || document.querySelector('#' + id);
  if (!table) table = document.querySelector(`table[data-table-id="${id}"]`) || document.querySelector('table');
  if (!table) return;
  table._hiddenCols = {};
  const ths = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
  ths.forEach((_, i) => {
    const cb = document.getElementById(`zy-html-chk-${id}-${i}`);
    if (cb) cb.checked = true;
  });
  zyApplyHtmlColVisibility(table);
}

function zyExportHtmlTable(id, kind) {
  let table = document.getElementById(id) || document.querySelector('#' + id) || document.querySelector('table');
  if (!table) return;
  const rows = Array.from(table.querySelectorAll('tr'));
  const visibleRows = rows.map(r =>
    Array.from(r.children).filter(c => c.style.display !== 'none').map(c => c.innerText.trim().replace(/\n+/g, ' '))
  );
  if (!visibleRows.length) return;

  if (kind === 'copy') {
    const text = visibleRows.map(r => r.join('\t')).join('\n');
    navigator.clipboard && navigator.clipboard.writeText(text);
    if (typeof toast === 'function') toast('Copied ' + visibleRows.length + ' rows', 'success');
    return;
  }
  if (kind === 'csv' || kind === 'excel') {
    const csv = visibleRows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = id + (kind === 'excel' ? '.xls' : '.csv');
    a.click();
    return;
  }
  if (kind === 'print') {
    zyPrintHtml(`<!DOCTYPE html><html><head><title>${zyEsc(id)}</title><style>body{font-family:sans-serif;padding:16px;}table{width:100%;border-collapse:collapse;}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;}</style></head><body><table border=1 cellspacing=0 cellpadding=6>${visibleRows.map(r => `<tr>${r.map(c => `<td>${zyEsc(c)}</td>`).join('')}</tr>`).join('')}</table></body></html>`);
  }
}

function zyPrintHtmlTable(id) {
  zyExportHtmlTable(id, 'print');
}

function zyRenderTableToolbar(tableId, opts = {}) {
  const title = opts.title || '';
  return `
    <div class="zy-table-toolbar" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-bottom:none;border-radius:6px 6px 0 0;">
      <div style="font-size:12.5px;font-weight:600;color:#475569;">
        ${title ? `<i class="fas fa-table" style="margin-right:6px;color:#64748b;"></i>${title}` : ''}
      </div>
      <div class="zy-toolbar-pills" style="display:flex;gap:6px;flex-wrap:wrap;margin-left:auto;">
        <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('${tableId}', this)"><i class="fas fa-columns"></i> Columns</button>
      </div>
    </div>
  `;
}

function zy2ToggleCol(id, i, isVisible) {
  const t = ZYT2[id];
  if (!t) return;
  t.hiddenCols = t.hiddenCols || {};
  if (isVisible) {
    delete t.hiddenCols[i];
  } else {
    const visibleCount = t.cols.filter((_, idx) => !t.hiddenCols[idx]).length;
    if (visibleCount <= 1) {
      if (typeof toast === 'function') toast('At least one column must remain visible', 'warning');
      const cb = document.getElementById(`zy2-chk-${id}-${i}`);
      if (cb) cb.checked = true;
      return;
    }
    t.hiddenCols[i] = true;
  }
  zy2Render(id);
}

function zy2SetAllCols(id, visible) {
  const t = ZYT2[id];
  if (!t) return;
  t.hiddenCols = {};
  t.cols.forEach((_, i) => {
    const cb = document.getElementById(`zy2-chk-${id}-${i}`);
    if (cb) cb.checked = true;
  });
  zy2Render(id);
}

function zy2ResetCols(id) {
  zy2SetAllCols(id, true);
}

function zy2Export(id, kind) {
  const t = ZYT2[id], rows = zy2Data(t);
  t.hiddenCols = t.hiddenCols || {};
  const isColVisible = (i) => !t.hiddenCols[i];
  const visibleCols = t.cols.filter((_, i) => isColVisible(i));
  const visibleRows = rows.map(r => r.filter((_, i) => isColVisible(i)));

  const text = [visibleCols.join('\t')].concat(visibleRows.map(r => r.map(c => String(zyCell2(c).v ?? '')).join('\t'))).join('\n');
  if (kind === 'copy') {
    navigator.clipboard && navigator.clipboard.writeText(text);
    if (typeof toast === 'function') toast('Copied ' + visibleRows.length + ' rows', 'success');
    return;
  }
  if (kind === 'csv' || kind === 'excel') {
    const csv = [visibleCols.join(',')].concat(visibleRows.map(r => r.map(c => `"${String(zyCell2(c).v ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = id + (kind === 'excel' ? '.xls' : '.csv'); a.click();
    return;
  }
  zyPrintHtml(`<!DOCTYPE html><html><head><title>${zyEsc(id)}</title><style>body{font-family:sans-serif;padding:16px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left;}th{background:#f8fafc;}</style></head><body><table border=1 cellspacing=0 cellpadding=6><tr>${visibleCols.map(c => `<th>${zyEsc(c)}</th>`).join('')}</tr>` +
    visibleRows.map(r => `<tr>${r.map(c => `<td>${zyEsc(zyCell2(c).v ?? '')}</td>`).join('')}</tr>`).join('') + `</table></body></html>`);
}


/* ── select2-style picker (same behaviour as the source panel) ── */
const ZY_S2 = {};
function zyS2(id, placeholder, items, onPick) {
  ZY_S2[id] = { items: items || [], value: '', onPick: onPick || null, ph: placeholder };
  return `<div class="zy-s2" id="${id}">
    <div class="zy-s2-box" onclick="zyS2Toggle('${id}')"><span>${placeholder}</span>${zyImg('ui_caret')}</div>
    <div class="zy-s2-drop">
      <div class="zy-s2-search"><input placeholder="" oninput="zyS2Filter('${id}',this.value)"></div>
      <div class="zy-s2-list"></div>
    </div></div>`;
}
function zyS2Fill(id, list) {
  const host = document.querySelector(`#${id} .zy-s2-list`); if (!host) return;
  const t = ZY_S2[id];
  host.innerHTML = list.length
    ? list.map(v => `<div class="${v === t.value ? 'on' : ''}" data-v="${zyEsc(v)}" onclick="zyS2Pick('${id}',this.dataset.v)">- ${zyEsc(v)}</div>`).join('')
    : `<div class="zy-s2-none">No results found</div>`;
}
function zyS2Toggle(id) {
  const el = document.getElementById(id); if (!el) return;
  document.querySelectorAll('.zy-s2.open').forEach(o => { if (o !== el) o.classList.remove('open'); });
  el.classList.toggle('open');
  if (el.classList.contains('open')) {
    zyS2Fill(id, ZY_S2[id].items);
    const inp = el.querySelector('.zy-s2-search input'); if (inp) { inp.value = ''; inp.focus(); }
  }
}
function zyS2Filter(id, q) {
  const s = (q || '').toLowerCase();
  zyS2Fill(id, ZY_S2[id].items.filter(v => v.toLowerCase().includes(s)));
}
function zyS2Pick(id, v) {
  const t = ZY_S2[id]; t.value = v;
  const box = document.querySelector(`#${id} .zy-s2-box`);
  box.classList.add('picked'); box.querySelector('span').textContent = v;
  document.getElementById(id).classList.remove('open');
  if (t.onPick) t.onPick(v);
}
function zyS2Value(id) { return (ZY_S2[id] || {}).value || ''; }
document.addEventListener('click', e => {
  if (!e.target.closest('.zy-s2')) document.querySelectorAll('.zy-s2.open').forEach(o => o.classList.remove('open'));
});

/* ── modal in the reference panel's style ───────────────────── */
function zyModal(title, body, footer) {
  const m = document.getElementById('modal');
  m.classList.add('zy-modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML =
    `<div class="zy-modal-body">${body}</div>` + (footer ? `<div class="zy-modal-foot">${footer}</div>` : '');
  const ov = document.getElementById('modal-overlay');
  ov.classList.add('active', 'show');   // 'show' is what style.css actually displays
  ov.style.display = 'flex';
  document.body.classList.add('zy-modal-open');
}

/* The panels' own closeModal() only drops the 'show' class, so a modal opened
   by zyModal (which also sets an inline display:flex) stayed on screen after
   Add/Delete — the page looked stuck on the form. Close it properly. */
(function () {
  const prev = window.closeModal;
  window.closeModal = function () {
    if (typeof prev === 'function') { try { prev(); } catch (e) {} }
    const ov = document.getElementById('modal-overlay');
    if (ov) { ov.classList.remove('active', 'show'); ov.style.display = ''; }
    const m = document.getElementById('modal');
    if (m) m.classList.remove('zy-modal', 'modal-lg');
    document.body.classList.remove('zy-modal-open');
  };
})();

const zyList = v => Array.isArray(v) ? v : ((v && v.data) || []);
const zyEsc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

/* Request Numbers & Self-Allocate Modals (Real Backend Policy & Limits) */
window.zyFetchAllocPolicy = async function() {
  if (typeof apiFetch !== 'function') return { mode: 'request', daily_limit: 0, total_limit: 0, used_today: 0, total_held: 0, pending_requested: 0 };
  try {
    const p = await apiFetch('/api/numbers/allocation-policy');
    if (p && p.mode) {
      window.ZY_ALLOC_POLICY = p;
      return p;
    }
  } catch (_) {}
  return window.ZY_ALLOC_POLICY || { mode: 'request', daily_limit: 0, total_limit: 0, used_today: 0, total_held: 0, pending_requested: 0 };
};

window.zyFormatAllocLimitHint = function(policy, actionWord) {
  if (!policy) return '';
  const parts = [];
  if (Number(policy.daily_limit) > 0) {
    parts.push(`Daily limit: <b>${Number(policy.daily_remaining ?? 0).toLocaleString()}</b> of <b>${Number(policy.daily_limit).toLocaleString()}</b> left today (used ${Number(policy.used_today || 0).toLocaleString()})`);
  } else {
    parts.push(`Daily limit: <b>Unlimited</b> (used ${Number(policy.used_today || 0).toLocaleString()} today)`);
  }
  if (Number(policy.total_limit) > 0) {
    parts.push(`Overall limit: <b>${Number(policy.total_remaining ?? 0).toLocaleString()}</b> of <b>${Number(policy.total_limit).toLocaleString()}</b> left (held ${Number(policy.total_held || 0).toLocaleString()}, pending ${Number(policy.pending_requested || 0).toLocaleString()})`);
  }
  return parts.join('<br>');
};

window.zyResolveRangeActivePayterms = function(r) {
  const labelMap = {
    Weekly: 'Weekly (7/3) — 3 Day Hold',
    Monthly: 'Monthly (30/5) {W} — 5 Day Hold'
  };
  const obj = (r && typeof r === 'object') ? r : {};
  const ptStr = String(obj.payterm || obj.client_payterm || obj.agent_payterm || '').toLowerCase();
  const activePts = Array.isArray(obj.active_payterms) ? obj.active_payterms.map(x => String(x || '').toLowerCase()) : [];
  const ptsObj = (obj.payterms && typeof obj.payterms === 'object') ? obj.payterms : {};
  const hasMonthlyPtOnly = (ptsObj.Monthly !== undefined || ptsObj['30/5'] !== undefined) && (ptsObj.Weekly === undefined && ptsObj['7/3'] === undefined);
  const isWn = Boolean(
    obj.is_whitenoise ||
    String(obj.provider || '').toLowerCase().includes('whitenoise') ||
    String(obj.payout_schedule || '').toLowerCase() === 'monthly30_5' ||
    String(obj.range_name || obj.name || '').toLowerCase().includes('whitenoise') ||
    ptStr === 'monthly' || ptStr === '30/5' || ptStr === 'monthly30_5' ||
    (activePts.includes('monthly') && !activePts.includes('weekly')) ||
    hasMonthlyPtOnly
  );
  if (isWn) {
    return { active: ['Monthly'], primary: 'Monthly', isWn: true, labels: labelMap };
  }
  return { active: ['Weekly'], primary: 'Weekly', isWn: false, labels: labelMap };
};

window.zyOpenRequestNumbersModal = async function(rangeName, rangeId, passedPolicy, onDone, rangeObj) {
  const policy = passedPolicy || await window.zyFetchAllocPolicy();
  window._zyOnAllocModalDone = typeof onDone === 'function' ? onDone : null;
  if (policy && policy.mode === 'self_allocate') {
    return window.zyOpenSelfAllocateModal(rangeName, rangeId, policy, onDone, rangeObj);
  }
  if (rangeObj && (rangeObj.has_pending_request || Number(rangeObj.pending_request_count || 0) > 0 || rangeObj.block_reason === 'pending_request')) {
    if (typeof toast === 'function') toast(`You already have a pending request for "${rangeName}". Please wait for approval before requesting again.`, 'warning');
    return;
  }
  const poolStock = rangeObj && (rangeObj.owner_free_count != null || rangeObj.free_count != null || rangeObj.available != null)
    ? Math.max(0, Number(rangeObj.owner_free_count ?? rangeObj.free_count ?? rangeObj.available ?? 0))
    : null;
  if (poolStock !== null && poolStock <= 0) {
    if (typeof toast === 'function') toast(`No free numbers are currently available for "${rangeName}". Please try another range.`, 'warning');
    return;
  }
  const maxByDaily = Number(policy.daily_limit) > 0 ? Math.max(0, Number(policy.daily_remaining ?? 0)) : Infinity;
  const maxByTotal = Number(policy.total_limit) > 0 ? Math.max(0, Number(policy.total_remaining ?? 0)) : Infinity;
  const maxAllowed = Math.min(maxByDaily, maxByTotal, poolStock !== null ? poolStock : Infinity, 5000);
  const blocked = maxAllowed <= 0 && (Number(policy.daily_limit) > 0 || Number(policy.total_limit) > 0);
  if (blocked) {
    const msg = (Number(policy.daily_limit) > 0 && Number(policy.daily_remaining ?? 0) <= 0)
      ? 'Your daily number request limit has been reached. It resets at 00:00 UTC (05:00 AM PKT).'
      : 'Your overall number holding limit has been reached. Return unused numbers to request more.';
    if (typeof toast === 'function') toast(msg, 'warning');
    return;
  }
  const limitHint = window.zyFormatAllocLimitHint(policy, 'request');

  const ptInfo = window.zyResolveRangeActivePayterms(rangeObj || { range_name: rangeName });
  const isLockedPt = ptInfo.active.length === 1;
  const ptOptionsHtml = ptInfo.active.map(pt =>
    `<option value="${zyEsc(pt)}" ${pt === ptInfo.primary ? 'selected' : ''}>${zyEsc(ptInfo.labels[pt] || pt)}${isLockedPt ? ' (Locked)' : ''}</option>`
  ).join('');

  zyModal('Request Numbers', `
    <div id="zy-req-err" class="zy-modal-alert is-error" style="display:none;"></div>
    <div class="zy-modal-summary-card" style="background:#f8fafc;border-radius:12px;padding:12px 14px;margin-bottom:14px;border:1px solid #e2e8f0;">
      <div style="font-weight:800;color:#0f172a;font-size:14px;">${zyEsc(rangeName)}</div>
      <div style="font-size:11.5px;color:#475569;margin-top:4px;">Mode: <b>Request Approval</b> · Active Payterm: <b>${zyEsc(ptInfo.active.join(', '))}</b>${poolStock !== null ? ` · Free Pool: <b style="color:#059669;">${poolStock.toLocaleString()}</b>` : ''}</div>
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;">Payment Term</label>
      <select id="req-payterm" class="zy-select-pill" ${isLockedPt ? 'disabled' : ''}>${ptOptionsHtml}</select>
      ${isLockedPt ? `<div style="font-size:11px;color:#475569;margin-top:4px;">Only <b>${zyEsc(ptInfo.primary)}</b> is enabled on this range.</div>` : ''}
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;">Quantity</label>
      <input type="number" id="req-qty" class="zy-select-pill" min="1" ${Number.isFinite(maxAllowed) ? `max="${Math.max(1, maxAllowed)}"` : ''} value="${Math.min(10, Number.isFinite(maxAllowed) ? Math.max(1, maxAllowed) : 10)}">
      <div style="font-size:11.5px;color:#64748b;margin-top:6px;line-height:1.5;">${limitHint}</div>
    </div>
    <div style="margin-bottom:8px;">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;">Notes (Optional)</label>
      <input type="text" id="req-notes" class="zy-select-pill" placeholder="Optional note for approval">
    </div>
  `, `
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;width:100%;">
      <button type="button" class="zy-btn-pill-cancel" onclick="closeModal()">Close</button>
      <button type="button" class="zy-btn-pill-submit" id="zy-req-submit-btn" onclick="zySubmitRangeRequest('${zyEsc(rangeName)}','${zyEsc(rangeId || '')}')">Submit Request</button>
    </div>
  `);
};

window.zySubmitRangeRequest = async function(rangeName, rangeId) {
  const pt = document.getElementById('req-payterm')?.value || 'Weekly';
  const qty = parseInt(document.getElementById('req-qty')?.value || '0', 10);
  const notes = (document.getElementById('req-notes')?.value || '').trim();
  const btn = document.getElementById('zy-req-submit-btn');
  if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('zy-req-err', '');
  if (!qty || qty < 1) {
    if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('zy-req-err', 'Please enter a valid number quantity (at least 1).');
    else if (typeof toast === 'function') toast('Please enter a valid quantity', 'error');
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
        range_id: rangeId ? (Number(rangeId) || rangeId) : undefined,
        range_name: rangeName,
        payterm: pt,
        quantity: qty,
        notes: notes ? `Payterm: ${pt} | ${notes}` : `Payterm: ${pt}`,
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
    if (typeof closeModal === 'function') closeModal();
    const msg = res.message || `Requested ${qty} number(s) for ${rangeName} (${pt})`;
    if (typeof toast === 'function') toast(msg, 'success');
    else if (typeof zyFlash === 'function') zyFlash(msg);
    if (typeof window._zyOnAllocModalDone === 'function') window._zyOnAllocModalDone();
  } catch (e) {
    const cleanMsg = typeof window.zyHumanizeError === 'function'
      ? window.zyHumanizeError(e.message || e)
      : (e.message || 'Unable to submit request.');
    if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('zy-req-err', cleanMsg);
    else if (typeof toast === 'function') toast(cleanMsg, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Request'; }
  }
};

window.zyOpenSelfAllocateModal = async function(rangeName, rangeId, passedPolicy, onDone, rangeObj) {
  const policy = passedPolicy || await window.zyFetchAllocPolicy();
  window._zyOnAllocModalDone = typeof onDone === 'function' ? onDone : null;
  if (policy && policy.mode === 'request') {
    return window.zyOpenRequestNumbersModal(rangeName, rangeId, policy, onDone, rangeObj);
  }
  const poolStock = rangeObj && (rangeObj.available != null || rangeObj.owner_free_count != null || rangeObj.free_count != null)
    ? Math.max(0, Number(rangeObj.available ?? rangeObj.owner_free_count ?? rangeObj.free_count ?? 0))
    : null;
  if (poolStock !== null && poolStock <= 0) {
    if (typeof toast === 'function') toast(`No free numbers are currently available for "${rangeName}". Please choose another range or try again later.`, 'warning');
    return;
  }
  const maxByDaily = Number(policy.daily_limit) > 0 ? Math.max(0, Number(policy.daily_remaining ?? 0)) : Infinity;
  const maxByTotal = Number(policy.total_limit) > 0 ? Math.max(0, Number(policy.total_remaining ?? 0)) : Infinity;
  const isClientSelf = rangeObj && rangeObj.max_requestable_now != null;
  const rangeBatchSize = isClientSelf ? Math.max(1, Number(rangeObj.batch_size || 25)) : 10;
  const rangeMaxHold = isClientSelf ? Math.max(rangeBatchSize, Number(rangeObj.max_hold_limit || 25)) : 50;
  const rangeDailyAdds = isClientSelf ? Math.max(1, Number(rangeObj.daily_adds_limit || rangeObj.daily_request_limit || 1)) : 1;
  const rangeTodayAdds = isClientSelf ? Number(rangeObj.today_adds_used || 0) : 0;
  const clientCap = isClientSelf ? Math.max(0, Number(rangeObj.max_requestable_now || 0)) : Infinity;
  const maxAllowed = Math.min(maxByDaily, maxByTotal, clientCap, poolStock !== null ? poolStock : Infinity, 5000);
  const blocked = maxAllowed <= 0 && (isClientSelf || Number(policy.daily_limit) > 0 || Number(policy.total_limit) > 0);
  if (blocked) {
    let blockMsg = `Your daily allocation limit for "${rangeName}" has been reached (${rangeTodayAdds}/${rangeDailyAdds} adds today). Resets at 00:00 UTC (05:00 AM PKT).`;
    if (isClientSelf && rangeObj.block_reason === 'hold_limit') {
      blockMsg = `Maximum active holding limit reached for "${rangeName}" (${Number(rangeObj.held_count || 0)}/${rangeMaxHold}). Return previous-day numbers first to allocate more.`;
    } else if (!isClientSelf && Number(policy.total_limit) > 0 && Number(policy.total_remaining ?? 0) <= 0) {
      blockMsg = 'Your overall number holding limit has been reached. Return unused numbers to allocate more.';
    }
    if (typeof toast === 'function') toast(blockMsg, 'warning');
    return;
  }
  const limitHint = isClientSelf
    ? `Per-Range Quota: Batch <b>${rangeBatchSize}</b> · Held <b>${Number(rangeObj.held_count || 0)}/${rangeMaxHold}</b> · Daily Adds <b>${rangeTodayAdds}/${rangeDailyAdds}</b>`
    : window.zyFormatAllocLimitHint(policy, 'allocate');

  const ptInfo = window.zyResolveRangeActivePayterms(rangeObj || { range_name: rangeName });
  const isLockedPt = ptInfo.active.length === 1;
  const ptOptionsHtml = ptInfo.active.map(pt =>
    `<option value="${zyEsc(pt)}" ${pt === ptInfo.primary ? 'selected' : ''}>${zyEsc(ptInfo.labels[pt] || pt)}${isLockedPt ? ' (Locked)' : ''}</option>`
  ).join('');

  zyModal('Self-Allocate Numbers', `
    <div id="zy-sa-err" class="zy-modal-alert is-error" style="display:none;"></div>
    <div class="zy-modal-summary-card" style="background:#f8fafc;border-radius:12px;padding:12px 14px;margin-bottom:14px;border:1px solid #e2e8f0;">
      <div style="font-weight:800;color:#0f172a;font-size:14px;">${zyEsc(rangeName)}</div>
      <div style="font-size:11.5px;color:#047857;margin-top:4px;">Mode: <b>Self-Allocate (Instant Pool Assignment)</b> · Payterm: <b>${zyEsc(ptInfo.active.join(', '))}</b>${poolStock !== null ? ` · Free Pool: <b>${poolStock.toLocaleString()}</b>` : ''}</div>
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;">Payment Term</label>
      <select id="sa-payterm" class="zy-select-pill" ${isLockedPt ? 'disabled' : ''}>${ptOptionsHtml}</select>
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;">Quantity</label>
      <input type="number" id="sa-qty" class="zy-select-pill" min="1" ${Number.isFinite(maxAllowed) ? `max="${Math.max(1, maxAllowed)}"` : ''} value="${Math.min(rangeBatchSize, Number.isFinite(maxAllowed) ? Math.max(1, maxAllowed) : rangeBatchSize)}">
      <div style="font-size:11.5px;color:#64748b;margin-top:6px;line-height:1.5;">${limitHint}</div>
    </div>
  `, `
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;width:100%;">
      <button type="button" class="zy-btn-pill-cancel" onclick="closeModal()">Close</button>
      <button type="button" class="zy-btn-pill-submit" id="zy-sa-submit-btn" onclick="zySubmitSelfAllocate('${zyEsc(rangeName)}','${zyEsc(rangeId || '')}')">Allocate Now</button>
    </div>
  `);
};

window.zySubmitSelfAllocate = async function(rangeName, rangeId) {
  const qty = parseInt(document.getElementById('sa-qty')?.value || '0', 10);
  const pt = document.getElementById('sa-payterm')?.value || '';
  const btn = document.getElementById('zy-sa-submit-btn');
  if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('zy-sa-err', '');
  if (!qty || qty < 1) {
    if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('zy-sa-err', 'Please enter a valid quantity (at least 1).');
    else if (typeof toast === 'function') toast('Please enter a valid quantity', 'error');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Allocating...'; }
  try {
    const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
    const response = await fetch('/api/numbers/agent-allocate', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}`, 'X-Session-Token': token } : {})
      },
      body: JSON.stringify({
        range_id: rangeId ? (Number(rangeId) || rangeId) : undefined,
        range_name: rangeName,
        payterm: pt || undefined,
        count: qty,
        quantity: qty
      })
    });
    const rawText = await response.text();
    let res = null;
    try { res = JSON.parse(rawText); } catch (_) {}
    if (!response.ok || !res || res.error) {
      const cleanMsg = typeof window.zyHumanizeError === 'function'
        ? window.zyHumanizeError((res && (res.error || res.message)) || rawText, response.status)
        : ((res && res.error) || 'No numbers are currently available in this range.');
      throw new Error(cleanMsg);
    }
    if (typeof closeModal === 'function') closeModal();
    const allocatedActual = Number(res.allocated ?? res.allocated_count ?? qty) || 0;
    const msg = res.message || `Allocated ${allocatedActual} number(s) from ${res.range_name || rangeName}`;
    if (typeof toast === 'function') toast(msg, 'success');
    else if (typeof zyFlash === 'function') zyFlash(msg);
    if (typeof window._zyOnAllocModalDone === 'function') window._zyOnAllocModalDone();
  } catch (e) {
    const cleanMsg = typeof window.zyHumanizeError === 'function'
      ? window.zyHumanizeError(e.message || e)
      : (e.message || 'Self-allocation could not be completed.');
    if (typeof window.zySetModalAlert === 'function') window.zySetModalAlert('zy-sa-err', cleanMsg);
    else if (typeof toast === 'function') toast(cleanMsg, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Allocate Now'; }
  }
};

/* ─── PER-RANGE DATE-TO-DATE NUMBER RETURN MODAL (Client & Agent) ─── */
window._zyRangeRetState = null;

window.zyOpenRangeReturnModal = async function(rangeId, rangeName, onDone) {
  window._zyRangeRetState = {
    rangeId: rangeId ? Number(rangeId) : null,
    rangeName: String(rangeName || '').trim(),
    onDone: typeof onDone === 'function' ? onDone : null,
    batches: [],
    selectedDates: new Set()
  };

  zyModal(`Return Range: ${zyEsc(rangeName || 'Range')}`, `
    <div style="padding:24px 12px;text-align:center;color:#64748b;font-size:13px;">
      <i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i> Loading date batches for <b>${zyEsc(rangeName || 'this range')}</b>…
    </div>
  `, `<button type="button" class="zy-btn-pill-cancel" onclick="closeModal()">Close</button>`);

  try {
    const qs = new URLSearchParams();
    if (rangeId) qs.set('range_id', String(rangeId));
    if (rangeName) qs.set('range_name', String(rangeName));
    const res = await apiFetch(`/api/numbers/range-return-batches?${qs.toString()}`);
    if (!res || res.error) {
      const errMsg = (res && res.error) || 'Failed to load range batches';
      if (errMsg.toLowerCase().includes('contact your agent')) {
        zyModal('Contact Your Agent', `
          <div style="padding:18px 14px;text-align:center;">
            <i class="fas fa-user-tie" style="font-size:28px;color:#2563eb;margin-bottom:10px;display:block;"></i>
            <div style="font-weight:800;font-size:15px;color:#0f172a;margin-bottom:6px;">Monthly Route Return Restricted</div>
            <div style="font-size:13px;color:#475569;line-height:1.5;">${zyEsc(errMsg)}</div>
          </div>
        `, `<button type="button" class="zy-btn-blue" onclick="closeModal()">OK</button>`);
        return;
      }
      throw new Error(errMsg);
    }
    const batches = Array.isArray(res.batches) ? res.batches : [];
    const st = window._zyRangeRetState;
    if (!st) return;
    st.batches = batches;
    st.rangeId = res.range_id || st.rangeId;
    st.rangeName = res.range_name || st.rangeName;
    st.isWhitenoise = Boolean(res.is_whitenoise);
    st.requiresAgentApproval = Boolean(res.requires_agent_approval);
    st.pendingReturnCount = Number(res.pending_return_count || 0);
    st.minDate = res.min_date || '';
    st.maxDate = res.max_date || '';
    st.totalHeld = Number(res.total_held || 0);
    st.returnableCount = Number(res.returnable_count != null ? res.returnable_count : st.totalHeld);
    st.lockedTodayCount = Number(res.locked_today_count || 0);
    st.todayDate = res.today_date || '';
    st.selectedDates = new Set();

    if (!batches.length) {
      const pendingNote = st.pendingReturnCount > 0
        ? `<div style="margin-top:8px;font-size:12px;color:#b45309;font-weight:700;"><i class="fas fa-clock"></i> ${st.pendingReturnCount} number(s) already have a pending Return Request awaiting Agent approval.</div>`
        : '';
      zyModal(`Return Range: ${zyEsc(st.rangeName)}`, `
        <div class="zy-modal-summary-card" style="background:var(--sp-bg-subtle,#f8fafc);border-radius:12px;padding:18px;border:1px solid var(--sp-border,#e2e8f0);text-align:center;">
          <i class="fas fa-circle-info" style="font-size:22px;color:var(--sp-text-muted,#64748b);margin-bottom:8px;"></i>
          <div style="font-weight:700;color:var(--sp-text-primary,#0f172a);font-size:14px;">No Returnable Numbers in ${zyEsc(st.rangeName)}</div>
          <div style="font-size:12px;color:var(--sp-text-muted,#64748b);margin-top:4px;">You currently hold 0 additional returnable numbers in this range.</div>
          ${pendingNote}
        </div>
      `, `<button type="button" class="zy-btn-pill-cancel" onclick="closeModal()">Close</button>`);
      return;
    }

    const batchRowsHtml = batches.map(b => {
      const isLockedToday = b.returnable === false || b.is_today === true;
      const sampleText = b.sample_start
        ? (b.sample_end && b.sample_end !== b.sample_start ? `${b.sample_start} → ${b.sample_end}` : b.sample_start)
        : '—';
      const ptsText = Array.isArray(b.payterms) && b.payterms.length ? b.payterms.join(', ') : '';
      return `
        <label class="zy-ret-batch-row ${isLockedToday ? 'is-locked-today' : ''}" data-date="${zyEsc(b.date)}" ${isLockedToday ? 'title="Allocated today — return unlocks tomorrow"' : `onclick="zyToggleReturnDateRow(this, '${zyEsc(b.date)}')"`}>
          <input type="checkbox" class="zy-ret-chk" value="${zyEsc(b.date)}" data-count="${Number(b.count || 0)}" ${isLockedToday ? 'disabled' : ''} onclick="event.stopPropagation();zySyncReturnDateCheckboxes()">
          <div class="zy-ret-batch-main">
            <div class="zy-ret-batch-top">
              <span class="zy-ret-date-badge"><i class="fas fa-calendar-day"></i> ${zyEsc(b.date)}</span>
              <span class="zy-ret-count-badge">${Number(b.count || 0)} Number${Number(b.count) === 1 ? '' : 's'}</span>
              ${ptsText ? `<span class="zy-ret-pt-tag">${zyEsc(ptsText)}</span>` : ''}
              ${isLockedToday ? `<span class="zy-ret-lock-tag"><i class="fas fa-clock"></i> Locked Today · Returnable Tomorrow</span>` : ''}
            </div>
            <div class="zy-ret-sample monospace">${zyEsc(sampleText)}</div>
          </div>
        </label>`;
    }).join('');

    const wnApprovalBannerHtml = st.requiresAgentApproval
      ? `<div style="background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.35);color:var(--sp-text-primary,#1e1b4b);border-radius:9px;padding:10px 12px;margin-bottom:10px;font-size:12px;line-height:1.45;display:flex;align-items:flex-start;gap:8px;">
           <i class="fas fa-user-check" style="color:#4f46e5;margin-top:2px;flex-shrink:0;"></i>
           <span><b>Monthly Route {W} Return Request:</b> Returning these numbers sends a request to your Agent. Numbers stay active on your panel until your Agent approves.${st.pendingReturnCount > 0 ? ` <b>(${st.pendingReturnCount} already pending approval)</b>` : ''}</span>
         </div>`
      : '';

    const lockedNoticeHtml = st.lockedTodayCount > 0
      ? `<div class="zy-ret-today-notice">
           <i class="fas fa-shield-halved"></i>
           <span><b>Next-Day Return Rule:</b> ${st.lockedTodayCount} number(s) allocated today (${zyEsc(st.todayDate || 'Today')}) cannot be returned on the same day. They will unlock for return starting tomorrow.</span>
         </div>`
      : '';

    const hasReturnable = st.returnableCount > 0;
    const submitIdleLabel = st.requiresAgentApproval ? 'Request Return' : 'Return Selected';

    zyModal(`${st.requiresAgentApproval ? 'Request Return' : 'Return Range'}: ${zyEsc(st.rangeName)}`, `
      <div class="zy-modal-summary-card" style="background:var(--sp-bg-subtle,#f8fafc);border-radius:12px;padding:12px 14px;margin-bottom:12px;border:1px solid var(--sp-border,#e2e8f0);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:800;color:var(--sp-text-primary,#0f172a);font-size:14px;">${zyEsc(st.rangeName)}</div>
            <div style="font-size:11.5px;color:var(--sp-text-muted,#64748b);margin-top:2px;">Strictly scoped to this range only — choose previous-day date(s) to return.</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10.5px;color:var(--sp-text-muted,#64748b);font-weight:700;text-transform:uppercase;">Returnable / Held</div>
            <div style="font-size:16px;font-weight:800;color:${hasReturnable ? '#dc2626' : '#d97706'};" class="monospace">${st.returnableCount} / ${st.totalHeld}</div>
          </div>
        </div>
      </div>

      ${wnApprovalBannerHtml}
      ${lockedNoticeHtml}

      ${hasReturnable ? `
      <div class="zy-ret-date-bar">
        <div class="zy-ret-date-field">
          <label for="zy-ret-from">From Date</label>
          <input type="date" id="zy-ret-from" class="zy-input" value="${zyEsc(st.minDate)}" min="${zyEsc(st.minDate)}" max="${zyEsc(st.maxDate)}">
        </div>
        <div class="zy-ret-date-field">
          <label for="zy-ret-to">To Date</label>
          <input type="date" id="zy-ret-to" class="zy-input" value="${zyEsc(st.maxDate)}" min="${zyEsc(st.minDate)}" max="${zyEsc(st.maxDate)}">
        </div>
        <div class="zy-ret-date-actions">
          <button type="button" class="apx-btn apx-btn-small" onclick="zyApplyReturnDateSpan()"><i class="fas fa-filter"></i> Select Dates</button>
          <button type="button" class="apx-btn apx-btn-small" onclick="zySetAllReturnDates(true)">All Eligible</button>
          <button type="button" class="apx-btn apx-btn-small" onclick="zySetAllReturnDates(false)">Clear</button>
        </div>
      </div>` : ''}

      <div style="font-size:11.5px;font-weight:700;color:var(--sp-text-secondary,#475569);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
        <span>Assigned Date Batches (${batches.length} date${batches.length === 1 ? '' : 's'})</span>
        <span id="zy-ret-sel-summary" style="color:#dc2626;font-weight:800;">0 numbers selected</span>
      </div>
      <div class="zy-ret-batch-list" id="zy-ret-batch-list">
        ${batchRowsHtml}
      </div>
    `, `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;flex-wrap:wrap;">
        <span style="font-size:11.5px;color:var(--sp-text-muted,#64748b);" id="zy-ret-footer-hint">${hasReturnable ? 'Select at least one eligible date batch above.' : 'Today’s allocations unlock for return tomorrow.'}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="zy-btn-pill-cancel" onclick="closeModal()">Cancel</button>
          <button type="button" class="zy-btn-pill-submit" id="zy-ret-submit-btn" disabled style="background:${st.requiresAgentApproval ? '#4f46e5' : '#dc2626'};opacity:0.5;cursor:not-allowed;" onclick="zySubmitRangeReturnByDate()">
            <i class="fas ${st.requiresAgentApproval ? 'fa-paper-plane' : 'fa-rotate-left'}"></i> ${submitIdleLabel}
          </button>
        </div>
      </div>
    `);
  } catch (err) {
    zyModal(`Return Range: ${zyEsc(rangeName || 'Range')}`, `
      <div style="padding:16px;color:#dc2626;font-size:13px;">${zyEsc(err.message || 'Could not load returnable numbers')}</div>
    `, `<button type="button" class="zy-btn-pill-cancel" onclick="closeModal()">Close</button>`);
  }
};

window.zyToggleReturnDateRow = function(rowEl, dateKey) {
  const chk = rowEl ? rowEl.querySelector('.zy-ret-chk') : null;
  if (chk && !chk.disabled) {
    chk.checked = !chk.checked;
    window.zySyncReturnDateCheckboxes();
  }
};

window.zyApplyReturnDateSpan = function() {
  const fromD = (document.getElementById('zy-ret-from')?.value || '').trim();
  const toD = (document.getElementById('zy-ret-to')?.value || '').trim();
  const chks = document.querySelectorAll('#zy-ret-batch-list .zy-ret-chk');
  chks.forEach(chk => {
    if (chk.disabled) { chk.checked = false; return; }
    const d = String(chk.value || '');
    const inRange = (!fromD || d >= fromD) && (!toD || d <= toD);
    chk.checked = inRange;
  });
  window.zySyncReturnDateCheckboxes();
};

window.zySetAllReturnDates = function(checked) {
  document.querySelectorAll('#zy-ret-batch-list .zy-ret-chk').forEach(chk => {
    if (chk.disabled) { chk.checked = false; return; }
    chk.checked = Boolean(checked);
  });
  window.zySyncReturnDateCheckboxes();
};

window.zySyncReturnDateCheckboxes = function() {
  const st = window._zyRangeRetState;
  const chks = Array.from(document.querySelectorAll('#zy-ret-batch-list .zy-ret-chk'));
  let totalSel = 0;
  const selDates = [];
  chks.forEach(chk => {
    const row = chk.closest('.zy-ret-batch-row');
    if (chk.checked) {
      totalSel += Number(chk.getAttribute('data-count') || 0);
      selDates.push(chk.value);
      if (row) row.classList.add('is-selected');
    } else if (row) {
      row.classList.remove('is-selected');
    }
  });
  if (st) st.selectedDates = new Set(selDates);

  const sumEl = document.getElementById('zy-ret-sel-summary');
  if (sumEl) sumEl.textContent = `${totalSel} number${totalSel === 1 ? '' : 's'} selected (${selDates.length} date${selDates.length === 1 ? '' : 's'})`;

  const hintEl = document.getElementById('zy-ret-footer-hint');
  if (hintEl) {
    hintEl.textContent = totalSel > 0
      ? (st && st.requiresAgentApproval
          ? `Submitting return request for ${totalSel} Monthly Route {W} number(s) to your Agent.`
          : `Returning ${totalSel} number(s) strictly from ${st ? st.rangeName : 'this range'}.`)
      : 'Select at least one date batch above.';
  }

  const btn = document.getElementById('zy-ret-submit-btn');
  if (btn) {
    const isReq = Boolean(st && st.requiresAgentApproval);
    btn.disabled = totalSel <= 0;
    btn.style.opacity = totalSel > 0 ? '1' : '0.5';
    btn.style.cursor = totalSel > 0 ? 'pointer' : 'not-allowed';
    btn.innerHTML = totalSel > 0
      ? (isReq
          ? `<i class="fas fa-paper-plane"></i> Request Return (${totalSel})`
          : `<i class="fas fa-rotate-left"></i> Return ${totalSel} Number${totalSel === 1 ? '' : 's'}`)
      : (isReq
          ? `<i class="fas fa-paper-plane"></i> Request Return`
          : `<i class="fas fa-rotate-left"></i> Return Selected`);
  }
};

window.zySubmitRangeReturnByDate = async function() {
  const st = window._zyRangeRetState;
  if (!st) return;
  const dates = Array.from(st.selectedDates || []);
  if (!dates.length) {
    if (typeof toast === 'function') toast('Please select at least one date batch to return', 'error');
    return;
  }
  const btn = document.getElementById('zy-ret-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = st.requiresAgentApproval ? 'Submitting Request...' : 'Returning...'; }
  try {
    const res = await apiFetch('/api/numbers/return-by-date', {
      method: 'POST',
      body: JSON.stringify({
        range_id: st.rangeId || undefined,
        range_name: st.rangeName,
        dates
      })
    });
    if (!res || res.error) {
      throw new Error((res && res.error) || 'Failed to return numbers');
    }
    if (typeof closeModal === 'function') closeModal();
    const msg = res.message || (res.return_request_submitted
      ? `Return request sent to your Agent for ${res.request_count || ''} Monthly Route {W} number(s).`
      : `Returned ${res.returned_count} number(s) from ${st.rangeName}`);
    if (typeof toast === 'function') toast(msg, res.return_request_submitted ? 'info' : 'success');
    else if (typeof zyFlash === 'function') zyFlash(msg);
    if (typeof st.onDone === 'function') st.onDone();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Return failed', 'error');
    if (btn) {
      btn.disabled = false;
      window.zySyncReturnDateCheckboxes();
    }
  }
};
const zyTick = on => on ? zyImg('ui_tick', 'zy-tick') : '';

/* Full unmasked CLI display across Owner, Agent, and Client panels */
const zyMaskCli = v => { const s = String(v ?? '').trim(); return s ? zyEsc(s) : ''; };

/* CDR totals — the footer block sums the payouts per currency (USD/EUR/GBP)
   exactly like the reference panel, instead of the old fixed 0 / 0 / 0. */
const ZY_CCY = ['USD', 'EUR', 'GBP'];
function zyCcy(v) {
  const c = String(v || 'USD').toUpperCase();
  if (c === '$' || c === 'USD') return 'USD';
  if (c === '€' || c === 'EUR') return 'EUR';
  if (c === '£' || c === 'GBP') return 'GBP';
  return 'USD';
}
/* rows: [{currency, value}] -> "0<br>0<br>0" in USD/EUR/GBP order */
function zySumByCcy(items, pick) {
  const t = { USD: 0, EUR: 0, GBP: 0 };
  (items || []).forEach(it => {
    const v = parseFloat(pick(it));
    if (!isNaN(v)) t[zyCcy(it.currency)] += v;
  });
  return ZY_CCY.map(c => zyRound(t[c])).join('<br>');
}
const zyRound = n => (Math.round((n + Number.EPSILON) * 10000) / 10000) || 0;


/* Country list for the Add/Edit modals (same order as the reference panel) */
const ZY_COUNTRY_LIST = ['Afghanistan','Aland Islands','Albania','Algeria','American Samoa','Andorra','Angola',
 'Anguilla','Antarctica','Antigua and Barbuda','Argentina','Armenia','Aruba','Australia','Austria','Azerbaijan',
 'Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bermuda','Bhutan','Bolivia',
 'Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cambodia','Cameroon',
 'Canada','Cape Verde','Cayman Islands','Central African Republic','Chad','Chile','China','Colombia','Comoros',
 'Congo','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominica','Dominican Republic',
 'Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Ethiopia','Fiji','Finland','France',
 'Gabon','Gambia','Georgia','Germany','Ghana','Gibraltar','Greece','Greenland','Grenada','Guatemala','Guinea',
 'Guyana','Haiti','Honduras','Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel',
 'Italy','Ivory Coast','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kuwait','Kyrgyzstan','Laos','Latvia',
 'Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Macao','Madagascar','Malawi',
 'Malaysia','Maldives','Mali','Malta','Mauritania','Mauritius','Mexico','Moldova','Monaco','Mongolia','Montenegro',
 'Morocco','Mozambique','Myanmar','Namibia','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria',
 'North Macedonia','Norway','Oman','Pakistan','Palestine','Panama','Papua New Guinea','Paraguay','Peru',
 'Philippines','Poland','Portugal','Puerto Rico','Qatar','Romania','Russia','Rwanda','Saudi Arabia','Senegal',
 'Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Somalia','South Africa','South Korea',
 'South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan',
 'Tanzania','Thailand','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Uganda','Ukraine',
 'United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Venezuela','Vietnam','Yemen',
 'Zambia','Zimbabwe'];

/* ═══ shared filter box (dates + agent + Show Report) ═══════ */
function getLocalDateStr(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function zyMonthStart() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}
function zyToday() { return getLocalDateStr(); }

function onCdrDateInputChange(fromId, toId) {
  const f = document.getElementById(fromId);
  const t = document.getElementById(toId);
  if (!f || !t) return;
  if (f.value && t.value && f.value > t.value) {
    t.value = f.value;
  }
}
window.onCdrDateInputChange = onCdrDateInputChange;

function zyFilterBox(id, onShow, extraBtn) {
  const today = getLocalDateStr();
  return `<div class="zy-filterbox">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <label style="font-size:12px;font-weight:700;color:var(--text-secondary,#64748b);">From:</label>
      <input type="date" class="zy-fb-input" id="${id}-from" value="${today}" style="cursor:pointer;padding:6px 10px;font-weight:600;">
      <label style="font-size:12px;font-weight:700;color:var(--text-secondary,#64748b);">To:</label>
      <input type="date" class="zy-fb-input" id="${id}-to" value="${today}" style="cursor:pointer;padding:6px 10px;font-weight:600;">
      <select class="zy-fb-input" id="${id}-agent"><option value="">Filter Agent</option></select>
    </div>
    <div class="zy-fb-btns">${extraBtn || ''}
      <button class="zy-btn-blue" onclick="${onShow}">Show Report</button></div>
  </div>`;
}

// Auto Date Rollover Watcher (handles automatic midnight & day date change without manual intervention)
(function initAutoDateRolloverWatcher() {
  if (window._autoDateWatcherStarted) return;
  window._autoDateWatcherStarted = true;
  let lastDay = getLocalDateStr();

  // Watch every 10 seconds for date changes (midnight rollover or day change)
  if (window._autoDateWatcherTimer) clearInterval(window._autoDateWatcherTimer);
  window._autoDateWatcherTimer = setInterval(() => {
    const currentDay = getLocalDateStr();
    if (currentDay !== lastDay) {
      const oldDay = lastDay;
      lastDay = currentDay;

      // Update date labels across the top bar / dashboard headers
      const formattedDate = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      document.querySelectorAll('.fa-calendar-day').forEach(icon => {
        if (icon && icon.parentElement) {
          // If this is a date badge/indicator, update the date text
          const p = icon.parentElement;
          if (p.textContent && (p.textContent.includes(oldDay) || p.classList.contains('header-date') || p.id === 'header-date' || p.closest('.page-header') || p.closest('.zy-dash-head'))) {
            p.innerHTML = `<i class="fas fa-calendar-day"></i> ${formattedDate}`;
          }
        }
      });

      // Check all active date from/to inputs on the page
      const pairs = [
        ['rp-from', 'rp-to'],
        ['cdr-from', 'cdr-to'],
        ['c-from', 'c-to'],
        ['tc-from', 'tc-to'],
        ['mcdr-from', 'mcdr-to'],
        ['csms-from', 'csms-to'],
        ['cs-from', 'cs-to'],
        ['my-from', 'my-to'],
        ['ad-rs-from', 'ad-rs-to'],
        ['th-date-from', 'th-date-to']
      ];
      let didUpdate = false;
      for (const [fId, tId] of pairs) {
        const fEl = document.getElementById(fId);
        const tEl = document.getElementById(tId);
        if (fEl && tEl) {
          // If the filter was previously set to today / the old day, roll it forward automatically!
          if (fEl.value.includes(oldDay) && tEl.value.includes(oldDay)) {
            fEl.value = fEl.type === 'date' ? currentDay : `${currentDay} 00:00:00`;
            tEl.value = tEl.type === 'date' ? currentDay : `${currentDay} 23:59:59`;
            didUpdate = true;
          }
        }
      }

      // Also scan any other standalone date inputs on the screen
      document.querySelectorAll('input[type="date"]').forEach(inp => {
        if (inp.value === oldDay) {
          inp.value = currentDay;
          didUpdate = true;
        }
      });

      if (didUpdate) {
        // Updated input date values silently without disturbing report filtering
      }
    }
  }, 10000);
})();
let ZY_AGENTS = [];
async function zyFillAgents(selectId) {
  const res = await apiFetch('/api/agents?limit=200');
  ZY_AGENTS = (res && res.data) || [];
  const el = document.getElementById(selectId);
  if (el) el.innerHTML = `<option value="">Filter Agent</option>` +
    ZY_AGENTS.map(a => `<option value="${a.id}">${zyEsc(a.username)}</option>`).join('');
  return ZY_AGENTS;
}
const zyAgentName = id => (ZY_AGENTS.find(a => String(a.id) === String(id)) || {}).username || '';
const zyDateOnly = s => String(s || '').replace('T', ' ').slice(0, 19);

function zyFormatDateTimeStacked(raw) {
  if (!raw) return { v: '', h: '—' };
  const str = String(raw).replace('T', ' ').trim().slice(0, 19);
  const parts = str.split(' ');
  const datePart = parts[0] || '—';
  const timePart = parts[1] || '';
  if (!timePart) return { v: str, h: `<span class="zy-dt-date monospace">${datePart}</span>` };
  return {
    v: str,
    h: `<div class="zy-dt-stacked"><span class="zy-dt-date">${datePart}</span><span class="zy-dt-time">${timePart}</span></div>`
  };
}
window.zyFormatDateTimeStacked = zyFormatDateTimeStacked;

function zyInRange(id, ts) {
  const f = (document.getElementById(id + '-from') || {}).value || '';
  const t = (document.getElementById(id + '-to') || {}).value || '';
  const v = zyDateOnly(ts);
  if (f && v && v < f) return false;
  if (t && v && v > t) return false;
  return true;
}
function zyAgentFilter(id) { return (document.getElementById(id + '-agent') || {}).value || ''; }

/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — F1 Sidebar Accordion Controller
   ONE function zyToggleGroup(id) that closes every other group
   before opening the clicked one. Used by mouse, tap and keyboard.
   The group of the active page opens on load. aria-expanded in sync.
   ═══════════════════════════════════════════════════════════════ */
function zyToggleGroup(id) {
  let targetEl = null;
  if (!id && typeof event !== 'undefined') id = event.currentTarget || event.target;
  if (id && typeof id === 'object') {
    if (id.target || id.currentTarget) targetEl = id.currentTarget || id.target;
    else if (id.nodeType) targetEl = id;
  } else if (typeof id === 'string') {
    targetEl = document.getElementById(id) ||
               document.getElementById('sb-' + id) ||
               document.getElementById('grp-' + id) ||
               document.getElementById('grp-adm-' + id) ||
               (document.querySelector ? (document.querySelector(`[aria-controls="${id}"]`) || document.querySelector(`[aria-controls="sb-${id}"]`)) : null);
  }
  if (!targetEl) return;

  const nav = (targetEl.closest && targetEl.closest('.zy-sidenav')) || document.getElementById('zy-sidenav');
  let header = null;
  let sub = null;

  if (targetEl.classList && targetEl.classList.contains('zy-snav')) {
    header = targetEl;
    const subId = header.getAttribute('aria-controls');
    sub = subId ? document.getElementById(subId) : (header.nextElementSibling && header.nextElementSibling.classList.contains('zy-ssub') ? header.nextElementSibling : null);
  } else if (targetEl.classList && targetEl.classList.contains('zy-ssub')) {
    sub = targetEl;
    header = (nav && nav.querySelector ? nav.querySelector(`[aria-controls="${sub.id}"]`) : null) || (sub.previousElementSibling && sub.previousElementSibling.classList.contains('zy-snav') ? sub.previousElementSibling : null);
  } else {
    header = targetEl.closest ? targetEl.closest('.zy-snav') : null;
    if (header) {
      const subId = header.getAttribute('aria-controls');
      sub = subId ? document.getElementById(subId) : (header.nextElementSibling && header.nextElementSibling.classList.contains('zy-ssub') ? header.nextElementSibling : null);
    } else {
      sub = targetEl.closest ? targetEl.closest('.zy-ssub') : null;
      if (sub) {
        header = (nav && nav.querySelector ? nav.querySelector(`[aria-controls="${sub.id}"]`) : null) || (sub.previousElementSibling && sub.previousElementSibling.classList.contains('zy-snav') ? sub.previousElementSibling : null);
      }
    }
  }

  if (!header || !sub) return;

  const wasOpen = sub.classList.contains('open') || header.classList.contains('open') || header.getAttribute('aria-expanded') === 'true';

  // Single-open accordion rule: close all other groups in desktop and mobile drawer
  const allNavs = document.querySelectorAll('.zy-sidenav');
  const scopeList = allNavs && allNavs.length ? Array.from(allNavs) : (nav ? [nav] : [document]);
  scopeList.forEach(scope => {
    scope.querySelectorAll('.zy-snav').forEach(h => {
      if (h !== header) {
        h.classList.remove('open');
        if (h.hasAttribute('aria-expanded')) h.setAttribute('aria-expanded', 'false');
        const otherSubId = h.getAttribute('aria-controls');
        if (otherSubId) {
          const otherSub = document.getElementById(otherSubId);
          if (otherSub && otherSub !== sub) otherSub.classList.remove('open');
        }
      }
    });
    scope.querySelectorAll('.zy-ssub').forEach(s => {
      if (s !== sub) s.classList.remove('open');
    });
  });

  if (wasOpen) {
    header.classList.remove('open');
    header.setAttribute('aria-expanded', 'false');
    sub.classList.remove('open');
  } else {
    header.classList.add('open');
    header.setAttribute('aria-expanded', 'true');
    sub.classList.add('open');
  }
}
window.zyToggleGroup = zyToggleGroup;

function zyToggleAccordion(subId, triggerEl) {
  zyToggleGroup(triggerEl || subId);
}
window.zyToggleAccordion = zyToggleAccordion;

function zySideSub(subId, triggerEl) {
  zyToggleGroup(triggerEl || subId);
}
window.zySideSub = zySideSub;

function zySyncAccordionActive(page) {
  if (!page) return;
  const nav = document.getElementById('zy-sidenav');
  if (!nav) return;

  // 1. Clear previous active highlights
  nav.querySelectorAll('.active').forEach(el => el.classList.remove('active'));

  // 2. Find target element matching page (fallback to role parent map if sub-page isn't directly in sidebar)
  const findTarget = (p) => {
    let el = nav.querySelector(`[data-page="${p}"]`) || document.getElementById(`nav-${p}`);
    if (!el) {
      el = Array.from(nav.querySelectorAll('[onclick]')).find(node => {
        const oc = node.getAttribute('onclick') || '';
        return oc.includes(`'${p}'`) || oc.includes(`"${p}"`);
      });
    }
    return el;
  };

  let target = findTarget(page);
  if (!target) {
    const parentMap = window.OWNER_ROUTE_PARENT || window.AGENT_ROUTE_PARENT || window.CLIENT_ROUTE_PARENT || {};
    const parentPage = parentMap[page];
    if (parentPage && parentPage !== page) target = findTarget(parentPage);
  }

  if (target) {
    target.classList.add('active');

    // If target is inside a submenu (.zy-ssub), open that group and close other groups
    const sub = target.closest ? target.closest('.zy-ssub') : null;
    if (sub) {
      const subId = sub.id;
      const header = (nav && nav.querySelector ? nav.querySelector(`[aria-controls="${subId}"]`) : null) || sub.previousElementSibling;

      document.querySelectorAll('.zy-sidenav').forEach(n => {
        n.querySelectorAll('.zy-snav').forEach(h => {
          if (h !== header) {
            h.classList.remove('open');
            if (h.hasAttribute('aria-expanded')) h.setAttribute('aria-expanded', 'false');
            const otherSubId = h.getAttribute('aria-controls');
            if (otherSubId) {
              const otherSub = document.getElementById(otherSubId);
              if (otherSub && otherSub !== sub) otherSub.classList.remove('open');
            }
          }
        });
        n.querySelectorAll('.zy-ssub').forEach(s => {
          if (s !== sub) s.classList.remove('open');
        });
      });

      if (header) {
        header.classList.add('open');
        header.setAttribute('aria-expanded', 'true');
      }
      sub.classList.add('open');
    } else if (target.classList.contains('zy-snav')) {
      // Top-level item active, close any open groups
      document.querySelectorAll('.zy-sidenav').forEach(n => {
        n.querySelectorAll('.zy-snav').forEach(h => {
          h.classList.remove('open');
          if (h.hasAttribute('aria-expanded')) h.setAttribute('aria-expanded', 'false');
        });
        n.querySelectorAll('.zy-ssub').forEach(s => s.classList.remove('open'));
      });
    }
  }
}
window.zySyncAccordionActive = zySyncAccordionActive;

/* Mobile drawer controls */
window.zyToggleSidebar = function() {
  const isMobile = window.innerWidth < 992;
  if (isMobile) {
    document.body.classList.toggle('sidebar-open');
    const side = document.getElementById('sidebar');
    if (side) side.classList.toggle('mobile-open');
    const backdrop = document.getElementById('zy-side-backdrop');
    if (backdrop) backdrop.classList.toggle('active');
  } else {
    // PC version: sidebar must NEVER hide or collapse per user instructions
    document.body.classList.remove('sidebar-collapsed');
  }
};
window.zyCloseSidebar = function() {
  document.body.classList.remove('sidebar-open');
  const side = document.getElementById('sidebar');
  if (side) side.classList.remove('mobile-open');
  const backdrop = document.getElementById('zy-side-backdrop');
  if (backdrop) backdrop.classList.remove('active');
};

/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — V3 Universal Skeleton Loading Helpers
   Smooth shimmer placeholders during async page transitions
   ═══════════════════════════════════════════════════════════════ */
function zySkeletonLine(cls = '') {
  return `<div class="zy-skeleton zy-skeleton-line ${cls}"></div>`;
}
function zySkeletonBox(height = 36, width = '100%') {
  return `<div class="zy-skeleton" style="height:${height}px;width:${width};border-radius:6px;"></div>`;
}

function zySkeleton(type = 'auto', page = '') {
  const p = String(page || '').toLowerCase();
  let resolvedType = type;
  if (resolvedType === 'auto') {
    if (!p || p.includes('dashboard')) resolvedType = 'dashboard';
    else if (p.includes('report') || p.includes('detailed-sms') || p.includes('summary-sms') || p.includes('my-sms') || p.includes('cdr')) resolvedType = 'report';
    else if (p.startsWith('add-') || p.includes('upload') || p.includes('profile') || p.includes('settings')) resolvedType = 'form';
    else resolvedType = 'table';
  }

  if (resolvedType === 'dashboard') {
    return `
      <div class="zy-skeleton-screen" role="status" aria-busy="true" aria-label="Loading dashboard...">
        <div class="zy-skeleton-kpis">
          ${[1, 2, 3, 4].map(() => `
            <div class="zy-skeleton-kpi">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                ${zySkeletonLine('med')}
                <div class="zy-skeleton" style="width:32px;height:32px;border-radius:8px;"></div>
              </div>
              <div class="zy-skeleton" style="height:28px;width:50%;border-radius:6px;margin:4px 0;"></div>
              ${zySkeletonLine('short')}
            </div>
          `).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px;">
          <div class="zy-skeleton-card" style="height:260px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;justify-content:space-between;">
              ${zySkeletonLine('med')}
              <div class="zy-skeleton" style="width:80px;height:24px;border-radius:6px;"></div>
            </div>
            <div class="zy-skeleton" style="height:170px;width:100%;border-radius:8px;"></div>
          </div>
          <div class="zy-skeleton-card" style="height:260px;display:flex;flex-direction:column;gap:12px;">
            ${zySkeletonLine('short')}
            ${[1, 2, 3, 4, 5].map(() => `
              <div style="display:flex;gap:12px;align-items:center;">
                <div class="zy-skeleton" style="width:24px;height:24px;border-radius:50%;"></div>
                <div style="flex:1;">${zySkeletonLine('full')}${zySkeletonLine('med')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  if (resolvedType === 'report') {
    return `
      <div class="zy-skeleton-screen" role="status" aria-busy="true" aria-label="Loading report...">
        <div class="zy-skeleton-filters">
          <div class="zy-skeleton" style="height:36px;width:160px;border-radius:6px;"></div>
          <div class="zy-skeleton" style="height:36px;width:160px;border-radius:6px;"></div>
          <div class="zy-skeleton" style="height:36px;width:140px;border-radius:6px;"></div>
          <div class="zy-skeleton" style="height:36px;width:100px;border-radius:6px;margin-left:auto;"></div>
        </div>
        <div class="zy-skeleton-kpis" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));">
          ${[1, 2, 3].map(() => `
            <div class="zy-skeleton-kpi" style="padding:14px;">
              ${zySkeletonLine('short')}
              <div class="zy-skeleton" style="height:22px;width:60%;border-radius:4px;"></div>
            </div>
          `).join('')}
        </div>
        <div class="zy-skeleton-card" style="padding:0;overflow:hidden;">
          <table class="zy-skeleton-table">
            <thead>
              <tr style="background:var(--sp-bg-subtle, #f1f5f9);">
                ${[1, 2, 3, 4, 5, 6].map(() => `<th><div class="zy-skeleton" style="height:14px;width:70%;border-radius:4px;"></div></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${[1, 2, 3, 4, 5, 6].map(() => `
                <tr>
                  ${[1, 2, 3, 4, 5, 6].map((i) => `<td><div class="zy-skeleton" style="height:14px;width:${i === 1 ? '85%' : i === 6 ? '50%' : '70%'};border-radius:4px;"></div></td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (resolvedType === 'form') {
    return `
      <div class="zy-skeleton-screen" role="status" aria-busy="true" aria-label="Loading form...">
        <div class="zy-skeleton-card" style="max-width:760px;margin:0 auto;width:100%;display:flex;flex-direction:column;gap:18px;">
          <div style="border-bottom:1px solid var(--sp-border, #e2e8f0);padding-bottom:12px;">
            <div class="zy-skeleton" style="height:24px;width:40%;border-radius:6px;margin-bottom:8px;"></div>
            ${zySkeletonLine('med')}
          </div>
          ${[1, 2, 3, 4].map(() => `
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${zySkeletonLine('short')}
              <div class="zy-skeleton" style="height:38px;width:100%;border-radius:6px;"></div>
            </div>
          `).join('')}
          <div style="display:flex;gap:12px;margin-top:8px;">
            <div class="zy-skeleton" style="height:40px;width:120px;border-radius:6px;"></div>
            <div class="zy-skeleton" style="height:40px;width:90px;border-radius:6px;"></div>
          </div>
        </div>
      </div>
    `;
  }

  // Default: Table / List
  return `
    <div class="zy-skeleton-screen" role="status" aria-busy="true" aria-label="Loading content...">
      <div class="zy-skeleton-filters">
        <div class="zy-skeleton" style="height:36px;width:220px;border-radius:6px;"></div>
        <div class="zy-skeleton" style="height:36px;width:150px;border-radius:6px;"></div>
        <div class="zy-skeleton" style="height:36px;width:130px;border-radius:6px;"></div>
        <div class="zy-skeleton" style="height:36px;width:100px;border-radius:6px;margin-left:auto;"></div>
      </div>
      <div class="zy-skeleton-card" style="padding:0;overflow:hidden;">
        <table class="zy-skeleton-table">
          <thead>
            <tr style="background:var(--sp-bg-subtle, #f1f5f9);">
              ${[1, 2, 3, 4, 5].map(() => `<th><div class="zy-skeleton" style="height:14px;width:65%;border-radius:4px;"></div></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${[1, 2, 3, 4, 5, 6, 7].map(() => `
              <tr>
                ${[1, 2, 3, 4, 5].map((i) => `<td><div class="zy-skeleton" style="height:14px;width:${i === 1 ? '90%' : i === 5 ? '40%' : '75%'};border-radius:4px;"></div></td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
window.zySkeleton = zySkeleton;

function zyShowSkeleton(page, targetId = 'page-content') {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.innerHTML = zySkeleton('auto', page);
}
window.zyShowSkeleton = zyShowSkeleton;

/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — V4 Dashboard Helpers (Breadcrumb, UTC Clock, KPI Cards, SVG Sparklines, Recent SMS)
   ═══════════════════════════════════════════════════════════════ */

/* 1. Live Panel Timezone Clock & Formatting Engine */
function zyGetPanelTimezone() {
  let tz = 'UTC';
  try {
    const s = window.__BRAND_SETTINGS__ || JSON.parse(localStorage.getItem('app_brand_settings') || '{}');
    if (s && s.timezone) tz = s.timezone;
  } catch (_) {}
  return tz;
}
window.zyGetPanelTimezone = zyGetPanelTimezone;

function zyFormatUtc(d = new Date(), withTz = false) {
  if (!d) d = new Date();
  if (!(d instanceof Date)) d = new Date(d);
  if (isNaN(d.getTime())) return '—';

  const tz = zyGetPanelTimezone();

  if (tz === 'UTC') {
    const p = n => String(n).padStart(2, '0');
    const base = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    return withTz ? `${base} (UTC)` : base;
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(d);
    const get = type => (parts.find(p => p.type === type) || {}).value || '';
    const base = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
    return withTz ? `${base} (${tz.split('/').pop().replace(/_/g, ' ')})` : base;
  } catch (e) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }
}
window.zyFormatUtc = zyFormatUtc;
window.zyFormatPanelTime = zyFormatUtc;

function zyFormatShortTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return zyFormatUtc(d, false);
  } catch {
    return '—';
  }
}
window.zyFormatShortTime = zyFormatShortTime;

function zyUpdateClockLive() {
  const tz = zyGetPanelTimezone();
  const now = new Date();
  const str = zyFormatUtc(now, false);

  document.querySelectorAll('#zy-utc-time, .zy-utc-live').forEach(el => {
    el.textContent = str;
  });
  const sideClock = document.getElementById('zy-clock');
  if (sideClock) {
    sideClock.textContent = str;
    sideClock.title = `Panel Timezone: ${tz}`;
  }
  const tzLabel = document.getElementById('zy-tz-label');
  if (tzLabel) {
    tzLabel.textContent = tz === 'UTC' ? 'UTC' : tz.split('/').pop().replace(/_/g, ' ');
  }
}
window.zyUpdateClockLive = zyUpdateClockLive;

function zyStartUtcClock() {
  zyUpdateClockLive();
  if (!window._zyUtcInterval) {
    window._zyUtcInterval = setInterval(zyUpdateClockLive, 1000);
  }
}
window.zyStartUtcClock = zyStartUtcClock;

// Auto-start UTC clock
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', zyStartUtcClock);
  } else {
    zyStartUtcClock();
  }
}

/* 2. Breadcrumb Sync Helper */
function zyUpdateBreadcrumb(page, label) {
  const crumb = document.querySelector('.zy-crumb');
  if (!crumb) return;
  const isDash = !page || page === 'dashboard';
  const resolved = label ||
    (window.ZY_ADMIN_LABELS && window.ZY_ADMIN_LABELS[page]) ||
    (window.ZY_LABELS && window.ZY_LABELS[page]);
  const displayLabel = resolved || (page
    ? String(page).split('-').map(w => w ? (w.charAt(0).toUpperCase() + w.slice(1)) : '').join(' ')
    : 'Dashboard');
  const dashHref = (typeof window.zyPageUrl === 'function') ? window.zyPageUrl('dashboard') : '#';
  const homeAnchor = `<a href="${zyEsc(dashHref)}" data-page="dashboard" onclick="return window.zyNavClick ? window.zyNavClick(event, 'dashboard') : (event.preventDefault(), loadPage('dashboard'), false)">Home</a>`;
  const leftHtml = isDash
    ? `${homeAnchor}<span class="zy-sep">&raquo;</span><span id="breadcrumb" class="zy-breadcrumb-current" data-breadcrumb="1">Dashboard</span>`
    : `${homeAnchor}<span class="zy-sep">&raquo;</span><span id="breadcrumb" class="zy-breadcrumb-current" data-breadcrumb="1">${zyEsc(displayLabel)}</span>`;

  const leftContainer = crumb.querySelector('.zy-crumb-left');
  if (leftContainer) {
    leftContainer.innerHTML = leftHtml;
  } else {
    crumb.innerHTML = `<div class="zy-crumb-left">${leftHtml}</div>`;
  }
}
window.zyUpdateBreadcrumb = zyUpdateBreadcrumb;

/* 3. Responsive SVG Sparkline Generator */
function zySparklineSvg(data = [], options = {}) {
  const width = options.width || 100;
  const height = options.height || 32;
  const stroke = options.stroke || 'var(--sp-primary, #166534)';
  const fill = options.fill || stroke;
  const fillOpacity = options.fillOpacity != null ? options.fillOpacity : 0.15;
  const strokeWidth = options.strokeWidth || 2;

  const rawVals = Array.isArray(data) ? data.map(Number) : [];
  const vals = rawVals.length >= 2 ? rawVals : [0, 0, 0, 0, 0, 0, 0];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = (max - min) || 1;
  const padX = 2;
  const padY = 3;
  const w = width - (padX * 2);
  const h = height - (padY * 2);

  const points = vals.map((v, i) => {
    const x = padX + (i / Math.max(1, vals.length - 1)) * w;
    const y = padY + h - ((v - min) / range) * h;
    return [x.toFixed(1), y.toFixed(1)];
  });

  const polylinePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.join(',')).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${polylinePath} L ${last[0]},${height} L ${first[0]},${height} Z`;
  const gradId = 'spk-' + Math.random().toString(36).slice(2, 8);

  return `
    <svg class="zy-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="overflow:visible;display:block;">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${fill}" stop-opacity="${fillOpacity}"/>
          <stop offset="100%" stop-color="${fill}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gradId})"/>
      <path d="${polylinePath}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${stroke}"/>
    </svg>
  `;
}
window.zySparklineSvg = zySparklineSvg;

/* 4. Modern KPI Card Renderer */
function zyKpiCard(cfg) {
  const title = cfg.title || 'Metric';
  const val = cfg.value != null ? cfg.value : '0';
  const icon = cfg.icon || 'fa-chart-line';
  const color = cfg.color || 'var(--sp-primary, #166534)';
  const bgLight = cfg.bgLight || 'rgba(22, 101, 52, 0.1)';
  const trend = cfg.trend || '';
  const trendDir = cfg.trendDir || 'up';
  const subtitle = cfg.subtitle || '';
  const click = cfg.onClick ? `onclick="${cfg.onClick}" style="cursor:pointer;"` : '';
  const sparkData = cfg.sparklineData || [12, 19, 15, 25, 22, 30, 28];
  const sparklineHtml = zySparklineSvg(sparkData, { stroke: color, fill: color });

  const trendIcon = trendDir === 'up' ? 'fa-arrow-trend-up' : trendDir === 'down' ? 'fa-arrow-trend-down' : 'fa-minus';

  return `
    <div class="zy-kpi-card stat-card" ${click}>
      <div class="zy-kpi-head">
        <span class="zy-kpi-title stat-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${title}</span>
        <span class="zy-kpi-icon" style="background:${bgLight};color:${color};">
          <i class="fas ${icon}"></i>
        </span>
      </div>
      <div class="zy-kpi-body">
        <div class="zy-kpi-value stat-value" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${val}</div>
        <div class="zy-kpi-sparkline-wrap">${sparklineHtml}</div>
      </div>
      ${(trend || subtitle) ? `
      <div class="zy-kpi-foot stat-subtext" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${trend ? `<span class="zy-kpi-trend ${trendDir}"><i class="fas ${trendIcon}"></i> ${trend}</span>` : ''}
        ${subtitle ? `<span>${subtitle}</span>` : ''}
      </div>` : ''}
    </div>
  `;
}
window.zyKpiCard = zyKpiCard;

/* Live Bell Notification Unread Count Updater */
window.zyUpdateNotificationBadge = function (count) {
  const n = Math.max(0, Number(count || 0));
  document.querySelectorAll('.zy-bell-badge').forEach(el => {
    if (n > 0) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.style.display = 'inline-flex';
    } else {
      el.textContent = '0';
      el.style.display = 'none';
    }
  });
};

/* Clean Number & Money Formatter (Removes trailing zeros: 0.0190 -> 0.019, 0.0200 -> 0.02, 15.00 -> 15) */
function zyFmtMoney(val, maxDecimals = 6) {
  if (val === null || val === undefined || val === '') return '0';
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '0';
  const fixed = n.toFixed(maxDecimals);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}
function zyFmtMoneyComma(val, maxDecimals = 4) {
  const clean = zyFmtMoney(val, maxDecimals);
  const parts = clean.split('.');
  const isNeg = parts[0].startsWith('-');
  const absInt = isNeg ? parts[0].slice(1) : parts[0];
  const withCommas = (isNeg ? '-' : '') + absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.length > 1 ? `${withCommas}.${parts[1]}` : withCommas;
}
window.zyFmtMoney = zyFmtMoney;
window.cleanMoney = zyFmtMoney;
window.zyFmtMoneyComma = zyFmtMoneyComma;
window.zyFmtPkr = function(val, maxDecimals = 4) { return zyFmtMoneyComma(val, maxDecimals); };

/* 5. Recent SMS Live Stream Card */
function zyRecentSmsCard(logs = [], options = {}) {
  const title = options.title || 'Recent SMS Stream';
  const onRefresh = options.onRefresh || "loadPage('dashboard')";
  const onViewAll = options.onViewAll || "loadPage('detailed-sms')";
  const list = Array.isArray(logs) ? logs.slice(0, options.limit || 8) : [];

  const rowsHtml = list.length > 0 ? list.map(sms => {
    const ts = String(sms.timestamp || sms.created || sms.time || '').replace('T', ' ').slice(0, 19) || 'Just now';
    const cli = String(sms.cli || sms.app || sms.sender || '—');
    const num = String(sms.number || sms.destination || '—');
    const msg = String(sms.message || sms.otp || sms.text || sms.content || '—');
    const st = String(sms.status || 'DELIVRD').toUpperCase();
    const pillClass = (st === 'DELIVRD' || st === 'DELIVERED' || st === 'ACTIVE')
      ? 'zy-status-delivrd'
      : (st === 'PENDING' || st === 'SUBMITTED')
      ? 'zy-status-pending'
      : 'zy-status-failed';
    const dotColor = (st === 'DELIVRD' || st === 'DELIVERED') ? '#10b981' : st === 'PENDING' ? '#f59e0b' : '#ef4444';

    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;color:var(--sp-text-muted);white-space:nowrap;">${zyEsc(ts)}</td>
        <td><span class="badge" style="background:var(--sp-bg-subtle);color:var(--sp-text-primary);border:1px solid var(--sp-border);font-family:monospace;font-weight:600;">${zyEsc(cli)}</span></td>
        <td style="font-family:monospace;font-weight:600;">${zyEsc(num)}</td>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${zyEsc(msg)}">${zyEsc(msg)}</td>
        <td>
          <span class="zy-status-pill ${pillClass}">
            <span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
            ${zyEsc(st)}
          </span>
        </td>
      </tr>
    `;
  }).join('') : `
    <tr>
      <td colspan="5" style="text-align:center;padding:28px 12px;color:var(--sp-text-muted);">
        <i class="fas fa-inbox" style="font-size:24px;margin-bottom:8px;display:block;opacity:0.6;"></i>
        No recent SMS activity yet. Waiting for live traffic.
      </td>
    </tr>
  `;

  return `
    <div class="zy-panel" style="margin-top:20px;">
      <div class="zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981;display:inline-block;"></span>
          <span style="font-weight:700;color:var(--sp-text-primary);">${title}</span>
          <span class="badge" style="background:var(--sp-bg-subtle);color:var(--sp-text-secondary);font-size:11px;">Live</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="sp-btn sp-btn-secondary sp-btn-sm" onclick="${onViewAll}">
            View All Reports <i class="fas fa-arrow-right" style="font-size:10px;margin-left:4px;"></i>
          </button>
        </div>
      </div>
      <div class="zy-panel-body" style="padding:0;overflow-x:auto;">
        <table class="zy-recent-sms-table">
          <thead>
            <tr>
              <th style="width:140px;">Time (UTC)</th>
              <th style="width:110px;">Sender / CLI</th>
              <th style="width:130px;">Destination</th>
              <th>Message Snippet / OTP</th>
              <th style="width:110px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
window.zyRecentSmsCard = zyRecentSmsCard;

/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — V5 CDR & Show Report Helpers
   Date Presets, Tabs, Interactive Group-By Chips, Total Row
   ═══════════════════════════════════════════════════════════════ */

/* 1. Date Range Presets */
const zyDatePresetsList = [
  { key: 'today',      label: 'Today',        icon: 'fa-calendar-day' },
  { key: 'yesterday',  label: 'Yesterday',    icon: 'fa-clock-rotate-left' },
  { key: 'this_week',  label: 'This Week',    icon: 'fa-calendar-week' },
  { key: 'last_7',     label: 'Last 7 Days',  icon: 'fa-calendar-days' },
  { key: 'this_month', label: 'This Month',   icon: 'fa-calendar' },
  { key: 'last_30',    label: 'Last 30 Days', icon: 'fa-chart-line' }
];
window.zyDatePresetsList = zyDatePresetsList;

function zyPad2(n) {
  return String(n).padStart(2, '0');
}
window.zyPad2 = zyPad2;

function zyFormatDateStr(d) {
  return `${d.getUTCFullYear()}-${zyPad2(d.getUTCMonth() + 1)}-${zyPad2(d.getUTCDate())}`;
}
window.zyFormatDateStr = zyFormatDateStr;

function zyGetDatePresetRange(key) {
  const now = new Date();
  const baseUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let fromD = new Date(baseUtc.getTime());
  let toD = new Date(baseUtc.getTime());

  switch (key) {
    case 'today':
      break;
    case 'yesterday':
      fromD.setUTCDate(fromD.getUTCDate() - 1);
      toD.setUTCDate(toD.getUTCDate() - 1);
      break;
    case 'this_week': {
      const day = fromD.getUTCDay(); // 0 is Sun
      const diff = fromD.getUTCDate() - day + (day === 0 ? -6 : 1); // Monday UTC
      fromD.setUTCDate(diff);
      break;
    }
    case 'last_7':
      fromD.setUTCDate(fromD.getUTCDate() - 6);
      break;
    case 'this_month':
      fromD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case 'last_30':
      fromD.setUTCDate(fromD.getUTCDate() - 29);
      break;
    default:
      break;
  }

  const fromDate = zyFormatDateStr(fromD);
  const toDate = zyFormatDateStr(toD);
  return {
    key,
    fromDate,
    toDate,
    fromDateTime: `${fromDate} 00:00:00`,
    toDateTime: `${toDate} 23:59:59`
  };
}
window.zyGetDatePresetRange = zyGetDatePresetRange;

function zyApplyDatePreset(key, fromId = 'rp-from', toId = 'rp-to', chipContainer = null) {
  const range = zyGetDatePresetRange(key);
  const fromEl = document.getElementById(fromId);
  const toEl = document.getElementById(toId);

  if (fromEl) {
    if (fromEl.type === 'date') fromEl.value = range.fromDate;
    else fromEl.value = range.fromDateTime;
  }
  if (toEl) {
    if (toEl.type === 'date') toEl.value = range.toDate;
    else toEl.value = range.toDateTime;
  }

  // Update active chip UI
  const root = chipContainer ? (typeof chipContainer === 'string' ? document.querySelector(chipContainer) : chipContainer) : document;
  if (root) {
    root.querySelectorAll('.zy-preset-chip').forEach(chip => {
      if (chip.getAttribute('data-preset') === key) {
        chip.classList.add('active');
        chip.setAttribute('aria-pressed', 'true');
      } else {
        chip.classList.remove('active');
        chip.setAttribute('aria-pressed', 'false');
      }
    });
  }
  return range;
}
window.zyApplyDatePreset = zyApplyDatePreset;

function zyRenderDatePresets(activeKey = 'today', onSelectFn = 'zyApplyDatePreset') {
  return `
    <div class="zy-date-presets" role="toolbar" aria-label="Date range quick presets">
      <span class="zy-presets-label"><i class="fas fa-bolt"></i> Presets:</span>
      ${zyDatePresetsList.map(p => {
        const isActive = p.key === activeKey;
        const call = typeof onSelectFn === 'string' ? `${onSelectFn}('${p.key}')` : '';
        return `
          <button type="button" class="zy-preset-chip ${isActive ? 'active' : ''}"
                  data-preset="${p.key}"
                  role="button"
                  aria-pressed="${isActive}"
                  ${call ? `onclick="${call}"` : ''}>
            <i class="fas ${p.icon}" style="font-size:10px;opacity:0.85;"></i>
            ${p.label}
          </button>
        `;
      }).join('')}
    </div>
  `;
}
window.zyRenderDatePresets = zyRenderDatePresets;

/* 2. Modern CDR Navigation Tabs */
function zyCdrTabs(tabs = [], activeTab = '', onSwitchFn = 'zySwitchCdrTab') {
  const list = tabs && tabs.length ? tabs : [
    { id: 'detailed', label: 'Detailed Records', icon: 'fa-list-check' },
    { id: 'grouped',  label: 'Grouped Summary',  icon: 'fa-layer-group' }
  ];
  const cur = activeTab || list[0].id;

  return `
    <div class="zy-cdr-tabs" role="tablist" aria-label="CDR Report View Tabs">
      ${list.map(t => {
        const isActive = t.id === cur;
        const call = typeof onSwitchFn === 'string' ? `${onSwitchFn}('${t.id}')` : '';
        return `
          <button type="button" class="zy-cdr-tab ${isActive ? 'active' : ''}"
                  id="tab-${t.id}"
                  role="tab"
                  aria-selected="${isActive}"
                  aria-controls="panel-${t.id}"
                  ${call ? `onclick="${call}"` : ''}>
            <i class="fas ${t.icon || 'fa-chart-pie'}"></i>
            <span>${t.label}</span>
            ${t.badge != null ? `<span class="zy-cdr-tab-badge">${t.badge}</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>
  `;
}
window.zyCdrTabs = zyCdrTabs;

/* 3. Interactive Group-By Chips */
function zyToggleGroupChip(chipEl) {
  if (!chipEl) return;
  const cb = chipEl.querySelector('input[type="checkbox"]');
  if (cb) {
    cb.checked = !cb.checked;
    if (cb.checked) {
      chipEl.classList.add('active');
      chipEl.setAttribute('aria-checked', 'true');
    } else {
      chipEl.classList.remove('active');
      chipEl.setAttribute('aria-checked', 'false');
    }
    const evt = new Event('change', { bubbles: true });
    cb.dispatchEvent(evt);
  }
}
window.zyToggleGroupChip = zyToggleGroupChip;

function zyRenderGroupChips(dimensions = [], activeList = []) {
  const dims = dimensions && dimensions.length ? dimensions : ['Date', 'Month', 'Range', 'Client', 'Number', 'CLI'];
  const activeSet = new Set((activeList || []).map(s => String(s).toLowerCase()));

  return `
    <div class="zy-groupby-row">
      <span class="zy-groupby-label"><i class="fas fa-layer-group"></i> <b>Group By:</b></span>
      <div class="zy-group-chips" role="group" aria-label="Group by dimensions">
        ${dims.map(d => {
          const val = d.toLowerCase();
          const isActive = activeSet.has(val);
          return `
            <div class="zy-group-chip ${isActive ? 'active' : ''}"
                 role="checkbox"
                 tabindex="0"
                 aria-checked="${isActive}"
                 onclick="zyToggleGroupChip(this)"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();zyToggleGroupChip(this);}">
              <i class="fas fa-check zy-chip-check"></i>
              <span>${d}</span>
              <input type="checkbox" class="grp-chk" value="${val}" ${isActive ? 'checked' : ''} style="display:none;" onclick="event.stopPropagation();">
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}
window.zyRenderGroupChips = zyRenderGroupChips;

/* 4. Comprehensive CDR Table Total Row Builder */
function zyBuildCdrTotalRow(data = [], isGrouped = false, options = {}) {
  const sum = options && options.summary ? options.summary : null;
  const list = Array.isArray(data) ? data : [];
  const count = (sum && sum.total_groups != null && isGrouped) ? sum.total_groups : list.length;
  const totalSms = (sum && sum.total_sms != null) ? sum.total_sms : list.reduce((s, item) => s + (Number(item.sms_count || item.count || 1) || 0), 0);
  const totalPayout = (sum && sum.payout != null) ? Number(sum.payout) : list.reduce((s, item) => s + (parseFloat(item.payout || item.my_payout || 0) || 0), 0);
  const totalClientPayout = (sum && sum.client_payout != null) ? Number(sum.client_payout) : list.reduce((s, item) => s + (parseFloat(item.client_payout || item.agent_payout || 0) || 0), 0);
  const totalProfit = (sum && sum.profit != null) ? Number(sum.profit) : list.reduce((s, item) => {
    if (item.profit != null) return s + (parseFloat(item.profit) || 0);
    const p = parseFloat(item.payout || item.my_payout || 0) || 0;
    const cp = parseFloat(item.client_payout || item.agent_payout || 0) || 0;
    return s + (p - cp);
  }, 0);

  const profitCls = totalProfit >= 0 ? 'zy-total-profit-pos' : 'zy-total-profit-neg';

  return {
    totalSms,
    totalPayout,
    totalClientPayout,
    totalProfit,
    count,
    formatted: {
      smsBadge: `<span class="zy-total-badge"><i class="fas fa-comment-sms"></i> Total SMS: <b>${totalSms.toLocaleString()}</b></span>`,
      groupsBadge: `<span class="zy-total-badge"><i class="fas fa-layer-group"></i> Total Groups: <b>${count.toLocaleString()}</b></span>`,
      payout: `$${zyFmtMoney(totalPayout, 4)}`,
      clientPayout: `$${zyFmtMoney(totalClientPayout, 4)}`,
      profit: `<span class="${profitCls}">$${zyFmtMoney(totalProfit, 4)}</span>`
    }
  };
}
window.zyBuildCdrTotalRow = zyBuildCdrTotalRow;

/* 5. Streaming CDR CSV Export Helper */
function zyExportCdrStream(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v != null && v !== '') params.append(k, v);
  });
  params.append('export', 'csv');
  const url = `/api/sms/export?${params.toString()}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `sms_cdr_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
window.zyExportCdrStream = zyExportCdrStream;

/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — V6 Numbers Pages & Bulk Queue Helpers
   Selection Bar, Actions Toolbar, Bulk Add Queue Manager
   ═══════════════════════════════════════════════════════════════ */

function zyRunSelectionAction(fnExpr) {
  if (!fnExpr) return;
  if (typeof fnExpr === 'function') {
    fnExpr();
    return;
  }
  const parts = String(fnExpr).split('||').map(s => (s || '').trim()).filter(Boolean);
  for (const p of parts) {
    if (typeof window[p] === 'function') {
      window[p]();
      return;
    }
  }
}
window.zyRunSelectionAction = zyRunSelectionAction;

/* 1. Dynamic Numbers Selection Bar */
function zySyncSelectionBar(tableId = 'dt-numbers', customActions = null) {
  const tableEl = document.getElementById(tableId);
  if (!tableEl) return;
  let bar = document.getElementById(`zy-sel-bar-${tableId}`);

  const ids = (typeof zy2Checked === 'function') ? zy2Checked(tableId) : [];
  const count = ids.length;

  if (count === 0) {
    if (bar) bar.style.display = 'none';
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.id = `zy-sel-bar-${tableId}`;
    bar.className = 'zy-selection-bar';
    tableEl.parentNode.insertBefore(bar, tableEl);
  }

  bar.style.display = 'flex';

  const defaultActions = customActions || [
    { label: 'Allocate', icon: 'fa-user-plus', cls: 'sp-btn-primary', fn: 'zyOwnerAllocateAll || zyActionAllocate || zyAllocateAll' },
    { label: 'Unallocate', icon: 'fa-rotate-left', cls: 'sp-btn-secondary', fn: 'zyOwnerUnallocateAll || zyActionUnallocate || zyUnassignSelected' },
    { label: 'Return', icon: 'fa-arrow-up', cls: 'sp-btn-danger', fn: 'zyActionReturn || zyReturnSelected || zyOwnerDeleteAll' },
    { label: 'Move', icon: 'fa-right-left', cls: 'sp-btn-ghost', fn: 'zyActionMove' }
  ];

  bar.innerHTML = `
    <div class="zy-selection-info">
      <span class="zy-selected-counter">
        <i class="fas fa-check-double"></i>
        <span><b>${count}</b> number${count === 1 ? '' : 's'} selected</span>
      </span>
      <button class="sp-btn sp-btn-ghost sp-btn-sm" onclick="document.querySelectorAll('.zy-cb-${tableId}').forEach(c=>c.checked=false);zySyncSelectionBar('${tableId}');" style="font-size:11px;">
        Clear selection
      </button>
    </div>
    <div class="zy-selection-actions">
      ${defaultActions.map(act => {
        const fnStr = typeof act.fn === 'string' ? act.fn : '';
        return `
        <button class="sp-btn ${act.cls || 'sp-btn-secondary'} sp-btn-sm"
                onclick="window.zyRunSelectionAction('${fnStr.replace(/'/g, "\\'")}')">
          <i class="fas ${act.icon}" style="margin-right:4px;"></i>
          ${act.label}
        </button>
      `;
      }).join('')}
    </div>
  `;
}
window.zySyncSelectionBar = zySyncSelectionBar;

/* 2. Bulk Add Queue Manager */
function zyRenderBulkQueueCard(jobs = [], poolStats = {}) {
  const availCount = poolStats.available || 0;
  const availCls = availCount > 50 ? 'high' : availCount > 0 ? 'low' : 'none';

  const rowsHtml = jobs && jobs.length ? jobs.map(j => {
    const status = (j.status || 'QUEUED').toUpperCase();
    const stCls = status === 'COMPLETED' ? 'completed' : status === 'PROCESSING' ? 'processing' : status === 'FAILED' ? 'failed' : 'queued';
    const percent = Math.min(100, Math.round(((j.allocated || 0) / Math.max(1, j.requested || 1)) * 100));

    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;">${j.id || 'JOB-' + Math.random().toString(36).slice(2, 7).toUpperCase()}</td>
        <td><b>${j.client_name || j.client || '—'}</b></td>
        <td><span class="badge" style="background:var(--sp-bg-subtle);">${j.range_name || j.range || 'All'}</span></td>
        <td style="font-family:monospace;">${j.allocated || 0} / ${j.requested || 0}</td>
        <td style="width:140px;">
          <span class="zy-queue-status ${stCls}">${status}</span>
          <div class="zy-queue-progress">
            <div class="zy-queue-progress-bar" style="width:${percent}%;"></div>
          </div>
        </td>
        <td style="font-size:11px;color:var(--sp-text-muted);">${j.created_at || 'Just now'}</td>
      </tr>
    `;
  }).join('') : `
    <tr>
      <td colspan="6" style="text-align:center;padding:24px;color:var(--sp-text-muted);">
        <i class="fas fa-inbox" style="font-size:24px;display:block;margin-bottom:6px;opacity:0.6;"></i>
        No active bulk add jobs. Submit a job above to queue numbers.
      </td>
    </tr>
  `;

  return `
    <div class="zy-panel" style="margin-top:20px;">
      <div class="zy-panel-head" style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-list-check" style="color:var(--sp-primary);"></i>
          <span>Bulk Add Queue &amp; Recent Allocations</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="zy-pool-avail-badge ${availCls}">
            <i class="fas fa-cubes"></i> Pool Available: <b>${availCount}</b>
          </span>
        </div>
      </div>
      <div class="zy-panel-body" style="padding:0;overflow-x:auto;">
        <table class="zy-bulk-queue-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Target Client</th>
              <th>Range</th>
              <th>Progress</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
window.zyRenderBulkQueueCard = zyRenderBulkQueueCard;

/* ═══════════════════════════════════════════════════════════════
   HUMEX SMS — V7: PAYTERM LIST & POLISH & EMPTY/LOADING STATES
   ═══════════════════════════════════════════════════════════════ */

const ZY_DEFAULT_MASTER_PAYTERMS = [
  'Weekly',
  'Monthly'
];

const ZY_PAYTERM_ALIAS_MAP = {
  'Weekly': 'Weekly',
  'weekly': 'Weekly',
  '7/3': 'Weekly',
  'Weekly (7/3)': 'Weekly',
  'weekly (7/3)': 'Weekly',
  'weekly7_3': 'Weekly',
  'Monthly': 'Monthly',
  'monthly': 'Monthly',
  '30/5': 'Monthly',
  '30/5 {W}': 'Monthly',
  'Monthly (30/5) {W}': 'Monthly',
  'monthly (30/5) {w}': 'Monthly',
  'monthly30_5': 'Monthly'
};

function zyMasterPaytermsList() {
  if (typeof window !== 'undefined' && Array.isArray(window._masterPayterms) && window._masterPayterms.length) {
    const filtered = window._masterPayterms.filter(m => !String(m).toLowerCase().includes('biweek') && String(m) !== '15/3');
    if (filtered.length) return filtered;
  }
  return ZY_DEFAULT_MASTER_PAYTERMS;
}

function zyNormalizePayterm(term) {
  if (!term) return 'Weekly';
  const raw = String(term).trim();
  if (ZY_PAYTERM_ALIAS_MAP[raw]) return ZY_PAYTERM_ALIAS_MAP[raw];
  const lower = raw.toLowerCase();
  if (ZY_PAYTERM_ALIAS_MAP[lower]) return ZY_PAYTERM_ALIAS_MAP[lower];
  if (lower.includes('month') || lower.includes('30/5')) return 'Monthly';
  return 'Weekly';
}

function zyGetMonthlyHoldDays() {
  try {
    const bs = (typeof window !== 'undefined' && window.__BRAND_SETTINGS__) ? window.__BRAND_SETTINGS__ : null;
    const h = bs?.monthly_cycle?.hold_days;
    if (h !== undefined && h !== null && h !== '' && Number.isFinite(Number(h))) {
      return Math.max(0, Math.min(90, Math.round(Number(h))));
    }
    if (typeof localStorage !== 'undefined') {
      const saved = JSON.parse(localStorage.getItem('app_brand_settings') || '{}');
      const sh = saved?.monthly_cycle?.hold_days;
      if (sh !== undefined && sh !== null && sh !== '' && Number.isFinite(Number(sh))) {
        return Math.max(0, Math.min(90, Math.round(Number(sh))));
      }
    }
  } catch (_) {}
  return 5;
}

function zyGetMonthlyScheduleLabel() {
  const hd = zyGetMonthlyHoldDays();
  return hd === 5 ? 'Monthly (30/5) {W}' : `Monthly (30/${hd}) {W}`;
}

function zyRenderPaytermOptions(selectedTerm = '', customList = null) {
  const norm = zyNormalizePayterm(selectedTerm);
  const isMonthly = norm === 'Monthly';
  const mLabel = zyGetMonthlyScheduleLabel();
  return `
    <option value="Weekly" ${!isMonthly ? 'selected' : ''}>Weekly (7/3)</option>
    <option value="Monthly" ${isMonthly ? 'selected' : ''}>${mLabel}</option>
  `;
}

function zyPaytermBadge(term) {
  if (!term) return '';
  const norm = zyNormalizePayterm(term);
  const isMonthly = norm === 'Monthly';
  const label = isMonthly ? zyGetMonthlyScheduleLabel() : 'Weekly (7/3)';
  const slug = isMonthly ? 'monthly' : 'weekly';
  const icon = isMonthly ? 'fa-calendar-check' : 'fa-calendar-week';
  return `<span class="zy-payterm-badge zy-pt-${slug}"><i class="fas ${icon}"></i> ${label}</span>`;
}

function zyEmptyState(options = {}) {
  const icon = options.icon || 'fa-folder-open';
  const title = options.title || 'No data found';
  const desc = options.desc || 'There are no records to display matching your criteria.';
  const actionLabel = options.actionLabel || options.btnLabel || '';
  const actionOnClick = options.actionOnClick || options.onClick || '';

  return `
    <div class="zy-empty-state">
      <div class="zy-empty-icon"><i class="fas ${icon}"></i></div>
      <div class="zy-empty-title">${title}</div>
      <div class="zy-empty-desc">${desc}</div>
      ${actionLabel && actionOnClick ? `
        <div class="zy-empty-action">
          <button class="sp-btn sp-btn-primary" onclick="${actionOnClick}">
            ${actionLabel}
          </button>
        </div>` : ''}
    </div>
  `;
}

function zyLoadingSpinner(text = 'Loading data, please wait…') {
  return `
    <div class="zy-loading-wrap" role="status" aria-live="polite">
      <div class="zy-loading-spinner" aria-hidden="true"></div>
      <div class="zy-loading-text">${text}</div>
    </div>
  `;
}

function zyShowLoading(containerId, text = 'Loading data, please wait…') {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return;
  const existing = el.querySelector('.zy-loading-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'zy-loading-overlay';
  overlay.id = `zy-loading-overlay-${typeof containerId === 'string' ? containerId : 'elem'}`;
  overlay.innerHTML = zyLoadingSpinner(text);
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    if (window.getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
  }
  el.appendChild(overlay);
}

function zyHideLoading(containerId) {
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) return;
  const overlay = el.querySelector('.zy-loading-overlay') || (typeof document !== 'undefined' && document.getElementById(`zy-loading-overlay-${containerId}`));
  if (overlay) overlay.remove();
}

window.ZY_DEFAULT_MASTER_PAYTERMS = ZY_DEFAULT_MASTER_PAYTERMS;
window.ZY_PAYTERM_ALIAS_MAP = ZY_PAYTERM_ALIAS_MAP;
window.zyMasterPaytermsList = zyMasterPaytermsList;
window.zyNormalizePayterm = zyNormalizePayterm;
window.zyRenderPaytermOptions = zyRenderPaytermOptions;
window.zyPaytermBadge = zyPaytermBadge;
window.zyEmptyState = zyEmptyState;
window.zyLoadingSpinner = zyLoadingSpinner;
window.zyShowLoading = zyShowLoading;
window.zyHideLoading = zyHideLoading;

/* ═══════════════════════════════════════════════════════════════
   F5: CDR FILTER BAR & UNIFIED .zy-filter-grid COMPONENT HELPERS
   ═══════════════════════════════════════════════════════════════ */

function zyDefaultFromDateTime() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} 00:00:00`;
}

function zyDefaultToDateTime() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} 23:59:59`;
}

function zyRenderCdrFilterGrid(options = {}) {
  const fromVal = options.fromVal || zyDefaultFromDateTime();
  const toVal = options.toVal || zyDefaultToDateTime();
  const rangeOptions = options.rangeOptions || '<option value="">All</option>';
  const clientOptions = options.clientOptions || '<option value="">All</option>';
  const onExport = options.onExport || "typeof zyTriggerCdrExport === 'function' ? zyTriggerCdrExport() : null";
  const onShow = options.onShow || "typeof zyTriggerCdrLoad === 'function' ? zyTriggerCdrLoad() : null";
  const onLimit = options.onLimit || "typeof zyTriggerCdrLoad === 'function' ? zyTriggerCdrLoad() : null";
  const onSearch = options.onSearch || "typeof zyToolbarFilter === 'function' ? zyToolbarFilter(this.value) : null";
  const tableId = options.tableId || 'dt-cdr';
  const selectedLimit = options.selectedLimit || '25';

  const groupChips = [
    { id: 'hour', label: 'Hour', val: 'hour' },
    { id: 'date', label: 'Date', val: 'date' },
    { id: 'month', label: 'Month', val: 'month' },
    { id: 'range', label: 'Range', val: 'range' },
    { id: 'client', label: 'Client', val: 'client' },
    { id: 'number', label: 'Number', val: 'number' },
    { id: 'cli', label: 'CLI', val: 'cli' }
  ];

  const chipsHtml = groupChips.map(c => `
    <label class="zy-chip-pill" for="grp-chip-${c.id}">
      <input type="checkbox" id="grp-chip-${c.id}" class="grp-chk" value="${c.val}" onchange="this.closest('.zy-chip-pill').classList.toggle('active', this.checked)">
      ${c.label}
    </label>
  `).join('');

  return `
    <div class="zy-filter-grid">
      <div class="zy-filter-grid-fields">
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-from">From</label>
          <input type="text" id="rp-from" class="zy-filter-input" value="${fromVal}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-to">To</label>
          <input type="text" id="rp-to" class="zy-filter-input" value="${toVal}" placeholder="YYYY-MM-DD HH:mm:ss" onclick="if(window.zyOpenDatePicker)window.zyOpenDatePicker(this)">
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-range">Range</label>
          <select id="rp-range" class="zy-filter-input">${rangeOptions}</select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="rp-client">Client</label>
          <select id="rp-client" class="zy-filter-input">${clientOptions}</select>
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
            placeholder="Search Date, Provider, Range, Number, CLI, SMS, Cause..."
            autocomplete="off"
            oninput="zyHandleCdrSearchInput(this, 'rp-search-clear', () => { ${onShow} })"
            onkeydown="if(event.key==='Enter'){event.preventDefault();if(window._zyCdrSearchTimer){clearTimeout(window._zyCdrSearchTimer);}${onShow};}">
          <button type="button" id="rp-search-clear" class="zy-groupby-search-clear" title="Clear search" aria-label="Clear search" style="display:none;" onclick="zyClearCdrSearch('rp-search', 'rp-search-clear', () => { ${onShow} })">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="zy-table-toolbar zy-cdr-control-bar">
        <div class="zy-cdr-actions-left">
          <button type="button" class="zy-btn-blue-solid" id="btn-show-report" onclick="${onShow}">
            <i class="fas fa-chart-column"></i> Show Report
          </button>
        </div>
        <div class="zy-toolbar-right">
          <button type="button" class="zy-btn-pill zy-cols-btn" onclick="zyToggleColumnsModal('${tableId}', this)"><i class="fas fa-columns"></i> Columns</button>
          <div class="zy-toolbar-select-wrap">
            <label class="zy-toolbar-label" for="rp-limit">Show Records</label>
            <select id="rp-limit" class="zy-toolbar-select" onchange="${onLimit}">
              <option value="10" ${selectedLimit === '10' ? 'selected' : ''}>10</option>
              <option value="25" ${selectedLimit === '25' || !selectedLimit ? 'selected' : ''}>25</option>
              <option value="50" ${selectedLimit === '50' ? 'selected' : ''}>50</option>
              <option value="100" ${selectedLimit === '100' ? 'selected' : ''}>100</option>
              <option value="500" ${selectedLimit === '500' ? 'selected' : ''}>500</option>
              <option value="1000" ${selectedLimit === '1000' ? 'selected' : ''}>1000</option>
              <option value="2000" ${selectedLimit === '2000' ? 'selected' : ''}>2000</option>
              <option value="5000" ${selectedLimit === '5000' ? 'selected' : ''}>5000</option>
              <option value="10000" ${selectedLimit === '10000' ? 'selected' : ''}>10000</option>
              <option value="all" ${selectedLimit === 'all' ? 'selected' : ''}>All</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `;
}

function zyHandleCdrSearchInput(inputEl, clearBtnId, reloadCb) {
  const clearBtn = clearBtnId ? document.getElementById(clearBtnId) : null;
  if (clearBtn) clearBtn.style.display = (inputEl && inputEl.value.trim()) ? 'inline-flex' : 'none';
  window._zyCdrSearchTimers = window._zyCdrSearchTimers || {};
  const key = (inputEl && inputEl.id) || '_default';
  if (window._zyCdrSearchTimers[key]) clearTimeout(window._zyCdrSearchTimers[key]);
  if (window._zyCdrSearchTimer) clearTimeout(window._zyCdrSearchTimer);
  const t = setTimeout(() => {
    delete window._zyCdrSearchTimers[key];
    if (typeof reloadCb === 'function') reloadCb();
  }, 250);
  window._zyCdrSearchTimers[key] = t;
  window._zyCdrSearchTimer = t;
}
window.zyHandleCdrSearchInput = zyHandleCdrSearchInput;

function zyClearCdrSearch(inputId, clearBtnId, reloadCb) {
  window._zyCdrSearchTimers = window._zyCdrSearchTimers || {};
  if (inputId && window._zyCdrSearchTimers[inputId]) {
    clearTimeout(window._zyCdrSearchTimers[inputId]);
    delete window._zyCdrSearchTimers[inputId];
  }
  if (window._zyCdrSearchTimer) clearTimeout(window._zyCdrSearchTimer);
  const inp = inputId ? document.getElementById(inputId) : null;
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  const clearBtn = clearBtnId ? document.getElementById(clearBtnId) : null;
  if (clearBtn) clearBtn.style.display = 'none';
  if (typeof reloadCb === 'function') reloadCb();
}
window.zyClearCdrSearch = zyClearCdrSearch;

function zyResetCdrFilters(reloadCb) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('rp-from', `${today} 00:00:00`);
  setVal('rp-to', `${today} 23:59:59`);
  ['rp-provider', 'rp-range', 'rp-agent', 'rp-client', 'rp-num', 'rp-cli', 'rp-search'].forEach(id => setVal(id, ''));
  const clearBtn = document.getElementById('rp-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const statusEl = document.getElementById('rp-status');
  if (statusEl) statusEl.value = 'All';
  const limitEl = document.getElementById('rp-limit');
  if (limitEl) limitEl.value = '25';
  document.querySelectorAll('.grp-chk').forEach(cb => {
    cb.checked = false;
    const pill = cb.closest('.zy-chip-pill');
    if (pill) pill.classList.remove('active');
  });
  document.querySelectorAll('.zy-toolbar-search').forEach(inp => { inp.value = ''; });
  if (typeof reloadCb === 'function') reloadCb();
}
window.zyResetCdrFilters = zyResetCdrFilters;

function zyRenderNumbersFilterGrid(options = {}) {
  const rangeOptions = options.rangeOptions || '<option value="">All Ranges</option>';
  const clientOptions = options.clientOptions || '<option value="">All Clients</option>';
  const allocationOptions = options.allocationOptions || '<option value="">All Allocations</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option><option value="active">Active</option><option value="inactive">Inactive</option>';
  const onFilter = options.onFilter || "typeof zyApplyFilters === 'function' ? zyApplyFilters() : null";
  const onReset = options.onReset || "typeof zyResetFilters === 'function' ? zyResetFilters() : null";

  return `
    <div class="zy-filter-grid">
      <div class="zy-filter-grid-fields">
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="num-range">Range</label>
          <select id="num-range" class="zy-filter-input">${rangeOptions}</select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="num-client">Client</label>
          <select id="num-client" class="zy-filter-input">${clientOptions}</select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="num-status">Allocation</label>
          <select id="num-status" class="zy-filter-input">${allocationOptions}</select>
        </div>
        <div class="zy-filter-field">
          <label class="zy-filter-label" for="num-starts-with">Number starts with</label>
          <input type="text" id="num-starts-with" class="zy-filter-input" placeholder="Number starts with...">
        </div>
        <div class="zy-filter-field" style="grid-column: 1 / -1;">
          <label class="zy-filter-label" for="num-range-contains">Range contains</label>
          <input type="text" id="num-range-contains" class="zy-filter-input" placeholder="Range contains...">
        </div>
      </div>

      <div class="zy-filter-actions">
        <button type="button" class="zy-btn-blue-solid" onclick="${onFilter}">
          <i class="fas fa-filter"></i> Filter
        </button>
        <button type="button" class="zy-btn-reset" onclick="${onReset}">
          <i class="fas fa-undo"></i> Reset
        </button>
      </div>
    </div>
  `;
}

function zyExportTableCopy(tableId = 'dt-cdr') {
  if (typeof zy2Export === 'function') {
    zy2Export(tableId, 'copy');
    return;
  }
  const table = document.getElementById(tableId) || document.querySelector('.zy-dt');
  if (!table) return;
  const rows = Array.from(table.querySelectorAll('tr')).map(r =>
    Array.from(r.querySelectorAll('th, td')).map(c => c.textContent.trim()).join('\t')
  ).join('\n');
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(rows).then(() => {
      if (typeof toast === 'function') toast('Table copied to clipboard', 'success');
    }).catch(() => {});
  }
}

function zyExportTableCsv(tableId = 'dt-cdr') {
  if (typeof zyExportCdrStream === 'function' && tableId === 'dt-cdr') {
    const fromEl = document.getElementById('rp-from');
    const toEl = document.getElementById('rp-to');
    const rangeEl = document.getElementById('rp-range');
    const agentEl = document.getElementById('rp-agent');
    const clientEl = document.getElementById('rp-client');
    const numEl = document.getElementById('rp-num');
    const cliEl = document.getElementById('rp-cli');
    const groupCbs = Array.from(document.querySelectorAll('.grp-chk:checked')).map(cb => cb.value).join(',');
    zyExportCdrStream({
      date_from: fromEl ? fromEl.value : '',
      date_to: toEl ? toEl.value : '',
      range: rangeEl ? rangeEl.value : '',
      agent_id: agentEl ? agentEl.value : '',
      client_id: clientEl ? clientEl.value : '',
      search: numEl ? numEl.value : '',
      cli: cliEl ? cliEl.value : '',
      group_by: groupCbs
    });
    return;
  }
  if (typeof zy2Export === 'function') {
    zy2Export(tableId, 'csv');
  }
}

function zyExportTableExcel(tableId = 'dt-cdr') {
  if (typeof zy2Export === 'function') {
    zy2Export(tableId, 'excel');
    return;
  }
  zyExportTableCsv(tableId);
}

function zyExportTablePdf(tableId = 'dt-cdr') {
  if (typeof zy2Export === 'function') {
    zy2Export(tableId, 'pdf');
    return;
  }
  window.print();
}

function zyPrintTable(tableId = 'dt-cdr') {
  if (typeof zy2Export === 'function') {
    zy2Export(tableId, 'print');
    return;
  }
  window.print();
}

function zyToggleColumnsModal(tableId = 'dt-cdr', anchorEl) {
  const anchor = anchorEl || (typeof event !== 'undefined' && event?.target ? (event.target.closest('button') || event.target) : null);
  if (typeof zy2Cols === 'function') {
    zy2Cols(tableId, anchor);
    return;
  }
  if (typeof toast === 'function') {
    toast('Showing all default report columns', 'info');
  }
}

function zyToolbarFilter(val) {
  const table = document.querySelector('.zy-dt') || document.getElementById('dt-cdr');
  if (!table) return;
  const q = String(val || '').toLowerCase().trim();
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(r => {
    if (r.querySelector('.zy-empty')) return;
    const txt = r.textContent.toLowerCase();
    r.style.display = (!q || txt.includes(q)) ? '' : 'none';
  });
}

function zyFilterTable(tableId, val) {
  let table = null;
  if (tableId) {
    table = document.getElementById(tableId);
    if (table && !table.matches('table')) {
      table = table.querySelector('table') || table;
    }
  }
  if (!table) table = document.querySelector('.zy-dt') || document.getElementById('dt-cdr');
  if (!table) return;
  const q = String(val || '').toLowerCase().trim();
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(r => {
    if (r.querySelector('.zy-empty')) return;
    const txt = r.textContent.toLowerCase();
    r.style.display = (!q || txt.includes(q)) ? '' : 'none';
  });
}

window.zyDefaultFromDateTime = zyDefaultFromDateTime;
window.zyDefaultToDateTime = zyDefaultToDateTime;
window.zyRenderCdrFilterGrid = zyRenderCdrFilterGrid;
window.zyRenderNumbersFilterGrid = zyRenderNumbersFilterGrid;
window.zyExportTableCopy = zyExportTableCopy;
window.zyExportTableCsv = zyExportTableCsv;
window.zyExportTableExcel = zyExportTableExcel;
window.zyExportTablePdf = zyExportTablePdf;
window.zyPrintTable = zyPrintTable;
window.zyToggleColumnsModal = zyToggleColumnsModal;
window.zyToolbarFilter = zyToolbarFilter;
window.zyFilterTable = zyFilterTable;
window.zyToolbarFilterTable = zyFilterTable;
window.zyExportHtmlTable = zyExportHtmlTable;
window.zyPrintHtmlTable = zyPrintHtmlTable;
window.zyRenderTableToolbar = zyRenderTableToolbar;
window.zyHtmlTableCols = zyHtmlTableCols;
window.zyToggleHtmlCol = zyToggleHtmlCol;

// ── Copy Number with Live Green Tick Animation ──────────────────────────
window.zyCopyNumber = function(num, el) {
  if (!num) return;
  const str = String(num).trim().replace(/^\++/, '');
  if (!str) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str);
    } else {
      const ta = document.createElement('textarea');
      ta.value = str;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  } catch (_) {}

  if (el) {
    const badge = el.querySelector ? el.querySelector('.zy-copy-badge') : null;
    if (el.classList && el.classList.contains('zy-num-copy-box') && badge) {
      if (!badge.dataset.origHtml) badge.dataset.origHtml = badge.innerHTML;
      el.classList.add('copied');
      badge.innerHTML = '<i class="fas fa-check"></i>';
      if (el._copyTimer) clearTimeout(el._copyTimer);
      el._copyTimer = setTimeout(() => {
        el.classList.remove('copied');
        badge.innerHTML = badge.dataset.origHtml || '<i class="far fa-copy"></i>';
      }, 1400);
    } else {
      if (!el.dataset.origHtml) el.dataset.origHtml = el.innerHTML;
      el.innerHTML = '<i class="fas fa-check" style="color:#10b981;font-size:12px;"></i>';
      if (el._copyTimer) clearTimeout(el._copyTimer);
      el._copyTimer = setTimeout(() => {
        el.innerHTML = el.dataset.origHtml || '<i class="far fa-copy"></i>';
      }, 1400);
    }
  }
  if (typeof toast === 'function') toast('Copied: ' + str, 'success');
  else if (typeof zyFlash === 'function') zyFlash('Copied: ' + str);
};

// ── Clean Centered Number + Icon-Only Copy Box (No leading +, no "Copy" label) ─
window.zyRenderNumberCopyBox = function(num, opts) {
  const clean = String(num || '').trim().replace(/^\++/, '');
  if (!clean || clean === '—') return '—';
  const isWn = Boolean(opts && (opts === true || opts.isWn));
  const esc = typeof zyEsc === 'function' ? zyEsc(clean) : clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<button type="button" class="zy-num-copy-box${isWn ? ' is-wn-num' : ''}" onclick="event.stopPropagation();window.zyCopyNumber('${esc}', this)" title="Copy number" aria-label="Copy ${esc}"><span class="zy-copy-num${isWn ? ' zy-wn-number' : ''}">${esc}</span><span class="zy-copy-badge" aria-hidden="true"><i class="far fa-copy"></i></span></button>`;
};

// ── My Numbers: Ephemeral Full Num / Local Num (Hide Country Code / Prefix) ──
// Intentionally kept strictly in memory (never localStorage) so a page refresh always resets to Full Num.
window._zyMyNumDisplayMode = 'full';

const ZY_E164_COUNTRY_CODES = new Set([
  // 1-digit
  '1', '7',
  // 2-digit
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84',
  '86', '90', '91', '92', '93', '94', '95', '98',
  // 3-digit
  '211', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228', '229',
  '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243', '244',
  '245', '246', '247', '248', '249', '250', '251', '252', '253', '254', '255', '256', '257', '258', '260',
  '261', '262', '263', '264', '265', '266', '267', '268', '269', '290', '291', '297', '298', '299',
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374',
  '375', '376', '377', '378', '380', '381', '382', '383', '385', '386', '387', '389', '420', '421', '423',
  '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591', '592', '593', '594',
  '595', '596', '597', '598', '599', '670', '672', '673', '674', '675', '676', '677', '678', '679', '680',
  '681', '682', '683', '685', '686', '687', '688', '689', '690', '691', '692', '850', '852', '853', '855',
  '856', '880', '886', '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972',
  '973', '974', '975', '976', '977', '992', '993', '994', '995', '996', '998'
]);

window.zyStripCountryPrefix = function(num, prefixHint) {
  const raw = String(num || '').trim().replace(/^\++/, '');
  if (!raw || raw === '—') return raw;
  const digits = raw.replace(/^00(?=\d{7,})/, '');
  if (!/^\d{6,}$/.test(digits)) return raw;

  const hint = String(prefixHint || '').trim().replace(/[^\d]/g, '');

  // 1. If the row/range prefix itself is a valid 1-3 digit E.164 country code matching the start of the number, strip it
  if (hint && hint.length >= 1 && hint.length <= 3 && ZY_E164_COUNTRY_CODES.has(hint) && digits.startsWith(hint)) {
    const rest = digits.slice(hint.length);
    if (rest.length >= 4) return rest;
  }

  // 2. Match exact ITU-T E.164 country calling code (longest match: 3 -> 2 -> 1 digits)
  for (let len = 3; len >= 1; len--) {
    const cand = digits.slice(0, len);
    if (ZY_E164_COUNTRY_CODES.has(cand)) {
      const rest = digits.slice(len);
      if (rest.length >= 5) return rest;
    }
  }

  // 3. Fallback: if a custom short prefix (1-4 digits) was provided and leaves at least 5 digits, strip it
  if (hint && hint.length >= 1 && hint.length <= 4 && digits.startsWith(hint)) {
    const rest = digits.slice(hint.length);
    if (rest.length >= 5) return rest;
  }

  return raw;
};

window.zyGetMyNumDisplayMode = function() {
  return window._zyMyNumDisplayMode === 'local' ? 'local' : 'full';
};

window.zyResetMyNumDisplayMode = function() {
  window._zyMyNumDisplayMode = 'full';
  const sel = document.getElementById('zy-my-num-display-mode');
  if (sel) {
    sel.value = 'full';
    sel.classList.remove('is-local');
  }
};

window.zySetMyNumDisplayMode = function(mode, onChangeCb) {
  window._zyMyNumDisplayMode = mode === 'local' ? 'local' : 'full';
  const sel = document.getElementById('zy-my-num-display-mode');
  if (sel) {
    if (sel.value !== window._zyMyNumDisplayMode) sel.value = window._zyMyNumDisplayMode;
    sel.classList.toggle('is-local', window._zyMyNumDisplayMode === 'local');
  }
  if (typeof onChangeCb === 'function') onChangeCb(window._zyMyNumDisplayMode);
};

window.zyFormatMyNumberDisplay = function(num, prefixHint) {
  const clean = String(num || '').trim().replace(/^\++/, '');
  if (!clean || clean === '—') return clean;
  return window.zyGetMyNumDisplayMode() === 'local'
    ? window.zyStripCountryPrefix(clean, prefixHint)
    : clean;
};

window.zyCopyVisibleMyNumbers = function(tableId) {
  const tid = tableId || 'dt-numbers';
  const t = window.ZYT2 && window.ZYT2[tid];
  if (!t || !Array.isArray(t.rows) || !t.rows.length) {
    if (typeof toast === 'function') toast('No numbers available to copy', 'warning');
    return;
  }
  const numColIdx = (t.cols || []).findIndex(c => String(typeof c === 'string' ? c : (c && c.title) || '').trim().toLowerCase() === 'number');
  if (numColIdx === -1) return;

  const checkedIds = typeof zy2Checked === 'function' ? new Set(zy2Checked(tid).map(String)) : new Set();
  const isLocal = window.zyGetMyNumDisplayMode() === 'local';

  let targetRows = [];
  if (checkedIds.size > 0) {
    targetRows = t.rows.filter((r, idx) => checkedIds.has(String(r.__id ?? idx)));
  } else {
    const allOrdered = t.serverMode ? t.rows : (typeof zy2Data === 'function' ? zy2Data(t) : t.rows);
    const page = Math.max(1, Number(t.page) || 1);
    const perPage = Math.max(1, Number(t.perPage) || 25);
    targetRows = t.serverMode ? allOrdered : allOrdered.slice((page - 1) * perPage, page * perPage);
  }

  const lines = targetRows
    .map(r => {
      const cell = r[numColIdx];
      const val = (cell && typeof cell === 'object') ? cell.v : cell;
      return String(val || '').trim();
    })
    .filter(v => v && v !== '—');

  if (!lines.length) {
    if (typeof toast === 'function') toast('No numbers found to copy', 'warning');
    return;
  }

  const payload = lines.join('\n');
  const finishToast = () => {
    const modeLbl = isLocal ? 'without country code' : 'with country code';
    const scopeLbl = checkedIds.size > 0 ? 'selected' : 'visible';
    if (typeof toast === 'function') toast(`Copied ${lines.length} ${scopeLbl} number${lines.length === 1 ? '' : 's'} (${modeLbl})`, 'success');
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(payload).then(finishToast).catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = payload;
        ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        finishToast();
      } catch (_) {}
    });
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = payload;
      ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      finishToast();
    } catch (_) {}
  }
};

window.zyRenderMyNumDisplayControl = function(onChangeHandlerExpr) {
  const mode = window.zyGetMyNumDisplayMode();
  return `
    <select id="zy-my-num-display-mode" class="zy-num-disp-select${mode === 'local' ? ' is-local' : ''}" aria-label="Number Display Format" title="Switch between Full Number (with country code) and Local Number (without country code). Resets on page refresh." onchange="${onChangeHandlerExpr}(this.value)">
      <option value="full"${mode === 'full' ? ' selected' : ''}>Full Num (With Code)</option>
      <option value="local"${mode === 'local' ? ' selected' : ''}>Local Num (Hide Prefix)</option>
    </select>`;
};

// ── Shared Date Column Cell for My Numbers (Owner / Agent / Client) ──────
window.zyFormatNumberDateCell = function(n, mode) {
  if (!n || typeof n !== 'object') return { v: '', h: '—' };
  let raw = '';
  if (mode === 'client') {
    raw = n.client_assigned_at || n.assigned_at || n.assigned_date || n.allocated_at || n.created_at || n.created || '';
  } else if (mode === 'agent') {
    raw = n.assigned_at || n.assigned_date || n.allocated_at || n.created_at || n.created || '';
  } else {
    raw = (n.agent_id || n.client_id)
      ? (n.assigned_at || n.assigned_date || n.allocated_at || n.created_at || n.created || '')
      : (n.created_at || n.created || n.allocated_at || n.assigned_at || n.assigned_date || '');
  }
  const s = String(raw || '').trim();
  if (!s) return { v: '', h: '—' };
  const norm = s.replace('T', ' ').replace('Z', '');
  const datePart = norm.slice(0, 10);
  const timePart = norm.length >= 16 ? norm.slice(11, 16) : '';
  const escFull = typeof zyEsc === 'function' ? zyEsc(norm.slice(0, 19)) : norm.slice(0, 19);
  const escDate = typeof zyEsc === 'function' ? zyEsc(datePart) : datePart;
  const escTime = typeof zyEsc === 'function' ? zyEsc(timePart) : timePart;
  return {
    v: norm.slice(0, 19),
    h: `<div class="zy-num-date-cell" title="${escFull}"><span class="zy-dt-date">${escDate}</span>${escTime ? `<span class="zy-dt-time">${escTime}</span>` : ''}</div>`
  };
};

// ── Professional Interactive Day-to-Day Calendar Picker ──────────────────
window.zyOpenDatePicker = function(inputEl) {
  if (!inputEl) return;
  const existing = document.getElementById('zy-datepicker-popover');
  if (existing) {
    const wasSame = existing._targetEl === inputEl;
    if (typeof existing._cleanup === 'function') existing._cleanup();
    existing.remove();
    if (wasSame) return;
  }

  const nowUtc = new Date();
  const isToInit = /(^|-)to$/i.test(inputEl.id || '');
  let viewYear = nowUtc.getUTCFullYear();
  let viewMonth = nowUtc.getUTCMonth();
  let selYear = viewYear;
  let selMonth = viewMonth;
  let selDay = nowUtc.getUTCDate();
  let selHour = isToInit ? '23' : '00';
  let selMin = isToInit ? '59' : '00';
  let selSec = isToInit ? '59' : '00';

  if (inputEl.value) {
    const m = String(inputEl.value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      viewYear = parseInt(m[1], 10);
      viewMonth = parseInt(m[2], 10) - 1;
      selYear = viewYear;
      selMonth = viewMonth;
      selDay = parseInt(m[3], 10);
      if (m[4] != null) selHour = m[4];
      if (m[5] != null) selMin = m[5];
      if (m[6] != null) selSec = m[6];
    }
  }

  const pop = document.createElement('div');
  pop.id = 'zy-datepicker-popover';
  pop.className = 'zy-dp-popover';
  pop._targetEl = inputEl;

  const positionPopover = () => {
    const vw = window.innerWidth || document.documentElement.clientWidth || 360;
    const vh = window.innerHeight || document.documentElement.clientHeight || 640;
    const pad = 10;
    const rect = inputEl.getBoundingClientRect();
    const popW = pop.offsetWidth || Math.min(248, vw - pad * 2);
    const popH = pop.offsetHeight || 265;

    let left;
    if (vw <= 520) {
      // Center cleanly within mobile viewport or align safely inside edges
      left = Math.round((vw - popW) / 2);
    } else {
      left = rect.left;
    }
    left = Math.max(pad, Math.min(left, vw - popW - pad));

    let top = rect.bottom + 5;
    if (top + popH > vh - pad) {
      const aboveTop = rect.top - popH - 5;
      top = aboveTop >= pad ? aboveTop : Math.max(pad, vh - popH - pad);
    }

    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  };

  const renderCal = () => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();

    let daysHtml = '';
    for (let i = 0; i < firstDayIndex; i++) {
      daysHtml += '<div></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const isSel = (d === selDay && viewMonth === selMonth && viewYear === selYear);
      daysHtml += `<button type="button" class="zy-cal-day${isSel ? ' is-selected' : ''}" data-day="${d}">${d}</button>`;
    }

    pop.innerHTML = `
      <div class="zy-dp-head">
        <button type="button" id="zy-cal-prev" class="zy-dp-nav" aria-label="Previous month">&lsaquo;</button>
        <span class="zy-dp-title">${monthNames[viewMonth]} ${viewYear}</span>
        <button type="button" id="zy-cal-next" class="zy-dp-nav" aria-label="Next month">&rsaquo;</button>
      </div>
      <div class="zy-dp-dow">
        <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
      </div>
      <div class="zy-dp-days">
        ${daysHtml}
      </div>
      <div class="zy-dp-footer">
        <div class="zy-dp-time">
          <input type="number" id="zy-cal-h" class="zy-dp-time-inp" min="0" max="23" value="${selHour}">:
          <input type="number" id="zy-cal-m" class="zy-dp-time-inp" min="0" max="59" value="${selMin}">:
          <input type="number" id="zy-cal-s" class="zy-dp-time-inp" min="0" max="59" value="${selSec}">
        </div>
        <div class="zy-dp-actions">
          <button type="button" id="zy-cal-today" class="zy-dp-btn-today">Today</button>
          <button type="button" id="zy-cal-apply" class="zy-dp-btn-apply">Apply</button>
        </div>
      </div>
    `;

    pop.querySelector('#zy-cal-prev').onclick = (ev) => {
      ev.stopPropagation();
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCal();
      positionPopover();
    };
    pop.querySelector('#zy-cal-next').onclick = (ev) => {
      ev.stopPropagation();
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCal();
      positionPopover();
    };
    pop.querySelectorAll('.zy-cal-day').forEach(b => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        selYear = viewYear;
        selMonth = viewMonth;
        selDay = parseInt(b.dataset.day, 10);
        pop.querySelectorAll('.zy-cal-day').forEach(d => d.classList.remove('is-selected'));
        b.classList.add('is-selected');
      };
    });
    pop.querySelector('#zy-cal-today').onclick = (ev) => {
      ev.stopPropagation();
      const now = new Date();
      viewYear = now.getUTCFullYear();
      viewMonth = now.getUTCMonth();
      selYear = viewYear;
      selMonth = viewMonth;
      selDay = now.getUTCDate();
      const isToField = /(^|-)to$/i.test(inputEl.id || '');
      selHour = isToField ? '23' : '00';
      selMin = isToField ? '59' : '00';
      selSec = isToField ? '59' : '00';
      renderCal();
      positionPopover();
    };
    pop.querySelector('#zy-cal-apply').onclick = (ev) => {
      ev.stopPropagation();
      const clamp = (v, max) => String(Math.max(0, Math.min(max, parseInt(v, 10) || 0))).padStart(2, '0');
      const h = clamp(pop.querySelector('#zy-cal-h').value, 23);
      const m = clamp(pop.querySelector('#zy-cal-m').value, 59);
      const s = clamp(pop.querySelector('#zy-cal-s').value, 59);
      const mFormatted = String(selMonth + 1).padStart(2, '0');
      const dFormatted = String(selDay).padStart(2, '0');
      inputEl.value = `${selYear}-${mFormatted}-${dFormatted} ${h}:${m}:${s}`;
      inputEl.dispatchEvent(new Event('change'));
      if (typeof pop._cleanup === 'function') pop._cleanup();
      pop.remove();
    };
  };

  renderCal();
  document.body.appendChild(pop);
  positionPopover();

  const onReposition = () => positionPopover();
  const onDocClick = (e) => {
    if (!pop.contains(e.target) && e.target !== inputEl) {
      if (typeof pop._cleanup === 'function') pop._cleanup();
      pop.remove();
    }
  };
  pop._cleanup = () => {
    document.removeEventListener('click', onDocClick);
    window.removeEventListener('resize', onReposition);
    window.removeEventListener('scroll', onReposition, true);
  };

  setTimeout(() => {
    document.addEventListener('click', onDocClick);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
  }, 10);
};

// ── Universal Interactive Date Picker Global Click Delegator ─────────────
document.addEventListener('click', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'INPUT') return;
  const id = el.id || '';
  const cls = el.className || '';
  const ph = el.placeholder || '';
  if (
    id === 'rp-from' || id === 'rp-to' ||
    id === 'cs-from' || id === 'cs-to' ||
    id === 'cdr-from' || id === 'cdr-to' ||
    id === 'th-date-from' || id === 'th-date-to' ||
    id === 'csms-from' || id === 'csms-to' ||
    id === 'mcdr-from' || id === 'mcdr-to' ||
    id === 'tc-from' || id === 'tc-to' ||
    cls.includes('zy-datepicker') ||
    ph.includes('YYYY-MM-DD')
  ) {
    el.style.cursor = 'pointer';
    if (!el.getAttribute('onclick') || !el.getAttribute('onclick').includes('zyOpenDatePicker')) {
      if (typeof window.zyOpenDatePicker === 'function') {
        window.zyOpenDatePicker(el);
      }
    }
  }
});

// ── Global Real-Time Username Uniqueness Checker ─────────────────────────
window.setupUsernameAvailabilityCheck = function(inputId, feedbackId, submitBtnId, table = 'users', excludeId = null) {
  const input = typeof inputId === 'string' ? document.getElementById(inputId) : inputId;
  const feedback = typeof feedbackId === 'string' ? document.getElementById(feedbackId) : feedbackId;
  const btn = typeof submitBtnId === 'string' ? document.getElementById(submitBtnId) : submitBtnId;
  if (!input) return;

  let timer = null;
  const check = async () => {
    const val = (input.value || '').trim();
    if (!val) {
      if (feedback) feedback.innerHTML = '';
      input.style.borderColor = '';
      if (btn) btn.disabled = false;
      return;
    }
    try {
      const q = `/api/check-username?username=${encodeURIComponent(val)}${excludeId ? `&exclude_id=${excludeId}` : ''}${table ? `&table=${table}` : ''}`;
      const res = await fetch(q, { credentials: 'include' });
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

// ── Format SMS message text plainly without OTP highlight boxes ─────────────
window.zyHighlightOtp = function(msg) {
  if (!msg) return '';
  return typeof zyEsc === 'function'
    ? zyEsc(msg)
    : String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// Wrap SMS text at word boundaries so each line holds at most 32 chars (e.g. "Your Whop verification code is:")
window.zyWrapSmsText = function(msg, maxChars = 32) {
  const esc = (s) => (typeof zyEsc === 'function'
    ? zyEsc(s)
    : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  if (msg == null || String(msg).trim() === '') return '—';
  const paragraphs = String(msg).replace(/\r\n?/g, '\n').split('\n');
  const outLines = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/);
    let line = '';
    for (const w of words) {
      if (w.length > maxChars) {
        if (line) {
          outLines.push(line);
          line = '';
        }
        for (let i = 0; i < w.length; i += maxChars) {
          const chunk = w.slice(i, i + maxChars);
          if (chunk.length === maxChars && i + maxChars < w.length) {
            outLines.push(chunk);
          } else {
            line = chunk;
          }
        }
      } else if (!line) {
        line = w;
      } else if (line.length + 1 + w.length <= maxChars) {
        line += ' ' + w;
      } else {
        outLines.push(line);
        line = w;
      }
    }
    if (line) outLines.push(line);
  }
  return outLines.length ? outLines.map(esc).join('<br>') : '—';
};

window.zyRenderSmsCell = function(msg, maxChars = 32) {
  return `<div class="zy-sms-cell">${window.zyWrapSmsText(msg, maxChars)}</div>`;
};

// ── Floating Action Button (FAB) (Hidden as requested) ──
window.zyRenderFab = function(_tooltipText = '', _onClickHandler = '') {
  return '';
};

window.zyOpenFabModal = function() {
  if (typeof zyActionAllocate === 'function') {
    zyActionAllocate();
  } else if (typeof zyAllocateAll === 'function') {
    zyAllocateAll();
  } else if (typeof zyOwnerAllocateAll === 'function') {
    zyOwnerAllocateAll();
  } else if (typeof loadPage === 'function') {
    loadPage('my-sms-numbers');
  }
};

// ── Excel-Style KPI Column Boxes Helper ──────────────────────────────────
window.zyRenderExcelKpiBoxes = function(boxes = []) {
  if (!boxes || !boxes.length) return '';
  return `
    <div class="zy-excel-kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:10px;margin-bottom:16px;">
      ${boxes.map(b => `
        <div class="zy-excel-kpi-box" style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:8px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,0.03);position:relative;overflow:hidden;">
          <div style="font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${b.label}</div>
          <div style="font-size:19px;font-weight:800;color:${b.color || '#0f172a'};margin-top:2px;font-family:monospace;">${b.value}</div>
          ${b.sub ? `<div style="font-size:10.5px;color:#64748b;margin-top:2px;">${b.sub}</div>` : ''}
          ${b.borderLeft ? `<div style="position:absolute;left:0;top:0;bottom:0;width:3.5px;background:${b.borderLeft};"></div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
};

// ── Inject Excel-Style Spreadsheet Table Grid Rules ──────────────────────
(function() {
  if (document.getElementById('zy-excel-grid-css')) return;
  const style = document.createElement('style');
  style.id = 'zy-excel-grid-css';
  style.textContent = `
    /* Excel Spreadsheet Style Grid */
    .zy-dt2-table, table.data-table, .zy-table-excel {
      border-collapse: collapse !important;
      border: 1.5px solid #cbd5e1 !important;
      font-size: 12.5px !important;
      width: 100% !important;
    }
    .zy-dt2-table th, table.data-table th, .zy-table-excel th {
      background: #f1f5f9 !important;
      color: #1e293b !important;
      font-weight: 700 !important;
      font-size: 11.5px !important;
      text-transform: uppercase !important;
      letter-spacing: 0.4px !important;
      border: 1px solid #cbd5e1 !important;
      border-bottom: 2px solid #94a3b8 !important;
      padding: 8px 10px !important;
      white-space: nowrap !important;
    }
    .zy-dt2-table td, table.data-table td, .zy-table-excel td {
      border: 1px solid #e2e8f0 !important;
      padding: 7px 10px !important;
      color: #334155 !important;
    }
    .zy-dt2-table tbody tr:nth-child(even), table.data-table tbody tr:nth-child(even) {
      background: #f8fafc !important;
    }
    .zy-dt2-table tbody tr:hover, table.data-table tbody tr:hover {
      background: #e0f2fe !important;
    }
    .zy-dt2-table tfoot td, table.data-table tfoot td {
      background: #f1f5f9 !important;
      font-weight: 700 !important;
      border: 1px solid #cbd5e1 !important;
      border-top: 2px solid #64748b !important;
    }
    .zy-excel-cell-mono {
      font-family: 'JetBrains Mono', 'Roboto Mono', monospace !important;
      font-weight: 600 !important;
    }
  `;
  document.head.appendChild(style);
})();

/* ═══════════════════════════════════════════════════════════════
   UNIFIED 3-ROLE EXECUTIVE DASHBOARD RENDERER
   Shared by Owner, Agent, and Client Panels
   ═══════════════════════════════════════════════════════════════ */
window.zyRenderWeeklyAreaChart = function (containerId, labels, values) {
  const host = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!host) return;
  const pts = (Array.isArray(values) && values.length ? values : [0, 0, 0, 0, 0, 0, 0]).map(v => Math.max(0, Number(v) || 0));
  const lbls = (Array.isArray(labels) && labels.length === pts.length)
    ? labels
    : Array.from({ length: pts.length }, (_, i) => {
        const d = new Date(Date.now() - (pts.length - 1 - i) * 86400000);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `${days[d.getUTCDay()]} ${d.getUTCDate()}`;
      });

  const drawSvg = () => {
    const rect = host.getBoundingClientRect();
    const W = Math.max(280, Math.round(rect.width || 560));
    const H = Math.max(185, Math.round(rect.height || 225));
    const padL = 42, padR = 16, padT = 16, padB = 30;
    const plotW = Math.max(80, W - padL - padR);
    const plotH = Math.max(60, H - padT - padB);

    const rawPeak = Math.max(...pts, 0);
    let step = rawPeak <= 0 ? 1 : Math.ceil(rawPeak / 4);
    if (step > 10) {
      const mag = Math.pow(10, Math.floor(Math.log10(step)));
      step = Math.ceil(step / mag) * mag;
    }
    const yMax = Math.max(4, step * 4);
    const n = Math.max(1, pts.length - 1);

    const coords = pts.map((v, i) => ({
      x: padL + (i / n) * plotW,
      y: padT + plotH - (v / yMax) * plotH,
      v,
      label: lbls[i]
    }));

    // Smooth non-overshooting cubic Bezier segments
    let lineD = '';
    if (coords.length === 1) {
      lineD = `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
    } else {
      lineD = `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
      for (let i = 0; i < coords.length - 1; i++) {
        const p0 = coords[i];
        const p1 = coords[i + 1];
        const cx = ((p0.x + p1.x) / 2).toFixed(1);
        lineD += ` C ${cx},${p0.y.toFixed(1)} ${cx},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
      }
    }
    const baseLineY = (padT + plotH).toFixed(1);
    const areaD = `${lineD} L ${coords[coords.length - 1].x.toFixed(1)},${baseLineY} L ${coords[0].x.toFixed(1)},${baseLineY} Z`;

    const isDark = document.body.classList.contains('dark') || document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(148,163,184,0.16)' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const dotBg = isDark ? '#131c2e' : '#ffffff';
    const gradId = 'zy-area-grad-' + Math.random().toString(36).slice(2, 8);
    const strokeGradId = 'zy-line-grad-' + Math.random().toString(36).slice(2, 8);

    const yTicks = [0, 1, 2, 3, 4].map(i => {
      const val = step * i;
      const y = (padT + plotH - (val / yMax) * plotH).toFixed(1);
      return `
        <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${gridColor}" stroke-dasharray="${i === 0 ? '' : '3 3'}" stroke-width="1"/>
        <text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="${textColor}" font-size="11" font-weight="500">${val.toLocaleString()}</text>
      `;
    }).join('');

    const xTicks = coords.map(pt => `
      <text x="${pt.x.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="${textColor}" font-size="11" font-weight="500">${zyEsc(pt.label)}</text>
    `).join('');

    const dots = coords.map((pt, idx) => `
      <g class="zy-chart-pt" data-idx="${idx}" style="cursor:pointer;">
        <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="12" fill="transparent"/>
        <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.2" fill="${dotBg}" stroke="${idx % 2 === 0 ? '#1d4ed8' : '#059669'}" stroke-width="2.4"/>
      </g>
    `).join('');

    host.innerHTML = `
      <div class="zy-ud-chart-tooltip" id="${host.id}-tip"></div>
      <svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;overflow:visible;">
        <defs>
          <linearGradient id="${strokeGradId}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#1d4ed8"/>
            <stop offset="100%" stop-color="#059669"/>
          </linearGradient>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1d4ed8" stop-opacity="0.18"/>
            <stop offset="55%" stop-color="#059669" stop-opacity="0.10"/>
            <stop offset="100%" stop-color="#059669" stop-opacity="0.01"/>
          </linearGradient>
        </defs>
        ${yTicks}
        ${xTicks}
        <path d="${areaD}" fill="url(#${gradId})"/>
        <path d="${lineD}" fill="none" stroke="url(#${strokeGradId})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </svg>
    `;

    const tip = document.getElementById(`${host.id}-tip`);
    host.querySelectorAll('.zy-chart-pt').forEach(g => {
      const showTip = () => {
        const idx = Number(g.dataset.idx);
        const pt = coords[idx];
        if (!tip || !pt) return;
        tip.textContent = `${pt.label}: ${pt.v.toLocaleString()} SMS`;
        tip.style.left = `${(pt.x / W) * 100}%`;
        tip.style.top = `${(pt.y / H) * 100}%`;
        tip.classList.add('show');
      };
      const hideTip = () => tip && tip.classList.remove('show');
      g.addEventListener('mouseenter', showTip);
      g.addEventListener('click', showTip);
      g.addEventListener('mouseleave', hideTip);
    });
  };

  drawSvg();
  if (window._zyUdChartTimer) clearTimeout(window._zyUdChartTimer);
  if (window._zyUdChartResize) window.removeEventListener('resize', window._zyUdChartResize);
  window._zyUdChartResize = () => {
    clearTimeout(window._zyUdChartTimer);
    window._zyUdChartTimer = setTimeout(drawSvg, 140);
  };
  window.addEventListener('resize', window._zyUdChartResize);
};

window.zyDashMoney = function (val, currSym = '$') {
  const n = Number(val) || 0;
  return `${currSym}${zyFmtMoneyComma(n, 4)}`;
};

window.zyRenderUnifiedDashboard = function (cfg) {
  const container = document.getElementById(cfg.containerId || 'page-content');
  if (!container) return;

  if (window._zyDashLiveAccessTimer) {
    clearInterval(window._zyDashLiveAccessTimer);
    window._zyDashLiveAccessTimer = null;
  }

  const alertHtml = cfg.alertHtml || '';
  const hero = cfg.hero || {};
  const todaySms = Number(hero.value || 0);
  const chartTodayTotal = cfg.chartTodayTotal != null ? Number(cfg.chartTodayTotal) : todaySms;

  const moneyCards = (cfg.moneyCards || []).slice(0, 2);
  const shortcuts = (cfg.shortcuts || []).slice(0, 6);
  const volumes = (cfg.volumes || []).slice(0, 4);
  const volGridClass = volumes.length === 3 ? 'zy-ud-vol-grid zy-ud-vol-grid-3' : 'zy-ud-vol-grid';
  const summaryRows = (cfg.summaryRows || []).slice(0, 4);
  const latestRanges = cfg.latestRanges || [];
  const appLinks = Array.isArray(cfg.appLinks) ? cfg.appLinks.slice(0, 10) : [];

  const chartId = cfg.chartId || 'zy-ud-weekly-chart';
  const liveAccessHostId = 'zy-ud-live-access-body';

  const quickTilesHtml = shortcuts.map((s, idx) => {
    const tone = s.tone || (idx % 2 === 0 ? 'blue' : 'green');
    const href = (typeof window.zyPageUrl === 'function') ? window.zyPageUrl(s.page) : '#';
    return `
    <a class="zy-ud-qtile zy-ud-qtile-${zyEsc(tone)}" data-tone="${zyEsc(tone)}" data-page="${zyEsc(s.page)}" href="${zyEsc(href)}"
       onclick="return window.zyNavClick ? window.zyNavClick(event, '${zyEsc(s.page)}') : (event.preventDefault(), loadPage('${zyEsc(s.page)}'), false)">
      <div class="zy-ud-qtile-ic"><i class="fas ${zyEsc(s.icon || 'fa-circle-dot')}"></i></div>
      <div class="zy-ud-qtile-lbl">${zyEsc(s.label)}</div>
    </a>
  `;
  }).join('');

  const volBoxesHtml = volumes.map(v => `
    <div class="zy-ud-vol-box">
      <div class="zy-ud-vol-lbl">${zyEsc(v.label)}</div>
      <div class="zy-ud-vol-val zy-ud-num">${Number(v.value || 0).toLocaleString()}</div>
    </div>
  `).join('');

  const sumItemsHtml = summaryRows.map(r => {
    const inner = `
      <div class="zy-ud-sum-left">
        <div class="zy-ud-sum-ic${r.tone === 'red' ? ' is-red' : ''}"><i class="fas ${zyEsc(r.icon || 'fa-chart-simple')}"></i></div>
        <div class="zy-ud-sum-lbl">${zyEsc(r.label)}</div>
      </div>
      <div class="zy-ud-sum-val zy-ud-num${r.tone === 'red' ? ' is-red' : ''}">${zyEsc(String(r.value ?? '0'))}</div>
    `;
    if (r.page) {
      const href = (typeof window.zyPageUrl === 'function') ? window.zyPageUrl(r.page) : '#';
      return `<a class="zy-ud-sum-item" style="cursor:pointer;" data-page="${zyEsc(r.page)}" href="${zyEsc(href)}" onclick="return window.zyNavClick ? window.zyNavClick(event, '${zyEsc(r.page)}') : (event.preventDefault(), loadPage('${zyEsc(r.page)}'), false)">${inner}</a>`;
    }
    return `<div class="zy-ud-sum-item">${inner}</div>`;
  }).join('');

  const rangesTableHtml = latestRanges.length ? `
    <div class="zy-ud-table-wrap">
      <table class="zy-ud-table">
        <thead>
          <tr>
            <th>Range Name</th>
            <th>Rate</th>
            <th class="r">Status</th>
          </tr>
        </thead>
        <tbody>
          ${latestRanges.slice(0, 5).map(r => `
            <tr>
              <td><strong class="${r.isWn ? 'zy-wn-range-name' : ''}">${zyEsc(r.name)}</strong></td>
              <td><span class="zy-ud-rate-pill">${zyEsc(r.rateFormatted)}</span></td>
              <td class="r" style="color:var(--sp-text-muted);font-size:12px;">${zyEsc(r.dateAdded || 'Active')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : `<div class="zy-ud-empty"><i class="fas fa-layer-group" style="display:block;font-size:20px;margin-bottom:6px;opacity:0.5;"></i>No SMS ranges configured yet.</div>`;

  const safeHref = (u) => {
    const s = String(u || '').trim();
    return /^https?:\/\//i.test(s) ? s : '#';
  };

  const buildDashAppLinksTable = (list) => list.length ? `
    <div class="zy-ud-applinks-list zy-applinks-tbl-wrap zy-ud-applinks-tbl-wrap">
      <table class="zy-dt zy-applinks-tbl zy-applinks-excel zy-applinks-tbl-compact">
        <thead>
          <tr>
            <th style="width:46px;text-align:center;">#</th>
            <th style="width:36%;">App Name</th>
            <th>App Link</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((app, i) => {
            const href = safeHref(app.url);
            const rawUrl = String(app.url || '').trim();
            const cat = String(app.category || '').trim();
            return `
              <tr>
                <td class="zy-applink-num-td"><span class="zy-applink-num">${i + 1}</span></td>
                <td class="zy-applink-name-td">
                  <div class="zy-applink-name-line">
                    <span class="zy-applink-name-txt">${zyEsc(app.name || 'App Link')}</span>
                    ${app.pinned_top ? `<span class="zy-applink-top-tag">TOP</span>` : ''}
                    ${cat ? `<span class="zy-ud-applink-cat">${zyEsc(cat)}</span>` : ''}
                  </div>
                </td>
                <td class="zy-applink-url-td">
                  <div class="zy-applink-url-wrap">
                    <a class="zy-applink-url-anchor" href="${zyEsc(href)}" target="_blank" rel="noopener noreferrer" title="${zyEsc(rawUrl)}">${zyEsc(rawUrl || href)}</a>
                    <button type="button" class="zy-applink-copy-btn" data-url="${zyEsc(rawUrl || href)}" onclick="zyCopyAppLinkUrl(this)" title="Copy link"><i class="far fa-copy"></i> Copy</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  ` : `<div class="zy-ud-empty"><i class="fas fa-link" style="display:block;font-size:20px;margin-bottom:6px;opacity:0.5;"></i>No app links added yet.</div>`;

  const latestAppLinks = appLinks.slice(0, 10);
  const dashAppLinksId = 'zy-ud-applinks-' + Math.random().toString(36).slice(2, 8);
  window._zyDashAppLinksCache = window._zyDashAppLinksCache || {};
  window._zyDashAppLinksCache[dashAppLinksId] = { latest: latestAppLinks, all: appLinks, render: buildDashAppLinksTable };
  window.zySwitchDashAppLinksTab = function(id, tab, btnEl) {
    const entry = window._zyDashAppLinksCache && window._zyDashAppLinksCache[id];
    const host = document.getElementById(id);
    if (!entry || !host) return;
    host.innerHTML = entry.render(tab === 'all' ? entry.all : entry.latest);
    if (btnEl && btnEl.parentElement) {
      btnEl.parentElement.querySelectorAll('.zy-ud-al-tab').forEach(b => b.classList.remove('active'));
      btnEl.classList.add('active');
    }
  };
  const appLinksHtml = `<div id="${dashAppLinksId}">${buildDashAppLinksTable(latestAppLinks)}</div>`;

  const moneyPairClass = moneyCards.length === 1 ? 'zy-ud-money-pair zy-ud-money-pair-single' : 'zy-ud-money-pair';
  const topRowClass = moneyCards.length === 0
    ? 'zy-ud-top-row zy-ud-top-row-full'
    : (moneyCards.length === 1 ? 'zy-ud-top-row zy-ud-top-row-2col' : 'zy-ud-top-row');

  container.innerHTML = `
    <div class="zy-ud">
      ${alertHtml}

      <!-- Row 1: Hero Card (Full Width when no side cards) -->
      <div class="${topRowClass}">
        <div class="zy-ud-card zy-ud-hero-card">
          <div style="min-width:0;">
            <div class="zy-ud-hero-label">${zyEsc(hero.label || 'Today SMS')}</div>
            <div class="zy-ud-hero-val zy-ud-num">${todaySms.toLocaleString()}</div>
            <div class="zy-ud-hero-sub">
              <span>${zyEsc(hero.subtitle || 'SMS traffic today (UTC)')}</span>
            </div>
          </div>
          <div class="zy-ud-hero-badge" aria-hidden="true">
            <i class="fas ${zyEsc(hero.icon || 'fa-check')}"></i>
          </div>
        </div>

        ${moneyCards.length ? `
        <div class="${moneyPairClass}">
          ${moneyCards.map((mc, idx) => `
            <div class="zy-ud-card zy-ud-money-card">
              <div class="zy-ud-money-top">
                <span class="zy-ud-money-label">${zyEsc(mc.label)}</span>
                <span class="zy-ud-money-ic ${idx === 0 ? 'emerald' : 'blue'}"><i class="fas ${zyEsc(mc.icon || (idx === 0 ? 'fa-tower-cell' : 'fa-chart-line'))}"></i></span>
              </div>
              <div class="zy-ud-money-val zy-ud-num">${zyEsc(mc.value)}</div>
              <div class="zy-ud-money-sub">${zyEsc(mc.sub || '')}</div>
            </div>
          `).join('')}
        </div>` : ''}
      </div>

      ${shortcuts.length ? `
      <!-- Row 2: Quick Access Grid -->
      <div class="zy-ud-card">
        <div class="zy-ud-card-head">
          <div class="zy-ud-card-title"><i class="fas fa-bolt"></i> Quick Access</div>
          <span class="zy-ud-card-sub">${zyEsc(cfg.roleLabel || 'Portal')} Shortcuts</span>
        </div>
        <div class="zy-ud-quick-grid">
          ${quickTilesHtml}
        </div>
      </div>` : ''}

      <!-- Row 3: Volume Overview (2x2) + 7-Day Area Chart -->
      <div class="zy-ud-mid-row">
        <div class="zy-ud-card zy-ud-volume-card">
          <div class="zy-ud-card-head">
            <div class="zy-ud-card-title"><i class="fas fa-layer-group"></i> Volume Overview</div>
            <span class="zy-ud-card-sub">Mon–Sun SMS</span>
          </div>
          <div class="${volGridClass}">
            ${volBoxesHtml}
          </div>
        </div>

        <div class="zy-ud-card zy-ud-chart-card">
          <div class="zy-ud-card-head">
            <div class="zy-ud-card-title"><i class="fas fa-chart-area"></i> SMS Stats Last 7 Days</div>
            <span class="zy-ud-today-pill zy-ud-num">${chartTodayTotal.toLocaleString()} SMS today</span>
          </div>
          <div class="zy-ud-chart-wrap" id="${zyEsc(chartId)}"></div>
        </div>
      </div>

      <!-- Row 4: Summary Metric Stack + Latest Ranges -->
      <div class="zy-ud-ops-row">
        <div class="zy-ud-card zy-ud-summary-card">
          <div class="zy-ud-card-head">
            <div class="zy-ud-card-title"><i class="fas fa-gauge-high"></i> ${zyEsc(cfg.summaryTitle || 'Summary Snapshot')}</div>
          </div>
          <div class="zy-ud-sum-list">
            ${sumItemsHtml}
          </div>
        </div>

        <div class="zy-ud-card zy-ud-ranges-card">
          <div class="zy-ud-card-head">
            <div class="zy-ud-card-title"><i class="fas fa-globe"></i> Latest Ranges</div>
            <span class="zy-ud-card-sub">Active Rates</span>
          </div>
          ${rangesTableHtml}
        </div>
      </div>

      <!-- Row 5: Live Access Feed + Latest 10 App Links -->
      <div class="zy-ud-bot-row">
        <div class="zy-ud-card" style="display:flex;flex-direction:column;">
          <div class="zy-ud-card-head">
            <div class="zy-ud-card-title"><span class="zy-live-pulse-dot" aria-hidden="true"></span> Live Access</div>
            <span class="zy-ud-card-sub">Auto-Updating Live Feed</span>
          </div>
          <div id="${liveAccessHostId}" class="zy-ud-live-access-wrap">
            <div class="zy-ud-empty"><i class="fas fa-tower-broadcast" style="display:block;font-size:20px;margin-bottom:6px;opacity:0.5;"></i>Loading live access feed…</div>
          </div>
        </div>

        <div class="zy-ud-card" style="display:flex;flex-direction:column;">
          <div class="zy-ud-card-head">
            <div class="zy-ud-card-title"><i class="fas fa-mobile-screen-button"></i> Apps &amp; Links</div>
            <div class="zy-ud-al-tabs" style="display:inline-flex;gap:4px;align-items:center;">
              <button type="button" class="zy-ud-al-tab active" onclick="zySwitchDashAppLinksTab('${dashAppLinksId}','latest',this)">Latest (${latestAppLinks.length})</button>
              <button type="button" class="zy-ud-al-tab" onclick="zySwitchDashAppLinksTab('${dashAppLinksId}','all',this)">All (${appLinks.length})</button>
            </div>
          </div>
          ${appLinksHtml}
        </div>
      </div>
    </div>
  `;

  window.zyRenderWeeklyAreaChart(chartId, cfg.weeklyLabels, cfg.weeklyTraffic);

  // Auto-updating Live Access feed widget (auto-stops when leaving dashboard)
  const renderLiveAccessFeed = async () => {
    const host = document.getElementById(liveAccessHostId);
    if (!host) {
      if (window._zyDashLiveAccessTimer) {
        clearInterval(window._zyDashLiveAccessTimer);
        window._zyDashLiveAccessTimer = null;
      }
      return;
    }
    try {
      const res = await apiFetch('/api/live-access?limit=8', { silent: true }).catch(() => null);
      if (!document.getElementById(liveAccessHostId)) return;
      const items = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      if (!items.length) {
        host.innerHTML = `<div class="zy-ud-empty"><i class="fas fa-tower-broadcast" style="display:block;font-size:20px;margin-bottom:6px;opacity:0.5;"></i>No live SMS access events yet.</div>`;
        return;
      }
      host.innerHTML = `
        <div class="zy-ud-table-wrap">
          <table class="zy-ud-table">
            <thead>
              <tr>
                <th>CLI / App</th>
                <th>Range</th>
                <th class="r">Time (UTC)</th>
              </tr>
            </thead>
            <tbody>
              ${items.slice(0, 8).map(ev => {
                const cli = ev.cli || ev.app || ev.service || '—';
                const rng = ev.range_name || ev.range || ev.country || '—';
                const ts = String(ev.timestamp || ev.created_at || ev.time || '').replace('T', ' ').slice(11, 19) || 'Live';
                return `
                  <tr class="zy-live-row-fade">
                    <td><span class="zy-ud-cli-tag">${zyEsc(cli)}</span></td>
                    <td><strong>${zyEsc(rng)}</strong></td>
                    <td class="r zy-ud-num" style="color:var(--sp-text-muted);font-size:11.5px;">${zyEsc(ts)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (_) {}
  };
  renderLiveAccessFeed();
  window._zyDashLiveAccessTimer = setInterval(renderLiveAccessFeed, 6000);
};

/* ═══ SAFE 1-CLICK CLIPBOARD COPY HELPER ═══ */
window.zyCopyTextSafe = function (text, label) {
  const val = String(text == null ? '' : text);
  if (!val) {
    if (typeof toast === 'function') toast('Nothing to copy yet.', 'warning');
    return;
  }
  const done = () => {
    if (typeof toast === 'function') toast(`${label || 'Text'} copied!`, 'success');
  };
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(val).then(done).catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = val;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (_) {
        if (typeof toast === 'function') toast('Could not copy to clipboard.', 'error');
      }
    });
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = val;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (_) {
      if (typeof toast === 'function') toast('Could not copy to clipboard.', 'error');
    }
  }
};

/* ═══ CDR 2 (MONTHLY ROUTE) DAILY 12:00 PM PKT UPLOAD BANNER ═══ */
window._zyCdr2NoonTimer = window._zyCdr2NoonTimer || null;
window._zyCdr2StatusPoller = window._zyCdr2StatusPoller || null;

window.zyRenderCdr2DailyBanner = function (hostId, statusObj) {
  const targetHostId = hostId || 'cdr2-daily-banner';
  const host = document.getElementById(targetHostId);
  if (!host || !statusObj) return;
  if (window._zyCdr2NoonTimer) {
    clearInterval(window._zyCdr2NoonTimer);
    window._zyCdr2NoonTimer = null;
  }
  if (window._zyCdr2StatusPoller) {
    clearInterval(window._zyCdr2StatusPoller);
    window._zyCdr2StatusPoller = null;
  }

  const isUr = Boolean(window.HumexI18n && typeof window.HumexI18n.getLanguage === 'function' && window.HumexI18n.getLanguage() === 'roman_ur');
  const uploaded = Boolean(statusObj.yesterday_uploaded || statusObj.file_updated);
  const yDate = statusObj.target_report_date || statusObj.yesterday_pkt || '';
  const latestDate = statusObj.latest_uploaded_date || '';
  const nextIso = uploaded ? '' : (statusObj.next_upload_iso || '');

  const formatHMS = (secs) => {
    const s = Math.max(0, Math.floor(secs));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const p = n => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(r)}`;
  };

  const formatPktTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pkt = new Date(d.getTime() + 5 * 60 * 60 * 1000);
      const h24 = pkt.getUTCHours();
      const mm = String(pkt.getUTCMinutes()).padStart(2, '0');
      const ampm = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 || 12;
      return `${h12}:${mm} ${ampm} PKT`;
    } catch (_) {
      return '';
    }
  };

  const getSecsLeft = () => {
    if (uploaded || !nextIso) return 0;
    return Math.max(0, Math.ceil((new Date(nextIso).getTime() - Date.now()) / 1000));
  };

  const secsNow = uploaded ? 0 : getSecsLeft();
  const uploadedTimePkt = uploaded ? formatPktTime(statusObj.uploaded_at) : '';

  const titleText = uploaded
    ? (isUr ? 'File Updated — Daily Report Upload Ho Chuki Hai' : 'File Updated')
    : (isUr ? 'Daily Report Upload Timing: 12:00 PM PKT' : 'Daily Report Upload Schedule: 12:00 PM PKT');

  const descText = uploaded
    ? (isUr
        ? `Pichli date (${zyEsc(yDate)}) ki file upload ho chuki hai${uploadedTimePkt ? ` (${zyEsc(uploadedTimePkt)})` : ''}. Agli date subah 5:00 AM PKT par update hogi.`
        : `Previous day’s (${zyEsc(yDate)}) file is updated and live${uploadedTimePkt ? ` (uploaded at ${zyEsc(uploadedTimePkt)})` : ''}. Next daily cycle begins at 5:00 AM PKT.`)
    : (isUr
        ? `Pichli date (${zyEsc(yDate)}) ki file subah 5:00 AM se 12:00 PM PKT ke darmiyan kisi bhi waqt upload ho sakti hai — upload hotay hi timer khatam ho kar "File Updated" show ho jaye ga.`
        : `Previous day’s (${zyEsc(yDate)}) file can arrive anytime between 5:00 AM and 12:00 PM PKT — as soon as uploaded, the timer stops and switches to "File Updated".`);

  const badgeHtml = uploaded
    ? `<span class="zy-cdr2-status-pill is-ready"><i class="fas fa-circle-check"></i> File Updated · ${zyEsc(yDate)}${uploadedTimePkt ? ` · ${zyEsc(uploadedTimePkt)}` : ''}</span>`
    : (secsNow > 0
        ? `<span class="zy-cdr2-status-pill is-wait"><i class="far fa-clock"></i> ${isUr ? 'Upload mein waqt' : 'Next Upload'}: <strong id="zy-cdr2-noon-cd">${formatHMS(secsNow)}</strong></span>`
        : `<span class="zy-cdr2-status-pill is-pending"><i class="fas fa-hourglass-half"></i> ${isUr ? 'Upload ka intezar' : 'Awaiting 12:00 PM Upload'}</span>`);

  const mc = (statusObj && statusObj.monthly_cycle) ? statusObj.monthly_cycle : null;
  const mcHoldDays = mc && Number.isFinite(Number(mc.hold_days)) ? Number(mc.hold_days) : 5;
  const mcCycleDays = mc && Number.isFinite(Number(mc.cycle_days)) ? Number(mc.cycle_days) : 30;
  const mcTag = mcHoldDays === 5 ? 'Monthly (30/5) {W}' : `Monthly (${mcCycleDays}/${mcHoldDays}) {W}`;
  const completedCycles = (statusObj && Array.isArray(statusObj.completed_cycles)) ? statusObj.completed_cycles : [];
  const mcStripHtml = mc
    ? `<div class="zy-cdr2-notice-meta" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
         <span><i class="fas fa-rotate"></i> <strong>Cycle #${mc.cycle_number || 1}:</strong> ${zyEsc(mc.start_date)} → ${zyEsc(mc.end_date)}</span>
         <span>· <strong>Day ${mc.day_in_cycle || 1}/${mcCycleDays}</strong> (${mc.days_remaining ?? mcCycleDays}d left)</span>
         <span>· <strong>${mcHoldDays}d Hold</strong> → Clears <strong>${zyEsc(mc.clear_date)}</strong></span>
         <span>· Next auto: <strong>${zyEsc(mc.next_cycle_start || '—')}</strong></span>
       </div>`
    : '';
  const completedStripHtml = completedCycles.length
    ? `<div style="margin-top:8px;padding:8px 12px;border:1px solid var(--border-color,#c7d2fe);border-radius:8px;background:var(--bg-card,#f8fafc);font-size:11.5px;">
         <div style="font-weight:700;margin-bottom:5px;display:flex;align-items:center;gap:6px;">
           <i class="fas fa-archive" style="color:#4f46e5;"></i>
           <span>${isUr ? 'Mukammal Shuda 30-Din Whitenoise Cycles (Alag Record)' : 'Completed 30-Day Whitenoise Cycles (Auto-Archived)'} (${completedCycles.length})</span>
         </div>
         <div style="display:flex;flex-wrap:wrap;gap:6px;">
           ${completedCycles.slice(0, 4).map(cy => `
             <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color,#e2e8f0);background:var(--bg-surface,#fff);">
               <strong>#${cy.cycle_number}</strong> (${zyEsc(cy.start_date)}→${zyEsc(cy.end_date)}) · <b>${Number(cy.sms_count || 0).toLocaleString()} SMS</b> ·
               ${cy.is_cleared ? '<span style="color:#059669;font-weight:700;">Cleared</span>' : `<span style="color:#d97706;font-weight:700;">Hold ${cy.days_until_clear}d → ${zyEsc(cy.clear_date)}</span>`}
             </span>
           `).join('')}
         </div>
       </div>`
    : '';

  host.innerHTML = `
    <div class="zy-cdr2-notice-banner ${uploaded ? 'is-ready' : 'is-waiting'}">
      <div class="zy-cdr2-notice-ico">
        <i class="fas ${uploaded ? 'fa-calendar-check' : 'fa-clock'}"></i>
      </div>
      <div class="zy-cdr2-notice-body">
        <div class="zy-cdr2-notice-top">
          <span class="zy-cdr2-notice-title">${titleText}</span>
          ${badgeHtml}
        </div>
        <div class="zy-cdr2-notice-desc">${descText}</div>
        ${latestDate ? `<div class="zy-cdr2-notice-meta"><i class="fas fa-database"></i> ${isUr ? 'Aakhri uploaded report date' : 'Latest uploaded report'}: <strong>${zyEsc(latestDate)}</strong> · ${zyEsc(mcTag)}</div>` : ''}
        ${mcStripHtml}
      </div>
      <div class="zy-cdr2-notice-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="window.zyOpenCdr2TermsModal({ viewOnly: true })">
          <i class="fas fa-file-contract"></i> ${isUr ? 'Terms' : 'Terms'}
        </button>
      </div>
    </div>
    ${completedStripHtml}
  `;

  if (!uploaded && secsNow > 0) {
    window._zyCdr2NoonTimer = setInterval(() => {
      const cdEl = document.getElementById('zy-cdr2-noon-cd');
      if (!cdEl) {
        clearInterval(window._zyCdr2NoonTimer);
        window._zyCdr2NoonTimer = null;
        return;
      }
      const rem = getSecsLeft();
      if (rem <= 0) {
        clearInterval(window._zyCdr2NoonTimer);
        window._zyCdr2NoonTimer = null;
        const pill = cdEl.closest('.zy-cdr2-status-pill');
        if (pill) {
          pill.className = 'zy-cdr2-status-pill is-pending';
          pill.innerHTML = `<i class="fas fa-hourglass-half"></i> ${isUr ? 'Upload ka intezar' : 'Awaiting 12:00 PM Upload'}`;
        }
        return;
      }
      cdEl.textContent = formatHMS(rem);
    }, 1000);
  }

  // While waiting for the daily file, check every 45s so early uploads (e.g. 10 AM / 11 AM PKT) immediately stop the timer & switch to "File Updated"
  if (!uploaded && typeof window.apiFetch === 'function') {
    window._zyCdr2StatusPoller = setInterval(async () => {
      if (!document.getElementById(targetHostId)) {
        clearInterval(window._zyCdr2StatusPoller);
        window._zyCdr2StatusPoller = null;
        return;
      }
      try {
        const fresh = await window.apiFetch('/api/cdr2/status', { silent: true });
        if (fresh && (fresh.yesterday_uploaded || fresh.file_updated)) {
          window.zyRenderCdr2DailyBanner(targetHostId, fresh);
        }
      } catch (_) {}
    }, 45000);
  }
};

/* ═══ CDR 2 (MONTHLY ROUTE) FIRST-TIME TERMS & CONDITIONS MODAL ═══ */
window.zyOpenCdr2TermsModal = function (opts) {
  const cfg = opts || {};
  const viewOnly = Boolean(cfg.viewOnly);
  const existing = document.getElementById('zy-cdr2-terms-backdrop');
  if (existing) existing.remove();

  const isUr = Boolean(window.HumexI18n && typeof window.HumexI18n.getLanguage === 'function' && window.HumexI18n.getLanguage() === 'roman_ur');

  const wrap = document.createElement('div');
  wrap.id = 'zy-cdr2-terms-backdrop';
  wrap.className = 'zy-cdr2-terms-backdrop';
  wrap.innerHTML = `
    <div class="zy-cdr2-terms-card" role="dialog" aria-modal="true" aria-label="Monthly Route Terms and Conditions">
      <div class="zy-cdr2-terms-head">
        <div class="zy-cdr2-terms-head-l">
          <div class="zy-cdr2-terms-ico"><i class="fas fa-shield-halved"></i></div>
          <div>
            <div class="zy-cdr2-terms-title">${isUr ? 'Monthly Route (CDR 2) — Terms & Conditions' : 'Monthly Route (CDR 2) — Terms & Conditions'}</div>
            <div class="zy-cdr2-terms-sub">${isUr ? 'Kaam shuru karne se pehle zaroori hidayat parh lein' : 'Please review these key terms before using CDR 2'}</div>
          </div>
        </div>
        ${viewOnly ? `<button type="button" class="zy-cdr2-terms-x" id="zy-cdr2-terms-x" aria-label="Close">&times;</button>` : ''}
      </div>

      <div class="zy-cdr2-terms-body">
        <div class="zy-cdr2-term-item">
          <div class="zy-cdr2-term-num">1</div>
          <div>
            <div class="zy-cdr2-term-h">${isUr ? `Monthly Basis Settlement (30/${zyGetMonthlyHoldDays()})` : `Monthly Basis Settlement (30/${zyGetMonthlyHoldDays()})`}</div>
            <div class="zy-cdr2-term-p">
              ${isUr
                ? `Ye route strictly <strong>Monthly (30/${zyGetMonthlyHoldDays()})</strong> auto-rolling 30-din settlement cycle par chalta hai — har 30 din baad cycle mukammal ho kar <strong>${zyGetMonthlyHoldDays} din hold</strong> ke baad clear hota hai.`
                : `This route operates strictly on an auto-rolling <strong>Monthly (30/${zyGetMonthlyHoldDays()})</strong> settlement cycle (every 30 days + <strong>${zyGetMonthlyHoldDays}-day hold</strong>) rather than weekly payouts.`}
            </div>
          </div>
        </div>

        <div class="zy-cdr2-term-item">
          <div class="zy-cdr2-term-num">2</div>
          <div>
            <div class="zy-cdr2-term-h">${isUr ? 'Rozana Report Update (12:00 PM PKT)' : 'Daily Report Schedule (12:00 PM PKT)'}</div>
            <div class="zy-cdr2-term-p">
              ${isUr
                ? 'Pichle din ki official SMS report rozana <strong>12:00 PM PKT</strong> ke qareeb upload hoti hai. Report update hone tak thora intezar karein.'
                : 'Previous day’s official SMS stats are uploaded daily around <strong>12:00 PM PKT</strong> and reflected automatically once published.'}
            </div>
          </div>
        </div>

        <div class="zy-cdr2-term-item is-warn">
          <div class="zy-cdr2-term-num">3</div>
          <div>
            <div class="zy-cdr2-term-h">${isUr ? 'Apni Zimmedari & Carrier Settlement Policy' : 'Voluntary Participation & Carrier Settlement'}</div>
            <div class="zy-cdr2-term-p">
              ${isUr
                ? 'Monthly route par kaam karna mukammal tor par aap ki apni marzi aur risk par hai. Carrier company se monthly settlement receive hotay hi aap ka payout foran release kar diya jata hai — aam tor par company settlements regular clear karti hai, lekin final payout upstream carrier confirmation par munhasir hota hai.'
                : 'Working on this monthly route is voluntary and at your own discretion. Payouts are released promptly upon receipt of the monthly carrier settlement — while upstream settlements are routinely fulfilled, final disbursement remains subject to carrier confirmation and payout release.'}
            </div>
          </div>
        </div>

        <div id="zy-cdr2-terms-alert" class="zy-modal-alert" style="display:none;margin-top:10px;"></div>

        ${!viewOnly ? `
          <label class="zy-cdr2-terms-check">
            <input type="checkbox" id="zy-cdr2-terms-cb">
            <span>${isUr
              ? 'Main ne Monthly Route (CDR 2) ki tamam Terms & Conditions parh li hain aur un se ittefaq karta hoon.'
              : 'I have read, understood, and agree to the Monthly Route (CDR 2) Terms & Conditions.'}</span>
          </label>
        ` : ''}
      </div>

      <div class="zy-cdr2-terms-foot">
        ${viewOnly ? `
          <button type="button" class="btn btn-primary btn-sm" id="zy-cdr2-terms-close-btn">${isUr ? 'Band Karein' : 'Close'}</button>
        ` : `
          <button type="button" class="btn btn-primary" id="zy-cdr2-terms-accept-btn" disabled>
            <i class="fas fa-check-circle"></i> ${isUr ? 'Qubool Karein aur Aage Barhein' : 'Accept & Continue to CDR 2'}
          </button>
        `}
      </div>
    </div>
  `;

  document.body.appendChild(wrap);
  document.body.classList.add('zy-modal-open');

  const closeWrap = () => {
    wrap.remove();
    if (!document.querySelector('#modal-overlay.open')) {
      document.body.classList.remove('zy-modal-open');
    }
  };

  // Never close on outside click — gentle nudge only
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap && typeof window.zyNudgeModal === 'function') {
      window.zyNudgeModal(wrap.querySelector('.zy-cdr2-terms-card'));
    }
  });

  if (viewOnly) {
    const xBtn = document.getElementById('zy-cdr2-terms-x');
    const cBtn = document.getElementById('zy-cdr2-terms-close-btn');
    if (xBtn) xBtn.addEventListener('click', closeWrap);
    if (cBtn) cBtn.addEventListener('click', closeWrap);
    return;
  }

  const cb = document.getElementById('zy-cdr2-terms-cb');
  const accBtn = document.getElementById('zy-cdr2-terms-accept-btn');
  if (cb && accBtn) {
    cb.addEventListener('change', () => {
      accBtn.disabled = !cb.checked;
    });
    accBtn.addEventListener('click', async () => {
      if (!cb.checked) return;
      accBtn.disabled = true;
      const origHtml = accBtn.innerHTML;
      accBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      try {
        await apiFetch('/api/cdr2/accept-terms', {
          method: 'POST',
          body: JSON.stringify({ accepted: true })
        });
        closeWrap();
        if (typeof toast === 'function') {
          toast(isUr ? 'Terms & Conditions save ho gayi hain' : 'Terms & Conditions accepted', 'success');
        }
        if (typeof cfg.onAccepted === 'function') cfg.onAccepted();
      } catch (err) {
        const msg = typeof window.zyHumanizeError === 'function' ? window.zyHumanizeError(err) : (err.message || 'Could not save acceptance');
        if (typeof window.zySetModalAlert === 'function') {
          window.zySetModalAlert('zy-cdr2-terms-alert', msg, 'error');
        } else if (typeof toast === 'function') {
          toast(msg, 'error');
        }
        accBtn.disabled = false;
        accBtn.innerHTML = origHtml;
      }
    });
  }
};

/* ═══════════════════════════════════════════════════════════════════════
   CUSTOM IFRAME-SAFE CONFIRM & PROMPT DIALOGS (Replaces native confirm/prompt)
   ═══════════════════════════════════════════════════════════════════════ */
window.zyConfirm = function (message, opts = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('zy-confirm-overlay');
    if (existing) existing.remove();
    const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const title = opts.title || 'Confirm Action';
    const okLabel = opts.confirmText || 'Confirm';
    const cancelLabel = opts.cancelText || 'Cancel';
    const isDanger = opts.danger !== false;

    const wrap = document.createElement('div');
    wrap.id = 'zy-confirm-overlay';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,0.58);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:16px;';
    wrap.innerHTML = `
      <div style="background:var(--bg-surface,#ffffff);color:var(--text-primary,#0f172a);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;max-width:440px;width:100%;box-shadow:0 20px 50px rgba(15,23,42,0.28);overflow:hidden;">
        <div style="padding:14px 18px;border-bottom:1px solid var(--border-color,#e2e8f0);display:flex;align-items:center;gap:10px;background:${isDanger ? '#fef2f2' : '#f8fafc'};">
          <span style="width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:${isDanger ? '#fee2e2' : '#dbeafe'};color:${isDanger ? '#dc2626' : '#2563eb'};font-size:14px;">
            <i class="fas ${isDanger ? 'fa-triangle-exclamation' : 'fa-circle-question'}"></i>
          </span>
          <span style="font-weight:700;font-size:14.5px;color:#0f172a;">${esc(title)}</span>
        </div>
        <div style="padding:18px;font-size:13.5px;line-height:1.55;color:var(--text-secondary,#334155);white-space:pre-line;">${esc(message)}</div>
        <div style="padding:12px 18px;border-top:1px solid var(--border-color,#e2e8f0);display:flex;justify-content:flex-end;gap:8px;background:var(--bg-subtle,#f8fafc);">
          <button type="button" id="zy-confirm-cancel" class="btn btn-sm" style="padding:7px 14px;border-radius:7px;border:1px solid #cbd5e1;background:#ffffff;color:#334155;font-weight:600;cursor:pointer;">${esc(cancelLabel)}</button>
          <button type="button" id="zy-confirm-ok" class="btn btn-sm" style="padding:7px 16px;border-radius:7px;border:none;background:${isDanger ? '#dc2626' : '#2563eb'};color:#ffffff;font-weight:600;cursor:pointer;">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const cleanup = (val) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(false); });
    wrap.querySelector('#zy-confirm-cancel').addEventListener('click', () => cleanup(false));
    const okBtn = wrap.querySelector('#zy-confirm-ok');
    okBtn.addEventListener('click', () => cleanup(true));
    setTimeout(() => { try { okBtn.focus(); } catch (_) {} }, 20);
  });
};

window.zyPrompt = function (message, defaultValue = '', opts = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('zy-prompt-overlay');
    if (existing) existing.remove();
    const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const title = opts.title || 'Input Required';
    const okLabel = opts.confirmText || 'Submit';
    const cancelLabel = opts.cancelText || 'Cancel';
    const placeholder = opts.placeholder || '';

    const wrap = document.createElement('div');
    wrap.id = 'zy-prompt-overlay';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,0.58);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:16px;';
    wrap.innerHTML = `
      <div style="background:var(--bg-surface,#ffffff);color:var(--text-primary,#0f172a);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;max-width:440px;width:100%;box-shadow:0 20px 50px rgba(15,23,42,0.28);overflow:hidden;">
        <div style="padding:14px 18px;border-bottom:1px solid var(--border-color,#e2e8f0);display:flex;align-items:center;gap:10px;background:#f8fafc;">
          <span style="width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:#dbeafe;color:#2563eb;font-size:14px;">
            <i class="fas fa-pen-to-square"></i>
          </span>
          <span style="font-weight:700;font-size:14.5px;color:#0f172a;">${esc(title)}</span>
        </div>
        <div style="padding:18px;">
          <div style="font-size:13.5px;line-height:1.5;color:var(--text-secondary,#334155);margin-bottom:10px;">${esc(message)}</div>
          <input type="text" id="zy-prompt-input" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;">
        </div>
        <div style="padding:12px 18px;border-top:1px solid var(--border-color,#e2e8f0);display:flex;justify-content:flex-end;gap:8px;background:var(--bg-subtle,#f8fafc);">
          <button type="button" id="zy-prompt-cancel" class="btn btn-sm" style="padding:7px 14px;border-radius:7px;border:1px solid #cbd5e1;background:#ffffff;color:#334155;font-weight:600;cursor:pointer;">${esc(cancelLabel)}</button>
          <button type="button" id="zy-prompt-ok" class="btn btn-sm" style="padding:7px 16px;border-radius:7px;border:none;background:#2563eb;color:#ffffff;font-weight:600;cursor:pointer;">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const inputEl = wrap.querySelector('#zy-prompt-input');
    const cleanup = (val) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(null);
      else if (e.key === 'Enter' && document.activeElement === inputEl) cleanup(inputEl.value);
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(null); });
    wrap.querySelector('#zy-prompt-cancel').addEventListener('click', () => cleanup(null));
    wrap.querySelector('#zy-prompt-ok').addEventListener('click', () => cleanup(inputEl.value));
    setTimeout(() => { try { inputEl.focus(); inputEl.select(); } catch (_) {} }, 20);
  });
};

/* ═══════════════════════════════════════════════════════════════════════
   LIVE ACCESS — API-ONLY MASKED OTP LIVE STREAM (Owner / Agent / Client)
   Exact 3 Columns: Range | CLI | SMS (OTP masked as XXX server-side)
   ═══════════════════════════════════════════════════════════════════════ */
window._zyLiveAccessRows = [];
window._zyLiveAccessIds = new Set();
window._zyLiveAccessPollTimer = null;
window._zyLiveAccessPage = 1;
window._zyLiveAccessLimit = 25;
window._zyLiveAccessHasNext = false;
window._zyLiveAccessHasPrev = false;

window.zyRenderLiveAccessPager = function () {
  const pager = document.getElementById('zy-live-access-pager');
  if (!pager) return;
  const page = Number(window._zyLiveAccessPage || 1);
  const isLive = page === 1;
  const hasPrev = Boolean(window._zyLiveAccessHasPrev && page > 1);
  const hasNext = Boolean(window._zyLiveAccessHasNext);

  pager.innerHTML = `
    <div class="zy-la-pager">
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="btn btn-sm ${isLive ? 'btn-success' : 'btn-outline'}" onclick="zyGoLiveAccessLive()" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${isLive ? '#ffffff' : '#10b981'};display:inline-block;"></span>
          Live
        </button>
        <span class="zy-la-pager-meta">${isLive ? 'Showing latest 25 live messages' : `Viewing page ${page} (25 per page)`}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="btn btn-sm btn-outline" onclick="zyGoLiveAccessPage(${page - 1})" ${hasPrev ? '' : 'disabled'} style="min-width:86px;">
          <i class="fas fa-chevron-left"></i> Previous
        </button>
        <button type="button" class="btn btn-sm btn-primary" onclick="zyGoLiveAccessPage(${page + 1})" ${hasNext ? '' : 'disabled'} style="min-width:86px;">
          Next <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    </div>`;
};

window.zyGoLiveAccessLive = function () {
  window._zyLiveAccessPage = 1;
  window.zyFetchLiveAccessFeed(false, 1);
};

window.zyGoLiveAccessPage = function (targetPage) {
  const nextP = Math.max(1, Number(targetPage) || 1);
  window._zyLiveAccessPage = nextP;
  window.zyFetchLiveAccessFeed(false, nextP);
};

window.zyRenderLiveAccessTableBody = function () {
  const tbody = document.getElementById('zy-live-access-tbody');
  if (!tbody) return;
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? ''));
  const qEl = document.getElementById('zy-live-access-search');
  const q = qEl ? qEl.value.trim().toLowerCase() : '';
  const rows = (window._zyLiveAccessRows || []).filter(r => {
    if (!q) return true;
    return `${r.range || ''} ${r.cli || ''} ${r.sms || ''}`.toLowerCase().includes(q);
  });
  const countBadge = document.getElementById('zy-live-access-count');
  if (countBadge) {
    countBadge.textContent = Number(window._zyLiveAccessPage || 1) === 1 ? 'LIVE · 25/Page' : `Page ${window._zyLiveAccessPage}`;
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:34px;color:#64748b;font-size:13px;">
      <i class="fas fa-satellite-dish" style="font-size:20px;color:#94a3b8;display:block;margin-bottom:8px;"></i>
      No API OTP messages available on this page.
    </td></tr>`;
    window.zyRenderLiveAccessPager();
    return;
  }

  const fmtTimeCell = (raw) => {
    if (!raw) return '—';
    let tsStr = '';
    if (typeof window.zyFormatUtc === 'function') {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) tsStr = window.zyFormatUtc(d, false);
    }
    if (!tsStr) {
      tsStr = String(raw).replace('T', ' ').replace(/\.\d+Z?$/i, '').slice(0, 19);
    }
    if (typeof window.zyFormatDateTimeStacked === 'function') {
      return window.zyFormatDateTimeStacked(tsStr).h;
    }
    return esc(tsStr || '—');
  };

  tbody.innerHTML = rows.slice(0, window._zyLiveAccessLimit || 25).map(r => {
    const smsText = String(r.sms || '');
    const smsHtml = typeof window.zyRenderSmsCell === 'function'
      ? window.zyRenderSmsCell(smsText, 32)
      : `<div class="zy-sms-cell">${esc(smsText)}</div>`;
    return `
    <tr>
      <td class="zy-la-time">${fmtTimeCell(r.timestamp || r.created_at || r.created || '')}</td>
      <td class="zy-la-range" title="${esc(r.range || 'International')}">${esc(r.range || 'International')}</td>
      <td class="zy-la-cli-td">
        <span class="zy-la-cli">${esc(r.cli || 'SMS')}</span>
      </td>
      <td class="zy-la-sms-td">${smsHtml}</td>
    </tr>`;
  }).join('');
  window.zyRenderLiveAccessPager();
};

window.zyHandleLiveAccessWsEvent = function (item) {
  if (!item || !document.getElementById('zy-live-access-tbody')) return;
  // Only live-prepend when user is on Live (Page 1)
  if (Number(window._zyLiveAccessPage || 1) !== 1) return;
  const key = item.id != null ? String(item.id) : `${item.range}|${item.cli}|${item.sms}|${item.timestamp}`;
  if (window._zyLiveAccessIds.has(key)) return;
  window._zyLiveAccessIds.add(key);
  window._zyLiveAccessRows.unshift(item);
  const maxRows = window._zyLiveAccessLimit || 25;
  if (window._zyLiveAccessRows.length > maxRows) {
    window._zyLiveAccessRows = window._zyLiveAccessRows.slice(0, maxRows);
    window._zyLiveAccessHasNext = true;
  }
  window.zyRenderLiveAccessTableBody();
};

window.zySaveLiveAccessToggle = async function (field, checked) {
  try {
    const body = {};
    body[field] = Boolean(checked);
    const res = await apiFetch('/api/owner/live-access-config', {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    if (res && res.success) {
      if (typeof toast === 'function') {
        const who = field === 'live_access_agents_enabled' ? 'Agents' : 'Clients';
        toast(`Live Access for ${who} ${checked ? 'Enabled' : 'Disabled'}`, 'success');
      }
      const agState = document.getElementById('zy-la-agent-state');
      const clState = document.getElementById('zy-la-client-state');
      if (agState) agState.textContent = res.live_access_agents_enabled ? 'ON — All Agents can see Live Access' : 'OFF — Hidden from Agents';
      if (clState) clState.textContent = res.live_access_clients_enabled ? 'ON — All Clients can see Live Access' : 'OFF — Hidden from Clients';
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err?.message || 'Failed to update Live Access permission', 'error');
  }
};

window.zyFetchLiveAccessFeed = async function (silent = false, targetPage = null) {
  const tbody = document.getElementById('zy-live-access-tbody');
  if (!tbody) return;
  const page = Math.max(1, Number(targetPage != null ? targetPage : window._zyLiveAccessPage) || 1);
  window._zyLiveAccessPage = page;
  const limit = window._zyLiveAccessLimit || 25;
  const qEl = document.getElementById('zy-live-access-search');
  const q = qEl ? qEl.value.trim() : '';
  try {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) qs.set('search', q);
    const res = await apiFetch(`/api/live-access?${qs.toString()}`);
    if (res && res.error) {
      if (!silent) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:28px;color:#dc2626;font-weight:600;">${typeof escapeHtml === 'function' ? escapeHtml(res.error) : res.error}</td></tr>`;
      }
      return;
    }
    const list = Array.isArray(res?.data) ? res.data : [];
    window._zyLiveAccessRows = list;
    window._zyLiveAccessHasNext = Boolean(res?.has_next);
    window._zyLiveAccessHasPrev = Boolean(res?.has_prev);
    window._zyLiveAccessIds = new Set(list.map(r => (r.id != null ? String(r.id) : `${r.range}|${r.cli}|${r.sms}|${r.timestamp}`)));

    // Sync Owner toggle switches if present
    const agToggle = document.getElementById('zy-la-toggle-agents');
    const clToggle = document.getElementById('zy-la-toggle-clients');
    const agState = document.getElementById('zy-la-agent-state');
    const clState = document.getElementById('zy-la-client-state');
    if (agToggle && typeof res.live_access_agents_enabled === 'boolean') {
      agToggle.checked = res.live_access_agents_enabled;
      if (agState) agState.textContent = res.live_access_agents_enabled ? 'ON — All Agents can see Live Access' : 'OFF — Hidden from Agents';
    }
    if (clToggle && typeof res.live_access_clients_enabled === 'boolean') {
      clToggle.checked = res.live_access_clients_enabled;
      if (clState) clState.textContent = res.live_access_clients_enabled ? 'ON — All Clients can see Live Access' : 'OFF — Hidden from Clients';
    }
    window.zyRenderLiveAccessTableBody();
  } catch (err) {
    if (!silent) {
      const msg = (err && err.message) || 'Could not load Live Access feed';
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:28px;color:#dc2626;">${typeof escapeHtml === 'function' ? escapeHtml(msg) : msg}</td></tr>`;
    }
  }
};

window._zyLiveAccessSearchDebounce = null;
window.zyOnLiveAccessSearchInput = function () {
  if (window._zyLiveAccessSearchDebounce) clearTimeout(window._zyLiveAccessSearchDebounce);
  window._zyLiveAccessSearchDebounce = setTimeout(() => {
    window._zyLiveAccessPage = 1;
    window.zyFetchLiveAccessFeed(false, 1);
  }, 260);
};

window.zyRenderLiveAccessPage = async function (opts = {}) {
  const role = String(opts.role || 'owner').toLowerCase();
  const isOwner = role === 'owner' || role === 'admin';
  const c = document.getElementById('page-content');
  if (!c) return;
  if (typeof zyCrumb === 'function') zyCrumb(['Live Access']);
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = 'Live Access';

  window._zyLiveAccessPage = 1;
  window._zyLiveAccessLimit = 25;
  if (window._zyLiveAccessPollTimer) {
    clearInterval(window._zyLiveAccessPollTimer);
    window._zyLiveAccessPollTimer = null;
  }

  const ownerControls = isOwner ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px;">
      <label class="zy-la-toggle-card">
        <div>
          <div class="zy-la-toggle-title"><i class="fas fa-user-tie" style="color:#2563eb;margin-right:6px;"></i> Agent Live Access</div>
          <div id="zy-la-agent-state" class="zy-la-toggle-sub">Loading status…</div>
        </div>
        <input type="checkbox" id="zy-la-toggle-agents" onchange="zySaveLiveAccessToggle('live_access_agents_enabled', this.checked)" style="width:20px;height:20px;accent-color:#2563eb;cursor:pointer;">
      </label>
      <label class="zy-la-toggle-card">
        <div>
          <div class="zy-la-toggle-title"><i class="fas fa-users" style="color:#059669;margin-right:6px;"></i> Client Live Access</div>
          <div id="zy-la-client-state" class="zy-la-toggle-sub">Loading status…</div>
        </div>
        <input type="checkbox" id="zy-la-toggle-clients" onchange="zySaveLiveAccessToggle('live_access_clients_enabled', this.checked)" style="width:20px;height:20px;accent-color:#059669;cursor:pointer;">
      </label>
    </div>` : '';

  c.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <div>
        <div class="page-title" style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-tower-broadcast" style="color:#10b981;"></i> Live Access
        </div>
        <div class="page-subtitle">Real-time API OTP stream with protected masked codes (XXX) — 25 per page</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span id="zy-live-access-count" class="badge badge-green" style="font-size:11.5px;padding:5px 10px;">LIVE · 25/Page</span>
        <button type="button" class="btn btn-sm btn-primary" onclick="zyGoLiveAccessLive()"><i class="fas fa-bolt"></i> Live</button>
      </div>
    </div>
    ${ownerControls}
    <div class="apx-card zy-la-card">
      <div class="apx-card-header zy-la-head">
        <span class="zy-la-head-title">
          <i class="fas fa-shield-halved" style="color:#059669;margin-right:6px;"></i> Live API Messages (Masked OTP)
        </span>
        <input type="text" id="zy-live-access-search" class="zy-la-search" oninput="zyOnLiveAccessSearchInput()" placeholder="Search Range, CLI, or SMS…">
      </div>
      <div class="zy-dt-wrap zy-la-tbl-wrap">
        <table class="zy-dt zy-dt2-table data-table zy-la-table">
          <thead>
            <tr>
              <th class="zy-la-th-time">Time</th>
              <th class="zy-la-th-range">Range</th>
              <th class="zy-la-th-cli">CLI</th>
              <th class="zy-la-th-sms">SMS</th>
            </tr>
          </thead>
          <tbody id="zy-live-access-tbody">
            <tr><td colspan="4" style="text-align:center;padding:30px;color:var(--sp-text-muted,#64748b);">Loading Live Access stream…</td></tr>
          </tbody>
        </table>
      </div>
      <div id="zy-live-access-pager"></div>
    </div>`;

  await window.zyFetchLiveAccessFeed(false, 1);

  window._zyLiveAccessPollTimer = setInterval(() => {
    if (!document.getElementById('zy-live-access-tbody')) {
      clearInterval(window._zyLiveAccessPollTimer);
      window._zyLiveAccessPollTimer = null;
      return;
    }
    if (Number(window._zyLiveAccessPage || 1) === 1) {
      window.zyFetchLiveAccessFeed(true, 1);
    }
  }, 5000);
  if (typeof activePollers !== 'undefined' && Array.isArray(activePollers)) {
    activePollers.push(window._zyLiveAccessPollTimer);
  }
};

/* Global 1-click App Link Copy Helper (Available across Owner, Agent & Client pages) */
window.zyCopyAppLinkUrl = function (btn) {
  try {
    const url = btn && btn.getAttribute('data-url') ? String(btn.getAttribute('data-url')) : '';
    if (!url || url === '#') return;
    const done = () => {
      if (!btn) return;
      const orig = btn.innerHTML;
      btn.classList.add('is-copied');
      btn.innerHTML = '<i class="fas fa-check"></i> Copied';
      setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.innerHTML = orig;
      }, 1500);
      if (typeof window.toast === 'function') window.toast('App link copied!', 'success');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
        done();
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      done();
    }
  } catch (_) {}
};

window.zyRenderAppLinksPager = function(opts) {
  const page = Math.max(1, Number(opts?.page) || 1);
  const totalPages = Math.max(1, Number(opts?.totalPages) || 1);
  const total = Math.max(0, Number(opts?.total) || 0);
  const limit = Math.max(1, Number(opts?.limit) || 25);
  const onPageFn = String(opts?.onPageFn || '').replace(/[^a-zA-Z0-9_$.]/g, '');
  const idPrefix = String(opts?.idPrefix || 'al').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!total || !onPageFn) return '';

  const start = (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);
  const nums = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) nums.push(i);
  } else {
    nums.push(1);
    const left = Math.max(2, page - 2);
    const right = Math.min(totalPages - 1, page + 2);
    if (left > 2) nums.push('…');
    for (let i = left; i <= right; i++) nums.push(i);
    if (right < totalPages - 1) nums.push('…');
    nums.push(totalPages);
  }

  const pageBtns = nums.map(n => {
    if (n === '…') return `<span class="zy-al-pg-dots">…</span>`;
    const active = n === page ? ' is-active' : '';
    return `<button type="button" class="zy-al-pg-btn${active}" onclick="${onPageFn}(${n})" ${n === page ? 'aria-current="page"' : ''}>${n.toLocaleString()}</button>`;
  }).join('');

  const jumpId = `${idPrefix}-pg-jump`;
  return `
    <div class="zy-al-pager" role="navigation" aria-label="Apps Links Pagination">
      <div class="zy-al-pager-info">
        Showing <strong>${start.toLocaleString()}–${end.toLocaleString()}</strong> of <strong>${total.toLocaleString()}</strong>
        <span class="zy-al-pager-sep">·</span>
        Page <strong>${page.toLocaleString()}</strong> / <strong>${totalPages.toLocaleString()}</strong> (${limit}/page)
      </div>
      <div class="zy-al-pager-controls">
        <button type="button" class="zy-al-pg-btn" onclick="${onPageFn}(${Math.max(1, page - 1)})" ${page <= 1 ? 'disabled' : ''}>
          <i class="fas fa-chevron-left"></i> Prev
        </button>
        ${pageBtns}
        <button type="button" class="zy-al-pg-btn" onclick="${onPageFn}(${Math.min(totalPages, page + 1)})" ${page >= totalPages ? 'disabled' : ''}>
          Next <i class="fas fa-chevron-right"></i>
        </button>
        ${totalPages > 1 ? `
          <form class="zy-al-pg-jump" onsubmit="event.preventDefault();const _el=document.getElementById('${jumpId}');const _p=Math.max(1,Math.min(${totalPages},parseInt(_el&&_el.value,10)||1));${onPageFn}(_p);">
            <input type="number" id="${jumpId}" min="1" max="${totalPages}" value="${page}" aria-label="Jump to page">
            <button type="submit" class="zy-al-pg-btn">Go</button>
          </form>
        ` : ''}
      </div>
    </div>
  `;
};





