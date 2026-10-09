import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, delimiter, extname, join } from "node:path";

function envValue(env, name) {
  if (Object.prototype.hasOwnProperty.call(env || {}, name)) return env[name];
  const key = Object.keys(env || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

export function resolveClientExecutable(name, {
  env = process.env,
  platform = process.platform,
} = {}) {
  if (String(env.MEMORY_PLUGIN_DISABLE_NATIVE_CLI || "") === "1") return null;
  const pathValue = envValue(env, "PATH") || "";
  const directories = pathValue.split(delimiter).filter(Boolean);
  const extensions = platform === "win32"
    ? (envValue(env, "PATHEXT") || ".EXE;.COM;.CMD;.BAT").split(";").filter(Boolean)
    : [""];

  for (const directory of directories) {
    const base = join(directory, name);
    const candidates = platform === "win32" && extname(base)
      ? [base]
      : extensions.map((extension) => `${base}${extension.toLowerCase()}`)
        .concat(extensions.map((extension) => `${base}${extension.toUpperCase()}`));
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Hosts embed this code in their own binaries (for example `opencode-cli.exe`),
// where `process.execPath` is the host, not Node: it cannot run our scripts and
// just prints its own usage. Anything launched or registered as a Node command
// must use a real Node executable.
export const isNodeExecutable = (file) => /^node(?:js)?(?:\.exe)?$/i.test(basename(String(file || "")));
export function nodeExecutable({ execPath = process.execPath, env = process.env, platform = process.platform } = {}) {
  if (isNodeExecutable(execPath)) return execPath;
  // Node is not a client CLI, so the native-client switch must not hide it.
  const found = resolveClientExecutable("node", { env: { ...env, MEMORY_PLUGIN_DISABLE_NATIVE_CLI: "0" }, platform });
  return found && isNodeExecutable(found) ? found : execPath;
}

export function runClientCli(name, args, {
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  timeout = 20_000,
} = {}) {
  const executable = resolveClientExecutable(name, { env, platform });
  if (!executable) {
    return { available: false, ok: false, status: null, executable: null, stdout: "", stderr: "" };
  }

  const isWindowsShim = platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
  const command = isWindowsShim ? (envValue(env, "ComSpec") || "cmd.exe") : executable;
  const commandArgs = isWindowsShim ? ["/d", "/s", "/c", executable, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    encoding: "utf-8",
    timeout,
    windowsHide: true,
    shell: false,
  });
  return {
    available: true,
    ok: result.status === 0 && !result.error,
    status: result.status,
    executable,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
  };
}

export function cliFailureMessage(result) {
  if (!result?.available) return "client CLI is not installed or not available on PATH";
  if (result.error) return result.error.message;
  const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/).pop();
  return detail || `client CLI exited with status ${result.status}`;
}
