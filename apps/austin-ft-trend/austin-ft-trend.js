import { austinFtFirebaseConfig } from "../../shared/firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const firebaseConfig = austinFtFirebaseConfig;
const COLLECTION_NAME = "austinFtTrendRaw";
const PREFERRED_SHEET_NAME = "MERGE REPORT";
const BATCH_LIMIT = 450;
const TABLE_LIMIT = 1000;

const FIELD_ALIASES = {
  osat: ["OSAT"],
  dateKey: ["时间", "日期", "DATE", "TIME", "TEST DATE", "REPORT DATE"],
  materialCode: ["物料编码", "MATERIAL CODE", "MATERIAL", "DEVICE", "PART NUMBER"],
  workOrder: ["工单号", "WORK ORDER", "WO", "WO NO", "WORK ORDER NO"],
  originalLot: ["原批号", "ORIGINAL LOT", "ORIGINAL LOT NO", "LOT ID", "LOT_ID", "LOT"],
  originalMarking: ["原MARKING", "ORIGINAL MARKING"],
  mergedMarking: ["合批MARKING", "MERGE MARKING", "MERGED MARKING"],
  testProgram: ["测试程序", "TEST PROGRAM", "PROGRAM", "TEST_PROGRAM"],
  bin: ["BIN", "BIN NO", "BIN_NO"],
  qty: ["数量", "QTY", "QUANTITY", "BIN QTY", "BIN_QTY"]
};

const REQUIRED_FIELDS = ["dateKey", "originalLot", "bin", "qty"];

let app = null;
let db = null;
let auth = null;
let currentUser = null;
let selectedFiles = [];
let selectedRows = [];
let firestoreData = [];
let pendingData = [];
let chart = null;
let filterDefaultsInitialized = false;
let isBusy = false;

const el = {
  firebaseStatus: document.getElementById("firebaseStatus"),
  authStatus: document.getElementById("authStatus"),
  dropZone: document.getElementById("dropZone"),
  excelFiles: document.getElementById("excelFiles"),
  selectedFileList: document.getElementById("selectedFileList"),
  allRows: document.getElementById("allRows"),
  filteredRows: document.getElementById("filteredRows"),
  dateCount: document.getElementById("dateCount"),
  lotCount: document.getElementById("lotCount"),
  binCount: document.getElementById("binCount"),
  qtyTotal: document.getElementById("qtyTotal"),
  selectedRows: document.getElementById("selectedRows"),
  insertedRows: document.getElementById("insertedRows"),
  skippedRows: document.getElementById("skippedRows"),
  firestoreRows: document.getElementById("firestoreRows"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  lotFilter: document.getElementById("lotFilter"),
  binFilter: document.getElementById("binFilter"),
  materialFilter: document.getElementById("materialFilter"),
  programFilter: document.getElementById("programFilter"),
  resetFilterBtn: document.getElementById("resetFilterBtn"),
  exportBtn: document.getElementById("exportBtn"),
  chartEmpty: document.getElementById("chartEmpty"),
  chartScroller: document.getElementById("chartScroller"),
  chartCanvasWrap: document.getElementById("chartCanvasWrap"),
  ftTrendChart: document.getElementById("ftTrendChart"),
  chartPointSummary: document.getElementById("chartPointSummary"),
  detailBody: document.getElementById("detailBody"),
  tableNotice: document.getElementById("tableNotice"),
  uploadedFilesBody: document.getElementById("uploadedFilesBody"),
  log: document.getElementById("log")
};

function log(message) {
  const time = new Date().toLocaleTimeString();
  el.log.textContent = `[${time}] ${message}\n` + el.log.textContent;
}

function setFirebaseStatus(text, type = "warning") {
  el.firebaseStatus.textContent = text;
  el.firebaseStatus.classList.remove("warning", "success", "danger", "neutral");
  el.firebaseStatus.classList.add(type);
}

function setBusy(value) {
  isBusy = Boolean(value);
  el.exportBtn.disabled = isBusy || getCurrentRows().length === 0;
  el.excelFiles.disabled = isBusy;
  el.dropZone.setAttribute("aria-busy", String(isBusy));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[＿_]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = normalizeText(value).replace(/,/g, "").replace(/%$/, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function makeDateKey(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return "";
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return makeDateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return makeDateKey(parsed.y, parsed.m, parsed.d);
  }

  const text = normalizeText(value);
  if (!text) return "";

  let match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/);
  if (match) return makeDateKey(match[1], match[2], match[3]);

  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return makeDateKey(match[1], match[2], match[3]);

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return makeDateKey(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return "";
}

function normalizeBin(value) {
  const text = normalizeText(value).replace(/^BIN\s*/i, "");
  if (!text) return "";
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return String(numeric);
  return text.toUpperCase();
}

function compareBins(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return String(a).localeCompare(String(b));
}

function safeDocId(value) {
  return normalizeText(value).replace(/[^0-9A-Za-z_-]/g, "_").slice(0, 140);
}

function hashString(value, seed = 2166136261) {
  let hash = seed >>> 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeDedupeKey(row) {
  const rawKey = [
    row.dateKey,
    row.osat,
    row.materialCode,
    row.workOrder,
    row.originalLot,
    row.originalMarking,
    row.mergedMarking,
    row.testProgram,
    row.bin,
    row.qty
  ].join("|");
  return safeDocId(`austin_${hashString(rawKey)}_${hashString(rawKey, 2246822519)}`);
}

function uniqueSorted(values, comparator) {
  const result = Array.from(new Set(values.map(normalizeText).filter(Boolean)));
  return result.sort(comparator || ((a, b) => a.localeCompare(b)));
}

function joinUnique(values) {
  return uniqueSorted(values).join(", ");
}

function getCurrentRows() {
  const map = new Map();
  for (const row of [...firestoreData, ...pendingData]) {
    const key = row.dedupeKey || row.id || makeDedupeKey(row);
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values()).sort(compareRows);
}

function compareRows(a, b) {
  const dateCompare = String(a.dateKey || "").localeCompare(String(b.dateKey || ""));
  if (dateCompare !== 0) return dateCompare;
  const lotCompare = String(a.originalLot || "").localeCompare(String(b.originalLot || ""));
  if (lotCompare !== 0) return lotCompare;
  const binCompare = compareBins(a.bin, b.bin);
  if (binCompare !== 0) return binCompare;
  return String(a.workOrder || "").localeCompare(String(b.workOrder || ""));
}

function buildAliasLookup() {
  const lookup = new Map();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) lookup.set(normalizeHeader(alias), field);
  }
  return lookup;
}

const aliasLookup = buildAliasLookup();

function findHeaderMap(matrix) {
  const maxRows = Math.min(matrix.length, 30);
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const fieldMap = {};
    row.forEach((cell, colIndex) => {
      const field = aliasLookup.get(normalizeHeader(cell));
      if (field && fieldMap[field] === undefined) fieldMap[field] = colIndex;
    });
    if (REQUIRED_FIELDS.every(field => fieldMap[field] !== undefined)) {
      return { rowIndex, fieldMap };
    }
  }
  return null;
}

function getCell(row, fieldMap, field) {
  const index = fieldMap[field];
  return index === undefined ? null : row[index];
}

function convertMatrixRow(matrixRow, fieldMap, fileName, sheetName, sourceRowNumber) {
  const row = {
    osat: normalizeText(getCell(matrixRow, fieldMap, "osat")),
    dateKey: normalizeDate(getCell(matrixRow, fieldMap, "dateKey")),
    materialCode: normalizeText(getCell(matrixRow, fieldMap, "materialCode")),
    workOrder: normalizeText(getCell(matrixRow, fieldMap, "workOrder")),
    originalLot: normalizeText(getCell(matrixRow, fieldMap, "originalLot")),
    originalMarking: normalizeText(getCell(matrixRow, fieldMap, "originalMarking")),
    mergedMarking: normalizeText(getCell(matrixRow, fieldMap, "mergedMarking")),
    testProgram: normalizeText(getCell(matrixRow, fieldMap, "testProgram")),
    bin: normalizeBin(getCell(matrixRow, fieldMap, "bin")),
    qty: normalizeNumber(getCell(matrixRow, fieldMap, "qty")),
    sourceFileName: fileName,
    sourceSheetName: sheetName,
    sourceRowNumber
  };
  row.dedupeKey = makeDedupeKey(row);
  return row;
}

function isValidRow(row) {
  return Boolean(row.dateKey && row.originalLot && row.bin && row.qty !== null && row.qty >= 0 && row.dedupeKey);
}

function findReportRows(workbook, fileName) {
  const sheetNames = workbook.SheetNames || [];
  const candidates = [
    PREFERRED_SHEET_NAME,
    ...sheetNames.filter(name => name !== PREFERRED_SHEET_NAME)
  ].filter((name, index, array) => name && array.indexOf(name) === index && sheetNames.includes(name));

  for (const sheetName of candidates) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false
    });
    const header = findHeaderMap(matrix);
    if (!header) continue;

    const rows = matrix
      .slice(header.rowIndex + 1)
      .map((matrixRow, offset) => convertMatrixRow(
        matrixRow,
        header.fieldMap,
        fileName,
        sheetName,
        header.rowIndex + offset + 2
      ))
      .filter(isValidRow);

    if (rows.length) return { sheetName, rows, headerRow: header.rowIndex + 1 };
  }

  return { sheetName: "", rows: [], headerRow: null };
}

async function readReportFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const result = findReportRows(workbook, file.name);
  if (!result.rows.length) {
    throw new Error(`${file.name}: 时间 / 原批号 / BIN / 数量 Header를 가진 Sheet를 찾지 못했습니다.`);
  }
  return result;
}

function renderSelectedFiles() {
  if (!selectedFiles.length) {
    el.selectedFileList.innerHTML = '<li class="empty-li">선택된 파일이 없습니다.</li>';
    return;
  }
  el.selectedFileList.innerHTML = selectedFiles.map(file => `
    <li>
      <span>${escapeHtml(file.name)}</span>
      <small>${formatBytes(file.size)}</small>
    </li>
  `).join("");
}

function mergePendingRows(rows) {
  const existingKeys = new Set(getCurrentRows().map(row => row.dedupeKey || row.id));
  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    if (existingKeys.has(row.dedupeKey)) {
      skipped += 1;
      continue;
    }
    existingKeys.add(row.dedupeKey);
    pendingData.push(row);
    added += 1;
  }
  return { added, skipped };
}

async function handleFiles(files) {
  const excelFiles = Array.from(files || []).filter(file => /\.(xlsx|xls)$/i.test(file.name));
  if (!excelFiles.length) {
    log("Excel 파일(.xlsx/.xls)이 없습니다.");
    return;
  }

  selectedFiles = excelFiles;
  selectedRows = [];
  renderSelectedFiles();
  setBusy(true);

  try {
    for (const file of selectedFiles) {
      const parsed = await readReportFile(file);
      selectedRows.push(...parsed.rows);
      log(`${file.name}: ${parsed.sheetName} Sheet, Header Row ${parsed.headerRow}, ${parsed.rows.length.toLocaleString()} Row Read`);
    }

    const localResult = mergePendingRows(selectedRows);
    el.selectedRows.textContent = selectedRows.length.toLocaleString();
    el.skippedRows.textContent = localResult.skipped.toLocaleString();
    log(`Local Trend 반영: Add ${localResult.added.toLocaleString()}, Duplicate Skip ${localResult.skipped.toLocaleString()}`);

    filterDefaultsInitialized = false;
    renderAll();

    if (db && currentUser) {
      await uploadSelectedToFirebase();
    } else {
      log("Firebase/Auth 준비 전이거나 연결 실패 상태입니다. Chart는 현재 Browser Session Data로 표시됩니다.");
    }
  } catch (error) {
    log(`Excel Read Error: ${error.message}`);
    alert(error.message);
  } finally {
    el.excelFiles.value = "";
    setBusy(false);
  }
}

async function initFirebase() {
  try {
    setBusy(true);
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    await new Promise((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(auth, user => {
        if (user) {
          currentUser = user;
          unsubscribe();
          resolve(user);
        }
      }, reject);

      signInAnonymously(auth).catch(error => {
        unsubscribe();
        reject(error);
      });
    });

    setFirebaseStatus("Firebase connected", "success");
    el.authStatus.textContent = `Anonymous Auth OK · ${currentUser.uid.slice(0, 8)}...`;
    log("Firebase 연결 및 Anonymous Auth 완료");
    await loadFirestoreData();

    if (selectedRows.length) await uploadSelectedToFirebase();
  } catch (error) {
    setFirebaseStatus("Local preview mode", "danger");
    el.authStatus.textContent = "Firebase/Auth 실패 · Local Chart 가능";
    log(`Firebase/Auth Error: ${error.message}`);
    log("Firebase Console의 Anonymous Auth 및 austinFtTrendRaw Firestore Rule을 확인해주세요.");
    renderAll();
  } finally {
    setBusy(false);
  }
}

async function loadFirestoreData() {
  if (!db || !currentUser) return;

  try {
    const snap = await getDocs(collection(db, COLLECTION_NAME));
    firestoreData = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })).sort(compareRows);
    el.firestoreRows.textContent = firestoreData.length.toLocaleString();
    log(`Austin FT Firestore Load 완료: ${firestoreData.length.toLocaleString()} Row`);
    filterDefaultsInitialized = false;
    renderAll();
  } catch (error) {
    firestoreData = [];
    el.firestoreRows.textContent = "0";
    setFirebaseStatus("Rule publish required", "danger");
    log(`Austin FT Firestore Load Error: ${error.message}`);
    log(`firestore.rules의 '${COLLECTION_NAME}' Rule을 Firebase Console에 Publish 해주세요.`);
    renderAll();
  }
}

async function uploadSelectedToFirebase() {
  if (!db || !currentUser || !selectedRows.length) return;

  setBusy(true);
  try {
    const existingKeys = new Set(firestoreData.map(row => row.dedupeKey || row.id));
    const uploadRows = [];
    let skipped = 0;

    for (const row of selectedRows) {
      if (existingKeys.has(row.dedupeKey)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(row.dedupeKey);
      uploadRows.push(row);
    }

    let inserted = 0;
    for (let index = 0; index < uploadRows.length; index += BATCH_LIMIT) {
      const chunk = uploadRows.slice(index, index + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const row of chunk) {
        const ref = doc(db, COLLECTION_NAME, row.dedupeKey);
        batch.set(ref, {
          ...row,
          uploadedAt: serverTimestamp(),
          uploadedAtClient: new Date().toISOString()
        });
      }
      await batch.commit();
      inserted += chunk.length;
    }

    el.insertedRows.textContent = inserted.toLocaleString();
    el.skippedRows.textContent = skipped.toLocaleString();
    log(`Firebase Upload 완료: Insert ${inserted.toLocaleString()}, Duplicate Skip ${skipped.toLocaleString()}`);
    await loadFirestoreData();

    const firestoreKeys = new Set(firestoreData.map(row => row.dedupeKey || row.id));
    pendingData = pendingData.filter(row => !firestoreKeys.has(row.dedupeKey));
    renderAll();
  } catch (error) {
    setFirebaseStatus("Local preview mode", "danger");
    log(`Firebase Upload Error: ${error.message}`);
    log("현재 첨부 Data는 Local Chart에는 반영되어 있습니다. Firestore Rule Publish 후 다시 첨부하면 누적 저장됩니다.");
  } finally {
    setBusy(false);
  }
}

function getFilterValue(select) {
  return select.value || "ALL";
}

function getFilteredRows() {
  const rows = getCurrentRows();
  const dateFrom = el.dateFrom.value;
  const dateTo = el.dateTo.value;
  const lot = getFilterValue(el.lotFilter);
  const bin = getFilterValue(el.binFilter);
  const material = getFilterValue(el.materialFilter);
  const program = getFilterValue(el.programFilter);

  return rows.filter(row => {
    if (dateFrom && row.dateKey < dateFrom) return false;
    if (dateTo && row.dateKey > dateTo) return false;
    if (lot !== "ALL" && row.originalLot !== lot) return false;
    if (bin !== "ALL" && row.bin !== bin) return false;
    if (material !== "ALL" && row.materialCode !== material) return false;
    if (program !== "ALL" && row.testProgram !== program) return false;
    return true;
  });
}

function fillSelect(select, values, allLabel, comparator) {
  const previous = select.value || "ALL";
  const sorted = uniqueSorted(values, comparator);
  select.innerHTML = `<option value="ALL">${escapeHtml(allLabel)}</option>` + sorted.map(value => (
    `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
  )).join("");
  select.value = sorted.includes(previous) ? previous : "ALL";
}

function rebuildFilterOptions(rows) {
  fillSelect(el.lotFilter, rows.map(row => row.originalLot), "All 原批号");
  fillSelect(el.binFilter, rows.map(row => row.bin), "All BIN", compareBins);
  fillSelect(el.materialFilter, rows.map(row => row.materialCode), "All 物料编码");
  fillSelect(el.programFilter, rows.map(row => row.testProgram), "All 测试程序");

  const dates = uniqueSorted(rows.map(row => row.dateKey));
  const minDate = dates[0] || "";
  const maxDate = dates[dates.length - 1] || "";
  el.dateFrom.min = minDate;
  el.dateFrom.max = maxDate;
  el.dateTo.min = minDate;
  el.dateTo.max = maxDate;

  if (!filterDefaultsInitialized && dates.length) {
    el.dateFrom.value = minDate;
    el.dateTo.value = maxDate;
    filterDefaultsInitialized = true;
  }
}

function resetFilters() {
  const rows = getCurrentRows();
  const dates = uniqueSorted(rows.map(row => row.dateKey));
  el.dateFrom.value = dates[0] || "";
  el.dateTo.value = dates[dates.length - 1] || "";
  el.lotFilter.value = "ALL";
  el.binFilter.value = "ALL";
  el.materialFilter.value = "ALL";
  el.programFilter.value = "ALL";
  renderAll(false);
}

function buildPointRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.dateKey}__${row.originalLot}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        dateKey: row.dateKey,
        originalLot: row.originalLot,
        bins: {},
        totalQty: 0
      });
    }
    const item = grouped.get(key);
    item.bins[row.bin] = (item.bins[row.bin] || 0) + (row.qty || 0);
    item.totalQty += row.qty || 0;
  }
  return Array.from(grouped.values()).sort((a, b) => {
    const dateCompare = a.dateKey.localeCompare(b.dateKey);
    return dateCompare || a.originalLot.localeCompare(b.originalLot);
  });
}

function binColor(bin, alpha = 1) {
  let hash = 0;
  const text = String(bin);
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  const hue = Math.abs(hash * 47) % 360;
  return `hsla(${hue}, 72%, 46%, ${alpha})`;
}

function renderChart(rows) {
  const points = buildPointRows(rows);
  const bins = uniqueSorted(rows.map(row => row.bin), compareBins);
  el.chartPointSummary.textContent = `${points.length.toLocaleString()} points · ${bins.length.toLocaleString()} bins`;

  if (chart) {
    chart.destroy();
    chart = null;
  }

  if (!points.length || !bins.length) {
    el.chartEmpty.classList.remove("hidden");
    el.chartScroller.classList.add("hidden");
    el.chartEmpty.textContent = getCurrentRows().length
      ? "선택한 Filter 조건에 해당하는 Data가 없습니다."
      : "Excel 파일을 첨부하면 Trend Chart가 표시됩니다.";
    return;
  }

  el.chartEmpty.classList.add("hidden");
  el.chartScroller.classList.remove("hidden");

  const requiredWidth = Math.max(1050, points.length * 72);
  el.chartCanvasWrap.style.width = `${requiredWidth}px`;

  const datasets = bins.map(bin => ({
    label: `BIN ${bin}`,
    data: points.map(point => point.bins[bin] ?? null),
    borderColor: binColor(bin, 1),
    backgroundColor: binColor(bin, 0.16),
    borderWidth: 2,
    pointRadius: points.length > 100 ? 2 : 3,
    pointHoverRadius: 6,
    tension: 0.18,
    spanGaps: true
  }));

  chart = new Chart(el.ftTrendChart, {
    type: "line",
    data: {
      labels: points.map(point => [point.dateKey, point.originalLot]),
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, boxWidth: 10, padding: 14 }
        },
        tooltip: {
          callbacks: {
            title(items) {
              const point = points[items[0]?.dataIndex];
              return point ? `${point.dateKey} · ${point.originalLot}` : "";
            },
            label(context) {
              return `${context.dataset.label}: ${formatNumber(context.parsed.y)}`;
            },
            footer(items) {
              const point = points[items[0]?.dataIndex];
              return point ? `Total 数量: ${formatNumber(point.totalQty)}` : "";
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
            font: { size: 10 }
          },
          title: { display: true, text: "Date → 原批号" }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "数量" },
          ticks: {
            callback(value) { return formatNumber(value); }
          }
        }
      }
    }
  });
}

function aggregateDetailRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.dateKey}__${row.originalLot}__${row.bin}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        dateKey: row.dateKey,
        originalLot: row.originalLot,
        bin: row.bin,
        qty: 0,
        osat: [],
        materialCode: [],
        workOrder: [],
        originalMarking: [],
        mergedMarking: [],
        testProgram: []
      });
    }
    const item = grouped.get(key);
    item.qty += row.qty || 0;
    item.osat.push(row.osat);
    item.materialCode.push(row.materialCode);
    item.workOrder.push(row.workOrder);
    item.originalMarking.push(row.originalMarking);
    item.mergedMarking.push(row.mergedMarking);
    item.testProgram.push(row.testProgram);
  }

  return Array.from(grouped.values()).map(item => ({
    ...item,
    osat: joinUnique(item.osat),
    materialCode: joinUnique(item.materialCode),
    workOrder: joinUnique(item.workOrder),
    originalMarking: joinUnique(item.originalMarking),
    mergedMarking: joinUnique(item.mergedMarking),
    testProgram: joinUnique(item.testProgram)
  })).sort((a, b) => {
    const dateCompare = a.dateKey.localeCompare(b.dateKey);
    if (dateCompare !== 0) return dateCompare;
    const lotCompare = a.originalLot.localeCompare(b.originalLot);
    if (lotCompare !== 0) return lotCompare;
    return compareBins(a.bin, b.bin);
  });
}

function renderDetailTable(rows) {
  const detailRows = aggregateDetailRows(rows);
  const visibleRows = detailRows.slice(0, TABLE_LIMIT);

  if (!visibleRows.length) {
    el.detailBody.innerHTML = '<tr><td colspan="10" class="empty">표시할 Data가 없습니다.</td></tr>';
    el.tableNotice.textContent = "";
    return;
  }

  el.detailBody.innerHTML = visibleRows.map(row => `
    <tr>
      <td>${escapeHtml(row.dateKey)}</td>
      <td>${escapeHtml(row.originalLot)}</td>
      <td>BIN ${escapeHtml(row.bin)}</td>
      <td class="qty">${formatNumber(row.qty)}</td>
      <td>${escapeHtml(row.osat)}</td>
      <td>${escapeHtml(row.materialCode)}</td>
      <td>${escapeHtml(row.workOrder)}</td>
      <td>${escapeHtml(row.originalMarking)}</td>
      <td>${escapeHtml(row.mergedMarking)}</td>
      <td>${escapeHtml(row.testProgram)}</td>
    </tr>
  `).join("");

  el.tableNotice.textContent = detailRows.length > TABLE_LIMIT
    ? `총 ${detailRows.length.toLocaleString()} Row 중 앞의 ${TABLE_LIMIT.toLocaleString()} Row만 표시합니다. 전체 Data는 Export를 사용하세요.`
    : `총 ${detailRows.length.toLocaleString()} Row`;
}

function getDateFromFirestoreValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
  const date = getDateFromFirestoreValue(value);
  return date ? date.toLocaleString() : "-";
}

function buildUploadedFileRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const fileName = row.sourceFileName || "Unknown File";
    if (!grouped.has(fileName)) {
      grouped.set(fileName, {
        sourceFileName: fileName,
        rows: 0,
        dates: new Set(),
        lots: new Set(),
        bins: new Set(),
        qty: 0,
        latest: null
      });
    }
    const item = grouped.get(fileName);
    item.rows += 1;
    if (row.dateKey) item.dates.add(row.dateKey);
    if (row.originalLot) item.lots.add(row.originalLot);
    if (row.bin) item.bins.add(row.bin);
    item.qty += row.qty || 0;
    const uploaded = getDateFromFirestoreValue(row.uploadedAt) || getDateFromFirestoreValue(row.uploadedAtClient);
    if (uploaded && (!item.latest || uploaded > item.latest)) item.latest = uploaded;
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.latest && b.latest) return b.latest - a.latest;
    return a.sourceFileName.localeCompare(b.sourceFileName);
  });
}

function renderUploadedFiles(rows) {
  const files = buildUploadedFileRows(rows);
  if (!files.length) {
    el.uploadedFilesBody.innerHTML = '<tr><td colspan="7" class="empty">아직 Upload된 파일이 없습니다.</td></tr>';
    return;
  }

  el.uploadedFilesBody.innerHTML = files.map(file => {
    const dates = Array.from(file.dates).sort();
    const dateRange = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`) : "-";
    return `
      <tr>
        <td>${escapeHtml(file.sourceFileName)}</td>
        <td class="number">${formatNumber(file.rows)}</td>
        <td>${escapeHtml(dateRange)}</td>
        <td class="number">${formatNumber(file.lots.size)}</td>
        <td class="number">${formatNumber(file.bins.size)}</td>
        <td class="number">${formatNumber(file.qty)}</td>
        <td>${escapeHtml(file.latest ? formatDateTime(file.latest) : "Local Session")}</td>
      </tr>
    `;
  }).join("");
}

function renderMetrics(allRows, filteredRows) {
  el.allRows.textContent = allRows.length.toLocaleString();
  el.filteredRows.textContent = filteredRows.length.toLocaleString();
  el.dateCount.textContent = new Set(filteredRows.map(row => row.dateKey)).size.toLocaleString();
  el.lotCount.textContent = new Set(filteredRows.map(row => row.originalLot)).size.toLocaleString();
  el.binCount.textContent = new Set(filteredRows.map(row => row.bin)).size.toLocaleString();
  el.qtyTotal.textContent = formatNumber(filteredRows.reduce((sum, row) => sum + (row.qty || 0), 0));
  el.selectedRows.textContent = selectedRows.length.toLocaleString();
  el.firestoreRows.textContent = firestoreData.length.toLocaleString();
}

function renderAll(rebuildOptions = true) {
  const allRows = getCurrentRows();
  if (rebuildOptions) rebuildFilterOptions(allRows);
  const filteredRows = getFilteredRows();
  renderMetrics(allRows, filteredRows);
  renderChart(filteredRows);
  renderDetailTable(filteredRows);
  renderUploadedFiles(allRows);
  el.exportBtn.disabled = isBusy || allRows.length === 0;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function todayStamp() {
  const now = new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
}

function exportFilteredData() {
  const rows = getFilteredRows();
  if (!rows.length) {
    log("Export할 Filtered Data가 없습니다.");
    return;
  }

  const rawExport = rows.map(row => ({
    OSAT: row.osat,
    Date: row.dateKey,
    "物料编码": row.materialCode,
    "工单号": row.workOrder,
    "原批号": row.originalLot,
    "原Marking": row.originalMarking,
    "合批Marking": row.mergedMarking,
    "测试程序": row.testProgram,
    BIN: row.bin,
    "数量": row.qty,
    Source_File: row.sourceFileName,
    Source_Sheet: row.sourceSheetName,
    Source_Row: row.sourceRowNumber
  }));

  const detailExport = aggregateDetailRows(rows).map(row => ({
    Date: row.dateKey,
    "原批号": row.originalLot,
    BIN: row.bin,
    "数量": row.qty,
    OSAT: row.osat,
    "物料编码": row.materialCode,
    "工单号": row.workOrder,
    "原Marking": row.originalMarking,
    "合批Marking": row.mergedMarking,
    "测试程序": row.testProgram
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailExport), "Date_Lot_BIN_Trend");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawExport), "Filtered_Raw");
  XLSX.writeFile(workbook, `Austin_FT_Trend_${todayStamp()}.xlsx`);
  log(`Filtered Data Export 완료: ${rows.length.toLocaleString()} Raw Row`);
}

function setupEvents() {
  el.excelFiles.addEventListener("click", event => event.stopPropagation());

  el.dropZone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (!el.excelFiles.disabled) el.excelFiles.click();
  });

  el.dropZone.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && !el.excelFiles.disabled) {
      event.preventDefault();
      el.excelFiles.click();
    }
  });

  el.excelFiles.addEventListener("change", event => handleFiles(event.target.files));

  ["dragenter", "dragover"].forEach(eventName => {
    el.dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      event.stopPropagation();
      el.dropZone.classList.add("active");
    });
  });

  ["dragleave", "drop"].forEach(eventName => {
    el.dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      event.stopPropagation();
      el.dropZone.classList.remove("active");
    });
  });

  el.dropZone.addEventListener("drop", event => handleFiles(event.dataTransfer.files));

  [el.dateFrom, el.dateTo, el.lotFilter, el.binFilter, el.materialFilter, el.programFilter].forEach(control => {
    control.addEventListener("change", () => renderAll(false));
  });

  el.resetFilterBtn.addEventListener("click", resetFilters);
  el.exportBtn.addEventListener("click", exportFilteredData);
}

setupEvents();
renderSelectedFiles();
renderAll();
initFirebase();
