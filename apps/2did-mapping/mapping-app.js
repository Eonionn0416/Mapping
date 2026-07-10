import { mappingFirebaseConfig } from "../../shared/firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = mappingFirebaseConfig;

const app = initializeApp(firebaseConfig);
analyticsIsSupported().then((supported) => {
  if (supported) getAnalytics(app);
}).catch(() => {});
const db = getFirestore(app);

const REQUIRED_COLUMNS = [
  'LOT ID', 'STRIP ID', 'X', 'Y', 'UNIT ID', 'WAFER ID', 'WAFER COL', 'WAFER ROW', 'Fail'
];
const FILTER_COLUMNS = REQUIRED_COLUMNS;
const HISTORY_COLLECTION = 'mappingHistories';
const ROW_CHUNK_COLLECTION = 'rowChunks';
const ROW_CHUNK_SIZE = 350;

const state = {
  rawRows: [],
  sourceFileName: '',
  filters: {},
  mapType: 'strip',
  groupValue: 'MERGE',
  cellSize: 14,
  showOnlyFail: false,
  activeHistoryId: null,
  histories: [],
  isBusy: false,
  filterSearches: {},
  renderTimer: null
};

const FILTER_VISIBLE_LIMIT = 220;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

function setBusy(isBusy, message = '') {
  state.isBusy = isBusy;
  const btn = document.querySelector('#requestForm button[type="submit"]');
  if (btn) {
    btn.disabled = isBusy;
    btn.textContent = isBusy ? (message || 'Saving...') : 'Save mapping result';
  }
}

function firestoreErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('permission-denied')) {
    return 'Firestore 권한이 막혀 있습니다. Firebase Console > Firestore Rules에서 mappingHistories 읽기/쓰기를 허용한 뒤 Publish 해야 합니다.';
  }
  return error?.message || String(error);
}

function normalizeKey(key) {
  return String(key || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function normalizeRows(rows) {
  return rows.map((row, idx) => {
    const normalized = { __idx: Number(row.__idx ?? idx) };
    Object.keys(row).forEach((key) => {
      const cleanKey = REQUIRED_COLUMNS.find(col => normalizeKey(col) === normalizeKey(key)) || key;
      normalized[cleanKey] = row[key];
    });
    normalized.X = Number(normalized.X);
    normalized.Y = Number(normalized.Y);
    normalized['WAFER COL'] = Number(normalized['WAFER COL']);
    normalized['WAFER ROW'] = Number(normalized['WAFER ROW']);
    normalized.Fail = Number(normalized.Fail || 0);
    return normalized;
  }).filter(row => REQUIRED_COLUMNS.every(col => row[col] !== undefined && row[col] !== null && row[col] !== ''));
}

function compactRow(row) {
  return {
    __idx: Number(row.__idx),
    'LOT ID': String(row['LOT ID'] ?? ''),
    'STRIP ID': String(row['STRIP ID'] ?? ''),
    X: Number(row.X),
    Y: Number(row.Y),
    'UNIT ID': String(row['UNIT ID'] ?? ''),
    'WAFER ID': String(row['WAFER ID'] ?? ''),
    'WAFER COL': Number(row['WAFER COL']),
    'WAFER ROW': Number(row['WAFER ROW']),
    Fail: Number(row.Fail || 0)
  };
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const workbook = XLSX.read(e.target.result, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const missing = REQUIRED_COLUMNS.filter(col => !Object.keys(rows[0] || {}).some(k => normalizeKey(k) === normalizeKey(col)));
    if (missing.length) {
      alert(`필수 컬럼 누락: ${missing.join(', ')}`);
      return;
    }
    state.rawRows = normalizeRows(rows);
    state.sourceFileName = file.name;
    state.filters = {};
    state.filterSearches = {};
    state.groupValue = 'MERGE';
    state.activeHistoryId = null;
    updateActiveHistoryLabel();
    renderFilters();
    renderGroupOptions();
    renderAll();
  };
  reader.readAsArrayBuffer(file);
}

function uniqueValues(col, rows = state.rawRows) {
  return [...new Set(rows.map(r => String(r[col] ?? '')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function getFilteredRows(rows = state.rawRows) {
  return rows.filter(row => {
    return Object.entries(state.filters).every(([col, values]) => {
      if (!values || !values.length) return true;
      return values.includes(String(row[col]));
    });
  });
}

function hasActiveFilters() {
  return Object.values(state.filters).some(values => values && values.length);
}

function getMapColumns(mapType = state.mapType) {
  return mapType === 'strip'
    ? { groupCol: 'STRIP ID', xCol: 'X', yCol: 'Y', label: 'Strip' }
    : { groupCol: 'WAFER ID', xCol: 'WAFER COL', yCol: 'WAFER ROW', label: 'Wafer' };
}

function getGlobalBounds(rows, xCol, yCol) {
  const xs = rows.map(r => Number(r[xCol])).filter(Number.isFinite);
  const ys = rows.map(r => Number(r[yCol])).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  const minX = Math.min(...xs) <= 0 ? Math.min(...xs) : 1;
  const minY = Math.min(...ys) <= 0 ? Math.min(...ys) : 1;
  return { minX, maxX: Math.max(...xs), minY, maxY: Math.max(...ys) };
}

function scheduleRenderAll(delay = 70) {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(() => {
    renderAll();
  }, delay);
}

function applyFilterValue(col, value, checked) {
  const values = new Set((state.filters[col] || []).map(String));
  if (checked) values.add(String(value));
  else values.delete(String(value));
  state.filters[col] = [...values];
  if (!state.filters[col].length) delete state.filters[col];
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  scheduleRenderAll();
}

function addFilterValues(valuesByColumn) {
  Object.entries(valuesByColumn).forEach(([col, values]) => {
    const current = new Set((state.filters[col] || []).map(String));
    values.filter(v => v !== undefined && v !== null && String(v) !== '').forEach(v => current.add(String(v)));
    if (current.size) state.filters[col] = [...current];
  });
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  renderFilters();
  scheduleRenderAll(20);
}

function removeFilterValues(valuesByColumn) {
  Object.entries(valuesByColumn).forEach(([col, values]) => {
    const current = new Set((state.filters[col] || []).map(String));
    values.filter(v => v !== undefined && v !== null && String(v) !== '').forEach(v => current.delete(String(v)));
    if (current.size) state.filters[col] = [...current];
    else delete state.filters[col];
  });
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  renderFilters();
  scheduleRenderAll(20);
}

function filtersContainAll(valuesByColumn) {
  return Object.entries(valuesByColumn).every(([col, values]) => {
    const current = new Set((state.filters[col] || []).map(String));
    const cleanValues = values.filter(v => v !== undefined && v !== null && String(v) !== '').map(String);
    return cleanValues.length && cleanValues.every(v => current.has(v));
  });
}

function toggleFilterValues(valuesByColumn) {
  if (filtersContainAll(valuesByColumn)) removeFilterValues(valuesByColumn);
  else addFilterValues(valuesByColumn);
}

function resetFilterColumn(col) {
  delete state.filters[col];
  state.filterSearches[col] = '';
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  renderFilters();
  scheduleRenderAll(20);
}

function updateFilterCount(block, col) {
  const count = (state.filters[col] || []).length;
  const countEl = block.querySelector('.filter-count');
  if (countEl) countEl.textContent = count ? `${count} selected` : 'All';
}

function renderFilterOptions(block, col, values) {
  const optionBox = block.querySelector('.filter-options');
  const selected = new Set((state.filters[col] || []).map(String));
  const q = String(state.filterSearches[col] || '').trim().toLowerCase();
  const matched = q
    ? values.filter(value => String(value).toLowerCase().includes(q))
    : values;
  const visible = matched.slice(0, FILTER_VISIBLE_LIMIT);
  const frag = document.createDocumentFragment();

  visible.forEach(value => {
    const row = document.createElement('label');
    row.className = 'filter-option';
    row.innerHTML = `<input type="checkbox" value="${escapeHtml(value)}" ${selected.has(String(value)) ? 'checked' : ''}> <span>${escapeHtml(value)}</span>`;
    row.querySelector('input').addEventListener('change', (event) => {
      applyFilterValue(col, value, event.target.checked);
      updateFilterCount(block, col);
    });
    frag.appendChild(row);
  });

  optionBox.innerHTML = '';
  optionBox.appendChild(frag);

  let helper = block.querySelector('.filter-helper');
  if (!helper) {
    helper = document.createElement('div');
    helper.className = 'filter-helper';
    optionBox.after(helper);
  }
  if (!matched.length) {
    helper.textContent = '검색 결과가 없습니다.';
  } else if (matched.length > FILTER_VISIBLE_LIMIT) {
    helper.textContent = `${matched.length.toLocaleString()}건 중 ${FILTER_VISIBLE_LIMIT.toLocaleString()}건 표시 중. 더 구체적으로 검색해줘.`;
  } else if (q) {
    helper.textContent = `${matched.length.toLocaleString()}건 검색됨. 체크하면 기존 선택은 유지됩니다.`;
  } else {
    helper.textContent = `${matched.length.toLocaleString()}건 표시 중.`;
  }
}

function renderFilters() {
  const panel = $('filterPanel');
  panel.innerHTML = '';
  FILTER_COLUMNS.forEach(col => {
    const values = uniqueValues(col);
    const selected = new Set((state.filters[col] || []).map(String));
    const block = document.createElement('div');
    block.className = 'filter-block enhanced-filter-block';
    block.innerHTML = `
      <div class="filter-head">
        <strong>${escapeHtml(col)}</strong>
        <button type="button" class="mini-reset-btn">Reset</button>
      </div>
      <div class="filter-subline"><span class="filter-count">${selected.size ? `${selected.size} selected` : 'All'}</span><span>${values.length.toLocaleString()} items</span></div>
      <input class="filter-search" type="search" placeholder="Search ${escapeHtml(col)}..." value="${escapeHtml(state.filterSearches[col] || '')}" />
      <div class="filter-options"></div>
    `;

    block.querySelector('.mini-reset-btn').addEventListener('click', () => resetFilterColumn(col));
    block.querySelector('.filter-search').addEventListener('input', (event) => {
      state.filterSearches[col] = event.target.value;
      renderFilterOptions(block, col, values);
    });
    panel.appendChild(block);
    renderFilterOptions(block, col, values);
  });
}

function renderGroupOptions() {
  const select = $('groupSelect');
  const { groupCol } = getMapColumns();
  const current = state.groupValue;
  select.innerHTML = '';
  [
    ['MERGE', 'MERGE - all IDs overlay'],
    ['ALL', 'ALL - separate maps']
  ].forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });
  uniqueValues(groupCol).forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = [...select.options].some(o => o.value === current) ? current : 'MERGE';
  state.groupValue = select.value;
}

function summarizeRows(rows) {
  const fail = rows.filter(r => Number(r.Fail) > 0).length;
  return {
    total: state.rawRows.length,
    inQty: rows.length,
    failQty: fail,
    failRate: rows.length ? (fail / rows.length) * 100 : 0
  };
}

function renderSummary(filteredRows) {
  const summary = summarizeRows(filteredRows);
  $('totalCount').textContent = summary.total.toLocaleString();
  $('filteredCount').textContent = summary.inQty.toLocaleString();
  $('failCount').textContent = summary.failQty.toLocaleString();
  $('failRate').textContent = `${summary.failRate.toFixed(4)}%`;
}

function buildCellMap(rows, xCol, yCol) {
  const cellMap = new Map();
  rows.forEach(row => {
    const key = `${Number(row[xCol])}|${Number(row[yCol])}`;
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key).push(row);
  });
  return cellMap;
}

function createMapTitle({ label, group, rows, isMerge, groupCol }) {
  const fail = rows.filter(r => Number(r.Fail) > 0).length;
  const div = document.createElement('div');
  div.className = 'map-title';
  const groupCount = isMerge ? uniqueValues(groupCol, rows).length : 1;
  div.textContent = `${label}: ${group} / Units ${rows.length.toLocaleString()} / Fail ${fail.toLocaleString()}${isMerge ? ` / Merged IDs ${groupCount}` : ''}`;
  return div;
}

function renderOneMap(container, options) {
  const { rows, filteredSet, mapType, titleGroup, isMerge } = options;
  const { groupCol, xCol, yCol, label } = getMapColumns(mapType);
  const bounds = getGlobalBounds(state.rawRows.length ? state.rawRows : rows, xCol, yCol);
  if (!bounds) return;

  container.appendChild(createMapTitle({ label, group: titleGroup, rows, isMerge, groupCol }));

  const grid = document.createElement('div');
  grid.className = 'map-grid';
  grid.style.setProperty('--cell-size', `${state.cellSize}px`);
  grid.style.gridTemplateColumns = `repeat(${bounds.maxX - bounds.minX + 1}, var(--cell-size))`;

  const cellMap = buildCellMap(rows, xCol, yCol);
  const activeFilters = hasActiveFilters();
  grid.__cellMap = cellMap;
  grid.__groupCol = groupCol;
  const frag = document.createDocumentFragment();

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const key = `${x}|${y}`;
      const cellRows = cellMap.get(key) || [];
      const cell = document.createElement('div');
      cell.className = 'map-cell';
      if (!cellRows.length) {
        cell.classList.add('empty-cell');
      } else {
        const isFail = cellRows.some(row => Number(row.Fail) > 0);
        const isFiltered = cellRows.some(row => filteredSet.has(row.__idx));
        const isStacked = cellRows.length > 1;
        cell.dataset.key = key;
        if (isFail) cell.classList.add('fail');
        if (isFail && isFiltered && activeFilters) cell.classList.add('selected-fail');
        if (isStacked) cell.classList.add('stacked');
        if (!isFiltered) cell.classList.add('dim');
        if (state.showOnlyFail) cell.classList.add('hide-normal');
      }
      frag.appendChild(cell);
    }
  }

  grid.addEventListener('mousemove', (event) => {
    const cell = event.target.closest('.map-cell[data-key]');
    if (!cell || !grid.contains(cell)) return hideTooltip();
    const cellRows = grid.__cellMap.get(cell.dataset.key) || [];
    if (cellRows.length) showTooltip(event, cellRows, { groupCol: grid.__groupCol });
  });
  grid.addEventListener('mouseleave', hideTooltip);
  grid.addEventListener('click', (event) => {
    const cell = event.target.closest('.map-cell[data-key]');
    if (!cell || !grid.contains(cell)) return;
    const cellRows = grid.__cellMap.get(cell.dataset.key) || [];
    applyMapCellFilter(cellRows);
  });

  grid.appendChild(frag);
  container.appendChild(grid);
}

function renderMap(filteredRows) {
  const container = $('mapContainer');
  if (!state.rawRows.length) {
    container.className = 'map-container empty';
    container.textContent = 'Excel을 업로드하거나 Result History를 선택하면 Map이 표시됩니다.';
    return;
  }
  container.className = 'map-container';
  container.innerHTML = '';

  const { groupCol } = getMapColumns();
  const filteredSet = new Set(filteredRows.map(r => r.__idx));

  if (state.groupValue === 'MERGE') {
    renderOneMap(container, {
      rows: state.rawRows,
      filteredSet,
      mapType: state.mapType,
      titleGroup: 'MERGE',
      isMerge: true
    });
    return;
  }

  const groups = state.groupValue === 'ALL' ? uniqueValues(groupCol, state.rawRows) : [state.groupValue];
  groups.forEach(group => {
    const rows = state.rawRows.filter(r => String(r[groupCol]) === String(group));
    if (!rows.length) return;
    renderOneMap(container, {
      rows,
      filteredSet,
      mapType: state.mapType,
      titleGroup: group,
      isMerge: false
    });
  });
}

function showTooltip(event, rows, { groupCol }) {
  const first = rows[0];
  let tip = document.querySelector('.tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    document.body.appendChild(tip);
  }
  const failCount = rows.filter(r => Number(r.Fail) > 0).length;
  const groups = [...new Set(rows.map(r => r[groupCol]))].slice(0, 8).join(', ');
  const unitLines = rows.slice(0, 5).map(r => `${escapeHtml(r['UNIT ID'])} / Fail:${escapeHtml(r.Fail)}`).join('<br>');
  tip.innerHTML = `
    LOT: ${escapeHtml(first['LOT ID'])}<br>
    Rows on cell: ${rows.length} / Fail: ${failCount}<br>
    Group: ${escapeHtml(groups)}${rows.length > 8 ? ' ...' : ''}<br>
    Strip: ${escapeHtml(first['STRIP ID'])} / X:${escapeHtml(first.X)}, Y:${escapeHtml(first.Y)}<br>
    Wafer: ${escapeHtml(first['WAFER ID'])} / COL:${escapeHtml(first['WAFER COL'])}, ROW:${escapeHtml(first['WAFER ROW'])}<br>
    Unit:<br>${unitLines}${rows.length > 5 ? '<br>...' : ''}
  `;
  tip.style.display = 'block';
  tip.style.left = `${event.clientX + 14}px`;
  tip.style.top = `${event.clientY + 14}px`;
}
function hideTooltip() {
  const tip = document.querySelector('.tooltip');
  if (tip) tip.style.display = 'none';
}


function buildMapCellFilterValues(rows) {
  if (!rows || !rows.length) return null;
  const vals = (col) => [...new Set(rows.map(r => r[col]).filter(v => v !== undefined && v !== null && String(v) !== ''))].map(String);
  const first = rows[0];
  const { groupCol, xCol, yCol } = getMapColumns();
  const valuesByColumn = {
    'LOT ID': vals('LOT ID'),
    [xCol]: [String(first[xCol])],
    [yCol]: [String(first[yCol])]
  };

  // MERGE cell은 같은 좌표에 수십~수백 unit이 겹칠 수 있어서 UNIT ID 전체를 필터에 넣으면 느려집니다.
  // 그래서 MERGE/ALL에서는 좌표 중심으로 toggle하고, 단일 unit일 때만 UNIT ID를 같이 toggle합니다.
  if (state.groupValue !== 'MERGE' && state.groupValue !== 'ALL') {
    valuesByColumn[groupCol] = [String(state.groupValue)];
  } else if (rows.length === 1) {
    valuesByColumn[groupCol] = vals(groupCol);
  }
  if (rows.length === 1) valuesByColumn['UNIT ID'] = vals('UNIT ID');
  return valuesByColumn;
}

function applyMapCellFilter(rows) {
  const valuesByColumn = buildMapCellFilterValues(rows);
  if (!valuesByColumn) return;
  toggleFilterValues(valuesByColumn);
}


function parseStripId(stripId) {
  const text = String(stripId || '').trim();
  if (!text) return { batch: '-', panel: '-', stripNo: '-', normalized: '-' };

  // Daeduck Strip ID rule: P0221810006S 013A
  //   Batch = P0221810006S, Panel = 013, Strip = A~H
  const daeduckMatch = text.match(/^(P\d{10}S)\s*(\d{3})([A-H])$/i);
  if (daeduckMatch) {
    return {
      batch: daeduckMatch[1].toUpperCase(),
      panel: daeduckMatch[2],
      stripNo: daeduckMatch[3].toUpperCase(),
      normalized: `${daeduckMatch[1].toUpperCase()} ${daeduckMatch[2]}${daeduckMatch[3].toUpperCase()}`
    };
  }

  // Existing Simmtech/MS rule: last token is Panel + Strip No.
  // Keep the previous 2-digit panel parsing so existing MS data is not changed.
  const match = text.match(/^(.+?)\s+(\d{2})([A-Za-z0-9]+)$/);
  if (!match) {
    return { batch: text, panel: '-', stripNo: '-', normalized: text };
  }
  return {
    batch: match[1].trim(),
    panel: match[2],
    stripNo: String(match[3]).toUpperCase(),
    normalized: text
  };
}

function formatStripIdCommonality(parsed) {
  if (!parsed || parsed.batch === '-' || parsed.panel === '-' || parsed.stripNo === '-') {
    return parsed?.normalized || '-';
  }
  return `${parsed.batch} / Panel ${parsed.panel} / Strip ${parsed.stripNo}`;
}


function parseWaferId(waferId) {
  const text = String(waferId || '').trim();
  if (!text) return { runNo: '-', slice: '-', normalized: '-' };
  const idx = text.lastIndexOf('-');
  if (idx < 0) {
    return { runNo: text, slice: '-', normalized: text };
  }
  const runNo = text.slice(0, idx).trim() || '-';
  const slice = text.slice(idx + 1).trim() || '-';
  return { runNo, slice, normalized: text };
}

function aggregateBy(rows, keyGetter) {
  const map = new Map();
  rows.forEach(row => {
    const key = String(keyGetter(row) ?? '-');
    if (!map.has(key)) map.set(key, { key, total: 0, fail: 0 });
    const item = map.get(key);
    item.total += 1;
    if (Number(row.Fail) > 0) item.fail += 1;
  });
  const overallFail = rows.filter(r => Number(r.Fail) > 0).length;
  const overallTotal = rows.length;
  return [...map.values()].map(item => {
    const othersTotal = overallTotal - item.total;
    const othersFail = overallFail - item.fail;
    const rate = item.total ? item.fail / item.total * 100 : 0;
    const othersRate = othersTotal ? othersFail / othersTotal * 100 : 0;
    const share = overallFail ? item.fail / overallFail * 100 : 0;
    return {
      ...item,
      rate,
      othersRate,
      delta: rate - othersRate,
      share
    };
  }).sort((a, b) => (b.fail - a.fail) || (b.rate - a.rate) || String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
}

function formatRate(value) {
  return `${Number(value || 0).toFixed(4)}%`;
}

function makeStatsTable(title, rows, limit = 8) {
  const shown = rows.slice(0, limit);
  const body = shown.map((r, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(r.key)}</td>
      <td>${Number(r.total).toLocaleString()}</td>
      <td>${Number(r.fail).toLocaleString()}</td>
      <td>${formatRate(r.rate)}</td>
      <td>${formatRate(r.share)}</td>
      <td>${formatRate(r.othersRate)}</td>
      <td class="${r.delta > 0 ? 'stat-hot' : ''}">${r.delta >= 0 ? '+' : ''}${formatRate(r.delta)}</td>
    </tr>
  `).join('') || '<tr><td colspan="8">No data</td></tr>';
  const top = rows.find(r => r.fail > 0);
  const insight = top
    ? `Top: ${escapeHtml(top.key)} / Fail ${top.fail.toLocaleString()} / Fail Rate ${formatRate(top.rate)} / Fail Share ${formatRate(top.share)}`
    : 'Fail data가 없습니다.';
  return `
    <article class="stat-card">
      <div class="stat-card-head"><strong>${escapeHtml(title)}</strong><span>${insight}</span></div>
      <div class="stat-table-wrap">
        <table class="stat-table">
          <thead><tr><th>#</th><th>Group</th><th>In Qty</th><th>Fail</th><th>Fail Rate</th><th>Fail Share</th><th>Others Rate</th><th>Delta</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </article>
  `;
}


function buildStatsGroups(rows, mapType = state.mapType) {
  if (mapType === 'strip') {
    const withParsed = rows.map(row => ({ row, parsed: parseStripId(row['STRIP ID']) }));
    return [
      { title: 'Batch 기준 Fail 집중도', rows: aggregateBy(withParsed.map(x => ({ ...x.row, __statKey: x.parsed.batch })), r => r.__statKey) },
      { title: 'Batch + Panel 기준 Fail 집중도', rows: aggregateBy(withParsed.map(x => ({ ...x.row, __statKey: `${x.parsed.batch} / Panel ${x.parsed.panel}` })), r => r.__statKey) },
      { title: 'Strip No 기준 Fail 집중도', rows: aggregateBy(withParsed.map(x => ({ ...x.row, __statKey: `Strip No ${x.parsed.stripNo}` })), r => r.__statKey) },
      { title: 'Batch + Panel + Strip No Commonality (Strip ID) 기준 Fail 집중도', rows: aggregateBy(withParsed.map(x => ({ ...x.row, __statKey: formatStripIdCommonality(x.parsed) })), r => r.__statKey) },
      { title: 'Strip 내 Y Row 기준 Fail 집중도', rows: aggregateBy(rows, r => `Strip Y Row ${r.Y}`) }
    ];
  }
  const withParsedWafer = rows.map(row => ({ row, parsed: parseWaferId(row['WAFER ID']) }));
  return [
    { title: 'Wafer ID 기준 Fail 집중도', rows: aggregateBy(rows, r => r['WAFER ID']) },
    { title: 'Wafer Run No 기준 Fail 집중도', rows: aggregateBy(withParsedWafer.map(x => ({ ...x.row, __statKey: x.parsed.runNo })), r => r.__statKey) },
    { title: 'Slice 기준 Fail 집중도', rows: aggregateBy(withParsedWafer.map(x => ({ ...x.row, __statKey: `Slice ${x.parsed.slice}` })), r => r.__statKey) }
  ];
}

function renderStats(filteredRows) {
  const panel = $('statsPanel');
  if (!panel) return;
  if (!state.rawRows.length) {
    panel.className = 'stats-panel empty';
    panel.textContent = 'Excel을 업로드하면 통계가 표시됩니다.';
    return;
  }
  const rows = filteredRows;
  const failQty = rows.filter(r => Number(r.Fail) > 0).length;
  const summary = summarizeRows(rows);
  panel.className = 'stats-panel';

  if (state.mapType === 'strip') {
    const withParsed = rows.map(row => ({ row, parsed: parseStripId(row['STRIP ID']) }));
    const byBatch = aggregateBy(withParsed.map(x => ({ ...x.row, __statKey: x.parsed.batch })), r => r.__statKey);
    const byPanel = aggregateBy(withParsed.map(x => ({ ...x.row, __statKey: `${x.parsed.batch} / Panel ${x.parsed.panel}` })), r => r.__statKey);
    const byStrip = aggregateBy(withParsed.map(x => ({ ...x.row, __statKey: `Strip No ${x.parsed.stripNo}` })), r => r.__statKey);
    const byStripId = aggregateBy(withParsed.map(x => ({ ...x.row, __statKey: formatStripIdCommonality(x.parsed) })), r => r.__statKey);
    const byRow = aggregateBy(rows, r => `Strip Y Row ${r.Y}`);
    const topStrip = byStrip.find(r => r.fail > 0);
    const topStripId = byStripId.find(r => r.fail > 0);
    const topRow = byRow.find(r => r.fail > 0);
    panel.innerHTML = `
      <div class="stat-summary-line">
        <strong>Strip 집중도 분석</strong>
        <span>Filtered In ${summary.inQty.toLocaleString()} / Fail ${failQty.toLocaleString()} / Fail Rate ${formatRate(summary.failRate)}</span>
        <span>${topStrip ? `가장 몰린 Strip No: ${escapeHtml(topStrip.key)} (${topStrip.fail.toLocaleString()} Fail)` : 'Fail 집중 Strip No 없음'}</span>
        <span>${topStripId ? `가장 몰린 Strip ID Commonality: ${escapeHtml(topStripId.key)} (${topStripId.fail.toLocaleString()} Fail)` : 'Fail 집중 Strip ID 없음'}</span>
        <span>${topRow ? `가장 몰린 Row: ${escapeHtml(topRow.key)} (${topRow.fail.toLocaleString()} Fail)` : 'Fail 집중 Row 없음'}</span>
      </div>
      ${makeStatsTable('Batch 기준 Fail 집중도', byBatch)}
      ${makeStatsTable('Batch + Panel 기준 Fail 집중도', byPanel)}
      ${makeStatsTable('Strip No 기준 Fail 집중도', byStrip)}
      ${makeStatsTable('Batch + Panel + Strip No Commonality (Strip ID) 기준 Fail 집중도', byStripId)}
      ${makeStatsTable('Strip 내 Y Row 기준 Fail 집중도', byRow)}
    `;
  } else {
    const withParsedWafer = rows.map(row => ({ row, parsed: parseWaferId(row['WAFER ID']) }));
    const byWafer = aggregateBy(rows, r => r['WAFER ID']);
    const byRunNo = aggregateBy(withParsedWafer.map(x => ({ ...x.row, __statKey: x.parsed.runNo })), r => r.__statKey);
    const bySlice = aggregateBy(withParsedWafer.map(x => ({ ...x.row, __statKey: `Slice ${x.parsed.slice}` })), r => r.__statKey);
    const topWafer = byWafer.find(r => r.fail > 0);
    const topRunNo = byRunNo.find(r => r.fail > 0);
    const topSlice = bySlice.find(r => r.fail > 0);
    panel.innerHTML = `
      <div class="stat-summary-line">
        <strong>Wafer 집중도 분석</strong>
        <span>Filtered In ${summary.inQty.toLocaleString()} / Fail ${failQty.toLocaleString()} / Fail Rate ${formatRate(summary.failRate)}</span>
        <span>${topWafer ? `가장 몰린 Wafer ID: ${escapeHtml(topWafer.key)} (${topWafer.fail.toLocaleString()} Fail)` : 'Fail 집중 Wafer 없음'}</span>
        <span>${topRunNo ? `가장 몰린 Run No: ${escapeHtml(topRunNo.key)} (${topRunNo.fail.toLocaleString()} Fail)` : 'Fail 집중 Run No 없음'}</span>
        <span>${topSlice ? `가장 몰린 Slice: ${escapeHtml(topSlice.key)} (${topSlice.fail.toLocaleString()} Fail)` : 'Fail 집중 Slice 없음'}</span>
      </div>
      ${makeStatsTable('Wafer ID 기준 Fail 집중도', byWafer, 12)}
      ${makeStatsTable('Wafer Run No 기준 Fail 집중도', byRunNo, 12)}
      ${makeStatsTable('Slice 기준 Fail 집중도', bySlice, 12)}
    `;
  }
}

function renderAll() {
  const filteredRows = getFilteredRows();
  renderSummary(filteredRows);
  renderMap(filteredRows);
  renderStats(filteredRows);
}

function showPage(pageId) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === pageId));
}

function updateActiveHistoryLabel() {
  const label = $('activeHistoryLabel');
  if (!label) return;
  if (!state.activeHistoryId) {
    label.textContent = '현재 화면 상태를 Firestore Result History에 저장합니다.';
    return;
  }
  const item = state.histories.find(h => h.id === state.activeHistoryId);
  label.textContent = item
    ? `History 불러옴: ${item.title} / ${item.createdAtText || '-'}`
    : '현재 화면 상태를 Firestore Result History에 저장합니다.';
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  document.querySelectorAll('[data-open-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.openPage));
  });
}

function getSelectedBins() {
  return [...$('binCheckboxes').querySelectorAll('input:checked')].map(i => i.value);
}

function currentSnapshot() {
  const filteredRows = getFilteredRows();
  const summary = summarizeRows(filteredRows);
  const { groupCol, xCol, yCol } = getMapColumns();
  const bounds = getGlobalBounds(state.rawRows, xCol, yCol);
  return {
    sourceFileName: state.sourceFileName,
    mapType: state.mapType,
    groupValue: state.groupValue,
    cellSize: state.cellSize,
    showOnlyFail: state.showOnlyFail,
    filters: JSON.parse(JSON.stringify(state.filters)),
    summary,
    mapInfo: {
      groupColumn: groupCol,
      xColumn: xCol,
      yColumn: yCol,
      bounds,
      rawRowCount: state.rawRows.length
    }
  };
}

function cleanFirestoreValue(value) {
  return JSON.parse(JSON.stringify(value));
}

async function saveHistoryToFirestore(item, rows) {
  const historyRef = doc(db, HISTORY_COLLECTION, item.id);
  const rowsCompact = rows.map(compactRow);
  const chunkCount = Math.ceil(rowsCompact.length / ROW_CHUNK_SIZE);

  await setDoc(historyRef, cleanFirestoreValue({
    title: item.title,
    ft: item.ft,
    bins: item.bins,
    comment: item.comment,
    snapshot: item.snapshot,
    createdAtText: item.createdAtText,
    createdAt: serverTimestamp(),
    rowCount: rowsCompact.length,
    rowChunkSize: ROW_CHUNK_SIZE,
    rowChunkCount: chunkCount
  }));

  let batch = writeBatch(db);
  let opCount = 0;
  for (let i = 0; i < chunkCount; i++) {
    const chunkRef = doc(collection(db, HISTORY_COLLECTION, item.id, ROW_CHUNK_COLLECTION), String(i).padStart(5, '0'));
    batch.set(chunkRef, cleanFirestoreValue({
      index: i,
      rows: rowsCompact.slice(i * ROW_CHUNK_SIZE, (i + 1) * ROW_CHUNK_SIZE)
    }));
    opCount++;
    if (opCount >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();
}

async function loadHistoriesFromFirestore() {
  try {
    const q = query(collection(db, HISTORY_COLLECTION), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    state.histories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistories();
  } catch (error) {
    console.error('Firestore history load failed:', error);
    $('requestList').className = 'request-list empty';
    $('requestList').textContent = firestoreErrorMessage(error);
  }
}

async function loadRowsForHistory(id) {
  const historyRef = doc(db, HISTORY_COLLECTION, id);
  const historySnap = await getDoc(historyRef);
  if (!historySnap.exists()) throw new Error('삭제되었거나 찾을 수 없는 History입니다.');

  const chunkSnap = await getDocs(query(collection(db, HISTORY_COLLECTION, id, ROW_CHUNK_COLLECTION), orderBy('index', 'asc')));
  const rows = [];
  chunkSnap.forEach(d => rows.push(...(d.data().rows || [])));
  return { item: { id: historySnap.id, ...historySnap.data() }, rows: normalizeRows(rows) };
}

async function deleteHistoryFromFirestore(id) {
  const chunkSnap = await getDocs(collection(db, HISTORY_COLLECTION, id, ROW_CHUNK_COLLECTION));
  let batch = writeBatch(db);
  let opCount = 0;
  for (const d of chunkSnap.docs) {
    batch.delete(d.ref);
    opCount++;
    if (opCount >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();
  await deleteDoc(doc(db, HISTORY_COLLECTION, id));
}

async function clearAllHistoriesFromFirestore() {
  const snap = await getDocs(collection(db, HISTORY_COLLECTION));
  for (const d of snap.docs) {
    await deleteHistoryFromFirestore(d.id);
  }
}

function setupRequestForm() {
  const binBox = $('binCheckboxes');
  for (let i = 2; i <= 20; i++) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="Bin${i}"> Bin${i}`;
    binBox.appendChild(label);
  }

  $('requestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isBusy) return;
    if (!state.rawRows.length) {
      alert('먼저 2DID Excel을 업로드하고 Mapping 결과를 만든 뒤 저장하세요.');
      return;
    }
    const item = {
      id: crypto.randomUUID(),
      createdAtText: new Date().toLocaleString('ko-KR'),
      title: $('reqTitle').value.trim(),
      ft: $('reqFt').value,
      bins: getSelectedBins(),
      comment: $('reqComment').value.trim(),
      snapshot: currentSnapshot()
    };

    try {
      setBusy(true, 'Saving to Firestore...');
      await saveHistoryToFirestore(item, state.rawRows);
      state.histories.unshift(item);
      renderHistories();
      await restoreHistoryToMapping(item.id, { useCurrentRows: true });
      alert('현재 Mapping 결과가 Firestore Result History에 저장됐습니다.');
    } catch (error) {
      console.error('Firestore save failed:', error);
      alert(firestoreErrorMessage(error));
    } finally {
      setBusy(false);
    }
  });
}

function renderHistories() {
  const list = $('requestList');
  if (!state.histories.length) {
    list.className = 'request-list empty';
    list.textContent = '저장된 결과가 없습니다.';
    return;
  }
  list.className = 'request-list';
  list.innerHTML = '';
  state.histories.forEach(item => {
    const s = item.snapshot?.summary || { inQty: 0, failQty: 0, failRate: 0 };
    const div = document.createElement('div');
    div.className = 'request-item';
    div.innerHTML = `
      <div class="request-item-head">
        <button class="link-title" data-open="${item.id}">${escapeHtml(item.title)}</button>
        <button class="danger-ghost-btn" data-delete="${item.id}">Delete</button>
      </div>
      <div class="badges">
        <span class="badge">${escapeHtml(item.ft)}</span>
        <span class="badge">${escapeHtml(item.snapshot?.mapType || '-')} / ${escapeHtml(item.snapshot?.groupValue || '-')}</span>
        <span class="badge">${escapeHtml((item.bins || []).join(', ') || 'No bin')}</span>
      </div>
      <div class="request-meta">
        In Qty: ${Number(s.inQty).toLocaleString()} / Fail Qty: ${Number(s.failQty).toLocaleString()} / Fail Rate: ${Number(s.failRate).toFixed(4)}%<br>
        File: ${escapeHtml(item.snapshot?.sourceFileName || '-')} / Created: ${escapeHtml(item.createdAtText || '-')}<br>
        ${item.comment ? `Comment: ${escapeHtml(item.comment)}` : ''}
      </div>
    `;
    div.querySelector('[data-open]').addEventListener('click', () => restoreHistoryToMapping(item.id));
    div.querySelector('[data-delete]').addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!confirm('이 Result History를 삭제할까요?')) return;
      try {
        setBusy(true, 'Deleting...');
        await deleteHistoryFromFirestore(item.id);
        state.histories = state.histories.filter(r => r.id !== item.id);
        if (state.activeHistoryId === item.id) state.activeHistoryId = null;
        renderHistories();
        updateActiveHistoryLabel();
      } catch (error) {
        console.error('Firestore delete failed:', error);
        alert(firestoreErrorMessage(error));
      } finally {
        setBusy(false);
      }
    });
    list.appendChild(div);
  });
}

async function restoreHistoryToMapping(id, options = {}) {
  try {
    setBusy(true, 'Loading...');
    let item = state.histories.find(h => h.id === id);
    let rows = options.useCurrentRows ? state.rawRows : null;

    if (!rows || !rows.length) {
      const loaded = await loadRowsForHistory(id);
      item = loaded.item;
      rows = loaded.rows;
      const idx = state.histories.findIndex(h => h.id === id);
      if (idx >= 0) state.histories[idx] = item;
    }

    if (!item || !item.snapshot) return;
    const snap = item.snapshot;
    state.rawRows = normalizeRows(rows);
    state.sourceFileName = snap.sourceFileName || state.sourceFileName || '';
    state.mapType = snap.mapType || 'strip';
    state.groupValue = snap.groupValue || 'MERGE';
    state.cellSize = snap.cellSize || 14;
    state.showOnlyFail = !!snap.showOnlyFail;
    state.filters = JSON.parse(JSON.stringify(snap.filters || {}));
    state.activeHistoryId = item.id;

    $('mapType').value = state.mapType;
    $('cellSize').value = state.cellSize;
    $('showOnlyFail').checked = state.showOnlyFail;
    $('reqTitle').value = item.title || '';
    $('reqFt').value = item.ft || 'FT1';
    $('reqComment').value = item.comment || '';
    $('binCheckboxes').querySelectorAll('input').forEach(input => {
      input.checked = (item.bins || []).includes(input.value);
    });

    renderFilters();
    renderGroupOptions();
    $('groupSelect').value = [...$('groupSelect').options].some(o => o.value === state.groupValue) ? state.groupValue : 'MERGE';
    state.groupValue = $('groupSelect').value;
    renderAll();
    updateActiveHistoryLabel();
    showPage('mappingPage');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    console.error('Firestore history restore failed:', error);
    alert(firestoreErrorMessage(error));
  } finally {
    setBusy(false);
  }
}


function toAoaRow(row, columns) {
  return columns.map(col => row[col] ?? '');
}

function safeSheetName(name, fallback = 'Sheet') {
  const clean = String(name || fallback)
    .replace(/[\\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return clean || fallback;
}

function uniqueSheetName(base, used) {
  let name = safeSheetName(base);
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const candidate = safeSheetName(`${name.slice(0, 31 - suffix.length)}${suffix}`);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return safeSheetName(`${base}_${Date.now()}`);
}

function styleCell(ws, ref, stylePatch = {}) {
  if (!ws[ref]) ws[ref] = { t: 's', v: '' };
  ws[ref].s = { ...(ws[ref].s || {}), ...stylePatch };
}

function applySheetStyle(ws, range, options = {}) {
  if (!range) return;
  const border = { style: 'thin', color: { rgb: 'D9E2F3' } };
  const defaultCell = {
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: border, bottom: border, left: border, right: border }
  };
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) continue;
      ws[ref].s = { ...defaultCell, ...(ws[ref].s || {}) };
    }
  }
  if (options.headerRows) {
    for (let r = 0; r < options.headerRows; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!ws[ref]) continue;
        ws[ref].s = {
          ...(ws[ref].s || {}),
          fill: { fgColor: { rgb: 'E8EEF9' } },
          font: { bold: true, color: { rgb: '102033' } }
        };
      }
    }
  }
}

function getDisplayedMapConfigs() {
  const { groupCol } = getMapColumns();
  if (!state.rawRows.length) return [];
  if (state.groupValue === 'MERGE') {
    return [{ rows: state.rawRows, titleGroup: 'MERGE', isMerge: true }];
  }
  const groups = state.groupValue === 'ALL' ? uniqueValues(groupCol, state.rawRows) : [state.groupValue];
  return groups.map(group => ({
    rows: state.rawRows.filter(r => String(r[groupCol]) === String(group)),
    titleGroup: group,
    isMerge: false
  })).filter(config => config.rows.length);
}

function buildMapWorksheet(config, filteredSet, options = {}) {
  const { xCol, yCol, label } = getMapColumns();
  const customDisplay = Boolean(options.customDisplay);
  const bounds = getGlobalBounds(state.rawRows, xCol, yCol);
  if (!bounds) return XLSX.utils.aoa_to_sheet([['No map data']]);
  const xValues = [];
  const yValues = [];
  for (let x = bounds.minX; x <= bounds.maxX; x++) xValues.push(x);
  for (let y = bounds.minY; y <= bounds.maxY; y++) yValues.push(y);

  const cellMap = buildCellMap(config.rows, xCol, yCol);
  const aoa = [];
  aoa.push([`${label} Y\\X`, ...xValues]);
  yValues.forEach(y => {
    const row = [y];
    xValues.forEach(x => {
      const rows = cellMap.get(`${x}|${y}`) || [];
      if (!rows.length) {
        row.push('');
        return;
      }
      const failCount = rows.filter(unit => Number(unit.Fail) > 0).length;
      if (customDisplay) {
        // Custom MERGE sheet: normal/Input Qty text is removed, fail cells keep Fail Qty only.
        row.push(failCount > 0 ? failCount : '');
      } else {
        // Standard MERGE sheet: normal die = duplicated unit count, fail die = fail unit count / duplicated unit count.
        row.push(failCount > 0 ? `${failCount}/${rows.length}` : rows.length);
      }
    });
    aoa.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws['!ref']);
  ws['!cols'] = [{ wch: 8 }, ...xValues.map(() => ({ wch: 6 }))];
  ws['!rows'] = aoa.map((_, idx) => ({ hpt: idx === 0 ? 20 : 16 }));
  ws['!freeze'] = { xSplit: 1, ySplit: 1 };

  const border = { style: 'thin', color: { rgb: 'D7E2F4' } };
  const headerStyle = {
    fill: { fgColor: { rgb: 'DDE8FA' } },
    font: { bold: true, color: { rgb: '102033' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: border, bottom: border, left: border, right: border }
  };
  const normalStyle = {
    fill: { fgColor: { rgb: 'DCEBFF' } },
    font: { color: { rgb: '102033' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: border, bottom: border, left: border, right: border }
  };
  const failStyle = {
    fill: { fgColor: { rgb: 'FF4D4F' } },
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: border, bottom: border, left: border, right: border }
  };
  const selectedFailStyle = {
    fill: { fgColor: { rgb: 'F59E0B' } },
    font: { bold: true, color: { rgb: '111827' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: border, bottom: border, left: border, right: border }
  };
  const dimStyle = {
    fill: { fgColor: { rgb: 'F3F4F6' } },
    font: { color: { rgb: '9CA3AF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: border, bottom: border, left: border, right: border }
  };
  const blankStyle = {
    fill: { fgColor: { rgb: 'FFFFFF' } },
    border: { top: border, bottom: border, left: border, right: border }
  };

  for (let c = range.s.c; c <= range.e.c; c++) styleCell(ws, XLSX.utils.encode_cell({ r: 0, c }), headerStyle);
  for (let r = 0; r <= range.e.r; r++) styleCell(ws, XLSX.utils.encode_cell({ r, c: 0 }), headerStyle);

  yValues.forEach((y, yIdx) => {
    xValues.forEach((x, xIdx) => {
      const ref = XLSX.utils.encode_cell({ r: yIdx + 1, c: xIdx + 1 });
      const rows = cellMap.get(`${x}|${y}`) || [];
      if (!rows.length) {
        if (!ws[ref]) ws[ref] = { t: 's', v: '' };
        ws[ref].s = blankStyle;
        return;
      }
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      const isFail = rows.some(row => Number(row.Fail) > 0);
      const isFiltered = rows.some(row => filteredSet.has(row.__idx));
      const activeFilters = hasActiveFilters();
      ws[ref].s = (isFail && isFiltered && activeFilters)
        ? selectedFailStyle
        : (isFail ? failStyle : (isFiltered ? normalStyle : dimStyle));
      if (rows.length > 1) {
        ws[ref].s.font = { ...(ws[ref].s.font || {}), bold: true };
      }
    });
  });

  ws['!merges'] = [];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  return ws;
}

function makeSummaryWorksheet() {
  const filteredRows = getFilteredRows();
  const summary = summarizeRows(filteredRows);
  const selectedBins = getSelectedBins();
  const snapshot = currentSnapshot();
  const filtersText = Object.entries(state.filters)
    .filter(([, values]) => values && values.length)
    .map(([key, values]) => `${key}: ${values.join(', ')}`)
    .join(' / ') || 'No filter';
  const info = [
    ['2DID Mapping Report', ''],
    ['Title', $('reqTitle').value.trim() || '-'],
    ['FT Step', $('reqFt').value || '-'],
    ['Fail Bin', selectedBins.join(', ') || '-'],
    ['Comment', $('reqComment').value.trim() || '-'],
    ['Source File', state.sourceFileName || '-'],
    ['Map Type', state.mapType],
    ['Group', state.groupValue],
    ['Generated At', new Date().toLocaleString('ko-KR')],
    ['Total 2DID', summary.total],
    ['Filtered In Qty', summary.inQty],
    ['Fail Qty', summary.failQty],
    ['Fail Rate', `${summary.failRate.toFixed(4)}%`],
    ['X Column', snapshot.mapInfo.xColumn],
    ['Y Column', snapshot.mapInfo.yColumn],
    ['Bounds', snapshot.mapInfo.bounds ? `X ${snapshot.mapInfo.bounds.minX}~${snapshot.mapInfo.bounds.maxX}, Y ${snapshot.mapInfo.bounds.minY}~${snapshot.mapInfo.bounds.maxY}` : '-'],
    ['Filters', filtersText],
    ['', ''],
    ['Rule', 'Map starts at B2. X axis is row 1 from B column. Y axis is column A from row 2. Existing 2DID unit = 1. Merged coordinate = merged unit count. Blank = no unit. Red cell = Fail exists. Orange cell = selected/filtered Fail unit.']
  ];
  const ws = XLSX.utils.aoa_to_sheet(info);
  ws['!cols'] = [{ wch: 18 }, { wch: 90 }];
  const range = XLSX.utils.decode_range(ws['!ref']);
  applySheetStyle(ws, range, { headerRows: 1 });
  styleCell(ws, 'A1', { fill: { fgColor: { rgb: '102033' } }, font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14 } });
  styleCell(ws, 'B1', { fill: { fgColor: { rgb: '102033' } } });
  return ws;
}

function makeDataWorksheet(rows, name, filteredSet = null) {
  const cols = filteredSet ? [...REQUIRED_COLUMNS, 'Included In Current Filter'] : REQUIRED_COLUMNS;
  const aoa = [cols];
  rows.forEach(row => {
    const base = toAoaRow(row, REQUIRED_COLUMNS);
    if (filteredSet) base.push(filteredSet.has(row.__idx) ? 'Y' : 'N');
    aoa.push(base);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map(col => ({ wch: Math.max(10, Math.min(22, String(col).length + 4)) }));
  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    applySheetStyle(ws, range, { headerRows: 1 });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  }
  return ws;
}


function makeStatisticsWorksheet(rows) {
  const summary = summarizeRows(rows);
  const groups = buildStatsGroups(rows, state.mapType);
  const aoa = [
    ['2DID Fail Concentration Statistics'],
    ['Map Type', state.mapType],
    ['Filtered In Qty', summary.inQty],
    ['Fail Qty', summary.failQty],
    ['Fail Rate', `${summary.failRate.toFixed(4)}%`],
    []
  ];

  groups.forEach(section => {
    aoa.push([section.title]);
    aoa.push(['#', 'Group', 'In Qty', 'Fail Qty', 'Fail Rate', 'Fail Share', 'Others Rate', 'Delta vs Others']);
    section.rows.forEach((r, idx) => {
      aoa.push([
        idx + 1,
        r.key,
        r.total,
        r.fail,
        `${Number(r.rate || 0).toFixed(4)}%`,
        `${Number(r.share || 0).toFixed(4)}%`,
        `${Number(r.othersRate || 0).toFixed(4)}%`,
        `${r.delta >= 0 ? '+' : ''}${Number(r.delta || 0).toFixed(4)}%`
      ]);
    });
    if (!section.rows.length) aoa.push(['-', 'No data', '', '', '', '', '', '']);
    aoa.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 8 }, { wch: 34 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }
  ];
  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    applySheetStyle(ws, range);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const aRef = XLSX.utils.encode_cell({ r, c: 0 });
      const aCell = ws[aRef];
      if (!aCell) continue;
      if (String(aCell.v || '').includes('Statistics') || String(aCell.v || '').includes('집중도')) {
        for (let c = 0; c <= 7; c++) {
          styleCell(ws, XLSX.utils.encode_cell({ r, c }), {
            fill: { fgColor: { rgb: String(aCell.v || '').includes('Statistics') ? '102033' : 'E8EEF9' } },
            font: { bold: true, color: { rgb: String(aCell.v || '').includes('Statistics') ? 'FFFFFF' : '102033' } }
          });
        }
      }
      if (aCell.v === '#') {
        for (let c = 0; c <= 7; c++) {
          styleCell(ws, XLSX.utils.encode_cell({ r, c }), {
            fill: { fgColor: { rgb: 'F8FAFF' } },
            font: { bold: true, color: { rgb: '102033' } }
          });
        }
      }
    }
  }
  return ws;
}


function ensureXlsxReady() {
  if (window.XLSX && window.XLSX.utils && typeof window.XLSX.write === 'function') return true;
  alert('Excel Library가 아직 로드되지 않았습니다. 페이지를 새로고침한 뒤 다시 시도하세요. GitHub Pages에서 CDN이 막히면 index.html의 xlsx-js-style CDN 경로를 확인해야 합니다.');
  return false;
}


function sanitizeFilePart(value, fallback = 'NA') {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function buildExcelReportFileName() {
  const filteredRows = getFilteredRows();
  const lotValues = uniqueValues('LOT ID', filteredRows);
  let lotPart = 'LOT';
  if (lotValues.length === 1) {
    lotPart = lotValues[0];
  } else if ((state.filters['LOT ID'] || []).length === 1) {
    lotPart = state.filters['LOT ID'][0];
  } else if (lotValues.length > 1) {
    const representativeLots = lotValues.slice(0, 2).map(lot => sanitizeFilePart(lot, 'LOT'));
    const moreCount = lotValues.length - representativeLots.length;
    lotPart = representativeLots.join('_');
    if (moreCount > 0) lotPart += `_and_${moreCount}more`;
  }

  const { label } = getMapColumns(); // Wafer or Strip
  let mappingType = state.groupValue;
  if (mappingType === 'MERGE') mappingType = 'MERGE';
  if (mappingType === 'ALL') mappingType = 'ALL_IDs';

  return [
    sanitizeFilePart(lotPart, 'LOT'),
    sanitizeFilePart(label, 'Map'),
    sanitizeFilePart(mappingType, 'Mapping'),
    todayYmd()
  ].join('_') + '.xlsx';
}

function downloadExcelWorkbook(wb, fileName) {
  const XLSX_LIB = window.XLSX;
  try {
    const wbout = XLSX_LIB.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('Excel export failed:', error);
    // 일부 브라우저에서는 Blob 방식이 막힐 수 있어 SheetJS writeFile로 한 번 더 시도합니다.
    if (typeof XLSX_LIB.writeFile === 'function') {
      XLSX_LIB.writeFile(wb, fileName, { bookType: 'xlsx', cellStyles: true });
      return;
    }
    throw error;
  }
}

function exportExcelReport() {
  try {
    if (!ensureXlsxReady()) return;
    if (!state.rawRows.length) {
      alert('먼저 2DID Excel을 업로드하거나 Result History를 불러온 뒤 Export 하세요.');
      return;
    }

    const XLSX_LIB = window.XLSX;
    const wb = XLSX_LIB.utils.book_new();
    const used = new Set();
    const filteredRows = getFilteredRows();
    const filteredSet = new Set(filteredRows.map(r => r.__idx));
    const mapConfigs = getDisplayedMapConfigs();

    XLSX_LIB.utils.book_append_sheet(wb, makeSummaryWorksheet(), uniqueSheetName('2DID Information', used));
    XLSX_LIB.utils.book_append_sheet(wb, makeStatisticsWorksheet(filteredRows), uniqueSheetName('Statistics', used));
    mapConfigs.forEach((config, idx) => {
      const { label } = getMapColumns();
      const suffix = mapConfigs.length > 1 ? `${idx + 1}_${config.titleGroup}` : config.titleGroup;
      const sheetName = uniqueSheetName(`${label}_${suffix}`, used);
      XLSX_LIB.utils.book_append_sheet(wb, buildMapWorksheet(config, filteredSet), sheetName);
      if (config.isMerge && String(config.titleGroup).toUpperCase() === 'MERGE') {
        const customSheetName = uniqueSheetName(`${label}_${suffix}_CUST`, used);
        XLSX_LIB.utils.book_append_sheet(wb, buildMapWorksheet(config, filteredSet, { customDisplay: true }), customSheetName);
      }
    });
    XLSX_LIB.utils.book_append_sheet(wb, makeDataWorksheet(state.rawRows, 'Raw 2DID', filteredSet), uniqueSheetName('2DID Information Detail', used));
    XLSX_LIB.utils.book_append_sheet(wb, makeDataWorksheet(state.rawRows, 'Raw 2DID'), uniqueSheetName('Raw Uploaded 2DID', used));

    const fileName = buildExcelReportFileName();
    downloadExcelWorkbook(wb, fileName);
  } catch (error) {
    console.error('Export Excel Report error:', error);
    alert(`Excel Export 중 오류가 발생했습니다.

${error?.message || error}`);
  }
}

function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) readFile(file);
});
$('resetFilters').addEventListener('click', () => {
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  state.filters = {};
  state.filterSearches = {};
  renderFilters();
  renderGroupOptions();
  renderAll();
});
$('mapType').addEventListener('change', (e) => {
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  state.mapType = e.target.value;
  state.groupValue = 'MERGE';
  renderGroupOptions();
  renderAll();
});
$('groupSelect').addEventListener('change', (e) => {
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  state.groupValue = e.target.value;
  renderAll();
});
$('cellSize').addEventListener('input', (e) => {
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  state.cellSize = Number(e.target.value);
  scheduleRenderAll(40);
});
$('exportExcelReport').addEventListener('click', exportExcelReport);
$('showOnlyFail').addEventListener('change', (e) => {
  state.activeHistoryId = null;
  updateActiveHistoryLabel();
  state.showOnlyFail = e.target.checked;
  renderAll();
});
$('clearRequests').addEventListener('click', async () => {
  if (!confirm('Firestore에 저장된 Result History를 모두 삭제할까요?')) return;
  try {
    setBusy(true, 'Deleting...');
    await clearAllHistoriesFromFirestore();
    state.histories = [];
    renderHistories();
    state.activeHistoryId = null;
    updateActiveHistoryLabel();
  } catch (error) {
    console.error('Firestore clear failed:', error);
    alert(firestoreErrorMessage(error));
  } finally {
    setBusy(false);
  }
});
$('exportRequests').addEventListener('click', () => {
  download('2did_mapping_histories_firestore_summary.json', JSON.stringify(state.histories, null, 2));
});

setupNavigation();
setupRequestForm();
renderHistories();
updateActiveHistoryLabel();
loadHistoriesFromFirestore();
