import { mntCpkFirebaseConfig } from "../../shared/firebase-config.js";
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

const firebaseConfig = mntCpkFirebaseConfig;
const COLLECTION_NAME = "mntCpkTrendRaw";
const BATCH_LIMIT = 450;
const CPK_LIMIT_LOW = 1.33;
const CPK_LIMIT_HIGH = 1.67;
const APP_VERSION = "v18-all-item-characteristic-charts";

let app = null;
let db = null;
let auth = null;
let currentUser = null;

let selectedFiles = [];
let selectedRows = [];
let fileReadStatus = new Map();
let rawRows = [];
let uploadedFileRows = [];
let cpkTrendCharts = [];
let assyTrendCharts = [];
let trendRows = [];
let assyTrendRows = [];
let trendStartMonth = "";
let assyTrendStartMonth = "";

const el = {
  firebaseStatus: document.getElementById("firebaseStatus"),
  authStatus: document.getElementById("authStatus"),
  dropZone: document.getElementById("dropZone"),
  excelFiles: document.getElementById("excelFiles"),
  selectedFileList: document.getElementById("selectedFileList"),
  selectedRows: document.getElementById("selectedRows"),
  insertedRows: document.getElementById("insertedRows"),
  skippedRows: document.getElementById("skippedRows"),
  firestoreRows: document.getElementById("firestoreRows"),
  productCount: document.getElementById("productCount"),
  uploadedFiles: document.getElementById("uploadedFiles"),
  uploadedFilesBody: document.getElementById("uploadedFilesBody"),
  productSelect: document.getElementById("productSelect"),
  dataTypeSelect: document.getElementById("dataTypeSelect"),
  trendStartMonthSelect: document.getElementById("trendStartMonthSelect"),
  cpkTrendCharts: document.getElementById("cpkTrendCharts"),
  trendBody: document.getElementById("trendBody"),
  assyStartMonthSelect: document.getElementById("assyStartMonthSelect"),
  assyDeviceSelect: document.getElementById("assyDeviceSelect"),
  assyTrendCharts: document.getElementById("assyTrendCharts"),
  assyTrendBody: document.getElementById("assyTrendBody"),
  lowBody: document.getElementById("lowBody"),
  exportBtn: document.getElementById("exportBtn")
};

function log(message) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${message}`);
}

function setFirebaseStatus(text, type = "warning") {
  el.firebaseStatus.textContent = text;
  el.firebaseStatus.classList.remove("warning", "success", "danger");
  el.firebaseStatus.classList.add(type);
}

function setBusy(isBusy) {
  const hasSelectedRows = selectedRows.length > 0;
  if (el.exportBtn) el.exportBtn.disabled = isBusy || !rawRows.length;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function headerKey(value) {
  return normalizeText(value).toLowerCase().replace(/[\s\.]/g, "");
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned.toLowerCase() === "na" || cleaned.toLowerCase() === "n/a") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function fmtNumber(value, digits = 3) {
  const num = normalizeNumber(value);
  if (num === null) return "";
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function sortByMonth(a, b) {
  return String(a.reportMonth || "").localeCompare(String(b.reportMonth || ""));
}

function monthLabel(reportMonth) {
  if (!reportMonth || !/^\d{4}-\d{2}$/.test(reportMonth)) return reportMonth || "Unknown";
  const [yyyy, mm] = reportMonth.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[Number(mm) - 1]}'${yyyy.slice(2)}`;
}

function monthLongLabel(reportMonth) {
  if (!/^\d{4}-\d{2}$/.test(reportMonth || "")) return reportMonth || "";
  const [yyyy, mm] = reportMonth.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${yyyy} ${names[Number(mm) - 1]}`;
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

function isMonthInWindow(month, startMonth) {
  if (!startMonth) return true;
  const idx = monthToIndex(month);
  const start = monthToIndex(startMonth);
  const end = monthToIndex(addMonths(startMonth, 12));
  if (idx === null || start === null || end === null) return true;
  return idx >= start && idx <= end;
}

function parseReportMonth(fileName) {
  const monthMap = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10",
    nov: "11", november: "11", dec: "12", december: "12"
  };
  const name = String(fileName || "");
  const monthMatch = name.match(/\b([A-Za-z]{3,9})\s*['’]?\s*(\d{2,4})\b/);
  if (monthMatch) {
    const mm = monthMap[monthMatch[1].toLowerCase()];
    let yyyy = monthMatch[2];
    if (mm) {
      if (yyyy.length === 2) yyyy = `20${yyyy}`;
      return `${yyyy}-${mm}`;
    }
  }
  const compactDate = name.match(/(20\d{2})[-_\.]?(0[1-9]|1[0-2])(?:[-_\.]?\d{0,2})?/);
  if (compactDate) return `${compactDate[1]}-${compactDate[2]}`;
  return "";
}


function stripXmlTags(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function parseReportMonthFromWorkbookBuffer(buffer) {
  if (!window.JSZip) return "";
  try {
    const zip = await JSZip.loadAsync(buffer);
    const candidates = [];
    const preferredFiles = [
      "xl/sharedStrings.xml",
      "docProps/core.xml",
      "docProps/app.xml",
      "xl/workbook.xml"
    ];

    for (const path of preferredFiles) {
      const file = zip.file(path);
      if (file) candidates.push(stripXmlTags(await file.async("text")));
    }

    const drawingFiles = zip.file(/^xl\/drawings\/.*\.xml$/) || [];
    for (const file of drawingFiles) {
      candidates.push(stripXmlTags(await file.async("text")));
    }

    for (const text of candidates) {
      const detected = parseReportMonth(text);
      if (detected) return detected;
    }
  } catch (error) {
    log(`Workbook 내부 Report Month 자동감지 실패: ${error?.message || error}`);
  }
  return "";
}

function reportMonthGuide(fileName) {
  const assyLike = /assy/i.test(fileName || "") || /^\d+\.xlsx$/i.test(fileName || "");
  const example = assyLike ? "ASSY-MNT-Monthly Report (Jun'26).xlsx" : "BUMP-MNT-Monthly Report_(Jun'26).xlsx";
  return `${fileName}: 파일명 또는 파일 내부 제목에서 Report Month를 찾지 못했습니다. 파일명을 ${example} 처럼 바꿔주세요. 예: Jun'26 / May'26 / 2026-06`;
}

function safeKey(value) {
  return encodeURIComponent(normalizeText(value)).replace(/%/g, "~");
}

function makeDedupeKey(row) {
  const type = row.reportType || "BUMP";
  if (type === "ASSY") {
    return ["ASSY", row.reportMonth, row.sheetName, row.device, row.process, row.characteristics]
      .map(safeKey)
      .join("__");
  }
  return [row.reportMonth, row.sheetName, row.product, row.item, row.dataType]
    .map(safeKey)
    .join("__");
}

function formatDateTime(value) {
  if (!value) return "";
  if (value.toDate) return value.toDate().toLocaleString();
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}

function getCell(row, idx) {
  if (idx === undefined || idx === null || idx < 0) return null;
  return row[idx] ?? null;
}

function isMeaningfulText(value) {
  const text = normalizeText(value);
  return /[A-Za-z가-힣]/.test(text);
}

function isLikelyName(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (/^[-+]?\d+(?:\.\d+)?$/.test(text)) return false;
  return isMeaningfulText(text);
}

function isReasonableCapabilityValue(value) {
  const num = normalizeNumber(value);
  return num !== null && num >= 0 && num <= 100;
}

function hasCapabilityValue(cpk, ppk) {
  return isReasonableCapabilityValue(cpk) || isReasonableCapabilityValue(ppk);
}

function hasAnyNumericMeasurement(...values) {
  return values.some(value => normalizeNumber(value) !== null);
}

function isValidCpkRecord(row) {
  if (!/^\d{4}-\d{2}$/.test(row?.reportMonth || "")) return false;
  const hasCapability = hasCapabilityValue(row.cpk, row.ppk);
  const hasMeasurement = hasAnyNumericMeasurement(row.min, row.max, row.avg, row.std, row.sampleSize, row.lots, row.qty);
  if (!hasCapability && !hasMeasurement) return false;
  if ((row.reportType || "BUMP") === "ASSY") {
    return isLikelyName(row.device) && isLikelyName(row.process) && isLikelyName(row.characteristics);
  }
  return isLikelyName(row.product) && isLikelyName(row.item);
}

function buildHeaderIndex(row) {
  const index = {};
  (row || []).forEach((value, idx) => {
    const key = headerKey(value);
    if (!key) return;
    index[key] = idx;
  });
  return index;
}

function hasHeader(index, keys) {
  return keys.every(key => index[key] !== undefined);
}

function findBumpHeader(rows) {
  for (let r = 0; r < rows.length; r++) {
    const index = buildHeaderIndex(rows[r]);
    if (hasHeader(index, ["product", "item", "cpk", "ppk"])) return { rowIndex: r, index };
  }
  return null;
}

function findAssyHeader(rows) {
  for (let r = 0; r < rows.length; r++) {
    const index = buildHeaderIndex(rows[r]);
    if (hasHeader(index, ["process", "characteristics", "cpk", "ppk"])) return { rowIndex: r, index };
  }
  return null;
}

function firstIndex(index, keys) {
  for (const key of keys) if (index[key] !== undefined) return index[key];
  return undefined;
}

function parseBumpRowsArray(sheetName, rows, fileName, reportMonth) {
  const header = findBumpHeader(rows);
  if (!header) return [];
  if (!reportMonth) throw new Error(`${fileName}: 파일명에서 Report Month를 찾지 못했습니다. 예: BUMP-MNT-Monthly Report_(May'26).xlsx`);

  const idx = header.index;
  const idxDataType = firstIndex(idx, ["datatype"]);
  const idxSpec = firstIndex(idx, ["speclimit"]);
  const idxSample = firstIndex(idx, ["s/s", "ss"]);
  const idxMin = firstIndex(idx, ["min"]);
  const idxMax = firstIndex(idx, ["max"]);
  const idxAvg = firstIndex(idx, ["avg"]);
  const idxStd = firstIndex(idx, ["std", "dev"]);

  let currentProduct = "";
  const output = [];

  for (let r = header.rowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const productCell = normalizeText(getCell(row, idx.product));
    if (isLikelyName(productCell)) currentProduct = productCell;

    const product = currentProduct;
    const item = normalizeText(getCell(row, idx.item));
    const dataType = normalizeText(getCell(row, idxDataType)) || "Blank";
    const cpk = normalizeNumber(getCell(row, idx.cpk));
    const ppk = normalizeNumber(getCell(row, idx.ppk));
    const min = normalizeNumber(getCell(row, idxMin));
    const max = normalizeNumber(getCell(row, idxMax));
    const avg = normalizeNumber(getCell(row, idxAvg));
    const std = normalizeNumber(getCell(row, idxStd));
    const sampleSize = normalizeNumber(getCell(row, idxSample));
    const lots = normalizeNumber(getCell(row, idx.lots));

    if (!isLikelyName(product) || !isLikelyName(item)) continue;
    if (!hasCapabilityValue(cpk, ppk) && !hasAnyNumericMeasurement(min, max, avg, std, sampleSize, lots)) continue;

    const record = {
      schemaVersion: APP_VERSION,
      reportType: "BUMP",
      reportMonth,
      reportLabel: monthLabel(reportMonth),
      sheetName,
      product,
      item,
      dataType,
      target: getCell(row, idx.target),
      specLimit: getCell(row, idxSpec),
      frequency: getCell(row, firstIndex(idx, ["freq"])),
      sampleSize,
      lots,
      min,
      max,
      avg,
      std,
      cpk,
      ppk,
      sourceFileName: fileName,
      uploadedAt: serverTimestamp()
    };
    record.dedupeKey = makeDedupeKey(record);
    output.push(record);
  }
  return output;
}

function parseAssyRowsArray(sheetName, rows, fileName, reportMonth) {
  const header = findAssyHeader(rows);
  if (!header) return [];
  if (!reportMonth) throw new Error(`${fileName}: 파일명에서 Report Month를 찾지 못했습니다. 예: ASSY-MNT-Monthly Report (May'26).xlsx`);
  if (/chart/i.test(sheetName)) return [];

  const idx = header.index;
  const idxPkg = firstIndex(idx, ["pkg"]);
  const idxProcess = firstIndex(idx, ["process"]);
  const idxChar = firstIndex(idx, ["characteristics", "characteristic"]);
  const idxSpec = firstIndex(idx, ["speclimit"]);
  const idxSample = firstIndex(idx, ["s/s", "ss"]);
  const idxQty = firstIndex(idx, ["q'ty", "qty", "quantity"]);
  const idxMin = firstIndex(idx, ["min"]);
  const idxMax = firstIndex(idx, ["max"]);
  const idxAvg = firstIndex(idx, ["avg"]);
  const idxStd = firstIndex(idx, ["dev", "std"]);

  const device = sheetName;
  let currentPkg = "";
  let currentProcess = "";
  const output = [];

  for (let r = header.rowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const pkgCell = normalizeText(getCell(row, idxPkg));
    const processCell = normalizeText(getCell(row, idxProcess));
    const characteristic = normalizeText(getCell(row, idxChar));

    if (isLikelyName(pkgCell)) currentPkg = pkgCell;
    if (isLikelyName(processCell)) currentProcess = processCell;
    if (!isLikelyName(currentProcess) || !isLikelyName(characteristic)) continue;

    const cpk = normalizeNumber(getCell(row, idx.cpk));
    const ppk = normalizeNumber(getCell(row, idx.ppk));
    const min = normalizeNumber(getCell(row, idxMin));
    const max = normalizeNumber(getCell(row, idxMax));
    const avg = normalizeNumber(getCell(row, idxAvg));
    const std = normalizeNumber(getCell(row, idxStd));
    const sampleSize = normalizeNumber(getCell(row, idxSample));
    const lots = normalizeNumber(getCell(row, idx.lots));
    const qty = normalizeNumber(getCell(row, idxQty));
    if (!hasCapabilityValue(cpk, ppk) && !hasAnyNumericMeasurement(min, max, avg, std, sampleSize, lots, qty)) continue;

    const record = {
      schemaVersion: APP_VERSION,
      reportType: "ASSY",
      reportMonth,
      reportLabel: monthLabel(reportMonth),
      sheetName,
      device,
      packageName: currentPkg,
      process: currentProcess,
      characteristics: characteristic,
      // Rule compatibility. Existing Firestore rule requires product and item.
      product: device,
      item: characteristic,
      dataType: currentProcess,
      target: "",
      specLimit: getCell(row, idxSpec),
      frequency: getCell(row, firstIndex(idx, ["freq"])),
      sampleSize,
      lots,
      qty,
      min,
      max,
      avg,
      std,
      cpk,
      ppk,
      sourceFileName: fileName,
      uploadedAt: serverTimestamp()
    };
    record.dedupeKey = makeDedupeKey(record);
    output.push(record);
  }
  return output;
}

function parseRowsArray(sheetName, rows, fileName, reportMonth) {
  const bumpRows = parseBumpRowsArray(sheetName, rows, fileName, reportMonth);
  if (bumpRows.length) return bumpRows;
  return parseAssyRowsArray(sheetName, rows, fileName, reportMonth);
}

function parseSheetRows(sheetName, sheet, fileName, reportMonth) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
  return parseRowsArray(sheetName, rows, fileName, reportMonth);
}

function parseWorkbookWithSheetJS(buffer, fileName, reportMonth) {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    cellStyles: false,
    cellHTML: false,
    cellFormula: false,
    cellNF: false,
    cellText: false,
    sheetStubs: false,
    bookDeps: false,
    bookVBA: false,
    WTF: false
  });
  let output = [];
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    output = output.concat(parseSheetRows(sheetName, sheet, fileName, reportMonth));
  });
  return output;
}

function xmlDoc(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function xmlElements(parent, localName) {
  return Array.from(parent.getElementsByTagName("*")).filter(node => node.localName === localName);
}

function xmlFirstText(parent, localName) {
  const node = xmlElements(parent, localName)[0];
  return node ? node.textContent : "";
}

function colRefToIndex(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function resolveZipPath(basePath, target) {
  const cleanTarget = String(target || "").replace(/^\//, "");
  if (cleanTarget.startsWith("xl/")) return cleanTarget;
  const baseParts = basePath.split("/");
  baseParts.pop();
  cleanTarget.split("/").forEach(part => {
    if (!part || part === ".") return;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  });
  return baseParts.join("/");
}

async function zipText(zip, path) {
  const file = zip.file(path);
  return file ? await file.async("text") : "";
}

function parseSharedStrings(sharedXml) {
  if (!sharedXml) return [];
  const doc = xmlDoc(sharedXml);
  return xmlElements(doc, "si").map(si => xmlElements(si, "t").map(t => t.textContent || "").join(""));
}

function parseSheetXmlToRows(sheetXml, sharedStrings) {
  const doc = xmlDoc(sheetXml);
  const rows = [];
  xmlElements(doc, "row").forEach(rowNode => {
    const rAttr = Number(rowNode.getAttribute("r"));
    const rowIndex = Number.isFinite(rAttr) && rAttr > 0 ? rAttr - 1 : rows.length;
    rows[rowIndex] = rows[rowIndex] || [];
    const row = rows[rowIndex];

    xmlElements(rowNode, "c").forEach(cellNode => {
      const colIndex = colRefToIndex(cellNode.getAttribute("r"));
      if (colIndex < 0) return;
      const type = cellNode.getAttribute("t") || "";
      let value = "";

      if (type === "s") {
        const idx = Number(xmlFirstText(cellNode, "v"));
        value = sharedStrings[idx] ?? "";
      } else if (type === "inlineStr") {
        value = xmlElements(cellNode, "t").map(t => t.textContent || "").join("");
      } else {
        value = xmlFirstText(cellNode, "v");
        if (type !== "str" && type !== "b" && value !== "") {
          const num = Number(value);
          if (Number.isFinite(num)) value = num;
        }
      }
      row[colIndex] = value;
    });
  });
  return rows.filter(row => row && row.some(cell => normalizeText(cell) !== ""));
}

async function parseWorkbookWithXmlFallback(buffer, fileName, reportMonth) {
  if (!window.JSZip) throw new Error("JSZip fallback parser가 로드되지 않았습니다.");
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zipText(zip, "xl/workbook.xml");
  const relsXml = await zipText(zip, "xl/_rels/workbook.xml.rels");
  const sharedXml = await zipText(zip, "xl/sharedStrings.xml");
  if (!workbookXml || !relsXml) throw new Error("workbook.xml 또는 workbook 관계 파일을 찾지 못했습니다.");

  const workbookDoc = xmlDoc(workbookXml);
  const relsDoc = xmlDoc(relsXml);
  const sharedStrings = parseSharedStrings(sharedXml);
  const relMap = new Map();
  xmlElements(relsDoc, "Relationship").forEach(rel => {
    relMap.set(rel.getAttribute("Id"), rel.getAttribute("Target"));
  });

  const sheetInfos = [];
  xmlElements(workbookDoc, "sheet").forEach(sheetNode => {
    const sheetName = sheetNode.getAttribute("name") || "Sheet";
    const relId = sheetNode.getAttribute("r:id") || sheetNode.getAttribute("id");
    const target = relMap.get(relId);
    if (!target) return;
    const sheetPath = resolveZipPath("xl/workbook.xml", target);
    if (zip.file(sheetPath)) sheetInfos.push({ sheetName, sheetPath });
  });

  const parsed = [];
  for (const sheetInfo of sheetInfos) {
    const sheetXml = await zip.file(sheetInfo.sheetPath).async("text");
    const rows = parseSheetXmlToRows(sheetXml, sharedStrings);
    parsed.push(...parseRowsArray(sheetInfo.sheetName, rows, fileName, reportMonth));
  }
  return parsed;
}

function delay(ms) {
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

async function readBlobChunk(blob) {
  if (blob.arrayBuffer) return await blob.arrayBuffer();
  return await readFileWithFileReader(blob);
}

async function readFileByChunks(file, chunkSize = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, file.size);
    const buffer = await readBlobChunk(file.slice(offset, end));
    chunks.push(new Uint8Array(buffer));
    total += buffer.byteLength;
    if (chunks.length % 8 === 0) await delay(0);
  }
  const merged = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    merged.set(chunk, position);
    position += chunk.length;
  }
  return merged.buffer;
}

function isReadableZipBuffer(buffer) {
  const bytes = new Uint8Array(buffer || []);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function formatFileError(error) {
  if (!error) return "unknown";
  const name = error.name || "Error";
  const message = error.message || String(error);
  return `${name}: ${message}`;
}

async function probeFileHeader(file) {
  try {
    const head = await readBlobChunk(file.slice(0, 4));
    const bytes = new Uint8Array(head || []);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ok = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    log(`${file.name}: header probe ${ok ? "OK" : "NOT XLSX"} (${hex || "empty"})`);
    if (!ok) throw new Error(`파일 첫 4byte가 XLSX/ZIP 시그니처(PK)가 아닙니다. header=${hex || "empty"}`);
  } catch (error) {
    throw new Error(`${file.name}: 파일 첫 4byte부터 읽기 실패했습니다. Excel 내용/공식/텍스트박스 문제가 아니라 Windows/브라우저가 선택한 파일 원본에 접근하지 못하는 상태입니다. Detail=${formatFileError(error)}`);
  }
}

async function readFileBuffer(file) {
  const failures = [];
  if (!file || typeof file.size !== "number") throw new Error("유효한 File 객체가 아닙니다. 파일 선택창에서 다시 선택해주세요.");
  if (file.size === 0) throw new Error(`${file.name}: file size가 0 byte입니다. 원본 파일을 다시 저장한 뒤 선택해주세요.`);
  log(`Reading ${file.name} / ${(file.size / 1024).toFixed(1)} KB / ${file.type || "unknown type"} / modified ${file.lastModified ? new Date(file.lastModified).toLocaleString() : "unknown"}`);

  await probeFileHeader(file);

  const readers = [
    { name: "file-arrayBuffer", fn: () => file.arrayBuffer ? file.arrayBuffer() : Promise.reject(new Error("arrayBuffer unavailable")) },
    { name: "FileReader-arrayBuffer", fn: () => readFileWithFileReader(file) },
    { name: "chunked-slice", fn: () => readFileByChunks(file, 16 * 1024) },
    { name: "FileReader-dataURL", fn: () => readFileAsDataUrl(file) },
    { name: "FileReader-binaryString", fn: () => readFileAsBinaryString(file) },
    { name: "file-stream", fn: () => file.stream ? new Response(file.stream()).arrayBuffer() : Promise.reject(new Error("stream unavailable")) }
  ];

  for (const reader of readers) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const buffer = await reader.fn();
        if (!isReadableZipBuffer(buffer)) throw new Error(`${reader.name} returned non-xlsx buffer`);
        log(`${file.name}: ${reader.name} reader success. bytes=${buffer.byteLength || 0}`);
        return buffer;
      } catch (error) {
        const detail = `${reader.name} ${attempt}/2 -> ${formatFileError(error)}`;
        failures.push(detail);
        log(`${file.name}: reader failed. ${detail}`);
        await delay(150 * attempt);
      }
    }
  }

  throw new Error(`${file.name}: Browser가 파일 byte 전체를 못 읽었습니다. 파일 첫 header는 보였지만 전체 ArrayBuffer 읽기에 실패했습니다. 이 단계는 XLSX parser 전이라 공식/텍스트박스/시트 구조와 무관합니다. 실패 내역=${failures.join(" | ")} / 조치: Excel 완전 종료 → 파일을 C:\\Temp 같은 OneDrive 아닌 로컬 폴더에 새 이름으로 저장 → Chrome/Edge 새 창에서 다시 선택. 그래도 같으면 회사 보안/동기화/파일잠금이 File API 읽기를 막는 케이스입니다.`);
}

async function readExcelBuffer(fileName, buffer) {
  let reportMonth = parseReportMonth(fileName);
  if (!reportMonth) {
    reportMonth = await parseReportMonthFromWorkbookBuffer(buffer);
    if (reportMonth) log(`${fileName}: Report Month를 파일 내부 텍스트에서 자동감지했습니다. (${monthLabel(reportMonth)})`);
  }
  if (!reportMonth) throw new Error(reportMonthGuide(fileName));
  let output = [];
  let sheetJsError = null;

  try {
    output = parseWorkbookWithSheetJS(buffer, fileName, reportMonth);
  } catch (error) {
    sheetJsError = error;
    log(`${fileName}: SheetJS parse warning. XML fallback으로 재시도합니다. (${error.message})`);
  }

  if (!output.length) {
    try {
      const fallbackRows = await parseWorkbookWithXmlFallback(buffer, fileName, reportMonth);
      if (fallbackRows.length) {
        output = fallbackRows;
        log(`${fileName}: XML fallback parser로 ${fallbackRows.length} row 추출.`);
      }
    } catch (fallbackError) {
      if (sheetJsError) throw new Error(`${fileName}: SheetJS parse 실패 및 XML fallback 실패. SheetJS=${sheetJsError.message} / Fallback=${fallbackError.message}`);
      log(`${fileName}: XML fallback warning. ${fallbackError.message}`);
    }
  }

  if (!output.length) throw new Error(`${fileName}: BUMP 또는 ASSY CPK/PPK header를 찾지 못했거나 유효 row가 없습니다.`);
  const validOutput = output.filter(isValidCpkRecord);
  if (validOutput.length !== output.length) log(`${fileName}: invalid parsed rows skipped ${output.length - validOutput.length}.`);
  if (!validOutput.length) throw new Error(`${fileName}: CPK / PPK 데이터를 올바르게 추출하지 못했습니다.`);
  const typeSummary = countBy(validOutput, row => row.reportType || "BUMP");
  log(`${fileName}: ${monthLabel(reportMonth)}, ${validOutput.length} rows read. ${JSON.stringify(typeSummary)}`);
  return validOutput;
}

async function readExcelFile(file) {
  const buffer = await readFileBuffer(file);
  return await readExcelBuffer(file.name, buffer);
}

function countBy(rows, fn) {
  const obj = {};
  rows.forEach(row => {
    const key = fn(row);
    obj[key] = (obj[key] || 0) + 1;
  });
  return obj;
}

function normalizeExcelEntries(entries) {
  return Array.from(entries || []).filter(entry => entry && entry.name && /\.xls[xm]?$/.test(entry.name.toLowerCase()));
}

function fileToEntry(file) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    readRows: () => readExcelFile(file)
  };
}

async function handleExcelEntries(entries, sourceLabel = "File API") {
  const incomingEntries = normalizeExcelEntries(entries);
  selectedFiles = incomingEntries.map(entry => ({
    name: entry.name,
    size: entry.size || 0,
    type: entry.type || sourceLabel,
    lastModified: entry.lastModified || 0
  }));
  selectedRows = [];
  fileReadStatus = new Map(selectedFiles.map(file => [file.name, "대기 중"]));
  renderSelectedFileList();

  if (!incomingEntries.length) {
    log("Excel file이 선택되지 않았습니다.");
    updateMetrics({ selected: 0 });
    setBusy(false);
    return;
  }

  setBusy(true);
  let readFailed = false;
  try {
    for (const entry of incomingEntries) {
      try {
        fileReadStatus.set(entry.name, `reading... (${sourceLabel})`);
        renderSelectedFileList();
        const rows = await entry.readRows();
        selectedRows = selectedRows.concat(rows);
        const typeSummary = countBy(rows, row => row.reportType || "BUMP");
        fileReadStatus.set(entry.name, `${rows.length} rows ${JSON.stringify(typeSummary)}`);
        renderSelectedFileList();
      } catch (error) {
        readFailed = true;
        console.error(error);
        fileReadStatus.set(entry.name, "Read failed");
        setFirebaseStatus("File read error", "danger");
        log(`Read Error: ${error.message}`);
        renderSelectedFileList();
      }
    }
    updateMetrics({ selected: selectedRows.length });
    if (selectedRows.length) await uploadSelectedRows();
    else if (readFailed) log("읽힌 row가 없습니다. 파일 접근 권한 또는 Excel 파일 형식을 확인해주세요.");
  } finally {
    if (el.excelFiles) el.excelFiles.value = "";
    setBusy(false);
  }
}

async function handleFiles(files) {
  return handleExcelEntries(Array.from(files || []).map(fileToEntry), "File API");
}


function renderSelectedFileList() {
  if (!selectedFiles.length) {
    el.selectedFileList.innerHTML = `<li class="empty-li">선택된 파일이 없습니다.</li>`;
    return;
  }
  el.selectedFileList.innerHTML = selectedFiles.map(file => {
    const status = fileReadStatus.get(file.name) || "대기 중";
    const cls = String(status).toLowerCase().includes("failed") ? "danger-text" : "";
    return `<li><span>${escapeHtml(file.name)}</span><b class="${cls}">${escapeHtml(status)}</b></li>`;
  }).join("");
}

async function uploadSelectedRows() {
  if (!db || !currentUser) { log("Firebase Auth가 아직 준비되지 않았습니다."); return; }
  if (!selectedRows.length) { log("Upload할 row가 없습니다."); return; }

  setBusy(true);
  let inserted = 0;
  let skipped = 0;
  try {
    const snapshot = await getDocs(collection(db, COLLECTION_NAME));
    const existingKeys = new Set(snapshot.docs.map(d => d.id));
    let batch = writeBatch(db);
    let batchCount = 0;

    for (const row of selectedRows) {
      if (existingKeys.has(row.dedupeKey)) { skipped++; continue; }
      const ref = doc(db, COLLECTION_NAME, row.dedupeKey);
      batch.set(ref, row, { merge: true });
      existingKeys.add(row.dedupeKey);
      inserted++;
      batchCount++;
      if (batchCount >= BATCH_LIMIT) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    if (batchCount > 0) await batch.commit();
    updateMetrics({ inserted, skipped });
    log(`Upload complete. Inserted ${inserted}, skipped duplicate ${skipped}.`);
    await loadFirestoreData();
  } catch (error) {
    console.error(error);
    log(`Upload Error: ${error.message}`);
    setFirebaseStatus("Firestore upload error", "danger");
  } finally { setBusy(false); }
}

async function loadFirestoreData() {
  if (!db || !currentUser) return;
  setBusy(true);
  try {
    const snapshot = await getDocs(collection(db, COLLECTION_NAME));
    const allRows = snapshot.docs.map(docSnap => ({ id: docSnap.id, reportType: "BUMP", ...docSnap.data() }));
    const hiddenRows = allRows.filter(row => !isValidCpkRecord(row)).length;
    rawRows = allRows.filter(isValidCpkRecord);
    rawRows.sort((a, b) => sortByMonth(a, b) || String(a.reportType).localeCompare(String(b.reportType)) || String(a.product).localeCompare(String(b.product)) || String(a.item).localeCompare(String(b.item)));
    if (hiddenRows) log(`Malformed/old MNT rows hidden: ${hiddenRows}.`);
    buildUploadedFileRows();
    refreshMonthOptions();
    refreshFilters();
    renderUploadedFiles();
    renderTrend();
    updateMetrics({ firestore: rawRows.length });
    log(`Firestore loaded. ${rawRows.length} rows.`);
  } catch (error) {
    console.error(error);
    log(`Firestore Load Error: ${error.message}`);
    setFirebaseStatus("Firestore read error", "danger");
  } finally { setBusy(false); }
}

function buildUploadedFileRows() {
  const map = new Map();
  rawRows.forEach(row => {
    const key = row.sourceFileName || "Unknown";
    if (!map.has(key)) {
      map.set(key, { sourceFileName: key, count: 0, months: new Set(), entities: new Set(), types: new Set(), lastUploaded: row.uploadedAt });
    }
    const item = map.get(key);
    item.count++;
    item.months.add(row.reportMonth);
    item.entities.add((row.reportType || "BUMP") === "ASSY" ? row.device : row.product);
    item.types.add(row.reportType || "BUMP");
    if (row.uploadedAt) item.lastUploaded = row.uploadedAt;
  });
  uploadedFileRows = Array.from(map.values()).map(item => ({
    sourceFileName: item.sourceFileName,
    count: item.count,
    months: Array.from(item.months).sort().map(monthLabel).join(", "),
    entities: item.entities.size,
    types: Array.from(item.types).sort().join(" / "),
    lastUploaded: item.lastUploaded
  })).sort((a, b) => a.sourceFileName.localeCompare(b.sourceFileName));
}

function updateMetrics(patch = {}) {
  if (patch.selected !== undefined) el.selectedRows.textContent = patch.selected.toLocaleString();
  if (patch.inserted !== undefined) el.insertedRows.textContent = patch.inserted.toLocaleString();
  if (patch.skipped !== undefined) el.skippedRows.textContent = patch.skipped.toLocaleString();
  el.firestoreRows.textContent = rawRows.length.toLocaleString();
  const entitySet = new Set(rawRows.map(row => (row.reportType || "BUMP") === "ASSY" ? row.device : row.product).filter(Boolean));
  el.productCount.textContent = entitySet.size.toLocaleString();
  el.uploadedFiles.textContent = uploadedFileRows.length.toLocaleString();
}

function renderUploadedFiles() {
  if (!uploadedFileRows.length) {
    el.uploadedFilesBody.innerHTML = `<tr><td colspan="6" class="empty">아직 Upload된 파일이 없습니다.</td></tr>`;
    return;
  }
  el.uploadedFilesBody.innerHTML = uploadedFileRows.map(row => `
    <tr>
      <td>${escapeHtml(row.sourceFileName)}</td>
      <td>${escapeHtml(row.types)}</td>
      <td class="number">${row.count.toLocaleString()}</td>
      <td>${escapeHtml(row.months)}</td>
      <td class="number">${row.entities.toLocaleString()}</td>
      <td>${escapeHtml(formatDateTime(row.lastUploaded))}</td>
    </tr>
  `).join("");
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
}

function setSelectOptions(select, values, currentValue, includeAll = false, emptyLabel = "No data") {
  if (!select) return;
  const opts = [];
  if (includeAll) opts.push({ value: "__ALL__", label: "All" });
  values.forEach(value => opts.push({ value, label: value }));
  if (!opts.length) opts.push({ value: "", label: emptyLabel });
  select.innerHTML = opts.map(opt => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("");
  if (currentValue && opts.some(opt => opt.value === currentValue)) select.value = currentValue;
  else select.value = opts[0].value;
}

function refreshMonthOptions() {
  const bumpMonths = uniqueSorted(rawRows.filter(row => (row.reportType || "BUMP") === "BUMP").map(row => row.reportMonth));
  const assyMonths = uniqueSorted(rawRows.filter(row => row.reportType === "ASSY").map(row => row.reportMonth));

  const prevBump = el.trendStartMonthSelect.value || trendStartMonth;
  const prevAssy = el.assyStartMonthSelect.value || assyTrendStartMonth;

  const makeOptions = months => months.map(month => `<option value="${escapeHtml(month)}">${escapeHtml(monthLongLabel(month))} ~ ${escapeHtml(monthLongLabel(addMonths(month, 12)))}</option>`).join("");

  if (bumpMonths.length) {
    el.trendStartMonthSelect.innerHTML = makeOptions(bumpMonths);
    trendStartMonth = prevBump && bumpMonths.includes(prevBump) ? prevBump : bumpMonths[Math.max(0, bumpMonths.length - 12)];
    el.trendStartMonthSelect.value = trendStartMonth;
  } else {
    trendStartMonth = "";
    el.trendStartMonthSelect.innerHTML = `<option value="">No data</option>`;
  }

  if (assyMonths.length) {
    el.assyStartMonthSelect.innerHTML = makeOptions(assyMonths);
    assyTrendStartMonth = prevAssy && assyMonths.includes(prevAssy) ? prevAssy : assyMonths[Math.max(0, assyMonths.length - 12)];
    el.assyStartMonthSelect.value = assyTrendStartMonth;
  } else {
    assyTrendStartMonth = "";
    el.assyStartMonthSelect.innerHTML = `<option value="">No data</option>`;
  }
}

function refreshFilters() {
  refreshBumpFilters();
  refreshAssyFilters();
}

function bumpRows() { return rawRows.filter(row => (row.reportType || "BUMP") === "BUMP"); }
function assyRows() { return rawRows.filter(row => row.reportType === "ASSY"); }

function refreshBumpFilters() {
  const prevProduct = el.productSelect.value;
  const prevDataType = el.dataTypeSelect.value;
  const products = uniqueSorted(bumpRows().map(row => row.product));
  setSelectOptions(el.productSelect, products, prevProduct, false);
  const selectedProduct = el.productSelect.value;
  const productRows = bumpRows().filter(row => row.product === selectedProduct);
  const dataTypes = uniqueSorted(productRows.map(row => row.dataType || "Blank"));
  setSelectOptions(el.dataTypeSelect, dataTypes, prevDataType, true);
}

function refreshAssyFilters() {
  const prevDevice = el.assyDeviceSelect.value;
  const devices = uniqueSorted(assyRows().map(row => row.device));
  setSelectOptions(el.assyDeviceSelect, devices, prevDevice, false);
}

function getFilteredBumpRows() {
  const product = el.productSelect.value;
  const dataType = el.dataTypeSelect.value;
  return bumpRows().filter(row => {
    if (!isMonthInWindow(row.reportMonth, trendStartMonth)) return false;
    if (product && row.product !== product) return false;
    const rowDataType = row.dataType || "Blank";
    if (dataType && dataType !== "__ALL__" && rowDataType !== dataType) return false;
    return true;
  }).sort(sortByMonth);
}

function getFilteredAssyRows() {
  const device = el.assyDeviceSelect.value;
  return assyRows().filter(row => {
    if (!isMonthInWindow(row.reportMonth, assyTrendStartMonth)) return false;
    if (device && row.device !== device) return false;
    return true;
  }).sort(sortByMonth);
}

function average(values) {
  const nums = values.filter(value => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function buildTrendRows(rows, mode) {
  const map = new Map();
  rows.forEach(row => {
    if (!row.reportMonth) return;
    const dataTypeForGroup = mode === "BUMP" ? (el.dataTypeSelect.value === "__ALL__" ? "All" : (row.dataType || "Blank")) : "";
    const key = mode === "BUMP"
      ? [row.reportMonth, row.product, row.item, dataTypeForGroup].join("__")
      : [row.reportMonth, row.device, row.process, row.characteristics].join("__");

    if (!map.has(key)) {
      map.set(key, {
        reportMonth: row.reportMonth,
        reportLabel: monthLabel(row.reportMonth),
        product: row.product,
        item: row.item,
        dataType: dataTypeForGroup,
        device: row.device,
        process: row.process,
        characteristics: row.characteristics,
        target: row.target ?? "",
        specLimit: row.specLimit ?? "",
        sampleSize: 0,
        lots: 0,
        qty: 0,
        minValues: [],
        maxValues: [],
        avgValues: [],
        stdValues: [],
        cpkValues: [],
        ppkValues: [],
        rowCount: 0
      });
    }
    const item = map.get(key);
    item.rowCount++;
    item.sampleSize += normalizeNumber(row.sampleSize) || 0;
    item.lots += normalizeNumber(row.lots) || 0;
    item.qty += normalizeNumber(row.qty) || 0;
    ["min", "max", "avg", "std", "cpk", "ppk"].forEach(field => {
      const value = normalizeNumber(row[field]);
      if (value !== null) item[`${field}Values`].push(value);
    });
  });

  return Array.from(map.values()).map(row => ({
    reportMonth: row.reportMonth,
    reportLabel: row.reportLabel,
    product: row.product,
    item: row.item,
    dataType: row.dataType,
    device: row.device,
    process: row.process,
    characteristics: row.characteristics,
    target: row.target,
    specLimit: row.specLimit,
    sampleSize: row.sampleSize || null,
    lots: row.lots || null,
    qty: row.qty || null,
    min: average(row.minValues),
    max: average(row.maxValues),
    avg: average(row.avgValues),
    std: average(row.stdValues),
    cpk: average(row.cpkValues),
    ppk: average(row.ppkValues),
    rowCount: row.rowCount
  })).sort((a, b) => {
    const monthOrder = sortByMonth(a, b);
    if (monthOrder) return monthOrder;
    if (mode === "BUMP") return String(a.item).localeCompare(String(b.item)) || String(a.dataType).localeCompare(String(b.dataType));
    return String(a.process).localeCompare(String(b.process)) || String(a.characteristics).localeCompare(String(b.characteristics));
  });
}

function renderTrend() {
  const filteredBump = getFilteredBumpRows();
  trendRows = buildTrendRows(filteredBump, "BUMP");
  renderBumpTrendChart();
  renderBumpTrendTable();

  const filteredAssy = getFilteredAssyRows();
  assyTrendRows = buildTrendRows(filteredAssy, "ASSY");
  renderAssyTrendChart();
  renderAssyTrendTable();

  renderLowTable();
}

function destroyChartList(charts) {
  charts.forEach(chart => chart.destroy());
  charts.length = 0;
}

function makeChartCard(container, title, height = 250) {
  const card = document.createElement("div");
  card.className = "chart-card";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const canvas = document.createElement("canvas");
  canvas.height = height;
  card.appendChild(heading);
  card.appendChild(canvas);
  container.appendChild(card);
  return canvas;
}

function renderEmptyChartContainer(container, message) {
  if (!container) return;
  container.innerHTML = `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function groupRowsBy(rows, keyFn, titleFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return Array.from(grouped.entries()).map(([key, items]) => ({ key, title: titleFn(items[0]), rows: items.sort(sortByMonth) }));
}

function chartOptions(title, yTitle) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      title: { display: true, text: title },
      legend: { position: "bottom" },
      tooltip: { callbacks: { label: context => `${context.dataset.label}: ${fmtNumber(context.parsed.y, 4)}` } }
    },
    scales: {
      y: { beginAtZero: true, title: { display: true, text: yTitle } }
    }
  };
}

function trendDatasets(rows) {
  return [
    { label: "CPK", data: rows.map(row => row.cpk), tension: 0.28, borderWidth: 2.5, pointRadius: 4, spanGaps: true },
    { label: "PPK", data: rows.map(row => row.ppk), tension: 0.28, borderWidth: 2.5, pointRadius: 4, spanGaps: true },
    { label: "Limit 1.67", data: rows.map(() => CPK_LIMIT_HIGH), borderDash: [6, 5], pointRadius: 0, borderWidth: 1.5 },
    { label: "Limit 1.33", data: rows.map(() => CPK_LIMIT_LOW), borderDash: [3, 4], pointRadius: 0, borderWidth: 1.5 }
  ];
}

function renderBumpTrendChart() {
  if (!el.cpkTrendCharts) return;
  destroyChartList(cpkTrendCharts);
  el.cpkTrendCharts.innerHTML = "";
  if (!trendRows.length) {
    renderEmptyChartContainer(el.cpkTrendCharts, "선택된 Product의 Item Trend Data가 없습니다.");
    return;
  }

  const groups = groupRowsBy(
    trendRows,
    row => `${row.item || "Blank Item"}__${row.dataType || "All"}`,
    row => `${el.productSelect.value || "Product"} / ${row.item || "Blank Item"}${row.dataType && row.dataType !== "All" ? ` / ${row.dataType}` : ""}`
  );

  groups.forEach(group => {
    const labels = group.rows.map(row => row.reportLabel || monthLabel(row.reportMonth));
    const canvas = makeChartCard(el.cpkTrendCharts, group.title);
    cpkTrendCharts.push(new Chart(canvas, {
      type: "line",
      data: { labels, datasets: trendDatasets(group.rows) },
      options: chartOptions(group.title, "CPK / PPK")
    }));
  });
}

function renderAssyTrendChart() {
  if (!el.assyTrendCharts) return;
  destroyChartList(assyTrendCharts);
  el.assyTrendCharts.innerHTML = "";
  if (!assyTrendRows.length) {
    renderEmptyChartContainer(el.assyTrendCharts, "선택된 Device의 Process / Characteristics Trend Data가 없습니다.");
    return;
  }

  const groups = groupRowsBy(
    assyTrendRows,
    row => `${row.process || "Blank Process"}__${row.characteristics || "Blank Characteristics"}`,
    row => `${el.assyDeviceSelect.value || "Device"} / ${row.process || "Blank Process"} / ${row.characteristics || "Blank Characteristics"}`
  );

  groups.forEach(group => {
    const labels = group.rows.map(row => row.reportLabel || monthLabel(row.reportMonth));
    const canvas = makeChartCard(el.assyTrendCharts, group.title);
    assyTrendCharts.push(new Chart(canvas, {
      type: "line",
      data: { labels, datasets: trendDatasets(group.rows) },
      options: chartOptions(group.title, "CPK / PPK")
    }));
  });
}

function renderBumpTrendTable() {
  if (!trendRows.length) {
    el.trendBody.innerHTML = `<tr><td colspan="14" class="empty">선택된 Product / Item의 Trend Data가 없습니다.</td></tr>`;
    return;
  }
  el.trendBody.innerHTML = trendRows.map(row => `
    <tr>
      <td>${escapeHtml(row.reportLabel)}</td>
      <td>${escapeHtml(row.product)}</td>
      <td>${escapeHtml(row.item)}</td>
      <td>${escapeHtml(row.dataType)}</td>
      <td>${escapeHtml(row.target)}</td>
      <td>${escapeHtml(row.specLimit)}</td>
      <td class="number">${fmtNumber(row.min, 4)}</td>
      <td class="number">${fmtNumber(row.max, 4)}</td>
      <td class="number">${fmtNumber(row.avg, 4)}</td>
      <td class="number">${fmtNumber(row.std, 4)}</td>
      <td class="number">${fmtNumber(row.sampleSize, 0)}</td>
      <td class="number">${fmtNumber(row.lots, 0)}</td>
      <td class="number">${fmtNumber(row.cpk, 4)}</td>
      <td class="number">${fmtNumber(row.ppk, 4)}</td>
    </tr>
  `).join("");
}

function renderAssyTrendTable() {
  if (!assyTrendRows.length) {
    el.assyTrendBody.innerHTML = `<tr><td colspan="14" class="empty">선택된 Device / Process / Characteristics의 Trend Data가 없습니다.</td></tr>`;
    return;
  }
  el.assyTrendBody.innerHTML = assyTrendRows.map(row => `
    <tr>
      <td>${escapeHtml(row.reportLabel)}</td>
      <td>${escapeHtml(row.device)}</td>
      <td>${escapeHtml(row.process)}</td>
      <td>${escapeHtml(row.characteristics)}</td>
      <td>${escapeHtml(row.specLimit)}</td>
      <td class="number">${fmtNumber(row.min, 4)}</td>
      <td class="number">${fmtNumber(row.max, 4)}</td>
      <td class="number">${fmtNumber(row.avg, 4)}</td>
      <td class="number">${fmtNumber(row.std, 4)}</td>
      <td class="number">${fmtNumber(row.sampleSize, 0)}</td>
      <td class="number">${fmtNumber(row.lots, 0)}</td>
      <td class="number">${fmtNumber(row.qty, 0)}</td>
      <td class="number">${fmtNumber(row.cpk, 4)}</td>
      <td class="number">${fmtNumber(row.ppk, 4)}</td>
    </tr>
  `).join("");
}

function lowStatus(row) {
  const cpk = normalizeNumber(row.cpk);
  const ppk = normalizeNumber(row.ppk);
  if ((cpk !== null && cpk < CPK_LIMIT_LOW) || (ppk !== null && ppk < CPK_LIMIT_LOW)) return "Below 1.33";
  if ((cpk !== null && cpk < CPK_LIMIT_HIGH) || (ppk !== null && ppk < CPK_LIMIT_HIGH)) return "Below 1.67";
  return "";
}

function renderLowTable() {
  if (!el.lowBody) return;
  const selectedMonths = new Set([
    ...bumpRows().filter(row => isMonthInWindow(row.reportMonth, trendStartMonth)).map(row => row.reportMonth),
    ...assyRows().filter(row => isMonthInWindow(row.reportMonth, assyTrendStartMonth)).map(row => row.reportMonth)
  ]);
  const lows = rawRows
    .filter(row => selectedMonths.has(row.reportMonth))
    .filter(row => lowStatus(row))
    .sort((a, b) => sortByMonth(a, b) || String(a.reportType).localeCompare(String(b.reportType)) || (normalizeNumber(a.cpk) ?? 999) - (normalizeNumber(b.cpk) ?? 999));

  if (!lows.length) {
    el.lowBody.innerHTML = `<tr><td colspan="12" class="empty">Low CPK/PPK Data가 없습니다.</td></tr>`;
    return;
  }
  el.lowBody.innerHTML = lows.map(row => {
    const status = lowStatus(row);
    const cls = status === "Below 1.33" ? "low-danger" : "low-warning";
    const type = row.reportType || "BUMP";
    return `
      <tr>
        <td>${escapeHtml(row.reportLabel || monthLabel(row.reportMonth))}</td>
        <td><span class="type-pill ${type === "ASSY" ? "assy" : "bump"}">${escapeHtml(type)}</span></td>
        <td>${escapeHtml(type === "ASSY" ? row.device : row.product)}</td>
        <td>${escapeHtml(type === "ASSY" ? row.process : row.dataType || "")}</td>
        <td>${escapeHtml(type === "ASSY" ? row.characteristics : row.item)}</td>
        <td>${escapeHtml(row.specLimit)}</td>
        <td class="number">${fmtNumber(row.avg, 4)}</td>
        <td class="number">${fmtNumber(row.std, 4)}</td>
        <td class="number">${fmtNumber(row.cpk, 4)}</td>
        <td class="number">${fmtNumber(row.ppk, 4)}</td>
        <td class="${cls}">${escapeHtml(status)}</td>
        <td>${escapeHtml(row.sourceFileName)}</td>
      </tr>`;
  }).join("");
}

function exportReport() {
  if (!rawRows.length) { log("Export할 Data가 없습니다."); return; }
  const rawExport = rawRows.map(row => ({
    Type: row.reportType || "BUMP",
    Month: row.reportLabel || monthLabel(row.reportMonth),
    ReportMonth: row.reportMonth,
    Sheet: row.sheetName,
    Product: row.product,
    Item: row.item,
    Device: row.device || "",
    Process: row.process || "",
    Characteristics: row.characteristics || "",
    "Data type": row.dataType,
    Target: row.target,
    "Spec Limit": row.specLimit,
    "Freq.": row.frequency,
    "S/S": row.sampleSize,
    Lots: row.lots,
    "Q'TY": row.qty,
    Min: row.min,
    Max: row.max,
    Avg: row.avg,
    Std: row.std,
    CPK: row.cpk,
    PPK: row.ppk,
    SourceFile: row.sourceFileName
  }));
  const bumpTrendExport = trendRows.map(row => ({
    Month: row.reportLabel,
    ReportMonth: row.reportMonth,
    Product: row.product,
    Item: row.item,
    "Data type": row.dataType,
    Target: row.target,
    "Spec Limit": row.specLimit,
    Min: row.min,
    Max: row.max,
    Avg: row.avg,
    Std: row.std,
    "S/S": row.sampleSize,
    Lots: row.lots,
    CPK: row.cpk,
    PPK: row.ppk
  }));
  const assyTrendExport = assyTrendRows.map(row => ({
    Month: row.reportLabel,
    ReportMonth: row.reportMonth,
    Device: row.device,
    Process: row.process,
    Characteristics: row.characteristics,
    "Spec Limit": row.specLimit,
    Min: row.min,
    Max: row.max,
    Avg: row.avg,
    Std: row.std,
    "S/S": row.sampleSize,
    Lots: row.lots,
    "Q'TY": row.qty,
    CPK: row.cpk,
    PPK: row.ppk
  }));
  const lowExport = rawRows.filter(row => lowStatus(row)).map(row => ({
    Type: row.reportType || "BUMP",
    Month: row.reportLabel || monthLabel(row.reportMonth),
    ReportMonth: row.reportMonth,
    Product: row.product,
    Item: row.item,
    Device: row.device || "",
    Process: row.process || "",
    Characteristics: row.characteristics || "",
    "Spec Limit": row.specLimit,
    Avg: row.avg,
    Std: row.std,
    CPK: row.cpk,
    PPK: row.ppk,
    Status: lowStatus(row),
    SourceFile: row.sourceFileName
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bumpTrendExport), "Bump_Selected_Trend");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(assyTrendExport), "Assy_Selected_Trend");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lowExport), "Low_CPK_PPK");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawExport), "MNT_CPK_Raw");
  const dateText = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(wb, `MNT_CPK_Trend_Report_${dateText}.xlsx`);
}

function setupEvents() {
  el.excelFiles.addEventListener("click", event => event.stopPropagation());
  el.dropZone.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); el.excelFiles.click(); });
  el.dropZone.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); el.excelFiles.click(); } });
  el.excelFiles.addEventListener("change", event => handleFiles(Array.from(event.target.files || [])));
  ["dragenter", "dragover"].forEach(eventName => {
    el.dropZone.addEventListener(eventName, event => { event.preventDefault(); el.dropZone.classList.add("active"); });
  });
  ["dragleave", "drop"].forEach(eventName => {
    el.dropZone.addEventListener(eventName, event => { event.preventDefault(); el.dropZone.classList.remove("active"); });
  });
  el.dropZone.addEventListener("drop", event => handleFiles(Array.from(event.dataTransfer?.files || [])));
  el.exportBtn.addEventListener("click", exportReport);
  el.productSelect.addEventListener("change", () => { refreshBumpFilters(); renderTrend(); });
  el.dataTypeSelect.addEventListener("change", renderTrend);
  el.trendStartMonthSelect.addEventListener("change", () => { trendStartMonth = el.trendStartMonthSelect.value; renderTrend(); });
  el.assyDeviceSelect.addEventListener("change", () => { refreshAssyFilters(); renderTrend(); });
  el.assyStartMonthSelect.addEventListener("change", () => { assyTrendStartMonth = el.assyStartMonthSelect.value; renderTrend(); });
}

function initFirebase() {
  try {
    app = initializeApp(firebaseConfig, "mnt-cpk-trend");
    db = getFirestore(app);
    auth = getAuth(app);
    onAuthStateChanged(auth, async user => {
      currentUser = user;
      if (user) {
        el.authStatus.textContent = `Anonymous Auth OK: ${user.uid.slice(0, 8)}...`;
        setFirebaseStatus("Firebase connected", "success");
        setBusy(false);
        await loadFirestoreData();
        if (selectedRows.length) {
          log("대기 중이던 선택 파일을 자동 Upload 합니다.");
          await uploadSelectedRows();
        }
      } else {
        el.authStatus.textContent = "Auth 필요";
        setFirebaseStatus("Auth required", "warning");
        setBusy(false);
      }
    });
    signInAnonymously(auth).catch(error => {
      console.error(error);
      setFirebaseStatus("Anonymous Auth error", "danger");
      log(`Anonymous Auth Error: ${error.message}`);
    });
  } catch (error) {
    console.error(error);
    setFirebaseStatus("Firebase init error", "danger");
    log(`Firebase Init Error: ${error.message}`);
  }
}

setupEvents();
setBusy(true);
initFirebase();
