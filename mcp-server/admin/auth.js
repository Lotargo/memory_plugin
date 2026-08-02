import http from "node:http";
import { saveSecrets, deleteSecrets } from "../config/auth_store.js";
import { updateConfig } from "../config/config_manager.js";

// Starts a temporary loopback HTTP server to listen for callback from browser login
export function startAuthLoopbackServer(port = 48900) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        const dbUrl = url.searchParams.get("db_url") || url.searchParams.get("dbUrl");

        if (!token || !dbUrl) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Ошибка: Токен (token) и URL базы данных (db_url) обязательны!");
          server.close();
          reject(new Error("Missing token or db_url in auth callback"));
          return;
        }

        // Save secrets securely and configure Turso Url
        saveSecrets({ token, dbUrl });
        updateConfig({ tursoUrl: dbUrl });

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
              <h2 style="color: #2e7d32;">Авторизация успешна!</h2>
              <p>Плагин успешно принял учетные данные. Вы можете закрыть эту вкладку.</p>
            </body>
          </html>
        `);

        server.close(() => {
          resolve({ token, dbUrl });
        });
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    });

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`\n  [*] Ожидание авторизации на локальном порту http://localhost:${port}/callback...`);
    });
  });
}

// Perform Cloud login flow
export async function loginToCloud({ customPort = 48900, simulated = false, simulatedParams = null } = {}) {
  // Opening the browser, etc. (we skip browser auto-open in automated test runs/simulations)
  const loginUrl = `https://auth.lotargo.com/login?device_id=memory_plugin&port=${customPort}`;
  console.log(`\n  [CLOUD] Пожалуйста, откройте системный браузер для авторизации:`);
  console.log(`  \x1b[36m${loginUrl}\x1b[0m\n`);

  if (simulated && simulatedParams) {
    // Send local HTTP request to simulate loopback
    return new Promise((resolve, reject) => {
      const serverPromise = startAuthLoopbackServer(customPort);

      const req = http.request(
        `http://127.0.0.1:${customPort}/callback?token=${encodeURIComponent(simulatedParams.token)}&db_url=${encodeURIComponent(simulatedParams.dbUrl)}`,
        { method: "GET" },
        (res) => {
          res.resume();
        }
      );
      req.on("error", (e) => reject(e));
      req.end();

      resolve(serverPromise);
    });
  }

  return startAuthLoopbackServer(customPort);
}

// Logout and reset configurations
export function logoutFromCloud() {
  const deleted = deleteSecrets();
  updateConfig({ tursoUrl: "", mode: "only-local" });
  return deleted;
}
