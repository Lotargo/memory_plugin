// Type declarations for @lotargo/memory_plugin/sdk

export interface RememberOptions {
  fact: string;
  scope?: "project" | "global";
  docId?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  relationType?: string;
  projectPath?: string | null;
}

export interface LinkInfo {
  linkId: string;
  factKey: string;
  factText: string;
  docId: string;
  docTitle: string;
  startLine: number | null;
  endLine: number | null;
  relationType: string;
}

export interface RememberResult {
  status: "added" | "exists";
  added: boolean;
  fact: string;
  scope: "project" | "global";
  store: string;
  link: LinkInfo | null;
  linkError: string | null;
}

export interface RecallFact {
  index: number;
  text: string;
  links: any[];
}

export interface RecallResult {
  scope: string;
  global: RecallFact[];
  project: { key: string; label: string; facts: RecallFact[] } | null;
  stores: ProjectStore[] | null;
}

export interface ProjectStore {
  key: string;
  path: string | null;
  basename: string;
  file: string;
  count: number;
  legacy: boolean;
}

export interface ForgetResult {
  status: "removed" | "not_found";
  removed: string[];
  count: number;
}

export interface IngestResult {
  status: "success";
  docId: string;
  title: string | null;
  path: string;
  sectionsCount: number;
  microChunksCount: number;
  deduplicated: boolean;
}

export interface SearchHit {
  chunk_id: string;
  doc_title: string | null;
  doc_path: string | null;
  heading: string | null;
  breadcrumbs: string | null;
  snippet: string;
  paragraph_context: string;
  full_section_content: string | null;
  score: number;
  rsf_score: number | null;
  rrf_score: number | null;
  cosine_sim: number | null;
  defined_symbols: string[];
}

export interface QueryResult {
  query: string;
  activeModel: string;
  fusionAlgorithm: string;
  results: SearchHit[];
}

export interface KbStats {
  documents: number;
  sections: number;
  medium_chunks: number;
  micro_chunks: number;
  graph_edges: number;
}

export interface Config {
  fusionAlgorithm: string;
  alpha: number;
  embeddingModel: string;
  rerankerModel: string;
  rerankerEnabled: boolean;
  batchSize: number;
  gpuAttentionBudget: number;
  onnxThreads: number;
  executionDevice: string;
}

export interface EngineOptions {
  memoryDir?: string | null;
  opencodeConfigDir?: string | null;
}

export function configure(options?: {
  memoryDir?: string | null;
  opencodeConfigDir?: string | null;
}): { memoryDir: string | null };

export class MemoryEngine {
  constructor(options?: EngineOptions);
  readonly memoryDir: string | null;
  remember(options: RememberOptions): Promise<RememberResult>;
  recall(options?: { scope?: string; project?: string | null }): Promise<RecallResult>;
  forget(options: { query: string; scope?: "project" | "global"; projectPath?: string | null }): Promise<ForgetResult>;
  listStores(): Promise<ProjectStore[]>;
  migrateLegacyStore(legacyKey: string, targetDir: string): Promise<any>;
  linkKnowledge(options: {
    action?: "link" | "get_doc_links" | "list_links";
    factText?: string | null;
    docId?: string | null;
    scope?: "project" | "global";
    startLine?: number | null;
    endLine?: number | null;
    relationType?: string;
    projectPath?: string | null;
  }): Promise<{ action: string; result: any }>;
  ingestDocument(options: {
    content: string;
    type?: "text" | "file" | "url";
    title?: string | null;
    path?: string | null;
    generateEmbeddings?: boolean;
  }): Promise<IngestResult>;
  queryKnowledgeBase(options: {
    query: string;
    limit?: number;
    instruction?: string | null;
    generateEmbeddings?: boolean;
    includeGraphContext?: boolean;
    fusionAlgorithm?: string | null;
    alpha?: number | null;
    scoreThreshold?: number;
  }): Promise<QueryResult>;
  kbStats(): Promise<KbStats>;
  kbList(): Promise<any[]>;
  kbReadDocument(docId: string): Promise<{ id: string; title: string; path: string; created_at: number; content: string }>;
  kbDelete(docId: string): Promise<any>;
  kbExportSnapshot(outputPath?: string | null): Promise<{ outputPath: string }>;
  kbImportSnapshot(snapshotPath: string): Promise<any>;
  kbHardReset(): Promise<any>;
  close(): Promise<void>;
  getConfig(): Promise<Config>;
  updateConfig(partial: Partial<Config>): Promise<Config>;
  resetConfig(): Promise<Config>;
}

export function createEngine(options?: EngineOptions): Promise<MemoryEngine>;

export default MemoryEngine;
