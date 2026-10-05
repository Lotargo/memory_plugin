import { manageKnowledgeLinks, migrateKnowledge } from '../../services/knowledge_links_service.js';
export const KNOWLEDGE_LINKS_DESCRIPTION = 'Manage one local Notebook/source link by stable factRef and linkId. list and migration-status are read-only; preview gives a token bound to payload, Notebook and source versions; apply requires that exact token. migrate explicitly creates a full ZIP backup, assigns missing fact IDs and reports ambiguous legacy links as needs_review. Structural graph edges are never edited. No cloud/model calls.';
export const KNOWLEDGE_LINKS_FIELDS = {
  action: { type: 'string', enum: ['migration-status', 'migrate', 'list', 'preview', 'apply'] },
  scopeKey: { type: 'string', description: 'Existing explicit Notebook scope key' },
  operation: { type: 'string', enum: ['create', 'update', 'delete'] },
  factRef: { type: 'string', description: 'Optional id: fact filter for list' },
  docId: { type: 'string', description: 'Optional exact document ID filter for list' },
  linkId: { type: 'string', description: 'Exact owned link ID for update/delete' },
  fieldsJson: { type: 'string', description: 'JSON object for create/update: factRef, docId, optional sectionId, startLine, endLine, relationType. Repeat exactly for apply.' },
  previewToken: { type: 'string', description: 'Exact preview token returned by preview' },
};
export async function knowledgeLinksRequest(input) {
  if (input.action === 'migrate') return migrateKnowledge();
  let fields = input.fields;
  if (input.fieldsJson !== undefined) {
    try { fields = JSON.parse(input.fieldsJson); } catch { throw Object.assign(new Error('fieldsJson must contain a JSON object.'), { code: 'INVALID' }); }
  }
  return manageKnowledgeLinks({ ...input, fields });
}
export async function knowledgeLinksTool(input) {
  try { return { content: [{ type: 'text', text: JSON.stringify(await knowledgeLinksRequest(input), null, 2) }] }; }
  catch (error) {
    const known = ['INVALID', 'NOT_FOUND', 'CONFLICT', 'UNSUPPORTED', 'BUSY', 'MIGRATION_REQUIRED', 'RECOVERY_REQUIRED'].includes(error.code);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: known ? error.code : 'STORAGE_UNAVAILABLE', error: known ? error.message : 'Local knowledge storage is unavailable.' }) }] };
  }
}
