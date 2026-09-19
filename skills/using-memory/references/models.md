# ML Model Memory Management Reference

Detailed reference for managing RAG ML models (embedding + reranker) via `memory-cli models`.

## Overview

When the user asks to move, load, or unload the RAG ML models, drive it through the plugin CLI in the shell — do NOT attempt to restart the MCP server yourself.

## Check Where Models Live

```bash
memory-cli models status --json
```

Inspect the response:

- `server.embedding.device` / `server.reranker.device` — `null` = not loaded, `"cpu"` = RAM, `"dml"`/`"cuda"`/`"webgpu"` = GPU/VRAM
- `gpuMemory` — VRAM used/total

## Load Models into GPU / VRAM

If status shows models on `cpu` or not loaded:

```bash
memory-cli models load --device gpu
```

This switches the execution device AND preloads the models inside the running MCP server. Confirm with:

```bash
memory-cli models status
```

## Move Models Back to CPU / RAM

```bash
memory-cli models load --device cpu
```

Or switch lazily without preloading:

```bash
memory-cli models device cpu
```

## Unload Models and Verify Memory is Freed

```bash
memory-cli models unload
```

This unloads both ONNX sessions from the running MCP server and prints before/after server RAM (RSS) and GPU VRAM so you can report the freed amount to the user.

## Auto-Unload Timer

```bash
memory-cli models timer 10   # unload after 10 minutes idle
memory-cli models timer off  # disable
```

## Edge Cases

- If status reports `server: null`, the MCP server is not running: models are not loaded anywhere, and `device`/`timer` changes apply on the next server start.
