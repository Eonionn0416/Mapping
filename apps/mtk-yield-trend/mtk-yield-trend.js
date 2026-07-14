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
const BIN_SHEET_NAME = "MTK BIN INFORMATION";
const ASSY_COLLECTION = "yieldSummaryTapRaw";
const OS_COLLECTION = "osComparisonRaw";
const BIN_COLLECTION = "binInformationRaw";
const BIN_COLUMNS = [
  { key: "bin1", label: "BIN1", header: "BIN1" },
  { key: "bin2", label: "BIN2", header: "BIN2" },
  { key: "bin3", label: "BIN3", header: "BIN3" },
  { key: "bin4", label: "BIN4", header: "BIN4" },
  { key: "bin5", label: "BIN5", header: "BIN5" },
  { key: "bin6", label: "BIN6", header: "BIN6" },
  { key: "bin36", label: "BIN36", header: "BIN36" }
];
const BIN_REQUIRED_HEADERS = ["CUST_ID", "PKG_ID", "LEAD_ID", "CUST_DEVICE", "NICK_NAME", "LOT_ID", "CUST_RUN_ID", "SUBSTRATE_VENDOR", "IN_QTY", "OUT_QTY", "FINAL YIELD", "BIN1", "BIN2", "BIN3", "BIN4", "BIN5", "BIN6", "BIN36"];
const BATCH_LIMIT = 450;
const ASSY_YIELD_LSL = 98.5;
const OS_RATE_USL = 0.3;

let app = null;
let db = null;
let auth = null;
let currentUser = null;

let selectedFiles = [];
let selectedAssyRows = [];
let selectedOsRows = [];
let selectedBinRows = [];

let assyRows = [];
let osRows = [];
let binRows = [];
let uploadedFileRows = [];
let osByLotBase = new Map();
let assyMergedRows = [];
let sodSummaryRows = [];
let osTrendRows = [];
let defectTrendRows = [];
let binTrendRows = [];
let trendStartMonth = "";

let yieldTrendCharts = [];
let osTrendCharts = [];
let defectTrendCharts = [];
let binTrendChart = null;

const el = {
  firebaseStatus: document.getElementById("firebaseStatus"),
  authStatus: document.getElementById("authStatus"),
  dropZone: document.getElementById("dropZone"),
  excelFiles: document.getElementById("excelFiles"),
  selectedFileList: document.getElementById("selectedFileList"),
  selectedAssyRows: document.getElementById("selectedAssyRows"),
  selectedOsRows: document.getElementById("selectedOsRows"),
  selectedBinRows: document.getElementById("selectedBinRows"),
  insertedRows: document.getElementById("insertedRows"),
  skippedRows: document.getElementById("skippedRows"),
  firestoreAssyRows: document.getElementById("firestoreAssyRows"),
  firestoreOsRows: document.getElementById("firestoreOsRows"),
  firestoreBinRows: document.getElementById("firestoreBinRows"),
  uploadedFiles: document.getElementById("uploadedFiles"),
  uploadedFilesBody: document.getElementById("uploadedFilesBody"),
  yieldTrendCharts: document.getElementById("yieldTrendCharts"),
  osTrendCharts: document.getElementById("osTrendCharts"),
  defectTrendCharts: document.getElementById("defectTrendCharts"),
  binTrendChart: document.getElementById("binTrendChart"),
  defectLimitSelect: document.getElementById("defectLimitSelect"),
  trendStartMonthSelect: document.getElementById("trendStartMonthSelect"),
  binChartModeSelect: document.getElementById("binChartModeSelect"),
  defectPpmBody: document.getElementById("defectPpmBody"),
  assyRawBody: document.getElementById("assyRawBody"),
  osTrendBody: document.getElementById("osTrendBody"),
  binTrendBody: document.getElementById("binTrendBody"),
  osRawBody: document.getElementById("osRawBody"),
  exportAssyBtn: document.getElementById("exportAssyBtn"),
  exportOsBtn: document.getElementById("exportOsBtn"),
  exportBinBtn: document.getElementById("exportBinBtn"),
  log: document.getElementById("log")
};

function log(message) {
  const time = new Date().toLocaleTimeString();
  if (el.log) el.log.textContent = `[${time}] ${message}\n` + el.log.textContent;
  else console.log(`[${time}] ${message}`);
}

function setFirebaseStatus(text, type = "warning") {
  el.firebaseStatus.textContent = text;
  el.firebaseStatus.classList.remove("warning", "success", "danger");
  el.firebaseStatus.classList.add(type);
}

function setBusy(isBusy) {
  const hasSelectedRows = selectedAssyRows.length > 0 || selectedOsRows.length > 0 || selectedBinRows.length > 0;
  if (el.exportAssyBtn) el.exportAssyBtn.disabled = isBusy || !assyRows.length;
  if (el.exportOsBtn) el.exportOsBtn.disabled = isBusy || !osRows.length;
  if (el.exportBinBtn) el.exportBinBtn.disabled = isBusy || !binRows.length;
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

function compactDateToMonth(value) {
  const raw = normalizeText(value);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  const match = raw.match(/(20\d{2})[-/.]?(0?[1-9]|1[0-2])/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}`;
  return "";
}

function isValidDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function makeDateKey(year, month, day) {
  if (!isValidDateParts(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeReportDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return makeDateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  const raw = normalizeText(value);
  if (!raw) return "";

  const exact = raw.match(/(?:^|[^0-9])(20\d{2})[-_. /]?(0[1-9]|1[0-2])[-_. /]?([0-3]\d)(?:[^0-9]|$)/);
  if (exact) return makeDateKey(exact[1], exact[2], exact[3]);

  const dashed = raw.match(/(?:^|[^0-9])(20\d{2})[-_. /](0?[1-9]|1[0-2])[-_. /](\d{1,2})(?:[^0-9]|$)/);
  if (dashed) return makeDateKey(dashed[1], dashed[2], dashed[3]);

  return "";
}

function normalizeReportMonth(value) {
  const raw = normalizeText(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;

  const ymd = raw.match(/(20\d{2})[-_. ]?(0?[1-9]|1[0-2])[-_. ]?(\d{1,2})?/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}`;

  const monthMap = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };
  const mon = raw.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[' _.-]*(\d{2,4})/i);
  if (mon) {
    const yy = mon[2].length === 2 ? `20${mon[2]}` : mon[2];
    return `${yy}-${monthMap[mon[1].slice(0, 3).toLowerCase()]}`;
  }

  return "";
}

function getWeekStartDateKey(dateKey) {
  const normalized = normalizeReportDate(dateKey);
  if (!normalized) return "";
  const [yyyy, mm, dd] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return makeDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function reportWeekLabel(weekKey) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(weekKey || "")) return `${weekKey} Wk`;
  if (/^\d{4}-\d{2}$/.test(weekKey || "")) return `${monthLabel(weekKey)} (Monthly)`;
  return weekKey || "";
}

function getReportDateFromFile(file) {
  const byName = normalizeReportDate(file?.name || "");
  if (byName) return byName;

  if (file?.lastModified) {
    const date = new Date(file.lastModified);
    if (!Number.isNaN(date.getTime())) return makeDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  return "";
}

function getReportMonthFromFile(file) {
  const reportDate = getReportDateFromFile(file);
  if (reportDate) return reportDate.slice(0, 7);

  const byName = normalizeReportMonth(file?.name || "");
  if (byName) return byName;

  if (file?.lastModified) {
    const date = new Date(file.lastModified);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }
  }

  return "NO_MONTH";
}

function monthToIndex(month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return null;
  const [yyyy, mm] = month.split("-").map(Number);
  return yyyy * 12 + (mm - 1);
}

function addMonths(month, count) {
  const idx = monthToIndex(month);
  if (idx === null) return "";
  const next = idx + count;
  const yyyy = Math.floor(next / 12);
  const mm = (next % 12) + 1;
  return `${yyyy}-${String(mm).padStart(2, "0")}`;
}

function monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return month || "";
  const [yyyy, mm] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${yyyy} ${names[Number(mm) - 1]}`;
}

function isMonthInTrendWindow(month) {
  if (!trendStartMonth) return true;
  const idx = monthToIndex(month);
  const start = monthToIndex(trendStartMonth);
  const end = monthToIndex(addMonths(trendStartMonth, 12));
  if (idx === null || start === null || end === null) return true;
  return idx >= start && idx <= end;
}

function isCompactDateInTrendWindow(value) {
  const month = compactDateToMonth(value);
  return isMonthInTrendWindow(month);
}

function getAvailableTrendMonths() {
  const months = new Set();
  assyRows.forEach(row => {
    const month = compactDateToMonth(row.sod);
    if (month) months.add(month);
  });
  osRows.forEach(row => {
    const month = compactDateToMonth(row.inputDate);
    if (month) months.add(month);
  });
  binRows.forEach(row => {
    const month = normalizeReportMonth(row.reportDate) || normalizeReportMonth(getBinReportWeek(row)) || normalizeReportMonth(row.reportMonth);
    if (month) months.add(month);
  });
  return Array.from(months).sort();
}

function refreshTrendMonthOptions() {
  if (!el.trendStartMonthSelect) return;
  const months = getAvailableTrendMonths();
  const previous = el.trendStartMonthSelect.value || trendStartMonth;

  if (!months.length) {
    trendStartMonth = "";
    el.trendStartMonthSelect.innerHTML = `<option value="">No data</option>`;
    return;
  }

  el.trendStartMonthSelect.innerHTML = months
    .map(month => `<option value="${escapeHtml(month)}">${escapeHtml(monthLabel(month))} ~ ${escapeHtml(monthLabel(addMonths(month, 12)))}</option>`)
    .join("");

  if (previous && months.includes(previous)) {
    trendStartMonth = previous;
  } else {
    trendStartMonth = months[Math.max(0, months.length - 12)];
  }

  el.trendStartMonthSelect.value = trendStartMonth;
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

function getBinReportWeek(row) {
  const storedWeek = normalizeReportDate(row?.reportWeek);
  if (storedWeek) return getWeekStartDateKey(storedWeek);

  const reportDate = normalizeReportDate(row?.reportDate) || normalizeReportDate(row?.sourceFileName);
  if (reportDate) return getWeekStartDateKey(reportDate);

  const reportMonth = normalizeReportMonth(row?.reportMonth);
  return reportMonth || "NO_WEEK";
}

function getBinReportWeekLabel(row) {
  return reportWeekLabel(getBinReportWeek(row));
}

function getBinReportPeriodKey(row) {
  return getBinReportWeek(row) || normalizeReportMonth(row?.reportMonth) || "NO_WEEK";
}

function makeBinDedupeKey(row) {
  const keyParts = [
    "BIN",
    getBinReportPeriodKey(row),
    row.custId,
    row.pkgId,
    row.leadId,
    row.custDevice,
    row.lotId,
    row.custRunId,
    row.substrateVendor,
    normalizeNumber(row.inQty),
    normalizeNumber(row.outQty)
  ];
  return safeDocId(keyParts.map(part => normalizeText(part)).join("__"));
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

function convertBinRow(rawRow, fileName, reportMonth, reportDate) {
  const reportWeek = reportDate ? getWeekStartDateKey(reportDate) : reportMonth;
  const row = {
    sourceType: "BIN",
    reportMonth,
    reportDate,
    reportWeek,
    custId: normalizeText(rawRow["CUST_ID"]),
    pkgId: normalizeText(rawRow["PKG_ID"]),
    leadId: normalizeText(rawRow["LEAD_ID"]),
    custDevice: normalizeText(rawRow["CUST_DEVICE"]),
    nickName: normalizeText(rawRow["NICK_NAME"]),
    lotId: normalizeText(rawRow["LOT_ID"]),
    custRunId: normalizeText(rawRow["CUST_RUN_ID"]),
    substrateVendor: normalizeText(rawRow["SUBSTRATE_VENDOR"]),
    inQty: normalizeNumber(rawRow["IN_QTY"]),
    outQty: normalizeNumber(rawRow["OUT_QTY"]),
    finalYield: normalizeNumber(rawRow["FINAL YIELD"]),
    bin1: normalizeNumber(rawRow["BIN1"]),
    bin2: normalizeNumber(rawRow["BIN2"]),
    bin3: normalizeNumber(rawRow["BIN3"]),
    bin4: normalizeNumber(rawRow["BIN4"]),
    bin5: normalizeNumber(rawRow["BIN5"]),
    bin6: normalizeNumber(rawRow["BIN6"]),
    bin36: normalizeNumber(rawRow["BIN36"]),
    sourceFileName: fileName
  };

  row.reportMonthLabel = monthLabel(row.reportMonth);
  row.reportWeekLabel = getBinReportWeekLabel(row);
  row.lotBase = normalizeLotBase(row.lotId);
  row.dedupeKey = makeBinDedupeKey(row);
  return row;
}

function hasAllHeaders(row, headers) {
  if (!row) return false;
  const keys = new Set(Object.keys(row).map(key => normalizeText(key).toUpperCase()));
  return headers.every(header => keys.has(header.toUpperCase()));
}

function findSheetRowsByHeaders(workbook, preferredSheetName, requiredHeaders) {
  const sheetNames = workbook.SheetNames || [];
  const candidates = [preferredSheetName, ...sheetNames.filter(name => name !== preferredSheetName)].filter(Boolean);

  for (const sheetName of candidates) {
    if (!sheetNames.includes(sheetName)) continue;
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (!rawRows.length) continue;
    if (hasAllHeaders(rawRows[0], requiredHeaders)) return { sheetName, rawRows };
  }

  return { sheetName: "", rawRows: [] };
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

function isValidBinRow(row) {
  return Boolean(row.reportMonth && row.reportMonth !== "NO_MONTH" && row.lotId && row.inQty !== null && row.dedupeKey);
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
    if (selectedAssyRows.length || selectedOsRows.length || selectedBinRows.length) {
      log("대기 중이던 선택 파일을 자동 Upload 합니다.");
      await uploadSelectedToFirebase();
    }
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
  const result = { assyRows: [], osRows: [], binRows: [], messages: [] };

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


  const binSheet = findSheetRowsByHeaders(workbook, BIN_SHEET_NAME, BIN_REQUIRED_HEADERS);
  if (binSheet.rawRows.length) {
    const reportDate = getReportDateFromFile(file);
    const reportMonth = getReportMonthFromFile(file);
    const reportWeek = reportDate ? getWeekStartDateKey(reportDate) : reportMonth;
    result.binRows = binSheet.rawRows
      .map(row => convertBinRow(row, file.name, reportMonth, reportDate))
      .filter(isValidBinRow);
    result.messages.push(`BIN ${result.binRows.length.toLocaleString()} row · ${reportWeekLabel(reportWeek)} · ${binSheet.sheetName}`);
  }

  if (!result.messages.length) {
    throw new Error(`${file.name}: '${ASSY_SHEET_NAME}', '${OS_SHEET_NAME}' 또는 '${BIN_SHEET_NAME}' sheet/header를 찾지 못했습니다.`);
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
  selectedBinRows = [];
  renderSelectedFiles();
  renderMetrics();
  setBusy(true);

  try {
    for (const file of selectedFiles) {
      const parsed = await readReportFile(file);
      selectedAssyRows = selectedAssyRows.concat(parsed.assyRows);
      selectedOsRows = selectedOsRows.concat(parsed.osRows);
      selectedBinRows = selectedBinRows.concat(parsed.binRows);
      log(`${file.name}: ${parsed.messages.join(" / ")}`);
    }
    renderMetrics();
    log(`파일 Read 완료: Assy ${selectedAssyRows.length.toLocaleString()} row, OS ${selectedOsRows.length.toLocaleString()} row, BIN ${selectedBinRows.length.toLocaleString()} row`);

    if (db && currentUser) {
      await uploadSelectedToFirebase();
    } else {
      log("Firebase/Auth 준비 전이라 자동 Upload 대기 상태로 유지합니다. 연결되면 자동으로 Upload 됩니다.");
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

    try {
      binRows = await getCollectionRows(BIN_COLLECTION);
      binRows.sort((a, b) => {
        const weekCompare = String(getBinReportWeek(a) || "").localeCompare(String(getBinReportWeek(b) || ""));
        if (weekCompare !== 0) return weekCompare;
        return String(a.lotId || "").localeCompare(String(b.lotId || ""));
      });
      log(`BIN Firestore Load 완료: ${binRows.length.toLocaleString()} row`);
    } catch (error) {
      binRows = [];
      log(`BIN Firestore Load Error: ${error.message}`);
      log(`BIN collection '${BIN_COLLECTION}' rule이 없으면 README의 Rule 예시를 추가해주세요.`);
    }

    rebuildDerivedData();
    renderFirestoreViews();
  } finally {
    setBusy(false);
  }
}

function getLogicalDedupeKey(collectionName, row) {
  if (collectionName === OS_COLLECTION) return makeOsDedupeKey(row);
  if (collectionName === BIN_COLLECTION) return makeBinDedupeKey(row);
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

  if (!selectedAssyRows.length && !selectedOsRows.length && !selectedBinRows.length) {
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

    if (selectedBinRows.length) {
      const result = await insertRowsToCollection(BIN_COLLECTION, selectedBinRows, binRows);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      log(`BIN Upload: Insert ${result.inserted.toLocaleString()}, Duplicate Skip ${result.skipped.toLocaleString()}`);
    }

    el.insertedRows.textContent = totalInserted.toLocaleString();
    el.skippedRows.textContent = totalSkipped.toLocaleString();
    log(`Upload 완료: Total Insert ${totalInserted.toLocaleString()}, Duplicate Skip ${totalSkipped.toLocaleString()}`);

    await loadFirestoreData();
  } catch (error) {
    log(`Upload Error: ${error.message}`);
    log("Firestore Rules / Anonymous Auth / collection name(yieldSummaryTapRaw, osComparisonRaw, binInformationRaw)을 확인해주세요.");
  } finally {
    setBusy(false);
  }
}

function rebuildDerivedData() {
  const leadLookup = buildLeadLookup();
  assyMergedRows = assyRows.map(row => {
    const lotBase = normalizeLotBase(row.lotBase || row.sckInputLotNo);
    return {
      ...row,
      lotBase,
      lead: normalizeText(row.lead) || leadLookup.get(lotBase) || "Unknown Lead"
    };
  });

  uploadedFileRows = buildUploadedFileRows(assyRows, osRows, binRows);
  refreshTrendMonthOptions();

  const windowAssyRows = getWindowAssyRows();
  const windowOsRows = getWindowOsRows();
  const windowBinRows = binRows.filter(row => isMonthInTrendWindow(normalizeReportMonth(getBinReportWeek(row)) || normalizeReportMonth(row.reportMonth)));

  sodSummaryRows = buildSodSummary(windowAssyRows);
  osTrendRows = buildOsTrendRows(windowOsRows);
  defectTrendRows = buildDefectTrendRows(windowAssyRows);
  binTrendRows = buildBinTrendRows(windowBinRows);
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


function uniqueSorted(values) {
  return Array.from(new Set(values.map(value => normalizeText(value)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function fallbackGroupName(value, fallback) {
  const text = normalizeText(value);
  return text || fallback;
}

function getWindowAssyRows() {
  return assyMergedRows.filter(row => isCompactDateInTrendWindow(row.sod));
}

function getWindowOsRows() {
  return osRows.filter(row => isCompactDateInTrendWindow(row.inputDate));
}

function buildLeadLookup(assyLeadSources = []) {
  const grouped = new Map();
  const add = (lotBase, leadValue) => {
    const lot = normalizeLotBase(lotBase);
    const lead = normalizeText(leadValue);
    if (!lot || !lead) return;
    if (!grouped.has(lot)) grouped.set(lot, new Map());
    const counter = grouped.get(lot);
    counter.set(lead, (counter.get(lead) || 0) + 1);
  };

  for (const row of osRows) add(row.lotBase || row.lotId, row.lead);
  for (const row of binRows) add(row.lotBase || row.lotId, row.leadId);
  for (const row of assyLeadSources) add(row.lotBase || row.sckInputLotNo, row.lead);

  const lookup = new Map();
  for (const [lot, counter] of grouped.entries()) {
    const [lead] = Array.from(counter.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [];
    if (lead) lookup.set(lot, lead);
  }
  return lookup;
}

function makeChartCard(container, title, height = 320) {
  const card = document.createElement("div");
  card.className = "chart-card";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const canvas = document.createElement("canvas");
  canvas.height = height;
  canvas.style.height = `${height}px`;
  card.appendChild(heading);
  card.appendChild(canvas);
  container.appendChild(card);
  return canvas;
}

function destroyChartList(charts) {
  charts.forEach(chart => chart.destroy());
  charts.length = 0;
}

function renderEmptyChartContainer(container, message) {
  if (!container) return;
  container.innerHTML = `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function renderChartCollection(container, chartList, groups, chartFactory, emptyMessage) {
  if (!container) return;
  destroyChartList(chartList);
  container.innerHTML = "";
  const visibleGroups = groups.filter(group => group.rows && group.rows.length);
  if (!visibleGroups.length) {
    renderEmptyChartContainer(container, emptyMessage);
    return;
  }
  visibleGroups.forEach(group => {
    const canvas = makeChartCard(container, group.title);
    chartList.push(new Chart(canvas, chartFactory(group.rows, group.title)));
  });
}

function buildAssyYieldChartGroups() {
  const rows = getWindowAssyRows();
  const projects = uniqueSorted(rows.map(row => fallbackGroupName(row.project, "Blank Project")));
  return [
    { title: "All", rows: buildSodSummary(rows) },
    ...projects.map(project => ({
      title: `Project · ${project}`,
      rows: buildSodSummary(rows.filter(row => fallbackGroupName(row.project, "Blank Project") === project))
    }))
  ];
}

function buildOsTrendChartGroups() {
  const rows = getWindowOsRows();
  const leads = uniqueSorted(rows.map(row => fallbackGroupName(row.lead, "Blank Lead")));
  return [
    { title: "All", rows: buildOsTrendRows(rows) },
    ...leads.map(lead => ({
      title: `Lead · ${lead}`,
      rows: buildOsTrendRows(rows.filter(row => fallbackGroupName(row.lead, "Blank Lead") === lead))
    }))
  ];
}

function buildDefectChartGroups() {
  const rows = getWindowAssyRows();
  const leads = uniqueSorted(rows.map(row => fallbackGroupName(row.lead, "Unknown Lead")));
  return [
    { title: "All", rows: buildDefectTrendRows(rows) },
    ...leads.map(lead => ({
      title: `Lead · ${lead}`,
      rows: buildDefectTrendRows(rows.filter(row => fallbackGroupName(row.lead, "Unknown Lead") === lead))
    }))
  ];
}

function buildBinTrendRows(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const reportWeek = getBinReportWeek(row);
    if (!grouped.has(reportWeek)) grouped.set(reportWeek, []);
    grouped.get(reportWeek).push(row);
  }

  return Array.from(grouped.entries()).map(([reportWeek, items]) => {
    const first = items[0] || {};
    const item = {
      reportWeek,
      reportWeekLabel: reportWeekLabel(reportWeek),
      reportMonth: normalizeReportMonth(reportWeek) || normalizeReportMonth(first.reportMonth),
      reportMonthLabel: monthLabel(normalizeReportMonth(reportWeek) || normalizeReportMonth(first.reportMonth)),
      rows: items.length,
      inQty: 0,
      outQty: 0,
      finalYield: null
    };

    for (const bin of BIN_COLUMNS) {
      item[bin.key] = 0;
      item[`${bin.key}Rate`] = null;
    }

    for (const row of items) {
      item.inQty += normalizeNumber(row.inQty) || 0;
      item.outQty += normalizeNumber(row.outQty) || 0;
      for (const bin of BIN_COLUMNS) {
        item[bin.key] += normalizeNumber(row[bin.key]) || 0;
      }
    }

    item.finalYield = calculateRate(item.outQty, item.inQty);
    for (const bin of BIN_COLUMNS) {
      item[`${bin.key}Rate`] = calculateRate(item[bin.key], item.inQty);
    }

    return item;
  }).sort((a, b) => String(a.reportWeek).localeCompare(String(b.reportWeek)));
}

function buildUploadedFileRows(assyItems, osItems, binItems) {
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
    if (type === "BIN" && (row.reportWeek || row.reportDate || row.reportMonth)) item.dateSet.add(getBinReportWeekLabel(row));

    const date = getDateFromFirestoreValue(row.uploadedAt) || getDateFromFirestoreValue(row.uploadedAtClient);
    if (date && (!item.latest || date > item.latest)) item.latest = date;
  }

  assyItems.forEach(row => push(row, "ASSY"));
  osItems.forEach(row => push(row, "OS"));
  binItems.forEach(row => push(row, "BIN"));

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

function getTopDefects(limitValue, rows = defectTrendRows) {
  const totals = new Map();

  for (const item of rows) {
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
  renderBinTrendChart();
  renderBinTrendTable();
  renderDefectTrendChart();
  renderDefectPpmTable();
}

function renderMetrics() {
  el.selectedAssyRows.textContent = selectedAssyRows.length.toLocaleString();
  el.selectedOsRows.textContent = selectedOsRows.length.toLocaleString();
  el.selectedBinRows.textContent = selectedBinRows.length.toLocaleString();
  el.firestoreAssyRows.textContent = assyRows.length.toLocaleString();
  el.firestoreOsRows.textContent = osRows.length.toLocaleString();
  el.firestoreBinRows.textContent = binRows.length.toLocaleString();
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

function makeYieldChartConfig(rows) {
  const labels = rows.map(row => compactDateToLabel(row.sod));
  return {
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Assy Yield Avg",
          data: rows.map(row => roundOrNull(row.assyYieldAvg, 3)),
          yAxisID: "rateAxis",
          tension: 0.2,
          spanGaps: true
        },
        {
          type: "line",
          label: "LSL 98.5%",
          data: rows.map(() => ASSY_YIELD_LSL),
          yAxisID: "rateAxis",
          borderDash: [6, 5],
          pointRadius: 0,
          borderWidth: 1.5
        },
        {
          type: "bar",
          label: "In Qty",
          data: rows.map(row => row.inQty),
          yAxisID: "qtyAxis"
        },
        {
          type: "bar",
          label: "Ship Qty(K)",
          data: rows.map(row => row.shipQtyK),
          yAxisID: "qtyAxis"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
  };
}

function renderYieldTrendChart() {
  renderChartCollection(
    el.yieldTrendCharts,
    yieldTrendCharts,
    buildAssyYieldChartGroups(),
    rows => makeYieldChartConfig(rows),
    "아직 Assy Yield Trend Data가 없습니다."
  );
}

function makeOsChartConfig(rows) {
  const labels = rows.map(row => row.inputDateLabel);
  return {
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Reject Rate",
          data: rows.map(row => roundOrNull(row.rejectRate, 4)),
          yAxisID: "rateAxis",
          tension: 0.2,
          spanGaps: true
        },
        {
          type: "line",
          label: "Open Rate",
          data: rows.map(row => roundOrNull(row.openRate, 4)),
          yAxisID: "rateAxis",
          tension: 0.2,
          spanGaps: true
        },
        {
          type: "line",
          label: "Short Rate",
          data: rows.map(row => roundOrNull(row.shortRate, 4)),
          yAxisID: "rateAxis",
          tension: 0.2,
          spanGaps: true
        },
        {
          type: "line",
          label: "USL 0.3%",
          data: rows.map(() => OS_RATE_USL),
          yAxisID: "rateAxis",
          borderDash: [6, 5],
          pointRadius: 0,
          borderWidth: 1.5
        },
        {
          type: "bar",
          label: "TEST_QTY",
          data: rows.map(row => row.testQty),
          yAxisID: "qtyAxis"
        },
        {
          type: "bar",
          label: "OS_SS",
          data: rows.map(row => row.osSs),
          yAxisID: "qtyAxis"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
  };
}

function renderOsTrendChart() {
  renderChartCollection(
    el.osTrendCharts,
    osTrendCharts,
    buildOsTrendChartGroups(),
    rows => makeOsChartConfig(rows),
    "아직 OS Trend Data가 없습니다."
  );
}

function getVisibleBinColumns() {
  const mode = el.binChartModeSelect?.value || "fail";
  if (mode === "all") return BIN_COLUMNS;
  if (mode === "bin1") return BIN_COLUMNS.filter(bin => bin.key === "bin1");
  return BIN_COLUMNS.filter(bin => bin.key !== "bin1");
}

function renderBinTrendChart() {
  if (!el.binTrendChart) return;
  const labels = binTrendRows.map(row => row.reportWeekLabel || row.reportWeek);
  const selectedBins = getVisibleBinColumns();

  const datasets = selectedBins.map(bin => ({
    type: "line",
    label: `${bin.label} Rate`,
    data: binTrendRows.map(row => roundOrNull(row[`${bin.key}Rate`], 6)),
    tension: 0.2,
    spanGaps: true
  }));

  if (binTrendChart) binTrendChart.destroy();

  binTrendChart = new Chart(el.binTrendChart, {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: value => `${value}%` },
          title: { display: true, text: "Bin Rate (%)" }
        }
      },
      plugins: { legend: { position: "bottom" } }
    }
  });
}

function renderBinTrendTable() {
  if (!el.binTrendBody) return;
  if (!binTrendRows.length) {
    el.binTrendBody.innerHTML = `<tr><td colspan="12" class="empty">아직 BIN Trend Data가 없습니다.</td></tr>`;
    return;
  }

  el.binTrendBody.innerHTML = binTrendRows.map(row => `
    <tr>
      <td>${escapeHtml(row.reportWeekLabel || row.reportWeek)}</td>
      <td>${formatNumber(row.rows)}</td>
      <td>${formatNumber(row.inQty)}</td>
      <td>${formatNumber(row.outQty)}</td>
      <td>${formatYield(row.finalYield)}</td>
      ${BIN_COLUMNS.map(bin => `<td>${formatRate(row[`${bin.key}Rate`])}</td>`).join("")}
    </tr>
  `).join("");
}

function makeDefectChartConfig(rows) {
  const sodKeys = Array.from(new Set(rows.map(row => row.sod))).sort();
  const labels = sodKeys.map(compactDateToLabel);
  const selectedDefects = getTopDefects(el.defectLimitSelect.value, rows);

  const datasets = selectedDefects.map(defect => ({
    type: "line",
    label: defect,
    data: sodKeys.map(sod => {
      const found = rows.find(row => row.sod === sod && row.defect === defect);
      return found ? Number(found.ppm.toFixed(2)) : null;
    }),
    tension: 0.2,
    spanGaps: true
  }));

  return {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
  };
}

function renderDefectTrendChart() {
  renderChartCollection(
    el.defectTrendCharts,
    defectTrendCharts,
    buildDefectChartGroups(),
    rows => makeDefectChartConfig(rows),
    "아직 Defect Trend Data가 없습니다."
  );
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
  if (!el.assyRawBody) return;
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
    el.osTrendBody.innerHTML = `<tr><td colspan="7" class="empty">아직 OS Trend Data가 없습니다.</td></tr>`;
    return;
  }

  el.osTrendBody.innerHTML = osTrendRows.map(row => `
    <tr>
      <td>${escapeHtml(row.inputDateLabel)}</td>
      <td>${formatNumber(row.rows)}</td>
      <td>${formatNumber(row.testQty)}</td>
      <td>${roundOrNull(row.osSs, 4) ?? ""}</td>
      <td>${formatRate(row.rejectRate)}</td>
      <td>${formatRate(row.openRate)}</td>
      <td>${formatRate(row.shortRate)}</td>
    </tr>
  `).join("");
}

function renderOsRawTable() {
  if (!el.osRawBody) return;
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

function makeBinExportRawRow(row) {
  return {
    "Report Week": getBinReportWeekLabel(row),
    "Report Date": row.reportDate || "",
    "Report Month": row.reportMonth,
    CUST_ID: row.custId,
    PKG_ID: row.pkgId,
    LEAD_ID: row.leadId,
    CUST_DEVICE: row.custDevice,
    NICK_NAME: row.nickName,
    LOT_ID: row.lotId,
    CUST_RUN_ID: row.custRunId,
    SUBSTRATE_VENDOR: row.substrateVendor,
    IN_QTY: row.inQty,
    OUT_QTY: row.outQty,
    "FINAL YIELD": row.finalYield,
    BIN1: row.bin1,
    BIN2: row.bin2,
    BIN3: row.bin3,
    BIN4: row.bin4,
    BIN5: row.bin5,
    BIN6: row.bin6,
    BIN36: row.bin36,
    "Source File": row.sourceFileName,
    "Dedupe Key": row.dedupeKey
  };
}

function makeBinExportTrendRow(row) {
  const output = {
    "Report Week": row.reportWeek,
    Week: row.reportWeekLabel,
    "Report Month": row.reportMonth,
    Rows: row.rows,
    IN_QTY: row.inQty,
    OUT_QTY: row.outQty,
    "FINAL YIELD(%)": roundOrNull(row.finalYield, 6)
  };

  for (const bin of BIN_COLUMNS) {
    output[bin.header] = row[bin.key];
    output[`${bin.header} Rate(%)`] = roundOrNull(row[`${bin.key}Rate`], 6);
  }

  return output;
}

function exportBinReport() {
  if (!binRows.length) {
    log("Export할 BIN Data가 없습니다.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const allRows = [...binRows].sort((a, b) => {
    const weekCompare = String(getBinReportWeek(a) || "").localeCompare(String(getBinReportWeek(b) || ""));
    if (weekCompare !== 0) return weekCompare;
    return String(a.lotId || "").localeCompare(String(b.lotId || ""));
  });

  const trendRows = buildBinTrendRows(allRows).map(makeBinExportTrendRow);
  const rawRows = allRows.map(makeBinExportRawRow);

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(trendRows), "BIN_Weekly_Trend");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawRows), "BIN_Merged_Raw");

  const weeks = Array.from(new Set(allRows.map(row => getBinReportWeek(row)))).sort();
  for (const week of weeks) {
    const weekRows = allRows.filter(row => getBinReportWeek(row) === week).map(makeBinExportRawRow);
    const sheetName = `BIN_${week.replace(/[^0-9A-Za-z]/g, "_")}`.slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(weekRows), sheetName);
  }

  XLSX.writeFile(workbook, `MTK_BIN_Weekly_Merged_${todayStamp()}.xlsx`);
  log("BIN Weekly Merge Report Export 완료");
}

function setupEvents() {
  // 중요: input[type=file]의 programmatic click 이벤트가 부모 dropZone으로 다시 bubble되면
  // 일부 Edge/Chrome 환경에서 파일 선택창이 중복 호출되고 File handle이 invalid 상태가 되어
  // NotReadableError가 발생할 수 있습니다. 그래서 input click은 propagation을 막고,
  // dropZone 자체 클릭일 때만 파일 선택창을 1회 호출합니다.
  el.excelFiles.addEventListener("click", event => {
    event.stopPropagation();
  });

  el.dropZone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    el.excelFiles.click();
  });

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

  el.trendStartMonthSelect.addEventListener("change", () => {
    trendStartMonth = el.trendStartMonthSelect.value;
    rebuildDerivedData();
    renderFirestoreViews();
  });
  el.defectLimitSelect.addEventListener("change", renderDefectTrendChart);
  el.binChartModeSelect.addEventListener("change", renderBinTrendChart);
  el.exportAssyBtn.addEventListener("click", exportAssyReport);
  el.exportOsBtn.addEventListener("click", exportOsReport);
  el.exportBinBtn.addEventListener("click", exportBinReport);
}

setupEvents();
renderSelectedFiles();
renderMetrics();
initFirebase();
