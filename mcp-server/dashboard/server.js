import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { notebookOverview, readNotebook, mutateNotebook, previewNotebookPersona } from "../services/notebook_service.js";

const assets = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/theme.js", ["theme.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]]]);
const statuses = { INVALID: 400, CONFIRMATION: 400, CONFLICT: 409, NOT_FOUND: 404, UNSUPPORTED: 422 };

export async function startDashboard({ port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port.");
  const token = randomBytes(32).toString("hex");
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") {
        return json(403, { error: "Local origin required." });
      }
      const url = new URL(req.url, origin);
      if (req.method === "GET" && assets.has(url.pathname)) {
        const [name, type] = assets.get(url.pathname);
        const bytes = await readFile(new URL(`./public/${name}`, import.meta.url));
        res.writeHead(200, { "Content-Type": type }); res.end(bytes); return;
      }
      const auth = Buffer.from(req.headers.authorization || "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return json(401, { error: "Open the complete connection URL printed by the dashboard command." });
      if (req.method === "GET" && url.pathname === "/api/overview") return json(200, await notebookOverview());
      if (req.method === "GET" && url.pathname === "/api/notebook") return json(200, await readNotebook({ key: url.searchParams.get("key") }));
      if (req.method === "GET" && url.pathname === "/api/persona") return json(200, await previewNotebookPersona({ key: url.searchParams.get("key") }));
      if (req.method === "POST" && url.pathname === "/api/notebook") {
        if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json") return json(403, { error: "Same-origin JSON required." });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 256000) { json(413, { error: "Request too large." }); return; }
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(400, { error: "Invalid JSON." }); }
        if (!input || typeof input !== "object" || Array.isArray(input)) return json(400, { error: "Object required." });
        return json(200, await mutateNotebook(input));
      }
      json(404, { error: "Not found." });
    } catch (error) {
      // Unexpected engine exceptions can contain connection details. Do not
      // forward raw errors or log request bodies/credentials.
      json(statuses[error.code] || 500, { code: error.code || "UNAVAILABLE", error: statuses[error.code] ? error.message : "Storage operation failed. Check local storage permissions and retry." });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, url: `${origin}/#${token}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

export async function runDashboard(args = []) {
  if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]))) throw new Error("Usage: memory_plugin dashboard [--port 0..65535]");
  // This standalone viewer must not start hybrid cloud work merely by reading
  // local identities/links. Other CLI/MCP processes keep their own sync policy.
  process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
  const app = await startDashboard({ port: args.length ? Number(args[1]) : 0 });
  console.log(`Memory dashboard\n${app.url}\nOpen this private connection URL in your browser. Reopen it to reconnect.\nStop: Ctrl+C. Local storage only; no cloud polling or model loading.`);
  await new Promise(resolve => {
    const stop = () => resolve();
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  });
  await app.close();
  const { closeDatabase } = await import("../db/database.js");
  closeDatabase();
}
