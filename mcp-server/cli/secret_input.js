import { createInterface } from "node:readline";

// Reading a token from argv leaks it into `ps`, Task Manager, shell history and
// CI logs. Preferred order: environment variable -> stdin prompt -> argv (warned).
export async function resolveSecret({ argvValue, envKeys = [], promptLabel = "Token", interactive = true }) {
  for (const key of envKeys) {
    const v = process.env[key];
    if (v && String(v).trim()) return String(v).trim();
  }

  if (argvValue && String(argvValue).trim()) {
    console.error(
      `  [WARN] Passing a secret on the command line exposes it to the process list and shell history. ` +
        `Prefer ${envKeys[0] || "an environment variable"} or the interactive prompt.`
    );
    return String(argvValue).trim();
  }

  if (!interactive || !process.stdin.isTTY) return null;
  return await readHiddenLine(`${promptLabel}: `);
}

// Read a line from stdin without echoing it back to the terminal.
export function readHiddenLine(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      const s = String(char);
      if (s === "\n" || s === "\r" || s === "\u0004") {
        process.stdin.removeListener("data", onData);
        return;
      }
      process.stdout.write("\x1b[2K\x1b[200D" + prompt + "*".repeat(rl.line.length));
    };
    process.stdout.write(prompt);
    process.stdin.on("data", onData);
    rl.question("", (answer) => {
      process.stdin.removeListener("data", onData);
      rl.close();
      process.stdout.write("\n");
      resolve(String(answer || "").trim());
    });
  });
}
