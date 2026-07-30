import subprocess
import json
import time
import sys
import os

def find_mcp_server_path():
    # 1. Check local repository path first
    local_path = os.path.abspath("mcp-server/index.js")
    if os.path.exists(local_path):
        return ["node", local_path]

    # 2. Try using npm root -g
    try:
        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
        npm_root = subprocess.check_output([npm_cmd, "root", "-g"], text=True).strip()
        candidate = os.path.join(npm_root, "@lotargo/memory_plugin/mcp-server/index.js")
        if os.path.exists(candidate):
            return ["node", candidate]
    except Exception:
        pass

    # 3. Fallback to container path
    container_default = "/home/jules/.nvm/versions/node/v22.22.1/lib/node_modules/@lotargo/memory_plugin/mcp-server/index.js"
    if os.path.exists(container_default):
        return ["node", container_default]

    # 4. Final fallback to npx
    npx_cmd = "npx.cmd" if os.name == "nt" else "npx"
    return [npx_cmd, "memory-agent"]

def run_mcp_test():
    print("=== Starting Custom MCP Server Integration Test ===")

    cmd = find_mcp_server_path()
    print(f"Executing server command: {' '.join(cmd)}")

    # Spawn the MCP server as a subprocess
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )

    # Wait briefly to ensure it starts up
    time.sleep(1)

    # Helper function to send a JSON-RPC request and get the response
    def send_request(method, params, req_id):
        req = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params
        }
        req_str = json.dumps(req) + "\n"
        print(f"--> Sending {method} (id={req_id})")
        proc.stdin.write(req_str)
        proc.stdin.flush()

        # Read stdout line by line until we get a valid JSON response with matching id
        while True:
            line = proc.stdout.readline()
            if not line:
                print("Error: MCP server disconnected or closed stdout.")
                sys.exit(1)
            line = line.strip()
            if not line:
                continue
            try:
                resp = json.loads(line)
                if resp.get("id") == req_id:
                    print(f"<-- Received Response for id={req_id}")
                    return resp
            except Exception as e:
                print(f"Skipping non-JSON or unrelated line: {line} ({e})")

    try:
        # Step 1: Initialize
        init_params = {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "1.0.0"}
        }
        resp = send_request("initialize", init_params, 1)
        assert "result" in resp, f"Initialization failed: {resp}"
        print("[PASS] Initialize succeeded.")

        # Step 2: List Tools
        resp = send_request("tools/list", {}, 2)
        assert "result" in resp, f"tools/list failed: {resp}"
        tools = resp["result"]["tools"]
        tool_names = [t["name"] for t in tools]
        print(f"[PASS] Retrieved tools: {tool_names}")
        expected_tools = ["remember", "recall", "forget", "link_knowledge", "ingest_document", "query_knowledge_base", "manage_knowledge_base"]
        for ext in expected_tools:
            assert ext in tool_names, f"Expected tool {ext} not found in registry."
        print("[PASS] All expected tools are registered correctly.")

        # Step 3: Test 'remember'
        remember_params = {
            "name": "remember",
            "arguments": {
                "fact": "The project uses SBCL and SWI-Prolog for the Logos cognitive engine.",
                "scope": "project"
            }
        }
        resp = send_request("tools/call", remember_params, 3)
        assert "error" not in resp, f"remember failed: {resp}"
        text_content = resp["result"]["content"][0]["text"]
        print(f"[PASS] remember response: {text_content}")

        # Step 4: Test 'recall'
        recall_params = {
            "name": "recall",
            "arguments": {
                "scope": "project"
            }
        }
        resp = send_request("tools/call", recall_params, 4)
        assert "error" not in resp, f"recall failed: {resp}"
        text_content = resp["result"]["content"][0]["text"]
        print(f"[PASS] recall response: {text_content}")
        assert "SBCL" in text_content and "SWI-Prolog" in text_content, f"Recall did not return expected facts: {text_content}"

        # Step 5: Test 'ingest_document'
        ingest_params = {
            "name": "ingest_document",
            "arguments": {
                "content": "Logos v9 relies on dynamic Occam's Razor penalty for symbolic regression to combat overfitting.",
                "type": "text",
                "title": "Logos Symbolic Regression spec"
            }
        }
        resp = send_request("tools/call", ingest_params, 5)
        assert "error" not in resp, f"ingest_document failed: {resp}"
        ingest_res = json.loads(resp["result"]["content"][0]["text"])
        print(f"[PASS] ingest_document response: {ingest_res}")
        assert ingest_res["status"] == "success", "Ingest status should be success"
        doc_id = ingest_res["docId"]

        # Step 6: Test 'link_knowledge'
        link_params = {
            "name": "link_knowledge",
            "arguments": {
                "action": "link",
                "factText": "SBCL and SWI-Prolog",
                "docId": doc_id,
                "relationType": "IMPLEMENTS"
            }
        }
        resp = send_request("tools/call", link_params, 6)
        assert "error" not in resp, f"link_knowledge failed: {resp}"
        link_res = json.loads(resp["result"]["content"][0]["text"])
        print(f"[PASS] link_knowledge response: {link_res}")

        # Step 7: Test 'query_knowledge_base'
        query_params = {
            "name": "query_knowledge_base",
            "arguments": {
                "query": "symbolic regression Occam's Razor",
                "limit": 3
            }
        }
        resp = send_request("tools/call", query_params, 7)
        assert "error" not in resp, f"query_knowledge_base failed: {resp}"
        query_res = resp["result"]["content"][0]["text"]
        print(f"[PASS] query_knowledge_base response: {query_res}")
        assert "regression" in query_res or "Occam" in query_res, f"Query did not find matching sections: {query_res}"

        # Step 8: Test 'manage_knowledge_base' (stats)
        stats_params = {
            "name": "manage_knowledge_base",
            "arguments": {
                "action": "stats"
            }
        }
        resp = send_request("tools/call", stats_params, 8)
        assert "error" not in resp, f"manage_knowledge_base stats failed: {resp}"
        stats_res = json.loads(resp["result"]["content"][0]["text"])
        print(f"[PASS] manage_knowledge_base stats response: {stats_res}")
        assert stats_res["documents"] > 0, "Doc count should be > 0 after ingestion"

        # Step 9: Test 'manage_knowledge_base' (list)
        list_params = {
            "name": "manage_knowledge_base",
            "arguments": {
                "action": "list"
            }
        }
        resp = send_request("tools/call", list_params, 9)
        assert "error" not in resp, f"manage_knowledge_base list failed: {resp}"
        list_res = json.loads(resp["result"]["content"][0]["text"])
        print(f"[PASS] manage_knowledge_base list response count: {len(list_res)}")

        # Step 10: Test 'forget'
        forget_params = {
            "name": "forget",
            "arguments": {
                "query": "SBCL",
                "scope": "project"
            }
        }
        resp = send_request("tools/call", forget_params, 10)
        assert "error" not in resp, f"forget failed: {resp}"
        forget_res = resp["result"]["content"][0]["text"]
        print(f"[PASS] forget response: {forget_res}")

        # Final recall to confirm deletion
        resp = send_request("tools/call", recall_params, 11)
        assert "error" not in resp, f"recall after forget failed: {resp}"
        recall_after = resp["result"]["content"][0]["text"]
        print(f"[PASS] recall after forget: {recall_after}")
        assert "SBCL" not in recall_after, "Deleted fact should no longer be returned by recall"
        print("[PASS] Forget operation verified successfully.")

        # Cleanup ingested document
        delete_params = {
            "name": "manage_knowledge_base",
            "arguments": {
                "action": "delete",
                "docId": doc_id
            }
        }
        resp = send_request("tools/call", delete_params, 12)
        assert "error" not in resp, f"manage_knowledge_base delete failed: {resp}"
        delete_res = json.loads(resp["result"]["content"][0]["text"])
        print(f"[PASS] manage_knowledge_base delete response: {delete_res}")

        print("\n=== ALL MCP TOOLS SUCCESSFULLY TESTED AND VERIFIED! ===")

    finally:
        # Gracefully shut down the server process
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

        # Read and print stderr for debugging/info
        stderr_output = proc.stderr.read()
        if stderr_output:
            print("\n=== Server Stderr Output ===")
            print(stderr_output)

if __name__ == "__main__":
    run_mcp_test()
