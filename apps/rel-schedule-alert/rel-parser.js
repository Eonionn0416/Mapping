/**
 * REL Schedule Alert - Reliability test plan parser (pure module, no Firebase 의존성)
 *
 * 지원 Sheet layout
 *  A) 표준: Cirteria / Rel item / Condition / Assy' lot# / FT lot# / Q'ty / Date in / Duration / Delay / Date out / Result / Status / Remark / Fail mode
 *  B) 구형(Tianchi 계열): Test item(merge) / (Sub item) / Duration (day) / Date in / Date out / Result Good/Total Q'ty
 */

// Pre alarm 구간: 2 >= (Date out - Today) >= 0
// 단, Pre alarm 시작일(Date out - 2일)이 주말이면 직전 영업일(금요일)로 당겨서 시작합니다.
export const ALERT_LEAD_DAYS = 2;

/**
 * 실제 Plan이 아닌 양식/Template sheet. 파싱·알림에서 완전히 제외합니다.
 * "REL_<담당자 한글 이름>"은 MNT/MTK/BDR 등 파일마다 담당자 이름만 바뀌는 빈 양식 Sheet라서
 * (예: REL_여문석, REL_오명욱, REL_이효열) 이름 부분을 한글 패턴으로 일반화해서 매칭합니다.
 */
export const TEMPLATE_SHEET_PATTERNS = [
  /^REL[_\s]*[가-힣]{2,10}$/i,
  /^(template|form|sample|양식|서식)$/i,
  /\b(template|양식)\b/i
];

export function isTemplateSheet(sheetName) {
  const name = String(sheetName || "").trim();
  return TEMPLATE_SHEET_PATTERNS.some(re => re.test(name));
}

/* ---------------- text / number helpers ---------------- */

export function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function headerKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s.'"`()\[\]#\-/\\:,]/g, "");
}

export function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  // 회계 표기: (1) = -1  (예정보다 1일 빨리 나온 경우)
  const paren = cleaned.match(/^\(\s*(\d+(?:\.\d+)?)\s*\)$/);
  if (paren) return -Number(paren[1]);
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** Delay 표기: 양수 = 지연(+N), 음수 = 예정보다 빠름((N)) */
export function formatDelayValue(value) {
  const num = normalizeNumber(value);
  if (num === null) return "";
  if (num > 0) return `+${num}`;
  if (num < 0) return `(${Math.abs(num)})`;
  return "0";
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function makeDocId(rawKey) {
  const safe = String(rawKey).replace(/[\/\\.#$\[\]]/g, "_").replace(/\s+/g, "_");
  const hash = fnv1a(String(rawKey));
  return `${safe.slice(0, 200)}__${hash}`;
}

/* ---------------- date helpers ---------------- */

function pad2(n) { return String(n).padStart(2, "0"); }

/**
 * Date / Excel serial / 문자열 → 'YYYY-MM-DD' (없으면 "")
 *
 * 주의: SheetJS의 cellDates 옵션으로 만들어진 Date는 브라우저 timezone의 역사적 offset
 * (예: Asia/Seoul 1899년 LMT +08:27:52) 때문에 자정에서 30분 정도 어긋나 하루가 밀릴 수 있습니다.
 * 그래서 (1) 가능하면 Excel serial 숫자를 그대로 받아 UTC 기준으로 변환하고,
 *        (2) Date가 들어오면 가장 가까운 자정으로 스냅해서 하루 밀림을 막습니다.
 */
export function toIsoDate(value, date1904 = false) {
  if (value === null || value === undefined || value === "") return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const offsetMs = value.getTimezoneOffset() * 60000;
    const dayMs = 86400000;
    const snapped = new Date(Math.round((value.getTime() - offsetMs) / dayMs) * dayMs + offsetMs);
    return `${snapped.getFullYear()}-${pad2(snapped.getMonth() + 1)}-${pad2(snapped.getDate())}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 20 || value > 60000) return "";
    const serial = Math.round(value) + (date1904 ? 1462 : 0);
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  const text = normalizeText(value);
  if (!text || text === "-") return "";
  let m = text.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = text.match(/^(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4})/);
  if (m) return `${m[3]}-${pad2(m[1])}-${pad2(m[2])}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }
  return "";
}

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function isoToUtcMs(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** b 기준 a 까지 남은 일수 (a - b), 둘 다 'YYYY-MM-DD' */
export function dayDiff(a, b) {
  const ma = isoToUtcMs(a);
  const mb = isoToUtcMs(b);
  if (ma === null || mb === null) return null;
  return Math.round((ma - mb) / 86400000);
}

export function formatDday(diff) {
  if (diff === null || diff === undefined) return "";
  if (diff === 0) return "D-Day";
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

export function isWeekend(iso) {
  const ms = isoToUtcMs(iso);
  if (ms === null) return false;
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

/** Date out 기준 Pre alarm 시작일. 주말이면 직전 영업일(금)로 당깁니다. */
export function preAlarmStartDate(dateOutIso, leadDays = ALERT_LEAD_DAYS) {
  const ms = isoToUtcMs(dateOutIso);
  if (ms === null) return "";
  let d = new Date(ms - leadDays * 86400000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/* ---------------- header mapping ---------------- */

const EXACT_FIELDS = {
  cirteria: "criteria",
  criteria: "criteria",
  testitem: "criteria",
  relitem: "relItem",
  reltiem: "relItem",
  subitem: "relItem",
  condition: "condition",
  conditions: "condition",
  assylot: "assyLot",
  assylotno: "assyLot",
  ftlot: "ftLot",
  ftlotno: "ftLot",
  qty: "qty",
  quantity: "qty",
  samplesize: "qty",
  datein: "dateIn",
  indate: "dateIn",
  dateout: "dateOut",
  outdate: "dateOut",
  delay: "delay",
  status: "status",
  failmode: "failMode",
  failuremode: "failMode"
};

const PREFIX_FIELDS = [
  ["duration", "duration"],
  ["result", "result"],
  ["remark", "remark"],
  ["comment", "remark"]
];

function mapHeaderRow(row) {
  const map = {};
  for (let c = 0; c < row.length; c++) {
    const key = headerKey(row[c]);
    if (!key) continue;
    let field = EXACT_FIELDS[key];
    if (!field) {
      const hit = PREFIX_FIELDS.find(([prefix]) => key.startsWith(prefix));
      if (hit) field = hit[1];
    }
    if (field && map[field] === undefined) map[field] = c;
  }
  return map;
}

/** Date in + Date out 이 모두 있는 첫 행을 header 로 판단 */
export function findHeader(rows, maxScan = 40) {
  const limit = Math.min(rows.length, maxScan);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] || [];
    const map = mapHeaderRow(row);
    if (map.dateOut !== undefined && map.dateIn !== undefined) {
      // Rel item 컬럼이 따로 없는 구형 layout: Criteria 바로 오른쪽 컬럼을 Rel item 으로 사용
      if (map.relItem === undefined && map.criteria !== undefined) {
        const candidate = map.criteria + 1;
        const used = Object.values(map);
        if (!used.includes(candidate)) map.relItem = candidate;
      }
      return { rowIndex: r, map };
    }
  }
  return null;
}

/* ---------------- meta (Title / Rel.# / Package ...) ---------------- */

const META_RULES = [
  [k => k === "title", "title"],
  [k => k === "rel" || k === "relno" || k === "reltestno", "relNo"],
  [k => k.startsWith("packagetype") || k === "pkgtype", "packageType"],
  [k => k === "pkgsize" || k === "packagesize", "pkgSize"],
  [k => k === "leadsize" || k === "leadcount", "leadSize"],
  [k => k.startsWith("recev") || k.startsWith("receiv"), "receiveDate"],
  [k => k === "deviceno" || k === "device", "device"],
  [k => k === "lotno" || k === "lot" || k === "lotid", "lotNo"],
  [k => k === "samplesize", "sampleSize"],
  [k => k === "pithickness", "piThickness"],
  [k => k.startsWith("specialcomment"), "specialComment"]
];

export function extractMeta(rows, headerRowIndex) {
  const meta = {};
  const limit = Math.max(0, headerRowIndex);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] || [];
    let labelIdx = -1;
    for (let c = 0; c < Math.min(row.length, 8); c++) {
      if (normalizeText(row[c])) { labelIdx = c; break; }
    }
    if (labelIdx < 0) continue;
    const key = headerKey(row[labelIdx]);
    const rule = META_RULES.find(([test]) => test(key));
    if (!rule) continue;
    let value = "";
    for (let c = labelIdx + 1; c < Math.min(row.length, labelIdx + 8); c++) {
      const raw = row[c];
      if (raw === null || raw === undefined || raw === "") continue;
      value = rule[1] === "receiveDate" ? toIsoDate(raw) : normalizeText(raw);
      if (value) break;
    }
    if (value && !meta[rule[1]]) meta[rule[1]] = value;
  }
  return meta;
}

/* ---------------- sheet parsing ---------------- */

const DONE_STATUS_RE = /(done|complete|completed|finish|finished|closed|pass|판정\s*완료|완료|종료)/i;
export const ONGOING_RE = /(on\s*going|ongoing|진행\s*중|running|in\s*progress|wip)/i;
const NOT_DONE_RE = /^(-|ing|on\s*going|ongoing|going|wip|tbd|na|n\/a|hold|pending|plan|planned|진행\s*중|예정|대기)$/i;

/**
 * Status에 Done 계열 문구가 있으면 완료.
 * Status가 On going 이면 Result 값이 있어도 진행 중으로 봅니다.
 * Status가 비어 있는 행은 알림 대상이 아니므로(markOngoing에서 제외) Result 기준 표시만 합니다.
 */
export function isExcelDone(record) {
  const status = normalizeText(record.status);
  const result = normalizeText(record.result);
  if (status && DONE_STATUS_RE.test(status)) return true;
  if (status && ONGOING_RE.test(status)) return false;
  if (result && !NOT_DONE_RE.test(result)) return true;
  return false;
}

/**
 * 한 Sheet(2차원 배열)를 Rel item record 배열로 변환합니다.
 */
export function parseSheetMatrix(sheetName, rows, fileName = "", options = {}) {
  const { rowOffset = 0, statusBlocks = null, date1904 = false } = options;
  if (isTemplateSheet(sheetName)) return { records: [], meta: {}, header: null, skipped: "template" };
  const header = findHeader(rows);
  if (!header) return { records: [], meta: {}, header: null };

  const { rowIndex, map } = header;
  const meta = extractMeta(rows, rowIndex);
  const get = (row, field) => (map[field] === undefined ? "" : row[map[field]]);

  const seqCounter = new Map();
  const records = [];
  let currentCriteria = "";

  for (let r = rowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const criteriaCell = normalizeText(get(row, "criteria"));
    if (criteriaCell) currentCriteria = criteriaCell;

    const relItem = normalizeText(get(row, "relItem"));
    const condition = normalizeText(get(row, "condition"));
    const dateIn = toIsoDate(get(row, "dateIn"), date1904);
    const dateOut = toIsoDate(get(row, "dateOut"), date1904);
    const assyLot = normalizeText(get(row, "assyLot"));
    const ftLot = normalizeText(get(row, "ftLot"));
    const result = normalizeText(get(row, "result"));
    const status = normalizeText(get(row, "status"));
    const remark = normalizeText(get(row, "remark"));
    const failMode = normalizeText(get(row, "failMode"));

    if (!relItem && !dateOut) continue;
    if (!relItem && !dateIn && !condition) continue;

    const criteria = currentCriteria || relItem || "(No criteria)";
    const groupKey = `${criteria}|${relItem}|${condition}`;
    const seq = (seqCounter.get(groupKey) || 0) + 1;
    seqCounter.set(groupKey, seq);

    const record = {
      sheetName,
      planTitle: meta.title || meta.device || sheetName,
      relNo: meta.relNo || "",
      packageType: meta.packageType || "",
      pkgSize: meta.pkgSize || "",
      leadSize: meta.leadSize || "",
      device: meta.device || "",
      lotNo: meta.lotNo || "",
      receiveDate: meta.receiveDate || "",
      criteria,
      relItem,
      condition,
      assyLot,
      ftLot,
      qty: normalizeNumber(get(row, "qty")),
      dateIn,
      duration: normalizeNumber(get(row, "duration")),
      delay: normalizeNumber(get(row, "delay")),
      dateOut,
      result,
      status,
      remark,
      failMode,
      rowNumber: r + 1 + rowOffset,
      statusBlock: statusBlocks && statusBlocks.has(r) ? statusBlocks.get(r) : r,
      seq,
      sourceFileName: fileName
    };
    record.dedupeKey = makeDocId(`${sheetName}::${criteria}::${relItem}::${condition}::${seq}`);
    records.push(record);
  }

  return { records, meta, header };
}

/* ---------------- On going 판정 ---------------- */

export function isDone(record, statusDoc) {
  const manual = statusDoc ? statusDoc.manualDone : undefined;
  if (manual === true) return true;
  if (manual === false) return false;
  return isExcelDone(record);
}

/**
 * 각 Criteria(=Sheet + Criteria)에서 **현재 진행 중인 Rel item 1건**을 고릅니다.
 *
 *  - 대상: Status에 "On going"이 적힌 미완료 행 (Status가 비어 있는 행은 알림 대상 아님)
 *  - Status 셀이 세로 병합된 구간(예: `UHAST96hrs` + `SAT`)은 두 행 모두 On going으로 봅니다.
 *  - 그중 **Date out이 아직 지나지 않은 첫 번째 행**이 현재 진행 항목입니다.
 *    즉 Today가 `UHAST96hrs`의 Date out을 넘어서면 자동으로 다음 단계(`SAT`)의 Date in / Date out으로 넘어갑니다.
 *  - 모든 행의 Date out이 지났으면 마지막 행 기준으로 Delay session이 됩니다.
 *
 * @returns {Map<string, {type:string, block:object}>} 현재 진행 행의 dedupeKey -> 구간 정보
 */
export function markOngoing(records, statusMap = new Map(), today = todayIso()) {
  const groups = new Map();
  records.forEach(record => {
    if (isTemplateSheet(record.sheetName)) return;
    if (isDone(record, statusMap.get(record.dedupeKey) || null)) return;
    if (!ONGOING_RE.test(normalizeText(record.status))) return;
    const key = `${record.sheetName}|${record.criteria}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  const ongoing = new Map();
  groups.forEach(rows => {
    const sorted = rows.slice().sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));
    const dated = sorted.filter(row => row.dateOut);
    if (!dated.length) return;

    // Date out이 아직 남아 있는 첫 단계. 전부 지났으면 마지막 단계.
    const current = dated.find(row => dayDiff(row.dateOut, today) >= 0) || dated.at(-1);
    ongoing.set(current.dedupeKey, { type: "explicit", block: describeBlock(sorted, dated, current) });
  });
  return ongoing;
}

/** 현재 항목이 속한 On going 구간(병합 범위) 정보를 만듭니다. */
function describeBlock(sorted, dated, current) {
  const blockKey = String(current.statusBlock ?? current.rowNumber);
  const members = sorted.filter(row => String(row.statusBlock ?? row.rowNumber) === blockKey);
  const memberDated = members.filter(row => row.dateOut);
  const sum = field => {
    const values = members.map(row => row[field]).filter(v => typeof v === "number" && Number.isFinite(v));
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const stepIndex = memberDated.findIndex(row => row.dedupeKey === current.dedupeKey);

  return {
    from: members[0] ? members[0].relItem : current.relItem,
    to: memberDated.at(-1) ? memberDated.at(-1).relItem : current.relItem,
    dateIn: (members.find(row => row.dateIn) || current).dateIn || "",
    dateOut: memberDated.at(-1) ? memberDated.at(-1).dateOut : current.dateOut,
    totalDuration: sum("duration"),
    totalDelay: sum("delay"),
    stepIndex: stepIndex >= 0 ? stepIndex + 1 : 1,
    stepCount: memberDated.length || 1,
    // 같은 Criteria 안에서 이 구간 앞뒤로 남아 있는 On going 단계 수
    remaining: dated.filter(row => (row.rowNumber || 0) > (current.rowNumber || 0)).length
  };
}

/* ---------------- alert 판정 ---------------- */

/**
 * 알림 규칙
 *  - 대상: 각 Criteria의 On going 항목 (미완료)
 *  - 2 >= (Date out - Today) >= 0 → Pre alarm (팝업 announce)
 *    · Pre alarm 시작일이 주말이면 직전 영업일(금요일)부터 알림 시작
 *  - 그보다 먼 미래                → On going watch (표시만, 팝업 없음)
 *  - Date out - Today <  0  → Delay session (Delay +1/day, Done 될 때까지 계속 알림)
 *
 * @returns {{code:string, label:string, dday:number|null, done:boolean, ongoing:string, delayDays:number}}
 */
export function evaluateAlert(record, statusDoc = null, today = todayIso(), leadDays = ALERT_LEAD_DAYS, ongoingType = "") {
  const done = isDone(record, statusDoc);
  const dday = record.dateOut ? dayDiff(record.dateOut, today) : null;
  const base = { dday, done, ongoing: ongoingType, delayDays: 0, alarmFrom: "" };

  if (done) return { ...base, code: "done", label: "Done" };
  if (dday === null) return { ...base, code: "none", label: "No date out" };

  if (!ongoingType) {
    return dday < 0
      ? { ...base, code: "pending", label: "Pending" }
      : { ...base, code: "planned", label: "Planned" };
  }

  if (dday < 0) {
    const delayDays = Math.abs(dday);
    return { ...base, code: "delay", label: `Delay +${delayDays}`, delayDays };
  }
  const startIso = preAlarmStartDate(record.dateOut, leadDays);
  const startedDays = startIso ? dayDiff(today, startIso) : null;   // >= 0 이면 Pre alarm 시작
  if (startedDays !== null && startedDays >= 0) {
    return {
      ...base,
      code: "prealarm",
      label: dday === 0 ? "Pre alarm D-Day" : `Pre alarm D-${dday}`,
      alarmFrom: startIso
    };
  }
  return { ...base, code: "watch", label: `On going D-${dday}`, alarmFrom: startIso };
}

export const ALERT_CODES = ["delay", "prealarm"];

export function isAlerting(code) {
  return ALERT_CODES.includes(code);
}

/* ---------------- Rel team 샘플 수령 확인 ---------------- */

/**
 * 각 Sheet(Plan)에서 가장 먼저 나오는 행(Precon 체인의 시작 행, 보통 T0 SAT)의
 * Remark가 비어 있고 Receive date가 이미 지났으면, "Test된 T0 Sample이 아직
 * Rel team으로 전달되지 않았을 수 있다"고 보고 확인 알림 대상으로 표시합니다.
 *
 *  - 대상 행: Sheet 안에서 rowNumber가 가장 작은(=Excel에서 가장 위에 있는) 행 1개
 *  - 조건: Remark가 비어 있고, Today() >= Receive date() (Receive date를 모르면 판단 보류)
 *  - Remark에 무엇이든 적히면(재업로드 시) 전달 확인이 끝난 것으로 보고 알림에서 빠집니다.
 *  - 표/팝업의 Done 체크박스로 수동 처리(manualDone=true)해도 알림에서 빠집니다.
 *
 * @returns {Map<string, {receiveDate:string}>} dedupeKey -> 알림 정보
 */
export function markSampleReceiptCheck(records, statusMap = new Map(), today = todayIso()) {
  const firstBySheet = new Map();
  records.forEach(record => {
    if (isTemplateSheet(record.sheetName)) return;
    const current = firstBySheet.get(record.sheetName);
    if (!current || (record.rowNumber || 0) < (current.rowNumber || 0)) {
      firstBySheet.set(record.sheetName, record);
    }
  });

  const flagged = new Map();
  firstBySheet.forEach(record => {
    if (normalizeText(record.remark)) return;
    if (!record.receiveDate) return;
    if (dayDiff(today, record.receiveDate) < 0) return;
    const statusDoc = statusMap.get(record.dedupeKey) || null;
    if (statusDoc && statusDoc.manualDone === true) return;
    flagged.set(record.dedupeKey, { receiveDate: record.receiveDate });
  });
  return flagged;
}

/* ---------------- Rel team ↔ FT 전달(hand-off) 확인 ---------------- */

/** Rel item이 FT 계열(FT(500X), FT(MSL TC) 등)인지 */
function isFtRelItem(relItem) {
  return /ft/i.test(normalizeText(relItem));
}

/**
 * 각 Criteria 안에서 Status 컬럼이 실제로 세로 병합된 구간(예: Bake+Soak+Reflow+Post MSL SAT,
 * 또는 같은 FT(MSL TC)/FT(MSL uHAST)/FT(MSL HTST) 묶음)마다, 그 구간의 **맨 마지막 행** Remark가
 * 비어 있고 그 구간이 이미 끝났으면(Today가 구간의 마지막 Date out을 지났으면) 전달 확인 알림 대상으로
 * 표시합니다.
 *
 *  - 대상: Status 병합 셀 1개(=병합 행이 2개 이상인 구간)의 맨 마지막 행
 *  - 방향 판정: 그 마지막 행의 Rel item에 "FT"가 들어있으면 → FT 시험이 끝난 뒤이므로 "to Rel"
 *    (Rel team에게 돌려보냈는지) 확인, 그 외(Bake/T0 SAT/SAT/Soak/Reflow/Post MSL SAT 등)면
 *    → "to FT" (FT팀에게 넘겼는지) 확인.
 *  - 조건: Remark가 비어 있고, Today() >= 그 구간의 마지막 Date out (Date out을 모르면 판단 보류)
 *  - Remark에 무엇이든 적히면(재업로드 시) 전달 확인이 끝난 것으로 보고 알림에서 빠지고,
 *    Done 체크박스로 수동 처리(manualDone=true)해도 알림에서 빠집니다.
 *
 * @returns {Map<string, {kind:"toRel"|"toFT", dateOut:string}>} dedupeKey -> 알림 정보
 */
export function markHandoffCheck(records, statusMap = new Map(), today = todayIso()) {
  const groups = new Map();
  records.forEach(record => {
    if (isTemplateSheet(record.sheetName)) return;
    const key = `${record.sheetName}|${record.statusBlock ?? record.rowNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  const flagged = new Map();
  groups.forEach(members => {
    if (members.length < 2) return;   // 실제로 병합된(2행 이상) 구간만 대상
    const sorted = members.slice().sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));
    const lastRow = sorted[sorted.length - 1];
    if (normalizeText(lastRow.remark)) return;

    const dated = sorted.filter(row => row.dateOut);
    if (!dated.length) return;
    const effectiveDateOut = dated[dated.length - 1].dateOut;
    if (dayDiff(today, effectiveDateOut) < 0) return;

    const statusDoc = statusMap.get(lastRow.dedupeKey) || null;
    if (statusDoc && statusDoc.manualDone === true) return;

    const kind = isFtRelItem(lastRow.relItem) ? "toRel" : "toFT";
    flagged.set(lastRow.dedupeKey, { kind, dateOut: effectiveDateOut });
  });
  return flagged;
}
