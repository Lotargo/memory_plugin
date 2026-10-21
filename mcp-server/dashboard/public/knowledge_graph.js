import { formatText, setAttr, setText, t } from './i18n.js';
export function createKnowledgeGraph({api,scopeKey,node,notice,openDocument,openChunk,openFact,editLink}) {
  const $=id=>document.getElementById(id),dialog=$('graphDialog');let sequence=0,offset=0,opener=null;
  const query=input=>new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined&&v!==null&&v!=='')).toString();
  const close=()=>{sequence++;dialog.close();if(opener?.isConnected)opener.focus();};
  const navigate=async target=>{if(!target)return;close();if(target.kind==='fact')await openFact(target.scopeKey,target.factRef);else if(target.kind==='chunk'){await openDocument(target.docId);await openChunk(target.level,target.chunkId);}else await openDocument(target.docId,target.startLine);};
  function action(label,run){const button=node('button',label,'button ghost');button.type='button';button.addEventListener('click',run);return button;}
  function draw(result){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),shown=result.nodes.slice(0,36),positions=new Map();
    const height=Math.max(100,Math.ceil(shown.length/3)*74);svg.setAttribute('viewBox',formatText`0 0 900 ${height}`);svg.setAttribute('role','img');setAttr(svg, 'aria-label', t('m363'));
    for(let i=0;i<shown.length;i++)positions.set(shown[i].id,{x:(30 + (i%3)*295),y:(20 + Math.floor(i/3)*74)});
    for(const edge of result.edges){const a=positions.get(edge.sourceId),b=positions.get(edge.targetId);if(!a||!b)continue;const line=document.createElementNS(ns,'line');for(const [key,value] of Object.entries({x1:(a.x + 120),y1:(a.y + 20),x2:(b.x + 120),y2:(b.y + 20)}))line.setAttribute(key,value);line.setAttribute('class','graph-edge');svg.append(line);}
    for(const item of shown){const p=positions.get(item.id),g=document.createElementNS(ns,'g'),rect=document.createElementNS(ns,'rect'),text=document.createElementNS(ns,'text'),title=document.createElementNS(ns,'title');
      rect.setAttribute('x',p.x);rect.setAttribute('y',p.y);rect.setAttribute('width','240');rect.setAttribute('height','44');rect.setAttribute('rx','8');rect.setAttribute('class','graph-node');text.setAttribute('x',(p.x + 12));text.setAttribute('y',(p.y + 27));setText(text, formatText`${item.type} · ${item.label.slice(0,21)}${item.label.length>21?'…':''}`);setText(title, formatText`${item.type}: ${item.label} (${item.state})`);g.append(title,rect,text);svg.append(g);}
    $('graphVisual').replaceChildren(svg);setText($('graphVisualHint'), t('m364', shown.length, result.nodes.length));
  }
  async function load(next=0){offset=next;const current=++sequence;$('graphError').hidden=true;setText($('graphState'), t('m365'));$('graphResults').setAttribute('aria-busy','true');
    try{const result=await api(formatText`/api/knowledge?${query({action:'graph',scopeKey:scopeKey(),includeGlobal:$('knowledgeGlobal').checked,docId:$('graphDocument').value,relationType:$('graphRelation').value.trim(),nodeType:$('graphNodeType').value,offset,limit:40})}`);if(current!==sequence||!dialog.open)return;
      setText($('graphState'), t('m366', result.edges.length, result.visibleCandidateCount, result.complete?t('m367'):t('m368'), result.scanTruncated?t('m369'):''));
      draw(result);const nodes=new Map(result.nodes.map(item=>[item.id,item]));$('graphEdges').replaceChildren();
      for(const edge of result.edges){const li=node('li'),a=nodes.get(edge.sourceId),b=nodes.get(edge.targetId);li.append(node('p',formatText`${a.type}: ${a.label} → ${edge.relationType} → ${b.type}: ${b.label}`),node('p',formatText`${edge.provenance} · ${a.state} / ${b.state}`,'caption'));
        if(a.target)li.append(action(t('m370'),()=>navigate(a.target)));if(b.target)li.append(action(t('m371'),()=>navigate(b.target)));
        for(const link of edge.links){li.append(node('p',formatText`${link.linkId} · ${link.status}`,'caption'));if(link.editable){li.append(action(t('m372'),()=>{close();editLink({linkId:link.linkId,operation:'update'});}),action(t('m373'),()=>{close();editLink({linkId:link.linkId,operation:'delete'});}));}}
        $('graphEdges').append(li);
      }
      $('graphPrev').disabled=offset===0;$('graphNext').disabled=result.nextOffset===null;$('graphNext').dataset.offset=result.nextOffset??'';
    }catch(e){if(current===sequence){$('graphError').hidden=false;setText($('graphError'), t('m374'));$('graphEdges').replaceChildren();$('graphVisual').replaceChildren();setText($('graphState'), t('m375'));}}
    finally{if(current===sequence)$('graphResults').setAttribute('aria-busy','false');}
  }
  $('graphClose').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('graphForm').addEventListener('submit',event=>{event.preventDefault();load();});$('graphPrev').addEventListener('click',()=>load(Math.max(0,offset-40)));$('graphNext').addEventListener('click',()=>load(Number($('graphNext').dataset.offset)));
  return {async open(docId){opener=document.activeElement;dialog.showModal();$('graphClose').focus();$('graphRelation').value='';$('graphNodeType').value='all';setText($('graphContext'), t('m376', scopeKey(), $('knowledgeGlobal').checked&&scopeKey()!=='global'?' + global':''));
    const current=++sequence;try{const list=await api(formatText`/api/knowledge?${query({action:'list',scopeKey:scopeKey(),includeGlobal:$('knowledgeGlobal').checked,limit:100})}`);if(current!==sequence)return;
      if(docId&&!list.items.some(item=>item.docId===docId))list.items.unshift(await api(formatText`/api/knowledge?${query({action:'read',scopeKey:scopeKey(),includeGlobal:$('knowledgeGlobal').checked,docId,textLimit:1})}`));
      $('graphDocument').replaceChildren(node('option',t('m377')));$('graphDocument').firstChild.value='';for(const item of list.items){const option=node('option',item.title||item.docId);option.value=item.docId;$('graphDocument').append(option);}
      $('graphDocument').value=docId||'';await load();
    }catch{notice(t('m378'),true);close();}},async refresh(){if(dialog.open)await load(offset);}};
}
