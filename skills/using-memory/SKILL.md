---
name: using-memory
description: Use the memory and RAG tools (remember, recall, forget, ingest_document, query_knowledge_base, manage_knowledge_base) to persist facts and query large document knowledge bases. Proactively remember preferences and conventions, ingest documentation or source code, and perform hybrid retrieval for technical context.
---

# Using Memory & RAG Knowledge Engine

You have access to persistent memory and hybrid RAG tools.

## 1. Key-Value Durable Memory (`remember`, `recall`, `forget`)

- **Save (`remember`)**: User's name, role, language, technical constraints, preferred tech stack, and project conventions. Translate facts into English and keep them concise.
- **Recall (`recall`)**: Retrieve stored facts across global or project scope.
- **Forget (`forget`)**: Remove outdated or contradicted facts.

## 2. Hybrid RAG Knowledge Engine (`ingest_document`, `query_knowledge_base`, `manage_knowledge_base`)

- **Ingest (`ingest_document`)**: Ingest markdown files, web documentation URLs, or raw text blocks into the local vector & BM25 database.
- **Query (`query_knowledge_base`)**: Perform hybrid BM25 + dense vector RRF search to retrieve relevant candidate sections, code symbol definitions, and context blocks.
- **Manage (`manage_knowledge_base`)**: List ingested documents, delete outdated docs, inspect stats, or export/import snapshots.
