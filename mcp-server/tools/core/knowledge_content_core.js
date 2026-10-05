import { manageKnowledgeContent } from '../../services/knowledge_content_service.js';
export const KNOWLEDGE_CONTENT_DESCRIPTION = 'Create/update Notes, ingest/refresh sources or edit metadata in an explicit owning scope. read returns full saved editor text and expectedVersion. start prepares asynchronously; prepare waits; status reports real phases. Choose indexMode lexical or dense explicitly in fieldsJson. Preparation does not publish. apply requires operationId and exact previewToken; shared documents require confirmShared after review of all-scope effects. cancel is allowed only before publication. Legacy remember_note still creates a new Note.';
export const KNOWLEDGE_CONTENT_FIELDS = {
  action: { type: 'string', enum: ['read','start','prepare','status','apply','cancel'] },
  scopeKey: { type: 'string', description: 'Exact existing owning scope key; no implicit global edit from another project.' },
  operation: { type: 'string', enum: ['create-note','update-note','ingest-source','refresh-source','metadata'] },
  docId: { type: 'string' }, expectedVersion: { type: 'string', description: 'Version returned by read; required for existing documents.' },
  fieldsJson: { type: 'string', description: 'JSON: title, content for Note/text, kind for Note, tags array, explicit indexMode lexical|dense; ingest-source also sourceType text|file|url and path for file/url.' },
  operationId: { type: 'string' }, previewToken: { type: 'string' }, confirmShared: { type: 'boolean' },
};
export async function knowledgeContentRequest(input) {
  let fields = input.fields;
  if (input.fieldsJson !== undefined) { try { fields = JSON.parse(input.fieldsJson); } catch { throw Object.assign(new Error('fieldsJson must contain a JSON object.'), { code: 'INVALID' }); } }
  return manageKnowledgeContent({ ...input, fields });
}
export async function knowledgeContentTool(input) {
  try { return { content: [{ type: 'text', text: JSON.stringify(await knowledgeContentRequest(input), null, 2) }] }; }
  catch (error) { const known = ['INVALID','UNSUPPORTED','NOT_FOUND','CONFLICT','CONFIRMATION','BUSY','RECOVERY_REQUIRED','MIGRATION_REQUIRED'].includes(error.code);
    return { isError: true, content: [{ type: 'text', text: `${known ? error.code : 'STORAGE_UNAVAILABLE'}: ${known ? error.message : 'Local content operation failed.'}` }] }; }
}
