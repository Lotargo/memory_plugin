import {knowledgeRemovalRequest} from '../tools/core/knowledge_removal_core.js';
import { inspectKnowledge, listKnowledgeTargets } from "../services/knowledge_service.js";
import { closeDatabase } from "../db/database.js";
import { knowledgeLinksRequest } from '../tools/core/knowledge_links_core.js';
import { knowledgeContentRequest } from '../tools/core/knowledge_content_core.js';

export const KNOWLEDGE_USAGE = `memory-cli knowledge targets
memory-cli knowledge search --scope-key <key> --query <text> [--include-global] [--search-mode lexical|dense] [--result-mode index|snippet] [--policy-expansion true|false] [--limit N]
memory-cli knowledge search-status --scope-key <key>
memory-cli knowledge graph --scope-key <key> [--include-global] [--doc-id <id>] [--node-type <type>] [--relation-type <relation>] [--offset N] [--limit N]
memory-cli knowledge list --scope-key <key> [--include-global] [--query <text>] [--source-type all|note|source] [--offset N] [--limit N]
memory-cli knowledge read <docId> --scope-key <key> [--raw-offset N] [--start-line N]
memory-cli knowledge hierarchy <docId> --scope-key <key> [--level section|medium|micro] [--parent-id <id>] [--offset N] [--limit N]
memory-cli knowledge chunk <docId> --scope-key <key> --level section|medium|micro --chunk-id <id> [--text-offset N]
memory-cli knowledge links <docId> --scope-key <key> [--include-global] [--offset N] [--limit N]
memory-cli knowledge remove <preview|apply|cleanup> --scope-key <key> [--operation unlink-scope|delete] [--doc-id <id>] [--preview-token <token>] [--confirm] [--confirm-shared]
memory-cli knowledge migrate
memory-cli knowledge content <read|prepare|status|apply|cancel> --scope-key <key> [--operation create-note|update-note|ingest-source|refresh-source|metadata] [--doc-id <id>] [--expected-version <version>] [--fields-json <JSON>] [--operation-id <id>] [--preview-token <token>] [--confirm-shared]
memory-cli knowledge link <migration-status|list|preview|apply> --scope-key <key> [--operation create|update|delete] [--link-id <id>] [--fact-ref id:<id>] [--doc-id <id>] [--fields-json <JSON>] [--preview-token <token>]
Results are JSON. migrate saves a full ZIP backup before changes. Link apply requires a fresh preview token. Reads use local storage only.`;

export function parseKnowledgeCommand(args) {
  const [action, ...rest] = args;
  if (!action || ["help", "--help", "-h"].includes(action)) return { action: "help" };
  if (action === 'migrate') { if (rest.length) throw new Error('migrate takes no options.'); return { action: 'migrate', linkCommand: true }; }
  if (action === 'remove') {
    const result={action:rest[0],removalCommand:true}, flags={'--scope-key':'scopeKey','--operation':'operation','--doc-id':'docId','--preview-token':'previewToken'},seen=new Set();
    if(!['preview','apply','cleanup'].includes(result.action))throw new Error(KNOWLEDGE_USAGE);
    for(let i=1;i<rest.length;i++){const flag=rest[i];if(seen.has(flag))throw new Error('Repeated removal option.');seen.add(flag);
      if(flag==='--confirm'||flag==='--confirm-shared'){result[flag==='--confirm'?'confirm':'confirmShared']=true;continue;}
      if(!flags[flag]||!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('Invalid removal option.');result[flags[flag]]=rest[++i];}
    if(!result.scopeKey)throw new Error('Explicit --scope-key required.');return result;
  }
  if (action === 'content') {
    const result = { action: rest[0], contentCommand: true }, flags = { '--scope-key':'scopeKey','--operation':'operation','--doc-id':'docId','--expected-version':'expectedVersion','--fields-json':'fieldsJson','--operation-id':'operationId','--preview-token':'previewToken' };
    if (!['read','prepare','status','apply','cancel'].includes(result.action)) throw new Error(KNOWLEDGE_USAGE);
    const seen = new Set();
    for (let i = 1; i < rest.length; i++) {
      if (seen.has(rest[i])) throw new Error('Repeated content option.'); seen.add(rest[i]);
      if (rest[i] === '--confirm-shared') { result.confirmShared = true; continue; }
      if (!flags[rest[i]] || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Invalid content option.');
      result[flags[rest[i]]] = rest[++i];
    }
    if (!result.scopeKey) throw new Error('Explicit --scope-key required.'); return result;
  }
  if (action === 'link') {
    const result = { action: rest[0], linkCommand: true }, flags = { '--scope-key': 'scopeKey', '--operation': 'operation', '--link-id': 'linkId', '--fact-ref': 'factRef', '--doc-id': 'docId', '--fields-json': 'fieldsJson', '--preview-token': 'previewToken' };
    if (!['migration-status', 'list', 'preview', 'apply'].includes(result.action)) throw new Error(KNOWLEDGE_USAGE);
    const seen = new Set();
    for (let i = 1; i < rest.length; i += 2) {
      if (!flags[rest[i]] || seen.has(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Invalid or repeated link option.');
      seen.add(rest[i]); result[flags[rest[i]]] = rest[i + 1];
    }
    if (result.action !== 'migration-status' && !result.scopeKey) throw new Error('Explicit --scope-key required.');
    return result;
  }
  if (!["targets", "list", "read", "hierarchy", "chunk", "links", "graph", "search", "search-status"].includes(action)) throw new Error(KNOWLEDGE_USAGE);
  const flags = { "--scope-key": "scopeKey", "--search-mode":"searchMode", "--result-mode":"resultMode", "--policy-expansion":"policyExpansion", "--node-type":"nodeType", "--relation-type":"relationType", "--doc-id":"docId", "--query": "query", "--source-type": "sourceType", "--offset": "offset", "--limit": "limit",
    "--raw-offset": "rawOffset", "--start-line": "startLine", "--level": "level", "--parent-id": "parentId", "--chunk-id": "chunkId", "--text-offset": "textOffset" };
  const result = { action }, seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (seen.has(flag)) throw new Error("Duplicate knowledge option.");
    if (flag === "--include-global") { result.includeGlobal = true; seen.add(flag); }
    else if (flags[flag]) {
      if (!rest[i + 1] || rest[i + 1].startsWith("--")) throw new Error(`Value required for ${flag}.`);
      result[flags[flag]] = rest[++i]; if(flag==="--policy-expansion"){if(!["true","false"].includes(result.policyExpansion))throw new Error("policy-expansion must be true|false.");result.policyExpansion=result.policyExpansion==="true";} seen.add(flag);
    } else if (!flag.startsWith("-") && !result.docId && ["read", "hierarchy", "chunk", "links", "graph", "search", "search-status"].includes(action)) result.docId = flag;
    else throw new Error("Unknown knowledge option or extra argument.");
  }
  if (action === "targets" && rest.length) throw new Error("targets takes no options.");
  if (action !== "targets" && !result.scopeKey) throw new Error("Explicit --scope-key required.");
  return result;
}
export async function handleKnowledgeCommand(args) {
  try {
    let input;
    try { input = parseKnowledgeCommand(args); }
    catch (error) { throw Object.assign(error, { code: "INVALID" }); }
    if (input.action === "help") console.log(KNOWLEDGE_USAGE);
    else console.log(JSON.stringify(input.removalCommand ? await knowledgeRemovalRequest(input) : input.contentCommand ? await knowledgeContentRequest(input) : input.linkCommand ? await knowledgeLinksRequest(input) : input.action === "targets" ? await listKnowledgeTargets() : await inspectKnowledge(input), null, 2));
  } catch (error) {
    const known = ["INVALID", "NOT_FOUND", "CONFLICT", "CONFIRMATION", "UNSUPPORTED", "BUSY", "MIGRATION_REQUIRED", "RECOVERY_REQUIRED"].includes(error.code);
    console.error(`${known ? error.code : "STORAGE_UNAVAILABLE"}: ${known ? error.message : "Local knowledge storage is unavailable."}`);
    process.exitCode = 1;
  } finally { closeDatabase(); }
}
