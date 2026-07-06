import { mtkYieldFirebaseConfig } from "../../shared/firebase-config.js";
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

const firebaseConfig = mtkYieldFirebaseConfig;

const ASSY_SHEET_NAME = "YIELD SUMMARY TAP";
const OS_SHEET_NAME = "MTK Assembly OS comparison";
const ASSY_COLLECTION = "yieldSummaryTapRaw";
const OS_COLLECTION = "osComparisonRaw";
const BATCH_LIMIT = 450;

let app = null;
let db = null;
let auth = null;
let currentUser = null;

let selectedFiles = [];
let selectedAssyRows = [];
let selectedOsRows = [];

let assyRows = [];
let osRows = [];
let uploadedFileRows = [];
let osByLotBase = new Map();
let assyMergedRows = [];
let sodSummaryRows = [];
let osTrendRows = [];
let defectTrendRows = [];

let yieldTrendChart = null;
let osTrendChart = null;
let defectTrendChart = null;

const el = {
  firebaseStatus: document.getElementById("firebaseStatus"),
  authStatus: document.getElementById("authStatus"),
  dropZone: document.getElementById("dropZone"),
  excelFiles: document.getElementById("excelFiles"),
  selectedFileList: document.getElementById("selectedFileList"),
  uploadBtn: document.getElementById("uploadBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  selectedAssyRows: document.getElementById("selectedAssyRows"),
  selectedOsRows: document.getElementById("selectedOsRows"),
  insertedRows: document.getElementById("insertedRows"),
  skippedRows: document.getElementById("skippedRows"),
  firestoreAssyRows: document.getElementById("firestoreAssyRows"),
  firestoreOsRows: document.getElementById("firestoreOsRows"),
  uploadedFiles: document.getElementById("uploadedFiles"),
  uploadedFilesBody: document.getElementById("uploadedFilesBody"),
  yieldTrendChart: document.getElementById("yieldTrendChart"),
  osTrendChart: document.getElementById("osTrendChart"),
  defectTrendChart: document.getElementById("defectTrendChart"),
  defectLimitSelect: document.getElementById("defectLimitSelect"),
  defectPpmBody: document.getElementById("defectPpmBody"),
  assyRawBody: document.getElementById("assyRawBody"),
  osTrendBody: document.getElementById("osTrendBody"),
  osRawBody: document.getElementById("osRawBody"),
  exportAssyBtn: document.getElementById("exportAssyBtn"),
  exportOsBtn: document.getElementById("exportOsBtn"),
  log: document.getElementById("log")
};

function log(message) {
  const time = new Date().toLocaleTimeString();
  el.log.textContent = `[${time}] ${message}\n` + el.log.textContent;
}

function setFirebaseStatus(text, type = "warning") {
  el.firebaseStatus.textContent = text;
  el.firebaseStatus.classList.remove("warning", "success", "danger");
  el.firebaseStatus.classList.add(type);
}

function setBusy(isBusy) {
  const hasSelectedRows = selectedAssyRows.length > 0 || selectedOsRows.length > 0;
  el.uploadBtn.disabled = isBusy || !db || !currentUser || !hasSelectedRows;
  el.refreshBtn.disabled = isBusy || !db || !currentUser;
  el.exportAssyBtn.disabled = isBusy || !assyMergedRows.length;
  el.exportOsBtn.disabled = isBusy || !osTrendRows.length;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function normalizeSod(value) {
  if (value instanceof Date) return formatDateCompact(value);

  const raw = normalizeText(value);
  if (/^\d{8}$/.test(raw)) return raw;

  const match = raw.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return `${match[1]}${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`;
  }

  const asNumber = normalizeNumber(raw);
  if (asNumber !== null && /^\d{8}$/.test(String(asNumber))) return String(asNumber);

  return raw;
}

function formatDateCompact(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function compactDateToLabel(value) {
  const raw = normalizeText(value);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw;
}

function parseInputDate(value) {
  if (value instanceof Date) return formatDateCompact(value);

  const raw = normalizeText(value);
  const match = raw.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return `${match[1]}${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`;
  }

  const numeric = normalizeNumber(raw);
  if (numeric !== null && numeric > 20000 && numeric < 60000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + numeric * 86400000);
    return formatDateCompact(date);
  }

  return raw;
}

function normalizeDefectName(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function normalizeLotBase(value) {
  const raw = normalizeText(value).replace(/\s+/g, " ");
  if (!raw) return "";
  return raw.split(" ")[0].trim();
}

function safeDocId(value) {
  const cleaned = normalizeText(value).replace(/[\/]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") return `doc_${Date.now()}`;
  return cleaned;
}

function hashString(value) {
  let hash = 0;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function makeAssyDedupeKey(row) {
  const lot = safeDocId(row.sckInputLotNo);
  const inQty = normalizeNumber(row.inQty);
  return `${lot}__${inQty}`;
}

function makeOsDedupeKey(row) {
  // OS 중복 기준: LOT_ID + TOTAL_QTY
  // 같은 OS report가 반복 업로드되어도 같은 LOT_ID/TOTAL_QTY 조합은 추가하지 않습니다.
  const lot = safeDocId(row.lotId);
  const totalQty = normalizeNumber(row.osInQty);
  return safeDocId(`OS__${lot}__${totalQty}`);
}

function convertAssyRow(rawRow, fileName) {
  const row = {
    sourceType: "ASSY",
    sod: normalizeSod(rawRow["SOD"]),
    project: normalizeText(rawRow["Project"]),
    device: normalizeText(rawRow["Device"]),
    stage: normalizeText(rawRow["Stage"]),
    sckInputLotNo: normalizeText(rawRow["SCK input Lot No"]),
    mtkMoLot: normalizeText(rawRow["MTK Mo Lot"]),
    ftLotNo: normalizeText(rawRow["FT Lot No"]),
    batchNo1: normalizeText(rawRow["Batch No1"]),
    batchNo2: normalizeText(rawRow["Batch No2"]),
    batchNo3: normalizeText(rawRow["Batch No3"]),
    inQty: normalizeNumber(rawRow["In Qty"]),
    dbQty: normalizeNumber(rawRow["DB Qty"]),
    shipQtyK: normalizeNumber(rawRow["Ship Qty(K)"]),
    assyYield: normalizeNumber(rawRow["Assy Yield"]),
    top1: normalizeDefectName(rawRow["TOP1"]),
    qty1: normalizeNumber(rawRow["QTY"]),
    top2: normalizeDefectName(rawRow["TOP2"]),
    qty2: normalizeNumber(rawRow["QTY_1"]),
    top3: normalizeDefectName(rawRow["TOP3"]),
    qty3: normalizeNumber(rawRow["QTY_2"]),
    top4: normalizeDefectName(rawRow["TOP4"]),
    qty4: normalizeNumber(rawRow["QTY_3"]),
    top5: normalizeDefectName(rawRow["TOP5"]),
    qty5: normalizeNumber(rawRow["QTY_4"]),
    sourceFileName: fileName
  };

  row.lotBase = normalizeLotBase(row.sckInputLotNo);
  row.dedupeKey = makeAssyDedupeKey(row);
  return row;
}

function convertOsRow(rawRow, fileName) {
  const row = {
    sourceType: "OS",
    lotId: normalizeText(rawRow["LOT_ID"]),
    customer: normalizeText(rawRow["CUSTOMER"]),
    device: normalizeText(rawRow["DEVICE"]),
    lead: normalizeText(rawRow["LEAD"]),
    pcbVendor: normalizeText(rawRow["PCB_VENDOR"]),
    osInQty: normalizeNumber(rawRow["TOTAL_QTY"]),
    testQty: normalizeNumber(rawRow["TEST_QTY"]),
    osSs: normalizeNumber(rawRow["OS_SS"]),
    totalOsRej: normalizeNumber(rawRow["TOTAL_OS_REJ"]),
    openQty: normalizeNumber(rawRow["OPEN"]),
    shortQty: normalizeNumber(rawRow["SHORT"]),
    reportRejectRate: normalizeNumber(rawRow["REJECT_RATE"]),
    reportOpenRate: normalizeNumber(rawRow["OPEN_RATE"]),
    reportShortRate: normalizeNumber(rawRow["SHORT_RATE"]),
    remark: normalizeText(rawRow["REMARK"]),
    inputTime: normalizeText(rawRow["INPUT_TIME"]),
    sourceFileName: fileName
  };

  row.inputDate = parseInputDate(rawRow["INPUT_TIME"]);
  row.inputDateLabel = compactDateToLabel(row.inputDate);
  row.lotBase = normalizeLotBase(row.lotId);
  row.rejectRate = row.reportRejectRate ?? calculateRate(row.totalOsRej, row.testQty);
  row.openRate = row.reportOpenRate ?? calculateRate(row.openQty, row.testQty);
  row.shortRate = row.reportShortRate ?? calculateRate(row.shortQty, row.testQty);
  row.dedupeKey = makeOsDedupeKey(row);
  return row;
}

function calculateRate(qty, baseQty) {
  const numerator = normalizeNumber(qty) || 0;
  const denominator = normalizeNumber(baseQty) || 0;
  if (denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function isValidAssyRow(row) {
  return Boolean(row.sod && row.sckInputLotNo && row.inQty !== null && row.dedupeKey);
}

function isValidOsRow(row) {
  return Boolean(row.lotId && row.inputDate && row.osInQty !== null && row.dedupeKey);
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
  } catch (error) {
    setFirebaseStatus("Firebase/Auth error", "danger");
    el.authStatus.textContent = "Anonymous Auth 실패";
    log(`Firebase/Auth Error: ${error.message}`);
    log("Rules가 request.auth != null 이면 Firebase Console > Authentication > Sign-in method > Anonymous 를 Enable 해야 합니다.");
  } finally {
    setBusy(false);
  }
}

async function readReportFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const result = { assyRows: [], osRows: [], messages: [] };

  if (workbook.SheetNames.includes(ASSY_SHEET_NAME)) {
    const sheet = workbook.Sheets[ASSY_SHEET_NAME];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    result.assyRows = rawRows
      .map(row => convertAssyRow(row, file.name))
      .filter(isValidAssyRow);
    result.messages.push(`ASSY ${result.assyRows.length.toLocaleString()} row`);
  }

  if (workbook.SheetNames.includes(OS_SHEET_NAME)) {
    const sheet = workbook.Sheets[OS_SHEET_NAME];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    result.osRows = rawRows
      .map(row => convertOsRow(row, file.name))
      .filter(isValidOsRow);
    result.messages.push(`OS ${result.osRows.length.toLocaleString()} row`);
  }

  if (!result.messages.length) {
    throw new Error(`${file.name}: '${ASSY_SHEET_NAME}' 또는 '${OS_SHEET_NAME}' sheet를 찾지 못했습니다.`);
  }

  return result;
}

async function handleFiles(files) {
  const excelFiles = Array.from(files || []).filter(file => /\.(xlsx|xls)$/i.test(file.name));

  if (!excelFiles.length) {
    log("Excel 파일(.xlsx/.xls)이 없습니다.");
    return;
  }

  selectedFiles = excelFiles;
  selectedAssyRows = [];
  selectedOsRows = [];
  renderSelectedFiles();
  renderMetrics();
  setBusy(true);

  try {
    for (const file of selectedFiles) {
      const parsed = await readReportFile(file);
      selectedAssyRows = selectedAssyRows.concat(parsed.assyRows);
      selectedOsRows = selectedOsRows.concat(parsed.osRows);
      log(`${file.name}: ${parsed.messages.join(" / ")}`);
    }
    renderMetrics();
    log(`파일 Read 완료: Assy ${selectedAssyRows.length.toLocaleString()} row, OS ${selectedOsRows.length.toLocaleString()} row`);

    if (db && currentUser) {
      await uploadSelectedToFirebase();
    } else {
      log("Firebase/Auth 준비 전이라 자동 Upload 보류. 연결 후 Retry Upload to Firebase를 눌러주세요.");
    }
  } catch (error) {
    log(`Excel Read Error: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function getCollectionRows(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
}

async function loadFirestoreData() {
  if (!db || !currentUser) return;

  setBusy(true);
  try {
    try {
      assyRows = await getCollectionRows(ASSY_COLLECTION);
      assyRows.sort((a, b) => {
        const sodCompare = String(a.sod || "").localeCompare(String(b.sod || ""));
        if (sodCompare !== 0) return sodCompare;
        return String(a.sckInputLotNo || "").localeCompare(String(b.sckInputLotNo || ""));
      });
      log(`Assy Firestore Load 완료: ${assyRows.length.toLocaleString()} row`);
    } catch (error) {
      assyRows = [];
      log(`Assy Firestore Load Error: ${error.message}`);
    }

    try {
      osRows = await getCollectionRows(OS_COLLECTION);
      osRows.sort((a, b) => {
        const dateCompare = String(a.inputDate || "").localeCompare(String(b.inputDate || ""));
        if (dateCompare !== 0) return dateCompare;
        return String(a.lotId || "").localeCompare(String(b.lotId || ""));
      });
      log(`OS Firestore Load 완료: ${osRows.length.toLocaleString()} row`);
    } catch (error) {
      osRows = [];
      log(`OS Firestore Load Error: ${error.message}`);
      log(`OS collection '${OS_COLLECTION}' rule이 없으면 README의 Rule 예시를 추가해주세요.`);
    }

    rebuildDerivedData();
    renderFirestoreViews();
  } finally {
    setBusy(false);
  }
}

function getLogicalDedupeKey(collectionName, row) {
  if (collectionName === OS_COLLECTION) return makeOsDedupeKey(row);
  if (collectionName === ASSY_COLLECTION) return makeAssyDedupeKey(row);
  return row.dedupeKey || row.id;
}

async function insertRowsToCollection(collectionName, rows, existingRows) {
  const existingKeys = new Set();
  for (const row of existingRows) {
    existingKeys.add(row.dedupeKey || row.id);
    existingKeys.add(getLogicalDedupeKey(collectionName, row));
  }

  const rowsToInsert = [];
  let skipped = 0;

  for (const row of rows) {
    const logicalKey = getLogicalDedupeKey(collectionName, row);
    if (existingKeys.has(row.dedupeKey) || existingKeys.has(logicalKey)) {
      skipped += 1;
      continue;
    }

    existingKeys.add(row.dedupeKey);
    existingKeys.add(logicalKey);
    rowsToInsert.push(row);
  }

  let inserted = 0;
  for (let i = 0; i < rowsToInsert.length; i += BATCH_LIMIT) {
    const chunk = rowsToInsert.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);

    for (const row of chunk) {
      const ref = doc(db, collectionName, row.dedupeKey);
      batch.set(ref, {
        ...row,
        uploadedAt: serverTimestamp(),
        uploadedAtClient: new Date().toISOString()
      });
    }

    await batch.commit();
    inserted += chunk.length;
  }

  return { inserted, skipped };
}

async function uploadSelectedToFirebase() {
  if (!db || !currentUser) {
    log("Firebase/Auth가 아직 준비되지 않았습니다.");
    return;
  }

  if (!selectedAssyRows.length && !selectedOsRows.length) {
    log("먼저 Excel report를 Drag & Drop 해주세요.");
    return;
  }

  setBusy(true);
  let totalInserted = 0;
  let totalSkipped = 0;

  try {
    if (selectedAssyRows.length) {
      const result = await insertRowsToCollection(ASSY_COLLECTION, selectedAssyRows, assyRows);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      log(`ASSY Upload: Insert ${result.inserted.toLocaleString()}, Duplicate Skip ${result.skipped.toLocaleString()}`);
    }

    if (selectedOsRows.length) {
      const result = await insertRowsToCollection(OS_COLLECTION, selectedOsRows, osRows);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      log(`OS Upload: Insert ${result.inserted.toLocaleString()}, Duplicate Skip ${result.skipped.toLocaleString()}`);
    }

    el.insertedRows.textContent = totalInserted.toLocaleString();
    el.skippedRows.textContent = totalSkipped.toLocaleString();
    log(`Upload 완료: Total Insert ${totalInserted.toLocaleString()}, Duplicate Skip ${totalSkipped.toLocaleString()}`);

    await loadFirestoreData();
  } catch (error) {
    log(`Upload Error: ${error.message}`);
    log("Firestore Rules / Anonymous Auth / collection name(yieldSummaryTapRaw, osComparisonRaw)을 확인해주세요.");
  } finally {
    setBusy(false);
  }
}

function rebuildDerivedData() {
  assyMergedRows = assyRows.map(row => ({
    ...row,
    lotBase: normalizeLotBase(row.lotBase || row.sckInputLotNo)
  }));
  sodSummaryRows = buildSodSummary(assyMergedRows);
  osTrendRows = buildOsTrendRows(osRows);
  defectTrendRows = buildDefectTrendRows(assyRows);
  uploadedFileRows = buildUploadedFileRows(assyRows, osRows);
}

function average(values) {
  const filtered = values.map(normalizeNumber).filter(value => value !== null);
  if (!filtered.length) return null;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

function aggregateOsRows(rows) {
  const item = {
    totalQty: 0,
    testQty: 0,
    osSs: null,
    totalOsRej: 0,
    openQty: 0,
    shortQty: 0,
    rows: 0,
    rejectRate: null,
    openRate: null,
    shortRate: null
  };

  const osSsValues = [];
  for (const row of rows) {
    item.totalQty += normalizeNumber(row.osInQty) || 0;
    item.testQty += normalizeNumber(row.testQty) || 0;
    item.totalOsRej += normalizeNumber(row.totalOsRej) || 0;
    item.openQty += normalizeNumber(row.openQty) || 0;
    item.shortQty += normalizeNumber(row.shortQty) || 0;
    item.rows += 1;
    if (normalizeNumber(row.osSs) !== null) osSsValues.push(row.osSs);
  }

  item.osSs = average(osSsValues);
  item.rejectRate = calculateRate(item.totalOsRej, item.testQty);
  item.openRate = calculateRate(item.openQty, item.testQty);
  item.shortRate = calculateRate(item.shortQty, item.testQty);
  return item;
}

function buildSodSummary(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const sod = normalizeText(row.sod) || "NO_SOD";
    if (!grouped.has(sod)) grouped.set(sod, []);
    grouped.get(sod).push(row);
  }

  return Array.from(grouped.entries()).map(([sod, items]) => {
    const sum = key => items.reduce((acc, item) => acc + (normalizeNumber(item[key]) || 0), 0);
    const avg = key => {
      const values = items.map(item => normalizeNumber(item[key])).filter(value => value !== null);
      if (!values.length) return null;
      return values.reduce((a, b) => a + b, 0) / values.length;
    };

    return {
      sod,
      rows: items.length,
      inQty: sum("inQty"),
      dbQty: sum("dbQty"),
      shipQtyK: sum("shipQtyK"),
      assyYieldAvg: avg("assyYield")
    };
  }).sort((a, b) => String(a.sod).localeCompare(String(b.sod)));
}

function buildOsTrendRows(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const inputDate = normalizeSod(row.inputDate) || "NO_DATE";
    if (!grouped.has(inputDate)) grouped.set(inputDate, []);
    grouped.get(inputDate).push(row);
  }

  return Array.from(grouped.entries()).map(([inputDate, items]) => {
    const agg = aggregateOsRows(items);
    return {
      inputDate,
      inputDateLabel: compactDateToLabel(inputDate),
      rows: items.length,
      totalQty: agg.totalQty,
      testQty: agg.testQty,
      osSs: agg.osSs,
      totalOsRej: agg.totalOsRej,
      openQty: agg.openQty,
      shortQty: agg.shortQty,
      rejectRate: agg.rejectRate,
      openRate: agg.openRate,
      shortRate: agg.shortRate
    };
  }).sort((a, b) => String(a.inputDate).localeCompare(String(b.inputDate)));
}

function buildUploadedFileRows(assyItems, osItems) {
  const grouped = new Map();

  function push(row, type) {
    const sourceFileName = normalizeText(row.sourceFileName) || "Unknown File";
    const key = `${type}__${sourceFileName}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        type,
        sourceFileName,
        rows: 0,
        dateSet: new Set(),
        latest: null
      });
    }

    const item = grouped.get(key);
    item.rows += 1;
    if (type === "ASSY" && row.sod) item.dateSet.add(compactDateToLabel(row.sod));
    if (type === "OS" && row.inputDate) item.dateSet.add(compactDateToLabel(row.inputDate));

    const date = getDateFromFirestoreValue(row.uploadedAt) || getDateFromFirestoreValue(row.uploadedAtClient);
    if (date && (!item.latest || date > item.latest)) item.latest = date;
  }

  assyItems.forEach(row => push(row, "ASSY"));
  osItems.forEach(row => push(row, "OS"));

  return Array.from(grouped.values())
    .map(item => ({
      ...item,
      dates: Array.from(item.dateSet).sort()
    }))
    .sort((a, b) => {
      if (a.latest && b.latest) return b.latest - a.latest;
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.sourceFileName.localeCompare(b.sourceFileName);
    });
}

function getDateFromFirestoreValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value instanceof Date) return value;
  return null;
}

function getDefectsFromRow(row) {
  const rowDefects = new Map();

  for (let i = 1; i <= 5; i += 1) {
    const defect = normalizeDefectName(row[`top${i}`]);
    const qty = normalizeNumber(row[`qty${i}`]) || 0;

    if (!defect || qty <= 0) continue;
    rowDefects.set(defect, (rowDefects.get(defect) || 0) + qty);
  }

  return rowDefects;
}

function buildDefectTrendRows(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const sod = normalizeText(row.sod) || "NO_SOD";
    const inQty = normalizeNumber(row.inQty) || 0;
    if (inQty <= 0) continue;

    const rowDefects = getDefectsFromRow(row);
    for (const [defect, qty] of rowDefects.entries()) {
      const key = `${sod}__${defect}`;
      if (!grouped.has(key)) {
        grouped.set(key, { sod, defect, defectQty: 0, inQty: 0, ppm: 0 });
      }

      const item = grouped.get(key);
      item.defectQty += qty;
      item.inQty += inQty;
    }
  }

  return Array.from(grouped.values())
    .map(item => ({
      ...item,
      ppm: item.inQty > 0 ? (item.defectQty / item.inQty) * 1_000_000 : null
    }))
    .sort((a, b) => {
      const sodCompare = String(a.sod).localeCompare(String(b.sod));
      if (sodCompare !== 0) return sodCompare;
      return (b.ppm || 0) - (a.ppm || 0);
    });
}

function getTopDefects(limitValue) {
  const totals = new Map();

  for (const item of defectTrendRows) {
    if (!totals.has(item.defect)) totals.set(item.defect, { defect: item.defect, qty: 0, inQty: 0 });
    const total = totals.get(item.defect);
    total.qty += item.defectQty || 0;
    total.inQty += item.inQty || 0;
  }

  let defects = Array.from(totals.values())
    .sort((a, b) => b.qty - a.qty)
    .map(item => item.defect);

  if (limitValue !== "all") {
    defects = defects.slice(0, Number(limitValue));
  }

  return defects;
}

function renderSelectedFiles() {
  if (!selectedFiles.length) {
    el.selectedFileList.innerHTML = `<li class="empty-li">선택된 파일이 없습니다.</li>`;
    return;
  }

  el.selectedFileList.innerHTML = selectedFiles.map(file => `
    <li>
      <span>${escapeHtml(file.name)}</span>
      <small>${formatBytes(file.size)}</small>
    </li>
  `).join("");
}

function renderFirestoreViews() {
  renderMetrics();
  renderUploadedFileTable();
  renderYieldTrendChart();
  renderOsTrendChart();
  renderOsTrendTable();
  renderDefectTrendChart();
  renderDefectPpmTable();
  renderAssyRawTable();
  renderOsRawTable();
}

function renderMetrics() {
  el.selectedAssyRows.textContent = selectedAssyRows.length.toLocaleString();
  el.selectedOsRows.textContent = selectedOsRows.length.toLocaleString();
  el.firestoreAssyRows.textContent = assyRows.length.toLocaleString();
  el.firestoreOsRows.textContent = osRows.length.toLocaleString();
  el.uploadedFiles.textContent = uploadedFileRows.length.toLocaleString();
}

function renderUploadedFileTable() {
  if (!uploadedFileRows.length) {
    el.uploadedFilesBody.innerHTML = `<tr><td colspan="5" class="empty">아직 Upload된 파일이 없습니다.</td></tr>`;
    return;
  }

  el.uploadedFilesBody.innerHTML = uploadedFileRows.map(row => `
    <tr>
      <td><span class="type-pill ${row.type.toLowerCase()}">${escapeHtml(row.type)}</span></td>
      <td>${escapeHtml(row.sourceFileName)}</td>
      <td>${formatNumber(row.rows)}</td>
      <td>${escapeHtml(row.dates.join(", "))}</td>
      <td>${row.latest ? escapeHtml(formatDateTime(row.latest)) : ""}</td>
    </tr>
  `).join("");
}

function renderYieldTrendChart() {
  const labels = sodSummaryRows.map(row => compactDateToLabel(row.sod));

  if (yieldTrendChart) yieldTrendChart.destroy();

  yieldTrendChart = new Chart(el.yieldTrendChart, {
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Assy Yield Avg",
          data: sodSummaryRows.map(row => roundOrNull(row.assyYieldAvg, 3)),
          yAxisID: "rateAxis",
          tension: 0.2,
          spanGaps: true
        },
        {
          type: "bar",
          label: "In Qty",
          data: sodSummaryRows.map(row => row.inQty),
          yAxisID: "qtyAxis"
        },
        {
          type: "bar",
          label: "Ship Qty(K)",
          data: sodSummaryRows.map(row => row.shipQtyK),
          yAxisID: "qtyAxis"
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        rateAxis: {
          type: "linear",
          position: "left",
          ticks: { callback: value => `${value}%` },
          title: { display: true, text: "Assy Yield (%)" }
        },
        qtyAxis: {
          type: "linear",
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Qty" }
        }
      },
      plugins: { legend: { position: "bottom" } }
    }
  });
}

function renderOsTrendChart() {
  const labels = osTrendRows.map(row => row.inputDateLabel);

  if (osTrendChart) osTrendChart.destroy();

  osTrendChart = new Chart(el.osTrendChart, {
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Reject Rate",
          data: osTrendRows.map(row => roundOrNull(row.rejectRate, 4)),
          yAxisID: "rateAxis",
          tension: 0.2,
          spanGaps: true
        },
        {
          type: "line",
          label: "Open Rate",
          data: osTrendRows.map(row => roundOrNull(row.openRate, 4)),
          yAxisID: "rateAxis",
          tension: 0.2,
          spanGaps: true
        },
        {
          type: "line",
          label: "Short Rate",
          data: osTrendRows.map(row => roundOrNull(row.shortRate, 4)),
          yAxisID: "rateAxis",
          tension: 0.2,
          spanGaps: true
        },
        {
          type: "bar",
          label: "TOTAL_QTY",
          data: osTrendRows.map(row => row.totalQty),
          yAxisID: "qtyAxis"
        },
        {
          type: "bar",
          label: "TEST_QTY",
          data: osTrendRows.map(row => row.testQty),
          yAxisID: "qtyAxis"
        },
        {
          type: "bar",
          label: "OPEN",
          data: osTrendRows.map(row => row.openQty),
          yAxisID: "qtyAxis"
        },
        {
          type: "bar",
          label: "SHORT",
          data: osTrendRows.map(row => row.shortQty),
          yAxisID: "qtyAxis"
        },
        {
          type: "bar",
          label: "TOTAL_OS_REJ",
          data: osTrendRows.map(row => row.totalOsRej),
          yAxisID: "qtyAxis"
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        rateAxis: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          ticks: { callback: value => `${value}%` },
          title: { display: true, text: "Rate (%)" }
        },
        qtyAxis: {
          type: "linear",
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Qty" }
        }
      },
      plugins: { legend: { position: "bottom" } }
    }
  });
}

function renderDefectTrendChart() {
  const labels = Array.from(new Set(defectTrendRows.map(row => row.sod))).sort().map(compactDateToLabel);
  const sodKeys = Array.from(new Set(defectTrendRows.map(row => row.sod))).sort();
  const selectedDefects = getTopDefects(el.defectLimitSelect.value);

  const datasets = selectedDefects.map(defect => ({
    type: "line",
    label: defect,
    data: sodKeys.map(sod => {
      const found = defectTrendRows.find(row => row.sod === sod && row.defect === defect);
      return found ? Number(found.ppm.toFixed(2)) : null;
    }),
    tension: 0.2,
    spanGaps: true
  }));

  if (defectTrendChart) defectTrendChart.destroy();

  defectTrendChart = new Chart(el.defectTrendChart, {
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          title: { display: true, text: "PPM" },
          beginAtZero: true
        }
      },
      plugins: {
        legend: { position: "bottom" }
      }
    }
  });
}

function renderDefectPpmTable() {
  if (!defectTrendRows.length) {
    el.defectPpmBody.innerHTML = `<tr><td colspan="5" class="empty">아직 Defect Trend Data가 없습니다.</td></tr>`;
    return;
  }

  el.defectPpmBody.innerHTML = defectTrendRows.map(row => `
    <tr>
      <td>${escapeHtml(compactDateToLabel(row.sod))}</td>
      <td>${escapeHtml(row.defect)}</td>
      <td>${formatNumber(row.defectQty)}</td>
      <td>${formatNumber(row.inQty)}</td>
      <td>${formatPpm(row.ppm)}</td>
    </tr>
  `).join("");
}

function renderAssyRawTable() {
  if (!assyMergedRows.length) {
    el.assyRawBody.innerHTML = `<tr><td colspan="21" class="empty">아직 Firestore Assy Data가 없습니다.</td></tr>`;
    return;
  }

  el.assyRawBody.innerHTML = assyMergedRows.map(row => `
    <tr>
      <td>${escapeHtml(compactDateToLabel(row.sod))}</td>
      <td>${escapeHtml(row.project)}</td>
      <td>${escapeHtml(row.device)}</td>
      <td>${escapeHtml(row.stage)}</td>
      <td>${escapeHtml(row.sckInputLotNo)}</td>
      <td>${escapeHtml(row.lotBase)}</td>
      <td>${formatNumber(row.inQty)}</td>
      <td>${formatNumber(row.shipQtyK)}</td>
      <td>${formatYield(row.assyYield)}</td>
      <td>${escapeHtml(row.top1)}</td><td>${formatNumber(row.qty1)}</td>
      <td>${escapeHtml(row.top2)}</td><td>${formatNumber(row.qty2)}</td>
      <td>${escapeHtml(row.top3)}</td><td>${formatNumber(row.qty3)}</td>
      <td>${escapeHtml(row.top4)}</td><td>${formatNumber(row.qty4)}</td>
      <td>${escapeHtml(row.top5)}</td><td>${formatNumber(row.qty5)}</td>
      <td>${escapeHtml(row.sourceFileName)}</td>
    </tr>
  `).join("");
}

function renderOsTrendTable() {
  if (!osTrendRows.length) {
    el.osTrendBody.innerHTML = `<tr><td colspan="11" class="empty">아직 OS Trend Data가 없습니다.</td></tr>`;
    return;
  }

  el.osTrendBody.innerHTML = osTrendRows.map(row => `
    <tr>
      <td>${escapeHtml(row.inputDateLabel)}</td>
      <td>${formatNumber(row.rows)}</td>
      <td>${formatNumber(row.totalQty)}</td>
      <td>${formatNumber(row.testQty)}</td>
      <td>${roundOrNull(row.osSs, 4) ?? ""}</td>
      <td>${formatNumber(row.totalOsRej)}</td>
      <td>${formatNumber(row.openQty)}</td>
      <td>${formatNumber(row.shortQty)}</td>
      <td>${formatRate(row.rejectRate)}</td>
      <td>${formatRate(row.openRate)}</td>
      <td>${formatRate(row.shortRate)}</td>
    </tr>
  `).join("");
}

function renderOsRawTable() {
  if (!osRows.length) {
    el.osRawBody.innerHTML = `<tr><td colspan="17" class="empty">아직 Firestore OS Data가 없습니다.</td></tr>`;
    return;
  }

  el.osRawBody.innerHTML = osRows.map(row => `
    <tr>
      <td>${escapeHtml(compactDateToLabel(row.inputDate))}</td>
      <td>${escapeHtml(row.lotId)}</td>
      <td>${escapeHtml(row.lotBase)}</td>
      <td>${escapeHtml(row.customer)}</td>
      <td>${escapeHtml(row.device)}</td>
      <td>${formatNumber(row.osInQty)}</td>
      <td>${formatNumber(row.testQty)}</td>
      <td>${roundOrNull(row.osSs, 4) ?? ""}</td>
      <td>${formatNumber(row.totalOsRej)}</td>
      <td>${formatNumber(row.openQty)}</td>
      <td>${formatNumber(row.shortQty)}</td>
      <td>${formatRate(row.rejectRate)}</td>
      <td>${formatRate(row.openRate)}</td>
      <td>${formatRate(row.shortRate)}</td>
      <td>${escapeHtml(row.inputTime)}</td>
      <td>${escapeHtml(row.sourceFileName)}</td>
      <td>${escapeHtml(row.dedupeKey)}</td>
    </tr>
  `).join("");
}

function roundOrNull(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  return Number(value).toLocaleString();
}

function formatYield(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  return `${Number(value).toFixed(2)}%`;
}

function formatRate(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  return `${Number(value).toFixed(4)}%`;
}

function formatPpm(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(date) {
  return date.toLocaleString();
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function exportAssyReport() {
  if (!assyMergedRows.length) {
    log("Export할 Assy Data가 없습니다.");
    return;
  }

  const workbook = XLSX.utils.book_new();

  const sodSheetRows = sodSummaryRows.map(row => ({
    SOD: compactDateToLabel(row.sod),
    "Assy Rows": row.rows,
    "Assy In Qty": row.inQty,
    "Ship Qty(K)": row.shipQtyK,
    "Assy Yield Avg(%)": roundOrNull(row.assyYieldAvg, 4)
  }));

  const rawSheetRows = assyMergedRows.map(row => ({
    SOD: compactDateToLabel(row.sod),
    Project: row.project,
    Device: row.device,
    Stage: row.stage,
    "SCK input Lot No": row.sckInputLotNo,
    "Lot Base": row.lotBase,
    "In Qty": row.inQty,
    "DB Qty": row.dbQty,
    "Ship Qty(K)": row.shipQtyK,
    "Assy Yield(%)": row.assyYield,
    TOP1: row.top1,
    QTY1: row.qty1,
    TOP2: row.top2,
    QTY2: row.qty2,
    TOP3: row.top3,
    QTY3: row.qty3,
    TOP4: row.top4,
    QTY4: row.qty4,
    TOP5: row.top5,
    QTY5: row.qty5,
    "Source File": row.sourceFileName
  }));

  const defectSheetRows = defectTrendRows.map(row => ({
    SOD: compactDateToLabel(row.sod),
    Defect: row.defect,
    "Defect Qty": row.defectQty,
    "In Qty": row.inQty,
    PPM: roundOrNull(row.ppm, 4)
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sodSheetRows), "Assy_SOD_Trend");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawSheetRows), "Assy_Lot_Raw");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(defectSheetRows), "Defect_PPM");
  XLSX.writeFile(workbook, `MTK_Assy_SOD_Trend_${todayStamp()}.xlsx`);
  log("Assy SOD Report Export 완료");
}

function exportOsReport() {
  if (!osRows.length) {
    log("Export할 OS Data가 없습니다.");
    return;
  }

  const workbook = XLSX.utils.book_new();

  const trendSheetRows = osTrendRows.map(row => ({
    INPUT_TIME: row.inputDateLabel,
    Rows: row.rows,
    TOTAL_QTY: row.totalQty,
    TEST_QTY: row.testQty,
    OS_SS: roundOrNull(row.osSs, 6),
    TOTAL_OS_REJ: row.totalOsRej,
    OPEN: row.openQty,
    SHORT: row.shortQty,
    "REJECT_RATE(%)": roundOrNull(row.rejectRate, 6),
    "OPEN_RATE(%)": roundOrNull(row.openRate, 6),
    "SHORT_RATE(%)": roundOrNull(row.shortRate, 6)
  }));

  const rawSheetRows = osRows.map(row => ({
    "In Date": compactDateToLabel(row.inputDate),
    LOT_ID: row.lotId,
    "Lot Base": row.lotBase,
    Customer: row.customer,
    Device: row.device,
    Lead: row.lead,
    "PCB Vendor": row.pcbVendor,
    TOTAL_QTY: row.osInQty,
    TEST_QTY: row.testQty,
    OS_SS: row.osSs,
    TOTAL_OS_REJ: row.totalOsRej,
    OPEN: row.openQty,
    SHORT: row.shortQty,
    "REJECT_RATE(%)": roundOrNull(row.rejectRate, 6),
    "OPEN_RATE(%)": roundOrNull(row.openRate, 6),
    "SHORT_RATE(%)": roundOrNull(row.shortRate, 6),
    INPUT_TIME: row.inputTime,
    "Source File": row.sourceFileName,
    "Dedupe Key": row.dedupeKey
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(trendSheetRows), "OS_INPUT_TIME_Trend");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawSheetRows), "OS_Raw");
  XLSX.writeFile(workbook, `MTK_OS_INPUT_TIME_Trend_${todayStamp()}.xlsx`);
  log("OS Report Export 완료");
}

function clearSelection() {
  selectedFiles = [];
  selectedAssyRows = [];
  selectedOsRows = [];
  el.excelFiles.value = "";
  el.insertedRows.textContent = "0";
  el.skippedRows.textContent = "0";
  renderSelectedFiles();
  renderMetrics();
  log("선택 파일 Clear 완료. Firestore Data는 삭제되지 않습니다.");
}

function setupEvents() {
  el.dropZone.addEventListener("click", () => el.excelFiles.click());
  el.dropZone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      el.excelFiles.click();
    }
  });

  el.excelFiles.addEventListener("change", event => {
    handleFiles(event.target.files);
  });

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

  el.dropZone.addEventListener("drop", event => {
    handleFiles(event.dataTransfer.files);
  });

  el.uploadBtn.addEventListener("click", uploadSelectedToFirebase);
  el.refreshBtn.addEventListener("click", loadFirestoreData);
  el.clearSelectionBtn.addEventListener("click", clearSelection);
  el.defectLimitSelect.addEventListener("change", renderDefectTrendChart);
  el.exportAssyBtn.addEventListener("click", exportAssyReport);
  el.exportOsBtn.addEventListener("click", exportOsReport);
}

setupEvents();
renderSelectedFiles();
renderMetrics();
initFirebase();
