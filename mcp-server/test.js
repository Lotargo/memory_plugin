import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("Starting MCP Memory Server test...");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["mcp-server/index.js"],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected to MCP server successfully!");

  // 1. List tools
  const toolsResult = await client.listTools();
  console.log("\nRegistered tools:");
  toolsResult.tools.forEach((t) => console.log(` - ${t.name}: ${t.description}`));

  const toolNames = toolsResult.tools.map((t) => t.name);
  if (!toolNames.includes("remember") || !toolNames.includes("recall") || !toolNames.includes("forget")) {
    throw new Error("Missing required tools!");
  }

  // 2. Test 'remember' tool (project scope)
  console.log("\nTesting 'remember' (project scope)...");
  const remProjRes = await client.callTool({
    name: "remember",
    arguments: { fact: "Test project fact: prefers async await", scope: "project" },
  });
  console.log("Result:", remProjRes.content[0].text);

  // 3. Test 'remember' tool (global scope)
  console.log("\nTesting 'remember' (global scope)...");
  const remGlobRes = await client.callTool({
    name: "remember",
    arguments: { fact: "Test global fact: user primary language is Russian", scope: "global" },
  });
  console.log("Result:", remGlobRes.content[0].text);

  // 4. Test duplicate prevention
  console.log("\nTesting duplicate prevention...");
  const dupRes = await client.callTool({
    name: "remember",
    arguments: { fact: "Test project fact: prefers async await", scope: "project" },
  });
  console.log("Result:", dupRes.content[0].text);

  // 5. Test 'recall' (all scopes)
  console.log("\nTesting 'recall' (all)...");
  const recallRes = await client.callTool({
    name: "recall",
    arguments: { scope: "all" },
  });
  console.log("Recall output:\n" + recallRes.content[0].text);

  // 6. Test 'forget' (project scope)
  console.log("\nTesting 'forget' (search text 'prefers async await')...");
  const forgetRes = await client.callTool({
    name: "forget",
    arguments: { query: "prefers async await", scope: "project" },
  });
  console.log("Result:", forgetRes.content[0].text);

  // Clean up test global fact as well
  console.log("\nCleaning up test global fact...");
  await client.callTool({
    name: "forget",
    arguments: { query: "primary language is Russian", scope: "global" },
  });

  // 7. Verify recall after forget
  console.log("\nTesting 'recall' after cleanup...");
  const finalRecall = await client.callTool({
    name: "recall",
    arguments: { scope: "all" },
  });
  console.log("Recall output:\n" + finalRecall.content[0].text);

  await client.close();
  console.log("\nALL TESTS PASSED SUCCESSFULLY!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
