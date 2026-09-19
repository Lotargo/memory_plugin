# Agent-Driven Knowledge Graph Reference

Detailed reference for Layer 3 (Agent-Driven Knowledge Graph) tools: `link_knowledge`.

## Architecture

Automatic regex/heuristic algorithms alone CANNOT infer high-level semantic intent or cross-document relationships. **You (the AI Agent) are the primary architect of the Knowledge Graph.**

When an ingested source supports a durable project decision or rule, link the corresponding Notebook fact directly to the RAG document and, when useful, its exact line range. The Notebook fact is the concise orientation point; the linked RAG source is its detailed evidence and technical context.

## Linking Facts to Documents

Use `link_knowledge` to connect a Notebook fact to a specific document, section, or exact line range:

- `action` (required): `"link"`, `"list_links"`, or `"get_doc_links"`
- `factText` (required for `"link"`): the exact text of the Notebook fact to link
- `docId` (required for `"link"`): the document ID, title, or path of the RAG document
- `startLine` / `endLine` (optional): exact line range within the document
- `relationType` (optional): relationship type, e.g. `"IMPLEMENTS"`, `"SUPPORTS"`, `"DEFINES"`
- `directory` (optional): workspace/project directory path

### Examples

```json
{
  "action": "link",
  "factText": "Use PostgreSQL 16 for primary persistence",
  "docId": "database_guide.md",
  "startLine": 20,
  "endLine": 35,
  "relationType": "IMPLEMENTS"
}
```

```json
{
  "action": "list_links"
}
```

```json
{
  "action": "get_doc_links",
  "docId": "database_guide.md"
}
```

## How Linked Memory Appears (`recall`)

When `recall` is invoked, the engine returns saved facts along with their Agent-linked Knowledge Base documents and exact line ranges:

```
--- memory_plugin ---
1. Use Fastify instead of Express for backend services 🔗 [Linked Docs: Project Architecture Specs:L5-7]
2. PostgreSQL 16 is primary database 🔗 [Linked Docs: database_guide.md:L20-35]
```
