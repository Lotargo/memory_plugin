import assert from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { linkOpenCodeToRepository, rewriteOpenCodePluginList, syncDevelopmentSkills } from "../../mcp-server/dev_link.js";

export async function runDevLinkTests() {
  console.log("--- Running Unit Tests: dev_link ---");
  const devUrl = "file:///F:/projects/plugins/memory/opencode-plugin/main.js";
  const unrelatedTuple = ["other-plugin", { enabled: true }];
  const rewritten = rewriteOpenCodePluginList(
    ["unrelated", "@lotargo/memory_plugin", "memory-plugin", unrelatedTuple],
    devUrl
  );
  assert.deepStrictEqual(rewritten, ["unrelated", devUrl, unrelatedTuple]);
  assert.deepStrictEqual(rewriteOpenCodePluginList(rewritten, devUrl), rewritten, "rewrite must be idempotent");

  const root = await mkdtemp(join(tmpdir(), "memory-dev-link-"));
  try {
    const configPath = join(root, "opencode.json");
    const pluginFile = join(root, "main.js");
    await writeFile(pluginFile, "export default async () => ({});\n", "utf-8");
    await writeFile(
      configPath,
      JSON.stringify({ plugin: ["other-plugin", "@lotargo/memory_plugin"], keep: { value: true } }, null, 2),
      "utf-8"
    );

    const result = await linkOpenCodeToRepository({ configDir: root, pluginFile });
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    assert.deepStrictEqual(config.keep, { value: true }, "unrelated config must be preserved");
    assert.deepStrictEqual(config.plugin, ["other-plugin", pathToFileURL(pluginFile).href]);
    assert.strictEqual(result.devPluginUrl, pathToFileURL(pluginFile).href);
    assert.ok(await readFile(result.backupPath, "utf-8"), "first dev link must back up the config");

    const skillsSource = join(root, "skills-source");
    const targetA = join(root, "skills-a");
    const targetB = join(root, "skills-b");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(skillsSource, "using-memory"), { recursive: true });
    await writeFile(join(skillsSource, "using-memory", "SKILL.md"), "dev skill\n", "utf-8");
    const destinations = await syncDevelopmentSkills({ skillsSource, targets: [targetA, targetB] });
    assert.deepStrictEqual(destinations, [targetA, targetB]);
    assert.strictEqual(await readFile(join(targetA, "using-memory", "SKILL.md"), "utf-8"), "dev skill\n");
    assert.strictEqual(await readFile(join(targetB, "using-memory", "SKILL.md"), "utf-8"), "dev skill\n");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  console.log("✅ LOCAL DEVELOPMENT LINK TESTS PASSED!");
}

if (process.argv[1] && process.argv[1].endsWith("dev_link.test.js")) {
  runDevLinkTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
}
