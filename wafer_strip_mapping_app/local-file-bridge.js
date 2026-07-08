// Local Bridge for MNT CPK Trend Chart
// Run: node local-file-bridge.js
// Put Excel files in: ./local-upload
// Then click "Local Bridge Import" in the web page.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "local-upload");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function safeName(name) {
  const base = path.basename(String(name || ""));
  if (!/\.xls[xm]?$/i.test(base)) return null;
  if (base.includes("..") || base.includes("/") || base.includes("\\")) return null;
  return base;
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, uploadDir: UPLOAD_DIR });
    return;
  }

  if (url.pathname === "/files") {
    try {
      const files = fs.readdirSync(UPLOAD_DIR)
        .filter(name => /\.xls[xm]?$/i.test(name))
        .map(name => {
          const fullPath = path.join(UPLOAD_DIR, name);
          const stat = fs.statSync(fullPath);
          return { name, size: stat.size, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      sendJson(res, 200, { ok: true, files });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (url.pathname === "/file") {
    const name = safeName(url.searchParams.get("name"));
    if (!name) {
      sendJson(res, 400, { ok: false, error: "Invalid Excel file name" });
      return;
    }
    const fullPath = path.join(UPLOAD_DIR, name);
    fs.stat(fullPath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        sendJson(res, 404, { ok: false, error: "File not found" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
      });
      fs.createReadStream(fullPath).pipe(res);
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[local-file-bridge] running at http://127.0.0.1:${PORT}`);
  console.log(`[local-file-bridge] put Excel files here: ${UPLOAD_DIR}`);
});
