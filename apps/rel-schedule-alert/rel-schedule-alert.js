/**
 * REL Schedule Alert
 * - Reliability test plan Excel의 각 Sheet / Criteria / Rel item 일정을 Firestore에 누적
 * - Date out D-2 예고 팝업, Date out 경과 & 미완료 시 완료될 때까지 반복 팝업
 */
import { relScheduleFirebaseConfig } from "../../shared/firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  ALERT_LEAD_DAYS,
  parseSheetMatrix,
  findHeader,
  markOngoing,
  markSampleReceiptCheck,
  isTemplateSheet,
  evaluateAlert,
  isAlerting,
  formatDday,
  todayIso,
  dayDiff,
  normalizeText,
  normalizeNumber,
  formatDelayValue,
  makeDocId
} from "./rel-parser.js";

/* ============================================================
   상수
   ============================================================ */
const APP_VERSION = "v1-rel-schedule-alert";
const RAW_COLLECTION = "relScheduleRaw";
const STATUS_COLLECTION = "relScheduleStatus";
const BATCH_LIMIT = 450;
const RECHECK_INTERVAL_MS = 60 * 1000;
const TOAST_SNOOZE_MS = 30 * 60 * 1000;
const DEFAULT_SNOOZE_MS = 30 * 60 * 1000;
const DELAY_MAX_SNOOZE_MS = 4 * 60 * 60 * 1000;  // Delay 건은 최대 4시간까지만 숨김
const STALE_PLAN_DAYS = 90;                       // 마지막 Date out이 90일 이상 지난 Plan은 기본 알림 보류

const LS_ROWS = "relScheduleAlert.rows";
const LS_STATUS = "relScheduleAlert.status";
const LS_SNOOZE = "relScheduleAlert.snoozeUntil";

/* ============================================================
   상태
   ============================================================ */
let app = null;
let db = null;
let auth = null;
let currentUser = null;

let rawRows = [];                 // 파싱/Firestore raw records
let statusMap = new Map();        // dedupeKey -> { manualDone, updatedAt }
let planStatusMap = new Map();    // sheetName -> { muted }
let viewRows = [];                // evaluate 결과가 붙은 rows
let selectedFiles = [];
let fileReadStatus = new Map();
let ganttChart = null;
let lastAlertSignature = "";
let knownAlertKeys = new Set();
let toastSnooze = new Map();      // dedupeKey -> timestamp
let lastUploadDiff = { created: 0, updated: 0, unchanged: 0, removed: 0 };
let today = todayIso();

const el = id => document.getElementById(id);

const ui = {
  firebaseStatus: el("firebaseStatus"),
  authStatus: el("authStatus"),
  todayLabel: el("todayLabel"),
  alarmBar: el("alarmBar"),
  alarmBarText: el("alarmBarText"),
  showAlertBtn: el("showAlertBtn"),
  recheckBtn: el("recheckBtn"),
  reloadBtn: el("reloadBtn"),
  clearAllBtn: el("clearAllBtn"),
  exportBtn: el("exportBtn"),
  dropZone: el("dropZone"),
  excelFiles: el("excelFiles"),
  selectedFileList: el("selectedFileList"),
  scheduleBody: el("scheduleBody"),
  uploadedBody: el("uploadedBody"),
  planSelect: el("planSelect"),
  criteriaSelect: el("criteriaSelect"),
  statusSelect: el("statusSelect"),
  searchInput: el("searchInput"),
  toastStack: el("toastStack"),
  alertBackdrop: el("alertBackdrop"),
  alertBody: el("alertBody"),
  alertSubtitle: el("alertSubtitle"),
  alertFootNote: el("alertFootNote"),
  ganttChart: el("ganttChart"),
  ganttLegend: el("ganttLegend"),
  m: {
    delay: el("mDelay"), prealarm: el("mPrealarm"), watch: el("mWatch"),
    planned: el("mPlanned"), done: el("mDone"), total: el("mTotal"),
    plans: el("mPlans"),
    recv: el("mRecv"),
    firestore: el("mFirestore"),
    newRows: el("mNew"), updatedRows: el("mUpdated"), sameRows: el("mSame"), removedRows: el("mRemoved")
  }
};

/* ============================================================
   유틸
   ============================================================ */
function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function describeFirebaseError(error) {
  const code = String((error && error.code) || "");
  const message = String((error && error.message) || error || "");
  if (code.includes("permission-denied") || /insufficient permissions/i.test(message)) {
    return "Firestore 권한 없음 · firestore.rules 배포 필요 (지금은 브라우저 로컬 저장으로 동작 중)";
  }
  if (code.includes("unavailable") || /network/i.test(message)) {
    return "Firestore 연결 불가 (로컬 저장으로 동작 중)";
  }
  return "";
}

function setFirebaseStatus(text, type = "warning") {
  ui.firebaseStatus.textContent = text;
  ui.firebaseStatus.classList.remove("warning", "success", "danger");
  ui.firebaseStatus.classList.add(type);
}

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) { return fallback; }
}

function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* quota */ }
}

function endOfTodayMs() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** "uHast With Precon" -> "uHast" 처럼 Criteria를 짧게 */
function shortCriteria(criteria) {
  return normalizeText(criteria)
    .replace(/\s*with\s*out\s*precon/i, "")
    .replace(/\s*with\s*precon/i, "")
    .replace(/\s*w\/o\s*pre-?con/i, "")
    .replace(/\s*w\/\s*MSL\d*/i, "")
    .trim() || normalizeText(criteria);
}

/** 알림에 표시할 item 이름: 예) "uHast · FT(uHAST96) ET2", "HTST · T0 SAT" */
function itemLabel(row) {
  const condition = normalizeText(row.condition);
  const detail = condition && condition !== "-" ? `${row.relItem} ${condition}` : row.relItem;
  const head = shortCriteria(row.criteria);
  const label = head && head !== row.relItem ? `${head} · ${detail}` : detail;
  const block = row.block;
  if (block && block.stepCount > 1) return `${label} [${block.stepIndex}/${block.stepCount} · ${block.from}~${block.to}]`;
  return label;
}

/** On going 병합 구간 안에서 현재 몇 번째 단계인지 표시 */
function blockTag(row) {
  const block = row.block;
  if (!block || block.stepCount <= 1) return "";
  const title = `On going 병합 구간 ${block.from} ~ ${block.to} (${block.stepIndex}/${block.stepCount}단계)`
    + ` · 구간 전체 ${block.dateIn || "-"} ~ ${block.dateOut || "-"}`
    + (block.totalDuration !== null ? ` · Duration 합 ${block.totalDuration}` : "")
    + (block.totalDelay !== null ? ` · Delay 합 ${block.totalDelay}` : "");
  return ` <span class="block-to" title="${escapeHtml(title)}">${block.stepIndex}/${block.stepCount} → ${escapeHtml(block.to)}</span>`;
}

function planKeyId(sheetName) {
  return makeDocId(`plan::${sheetName}`);
}

/* ============================================================
   Excel 읽기
   ============================================================ */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readFileWithFileReader(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.onabort = () => reject(new Error("FileReader aborted"));
    reader.readAsArrayBuffer(file);
  });
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes.buffer;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",").pop() : "";
      if (!base64) return reject(new Error("DataURL has no base64 payload"));
      resolve(base64ToArrayBuffer(base64));
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader dataURL failed"));
    reader.onabort = () => reject(new Error("FileReader dataURL aborted"));
    reader.readAsDataURL(file);
  });
}

function readFileAsBinaryString(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const binary = reader.result || "";
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
      resolve(bytes.buffer);
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader binaryString failed"));
    reader.onabort = () => reject(new Error("FileReader binaryString aborted"));
    if (!reader.readAsBinaryString) return reject(new Error("readAsBinaryString unavailable"));
    reader.readAsBinaryString(file);
  });
}

async function readBlobChunk(blob) {
  if (blob.arrayBuffer) return await blob.arrayBuffer();
  return await readFileWithFileReader(blob);
}

async function readFileByChunks(file, chunkSize = 16 * 1024) {
  const chunks = [];
  let total = 0;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, file.size);
    const buffer = await readBlobChunk(file.slice(offset, end));
    chunks.push(new Uint8Array(buffer));
    total += buffer.byteLength;
    if (chunks.length % 8 === 0) await wait(0);
  }
  const merged = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { merged.set(chunk, position); position += chunk.length; }
  return merged.buffer;
}

function isReadableZipBuffer(buffer) {
  const bytes = new Uint8Array(buffer || []);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function formatFileError(error) {
  if (!error) return "unknown";
  return `${error.name || "Error"}: ${error.message || String(error)}`;
}

/**
 * Windows/Edge/OneDrive 환경에서 자주 나는 NotReadableError 대응.
 * 여러 read 방식을 순서대로 재시도합니다. (mnt-cpk-trend와 동일한 전략)
 */
async function readFileBuffer(file) {
  if (!file || typeof file.size !== "number") throw new Error("유효한 File 객체가 아닙니다. 파일을 다시 선택해주세요.");
  if (file.size === 0) throw new Error(`${file.name}: file size가 0 byte입니다. 원본을 다시 저장한 뒤 선택해주세요.`);
  log(`Reading ${file.name} / ${(file.size / 1024).toFixed(1)} KB / modified ${file.lastModified ? new Date(file.lastModified).toLocaleString() : "unknown"}`);

  const failures = [];
  const readers = [
    { name: "file-arrayBuffer", fn: () => (file.arrayBuffer ? file.arrayBuffer() : Promise.reject(new Error("arrayBuffer unavailable"))) },
    { name: "FileReader-arrayBuffer", fn: () => readFileWithFileReader(file) },
    { name: "chunked-slice", fn: () => readFileByChunks(file, 16 * 1024) },
    { name: "FileReader-dataURL", fn: () => readFileAsDataUrl(file) },
    { name: "FileReader-binaryString", fn: () => readFileAsBinaryString(file) },
    { name: "file-stream", fn: () => (file.stream ? new Response(file.stream()).arrayBuffer() : Promise.reject(new Error("stream unavailable"))) }
  ];

  for (const reader of readers) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const buffer = await reader.fn();
        if (!isReadableZipBuffer(buffer)) throw new Error(`${reader.name} returned non-xlsx buffer`);
        if (reader.name !== "file-arrayBuffer") log(`${file.name}: ${reader.name} reader success (bytes=${buffer.byteLength}).`);
        return buffer;
      } catch (error) {
        failures.push(`${reader.name} ${attempt}/2 -> ${formatFileError(error)}`);
        await wait(150 * attempt);
      }
    }
  }
  throw new Error(`${file.name}: 브라우저가 파일 원본을 읽지 못했습니다(NotReadableError 계열). Excel에서 해당 파일을 완전히 닫고, OneDrive/네트워크 폴더가 아닌 로컬 폴더(C:\\Temp 등)에 새 이름으로 저장한 뒤 다시 시도해주세요. 실패 내역=${failures.join(" | ")}`);
}

/**
 * Status 컬럼의 세로 병합을 펼치고, 각 행이 어느 병합 구간에 속하는지 map으로 돌려줍니다.
 * (Date in / Duration / Date out 등 다른 컬럼은 원본 그대로 두어야 구간 합계가 중복되지 않습니다.)
 *
 * @returns {Map<number, number>} matrix row index -> 구간 시작 row index
 */
function expandStatusMerges(sheet, statusCol, rowOffset, colOffset) {
  const blocks = new Map();
  const merges = sheet["!merges"] || [];
  const absCol = statusCol + colOffset;
  merges.forEach(range => {
    if (range.s.c > absCol || range.e.c < absCol) return;
    const originAddr = XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c });
    const origin = sheet[originAddr];
    const topIndex = range.s.r - rowOffset;
    for (let r = range.s.r; r <= range.e.r; r++) {
      blocks.set(r - rowOffset, topIndex);
      if (r === range.s.r) continue;
      if (!origin || origin.v === undefined || origin.v === null || origin.v === "") continue;
      const addr = XLSX.utils.encode_cell({ r, c: absCol });
      const cell = sheet[addr];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") continue;
      sheet[addr] = { ...origin };
    }
  });
  return blocks;
}

async function parseExcelFile(file) {
  const buffer = await readFileBuffer(file);
  // cellDates:true 로 만든 Date는 브라우저 timezone의 역사적 offset(예: Asia/Seoul 1899 LMT +08:27:52) 때문에
  // 하루가 밀릴 수 있어, Excel serial 값을 그대로 받아 직접 UTC 기준으로 변환합니다.
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: false });
  const date1904 = Boolean(workbook.Workbook && workbook.Workbook.WBProps && workbook.Workbook.WBProps.date1904);
  const records = [];
  const skipped = [];
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    // sheet !ref 가 A1이 아닌 경우(예: A2:JB123) 실제 Excel 행/열 번호를 맞춰줍니다.
    const refStart = String(sheet["!ref"] || "A1").split(":")[0];
    const origin = XLSX.utils.decode_cell(refStart);
    const rowOffset = Math.max(0, origin.r || 0);
    const colOffset = Math.max(0, origin.c || 0);

    const readRows = () => XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
    let rows = readRows();
    const header = findHeader(rows);
    let statusBlocks = null;
    if (header && header.map.status !== undefined) {
      statusBlocks = expandStatusMerges(sheet, header.map.status, rowOffset, colOffset);
      rows = readRows();
    }
    const parsed = parseSheetMatrix(sheetName, rows, file.name, { rowOffset, statusBlocks, date1904 });
    if (!parsed.header) { skipped.push(sheetName); return; }
    parsed.records.forEach(record => {
      record.schemaVersion = APP_VERSION;
      records.push(record);
    });
  });
  return { records, skipped, sheetCount: workbook.SheetNames.length };
}

async function handleFiles(files) {
  const list = Array.from(files || []).filter(f => /\.(xlsx|xlsm|xls)$/i.test(f.name));
  if (!list.length) return;
  selectedFiles = list;
  list.forEach(f => fileReadStatus.set(f.name, "읽는 중..."));
  renderSelectedFileList();

  let parsedAll = [];
  for (const file of list) {
    try {
      const { records, skipped, sheetCount } = await parseExcelFile(file);
      parsedAll = parsedAll.concat(records);
      fileReadStatus.set(file.name, `${records.length} items / ${sheetCount - skipped.length} sheets`);
      log(`${file.name}: ${records.length} items parsed (skipped sheets: ${skipped.join(", ") || "none"})`);
    } catch (error) {
      console.error(error);
      fileReadStatus.set(file.name, `Read failed: ${error.message}`);
    }
    renderSelectedFileList();
  }

  if (!parsedAll.length) {
    log("인식된 Rel schedule row가 없습니다.");
    return;
  }

  const diff = diffRecords(parsedAll);
  const removedRows = mergeRows(parsedAll);
  lastUploadDiff = {
    created: diff.created.length,
    updated: diff.updated.length,
    unchanged: diff.unchanged.length,
    removed: removedRows.length
  };
  log(`변경 비교: New ${diff.created.length} / Updated ${diff.updated.length} / 변경없음 ${diff.unchanged.length} / 삭제됨 ${removedRows.length}`);
  diff.updated.slice(0, 20).forEach(row => {
    log(`  ↻ ${row.sheetName} · ${row.criteria} · ${row.relItem} — ${(row.__changes || []).join(", ")}`);
  });

  refreshAll({ forceAlert: true });

  const changedOnly = diff.created.concat(diff.updated);
  if (changedOnly.length) await uploadRows(changedOnly);
  else log("변경된 row가 없어 Firestore 업로드를 생략했습니다.");

  if (removedRows.length) await deleteRemovedRows(removedRows);
  if (ui.excelFiles) ui.excelFiles.value = "";
}

function renderSelectedFileList() {
  if (!selectedFiles.length) {
    ui.selectedFileList.innerHTML = `<li class="empty-li">선택된 파일이 없습니다.</li>`;
    return;
  }
  ui.selectedFileList.innerHTML = selectedFiles.map(file => {
    const status = fileReadStatus.get(file.name) || "대기 중";
    const cls = /fail|error/i.test(status) ? "danger-text" : "";
    return `<li><span>${escapeHtml(file.name)}</span><b class="${cls}">${escapeHtml(status)}</b></li>`;
  }).join("");
}

const COMPARE_FIELDS = [
  "criteria", "relItem", "condition", "assyLot", "ftLot", "qty",
  "dateIn", "duration", "delay", "dateOut", "result", "status", "remark", "failMode"
];

/**
 * 같은 파일을 다시 넣었을 때 무엇이 바뀌었는지 비교합니다.
 * dedupeKey에 파일명이 들어가지 않으므로 제목의 WW가 바뀌어도 같은 항목으로 인식합니다.
 */
function diffRecords(incoming) {
  const existing = new Map(rawRows.map(row => [row.dedupeKey, row]));
  const created = [];
  const updated = [];
  const unchanged = [];
  incoming.forEach(row => {
    const previous = existing.get(row.dedupeKey);
    if (!previous) { created.push(row); return; }
    const changes = COMPARE_FIELDS.filter(field => String(previous[field] ?? "") !== String(row[field] ?? ""));
    if (changes.length) {
      row.__changes = changes.map(field => `${field}: ${previous[field] ?? "-"} → ${row[field] ?? "-"}`);
      updated.push(row);
    } else {
      unchanged.push(row);
    }
  });
  return { created, updated, unchanged };
}

/**
 * 같은 dedupeKey는 최신 값으로 교체하고, 이번에 Upload된 Sheet 안에서
 * 더 이상 나오지 않는(=Excel에서 지워진) 예전 row는 함께 제거합니다.
 * (파일명은 WW만 바뀔 뿐 Sheet 구조는 유지된다는 전제 — 이번 배치에 등장한
 *  sheetName만 "전체 교체" 대상으로 보고, 등장하지 않은 다른 Sheet의 기존 데이터는 그대로 둡니다.)
 *
 * @returns {Array} 이번 배치에서 사라진(더 이상 존재하지 않는) 기존 row 목록
 */
function mergeRows(incoming) {
  const incomingSheets = new Set(incoming.map(row => row.sheetName));
  const incomingKeys = new Set(incoming.map(row => row.dedupeKey));
  const removed = rawRows.filter(row => incomingSheets.has(row.sheetName) && !incomingKeys.has(row.dedupeKey));
  const survivors = rawRows.filter(row => !incomingSheets.has(row.sheetName));

  const map = new Map(survivors.map(row => [row.dedupeKey, row]));
  incoming.forEach(row => map.set(row.dedupeKey, row));
  rawRows = Array.from(map.values());
  cacheRows();
  return removed;
}

/**
 * Sheet 내에서 사라진(=지워진) row를 Local status + Firestore(relScheduleRaw/relScheduleStatus)에서 정리합니다.
 * 그대로 두면 Excel에서 지워진 row가 영원히 누적되어 Storage 용량을 계속 갉아먹기 때문입니다.
 */
async function deleteRemovedRows(rows) {
  if (!rows.length) return;

  let statusChanged = false;
  rows.forEach(row => { if (statusMap.delete(row.dedupeKey)) statusChanged = true; });
  if (statusChanged) cacheStatus();

  const bySheet = new Map();
  rows.forEach(row => bySheet.set(row.sheetName, (bySheet.get(row.sheetName) || 0) + 1));
  const summary = Array.from(bySheet.entries()).map(([sheet, count]) => `${sheet}(${count})`).join(", ");
  log(`Sheet 내에서 사라진 row ${rows.length}건 정리: ${summary}`);

  if (!db || !currentUser) { log("Firebase 준비 전이라 Local에서만 정리했습니다."); return; }
  try {
    let batch = writeBatch(db);
    let count = 0;
    for (const row of rows) {
      batch.delete(doc(db, RAW_COLLECTION, row.dedupeKey));
      batch.delete(doc(db, STATUS_COLLECTION, row.dedupeKey));
      count += 2;
      if (count >= BATCH_LIMIT) { await batch.commit(); batch = writeBatch(db); count = 0; }
    }
    if (count > 0) await batch.commit();
    log(`Firestore 정리 완료: ${rows.length} rows 삭제.`);
  } catch (error) {
    console.error(error);
    const hint = describeFirebaseError(error);
    log(`정리 삭제 실패: ${error.message}${hint ? ` — ${hint}` : ""}`);
    setFirebaseStatus(hint || "Firestore delete error", "danger");
  }
}

function cacheRows() {
  writeLS(LS_ROWS, rawRows.map(row => {
    const copy = { ...row };
    delete copy.uploadedAt;
    return copy;
  }));
}

function cacheStatus() {
  writeLS(LS_STATUS, {
    items: Array.from(statusMap.entries()),
    plans: Array.from(planStatusMap.entries())
  });
}

/* ============================================================
   Firestore
   ============================================================ */
async function uploadRows(records) {
  if (!db || !currentUser) { log("Firebase 준비 전이라 로컬에만 저장했습니다."); return; }
  try {
    let batch = writeBatch(db);
    let count = 0;
    for (const record of records) {
      const payload = { ...record, uploadedAt: serverTimestamp() };
      batch.set(doc(db, RAW_COLLECTION, record.dedupeKey), payload, { merge: true });
      count++;
      if (count >= BATCH_LIMIT) { await batch.commit(); batch = writeBatch(db); count = 0; }
    }
    if (count > 0) await batch.commit();
    log(`Firestore upsert 완료: ${records.length} rows.`);
    await loadFirestoreData();
  } catch (error) {
    console.error(error);
    const hint = describeFirebaseError(error);
    log(`Upload Error: ${error.message}${hint ? ` — ${hint}` : ""}`);
    setFirebaseStatus(hint || "Firestore upload error", "danger");
  }
}

async function loadFirestoreData() {
  if (!db || !currentUser) return;
  try {
    const [rawSnap, statusSnap] = await Promise.all([
      getDocs(collection(db, RAW_COLLECTION)),
      getDocs(collection(db, STATUS_COLLECTION))
    ]);

    const rows = rawSnap.docs.map(d => ({ ...d.data(), dedupeKey: d.id }))
      .filter(row => row && row.sheetName && (row.relItem || row.dateOut))
      .filter(row => !isTemplateSheet(row.sheetName));
    if (rows.length) rawRows = rows;

    statusMap = new Map();
    planStatusMap = new Map();
    statusSnap.docs.forEach(d => {
      const data = d.data() || {};
      if (data.kind === "plan" && data.sheetName) planStatusMap.set(data.sheetName, data);
      else statusMap.set(d.id, data);
    });

    cacheRows();
    cacheStatus();
    ui.m.firestore.textContent = rows.length.toLocaleString();
    log(`Firestore loaded: ${rows.length} rows / ${statusSnap.size} status docs.`);
    refreshAll({ forceAlert: true });
  } catch (error) {
    console.error(error);
    const hint = describeFirebaseError(error);
    log(`Firestore Load Error: ${error.message}${hint ? ` — ${hint}` : ""}`);
    setFirebaseStatus(hint || "Firestore read error", "danger");
  }
}

/** Firestore collection의 모든 문서를 batch로 삭제합니다. (BATCH_LIMIT 단위로 분할) */
async function deleteAllDocsInCollection(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  if (snap.empty) return 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const chunk = docs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return docs.length;
}

/** Uploaded Plan List 전체를 Local(localStorage) + Firestore에서 삭제합니다. */
async function clearAllUploadedData() {
  const total = rawRows.length;
  if (!total && !statusMap.size && !planStatusMap.size) {
    log("삭제할 Upload 데이터가 없습니다.");
    return;
  }
  const confirmed = window.confirm(
    `Uploaded Plan List 전체(${total.toLocaleString()} rows)를 Local과 Firestore에서 모두 삭제하시겠습니까?\n` +
    `이 작업은 되돌릴 수 없습니다.`
  );
  if (!confirmed) return;

  if (ui.clearAllBtn) { ui.clearAllBtn.disabled = true; ui.clearAllBtn.textContent = "삭제 중..."; }

  let firestoreOk = true;
  if (db && currentUser) {
    try {
      const [rawDeleted, statusDeleted] = await Promise.all([
        deleteAllDocsInCollection(RAW_COLLECTION),
        deleteAllDocsInCollection(STATUS_COLLECTION)
      ]);
      log(`Firestore 삭제 완료: ${RAW_COLLECTION} ${rawDeleted}건 / ${STATUS_COLLECTION} ${statusDeleted}건.`);
    } catch (error) {
      firestoreOk = false;
      console.error(error);
      const hint = describeFirebaseError(error);
      log(`Firestore 삭제 실패: ${error.message}${hint ? ` — ${hint}` : ""}`);
      setFirebaseStatus(hint || "Firestore delete error", "danger");
    }
  } else {
    firestoreOk = false;
    log("Firebase 준비 전이라 Local 데이터만 삭제했습니다.");
  }

  // Local 상태 초기화
  rawRows = [];
  statusMap = new Map();
  planStatusMap = new Map();
  viewRows = [];
  lastUploadDiff = { created: 0, updated: 0, unchanged: 0, removed: 0 };
  knownAlertKeys = new Set();
  toastSnooze = new Map();
  try { localStorage.removeItem(LS_ROWS); } catch (error) { /* ignore */ }
  try { localStorage.removeItem(LS_STATUS); } catch (error) { /* ignore */ }
  if (ui.m.firestore) ui.m.firestore.textContent = "0";

  refreshAll({ forceAlert: true });
  log(firestoreOk
    ? "Uploaded Plan List를 Local + Firestore에서 모두 삭제했습니다."
    : "Local Upload 데이터를 삭제했습니다. (Firestore는 삭제하지 못했으니 위 오류를 확인해주세요)");

  if (ui.clearAllBtn) { ui.clearAllBtn.disabled = false; ui.clearAllBtn.textContent = "전체 삭제 (Local+Firestore)"; }
}

async function saveItemStatus(dedupeKey, manualDone) {
  const payload = {
    kind: "item",
    dedupeKey,
    manualDone,
    doneAt: manualDone ? new Date().toISOString() : "",
    updatedAt: new Date().toISOString()
  };
  statusMap.set(dedupeKey, payload);
  cacheStatus();
  if (!db || !currentUser) return;
  try {
    await setDoc(doc(db, STATUS_COLLECTION, dedupeKey), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error(error);
    log(`Status 저장 실패: ${error.message}`);
  }
}

async function savePlanStatus(sheetName, muted) {
  const id = planKeyId(sheetName);
  const payload = { kind: "plan", sheetName, muted, dedupeKey: id, updatedAt: new Date().toISOString() };
  planStatusMap.set(sheetName, payload);
  cacheStatus();
  if (!db || !currentUser) return;
  try {
    await setDoc(doc(db, STATUS_COLLECTION, id), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error(error);
    log(`Plan 알림 설정 저장 실패: ${error.message}`);
  }
}

/* ============================================================
   평가 (Alert 판정)
   ============================================================ */
function planIsStale(sheetName) {
  const outs = rawRows.filter(r => r.sheetName === sheetName && r.dateOut).map(r => r.dateOut);
  if (!outs.length) return false;
  const last = outs.sort().at(-1);
  const diff = dayDiff(last, today);
  return diff !== null && diff < -STALE_PLAN_DAYS;
}

function planMuted(sheetName) {
  const explicit = planStatusMap.get(sheetName);
  if (explicit && typeof explicit.muted === "boolean") return explicit.muted;
  return planIsStale(sheetName);
}

function evaluateRows() {
  today = todayIso();
  ui.todayLabel.textContent = today;
  // 현재 진행 단계는 오늘 날짜에 따라 자동으로 다음 단계로 넘어갑니다.
  const ongoingMap = markOngoing(rawRows, statusMap, today);
  // Sheet(Plan)의 맨 첫 행(T0 SAT 등)의 Remark가 비어 있고 Receive date가 지났으면 확인 알림 대상입니다.
  const recvMap = markSampleReceiptCheck(rawRows, statusMap, today);
  viewRows = rawRows.filter(row => !isTemplateSheet(row.sheetName)).map(row => {
    const ongoing = ongoingMap.get(row.dedupeKey) || null;
    const state = evaluateAlert(
      row, statusMap.get(row.dedupeKey) || null, today, ALERT_LEAD_DAYS, ongoing ? ongoing.type : ""
    );
    return {
      ...row,
      block: ongoing ? ongoing.block : null,
      state,
      muted: planMuted(row.sheetName),
      recvCheck: recvMap.get(row.dedupeKey) || null
    };
  });
  viewRows.sort((a, b) => {
    const aRecv = a.recvCheck ? 0 : 1;
    const bRecv = b.recvCheck ? 0 : 1;
    if (aRecv !== bRecv) return aRecv - bRecv;
    const order = { delay: 0, prealarm: 1, watch: 2, planned: 3, pending: 4, none: 5, done: 6 };
    const byCode = order[a.state.code] - order[b.state.code];
    if (byCode) return byCode;
    return String(a.dateOut || "9999").localeCompare(String(b.dateOut || "9999"))
      || String(a.sheetName).localeCompare(String(b.sheetName))
      || a.rowNumber - b.rowNumber;
  });
  return viewRows;
}

function activeAlerts() {
  return viewRows.filter(row => !row.muted && isAlerting(row.state.code));
}

/** Rel team 샘플 수령확인이 필요한 행만. */
function recvCheckAlerts() {
  return viewRows.filter(row => !row.muted && row.recvCheck);
}

/**
 * 실제로 팝업(Toast + 자동 모달)을 띄울 대상만 모읍니다.
 * Pre alarm은 "Criteria별 Schedule & Alert 현황" 표에서 바로 확인할 수 있어 팝업에서는 뺍니다.
 */
function popupAlerts() {
  return viewRows.filter(row => !row.muted && (row.state.code === "delay" || row.recvCheck));
}

/* ============================================================
   Metric / Table 렌더
   ============================================================ */
function renderMetrics() {
  const counts = { delay: 0, prealarm: 0, watch: 0, planned: 0, pending: 0, done: 0, none: 0 };
  viewRows.forEach(row => { counts[row.state.code]++; });
  const alerts = activeAlerts();
  const alertCounts = { delay: 0, prealarm: 0 };
  alerts.forEach(row => alertCounts[row.state.code]++);

  ui.m.delay.textContent = alertCounts.delay;
  ui.m.prealarm.textContent = alertCounts.prealarm;
  ui.m.watch.textContent = viewRows.filter(r => !r.muted && r.state.code === "watch").length;
  ui.m.planned.textContent = counts.planned;
  ui.m.done.textContent = counts.done;
  ui.m.total.textContent = viewRows.length.toLocaleString();
  ui.m.plans.textContent = new Set(viewRows.map(r => r.sheetName)).size;
  if (ui.m.recv) ui.m.recv.textContent = recvCheckAlerts().length;
  if (ui.m.newRows) ui.m.newRows.textContent = lastUploadDiff.created.toLocaleString();
  if (ui.m.updatedRows) ui.m.updatedRows.textContent = lastUploadDiff.updated.toLocaleString();
  if (ui.m.sameRows) ui.m.sameRows.textContent = lastUploadDiff.unchanged.toLocaleString();
  if (ui.m.removedRows) ui.m.removedRows.textContent = lastUploadDiff.removed.toLocaleString();
}

function fillSelect(select, values, allLabel) {
  const previous = select.value;
  select.innerHTML = [`<option value="">${allLabel}</option>`]
    .concat(values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)).join("");
  if (previous && values.includes(previous)) select.value = previous;
}

function refreshFilters() {
  const plans = Array.from(new Set(viewRows.map(r => r.sheetName))).sort();
  fillSelect(ui.planSelect, plans, "전체 Plan");
  const plan = ui.planSelect.value;
  const criteria = Array.from(new Set(viewRows.filter(r => !plan || r.sheetName === plan).map(r => r.criteria))).sort();
  fillSelect(ui.criteriaSelect, criteria, "전체 Criteria");
  if (!ui.statusSelect.options.length) {
    ui.statusSelect.innerHTML = `
      <option value="alert">알림 대상만 (Delay + Pre alarm)</option>
      <option value="alertAll">알림 대상 + Muted Plan 포함</option>
      <option value="recvcheck">Rel team 수령확인 필요</option>
      <option value="ongoing">On going 항목 전체</option>
      <option value="">전체</option>
      <option value="delay">Delay session</option>
      <option value="prealarm">Pre alarm</option>
      <option value="watch">On going (D-2 이전)</option>
      <option value="planned">Planned</option>
      <option value="pending">Pending (미표기 경과)</option>
      <option value="done">Done</option>
      <option value="none">No date out</option>`;
    ui.statusSelect.value = "alert";
  }
}

function filteredRows() {
  const plan = ui.planSelect.value;
  const criteria = ui.criteriaSelect.value;
  const status = ui.statusSelect.value;
  const term = normalizeText(ui.searchInput.value).toLowerCase();
  return viewRows.filter(row => {
    if (plan && row.sheetName !== plan) return false;
    if (criteria && row.criteria !== criteria) return false;
    if (status === "alert" && (row.muted || !isAlerting(row.state.code))) return false;
    if (status === "alertAll" && !isAlerting(row.state.code)) return false;
    if (status === "recvcheck" && !row.recvCheck) return false;
    if (status === "ongoing" && !row.state.ongoing) return false;
    if (status && !["alert", "alertAll", "recvcheck", "ongoing"].includes(status) && row.state.code !== status) return false;
    if (term) {
      const hay = `${row.relItem} ${row.condition} ${row.assyLot} ${row.ftLot} ${row.criteria} ${row.remark} ${row.planTitle} ${row.relNo}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

function ddayCell(state) {
  if (state.dday === null) return `<span class="dday">-</span>`;
  const cls = state.dday < 0 ? "minus" : state.dday === 0 ? "zero" : "plus";
  return `<span class="dday ${cls}">${escapeHtml(formatDday(state.dday))}</span>`;
}

const PILL_CLASS = {
  delay: "delayed", prealarm: "due", watch: "soon",
  planned: "planned", pending: "none", done: "done", none: "none"
};

function pill(row) {
  const cls = PILL_CLASS[row.state.code] || "none";
  const tags = [];
  if (row.recvCheck) {
    tags.push(`<span class="st-pill recv" title="Receive date ${escapeHtml(row.recvCheck.receiveDate)} 경과 · Remark 미기재">수령확인 필요</span>`);
  }
  if (row.state.ongoing === "explicit") tags.push(`<span class="st-pill soon">On going</span>`);
  if (row.muted && isAlerting(row.state.code)) tags.push(`<span class="st-pill none">Muted</span>`);
  return `<span class="st-pill ${cls}">${escapeHtml(row.state.label)}</span> ${tags.join(" ")}`;
}

function renderTable() {
  const rows = filteredRows();
  if (!rows.length) {
    ui.scheduleBody.innerHTML = `<tr><td colspan="18" class="empty">조건에 맞는 항목이 없습니다.</td></tr>`;
    return;
  }
  ui.scheduleBody.innerHTML = rows.slice(0, 600).map(row => {
    const rowCls = row.state.code === "delay" ? "row-delayed"
      : row.state.code === "prealarm" ? "row-due"
      : row.state.code === "watch" ? "row-soon"
      : row.state.code === "done" ? "row-done" : "";
    const excelDelay = normalizeNumber(row.delay);
    const excelDelayHtml = excelDelay === null ? ""
      : excelDelay < 0
        ? `<span class="early-text" title="예정보다 ${Math.abs(excelDelay)}일 빠름">${escapeHtml(formatDelayValue(excelDelay))}</span>`
        : `<span class="${excelDelay > 0 ? "danger-text" : ""}">${escapeHtml(formatDelayValue(excelDelay))}</span>`;
    const delayCell = row.state.delayDays
      ? `<b class="danger-text" title="Date out 경과 일수">+${row.state.delayDays}</b>${excelDelayHtml ? ` <small>${excelDelayHtml}</small>` : ""}`
      : excelDelayHtml;
    return `<tr class="${rowCls}" data-key="${escapeHtml(row.dedupeKey)}">
      <td><input type="checkbox" class="done-check" data-key="${escapeHtml(row.dedupeKey)}" ${row.state.done ? "checked" : ""} /></td>
      <td>${pill(row)}</td>
      <td>${ddayCell(row.state)}</td>
      <td>${escapeHtml(row.sheetName)}</td>
      <td class="criteria-cell">${escapeHtml(row.criteria)}</td>
      <td>${escapeHtml(row.relItem)}${blockTag(row)}</td>
      <td>${escapeHtml(row.condition)}</td>
      <td>${escapeHtml(row.assyLot)}</td>
      <td>${escapeHtml(row.ftLot)}</td>
      <td class="number">${row.qty ?? ""}</td>
      <td class="date-cell">${escapeHtml(row.dateIn)}</td>
      <td class="number">${row.duration ?? ""}</td>
      <td class="number">${delayCell}</td>
      <td class="date-cell">${escapeHtml(row.dateOut)}</td>
      <td class="date-cell">${escapeHtml(row.state.alarmFrom || "")}</td>
      <td>${escapeHtml(row.result)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.remark)}</td>
    </tr>`;
  }).join("") + (rows.length > 600
    ? `<tr><td colspan="18" class="empty">상위 600건만 표시했습니다. (전체 ${rows.length.toLocaleString()}건 · 필터를 좁혀주세요)</td></tr>`
    : "");
}

/** 알림에서 클릭한 항목을 표에서 찾아 이동 + 강조합니다. */
function focusRow(dedupeKey) {
  const row = viewRows.find(item => item.dedupeKey === dedupeKey);
  if (!row) { log("해당 항목을 표에서 찾지 못했습니다."); return; }

  closeAlertModal();
  ui.searchInput.value = "";
  ui.planSelect.value = row.sheetName;
  refreshFilters();
  ui.criteriaSelect.value = row.criteria;
  ui.statusSelect.value = "";
  renderTable();
  renderGantt();

  requestAnimationFrame(() => {
    const target = Array.from(ui.scheduleBody.rows).find(tr => tr.dataset.key === dedupeKey);
    if (!target) return;
    document.querySelectorAll("tr.row-flash").forEach(tr => tr.classList.remove("row-flash"));
    target.classList.add("row-flash");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => target.classList.remove("row-flash"), 4000);
  });
}

function renderPlanList() {
  const map = new Map();
  viewRows.forEach(row => {
    const key = `${row.sourceFileName || "(local)"}|${row.sheetName}`;
    if (!map.has(key)) {
      map.set(key, {
        sourceFileName: row.sourceFileName || "(local)",
        sheetName: row.sheetName,
        title: row.planTitle || "",
        relNo: row.relNo || "",
        count: 0, delayed: 0, lastOut: ""
      });
    }
    const item = map.get(key);
    item.count++;
    if (row.state.code === "delay") item.delayed++;
    if (row.dateOut && row.dateOut > item.lastOut) item.lastOut = row.dateOut;
  });

  const list = Array.from(map.values()).sort((a, b) => b.delayed - a.delayed || a.sheetName.localeCompare(b.sheetName));
  if (!list.length) {
    ui.uploadedBody.innerHTML = `<tr><td colspan="7" class="empty">아직 Upload된 Plan이 없습니다.</td></tr>`;
    return;
  }
  ui.uploadedBody.innerHTML = list.map(item => {
    const muted = planMuted(item.sheetName);
    return `<tr>
      <td>${escapeHtml(item.sourceFileName)}</td>
      <td class="criteria-cell">${escapeHtml(item.sheetName)}
        <button type="button" class="secondary plan-mute" data-sheet="${escapeHtml(item.sheetName)}"
          style="margin-left:8px;padding:4px 9px;font-size:11px;border-radius:9px">
          ${muted ? "알림 OFF" : "알림 ON"}
        </button>
      </td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.relNo)}</td>
      <td class="number">${item.count}</td>
      <td class="number">${item.delayed ? `<b class="danger-text">${item.delayed}</b>` : 0}</td>
      <td class="date-cell">${escapeHtml(item.lastOut)}</td>
    </tr>`;
  }).join("");
}

/* ============================================================
   Gantt
   ============================================================ */
const ONE_DAY = 86400000;

function isoToMs(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function msToIso(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function msToShort(ms) {
  const d = new Date(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** 오늘 위치에 세로선 */
const todayLinePlugin = {
  id: "todayLine",
  afterDatasetsDraw(chart) {
    const x = chart.scales.x;
    const ms = isoToMs(today);
    if (!x || ms === null || ms < x.min || ms > x.max) return;
    const px = x.getPixelForValue(ms);
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(px, chart.chartArea.top);
    ctx.lineTo(px, chart.chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#e11d48";
    ctx.font = "900 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`Today ${today.slice(5)}`, px, chart.chartArea.top - 4);
    ctx.restore();
  }
};

/** 알림 대상 막대 끝에 D-Day / Delay 직접 표기 (색만으로 상태를 구분하지 않기 위함) */
const barLabelPlugin = {
  id: "barLabel",
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const rows = chart.$relRows || [];
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = "900 10px Arial";
    ctx.textBaseline = "middle";
    meta.data.forEach((bar, index) => {
      const row = rows[index];
      if (!row || !row.state) return;
      if (!["delay", "prealarm"].includes(row.state.code)) return;
      const text = row.state.code === "delay" ? `+${row.state.delayDays}d` : (row.state.dday === 0 ? "D-Day" : `D-${row.state.dday}`);
      const right = bar.x + bar.width / 2;
      ctx.fillStyle = row.state.code === "delay" ? "#be123c" : "#c2410c";
      ctx.textAlign = "left";
      if (right + 46 > chart.chartArea.right) {
        ctx.textAlign = "right";
        ctx.fillText(text, bar.x - bar.width / 2 - 6, bar.y);
      } else {
        ctx.fillText(text, right + 6, bar.y);
      }
    });
    ctx.restore();
  }
};

// 상태(status) 색 - QA Page CSS 토큰과 동일. 색만으로 구분하지 않도록 legend + 직접 표기를 함께 씁니다.
const CODE_COLOR = {
  delay: "#be123c", prealarm: "#c2410c", watch: "#a16207",
  planned: "#1d4ed8", pending: "#64748b", done: "#047857", none: "#cbd5e1"
};
const CODE_LABEL = {
  delay: "Delay session", prealarm: "Pre alarm", watch: "On going",
  planned: "Planned", pending: "Pending", done: "Done", none: "-"
};

function renderGanttLegend(rows) {
  if (!ui.ganttLegend) return;
  const used = [];
  ["delay", "prealarm", "watch", "planned", "pending", "done"].forEach(code => {
    const count = rows.filter(row => row.state.code === code).length;
    if (count) used.push(`<span><i style="background:${CODE_COLOR[code]}"></i>${escapeHtml(CODE_LABEL[code])} ${count}</span>`);
  });
  ui.ganttLegend.innerHTML = used.join("") || `<span>표시할 일정이 없습니다.</span>`;
}

function renderGantt() {
  if (typeof Chart === "undefined" || !ui.ganttChart) return;
  const plan = ui.planSelect.value || (viewRows[0] && viewRows[0].sheetName) || "";

  // Criteria를 Sheet에 나온 순서(첫 행 번호)대로 묶고, 그 안에서는 Sheet 행 순서대로
  const firstRowByCriteria = new Map();
  viewRows.filter(r => r.sheetName === plan).forEach(r => {
    const current = firstRowByCriteria.get(r.criteria);
    if (current === undefined || (r.rowNumber || 0) < current) firstRowByCriteria.set(r.criteria, r.rowNumber || 0);
  });
  const criteriaOrder = Array.from(firstRowByCriteria.entries())
    .sort((a, b) => a[1] - b[1])
    .map(entry => entry[0]);

  const rows = viewRows
    .filter(r => r.sheetName === plan && isoToMs(r.dateIn) !== null && isoToMs(r.dateOut) !== null)
    .sort((a, b) =>
      criteriaOrder.indexOf(a.criteria) - criteriaOrder.indexOf(b.criteria) ||
      (a.rowNumber || 0) - (b.rowNumber || 0))
    .slice(0, 60);

  if (ganttChart) { ganttChart.destroy(); ganttChart = null; }
  renderGanttLegend(rows);
  if (!rows.length) {
    ui.ganttChart.height = 120;
    return;
  }

  const starts = rows.map(r => isoToMs(r.dateIn));
  const ends = rows.map(r => isoToMs(r.dateOut));
  const todayMs = isoToMs(today);

  // 일정 구간에 맞춰 축을 잡습니다. 오늘이 일정에서 너무 멀면(과거 Plan 등) 축을 늘리지 않습니다.
  let min = Math.min(...starts);
  let max = Math.max(...ends);
  const span = Math.max(max - min, ONE_DAY);
  if (todayMs >= min - span * 0.5 && todayMs <= max + span * 0.5) {
    min = Math.min(min, todayMs);
    max = Math.max(max, todayMs);
  }
  const pad = Math.max((max - min) * 0.04, ONE_DAY * 2);
  min -= pad;
  max += pad;

  // 화면 높이를 행 수에 맞춰 조정 (막대가 겹쳐 보이지 않도록)
  ui.ganttChart.style.height = `${Math.max(220, rows.length * 22 + 70)}px`;

  const surface = "#ffffff";
  ganttChart = new Chart(ui.ganttChart.getContext("2d"), {
    type: "bar",
    data: {
      labels: rows.map(r => {
        const head = shortCriteria(r.criteria);
        const tail = [r.relItem, normalizeText(r.condition) && r.condition !== "-" ? r.condition : ""].filter(Boolean).join(" ");
        return `${head} · ${tail}`.slice(0, 46);
      }),
      datasets: [{
        label: "Date in → Date out",
        data: rows.map((r, i) => [starts[i], Math.max(ends[i], starts[i] + ONE_DAY * 0.4)]),
        backgroundColor: rows.map(r => CODE_COLOR[r.state.code] || CODE_COLOR.none),
        borderColor: surface,
        borderWidth: { top: 0, bottom: 0, left: 1, right: 1 },
        borderRadius: 4,
        borderSkipped: false,
        barThickness: 11
      }]
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      responsive: true,
      layout: { padding: { top: 18, right: 54 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: ctx => rows[ctx[0].dataIndex].criteria,
            label: ctx => {
              const row = rows[ctx.dataIndex];
              return [
                `${row.relItem}${row.condition && row.condition !== "-" ? ` · ${row.condition}` : ""}`,
                `${row.dateIn} → ${row.dateOut} (${row.duration ?? "-"}일)`,
                `${CODE_LABEL[row.state.code]}${row.state.dday !== null ? ` · ${formatDday(row.state.dday)}` : ""}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          bounds: "data",
          beginAtZero: false,
          min,
          max,
          ticks: {
            maxTicksLimit: 9,
            autoSkip: true,
            color: "#64748b",
            font: { size: 11 },
            callback: value => msToShort(value)
          },
          grid: { color: "rgba(148,163,184,.18)" },
          border: { display: false }
        },
        y: {
          ticks: { color: "#475569", font: { size: 10 }, autoSkip: false },
          grid: { display: false },
          border: { display: false }
        }
      }
    },
    plugins: [todayLinePlugin, barLabelPlugin]
  });
  ganttChart.$relRows = rows;
}

/* ============================================================
   Alert 팝업 / 배너
   ============================================================ */
function getSnoozeUntil() { return Number(readLS(LS_SNOOZE, 0)) || 0; }

function setSnooze(ms, hasDelayed) {
  const capped = hasDelayed ? Math.min(ms, DELAY_MAX_SNOOZE_MS) : ms;
  writeLS(LS_SNOOZE, Date.now() + capped);
  return capped;
}

function alertSignature(alerts) {
  return alerts.map(r => `${r.dedupeKey}:${r.state.code}`).sort().join("|");
}

function groupAlerts(alerts) {
  return {
    delay: alerts.filter(r => r.state.code === "delay").sort((a, b) => a.state.dday - b.state.dday),
    prealarm: alerts.filter(r => r.state.code === "prealarm").sort((a, b) => a.state.dday - b.state.dday)
  };
}

/**
 * 실제 팝업(Toast + 자동 모달)에 들어가는 항목만 묶습니다.
 * Pre alarm은 표에서 볼 수 있으므로 여기엔 포함하지 않습니다.
 */
function popupGroups(alerts) {
  return {
    delay: alerts.filter(r => r.state.code === "delay").sort((a, b) => a.state.dday - b.state.dday),
    recv: alerts.filter(r => r.recvCheck).sort((a, b) => String(a.sheetName).localeCompare(String(b.sheetName)))
  };
}

function alertItemHtml(row) {
  const cls = row.recvCheck ? "recv" : (row.state.code === "delay" ? "delayed" : "due");
  const big = row.recvCheck
    ? "수령확인"
    : row.state.code === "delay"
      ? `Delay +${row.state.delayDays}`
      : (row.state.dday === 0 ? "오늘 Date out" : `D-${row.state.dday}`);
  const sub = row.recvCheck
    ? [row.sheetName, `Receive date ${row.recvCheck.receiveDate}`, "Remark 미기재"].filter(Boolean).join(" · ")
    : [row.sheetName, "On going", row.assyLot, row.ftLot, row.dateIn ? `In ${row.dateIn}` : ""].filter(Boolean).join(" · ");
  const rightSub = row.recvCheck ? `Receive ${row.recvCheck.receiveDate}` : `Date out ${row.dateOut}`;
  return `<div class="alert-item ${cls}">
    <input type="checkbox" class="done-check" data-key="${escapeHtml(row.dedupeKey)}" title="Done 처리" />
    <div class="ai-main">
      <a class="ai-title go-row" href="#" data-goto="${escapeHtml(row.dedupeKey)}" title="표에서 이 항목으로 이동">
        ${escapeHtml(itemLabel(row))} <span class="go-arrow">↗</span>
      </a>
      <div class="ai-sub">${escapeHtml(sub || row.planTitle || "")}</div>
    </div>
    <div class="ai-right"><span class="big">${escapeHtml(big)}</span>${escapeHtml(rightSub)}</div>
  </div>`;
}

function openAlertModal(alerts) {
  const groups = popupGroups(alerts);
  const section = (title, cls, items) => items.length
    ? `<div class="alert-group">
         <h3>${title} <span class="count st-pill ${cls}">${items.length}</span></h3>
         ${items.map(alertItemHtml).join("")}
       </div>` : "";

  ui.alertBody.innerHTML =
    section("🚨 Delay session · Date out 경과 (Done 전까지 계속 알림)", "delayed", groups.delay) +
    section("📦 Rel team 샘플 수령확인 필요 (T0 Sample 전달 여부 미기재)", "recv", groups.recv);

  ui.alertSubtitle.textContent =
    `오늘 ${today} 기준 · Delay ${groups.delay.length}건 / 수령확인 ${groups.recv.length}건 (Pre alarm은 위 Criteria별 Schedule & Alert 현황 표에서 확인해주세요)`;
  ui.alertFootNote.textContent = groups.delay.length || groups.recv.length
    ? `Delay·수령확인 건이 있어 최대 4시간까지만 숨겨집니다. 완료된 항목은 왼쪽 체크박스로 Done 처리하세요.`
    : `완료된 항목은 왼쪽 체크박스로 Done 처리하세요.`;
  ui.alertBackdrop.classList.add("open");
}

function closeAlertModal() { ui.alertBackdrop.classList.remove("open"); }

function renderToasts(alerts) {
  const now = Date.now();
  const candidates = alerts
    .filter(r => (toastSnooze.get(r.dedupeKey) || 0) < now)
    .slice(0, 3);

  ui.toastStack.innerHTML = candidates.map(row => {
    const cls = row.recvCheck ? "recv" : (row.state.code === "delay" ? "delayed" : "due");
    const title = row.recvCheck
      ? "📦 Rel team 수령확인 필요"
      : row.state.code === "delay"
        ? `🚨 Delay +${row.state.delayDays}`
        : (row.state.dday === 0 ? "🔔 Pre alarm · 오늘 Date out" : `🔔 Pre alarm · D-${row.state.dday}`);
    const metaLine = row.recvCheck
      ? `${escapeHtml(row.sheetName)} · Receive date ${escapeHtml(row.recvCheck.receiveDate)}`
      : `${escapeHtml(row.sheetName)} · Date out ${escapeHtml(row.dateOut)}`;
    return `<div class="toast ${cls}">
      <div class="t-head">
        <b>${escapeHtml(title)}</b>
        <button type="button" class="t-close" data-toast-close="${escapeHtml(row.dedupeKey)}">✕</button>
      </div>
      <p><a class="go-row" href="#" data-goto="${escapeHtml(row.dedupeKey)}" title="표에서 이 항목으로 이동"><b>${escapeHtml(itemLabel(row))}</b> <span class="go-arrow">↗</span></a><br>
        ${metaLine}</p>
      <div class="t-actions">
        <button type="button" class="primary" data-toast-done="${escapeHtml(row.dedupeKey)}">Done 처리</button>
        <button type="button" class="secondary" data-goto="${escapeHtml(row.dedupeKey)}">이동</button>
        <button type="button" class="secondary" data-toast-close="${escapeHtml(row.dedupeKey)}">30분 뒤</button>
      </div>
    </div>`;
  }).join("");
}

function renderAlarmBar(alerts, recvAlerts = []) {
  const groups = groupAlerts(alerts);
  const hasAlert = alerts.length > 0 || recvAlerts.length > 0;
  ui.alarmBar.classList.toggle("quiet", !hasAlert);
  const recvText = recvAlerts.length ? ` · <b>수령확인 필요 ${recvAlerts.length}건</b>` : "";
  ui.alarmBarText.innerHTML = hasAlert
    ? `🔔 <b>Delay session ${groups.delay.length}건</b> · Pre alarm ${groups.prealarm.length}건${recvText} <span style="color:#64748b;font-weight:800">(On going 기준 · 기준일 ${escapeHtml(today)})</span>`
    : `✅ 오늘 ${escapeHtml(today)} 기준 On going 항목 중 Delay / Pre alarm 대상이 없습니다.`;
  ui.showAlertBtn.disabled = !hasAlert;
  document.title = hasAlert ? `(${alerts.length + recvAlerts.length}) REL Schedule Alert` : "REL Schedule Alert";
}

function runAlertCycle({ forceAlert = false } = {}) {
  // 배너/카운트는 Delay + Pre alarm + 수령확인 모두 보여줍니다 (팝업이 아니라 조용한 안내 영역이므로).
  const scheduleAlerts = activeAlerts();
  const recvAlerts = recvCheckAlerts();
  renderAlarmBar(scheduleAlerts, recvAlerts);

  // 실제 팝업(Toast + 자동 모달)은 Delay + 수령확인만 대상입니다.
  // Pre alarm은 위 Criteria별 Schedule & Alert 현황 표에서 바로 볼 수 있어 팝업을 띄우지 않습니다.
  const popupQueue = popupAlerts();
  renderToasts(popupQueue);

  // 새로 알림 상태로 진입한 항목이 있으면 snooze 중이어도 즉시 다시 알립니다.
  const currentKeys = new Set(popupQueue.map(row => `${row.dedupeKey}:${row.state.code}:${row.recvCheck ? "recv" : "sched"}`));
  const hasNewAlert = Array.from(currentKeys).some(key => !knownAlertKeys.has(key));
  knownAlertKeys = currentKeys;
  lastAlertSignature = alertSignature(popupQueue);

  if (!popupQueue.length) { closeAlertModal(); return; }

  const isOpen = ui.alertBackdrop.classList.contains("open");
  if (forceAlert || hasNewAlert) { openAlertModal(popupQueue); return; }
  if (isOpen) return;   // 이미 열려 있으면 목록을 다시 그리지 않습니다 (체크 중 화면 튐 방지)
  if (Date.now() >= getSnoozeUntil()) openAlertModal(popupQueue);
}

/* ============================================================
   전체 새로고침
   ============================================================ */
function refreshAll(options = {}) {
  evaluateRows();
  refreshFilters();
  renderMetrics();
  renderTable();
  renderPlanList();
  renderGantt();
  runAlertCycle(options);
}

/* ============================================================
   Export
   ============================================================ */
function exportReport() {
  const rows = filteredRows();
  if (!rows.length) { log("Export할 row가 없습니다."); return; }
  const data = rows.map(row => ({
    "Alert": row.state.label,
    "On going": row.state.ongoing ? "Y" : "",
    "D-Day": formatDday(row.state.dday),
    "Delay(alarm)": row.state.delayDays || "",
    "Delay(Excel)": formatDelayValue(row.delay),
    "Plan(Sheet)": row.sheetName,
    "Title": row.planTitle,
    "Rel.#": row.relNo,
    "Criteria": row.criteria,
    "Rel item": row.relItem,
    "Condition": row.condition,
    "Assy' lot#": row.assyLot,
    "FT lot#": row.ftLot,
    "Q'ty": row.qty ?? "",
    "Date in": row.dateIn,
    "Duration": row.duration ?? "",
    "Date out": row.dateOut,
    "Alarm from": row.state.alarmFrom || "",
    "Result": row.result,
    "Status": row.status,
    "Done": row.state.done ? "Y" : "",
    "Remark": row.remark,
    "Fail mode": row.failMode,
    "Source File": row.sourceFileName || ""
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "REL Alert");
  XLSX.writeFile(wb, `REL_Schedule_Alert_${today}.xlsx`);
  log(`Export 완료: ${rows.length} rows.`);
}

/* ============================================================
   이벤트
   ============================================================ */
function setupEvents() {
  ui.dropZone.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); ui.excelFiles.click(); });
  ui.dropZone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ui.excelFiles.click(); }
  });
  ui.excelFiles.addEventListener("click", event => event.stopPropagation());
  ui.excelFiles.addEventListener("change", event => handleFiles(event.target.files));
  ["dragenter", "dragover"].forEach(name => {
    ui.dropZone.addEventListener(name, event => { event.preventDefault(); ui.dropZone.classList.add("active"); });
  });
  ["dragleave", "drop"].forEach(name => {
    ui.dropZone.addEventListener(name, event => { event.preventDefault(); ui.dropZone.classList.remove("active"); });
  });
  ui.dropZone.addEventListener("drop", event => handleFiles(event.dataTransfer?.files));

  [ui.planSelect, ui.criteriaSelect, ui.statusSelect].forEach(select => {
    select.addEventListener("change", () => { refreshFilters(); renderTable(); renderGantt(); });
  });
  ui.searchInput.addEventListener("input", renderTable);
  ui.exportBtn.addEventListener("click", exportReport);
  ui.reloadBtn.addEventListener("click", loadFirestoreData);
  if (ui.clearAllBtn) ui.clearAllBtn.addEventListener("click", clearAllUploadedData);
  ui.recheckBtn.addEventListener("click", () => refreshAll({ forceAlert: true }));
  ui.showAlertBtn.addEventListener("click", () => openAlertModal(popupAlerts()));

  el("alertClose").addEventListener("click", () => {
    const hasUrgent = popupAlerts().some(r => r.state.code === "delay" || r.recvCheck);
    setSnooze(DEFAULT_SNOOZE_MS, hasUrgent);
    closeAlertModal();
  });
  el("snooze30").addEventListener("click", () => {
    setSnooze(30 * 60 * 1000, false); closeAlertModal();
  });
  el("snooze240").addEventListener("click", () => {
    setSnooze(4 * 60 * 60 * 1000, false); closeAlertModal();
  });
  el("snoozeToday").addEventListener("click", () => {
    const hasUrgent = popupAlerts().some(r => r.state.code === "delay" || r.recvCheck);
    const ms = Math.max(endOfTodayMs() - Date.now(), 60 * 1000);
    const applied = setSnooze(ms, hasUrgent);
    closeAlertModal();
    if (hasUrgent && applied < ms) log("Delay·수령확인 건이 있어 4시간 후 다시 알림이 표시됩니다.");
  });
  ui.alertBackdrop.addEventListener("click", event => {
    if (event.target === ui.alertBackdrop) {
      const hasUrgent = popupAlerts().some(r => r.state.code === "delay" || r.recvCheck);
      setSnooze(DEFAULT_SNOOZE_MS, hasUrgent);
      closeAlertModal();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && ui.alertBackdrop.classList.contains("open")) {
      const hasUrgent = popupAlerts().some(r => r.state.code === "delay" || r.recvCheck);
      setSnooze(DEFAULT_SNOOZE_MS, hasUrgent);
      closeAlertModal();
    }
  });

  // Done 체크 (표 + 팝업 공통)
  document.addEventListener("change", async event => {
    const target = event.target;
    if (!target.classList || !target.classList.contains("done-check")) return;
    const key = target.dataset.key;
    if (!key) return;
    const modalItem = target.closest(".alert-item");
    if (modalItem) modalItem.classList.toggle("resolved", target.checked);
    await saveItemStatus(key, target.checked);
    refreshAll();
  });

  // 알림 -> 해당 item으로 이동 (모달 / 토스트 공통)
  document.addEventListener("click", event => {
    const trigger = event.target.closest ? event.target.closest("[data-goto]") : null;
    if (!trigger) return;
    event.preventDefault();
    focusRow(trigger.dataset.goto);
  });

  // Toast 버튼
  ui.toastStack.addEventListener("click", async event => {
    const closeKey = event.target.dataset?.toastClose;
    const doneKey = event.target.dataset?.toastDone;
    if (closeKey) {
      toastSnooze.set(closeKey, Date.now() + TOAST_SNOOZE_MS);
      renderToasts(popupAlerts());
    } else if (doneKey) {
      await saveItemStatus(doneKey, true);
      refreshAll();
    }
  });

  // Plan 알림 ON/OFF
  ui.uploadedBody.addEventListener("click", async event => {
    const sheet = event.target.dataset?.sheet;
    if (!sheet) return;
    await savePlanStatus(sheet, !planMuted(sheet));
    refreshAll();
  });

  // 주기 재검사 + 탭 복귀 시 재검사 (Delay 건 반복 알림)
  setInterval(() => refreshAll(), RECHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshAll();
  });
}

/* ============================================================
   초기화
   ============================================================ */
function restoreCache() {
  const rows = readLS(LS_ROWS, []);
  if (Array.isArray(rows) && rows.length) rawRows = rows;
  const cached = readLS(LS_STATUS, null);
  if (cached) {
    statusMap = new Map(cached.items || []);
    planStatusMap = new Map(cached.plans || []);
  }
}

function initFirebase() {
  try {
    app = initializeApp(relScheduleFirebaseConfig, "rel-schedule-alert");
    db = getFirestore(app);
    auth = getAuth(app);
    onAuthStateChanged(auth, async user => {
      currentUser = user;
      if (user) {
        ui.authStatus.textContent = `Anonymous Auth OK: ${user.uid.slice(0, 8)}...`;
        setFirebaseStatus("Firebase connected", "success");
        await loadFirestoreData();
      } else {
        ui.authStatus.textContent = "Auth 필요";
        setFirebaseStatus("Auth required", "warning");
      }
    });
    signInAnonymously(auth).catch(error => {
      console.error(error);
      setFirebaseStatus("Anonymous Auth error (로컬 저장만 사용)", "danger");
      log(`Anonymous Auth Error: ${error.message}`);
    });
  } catch (error) {
    console.error(error);
    setFirebaseStatus("Firebase init error (로컬 저장만 사용)", "danger");
    log(`Firebase Init Error: ${error.message}`);
  }
}

setupEvents();
restoreCache();
refreshAll({ forceAlert: true });
initFirebase();
