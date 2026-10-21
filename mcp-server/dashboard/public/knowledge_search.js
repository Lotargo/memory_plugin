import { formatText, setText, t } from './i18n.js';
import {renderContent} from './content.js';
export function createKnowledgeSearch({api,scopeKey,node,openDocument,openChunk}) {
  const $=id=>document.getElementById(id),dialog=$('searchDialog');let sequence=0,busy=false,opener=null;
  const query=input=>new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined)).toString();
  const close=()=>{sequence++;dialog.close();if(opener?.isConnected)opener.focus();};
  function button(label,run){const b=node('button',label,'button secondary');b.type='button';b.addEventListener('click',run);return b;}
  $('trialClose').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('trialForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const current=++sequence;busy=true;$('trialRun').disabled=true;$('trialError').hidden=true;$('trialResults').replaceChildren();setText($('trialState'), $('trialMode').value==='dense'?t('m395'):t('m396'));
    try{
      const result=await api(formatText`/api/knowledge?${query({action:'search',scopeKey:scopeKey(),includeGlobal:$('knowledgeGlobal').checked,query:$('trialQuery').value,searchMode:$('trialMode').value,resultMode:$('trialResultMode').value,policyExpansion:$('trialExpansion').checked,limit:5})}`);
      if(current!==sequence||!dialog.open)return;
      setText($('trialState'), t('m397', result.items.length, result.searchMode==='dense'?t('m398', result.model.model, result.model.queryDimension, result.vectorScanLimit||t('m399')):t('m400')));
      for(const hit of result.items){const li=node('li'),heading=node('h3',hit.title||hit.docId);li.append(heading,node('p',formatText`${hit.sourceType}${hit.noteKind?formatText` · ${hit.noteKind}`:''} · ${hit.path}`,'caption'),node('p',t('m401', hit.contentRevision, hit.indexRevision, hit.fragment.level, hit.policy.applied, hit.textTruncated?t('m402'):''),'caption'),node('p',t('m403', hit.scores.score??'UNKNOWN', hit.scoreMeaning, hit.scores.ftsRank??t('m404'), hit.scores.cosine??t('m404')),'caption'));
        if(hit.text!==null){const content=node('div');renderContent(content,hit.text,{headingLevel:4});li.append(content);}
        if(hit.embedding)li.append(node('p',t('m405', hit.embedding.documentProvenance==='UNKNOWN'?'UNKNOWN':formatText`${hit.embedding.documentProvenance.model}, ${hit.embedding.documentProvenance.dimension}`),'caption'));
        li.append(button(t('m406'),async()=>{close();await openDocument(hit.docId);}),button(t('m407'),async()=>{close();await openDocument(hit.docId);await openChunk(hit.fragment.level,hit.fragment.chunkId);}));$('trialResults').append(li);
      }
    }catch(e){if(current===sequence){$('trialError').hidden=false;setText($('trialError'), e.code==='CONFLICT'?t('m408'):e.code==='UNSUPPORTED'?t('m409'):t('m410'));setText($('trialState'), t('m411'));}}
    finally{busy=false;$('trialRun').disabled=false;if(current===sequence&&dialog.open)($('trialResults').querySelector('button')||$('trialQuery')).focus();}
  });
  return {async open(){opener=document.activeElement;dialog.showModal();$('trialQuery').focus();$('trialMode').value='lexical';$('trialResultMode').value='snippet';$('trialExpansion').checked=true;$('trialResults').replaceChildren();$('trialError').hidden=true;setText($('trialState'), t('m412'));
    const current=++sequence;$('trialDense').disabled=true;setText($('trialModel'), t('m413'));try{const status=await api(formatText`/api/knowledge?${query({action:'search-status',scopeKey:scopeKey()})}`);if(current!==sequence)return;$('trialDense').disabled=!status.available;setText($('trialModel'), t('m414', status.model, status.cached, status.loaded?t('m415'):t('m416'), status.available?t('m417'):t('m418')));}catch{if(current===sequence)setText($('trialModel'), t('m419'));}}};
}
