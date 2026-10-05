import { ragMaintenanceRequest, stageRagFile } from '../../services/rag_maintenance_service.js';
import { serviceError } from '../../services/notebook_service.js';
export const RAG_MAINTENANCE_ACTIONS=['rag_status','rag_receipt','export_snapshot','import_snapshot','reset_rag'];
export async function executeRagMaintenanceTool(input) {
  const allowed={rag_status:['action'],rag_receipt:['action','operationId'],export_snapshot:['action','snapshotPath'],import_snapshot:['action','snapshotPath','snapshotId','importMode','previewToken','confirm'],reset_rag:['action','previewToken','confirm']};
  if(!Object.hasOwn(allowed,input.action)||Object.entries(input).some(([key,value])=>value!=null&&!allowed[input.action].includes(key)))throw serviceError('INVALID','RAG maintenance targets all local RAG. Choose only the fields for this action; scoped fields are unsupported.');
  if(input.action==='rag_status')return ragMaintenanceRequest({action:'status'});
  if(input.action==='rag_receipt')return ragMaintenanceRequest({action:'receipt',operationId:input.operationId});
  if(input.action==='export_snapshot') {
    const {exportSnapshot}=await import('../../admin/snapshot.js');const result=await exportSnapshot({outputPath:input.snapshotPath||null});
    return {snapshotId:result.snapshotId,outputPath:result.outputPath,documents:result.snapshot.documents.length};
  }
  const operation=input.action==='reset_rag'?'reset':'import';let snapshotId=input.snapshotId;
  if(operation==='import') {
    if(input.snapshotPath && snapshotId)throw serviceError('INVALID','Choose snapshotPath for staging or snapshotId for an existing input.');
    if(!snapshotId) {
      if(!input.snapshotPath)throw serviceError('INVALID','snapshotPath or staged snapshotId is required.');
      if(input.previewToken)throw serviceError('INVALID','Apply must use the immutable snapshotId returned by preview.');
      snapshotId=(await stageRagFile(input.snapshotPath)).snapshotId;
    }
  }
  const fields={operation,...(operation==='import'?{snapshotId,mode:input.importMode||'merge'}:{})};
  if(!input.previewToken && input.confirm===true)throw serviceError('CONFIRMATION','Obtain and review a fresh preview token first.');
  return ragMaintenanceRequest({action:input.previewToken?'apply':'preview',...fields,...(input.previewToken?{previewToken:input.previewToken,...(input.confirm!==undefined?{confirm:input.confirm}:{})}:{})});
}
