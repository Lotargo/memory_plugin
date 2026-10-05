// A small installed plugin adapter. The immutable, prepared runtime lives
// outside the host's plugin cache, and user data lives outside both.
const { readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const receipt = JSON.parse(readFileSync(join(__dirname, '..', 'runtime.json'), 'utf8'));
  if (!['codex', 'claude'].includes(receipt.client)) throw new Error('Invalid memory plugin client');
  const runtime = receipt.runtime;
  const pkg = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'));
  if (pkg.name !== '@lotargo/memory_plugin' || pkg.version !== receipt.version || !existsSync(join(runtime, 'node_modules'))) {
    throw new Error('Memory runtime is missing or has changed. Rebuild and reinstall the local marketplace.');
  }
  process.env.MEMORY_DIR = receipt.memoryDir;
  const integration = await import(pathToFileURL(join(runtime, 'mcp-server', 'plugin_integration.js')));
  const action = process.argv[2];
  if (action === 'hook') {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 100000) throw new Error('Hook input is too large');
    }
    const payload = JSON.parse(input || '{}');
    const cwd = resolve(payload.cwd || process.cwd());
    // No persistent instruction files, storage writes, cloud access or recall
    // from this hook. The agent performs one full recall through its MCP tools.
    const status = await integration.integrationStatus(receipt.client, { cwd });
    if (status.direct || status.foreignDirect || status.projectDirect) throw new Error('Direct memory-agent is still registered; migrate the integration before loading plugin instructions.');
    const { PROMPT_BLOCK } = await import(pathToFileURL(join(runtime, 'mcp-server', 'prompt_manager.js')));
    const context = PROMPT_BLOCK.replace('from `memory-agent`', 'from the MCP server supplied by the memory plugin')
      + '\nUse the memory plugin tools by their names as exposed by this client. Do not assume the standalone MCP namespace.\n'
      + `Current workspace directory: ${JSON.stringify(cwd)}. Pass this directory explicitly to project-scoped memory tools; do not use the installed plugin or runtime directory.\n`
      + 'If the complete active memory has already been recalled in this conversation, do not repeat initialization merely because this hook ran on resume.\n';
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }) + '\n');
  } else if (action === 'mcp') {
    await integration.assertPluginLaunchAllowed(receipt.client);
    const boot = join(runtime, 'mcp-server', 'boot.js');
    process.argv = [process.execPath, boot];
    await import(pathToFileURL(boot));
  } else throw new Error('Expected mcp or hook');
})().catch(error => { process.stderr.write(`Memory plugin: ${error.message}\n`); process.exitCode = 1; });
