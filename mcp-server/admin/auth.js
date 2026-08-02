import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { saveSecrets, deleteSecrets } from "../config/auth_store.js";
import { updateConfig } from "../config/config_manager.js";

export const TURSO_API_BASE = () => process.env.TURSO_API_BASE || "https://api.turso.tech";

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch (err) {
    // Browser auto-open is best-effort; the printed URL can be opened manually.
  }
}

// Starts a temporary loopback HTTP server to receive the OAuth callback.
// Turso redirects the browser back to the root path:  /?jwt=<JWT>&username=<USERNAME>
export function startAuthLoopbackServer(port = 48900) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get("jwt") || url.searchParams.get("token");
      const username = url.searchParams.get("username");
      const error = url.searchParams.get("error");

      if (token) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <title>Authorization Successful</title>
              <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                  -webkit-font-smoothing: antialiased;
                  background: radial-gradient(1200px 600px at 50% -10%, #1c2028 0%, #101218 55%, #0c0e13 100%);
                  color: #e8ebf2;
                  padding: 24px;
                }
                .card {
                  max-width: 420px;
                  width: 100%;
                  background: #161a21;
                  border: 1px solid rgba(255, 255, 255, 0.07);
                  border-radius: 20px;
                  padding: 46px 38px;
                  text-align: center;
                  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
                }
                .badge {
                  width: 76px;
                  height: 76px;
                  margin: 0 auto 26px;
                  border-radius: 50%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: rgba(94, 224, 154, 0.10);
                  border: 1px solid rgba(94, 224, 154, 0.28);
                }
                .badge svg { width: 36px; height: 36px; }
                h1 { font-size: 22px; font-weight: 600; letter-spacing: 0.2px; color: #f2f4f8; margin-bottom: 12px; }
                p { font-size: 14px; line-height: 1.65; color: #9aa3b2; }
                .hint { margin-top: 24px; font-size: 12.5px; color: #6f7887; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#5ee09a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
                <h1>Authorization successful</h1>
                <p>Your credentials were received and stored securely on this device.</p>
                <div class="hint">You can now close this tab and return to the terminal.</div>
              </div>
            </body>
          </html>
        `);

        server.close(() => {
          resolve({ token, username: username || "" });
        });
      } else if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <title>Authorization Failed</title>
              <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                  -webkit-font-smoothing: antialiased;
                  background: radial-gradient(1200px 600px at 50% -10%, #1c2028 0%, #101218 55%, #0c0e13 100%);
                  color: #e8ebf2;
                  padding: 24px;
                }
                .card {
                  max-width: 400px;
                  width: 100%;
                  background: #161a21;
                  border: 1px solid rgba(255, 255, 255, 0.07);
                  border-radius: 20px;
                  padding: 40px 34px;
                  text-align: center;
                  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
                }
                h1 { font-size: 20px; font-weight: 600; color: #f2f4f8; margin-bottom: 12px; }
                p { font-size: 14px; line-height: 1.65; color: #9aa3b2; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>Authorization failed</h1>
                <p>An error occurred during the login flow. Close this tab, return to the terminal, and try again.</p>
              </div>
            </body>
          </html>
        `);
        server.close(() => reject(new Error(`Authentication error: ${error}`)));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    });

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`\n  [*] Waiting for authorization on local port http://localhost:${port}/...`);
    });
  });
}

async function apiRequest(token, pathname, { method = "GET", body } = {}) {
  const res = await fetch(`${TURSO_API_BASE()}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    const err = new Error(data?.error || `Turso API ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Validate the account JWT obtained from OAuth and return current-user info.
export async function validateTursoToken(token) {
  return apiRequest(token, "/v1/current-user");
}

export async function listOrganizations(token) {
  const data = await apiRequest(token, "/v1/organizations");
  const orgs = data?.organizations || [];
  return orgs.map((o) => ({
    slug: o.slug || o.Slug || o.id || o.Id || null,
    name: o.name || o.Name || null,
    id: o.id || o.Id || null,
  }));
}

export async function listDatabases(token, org) {
  const data = await apiRequest(token, `/v1/organizations/${encodeURIComponent(org)}/databases`);
  const dbs = data?.databases || [];
  return dbs.map((d) => ({
    name: d.name || d.Name,
    hostname: d.hostname || d.Hostname,
    id: d.id || d.Id,
  }));
}

export async function createDatabase(token, org, name) {
  try {
    const data = await apiRequest(token, `/v1/organizations/${encodeURIComponent(org)}/databases`, {
      method: "POST",
      body: { name },
    });
    const d = data?.database || data;
    return { name: d.name || d.Name, hostname: d.hostname || d.Hostname, id: d.id || d.Id };
  } catch (err) {
    // Fresh accounts have no default group; create one, then retry.
    if (!String(err.message || "").toLowerCase().includes("group")) {
      throw err;
    }
    console.log(`  [CLOUD] No group found. Creating group "default"...`);
    await createGroup(token, org, "default");
    const data = await apiRequest(token, `/v1/organizations/${encodeURIComponent(org)}/databases`, {
      method: "POST",
      body: { name, group: "default" },
    });
    const d = data?.database || data;
    return { name: d.name || d.Name, hostname: d.hostname || d.Hostname, id: d.id || d.Id };
  }
}

// Turso's public closest-region endpoint (no auth required).
// Returns e.g. { server: "aws-eu-west-1", client: "ams" }.
async function getClosestLocation() {
  if (process.env.TURSO_LOCATION) return process.env.TURSO_LOCATION;
  const fallback = "ams";
  try {
    const res = await fetch("https://region.turso.io/", { signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => null);
    const loc = data?.server || data?.client || null;
    if (loc && /^[a-z0-9-]+$/i.test(loc)) return loc;
  } catch {
    // ignore
  }
  return fallback;
}

export async function createGroup(token, org, name) {
  // Always provide an explicit location: Turso's internal auto-lookup fails
  // with "invalid location: Host not found" when the group has no location.
  const location = await getClosestLocation();
  const data = await apiRequest(token, `/v1/organizations/${encodeURIComponent(org)}/groups`, {
    method: "POST",
    body: { name, location },
  });
  return data?.group || data;
}

export async function createDatabaseToken(token, org, db, { expiration = "never", authorization = "full-access" } = {}) {
  const data = await apiRequest(
    token,
    `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(db)}/auth/tokens?expiration=${encodeURIComponent(expiration)}&authorization=${encodeURIComponent(authorization)}`,
    { method: "POST", body: {} }
  );
  return data?.jwt || null;
}

function dbHostname(org, dbName) {
  return `${dbName}-${org}.turso.io`;
}

// Perform the full cloud login flow:
//   1. OAuth browser flow against Turso (api.turso.tech).
//   2. Validate the received account JWT.
//   3. Resolve an organization and pick/create a database.
//   4. Mint a full-access token for that database.
//   5. Persist the encrypted token + dbUrl and mark the session as authorized.
export async function loginToCloud({
  customPort = 48900,
  simulated = false,
  simulatedParams = null,
  autoCreate = true,
  databaseName = null,
} = {}) {
  const state = crypto.randomBytes(16).toString("hex");
  const loginUrl = `${TURSO_API_BASE()}/?port=${customPort}&redirect=true&state=${state}&type=cli`;

  console.log(`\n  [CLOUD] Please open your system browser to authorize:`);
  console.log(`  \x1b[36m${loginUrl}\x1b[0m\n`);

  let received;
  if (simulated && simulatedParams) {
    received = await new Promise((resolve, reject) => {
      const serverPromise = startAuthLoopbackServer(customPort);
      const req = http.request(
        `http://127.0.0.1:${customPort}/?jwt=${encodeURIComponent(simulatedParams.jwt)}&username=${encodeURIComponent(simulatedParams.username)}`,
        { method: "GET" },
        (res) => {
          res.resume();
        }
      );
      req.on("error", (e) => reject(e));
      req.end();
      serverPromise.then(resolve).catch(reject);
    });
  } else {
    openBrowser(loginUrl);
    received = await startAuthLoopbackServer(customPort);
  }

  const { token, username } = received;

  // Step 2: validate the account token
  let userInfo = null;
  try {
    userInfo = await validateTursoToken(token);
  } catch (err) {
    throw new Error(`Token validation failed: ${err.message}`);
  }
  const accountUsername = username || userInfo?.username || userInfo?.name || "user";
  console.log(`  [OK] Token is valid. User: ${accountUsername}`);

  // Step 3: resolve organization + database
  const orgs = await listOrganizations(token);
  let org;
  let orgName;
  if (orgs && orgs.length > 0) {
    org = orgs[0].slug || orgs[0].name || orgs[0].id || String(orgs[0]);
    orgName = orgs[0].name || org;
  } else {
    // Personal accounts are not listed in /v1/organizations, but their own
    // username acts as the organization namespace in the Platform API.
    org = accountUsername;
    orgName = accountUsername;
    console.log(`  [CLOUD] No organizations found. Using personal account "${org}" as the database namespace.`);
  }

  const dbs = await listDatabases(token, org);
  if (dbs.length > 0) {
    console.log(`\n  [CLOUD] Databases in organization "${orgName}":`);
    dbs.forEach((d, i) => console.log(`    ${i + 1}. ${d.name}`));
  }

  let dbName = databaseName;
  if (!dbName) {
    if (dbs.length > 0) {
      dbName = dbs[0].name;
      console.log(`\n  [CLOUD] Using existing database: "${dbName}"`);
    } else if (autoCreate) {
      dbName = `memory-${accountUsername}`;
      console.log(`\n  [CLOUD] No database found. Creating "${dbName}"...`);
      await createDatabase(token, org, dbName);
      console.log(`  [OK] Database "${dbName}" created.`);
    } else {
      throw new Error("No databases found and autoCreate is disabled.");
    }
  }

  // Step 4: mint a full-access token for the database
  console.log("  [CLOUD] Issuing database access token...");
  const dbJwt = await createDatabaseToken(token, org, dbName);
  if (!dbJwt) {
    throw new Error("Failed to create database auth token.");
  }

  const dbUrl = `libsql://${dbHostname(org, dbName)}`;

  // Step 5: persist secrets and mark authorized
  saveSecrets({ token: dbJwt, dbUrl, username: accountUsername, org, db: dbName, authorized: true });
  updateConfig({ tursoUrl: dbUrl, authorized: true, username: accountUsername });

  console.log(`\n  \x1b[32m[OK] Successfully signed in to the cloud! Endpoint: ${dbUrl}\x1b[0m`);
  return { token: dbJwt, dbUrl, username: accountUsername, org, db: dbName, authorized: true };
}

// Logout and reset configurations
export function logoutFromCloud() {
  const deleted = deleteSecrets();
  updateConfig({ tursoUrl: "", mode: "only-local", authorized: false, username: "" });
  return deleted;
}
