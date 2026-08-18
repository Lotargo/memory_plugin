export const MEMORY_ROUTING_POLICY = `MEMORY ROUTING DIRECTIVE:
- Use remember for concise durable facts, preferences, constraints, conventions, and decisions that should remain hot and frequently available.
- Use remember_note for high-value long-form internal memory: decision rationale, investigations, research/experiment results, implementation context, and handoffs that may matter later but should not be auto-injected every session.
- Use ingest_document for external reusable source material such as files, documentation, codebases, URLs, reports, specifications, and authoritative research sources.
- Do not save transient conversation noise, routine progress chatter, or disposable intermediate output into either Notebook memory or RAG Memory Notes.
- Do not duplicate a long note body into remember. When both hot orientation and detailed cold context are useful, save one concise Notebook fact and one detailed RAG Memory Note, then link the fact to the note/document when appropriate.
- When searching cold memory or knowledge and you first need to identify the right source, prefer query_knowledge_base with resultMode="index", inspect the compact candidates, then expand only the selected doc_id with manage_knowledge_base(action="read_document"). Use resultMode="snippet" when you already want retrieved passage content.`;

export const MEMORY_ROUTING_SHORT =
  "remember = concise hot durable fact; remember_note = long-form cold internal memory; ingest_document = external reusable source. Avoid transient noise and duplicate hot/cold bodies.";
