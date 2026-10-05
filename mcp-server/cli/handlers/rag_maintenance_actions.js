import { selectSimpleMenu, promptText, waitForEnter } from '../ui.js';
import { ragMaintenanceRequest, stageRagFile } from '../../services/rag_maintenance_service.js';
const terminal={selectSimpleMenu,promptText,waitForEnter,clear:()=>console.clear(),log:message=>console.log(message)};
export async function handleRagMaintenanceAction(value,ui=terminal) {
  if(!['export_snapshot','import_snapshot','hard_reset'].includes(value))return;
  try {
    if(value==='export_snapshot'){const result=await ragMaintenanceRequest({action:'export'});ui.log(`  [EXPORTED] ${JSON.stringify(result)}`);return;}
    const fields={operation:value==='hard_reset'?'reset':'import'};
    if(value==='import_snapshot') {
      const status=await ragMaintenanceRequest({action:'status'}), choice=await ui.selectSimpleMenu({title:'SELECT RAG INPUT',items:[...status.snapshots.filter(row=>!row.unavailable).map(row=>({label:row.fileName,info:row.id,value:row.id})),{label:'Choose local JSON file',value:'file'},{label:'< Back',value:'back'}]});
      if(choice.action!=='select'||choice.value==='back')return;
      if(choice.value==='file'){const file=await ui.promptText('JSON / JSON.gz file path:');if(!file.trim())return;fields.snapshotId=(await stageRagFile(file.trim())).snapshotId;}
      else fields.snapshotId=choice.value;
      const mode=await ui.selectSimpleMenu({title:'IMPORT MODE',items:[{label:'Merge: replace affected documents completely',value:'merge'},{label:'Replace all local RAG',value:'replace'},{label:'< Back',value:'back'}]});
      if(mode.action!=='select'||mode.value==='back')return;fields.mode=mode.value;
    }
    const preview=await ragMaintenanceRequest({action:'preview',...fields});ui.clear();ui.log(JSON.stringify(preview,null,2));
    if(!preview.changed){ui.log('  [UNCHANGED] No changes.');return;}
    if(!/^(y|yes)$/i.test((await ui.promptText('Confirm the reviewed effects in ALL local RAG scopes? [y/N]:')).trim())){ui.log('  Cancelled.');return;}
    const result=await ragMaintenanceRequest({action:'apply',...fields,previewToken:preview.previewToken,confirm:true});ui.log(`  [${result.status}] ${JSON.stringify(result)}`);
  }catch(error){ui.log(`  [${error.code||'UNAVAILABLE'}] ${error.code?error.message:'RAG maintenance failed; refresh the preview.'}`);}
  finally{await ui.waitForEnter();}
}
