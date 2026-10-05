import {renderContent} from './content.js';
export function createKnowledgeSearch({api,scopeKey,node,openDocument,openChunk}) {
  const $=id=>document.getElementById(id),dialog=$('searchDialog');let sequence=0,busy=false,opener=null;
  const query=input=>new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined)).toString();
  const close=()=>{sequence++;dialog.close();if(opener?.isConnected)opener.focus();};
  function button(label,run){const b=node('button',label,'button secondary');b.type='button';b.addEventListener('click',run);return b;}
  $('trialClose').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('trialForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const current=++sequence;busy=true;$('trialRun').disabled=true;$('trialError').hidden=true;$('trialResults').replaceChildren();$('trialState').textContent=$('trialMode').value==='dense'?'Готовим embedding запроса из локального кэша…':'Ищем по сохранённому текстовому индексу…';
    try{
      const result=await api(`/api/knowledge?${query({action:'search',scopeKey:scopeKey(),includeGlobal:$('knowledgeGlobal').checked,query:$('trialQuery').value,searchMode:$('trialMode').value,resultMode:$('trialResultMode').value,policyExpansion:$('trialExpansion').checked,limit:5})}`);
      if(current!==sequence||!dialog.open)return;
      $('trialState').textContent=`Результатов: ${result.items.length}. ${result.searchMode==='dense'?`Модель: ${result.model.model}; query dimension: ${result.model.queryDimension}; предел vector scan: ${result.vectorScanLimit||'из конфигурации'}.`:'Lexical: embeddings и reranker не запускались.'}`;
      for(const hit of result.items){const li=node('li'),heading=node('h3',hit.title||hit.docId);li.append(heading,node('p',`${hit.sourceType}${hit.noteKind?` · ${hit.noteKind}`:''} · ${hit.path}`,'caption'),node('p',`Ревизия текста: ${hit.contentRevision}; индекс: ${hit.indexRevision}. Фрагмент: ${hit.fragment.level}; ${hit.policy.applied}${hit.textTruncated?' · текст усечён до 20000 символов':''}.`,'caption'),node('p',`Score: ${hit.scores.score??'UNKNOWN'} (${hit.scoreMeaning}); FTS: ${hit.scores.ftsRank??'не предоставлен'}; cosine: ${hit.scores.cosine??'не предоставлен'}; rerank: не запускался.`,'caption'));
        if(hit.text!==null){const content=node('div');renderContent(content,hit.text,{headingLevel:4});li.append(content);}
        if(hit.embedding)li.append(node('p',`Provenance документа: ${hit.embedding.documentProvenance==='UNKNOWN'?'UNKNOWN':`${hit.embedding.documentProvenance.model}, ${hit.embedding.documentProvenance.dimension}`}`,'caption'));
        li.append(button('Открыть источник',async()=>{close();await openDocument(hit.docId);}),button('Открыть возвращённый фрагмент',async()=>{close();await openDocument(hit.docId);await openChunk(hit.fragment.level,hit.fragment.chunkId);}));$('trialResults').append(li);
      }
    }catch(e){if(current===sequence){$('trialError').hidden=false;$('trialError').textContent=e.code==='CONFLICT'?'Источники изменились во время подготовки запроса. Выполните поиск снова.':e.code==='UNSUPPORTED'?'Dense недоступен: проверьте локальную модель через CLI или выберите текстовый поиск.':'Поиск не выполнен. Проверьте хранилище и повторите запрос.';$('trialState').textContent='Поиск не завершён.';}}
    finally{busy=false;$('trialRun').disabled=false;if(current===sequence&&dialog.open)($('trialResults').querySelector('button')||$('trialQuery')).focus();}
  });
  return {async open(){opener=document.activeElement;dialog.showModal();$('trialQuery').focus();$('trialMode').value='lexical';$('trialResultMode').value='snippet';$('trialExpansion').checked=true;$('trialResults').replaceChildren();$('trialError').hidden=true;$('trialState').textContent='Введите запрос. Это предпросмотр retrieval, а не подтверждение использования памяти агентом.';
    const current=++sequence;$('trialDense').disabled=true;$('trialModel').textContent='Проверяем наличие локальной модели…';try{const status=await api(`/api/knowledge?${query({action:'search-status',scopeKey:scopeKey()})}`);if(current!==sequence)return;$('trialDense').disabled=!status.available;$('trialModel').textContent=`${status.model} · кэш: ${status.cached} · ${status.loaded?'загружена':'не загружена'}. ${status.available?'Dense загрузит только локальные файлы по явному запросу.':'Dense недоступен; подготовьте модель через CLI.'}`;}catch{if(current===sequence)$('trialModel').textContent='Состояние модели недоступно. Текстовый поиск остаётся отдельным режимом.';}}};
}
