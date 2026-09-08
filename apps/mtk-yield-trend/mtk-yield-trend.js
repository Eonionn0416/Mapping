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
let weeklyDeviceVendorData = { devices: [], wwColumns: [], osMap: new Map(), binMap: new Map() };
let trendStartMonth = "";

let yieldTrendCharts = [];
let osTrendCharts = [];
let defectTrendCharts = [];
let binTrendCharts = [];

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
  binTrendCharts: document.getElementById("binTrendCharts"),
  defectLimitSelect: document.getElementById("defectLimitSelect"),
  trendStartMonthSelect: document.getElementById("trendStartMonthSelect"),
  defectPpmBody: document.getElementById("defectPpmBody"),
  assyRawBody: document.getElementById("assyRawBody"),
  osTrendBody: document.getElementById("osTrendBody"),
  binTrendBody: document.getElementById("binTrendBody"),
  osRawBody: document.getElementById("osRawBody"),
  exportAssyBtn: document.getElementById("exportAssyBtn"),
  exportOsBtn: document.getElementById("exportOsBtn"),
  exportBinBtn: document.getElementById("exportBinBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
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
  if (el.exportOsBtn) el.exportOsBtn.disabled = isBusy || !(osRows.length || binRows.length);
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

// BIN(FT) 파일은 row 자체에 날짜가 없어서 파일명 끝의 8자리(YYYYMMDD, 예: ..._20260608)를 report 날짜로 사용합니다.
// normalizeReportDate가 (경계 문자 요구 등으로) 못 찾는 경우를 대비한 느슨한 fallback입니다.
function dateFromFileNameTrailingDigits(fileName) {
  const raw = normalizeText(fileName).replace(/\.[a-zA-Z0-9]+$/, "");
  const digitRuns = raw.match(/\d+/g) || [];
  for (let i = digitRuns.length - 1; i >= 0; i -= 1) {
    const run = digitRuns[i];
    if (run.length >= 8) {
      const ymd8 = run.slice(-8);
      const key = makeDateKey(ymd8.slice(0, 4), ymd8.slice(4, 6), ymd8.slice(6, 8));
      if (key) return key;
    }
  }
  return "";
}

function getReportDateFromFile(file) {
  const byName = normalizeReportDate(file?.name || "");
  if (byName) return byName;

  const byTrailingDigits = dateFromFileNameTrailingDigits(file?.name || "");
  if (byTrailingDigits) return byTrailingDigits;

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
    substratePartDesc: normalizeText(rawRow["SUBSTRATE_PART_DESC"]),
    ftInTime: normalizeText(rawRow["FT_IN_TIME"]),
    ftOutTime: normalizeText(rawRow["FT_OUT_TIME"]),
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

  // FT_IN_TIME(row별 실제 FT 투입 시각)이 있으면 WW 계산에 이 날짜를 사용합니다 (OS의 INPUT_TIME과 동일한 방식).
  row.ftInDate = rawRow["FT_IN_TIME"] ? parseInputDate(rawRow["FT_IN_TIME"]) : "";
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

// ---- Assy OS / FT Weekly (Lead × Vendor × WW) 집계 ----
// Sheet 구분 기준: OS는 LEAD, BIN은 LEAD_ID.
function groupKey(value) {
  return normalizeText(value).toUpperCase();
}

// PCB_VENDOR / SUBSTRATE_VENDOR 마지막 4 digit이 'LIST'면 LIST, 그 외에는 LGIT로 구분합니다.
function vendorGroup(value) {
  const raw = normalizeText(value).toUpperCase();
  return raw.slice(-4) === "LIST" ? "LIST" : "LGIT";
}

// WW는 일요일~토요일 기준 (예: 9/6~9/12 = WW37). OS의 INPUT_TIME, BIN의 Report 날짜 모두
// 그 날짜가 속한 일~토 주를 그대로 사용합니다 (별도 offset 없음).
function sundayStartUTC(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}

function wwInfoFromWeekStart(weekStart) {
  const weekYear = weekStart.getUTCFullYear();
  const anchor = sundayStartUTC(weekYear, 1, 1);
  const diffDays = Math.round((weekStart.getTime() - anchor.getTime()) / 86400000);
  const ww = Math.floor(diffDays / 7) + 1;
  const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
  return {
    year: weekYear,
    ww,
    sortKey: weekStart.getTime(),
    label: `WW${ww}`,
    rangeLabel: `${weekStart.getUTCMonth() + 1}/${weekStart.getUTCDate()}-${weekEnd.getUTCMonth() + 1}/${weekEnd.getUTCDate()}`
  };
}

function workWeekInfoFromDateKey(dateKey) {
  const normalized = normalizeReportDate(dateKey);
  if (!normalized) return null;
  const [y, m, d] = normalized.split("-").map(Number);
  return wwInfoFromWeekStart(sundayStartUTC(y, m, d));
}

function getOsWorkWeekInfo(row) {
  return workWeekInfoFromDateKey(row?.inputDate);
}

// BIN(FT) report 파일은 실제 데이터가 속한 일~토 주가 끝난 "다음 주 초"의 날짜로 파일명이 찍힙니다
// (예: 20260727(월) 파일 = 직전 일~토 주인 7/19~7/25(WW30) data). 그래서 파일명 날짜에서 7일을 뺀
// 날짜로 WW를 계산합니다. (실제 답지 파일과 대조해 정확히 일치하는 것을 확인했습니다.)
function shiftDateKeyByDays(dateKey, days) {
  const normalized = normalizeReportDate(dateKey);
  if (!normalized) return "";
  const [y, m, d] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return makeDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getBinWorkWeekInfo(row) {
  // FT_IN_TIME(row별 실제 FT 투입 시각)이 있으면 그 날짜가 속한 일~토 주를 그대로 사용합니다
  // (OS의 INPUT_TIME과 동일한 방식, 파일명 기준 -7일 보정 불필요).
  if (row?.ftInDate) {
    const byFtInTime = workWeekInfoFromDateKey(row.ftInDate);
    if (byFtInTime) return byFtInTime;
  }

  // FT_IN_TIME이 없는 구버전 파일은 기존처럼 파일명 날짜에서 7일을 뺀 값으로 WW를 계산합니다.
  const shiftedDate = shiftDateKeyByDays(row?.reportDate, -7);
  const byDate = shiftedDate ? workWeekInfoFromDateKey(shiftedDate) : null;
  if (byDate) return byDate;
  const month = normalizeReportMonth(row?.reportMonth);
  if (/^\d{4}-\d{2}$/.test(month)) return workWeekInfoFromDateKey(`${month}-01`);
  return null;
}

function emptyOsBucket() {
  return { testQty: 0, openQty: 0, shortQty: 0, rows: 0 };
}

function emptyBinBucket() {
  return { inQty: 0, ftFailQty: 0, bin4Qty: 0, rows: 0 };
}

function osCellRate(bucket, kind) {
  if (!bucket || !bucket.rows) return null;
  if (!bucket.testQty) return null;
  const numerator = kind === "open" ? bucket.openQty : bucket.shortQty;
  return numerator / bucket.testQty;
}

function binCellRate(bucket, kind) {
  if (!bucket || !bucket.rows) return null;
  if (!bucket.inQty) return null;
  const numerator = kind === "ft" ? bucket.ftFailQty : bucket.bin4Qty;
  return numerator / bucket.inQty;
}

// FT(BIN)의 SUBSTRATE_VENDOR가 비어 있으면 LOT_ID 마지막 1자리(Split/Run 문자)를 뗀 값으로
// Assy OS List의 LOT_ID를 찾아서, 있으면 그 PCB_VENDOR를 대신 사용합니다.
// 예: BIN LOT_ID "TPFUN46.00-1A2A" -> "TPFUN46.00-1A2"를 OS LOT_ID에서 검색.
function buildOsLotVendorMap(osRowsInput) {
  const map = new Map();
  (osRowsInput || []).forEach(row => {
    const lotKey = normalizeText(row.lotId).toUpperCase();
    const vendor = normalizeText(row.pcbVendor);
    if (lotKey && vendor && !map.has(lotKey)) map.set(lotKey, vendor);
  });
  return map;
}

function resolveBinVendorRaw(row, osLotVendorMap) {
  const own = normalizeText(row.substrateVendor);
  if (own) return own;
  const lotKey = normalizeText(row.lotId).toUpperCase();
  if (lotKey.length < 2) return own;
  const trimmedLot = lotKey.slice(0, -1);
  return osLotVendorMap.get(trimmedLot) || own;
}

function buildDeviceVendorWeekly(osRowsInput, binRowsInput) {
  const osMap = new Map();
  const binMap = new Map();
  const wwMeta = new Map();
  const deviceSet = new Set();
  const yearSet = new Set();
  const osLotVendorMap = buildOsLotVendorMap(osRowsInput);

  (osRowsInput || []).forEach(row => {
    const wwInfo = getOsWorkWeekInfo(row);
    const device = groupKey(row.lead);
    if (!wwInfo || !device) return;
    deviceSet.add(device);
    yearSet.add(wwInfo.year);
    wwMeta.set(wwInfo.sortKey, wwInfo);

    if (!osMap.has(device)) osMap.set(device, new Map());
    const wwMap = osMap.get(device);
    if (!wwMap.has(wwInfo.sortKey)) wwMap.set(wwInfo.sortKey, { LGIT: emptyOsBucket(), LIST: emptyOsBucket() });
    const bucket = wwMap.get(wwInfo.sortKey)[vendorGroup(row.pcbVendor)];
    bucket.testQty += normalizeNumber(row.testQty) || 0;
    bucket.openQty += normalizeNumber(row.openQty) || 0;
    bucket.shortQty += normalizeNumber(row.shortQty) || 0;
    bucket.rows += 1;
  });

  (binRowsInput || []).forEach(row => {
    const wwInfo = getBinWorkWeekInfo(row);
    const device = groupKey(row.leadId);
    if (!wwInfo || !device) return;
    deviceSet.add(device);
    yearSet.add(wwInfo.year);
    wwMeta.set(wwInfo.sortKey, wwInfo);

    if (!binMap.has(device)) binMap.set(device, new Map());
    const wwMap = binMap.get(device);
    if (!wwMap.has(wwInfo.sortKey)) wwMap.set(wwInfo.sortKey, { LGIT: emptyBinBucket(), LIST: emptyBinBucket() });
    const resolvedVendorRaw = resolveBinVendorRaw(row, osLotVendorMap);
    const bucket = wwMap.get(wwInfo.sortKey)[vendorGroup(resolvedVendorRaw)];
    bucket.inQty += normalizeNumber(row.inQty) || 0;
    // FT Fail Qty = BIN2~BIN6 + BIN36 (BIN36도 실패 Bin으로 포함해야 답지 수치와 정확히 일치합니다)
    bucket.ftFailQty += (normalizeNumber(row.bin2) || 0) + (normalizeNumber(row.bin3) || 0)
      + (normalizeNumber(row.bin4) || 0) + (normalizeNumber(row.bin5) || 0) + (normalizeNumber(row.bin6) || 0)
      + (normalizeNumber(row.bin36) || 0);
    bucket.bin4Qty += normalizeNumber(row.bin4) || 0;
    bucket.rows += 1;
  });

  const sortKeys = Array.from(wwMeta.keys()).sort((a, b) => a - b);
  const wwColumns = [];
  if (sortKeys.length) {
    const step = 7 * 86400000;
    for (let k = sortKeys[0]; k <= sortKeys[sortKeys.length - 1]; k += step) {
      wwColumns.push(wwMeta.get(k) || wwInfoFromWeekStart(new Date(k)));
    }
  }
  const multiYear = yearSet.size > 1;
  wwColumns.forEach(w => {
    w.columnLabel = multiYear ? `'${String(w.year).slice(2)} WW${w.ww}` : `WW${w.ww}`;
  });

  return { devices: Array.from(deviceSet).sort(), wwColumns, osMap, binMap };
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

// 이미 저장된 row(existingRow)에는 없는데 새로 올라온 row(newRow)에는 값이 있는 필드가 있으면 true.
// (예: v27 이전에 저장된 BIN row는 ftInDate가 없는데, 같은 lot을 v27 파일로 다시 올리면 ftInDate가 채워짐 → update로 보완)
function rowHasNewFields(newRow, existingRow) {
  for (const key of Object.keys(newRow)) {
    if (key === "uploadedAt" || key === "uploadedAtClient" || key === "dedupeKey") continue;
    const newVal = newRow[key];
    const oldVal = existingRow ? existingRow[key] : undefined;
    const newHasValue = newVal !== null && newVal !== undefined && newVal !== "";
    const oldHasValue = oldVal !== null && oldVal !== undefined && oldVal !== "";
    if (newHasValue && !oldHasValue) return true;
  }
  return false;
}

async function insertRowsToCollection(collectionName, rows, existingRows) {
  const existingByKey = new Map();
  for (const row of existingRows) {
    const key1 = row.dedupeKey || row.id;
    const key2 = getLogicalDedupeKey(collectionName, row);
    if (key1) existingByKey.set(key1, row);
    if (key2) existingByKey.set(key2, row);
  }

  const rowsToInsert = [];
  const rowsToUpdate = [];
  let skipped = 0;

  for (const row of rows) {
    const logicalKey = getLogicalDedupeKey(collectionName, row);
    const existing = existingByKey.get(row.dedupeKey) || existingByKey.get(logicalKey);

    if (existing) {
      // 완전히 동일한 duplicate면 skip, 새 row에 기존에 없던 값(예: ftInDate)이 채워져 있으면 update로 보완합니다.
      if (rowHasNewFields(row, existing)) {
        rowsToUpdate.push(row);
      } else {
        skipped += 1;
      }
      continue;
    }

    existingByKey.set(row.dedupeKey, row);
    existingByKey.set(logicalKey, row);
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

  let updated = 0;
  for (let i = 0; i < rowsToUpdate.length; i += BATCH_LIMIT) {
    const chunk = rowsToUpdate.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);

    for (const row of chunk) {
      const ref = doc(db, collectionName, row.dedupeKey);
      batch.set(ref, {
        ...row,
        uploadedAt: serverTimestamp(),
        uploadedAtClient: new Date().toISOString()
      }, { merge: true });
    }

    await batch.commit();
    updated += chunk.length;
  }

  return { inserted, skipped, updated };
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
  let totalUpdated = 0;

  try {
    if (selectedAssyRows.length) {
      const result = await insertRowsToCollection(ASSY_COLLECTION, selectedAssyRows, assyRows);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalUpdated += result.updated || 0;
      log(`ASSY Upload: Insert ${result.inserted.toLocaleString()}, Update ${(result.updated || 0).toLocaleString()}, Duplicate Skip ${result.skipped.toLocaleString()}`);
    }

    if (selectedOsRows.length) {
      const result = await insertRowsToCollection(OS_COLLECTION, selectedOsRows, osRows);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalUpdated += result.updated || 0;
      log(`OS Upload: Insert ${result.inserted.toLocaleString()}, Update ${(result.updated || 0).toLocaleString()}, Duplicate Skip ${result.skipped.toLocaleString()}`);
    }

    if (selectedBinRows.length) {
      const result = await insertRowsToCollection(BIN_COLLECTION, selectedBinRows, binRows);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalUpdated += result.updated || 0;
      log(`BIN Upload: Insert ${result.inserted.toLocaleString()}, Update ${(result.updated || 0).toLocaleString()} (예: 이전에 ftInDate 없이 저장된 lot을 새 파일의 FT_IN_TIME으로 보완), Duplicate Skip ${result.skipped.toLocaleString()}`);
    }

    el.insertedRows.textContent = (totalInserted + totalUpdated).toLocaleString();
    el.skippedRows.textContent = totalSkipped.toLocaleString();
    log(`Upload 완료: Total Insert ${totalInserted.toLocaleString()}, Update ${totalUpdated.toLocaleString()}, Duplicate Skip ${totalSkipped.toLocaleString()}`);

    await loadFirestoreData();
  } catch (error) {
    log(`Upload Error: ${error.message}`);
    log("Firestore Rules / Anonymous Auth / collection name(yieldSummaryTapRaw, osComparisonRaw, binInformationRaw)을 확인해주세요.");
  } finally {
    setBusy(false);
  }
}

async function deleteAllDocsInCollection(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  const docs = snap.docs;
  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const chunk = docs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    chunk.forEach(docSnap => batch.delete(docSnap.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function clearAllUploadedData() {
  const ok = window.confirm("첨부한 모든 Raw Data(Assy/OS/BIN)를 Firestore에서 완전히 삭제합니다. 계속할까요?");
  if (!ok) return;

  selectedFiles = [];
  selectedAssyRows = [];
  selectedOsRows = [];
  selectedBinRows = [];
  renderSelectedFiles();
  renderMetrics();

  if (!db || !currentUser) {
    assyRows = [];
    osRows = [];
    binRows = [];
    rebuildDerivedData();
    renderFirestoreViews();
    log("Firebase 준비 전이라 화면 Data만 초기화했습니다.");
    return;
  }

  setBusy(true);
  try {
    const [assyDeleted, osDeleted, binDeleted] = await Promise.all([
      deleteAllDocsInCollection(ASSY_COLLECTION),
      deleteAllDocsInCollection(OS_COLLECTION),
      deleteAllDocsInCollection(BIN_COLLECTION)
    ]);
    log(`Firestore 삭제 완료: ${ASSY_COLLECTION} ${assyDeleted.toLocaleString()}건 / ${OS_COLLECTION} ${osDeleted.toLocaleString()}건 / ${BIN_COLLECTION} ${binDeleted.toLocaleString()}건.`);
    await loadFirestoreData();
    log("업로드된 Raw Data를 모두 삭제했습니다.");
  } catch (error) {
    log(`전체 삭제 Error: ${error.message}`);
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
  weeklyDeviceVendorData = buildDeviceVendorWeekly(windowOsRows, windowBinRows);
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

function buildAssyOsWeeklyChartGroups() {
  const weekly = weeklyDeviceVendorData;
  return weekly.devices
    .filter(device => weekly.osMap.has(device))
    .map(device => {
      const wwMap = weekly.osMap.get(device);
      const rows = weekly.wwColumns.map(w => {
        const cell = wwMap.get(w.sortKey) || {};
        return {
          label: w.columnLabel,
          openLgit: osCellRate(cell.LGIT, "open"),
          openList: osCellRate(cell.LIST, "open"),
          shortLgit: osCellRate(cell.LGIT, "short"),
          shortList: osCellRate(cell.LIST, "short")
        };
      });
      return { title: `Lead · ${device}`, rows };
    });
}

function buildFtWeeklyChartGroups() {
  const weekly = weeklyDeviceVendorData;
  return weekly.devices
    .filter(device => weekly.binMap.has(device))
    .map(device => {
      const wwMap = weekly.binMap.get(device);
      const rows = weekly.wwColumns.map(w => {
        const cell = wwMap.get(w.sortKey) || {};
        return {
          label: w.columnLabel,
          ftLgit: binCellRate(cell.LGIT, "ft"),
          ftList: binCellRate(cell.LIST, "ft"),
          bin4Lgit: binCellRate(cell.LGIT, "bin4"),
          bin4List: binCellRate(cell.LIST, "bin4")
        };
      });
      return { title: `Lead · ${device}`, rows };
    });
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

function pctOrNull(fraction) {
  return fraction === null || fraction === undefined ? null : roundOrNull(fraction * 100, 4);
}

function makeAssyOsWeeklyChartConfig(rows) {
  const labels = rows.map(row => row.label);
  return {
    data: {
      labels,
      datasets: [
        { type: "line", label: "Open Rate (LGIT)", data: rows.map(row => pctOrNull(row.openLgit)), tension: 0.2, spanGaps: true },
        { type: "line", label: "Open Rate (LIST)", data: rows.map(row => pctOrNull(row.openList)), tension: 0.2, spanGaps: true },
        { type: "line", label: "Short Rate (LGIT)", data: rows.map(row => pctOrNull(row.shortLgit)), tension: 0.2, spanGaps: true },
        { type: "line", label: "Short Rate (LIST)", data: rows.map(row => pctOrNull(row.shortList)), tension: 0.2, spanGaps: true },
        {
          type: "line",
          label: "USL 0.3%",
          data: rows.map(() => OS_RATE_USL),
          borderDash: [6, 5],
          pointRadius: 0,
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: value => `${value}%` },
          title: { display: true, text: "Rate (%)" }
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
    buildAssyOsWeeklyChartGroups(),
    rows => makeAssyOsWeeklyChartConfig(rows),
    "아직 OS Trend Data가 없습니다."
  );
}

function makeFtWeeklyChartConfig(rows) {
  const labels = rows.map(row => row.label);
  return {
    data: {
      labels,
      datasets: [
        { type: "line", label: "FT Rate (LGIT)", data: rows.map(row => pctOrNull(row.ftLgit)), tension: 0.2, spanGaps: true },
        { type: "line", label: "FT Rate (LIST)", data: rows.map(row => pctOrNull(row.ftList)), tension: 0.2, spanGaps: true },
        { type: "line", label: "Bin4 Rate (LGIT)", data: rows.map(row => pctOrNull(row.bin4Lgit)), tension: 0.2, spanGaps: true },
        { type: "line", label: "Bin4 Rate (LIST)", data: rows.map(row => pctOrNull(row.bin4List)), tension: 0.2, spanGaps: true }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: value => `${value}%` },
          title: { display: true, text: "Rate (%)" }
        }
      },
      plugins: { legend: { position: "bottom" } }
    }
  };
}

function renderBinTrendChart() {
  renderChartCollection(
    el.binTrendCharts,
    binTrendCharts,
    buildFtWeeklyChartGroups(),
    rows => makeFtWeeklyChartConfig(rows),
    "아직 FT/BIN Trend Data가 없습니다."
  );
}

function renderBinTrendTable() {
  if (!el.binTrendBody) return;
  const weekly = weeklyDeviceVendorData;
  const flatRows = [];
  weekly.devices.forEach(device => {
    const wwMap = weekly.binMap.get(device);
    if (!wwMap) return;
    weekly.wwColumns.forEach(w => {
      const cell = wwMap.get(w.sortKey);
      if (!cell) return;
      ["LGIT", "LIST"].forEach(vendor => {
        const bucket = cell[vendor];
        if (!bucket || !bucket.rows) return;
        flatRows.push({
          device,
          ww: w.columnLabel,
          vendor,
          inQty: bucket.inQty,
          ftFailQty: bucket.ftFailQty,
          ftRate: binCellRate(bucket, "ft"),
          bin4Qty: bucket.bin4Qty,
          bin4Rate: binCellRate(bucket, "bin4")
        });
      });
    });
  });

  if (!flatRows.length) {
    el.binTrendBody.innerHTML = `<tr><td colspan="8" class="empty">아직 FT/BIN Trend Data가 없습니다.</td></tr>`;
    return;
  }

  el.binTrendBody.innerHTML = flatRows.map(row => `
    <tr>
      <td>${escapeHtml(row.device)}</td>
      <td>${escapeHtml(row.ww)}</td>
      <td>${escapeHtml(row.vendor)}</td>
      <td>${formatNumber(row.inQty)}</td>
      <td>${formatNumber(row.ftFailQty)}</td>
      <td>${formatRate(pctOrNull(row.ftRate))}</td>
      <td>${formatNumber(row.bin4Qty)}</td>
      <td>${formatRate(pctOrNull(row.bin4Rate))}</td>
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
  if (!el.osTrendBody) return;
  const weekly = weeklyDeviceVendorData;
  const flatRows = [];
  weekly.devices.forEach(device => {
    const wwMap = weekly.osMap.get(device);
    if (!wwMap) return;
    weekly.wwColumns.forEach(w => {
      const cell = wwMap.get(w.sortKey);
      if (!cell) return;
      ["LGIT", "LIST"].forEach(vendor => {
        const bucket = cell[vendor];
        if (!bucket || !bucket.rows) return;
        flatRows.push({
          device,
          ww: w.columnLabel,
          vendor,
          testQty: bucket.testQty,
          openQty: bucket.openQty,
          shortQty: bucket.shortQty,
          openRate: osCellRate(bucket, "open"),
          shortRate: osCellRate(bucket, "short")
        });
      });
    });
  });

  if (!flatRows.length) {
    el.osTrendBody.innerHTML = `<tr><td colspan="8" class="empty">아직 OS Trend Data가 없습니다.</td></tr>`;
    return;
  }

  el.osTrendBody.innerHTML = flatRows.map(row => `
    <tr>
      <td>${escapeHtml(row.device)}</td>
      <td>${escapeHtml(row.ww)}</td>
      <td>${escapeHtml(row.vendor)}</td>
      <td>${formatNumber(row.testQty)}</td>
      <td>${formatNumber(row.openQty)}</td>
      <td>${formatNumber(row.shortQty)}</td>
      <td>${formatRate(pctOrNull(row.openRate))}</td>
      <td>${formatRate(pctOrNull(row.shortRate))}</td>
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

function buildDeviceSheetAoa(device, weekly) {
  const osWwMap = weekly.osMap.get(device) || new Map();
  const binWwMap = weekly.binMap.get(device) || new Map();

  function osRowValues(vendor, kind) {
    return weekly.wwColumns.map(w => {
      const cell = (osWwMap.get(w.sortKey) || {})[vendor];
      const rate = osCellRate(cell, kind);
      return rate === null ? "-" : rate;
    });
  }
  function binRowValues(vendor, kind) {
    return weekly.wwColumns.map(w => {
      const cell = (binWwMap.get(w.sortKey) || {})[vendor];
      const rate = binCellRate(cell, kind);
      return rate === null ? "-" : rate;
    });
  }

  const rows = [];
  rows.push([`${device} Assembly_SCK_OS and FT data`]);
  rows.push(["* By Weekly"]);
  rows.push([]);
  rows.push(["", "Limit: OS >= 3000ppm(0.3%) based on W-207 MediaTek Assembl OS Operation Flow"]);
  rows.push(["", "", "", ...weekly.wwColumns.map(w => w.rangeLabel)]);
  rows.push(["Criteria", "Item", "SBT", ...weekly.wwColumns.map(w => w.columnLabel)]);
  rows.push(["Assy\nOS", "Open", "LGIT", ...osRowValues("LGIT", "open")]);
  rows.push([null, null, "LIST", ...osRowValues("LIST", "open")]);
  rows.push([null, "Short", "LGIT", ...osRowValues("LGIT", "short")]);
  rows.push([null, null, "LIST", ...osRowValues("LIST", "short")]);
  rows.push(["FT", "FT", "LGIT", ...binRowValues("LGIT", "ft")]);
  rows.push([null, null, "LIST", ...binRowValues("LIST", "ft")]);
  rows.push([null, "Bin4 rate", "LGIT", ...binRowValues("LGIT", "bin4")]);
  rows.push([null, null, "LIST", ...binRowValues("LIST", "bin4")]);
  return rows;
}

function exportOsReport() {
  const weekly = weeklyDeviceVendorData;
  const devices = weekly.devices.filter(device => weekly.osMap.has(device) || weekly.binMap.has(device));

  if (!devices.length || !weekly.wwColumns.length) {
    log("Export할 Assy OS / FT Weekly Data가 없습니다.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  devices.forEach(device => {
    const aoa = buildDeviceSheetAoa(device, weekly);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [
      { s: { r: 6, c: 0 }, e: { r: 9, c: 0 } },
      { s: { r: 10, c: 0 }, e: { r: 13, c: 0 } },
      { s: { r: 6, c: 1 }, e: { r: 7, c: 1 } },
      { s: { r: 8, c: 1 }, e: { r: 9, c: 1 } },
      { s: { r: 10, c: 1 }, e: { r: 11, c: 1 } },
      { s: { r: 12, c: 1 }, e: { r: 13, c: 1 } }
    ];
    ws["!cols"] = [{ wch: 8 }, { wch: 11 }, { wch: 6 }, ...weekly.wwColumns.map(() => ({ wch: 9 }))];

    for (let r = 6; r <= 13; r += 1) {
      for (let c = 3; c < 3 + weekly.wwColumns.length; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && typeof cell.v === "number") cell.z = "0.000%";
      }
    }

    let sheetName = device || `Sheet${usedSheetNames.size + 1}`;
    sheetName = sheetName.slice(0, 31);
    let suffix = 1;
    while (usedSheetNames.has(sheetName)) {
      sheetName = `${device.slice(0, 28)}_${suffix}`;
      suffix += 1;
    }
    usedSheetNames.add(sheetName);

    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
  });

  const lastWw = weekly.wwColumns[weekly.wwColumns.length - 1];
  const suffix = lastWw ? lastWw.columnLabel.replace(/[^0-9A-Za-z']/g, "") : todayStamp();
  XLSX.writeFile(workbook, `MTK FT and OS Weekly update@SCK_${suffix}.xlsx`);
  log(`Assy OS / FT Weekly Report Export 완료 (Lead ${devices.length}개 · ${weekly.wwColumns.length}주)`);
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
    FT_IN_TIME: row.ftInTime || "",
    FT_OUT_TIME: row.ftOutTime || "",
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
  el.exportAssyBtn.addEventListener("click", exportAssyReport);
  el.exportOsBtn.addEventListener("click", exportOsReport);
  el.exportBinBtn.addEventListener("click", exportBinReport);
  if (el.clearAllBtn) el.clearAllBtn.addEventListener("click", clearAllUploadedData);
}

setupEvents();
renderSelectedFiles();
renderMetrics();
initFirebase();
