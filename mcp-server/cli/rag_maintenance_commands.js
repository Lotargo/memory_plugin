import fs from 'node:fs';
import { ragMaintenanceRequest, stageRagFile } from '../services/rag_maintenance_service.js';
import { closeDatabase } from '../db/database.js';
export const RAG_MAINTENANCE_USAGE = `memory-cli rag-maintenance status|export
memory-cli rag-maintenance stage --source-path <file.json[.gz]>
memory-cli rag-maintenance preview --operation import --snapshot-id <id> --mode merge|replace
memory-cli rag-maintenance preview --operation reset
memory-cli rag-maintenance apply --operation import|reset [--snapshot-id <id> --mode merge|replace] --preview-token <token> --confirm
memory-cli rag-maintenance receipt --operation-id <id>
memory-cli rag-maintenance download --snapshot-id <id> --output-path <new-file.json.gz>
All local RAG scopes; Notebook, identities, configuration and snapshot history are preserved. Apply creates a verified pinned full ZIP. Unused blobs remain for separate cleanup.`;
export function parseRagMaintenanceCommand(args) {
  const [action,...rest]=args; if(!action||['help','-h','--help'].includes(action))return {action:'help'};
  const flags={'--operation':'operation','--snapshot-id':'snapshotId','--mode':'mode','--preview-token':'previewToken','--operation-id':'operationId','--source-path':'sourcePath','--output-path':'outputPath'},input={action},seen=new Set();
  for(let i=0;i<rest.length;i++) {
    const flag=rest[i];if(seen.has(flag))throw Object.assign(new Error('Repeated RAG option.'),{code:'INVALID'});seen.add(flag);
    if(flag==='--confirm'){input.confirm=true;continue;}
    if(!flags[flag]||!rest[i+1]||rest[i+1].startsWith('--'))throw Object.assign(new Error('Unknown RAG option or missing value.'),{code:'INVALID'});
    input[flags[flag]]=rest[++i];
  }
  return input;
}
export async function handleRagMaintenanceCommand(args) {
  try {
    const input=parseRagMaintenanceCommand(args);
    if(input.action==='help'){console.log(RAG_MAINTENANCE_USAGE);return;}
    let result;
    if(input.action==='stage' && input.sourcePath && Object.keys(input).length===2)result=await stageRagFile(input.sourcePath);
    else if(input.action==='download' && input.outputPath && input.snapshotId && Object.keys(input).length===3) {
      const {validateSnapshotPath}=await import('../admin/snapshot.js');const output=validateSnapshotPath(input.outputPath,true);
      if(!output.endsWith('.json.gz'))throw Object.assign(new Error('Download uses .json.gz. Choose a new file.'),{code:'INVALID'});
      const data=await ragMaintenanceRequest({action:'download',snapshotId:input.snapshotId});fs.writeFileSync(output,Buffer.from(data.data,'base64'),{flag:'wx'});result={outputPath:output,checksum:data.checksum};
    } else result=await ragMaintenanceRequest(input);
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(`${error.code||'UNAVAILABLE'}: ${['INVALID','CONFLICT','CONFIRMATION','RECOVERY_REQUIRED','MIGRATION_REQUIRED','UNSUPPORTED','NOT_FOUND'].includes(error.code)?error.message:'Local RAG maintenance failed; inspect storage and refresh the preview.'}`);process.exitCode=1;}
  finally{closeDatabase();}
}
