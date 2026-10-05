import {knowledgeRemovalRequest} from '../tools/core/knowledge_removal_core.js';
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { notebookOverview, readNotebook, readNotebookCollection, mutateNotebook, previewNotebookPersona } from "../services/notebook_service.js";
import { assertWebPort, parseWebCommand, WEB_USAGE } from "./options.js";
import { getConfig } from "../config/config_manager.js";
import { inspectKnowledge } from "../services/knowledge_service.js";
import { browserAsset } from './vendor.js';
import { knowledgeLinksRequest } from '../tools/core/knowledge_links_core.js';
import { knowledgeContentRequest } from '../tools/core/knowledge_content_core.js';
import { projectRequest } from '../services/project_service.js';
import { settingsRequest, snapshotRequest } from '../services/settings_service.js';
import { modelsRequest } from '../services/model_service.js';
import { resourceOverview } from '../services/resource_service.js';
import { promptRequest } from '../services/prompt_service.js';
import { directiveTransferRequest } from '../services/directive_transfer_service.js';
import { startSnapshotScheduler, stopSnapshotScheduler } from '../admin/cloud_snapshots.js';

const assets = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/theme.js", ["theme.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]]]);
for (const [name, type] of [
  ["favicon.svg", "image/svg+xml"],
  ["favicon.ico", "image/x-icon"],
  ["favicon-32x32.png", "image/png"],
  ["favicon-16x16.png", "image/png"],
  ["apple-touch-icon.png", "image/png"]
]) assets.set(`/${name}`, [name, type]);
const statuses = { INVALID: 400, CONFIRMATION: 400, CONFLICT: 409, MIGRATION_REQUIRED: 409, NOT_FOUND: 404, UNSUPPORTED: 422 };
statuses.BUSY = 503;
statuses.STORAGE_UNAVAILABLE = 503;
statuses.RECOVERY_REQUIRED = 409;
statuses.UNAVAILABLE = 503;
assets.set("/knowledge_search.js",["knowledge_search.js","text/javascript; charset=utf-8"]);
assets.set("/knowledge_graph.js",["knowledge_graph.js","text/javascript; charset=utf-8"]);
assets.set("/knowledge.js", ["knowledge.js", "text/javascript; charset=utf-8"]);
assets.set("/content.js", ["content.js", "text/javascript; charset=utf-8"]);
assets.set('/notebook_filters.js', ['notebook_filters.js', 'text/javascript; charset=utf-8']);
assets.set('/links.js', ['links.js', 'text/javascript; charset=utf-8']);
assets.set('/knowledge_removal.js',['knowledge_removal.js','text/javascript; charset=utf-8']);
assets.set('/knowledge_editor.js', ['knowledge_editor.js', 'text/javascript; charset=utf-8']);
assets.set('/projects.js', ['projects.js', 'text/javascript; charset=utf-8']);
assets.set('/settings.js', ['settings.js', 'text/javascript; charset=utf-8']);
assets.set('/models.js', ['models.js', 'text/javascript; charset=utf-8']);
assets.set('/resources.js', ['resources.js', 'text/javascript; charset=utf-8']);
assets.set('/prompts.js', ['prompts.js', 'text/javascript; charset=utf-8']);
assets.set('/persona.js', ['persona.js', 'text/javascript; charset=utf-8']);
assets.set('/directive_transfer.js', ['directive_transfer.js', 'text/javascript; charset=utf-8']);

export async function startDashboard({ port = 0, token = randomBytes(32).toString("hex"), runtime, onStop } = {}) {
  assertWebPort(port);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid panel connection token');
  const cookieName = runtime ? `memory_session_${runtime.storageId.slice(0, 12)}` : null;
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") {
        return json(403, { error: "Local origin required." });
      }
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname.startsWith('/vendor/')) {
        const asset = await browserAsset(url.pathname);
        if (!asset) return json(404, { error: 'Not found.' });
        res.writeHead(200, { 'Content-Type': asset.type }); res.end(asset.bytes); return;
      }
      if (req.method === "GET" && assets.has(url.pathname)) {
        const [name, type] = assets.get(url.pathname);
        const bytes = await readFile(new URL(`./public/${name}`, import.meta.url));
        res.writeHead(200, { "Content-Type": type }); res.end(bytes); return;
      }
      const cookie = cookieName && (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      const auth = Buffer.from(req.headers.authorization || (cookie ? `Bearer ${cookie}` : ""));
      const expected = Buffer.from(`Bearer ${token}`);
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return json(401, { error: "Open the complete connection URL printed by the dashboard command." });
      if (cookieName && req.headers.authorization) res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
      if (req.method === 'GET' && url.pathname === '/api/runtime' && runtime) return json(200, runtime);
      if (req.method === 'GET' && url.pathname === '/api/resources') {
        if (url.search) return json(400, {code: 'INVALID', error: 'Unknown resource parameter.'});
        return json(200, await resourceOverview());
      }
      if (req.method === 'GET' && url.pathname === '/api/settings') {
        if (url.search) return json(400,{code:'INVALID',error:'Unknown settings parameter.'});
        return json(200,await settingsRequest({action:'read'}));
      }
      if(req.method==='GET' && url.pathname==='/api/models') {
        const input=Object.fromEntries(url.searchParams);
        if(!url.search)return json(200,await modelsRequest({action:'read'}));
        if(input.action!=='status' || Object.keys(input).some(key=>!['action','operationId'].includes(key)) || [...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length>1))return json(400,{code:'INVALID',error:'Unknown model read parameter.'});
        return json(200,await modelsRequest(input));
      }
      if (req.method === 'POST' && url.pathname === '/api/runtime/stop' && onStop) {
        if (req.headers.origin !== origin) return json(403, { error: 'Local origin required.' });
        json(202, { stopping: true }); setImmediate(onStop); return;
      }
      if (req.method === "GET" && url.pathname === "/api/knowledge") {
        const input = Object.fromEntries(url.searchParams);
        const allowed = new Set(["action", "scopeKey", "includeGlobal", "docId", "nodeType", "relationType", "searchMode", "resultMode", "policyExpansion", "query", "sourceType", "offset", "limit", "rawOffset", "startLine", "textLimit", "level", "parentId", "chunkId", "textOffset"]);
        if (Object.keys(input).some(key => !allowed.has(key)) || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length > 1)) {
          return json(400, { code: "INVALID", error: "Unknown or repeated knowledge parameter." });
        }
        if (input.includeGlobal !== undefined) {
          if (!["true", "false"].includes(input.includeGlobal)) return json(400, { code: "INVALID", error: "includeGlobal must be true or false." });
          input.includeGlobal = input.includeGlobal === "true";
        }
        if(input.policyExpansion!==undefined){if(!["true","false"].includes(input.policyExpansion))return json(400,{code:"INVALID",error:"policyExpansion must be boolean."});input.policyExpansion=input.policyExpansion==="true";}
        return json(200, await inspectKnowledge(input));
      }
      if (req.method === "GET" && url.pathname === "/api/overview") return json(200, await notebookOverview());
      if (req.method === 'GET' && url.pathname === '/api/projects') {
        const input=Object.fromEntries(url.searchParams);
        if (!['list','inspect'].includes(input.action) || Object.keys(input).some(key=>!['action','directory'].includes(key)) || [...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length>1)) return json(400,{code:'INVALID',error:'Unknown project read parameter.'});
        return json(200,await projectRequest(input));
      }
      if (req.method === 'GET' && url.pathname === '/api/knowledge-content') {
        const input = Object.fromEntries(url.searchParams);
        if (!['read','status'].includes(input.action) || Object.keys(input).some(key => !['action','scopeKey','docId','operationId'].includes(key)) || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length > 1)) return json(400, { code:'INVALID',error:'Unknown content read parameter.' });
        return json(200, await knowledgeContentRequest(input));
      }
      if (req.method === 'GET' && url.pathname === '/api/knowledge-links') {
        const input = Object.fromEntries(url.searchParams);
        if (!['list', 'migration-status'].includes(input.action) || Object.keys(input).some(key => !['action', 'scopeKey', 'docId', 'factRef'].includes(key)) || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length > 1)) return json(400, { code: 'INVALID', error: 'Unknown link read parameter.' });
        return json(200, await knowledgeLinksRequest(input));
      }
      if (req.method === 'GET' && url.pathname === '/api/notebooks') {
        if (url.search) return json(400, { code: 'INVALID', error: 'Collection takes no parameters.' });
        return json(200, await readNotebookCollection());
      }
      if (req.method === "GET" && url.pathname === "/api/notebook") return json(200, await readNotebook({ key: url.searchParams.get("key") }));
      if (req.method === 'GET' && url.pathname === '/api/prompts') {
        if (url.search) return json(400, { code: 'INVALID', error: 'Prompt status takes no parameters.' });
        return json(200, await promptRequest({ action: 'status' }));
      }
      if (req.method === 'GET' && url.pathname === '/api/persona') {
        const input = Object.fromEntries(url.searchParams);
        if (Object.keys(input).some(key => !['key', 'client'].includes(key)) || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length > 1)) return json(400, { code: 'INVALID', error: 'Unknown or repeated persona parameter.' });
        return json(200, await previewNotebookPersona(input));
      }
      if (req.method === "POST" && ['/api/prompts', '/api/directive-transfer', '/api/notebook', '/api/knowledge-links','/api/knowledge-content','/api/knowledge-removal','/api/projects','/api/settings','/api/snapshots','/api/models'].includes(url.pathname)) {
        if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json") return json(403, { error: "Same-origin JSON required." });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > (url.pathname === '/api/knowledge-content' ? 3 * 1024 * 1024 : 256000)) { json(413, { error: "Request too large." }); return; }
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(400, { error: "Invalid JSON." }); }
        if (!input || typeof input !== "object" || Array.isArray(input)) return json(400, { error: "Object required." });
        if (url.pathname === '/api/prompts') return json(200, await promptRequest(input));
        if (url.pathname === '/api/directive-transfer') return json(200, await directiveTransferRequest(input));
        if(url.pathname==='/api/models')return json(200,await modelsRequest(input));
        if (url.pathname === '/api/settings' || url.pathname === '/api/snapshots') {
          try { return json(200,await (url.pathname === '/api/settings' ? settingsRequest(input) : snapshotRequest(input))); }
          catch (error) {
            if (error.code === 'UNAVAILABLE') return json(503,{code:error.code,error:error.message});
            throw error;
          }
        }
        if(url.pathname==='/api/projects') {
          if(!['preview','apply'].includes(input.action)) return json(400,{code:'INVALID',error:'Unknown project mutation action.'});
          return json(200,await projectRequest(input));
        }
        if(url.pathname==='/api/knowledge-removal') {
          if(Object.keys(input).some(key=>!['action','scopeKey','operation','docId','previewToken','confirm','confirmShared'].includes(key)))return json(400,{code:'INVALID',error:'Unknown removal field.'});
          return json(200,await knowledgeRemovalRequest(input));
        }
        if (url.pathname === '/api/knowledge-content') {
          if (!['start','apply','cancel'].includes(input.action) || Object.keys(input).some(key => !['action','scopeKey','operation','docId','expectedVersion','fields','operationId','previewToken','confirmShared'].includes(key))) return json(400,{code:'INVALID',error:'Unknown content mutation parameter.'});
          return json(200, await knowledgeContentRequest(input));
        }
        if (url.pathname === '/api/knowledge-links') {
          const allowed = ['action', 'scopeKey', 'operation', 'linkId', 'fields', 'previewToken'];
          if (!['preview', 'apply', 'migrate'].includes(input.action) || Object.keys(input).some(key => !allowed.includes(key))) return json(400, { code: 'INVALID', error: 'Unknown link mutation parameter.' });
          return json(200, await knowledgeLinksRequest(input));
        }
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
  await new Promise((resolve, reject) => {
    const onError = error => {
      if (error.code === "EADDRINUSE") {
        error.message = `Port ${port} is already in use. Run memory-plugin web --port 0 for a free port, or save another default with memory-cli web port <N>.`;
      }
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", onError); resolve(); });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, url: `${origin}/#${token}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

export async function runDashboard(args = []) {
  const command = parseWebCommand(args);
  if (command.action !== "start") throw new Error(WEB_USAGE);
  // Viewing/editing remain local. Only a saved scheduled cloud-snapshots
  // configuration can cause uploads; the shared deadline avoids duplicates.
  process.env.MEMORY_DISABLE_BACKGROUND_SYNC = "1";
  const app = await startDashboard({ port: command.port ?? getConfig().webPort });
  startSnapshotScheduler({ panel: true });
  console.log(`Memory dashboard\n${app.url}\nOpen this private connection URL in your browser. Reopen it to reconnect.\nStop: Ctrl+C. Local storage; saved snapshot schedules are active. No cloud polling or model loading.`);
  let stop;
  try {
    await new Promise(resolve => {
      stop = resolve;
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
    });
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    await app.close();
    stopSnapshotScheduler();
    const { closeDatabase } = await import("../db/database.js");
    closeDatabase();
  }
}
