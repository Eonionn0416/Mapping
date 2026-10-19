import { readPlanWorkbook, upgradeWorkbook, serialDate, dateSerial, seoulToday } from "./rel-workbook.js?v=30";
import { fileCache } from "./rel-file-cache.js";
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
  getDoc,
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
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  getBlob
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

import {
  ALERT_LEAD_DAYS,
  parseSheetMatrix,
  findHeader,
  markOngoing,
  markSampleReceiptCheck,
  markHandoffCheck,
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
const APP_VERSION = "v30-preserve-layout-20261019";
const RAW_COLLECTION = "relScheduleRaw";
const STATUS_COLLECTION = "relScheduleStatus";
const FILES_COLLECTION = "relScheduleFiles";   // 업로드한 원본 Excel 파일 다운로드 링크 메타데이터
const FILES_STORAGE_PATH = "relScheduleFiles"; // Firebase Storage 상 원본 파일 저장 경로
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
let storage = null;
let currentUser = null;

let rawRows = [];                 // 파싱/Firestore raw records
let statusMap = new Map();        // dedupeKey -> { manualDone, updatedAt }
let planStatusMap = new Map();    // sheetName -> { muted }
let sourceFileMap = new Map();    // fileName -> { downloadURL, size, uploadedAt }
let viewRows = [];                // evaluate 결과가 붙은 rows
let selectedFiles = [];
let fileReadStatus = new Map();
let ganttChart = null;
let lastAlertSignature = "";
let knownAlertKeys = new Set();
let toastSnooze = new Map();      // dedupeKey -> timestamp
let lastUploadDiff = { created: 0, updated: 0, unchanged: 0, removed: 0 };
let today = seoulToday();
let workbookModels = new Map();
let reportStates = readLS("relScheduleAlert.reports", {});
let scheduleChanges = readLS("relScheduleAlert.changes", []);
let selectedTimelineKey = null;   // 표에서 클릭해 Plan Timeline을 갱신시킨 행(dedupeKey) — 선택 강조용
let timelinePlan = null;          // 표 행 클릭으로 지정된 Plan Timeline용 Plan(Sheet) — Plan(Sheet) 필터(ui.planSelect)와 독립적으로 동작

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
    handoff: el("mHandoff"),
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

  const failures=[];
  for(const reader of [()=>file.arrayBuffer(),()=>readFileWithFileReader(file)]){
   try{const buffer=await reader();if(!isReadableZipBuffer(buffer))throw new Error('NOT_XLSX');return buffer;}
   catch(error){if(error.message==='NOT_XLSX')throw new Error('Excel XLSX 파일 형식이 아닙니다. Excel에서 XLSX로 다시 저장해주세요.');failures.push(formatFileError(error));}
  }
  throw new Error('파일 내용 분석 전 브라우저의 원본 읽기가 거부되었습니다. 양식 오류가 아닙니다. Excel을 닫고 OneDrive 파일을 로컬 폴더에 복사한 뒤, 파일 선택 버튼으로 다시 선택해주세요. 같은 파일도 다시 선택할 수 있습니다. ('+failures.join(' / ')+')');
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
  const buffer=await readFileBuffer(file);
  const model=await readPlanWorkbook(buffer,file.name);
  await cacheFile(file.name,buffer);
  workbookModels.set(file.name,model);
  const records=[],skipped=[];
  for(const source of model.sheets){
    if(!source.header||isTemplateSheet(source.name)){skipped.push(source.name);continue;}
    const max=Math.max(...source.records.map(r=>r.rowNumber),source.header.r),rows=Array.from({length:max},()=>[]);
    for(const c of source.cells.values())if(c.r<=max&&c.c<=40)rows[c.r-1][c.c-1]=c.v;
    const statusBlocks=new Map();
    for(const r of source.records){if(source.header.map.status)rows[r.rowNumber-1][source.header.map.status-1]=r.status;statusBlocks.set(r.rowNumber-1,r.statusRef||r.rowNumber);}
    const parsed=parseSheetMatrix(source.name,rows,file.name,{rowOffset:0,statusBlocks,date1904:model.date1904});
    for(const record of parsed.records){
      const legacyKey=record.dedupeKey,customer=(file.name.match(/\b(MNT|MTK|BDR)\d*/i)||[])[1]?.toUpperCase()||file.name;
      record.dedupeKey=makeDocId(customer+'::'+legacyKey);
      if(!statusMap.has(record.dedupeKey)&&statusMap.has(legacyKey))statusMap.set(record.dedupeKey,statusMap.get(legacyKey));
      const r=source.records.find(r=>r.rowNumber===record.rowNumber);
      if(r)Object.assign(record,{dateIn:r.dateIn,dateOut:r.dateOut,status:r.status,dueRef:r.dueRef,statusRef:r.statusRef,delayRef:r.delayRef,summarySelected:source.summary.includes(r),summaryLabel:r.summaryLabel||r.relItem,delay:r.delay});
      record.relNo=source.relNo||"";record.schemaVersion=APP_VERSION;records.push(record);
    }
  }
  return {records,skipped,sheetCount:model.sheets.length,buffer};
}

async function handleFiles(files) {
  const list = Array.from(files || []).filter(f => /\.(xlsx|xlsm)$/i.test(f.name));
  if (!list.length) { setNotice('Excel에서 XLSX 형식으로 저장한 파일을 업로드해 주세요.',true); return; }
  selectedFiles = list;
  list.forEach(f => fileReadStatus.set(f.name, "읽는 중..."));
  renderSelectedFileList();

  let parsedAll = [];
  for (const file of list) {
    try {
      const { records, skipped, sheetCount, buffer } = await parseExcelFile(file);
      parsedAll = parsedAll.concat(records);
      fileReadStatus.set(file.name, `${records.length} items / ${sheetCount - skipped.length} sheets`);
      log(`${file.name}: ${records.length} items parsed (skipped sheets: ${skipped.join(", ") || "none"})`);
      // 다른 사람도 원본 파일을 내려받아 수정 후 재업로드할 수 있도록, 파싱에 성공한 원본
      // 파일 그대로를 Storage에 올려둡니다 (알림/파싱 로직과는 무관 — 실패해도 계속 진행).
      try{await uploadOriginalFile(file,buffer);}catch(error){
        log(`${file.name}: 파일 읽기·일정 분석은 성공했지만 서버 파일 저장에 실패했습니다: ${error.message}`);
        fileReadStatus.set(file.name,`${records.length} items · 로컬 저장 완료 / 서버 파일 저장 실패`);
        setNotice(`${file.name}: 일정은 읽었습니다. 서버 파일 저장에 실패하여 다른 기기에서 다운로드하려면 재업로드가 필요합니다. ${error.message}`,true);
      }
    } catch (error) {
      console.error(error);
      fileReadStatus.set(file.name, `업로드 실패: ${error.message}`);
      setNotice(`${file.name}: ${error.message}`,true);
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
  "dateIn", "duration", "delay", "dateOut", "result", "status", "remark", "failMode",
  "sourceFileName", "rowNumber", "dueRef", "statusRef", "delayRef", "summarySelected", "summaryLabel", "schemaVersion"
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
  const scope=row=>((row.sourceFileName||'').match(/\b(MNT|MTK|BDR)\d*/i)||[])[1]?.toUpperCase()+'|'+row.sheetName;
  const incomingSheets = new Set(incoming.map(scope));
  const incomingKeys = new Set(incoming.map(row => row.dedupeKey));
  const removed = rawRows.filter(row => incomingSheets.has(scope(row)) && !incomingKeys.has(row.dedupeKey));
  const survivors = rawRows.filter(row => !incomingSheets.has(scope(row)));

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

/** Firestore 문서 ID로 못 쓰는 문자(/)만 안전하게 치환합니다. */
function sanitizeDocId(name) {
  return String(name || "file").replace(/[/\s]+/g, "_").slice(0, 400) || "file";
}

/**
 * 업로드한 원본 Reliability test plan Excel 파일을 Firebase Storage에 그대로 올려서,
 * 다른 사람도 "Uploaded Plan List"에서 Download 링크로 원본 파일을 받아 수정한 뒤
 * 다시 첨부(재업로드)할 수 있게 합니다. 같은 파일명으로 다시 올리면 최신 버전으로 덮어씁니다.
 * (Firestore/전체 알림 로직과는 무관한 부가 기능이라, 실패해도 나머지 업로드 흐름을 막지 않습니다.)
 */
async function uploadOriginalFile(file, buffer) {
  if (!buffer) throw new Error("파일 읽기 결과가 없습니다. 파일을 다시 선택해주세요.");
  await cacheFile(file.name, buffer);
  sourceFileMap.set(file.name, {local:true,size:file.size});
  if (!db || !currentUser) { renderPlanList(); return; }
  const path = `${FILES_STORAGE_PATH}/${sanitizeDocId(file.name)}`;
  let downloadURL = "", storageError = null;
  if(storage) try {
    const ref = storageRef(storage,path);
    await uploadBytes(ref,buffer,{contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    downloadURL = await getDownloadURL(ref);
  } catch(error) { storageError = error; }
  // Firestore chunk backup avoids token/CORS failures without opening bucket permissions.
  const bytes = new Uint8Array(buffer), revision = Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  const chunkIds=[]; let batch=writeBatch(db),batchCount=0;
  for(let i=0;i<bytes.length;i+=240000){
    const id = sanitizeDocId(file.name)+"__"+revision+"__"+chunkIds.length;
    let binary="";for(const n of bytes.subarray(i,i+240000))binary+=String.fromCharCode(n);
    batch.set(doc(db,FILES_COLLECTION,id),{kind:"chunk",fileName:file.name,downloadURL:"",data:btoa(binary),uploadedAt:serverTimestamp()});chunkIds.push(id);batchCount++;
    if(batchCount===20){await batch.commit();batch=writeBatch(db);batchCount=0;}
  }
  const metadata={fileName:file.name,downloadURL,storagePath:path,size:bytes.length,revision,chunkIds,uploadedAt:serverTimestamp()};
  batch.set(doc(db,FILES_COLLECTION,sanitizeDocId(file.name)),metadata);
  await batch.commit();
  sourceFileMap.set(file.name,{...metadata,local:true});
  await cacheFile(file.name,buffer,revision);
  if(storageError) log("Storage 연결 실패: 인증된 Firestore 파일 사본으로 다운로드할 수 있습니다.");
  renderPlanList();
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
    // handleFiles()가 파싱 직후 이미 refreshAll({forceAlert:true})로 알림을 한 번 띄웠으므로,
    // 여기서는 강제로 다시 띄우지 않고(hasNewAlert/스누즈 판단에 맡김) 중복 팝업을 막습니다.
    await loadFirestoreData({ forceAlert: false });
  } catch (error) {
    console.error(error);
    const hint = describeFirebaseError(error);
    log(`Upload Error: ${error.message}${hint ? ` — ${hint}` : ""}`);
    setFirebaseStatus(hint || "Firestore upload error", "danger");
  }
}

/**
 * forceAlert=false로 호출하면(uploadRows / 초기 Auth 로드처럼 바로 직전에 이미 같은 내용으로
 * refreshAll({forceAlert:true})가 한 번 실행된 경우) 이미 열려 있거나 방금 닫은 동일한 알림을
 * 또 한 번 강제로 띄우지 않습니다 — "팝업이 2번 뜨는" 중복 알림 버그 방지.
 * (명시적으로 새로고침 버튼을 누른 경우는 인자 없이 호출되어 기존처럼 항상 강제로 보여줍니다.)
 */
async function loadFirestoreData(options = {}) {
  const { forceAlert = true } = options;
  if (!db || !currentUser) return;
  try {
    const [rawSnap, statusSnap, filesSnap] = await Promise.all([
      getDocs(collection(db, RAW_COLLECTION)),
      getDocs(collection(db, STATUS_COLLECTION)),
      getDocs(collection(db, FILES_COLLECTION)).catch(error => { console.error(error); return null; })
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
      else if(data.kind === "report") reportStates[data.fileName+"|"+data.sheetName+"|"+data.label]=data;
      else if(data.kind === "scheduleChange") {
        scheduleChanges=scheduleChanges.filter(c=>c.fileName!==data.fileName||c.sheetName!==data.sheetName||c.dueRef!==data.dueRef);
        scheduleChanges.push(data);
      } else statusMap.set(d.id, data);
    });

    if (filesSnap) {
      sourceFileMap = new Map();
      filesSnap.docs.forEach(d => {
        const data = d.data() || {};
        if (data.fileName && data.kind !== "chunk") {
          sourceFileMap.set(data.fileName, data);
        }
      });
    }

    cacheRows();
    cacheStatus();
    if(ui.m.firestore) ui.m.firestore.textContent = rows.length.toLocaleString();
    log(`Firestore loaded: ${rows.length} rows / ${statusSnap.size} status docs.`);
    applyScheduleChanges();
    refreshAll({ forceAlert });
    hydrateWorkbooks();
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
      // 원본 파일 다운로드 링크 메타데이터도 함께 정리합니다 (Storage의 실제 파일은 남아있어도
      // 무해하므로 그대로 두고, 다음 업로드 때 같은 이름이면 다시 덮어씁니다).
      try {
        const filesDeleted = await deleteAllDocsInCollection(FILES_COLLECTION);
        sourceFileMap = new Map();
        if (filesDeleted) log(`Firestore 삭제 완료: ${FILES_COLLECTION} ${filesDeleted}건.`);
      } catch (fileError) {
        console.error(fileError);
      }
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
  today = seoulToday();
  ui.todayLabel.textContent = today;
  // 현재 진행 단계는 오늘 날짜에 따라 자동으로 다음 단계로 넘어갑니다.
  const ongoingMap = markOngoing(rawRows, statusMap, today);
  // Sheet(Plan)의 맨 첫 행(T0 SAT 등)의 Remark가 비어 있고 Receive date가 지났으면 확인 알림 대상입니다.
  const recvMap = markSampleReceiptCheck(rawRows, statusMap, today);
  // Status 병합 구간(2행 이상)의 맨 마지막 행 Remark가 비어 있고 구간이 끝났으면 to Rel / to FT 확인 대상입니다.
  const handoffMap = markHandoffCheck(rawRows, statusMap, today);
  viewRows = rawRows.filter(row => !isTemplateSheet(row.sheetName) && normalizeText(row.relNo)).map(row => {
    const ongoing = ongoingMap.get(row.dedupeKey) || null;
    const state = evaluateAlert(
      row, statusMap.get(row.dedupeKey) || null, today, ALERT_LEAD_DAYS, ongoing ? ongoing.type : ""
    );
    return {
      ...row,
      block: ongoing ? ongoing.block : null,
      state,
      muted: planMuted(row.sheetName),
      recvCheck: recvMap.get(row.dedupeKey) || null,
      handoff: handoffMap.get(row.dedupeKey) || null
    };
  });
  // 정렬 기준은 Delay > 수령확인/전달확인(critical) > Pre alarm > On going > ... 순서입니다.
  // 수령확인·전달확인 대상 행은 자재가 실제로 넘어갔는지 확인이 안 된 critical 항목이라,
  // Pre alarm보다도 위에 오도록 둡니다. (그 행 자체의 스케줄 상태(state.code)는 보통 이미
  // "Done"이라, state.code 순서로만 정렬하면 맨 아래로 밀려버려서 이 별도 우선순위가 필요합니다.)
  const rowPriority = row => {
    if (row.state.code === "delay") return 0;
    if (row.recvCheck || row.handoff) return 1;
    if (row.state.code === "prealarm") return 2;
    const order = { watch: 3, planned: 4, pending: 5, none: 6, done: 7 };
    return order[row.state.code] ?? 8;
  };
  viewRows.sort((a, b) => {
    const byPriority = rowPriority(a) - rowPriority(b);
    if (byPriority) return byPriority;
    return String(a.dateOut || "9999").localeCompare(String(b.dateOut || "9999"))
      || String(a.sheetName).localeCompare(String(b.sheetName))
      || a.rowNumber - b.rowNumber;
  });
  return viewRows;
}

function activeAlerts() {
  return summaryViewRows().filter(row => !row.muted && (isAlerting(row.state.code)||row.recvCheck||row.handoff));
}

/** Rel team 샘플 수령확인이 필요한 행만. */
function recvCheckAlerts() {
  return viewRows.filter(row => !row.muted && row.recvCheck);
}

/** Status 병합 구간이 끝났는데 to Rel / to FT 전달 확인이 필요한 행만. */
function handoffAlerts() {
  return viewRows.filter(row => !row.muted && row.handoff);
}

/**
 * 우측 Toast 팝업에 띄울 대상 — Delay만입니다.
 * Pre alarm, Rel team 수령확인은 "Criteria별 Schedule & Alert 현황" 표(및 상단 배너/카드)에서
 * 확인할 수 있으므로 Toast에는 띄우지 않습니다.
 */
function toastAlerts() {
  return summaryViewRows().filter(row => !row.muted && row.state.code === "delay");
}

/**
 * 중앙 모달(Reliability Schedule Alert)에 띄울 대상 — Delay + to Rel/to FT 전달확인입니다.
 * 전달확인은 자재가 실제로 넘어갔는지 확인이 안 된 critical 항목이라 Toast는 아니어도 모달에는
 * 표시합니다. Pre alarm과 수령확인은 표/배너/카드에서만 확인합니다.
 */
function modalAlerts() {
  return summaryViewRows().filter(row => !row.muted && (row.state.code === "delay" || (row.state.code === "prealarm" && row.dateOut===today) || row.handoff || row.recvCheck));
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
  if (ui.m.handoff) ui.m.handoff.textContent = handoffAlerts().length;
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
  ui.statusSelect.innerHTML='<option value="alert">알림 대상만 · D-Day / 지연 / 확인 필요</option>';
  ui.statusSelect.value='alert';ui.statusSelect.disabled=true;
}

function filteredRows() {
  const plan = ui.planSelect.value;
  const criteria = ui.criteriaSelect.value;
  const status = "alert";
  const term = normalizeText(ui.searchInput.value).toLowerCase();
  return summaryViewRows().filter(row => {
    if (plan && row.sheetName !== plan) return false;
    if (!el("showPrealerts").checked && row.state.code === "prealarm" && row.dateOut > today && !row.recvCheck && !row.handoff) return false;
    if (criteria && row.criteria !== criteria) return false;
    const isAlertRow = isAlerting(row.state.code) || Boolean(row.recvCheck) || Boolean(row.handoff);
    if (status === "alert" && (row.muted || !isAlertRow)) return false;
    if (status === "alertAll" && !isAlertRow) return false;
    if (status === "recvcheck" && !row.recvCheck) return false;
    if (status === "handoff" && !row.handoff) return false;
    if (status === "ongoing" && !row.state.ongoing) return false;
    if (status && !["alert", "alertAll", "recvcheck", "handoff", "ongoing"].includes(status) && row.state.code !== status) return false;
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

/**
 * row.state.done(Excel Status=Done 등)은 "그 스케줄 단계 자체가 끝났는지"만 볼 뿐,
 * 수령확인/전달확인처럼 별도로 남은 확인 사항은 반영하지 않습니다. 그래서 수령확인/전달확인이
 * 아직 열려 있는 행까지 "Done"으로 보여주면 이미 다 처리된 것처럼 오해하기 쉬워, 표에서는
 * 그 경우 Done 표시를 보류합니다(체크박스도 함께 — resolveDoneChecked 참고).
 */
function isResolvedDone(row) {
  return row.state.done && !row.recvCheck && !row.handoff;
}

function pill(row) {
  const pendingTransfer = Boolean(row.recvCheck || row.handoff);
  const showAsDone = row.state.code === "done" && pendingTransfer;
  const cls = showAsDone ? "none" : (PILL_CLASS[row.state.code] || "none");
  const label = showAsDone ? "시험 종료" : row.state.label;
  const labelTitle = showAsDone ? "Excel Status=Done(시험 단계는 끝났지만) · 수령확인/전달확인은 아직 남아 있습니다" : "";
  const tags = [];
  if (row.recvCheck) {
    tags.push(`<span class="st-pill recv" title="Receive date ${escapeHtml(row.recvCheck.receiveDate)} 경과 · Remark 미기재">수령확인 필요</span>`);
  }
  if (row.handoff) {
    const label = row.handoff.kind === "toRel" ? "to Rel 확인 필요" : "to FT 확인 필요";
    tags.push(`<span class="st-pill recv" title="Date out ${escapeHtml(row.handoff.dateOut)} 경과 · Remark 미기재">${escapeHtml(label)}</span>`);
  }
  if (row.state.ongoing === "explicit") tags.push(`<span class="st-pill soon">On going</span>`);
  if (row.muted && isAlerting(row.state.code)) tags.push(`<span class="st-pill none">Muted</span>`);
  return `<span class="st-pill ${cls}" title="${escapeHtml(labelTitle)}">${escapeHtml(label)}</span> ${tags.join(" ")}`;
}

function renderTable() {
  const rows=filteredRows();
  el("summaryCount").textContent=`${rows.length} checkpoints`;
  ui.scheduleBody.innerHTML=rows.map(row=>{
    const delay=Math.max(0,Number(row.delay)||0)+(row.state.done?0:Math.max(0,dayDiff(today,row.dateOut)||0));
    const late=!row.state.done && row.dateOut && row.dateOut<today;
    return `<tr class="${late?'row-delayed':''}" data-key="${escapeHtml(row.dedupeKey)}">
      <td><input type="checkbox" class="done-check" data-key="${escapeHtml(row.dedupeKey)}" ${row.state.done?'checked':''} aria-label="${escapeHtml(row.relItem)} 완료" /></td>
      <td><b>${escapeHtml(row.sheetName)}</b><small class="row-subtitle">${escapeHtml(row.relNo)}</small></td>
      <td>${escapeHtml(row.criteria)}</td><td>${escapeHtml(row.relItem)}</td>
      <td class="date-cell">${escapeHtml(row.dateOut||'미정')} ${!row.state.done&&row.dateOut===today?'<span class="st-pill due">D-Day</span>':''}</td>
      <td>${row.state.done?'<span class="st-pill done">Done</span>':escapeHtml(row.status||'미입력')}</td>
      <td class="${late?'danger-text':''}">${delay?`+${delay}일`:'—'}</td>
      <td>${late?`<button class="delay-apply" data-key="${escapeHtml(row.dedupeKey)}">오늘로 변경 (+${dayDiff(today,row.dateOut)}일)</button>`:'—'}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="8" class="empty">표시할 Summary 항목이 없습니다. 파일을 업로드하거나 필터를 변경하세요.</td></tr>';
}

/** 알림에서 클릭한 항목을 표에서 찾아 이동 + 강조합니다. */
function focusRow(dedupeKey) {
  const row = summaryViewRows().find(item => item.dedupeKey === dedupeKey);
  if (!row) { log("해당 항목을 표에서 찾지 못했습니다."); return; }

  closeAlertModal();
  if(row.dateOut>today)el("showPrealerts").checked=true;
  timelinePlan=row.sheetName;
  ui.searchInput.value = "";
  ui.planSelect.value = row.sheetName;
  refreshFilters();
  ui.criteriaSelect.value = row.criteria;
  ui.statusSelect.value = "alert";
  selectedTimelineKey = dedupeKey;
  renderTable();
  renderGantt();

  requestAnimationFrame(() => {
    const target = Array.from(ui.scheduleBody.querySelectorAll("tr[data-key]")).find(tr => tr.dataset.key === dedupeKey);
    if (!target) return;
    document.querySelectorAll("tr.row-flash").forEach(tr => tr.classList.remove("row-flash"));
    target.classList.add("row-flash");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => target.classList.remove("row-flash"), 4000);
  });
}

/**
 * "Criteria별 Schedule & Alert 현황" 표에서 행을 클릭하면 아래 Plan Timeline(Gantt)이
 * 그 행의 Plan(Sheet) 일정으로 바뀝니다. Plan(Sheet) select(ui.planSelect)와 표 필터는
 * 건드리지 않고 timelinePlan만 별도로 갱신하므로, 표는 "전체 Plan" 등 기존 필터 그대로
 * 유지되고 Plan Timeline만 클릭한 행의 Plan으로 독립적으로 바뀝니다.
 */
function selectPlanFromRow(dedupeKey) {
  const row = viewRows.find(item => item.dedupeKey === dedupeKey);
  if (!row) return;
  selectedTimelineKey = dedupeKey;
  timelinePlan = row.sheetName;
  renderTable();
  renderGantt();
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
    ui.uploadedBody.innerHTML = `<tr><td colspan="8" class="empty">아직 Upload된 Plan이 없습니다.</td></tr>`;
    return;
  }
  ui.uploadedBody.innerHTML = list.map(item => {
    const muted = planMuted(item.sheetName);
    const fileInfo = sourceFileMap.get(item.sourceFileName);
    const downloadCell = `<button type="button" class="secondary file-download" data-file="${escapeHtml(item.sourceFileName)}">Download Excel</button>`;
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
      <td>${downloadCell}</td>
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
  if(typeof Chart === "undefined")return;
  if(ganttChart){ganttChart.destroy();ganttChart=null;}
  const plan=timelinePlan||ui.planSelect.value;
  const rows=summaryViewRows().filter(r=>(!plan||r.sheetName===plan)&&!r.state.done&&r.dateOut&&r.dateOut<=today&&!r.muted&&isAlerting(r.state.code))
    .sort((a,b)=>a.dateOut.localeCompare(b.dateOut));
  ui.ganttLegend.textContent=rows.length?`D-Day 포함 · ${rows.length}개 표시`:'현재 선택 범위에 D-Day 또는 지연된 알림 대상이 없습니다.';
  ui.ganttChart.parentElement.style.height=`${Math.max(140,rows.length*42+55)}px`;
  if(!rows.length)return;
  ganttChart=new Chart(ui.ganttChart,{
    type:'bar',
    data:{labels:rows.map(r=>[r.sheetName,`${shortCriteria(r.criteria)} · ${r.relItem} · ${r.dateOut===today?'D-Day':'+'+dayDiff(today,r.dateOut)+'일'}`]),datasets:[{label:'경과 일수',data:rows.map(r=>dayDiff(today,r.dateOut)),backgroundColor:rows.map(r=>r.dateOut===today?'#d59a32':'#c45151'),minBarLength:4,borderRadius:4,barThickness:18}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,title:{display:true,text:'Due date 이후 경과 일수'},ticks:{precision:0}},y:{grid:{display:false},ticks:{font:{size:12}}}}}
  });
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
 * 모달(Reliability Schedule Alert)에 들어가는 항목을 묶습니다.
 * Pre alarm, 수령확인은 표/배너/카드에서 볼 수 있으므로 모달에는 Delay + to Rel/to FT
 * 전달확인(critical)만 남깁니다.
 */
function popupGroups(alerts) {
 return {
  delay:alerts.filter(r=>r.state.code==='delay'),
  today:alerts.filter(r=>r.state.code!=='delay'&&!r.state.done&&r.dateOut===today),
  check:alerts.filter(r=>(r.handoff||r.recvCheck)&&r.state.code!=='delay'&&(r.state.done||r.dateOut!==today))
 };
}
function alertItemHtml(row) {
 const label=row.state.code==='delay'?`+${dayDiff(today,row.dateOut)}일 지연`:!row.state.done&&row.dateOut===today?'D-Day':'확인 필요';
 const check=row.handoff?(row.handoff.kind==='toRel'?'to Rel 전달확인':'to FT 전달확인'):row.recvCheck?'Rel team 수령확인':'';
 return `<div class="alert-item ${row.state.code==='delay'?'delayed':'due'}">
  <div class="ai-main"><button type="button" class="ai-title go-row" data-goto="${escapeHtml(row.dedupeKey)}">${escapeHtml(row.sheetName)} · ${escapeHtml(row.relItem)} <span aria-hidden="true">↗</span></button>
  <div class="ai-sub">${escapeHtml(row.criteria)} · ${escapeHtml(row.relNo)}${check?' · '+escapeHtml(check):''}</div></div>
  <div class="ai-right"><span class="big">${label}</span><span>${escapeHtml(row.dateOut||'')}</span></div>
 </div>`;
}
function openAlertModal(alerts) {
 const groups=popupGroups(alerts);
 const section=(title,items)=>items.length?`<section class="alert-group"><h3>${title} <span class="count">${items.length}</span></h3>${items.map(alertItemHtml).join('')}</section>`:'';
 ui.alertBody.innerHTML=section('오늘 마감',groups.today)+section('기한 경과',groups.delay)+section('수령·전달 확인',groups.check)||'<p class="empty">현재 확인할 D-Day·지연·수령·전달 항목이 없습니다.</p>';
 ui.alertSubtitle.textContent=`${today} · D-Day ${groups.today.length} · 지연 ${groups.delay.length} · 확인 필요 ${groups.check.length}`;
 ui.alertFootNote.textContent='항목을 누르면 Summary의 해당 일정으로 이동합니다. 완료 처리와 날짜 변경은 Summary에서 진행하세요.';
 ui.alertBackdrop.classList.add('open');
}

function closeAlertModal() { ui.alertBackdrop.classList.remove("open"); }

function renderToasts(alerts) {
  const now = Date.now();
  const candidates = alerts
    .filter(r => (toastSnooze.get(r.dedupeKey) || 0) < now)
    .slice(0, 3);

  ui.toastStack.innerHTML = candidates.map(row => {
    const cls = "delayed";
    const title = `🚨 Delay +${row.state.delayDays}`;
    const metaLine = `${escapeHtml(row.sheetName)} · Date out ${escapeHtml(row.dateOut)}`;
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

function renderAlarmBar(alerts, recvAlerts = [], handoffAlertsList = []) {
  const groups = groupAlerts(alerts);
  const hasAlert = alerts.length > 0 || recvAlerts.length > 0 || handoffAlertsList.length > 0;
  ui.alarmBar.classList.toggle("quiet", !hasAlert);
  const recvText = recvAlerts.length ? ` · <b>수령확인 필요 ${recvAlerts.length}건</b>` : "";
  const handoffText = handoffAlertsList.length ? ` · <b>전달확인 필요 ${handoffAlertsList.length}건</b>` : "";
  ui.alarmBarText.innerHTML = hasAlert
    ? `🔔 <b>Delay session ${groups.delay.length}건</b> · Pre alarm ${groups.prealarm.length}건${recvText}${handoffText} <span style="color:#64748b;font-weight:800">(On going 기준 · 기준일 ${escapeHtml(today)})</span>`
    : `✅ 오늘 ${escapeHtml(today)} 기준 On going 항목 중 Delay / Pre alarm 대상이 없습니다.`;
  ui.showAlertBtn.disabled = !hasAlert;
  document.title = hasAlert ? `(${alerts.length + recvAlerts.length + handoffAlertsList.length}) REL Schedule Alert` : "REL Schedule Alert";
}

function runAlertCycle({ forceAlert = false } = {}) {
  // 배너/카운트는 Delay + Pre alarm + 수령확인 + 전달확인 모두 보여줍니다 (팝업이 아니라 조용한 안내 영역이므로).
  const scheduleAlerts = activeAlerts();
  const recvAlerts = recvCheckAlerts();
  const handoffAlertsList = handoffAlerts();
  renderAlarmBar(scheduleAlerts, recvAlerts, handoffAlertsList);

  // 우측 Toast는 Delay만 대상입니다. Pre alarm / 수령확인 / 전달확인은 위 표(및 배너·카드)에서
  // 바로 볼 수 있어 Toast로는 띄우지 않습니다.
  renderToasts(toastAlerts());

  // 중앙 모달(Reliability Schedule Alert)은 Delay + to Rel/to FT 전달확인(critical) 대상입니다.
  const modalQueue = modalAlerts();

  // 새로 알림 상태로 진입한 항목이 있으면 snooze 중이어도 즉시 다시 알립니다.
  const currentKeys = new Set(modalQueue.map(row => `${row.dedupeKey}:${row.state.code}:${row.handoff ? `handoff-${row.handoff.kind}` : "sched"}`));
  const hasNewAlert = Array.from(currentKeys).some(key => !knownAlertKeys.has(key));
  knownAlertKeys = currentKeys;
  lastAlertSignature = alertSignature(modalQueue);

  if (!modalQueue.length) { closeAlertModal(); return; }

  const isOpen = ui.alertBackdrop.classList.contains("open");
  if (forceAlert || hasNewAlert) { openAlertModal(modalQueue); return; }
  if (isOpen) return;   // 이미 열려 있으면 목록을 다시 그리지 않습니다 (체크 중 화면 튐 방지)
  if (Date.now() >= getSnoozeUntil()) openAlertModal(modalQueue);
}

/* ============================================================
   전체 새로고침
   ============================================================ */
function refreshAll(options = {}) {
  evaluateRows();
  refreshFilters();
  renderReports();
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
    "Done": isResolvedDone(row) ? "Y" : "",
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
  ui.excelFiles.addEventListener("change", async event => { const files=Array.from(event.target.files||[]);event.target.value="";await handleFiles(files); });
  ["dragenter", "dragover"].forEach(name => {
    ui.dropZone.addEventListener(name, event => { event.preventDefault(); ui.dropZone.classList.add("active"); });
  });
  ["dragleave", "drop"].forEach(name => {
    ui.dropZone.addEventListener(name, event => { event.preventDefault(); ui.dropZone.classList.remove("active"); });
  });
  ui.dropZone.addEventListener("drop", event => handleFiles(event.dataTransfer?.files));

  // Plan(Sheet) select를 사용자가 직접 바꾸면 표 클릭으로 지정했던 timelinePlan은 해제하고
  // 다시 select 값을 기준으로 Plan Timeline이 따라가도록 합니다.
  ui.planSelect.addEventListener("change", () => {
    timelinePlan = null;
    selectedTimelineKey = null;
    refreshFilters();
    renderTable();
    renderGantt();
  });
  [ui.criteriaSelect, ui.statusSelect].forEach(select => {
    select.addEventListener("change", () => { refreshFilters(); renderTable(); renderGantt(); });
  });
  ui.searchInput.addEventListener("input", renderTable);
  el("showPrealerts").addEventListener("change",renderTable);
  setupReportEvents();
  ui.exportBtn.addEventListener("click", exportReport);
  ui.reloadBtn.addEventListener("click", loadFirestoreData);
  if (ui.clearAllBtn) ui.clearAllBtn.addEventListener("click", clearAllUploadedData);
  ui.recheckBtn.addEventListener("click", () => refreshAll({ forceAlert: true }));
  ui.showAlertBtn.addEventListener("click", () => openAlertModal(modalAlerts()));

  el("alertClose").addEventListener("click", () => {
    const hasUrgent = modalAlerts().length > 0;
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
    const hasUrgent = modalAlerts().length > 0;
    const ms = Math.max(endOfTodayMs() - Date.now(), 60 * 1000);
    const applied = setSnooze(ms, hasUrgent);
    closeAlertModal();
    if (hasUrgent && applied < ms) log("Delay·전달확인 건이 있어 4시간 후 다시 알림이 표시됩니다.");
  });
  ui.alertBackdrop.addEventListener("click", event => {
    if (event.target === ui.alertBackdrop) {
      const hasUrgent = modalAlerts().length > 0;
      setSnooze(DEFAULT_SNOOZE_MS, hasUrgent);
      closeAlertModal();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && ui.alertBackdrop.classList.contains("open")) {
      const hasUrgent = modalAlerts().length > 0;
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
    await persistDoneToWorkbook(key, target.checked);
    refreshAll();
  });

  // 알림 -> 해당 item으로 이동 (모달 / 토스트 공통)
  document.addEventListener("click", event => {
    const trigger = event.target.closest ? event.target.closest("[data-goto]") : null;
    if (!trigger) return;
    event.preventDefault();
    focusRow(trigger.dataset.goto);
  });

  // 표에서 행을 클릭하면 아래 Plan Timeline을 그 행의 Plan으로 갱신 (체크박스 클릭은 제외)
  ui.scheduleBody.addEventListener("click", event => {
    if (event.target.closest("input, a, button")) return;
    const tr = event.target.closest("tr[data-key]");
    if (!tr) return;
    selectPlanFromRow(tr.dataset.key);
  });

  // Toast 버튼
  ui.toastStack.addEventListener("click", async event => {
    const closeKey = event.target.dataset?.toastClose;
    const doneKey = event.target.dataset?.toastDone;
    if (closeKey) {
      toastSnooze.set(closeKey, Date.now() + TOAST_SNOOZE_MS);
      renderToasts(toastAlerts());
    } else if (doneKey) {
      await saveItemStatus(doneKey, true);
      refreshAll();
    }
  });

  // Plan 알림 ON/OFF
  ui.uploadedBody.addEventListener("click", async event => {
    const sheet = event.target.closest(".plan-mute")?.dataset.sheet;
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

async function cacheFile(name,buffer,revision='') { try { await fileCache(name,buffer,revision); } catch(e) { log('로컬 파일 보관 실패: '+e.message); } }
async function sourceBuffer(name) {
  const info=sourceFileMap.get(name)||{};
  const local=await fileCache(name).catch(()=>null);
  if(local && (!info.revision || local.revision===info.revision))return local.buffer;
  let remoteError;
  if(info.chunkIds?.length && db && currentUser) {
    try {
      const chunks=await Promise.all(info.chunkIds.map(id=>getDoc(doc(db,FILES_COLLECTION,id))));
      const bytes=chunks.map(d=>{if(!d.exists()||!d.data().data)throw Error('파일 조각 누락');return new Uint8Array(base64ToArrayBuffer(d.data().data));});
      const result=new Uint8Array(bytes.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of bytes){result.set(c,offset);offset+=c.length;}
      if(info.size && result.length!==info.size)throw Error('파일 크기 검증 실패');
      await cacheFile(name,result.buffer,info.revision);return result.buffer;
    }catch(e){remoteError=e;}
  }
  if(storage && currentUser)try {
    const ref=storageRef(storage,info.storagePath||`${FILES_STORAGE_PATH}/${sanitizeDocId(name)}`);
    const blob=await getBlob(ref,25*1024*1024);const buffer=await blob.arrayBuffer();await cacheFile(name,buffer,info.revision);return buffer;
  }catch(e){remoteError=e;}
  if(info.downloadURL)try {
    const ref=storageRef(storage,info.storagePath||`${FILES_STORAGE_PATH}/${sanitizeDocId(name)}`);
    const url=await getDownloadURL(ref);const response=await fetch(url);if(!response.ok)throw Error(`HTTP ${response.status}`);
    const buffer=await response.arrayBuffer();if(!isReadableZipBuffer(buffer))throw Error('Excel 형식 아님');await cacheFile(name,buffer,info.revision);return buffer;
  }catch(e){remoteError=e;}
  throw Error(`원본 파일을 읽을 수 없습니다. 이 Excel을 한 번 다시 업로드하면 새 다운로드 방식으로 저장됩니다. ${remoteError?.code||remoteError?.message||''}`);
}
let hydrationRunning=false;
async function hydrateWorkbooks(){
 if(hydrationRunning)return;hydrationRunning=true;
 try{for(const name of new Set(rawRows.map(r=>r.sourceFileName).filter(Boolean))){
   if(workbookModels.has(name))continue;
   try{const model=await readPlanWorkbook(await sourceBuffer(name),name);workbookModels.set(name,model);
    for(const row of rawRows.filter(r=>r.sourceFileName===name)){const s=model.sheets.find(s=>s.name===row.sheetName),r=s?.records.find(r=>r.rowNumber===row.rowNumber);if(r)Object.assign(row,{relNo:s.relNo||"",dueRef:r.dueRef,statusRef:r.statusRef,delayRef:r.delayRef,summarySelected:s.summary.includes(r),summaryLabel:r.summaryLabel||r.relItem,dateIn:r.dateIn,dateOut:r.dateOut,status:r.status,delay:r.delay});}
    await recomputeFile(name);
   }catch(e){log(name+': '+e.message);}
 }cacheRows();refreshAll();}finally{hydrationRunning=false;}
}
function workbookOptions(name){
 const reports={};for(const v of Object.values(reportStates))if(v.fileName===name){reports[v.sheetName]??={};reports[v.sheetName][v.label]={sent:v.sent,approval:v.approval};}
 const changes=scheduleChanges.filter(c=>c.fileName===name).map(c=>{const row=rawRows.find(r=>r.dedupeKey===c.rowKey&&r.sourceFileName===name);return {...c,dueRef:row?.dueRef||c.dueRef};});
 return {today,changes,reports};
}
async function downloadWorkbook(name,button){
 const label=button.textContent;button.disabled=true;button.textContent='Excel 준비 중…';
 try {const result=await upgradeWorkbook(await sourceBuffer(name),name,workbookOptions(name));
   const blob=new Blob([result.buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=url;a.download=name.replace(/\.(xlsx|xlsm)$/i,/\.xlsm$/i.test(name)?'_updated.xlsm':'_updated.xlsx');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   setNotice('업로드한 양식을 유지하고 저장된 일정·발송 정보를 반영한 Excel을 다운로드했습니다.');
 }catch(e){setNotice(e.message,true);}finally{button.disabled=false;button.textContent=label;}
}
function setNotice(message,error=false){const n=el('actionNotice');n.textContent=message;n.hidden=false;n.classList.toggle('error',error);}
function summaryViewRows(){
 const rows=viewRows.filter(r=>r.summarySelected===true || (r.summarySelected===undefined&&/^(FT\b|FT\(|.*SAT)/i.test(r.relItem)));
 return rows.map(r=>{
  const manual=statusMap.get(r.dedupeKey),state=evaluateAlert({...r,result:''},manual,today,ALERT_LEAD_DAYS,/on\s*going/i.test(r.status)?'explicit':'');
  const related=viewRows.filter(x=>x.sourceFileName===r.sourceFileName&&x.sheetName===r.sheetName&&x.criteria===r.criteria&&(x.dueRef===r.dueRef||x.statusRef&&x.statusRef===r.statusRef&&x.dateOut===r.dateOut));
  const handoff=r.handoff||related.find(x=>x.handoff)?.handoff||null;
  const recvCheck=r.recvCheck||related.find(x=>x.recvCheck)?.recvCheck||null;
  return {...r,relItem:r.summaryLabel||r.relItem,state,handoff,recvCheck};
 });
}

function applyScheduleChanges(){
 for(const c of scheduleChanges){const row=rawRows.find(r=>r.dedupeKey===c.rowKey&&r.sourceFileName===c.fileName);if(!row)continue;
  if(c.newDate&&row.dateOut<c.newDate){row.delay=(Number(row.delay)||0)+dayDiff(c.newDate,row.dateOut);row.dateOut=c.newDate;}
  if(c.status)row.status=c.status;
 }
}
async function recomputeFile(name){
 const model=workbookModels.get(name);if(!model)return;
 const result=await upgradeWorkbook(await sourceBuffer(name),name,workbookOptions(name));
 const updated=await readPlanWorkbook(result.buffer,name);
 for(const row of rawRows.filter(r=>r.sourceFileName===name)){
  const old=model.sheets.find(s=>s.name===row.sheetName),s=updated.sheets.find(s=>s.name===row.sheetName);
  if(!old?.header||!s?.header)continue;
  const r=s.records.find(r=>r.rowNumber===row.rowNumber+s.header.r-old.header.r);
  if(r)Object.assign(row,{dateIn:r.dateIn,dateOut:r.dateOut,status:r.status,delay:r.delay});
 }
 cacheRows();
}
async function saveChange(change){
 const id=makeDocId('change::'+change.fileName+'::'+change.sheetName+'::'+change.dueRef);
 const existing=scheduleChanges.find(c=>c.fileName===change.fileName&&c.sheetName===change.sheetName&&c.dueRef===change.dueRef);
 const data={...existing,...change,kind:'scheduleChange',dedupeKey:id};
 if(db&&currentUser)await setDoc(doc(db,STATUS_COLLECTION,id),{...data,updatedAt:serverTimestamp()},{merge:true});
 scheduleChanges=scheduleChanges.filter(c=>c.fileName!==change.fileName||c.sheetName!==change.sheetName||c.dueRef!==change.dueRef);scheduleChanges.push(data);
 writeLS('relScheduleAlert.changes',scheduleChanges);
 await recomputeFile(change.fileName);refreshAll();
}
async function persistDoneToWorkbook(key,checked){
 const row=rawRows.find(r=>r.dedupeKey===key);if(!row?.dueRef)return;
 const base=workbookModels.get(row.sourceFileName)?.sheets.find(s=>s.name===row.sheetName)?.records.find(r=>r.dueRef===row.dueRef);
 try{await saveChange({fileName:row.sourceFileName,sheetName:row.sheetName,dueRef:row.dueRef,rowKey:key,status:checked?'Done':base?.status||'On going'});}catch(e){setNotice('완료 상태의 Excel 반영 실패: '+e.message,true);}
}
function renderReports(){
 const filter=ui.planSelect.value,rows=[];
 for(const [name,model] of workbookModels)for(const s of model.sheets){
  if(isTemplateSheet(s.name)||!s.header||!normalizeText(s.relNo)||(filter&&filter!==s.name))continue;
  for(const r of s.reports){if(r.issue==='N/A')continue;
   const stored=reportStates[name+'|'+s.name+'|'+r.label]||{},sent=stored.sent??serialDate(r.sent),approval=stored.approval??r.approval;
   const dates=r.refs.map(ref=>rawRows.find(row=>row.sourceFileName===name&&row.sheetName===s.name&&row.dueRef===ref)?.dateOut||serialDate(s.cells.get(ref)?.v));
   const due=!r.issue&&dates.length&&dates.every(Boolean)?serialDate(Math.max(...dates.map(dateSerial))+r.extra):'';
   const delay=due?Math.max(0,dayDiff(sent||today,due)):0;
   rows.push({name,sheet:s.name,label:r.label,sent,approval,due,delay,issue:r.issue});
  }
 }
 rows.sort((a,b)=>(!b.sent&&b.delay)-(!a.sent&&a.delay)||a.sheet.localeCompare(b.sheet));
 el('reportCount').textContent=`${rows.filter(r=>!r.sent&&r.delay>0).length}건 발송 지연`;
 el('reportBody').innerHTML=rows.map(r=>`<tr class="${r.sent?'report-sent':r.delay?'row-delayed':''}" data-file="${escapeHtml(r.name)}" data-plan="${escapeHtml(r.sheet)}" data-report="${escapeHtml(r.label)}">
 <td><b>${escapeHtml(r.sheet)}</b></td><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.due||r.issue||'일정 미정')}</td><td>${r.delay?'+'+r.delay+'일':'—'}</td>
 <td><input type="date" class="report-sent-date" value="${escapeHtml(r.sent||'')}" aria-label="Send to Cust" /></td>
 <td><input type="text" class="report-approval" value="${escapeHtml(r.approval||'')}" placeholder="승인일 또는 상태" aria-label="Approval" /></td>
 <td><button class="secondary report-save">저장</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Excel을 업로드하면 고객별 Report 일정이 표시됩니다.</td></tr>';
}
function setupReportEvents(){
 document.addEventListener('click',async event=>{
  const dl=event.target.closest('.file-download');if(dl){await downloadWorkbook(dl.dataset.file,dl);return;}
  const delay=event.target.closest('.delay-apply');if(delay){
   const row=rawRows.find(r=>r.dedupeKey===delay.dataset.key);if(!row?.dueRef){setNotice('Excel을 한 번 다시 업로드하여 원본 위치를 연결해 주세요.',true);return;}
   delay.disabled=true;try{await saveChange({fileName:row.sourceFileName,sheetName:row.sheetName,dueRef:row.dueRef,rowKey:row.dedupeKey,newDate:today});setNotice('Due date를 오늘로 변경했습니다. 연결된 후속 일정과 다운로드 Excel에도 반영됩니다.');}catch(e){setNotice('저장 실패: '+e.message,true);}finally{delay.disabled=false;}return;
  }
  const save=event.target.closest('.report-save');if(save){const tr=save.closest('tr'),fileName=tr.dataset.file,sheetName=tr.dataset.plan,label=tr.dataset.report,sent=tr.querySelector('.report-sent-date').value,approval=tr.querySelector('.report-approval').value;
   const id=makeDocId('report::'+fileName+'::'+sheetName+'::'+label),data={kind:'report',dedupeKey:id,fileName,sheetName,label,sent,approval};
   save.disabled=true;try{if(db&&currentUser)await setDoc(doc(db,STATUS_COLLECTION,id),{...data,updatedAt:serverTimestamp()},{merge:true});reportStates[fileName+'|'+sheetName+'|'+label]=data;writeLS('relScheduleAlert.reports',reportStates);renderReports();setNotice('발송·승인 정보를 저장했습니다. Excel 다운로드 시 Interim은 주황색, Full은 초록색 탭으로 반영됩니다.');}catch(e){setNotice('저장 실패: '+e.message,true);}finally{save.disabled=false;}
  }
 });
 ui.planSelect.addEventListener('change',renderReports);
}


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
    try { storage = getStorage(app); } catch (storageError) {
      console.error(storageError);
      log(`Firebase Storage 초기화 실패 — 원본 파일 다운로드 기능은 비활성화됩니다: ${storageError.message}`);
    }
    onAuthStateChanged(auth, async user => {
      currentUser = user;
      if (user) {
        ui.authStatus.textContent = `Anonymous Auth OK: ${user.uid.slice(0, 8)}...`;
        setFirebaseStatus("Firebase connected", "success");
        // 부팅 시 restoreCache() 직후 이미 refreshAll({forceAlert:true})로 알림을 한 번 띄웠으므로,
        // Auth 완료 후 Firestore 데이터로 다시 그릴 때는 강제로 재오픈하지 않아 중복 팝업을 막습니다.
        await loadFirestoreData({ forceAlert: false });
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

