import { manageKnowledgeRemoval } from '../../services/knowledge_removal_service.js';
export const KNOWLEDGE_REMOVAL_DESCRIPTION = 'Preview and apply unlink-scope or full document deletion using explicit owning scopeKey/docId. Preview lists own link effects and private counts, exact index cleanup and historical snapshot boundary. Apply requires fresh previewToken and confirm=true; shared full deletion also requires confirmShared=true. Notebook facts remain. cleanup retries committed local blob cleanup.';
export const KNOWLEDGE_REMOVAL_FIELDS = {
  action:{type:'string',enum:['preview','apply','cleanup']}, scopeKey:{type:'string'},
  operation:{type:'string',enum:['unlink-scope','delete']},docId:{type:'string'},previewToken:{type:'string'},
  confirm:{type:'boolean'},confirmShared:{type:'boolean'},
};
export const knowledgeRemovalRequest = input => manageKnowledgeRemoval(input);
export async function knowledgeRemovalTool(input) {
  try { return {content:[{type:'text',text:JSON.stringify(await knowledgeRemovalRequest(input),null,2)}]}; }
  catch(error) { const known=['INVALID','NOT_FOUND','CONFLICT','CONFIRMATION','UNSUPPORTED','MIGRATION_REQUIRED','RECOVERY_REQUIRED','BUSY'].includes(error.code);
    return {isError:true,content:[{type:'text',text:`${known?error.code:'STORAGE_UNAVAILABLE'}: ${known?error.message:'Local removal failed.'}`}]}; }
}
