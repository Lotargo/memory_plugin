import { dateText, formatText, joinText, setText, t } from './i18n.js';
import {createKnowledgeSearch} from './knowledge_search.js';
import {createKnowledgeGraph} from './knowledge_graph.js';
import {createKnowledgeRemoval} from './knowledge_removal.js';
import { renderContent, connectContentToggle } from './content.js';
import { createKnowledgeEditor } from './knowledge_editor.js';
export function createKnowledgeBrowser({ api, node, notice, scopeKey, openFact, editLink }) {
  const $ = id => document.getElementById(id);
  const editor = createKnowledgeEditor({api,scopeKey,notice,onSaved:async docId=>{await loadList();await openDocument(docId);}});
  const trial=createKnowledgeSearch({api,scopeKey,node,openDocument,openChunk});
  const graph=createKnowledgeGraph({api,scopeKey,node,notice,openDocument,openChunk,openFact,editLink});
  const removal=createKnowledgeRemoval({api,scopeKey,notice,onSaved:async()=>{resetDocument();await loadList();}});
  connectContentToggle($('knowledgeTextToggle'), $('knowledgeRendered'), $('knowledgeRaw'));
  connectContentToggle($('knowledgeChunkToggle'), $('knowledgeChunkRendered'), $('knowledgeChunkText'));
  let listSequence = 0, documentSequence = 0, hierarchySequence = 0, chunkSequence = 0;
  let offset = 0, currentDocument = null, chunk = null, parentId = null, hierarchyOffset = 0;
  let active = false, loadedKey = null;
  const text = (id, value) => { setText($(id), value); };
  const params = input => new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined && value !== null)).toString();
  const request = input => api(formatText`/api/knowledge?${params({ scopeKey: scopeKey(), includeGlobal: $('knowledgeGlobal').checked, ...input })}`);
  const failure = error => notice(error.code === 'NOT_FOUND' ? t('m273')
    : error.code === 'BUSY' ? t('m274')
    : error.code === 'CONFLICT' ? t('m275')
    : t('m276'), true);
  function button(label, run, className = 'button secondary') {
    const element = node('button', label, className); element.type = 'button'; element.addEventListener('click', run); return element;
  }
  function resetDocument() {
    currentDocument = null; chunk = null; documentSequence++; hierarchySequence++; chunkSequence++;
    $('knowledgeReader').hidden = true; $('knowledgeEmpty').hidden = false; $('knowledgeChunk').hidden = true;
    $('knowledgeRawNext').hidden = true; setText($('knowledgeRaw'), '');
    renderContent($('knowledgeRendered'), ''); renderContent($('knowledgeChunkRendered'), '');
  }
  async function loadList(nextOffset = 0) {
    offset = nextOffset;
    const sequence = ++listSequence;
    $('knowledgeDocuments').replaceChildren();
    $('knowledgeDocuments').setAttribute('aria-busy', 'true'); text('knowledgeListState', t('m277'));
    $('knowledgePrev').disabled = true; $('knowledgeNext').disabled = true;
    try {
      const result = await request({ action: 'list', query: $('knowledgeSearch').value, sourceType: $('knowledgeType').value, offset });
      if (sequence !== listSequence || !active) return;
      $('knowledgeDocuments').replaceChildren();
      text('knowledgeListState', result.total ? t('m278', (offset + 1), (offset + result.items.length), result.total) : t('m279'));
      for (const doc of result.items) {
        const item = node('li');
        const row = button('', () => openDocument(doc.docId), 'record-row');
        row.append(node('span', doc.source_type === 'note' ? formatText`Note · ${doc.note_kind}` : t('m280', doc.source_type), 'row-top'),
          node('span', doc.title || doc.docId, 'row-title'), node('span', joinText(doc.tags, ', ') || doc.path, 'row-summary'));
        item.append(row); $('knowledgeDocuments').append(item);
      }
      $('knowledgePrev').disabled = offset === 0; $('knowledgeNext').disabled = result.nextOffset === null;
      $('knowledgeNext').dataset.offset = result.nextOffset ?? '';
    } catch (error) { if (sequence === listSequence && active) { text('knowledgeListState', t('m281')); failure(error); } }
    finally { if (sequence === listSequence) $('knowledgeDocuments').setAttribute('aria-busy', 'false'); }
  }
  async function openDocument(docId, startLine) {
    resetDocument();
    const sequence = ++documentSequence;
    $('knowledgeEmpty').hidden = true; $('knowledgeReader').hidden = false; $('knowledgeReader').setAttribute('aria-busy', 'true');
    text('knowledgeTitle', t('m282')); $('knowledgeProperties').replaceChildren(); $('knowledgeHierarchy').replaceChildren(); $('knowledgeLinks').replaceChildren();
    try {
      const doc = await request({ action: 'read', docId, startLine });
      if (sequence !== documentSequence || !active) return;
      currentDocument = doc;
      text('knowledgeTitle', doc.title || doc.docId);
      const properties = [['ID', doc.docId], [t('m283'), doc.source_type], [t('m284'), doc.note_kind || '—'], [t('m285'), doc.path],
        [t('m13'), joinText(doc.tags, ', ') || '—'], [t('m286'), joinText(doc.visibleScopes, ', ')], [t('m287'), doc.shared ? t('m288', doc.otherScopeCount) : t('m92')],
        [t('m289'), dateText(new Date(doc.created_at), 'toLocaleString')], [t('m290'), dateText(new Date(doc.updated_at), 'toLocaleString')], [t('m291'), doc.version],
        [t('m292'), t('m293', doc.index.state, doc.index.vectorCount, doc.index.microCount, doc.index.model)]];
      const owned=doc.visibleScopes.includes(scopeKey());
      $('knowledgeEditNote').hidden=doc.source_type!=='note';$('knowledgeRefresh').hidden=doc.source_type==='note';
      for(const id of ['knowledgeEditNote','knowledgeRefresh','knowledgeMetadata','knowledgeUnlink','knowledgeDelete'])$(id).disabled=!owned;
      setText($('knowledgeOwnershipHint'), owned?'': t('m294'));
      if (doc.metadataTruncated) properties.push([t('m295'), t('m296')]);
      for (const [label, value] of properties) $('knowledgeProperties').append(node('dt', label), node('dd', value, 'identifier'));
      showRaw(doc.raw, false);
      text('knowledgePositionHint', startLine ? t('m297', startLine) : t('m298'));
      parentId = null; hierarchyOffset = 0; $('knowledgeLevel').value = 'section';
      await Promise.all([loadHierarchy(), loadLinks()]);
      if (sequence === documentSequence && active) $('knowledgeTitle').focus();
    } catch (error) { if (sequence === documentSequence && active) { text('knowledgeTitle', t('m299')); failure(error); } }
    finally { if (sequence === documentSequence) $('knowledgeReader').setAttribute('aria-busy', 'false'); }
  }
  function showRaw(raw, append) {
    if (append) $('knowledgeRaw').append(globalThis.document.createTextNode(raw.text)); else text('knowledgeRaw', raw.text);
    renderContent($('knowledgeRendered'), $('knowledgeRaw').textContent, { headingLevel: 4 });
    text('knowledgeRawState', raw.state === 'available' ? t('m300', raw.lineStart, raw.lineEnd, raw.totalLines, raw.truncated ? t('m301') : '')
      : ({ missing: t('m302'), corrupt: t('m303'), too_large: t('m304') }[raw.state] || t('m305')));
    $('knowledgeRawNext').hidden = raw.nextOffset == null; $('knowledgeRawNext').dataset.offset = raw.nextOffset ?? '';
  }
  async function moreRaw() {
    if (!currentDocument) return;
    const saved = currentDocument, sequence = documentSequence; $('knowledgeRawNext').disabled = true;
    try {
      const result = await request({ action: 'read', docId: saved.docId, rawOffset: $('knowledgeRawNext').dataset.offset });
      if (sequence !== documentSequence || !active) return;
      if (result.version !== saved.version) throw { code: 'CONFLICT' };
      showRaw(result.raw, true);
    } catch (error) { if (sequence === documentSequence && active) failure(error); }
    finally { $('knowledgeRawNext').disabled = false; }
  }
  async function loadHierarchy(nextOffset = 0) {
    if (!currentDocument) return;
    hierarchyOffset = nextOffset;
    const saved = currentDocument, sequence = ++hierarchySequence, level = $('knowledgeLevel').value;
    $('knowledgeHierarchy').setAttribute('aria-busy', 'true'); $('hierarchyPrev').disabled = true; $('hierarchyNext').disabled = true;
    try {
      const result = await request({ action: 'hierarchy', docId: saved.docId, level, parentId, offset: hierarchyOffset });
      if (sequence !== hierarchySequence || !active) return;
      if (result.version !== saved.version) throw { code: 'CONFLICT' };
      text('knowledgeHierarchyState', t('m306', result.total, level, parentId ? t('m307', parentId) : t('m308')));
      $('knowledgeHierarchy').replaceChildren();
      for (const item of result.items) {
        const row = node('li'), inspect = button(item.heading || item.id, () => openChunk(level, item.id));
        row.append(inspect, node('span', t('m309', item.token_count, item.medium_id || item.section_id || item.doc_id, item.parentState), 'caption'));
        if (level !== 'micro' && item.parentState === 'available') row.append(button(level === 'section' ? t('m310') : t('m311'), () => {
          parentId = item.id; $('knowledgeLevel').value = level === 'section' ? 'medium' : 'micro'; loadHierarchy();
        }, 'button ghost'));
        $('knowledgeHierarchy').append(row);
      }
      $('hierarchyPrev').disabled = hierarchyOffset === 0; $('hierarchyNext').disabled = result.nextOffset == null; $('hierarchyNext').dataset.offset = result.nextOffset ?? '';
    } catch (error) { if (sequence === hierarchySequence && active) failure(error); }
    finally { if (sequence === hierarchySequence) $('knowledgeHierarchy').setAttribute('aria-busy', 'false'); }
  }
  async function openChunk(level, chunkId, textOffset = 0) {
    if (!currentDocument) return;
    const saved = currentDocument, sequence = ++chunkSequence;
    $('knowledgeChunk').hidden = false; $('knowledgeChunk').setAttribute('aria-busy', 'true');
    try {
      const result = await request({ action: 'chunk', docId: saved.docId, level, chunkId, textOffset });
      if (sequence !== chunkSequence || !active) return;
      if (result.version !== saved.version) throw { code: 'CONFLICT' };
      chunk = result;
      text('knowledgeChunkTitle', formatText`${level} · ${result.id}`);
      text('knowledgeChunkInfo', t('m312', result.section_id || '—', result.medium_id || '—', result.block_type || result.retrieval_policy || 'section', result.policy_source_id || '—', result.breadcrumbs || '', result.vector ? t('m313', result.vector.present ? t('m314', result.vector.bytes, result.vector.dimension ?? 'UNKNOWN') : t('m178'), result.vector.model, result.vector.provenance) : '', result.coordinates.reason));
      if (textOffset) $('knowledgeChunkText').append(globalThis.document.createTextNode(result.text)); else text('knowledgeChunkText', result.text);
      renderContent($('knowledgeChunkRendered'), $('knowledgeChunkText').textContent, { headingLevel: 4 });
      $('knowledgeChunkNext').hidden = result.nextTextOffset == null;
      if (!textOffset) $('knowledgeChunkTitle').focus();
    } catch (error) { if (sequence === chunkSequence && active) failure(error); }
    finally { if (sequence === chunkSequence) $('knowledgeChunk').setAttribute('aria-busy', 'false'); }
  }
  async function loadLinks(nextOffset = 0) {
    if (!currentDocument) return;
    const saved = currentDocument, sequence = documentSequence;
    try {
      const result = await request({ action: 'links', docId: saved.docId, offset: nextOffset });
      if (sequence !== documentSequence || !active) return;
      if (!nextOffset) $('knowledgeLinks').replaceChildren();
      if (!result.total) $('knowledgeLinks').append(node('li', t('m315'), 'caption'));
      for (const link of result.items) {
        const item = node('li');
        item.append(link.factRef ? button(link.factTitle || link.factText, () => openFact(link.factKey, link.factRef)) : node('span', link.factText));
        item.append(node('p', formatText`${link.relationType} · ${link.status} · ${link.reason}${link.requestedLines.start ? t('m316', link.coordinatesConfirmed ? t('m317') : t('m318'), link.requestedLines.start, link.requestedLines.end || link.requestedLines.start) : ''}`, 'caption'));
        if (link.factKey === scopeKey()) {
          item.append(button(t('m75'), () => editLink({ operation: 'update', linkId: link.linkId })),
            button(t('m76'), () => editLink({ operation: 'delete', linkId: link.linkId })));
        }
        $('knowledgeLinks').append(item);
      }
      $('knowledgeLinksNext').hidden = result.nextOffset == null; $('knowledgeLinksNext').dataset.offset = result.nextOffset ?? '';
    } catch (error) { if (sequence === documentSequence && active) failure(error); }
  }
  $('knowledgeSearchForm').addEventListener('submit', event => { event.preventDefault(); loadList(); });
  $('knowledgeCreateNote').addEventListener('click',()=>editor.open({operation:'create-note'}));
  $('knowledgeAddSource').addEventListener('click',()=>editor.open({operation:'ingest-source'}));
  $('knowledgeEditNote').addEventListener('click',()=>{if(currentDocument)editor.open({operation:'update-note',docId:currentDocument.docId});});
  $('knowledgeRefresh').addEventListener('click',()=>{if(currentDocument)editor.open({operation:'refresh-source',docId:currentDocument.docId});});
  $('knowledgeMetadata').addEventListener('click',()=>{if(currentDocument)editor.open({operation:'metadata',docId:currentDocument.docId});});
  $('knowledgeUnlink').addEventListener('click',()=>{if(currentDocument)removal.open({operation:'unlink-scope',docId:currentDocument.docId});});
  $('knowledgeDelete').addEventListener('click',()=>{if(currentDocument)removal.open({operation:'delete',docId:currentDocument.docId});});
  $('knowledgeTrial').addEventListener('click',()=>trial.open());
  $('knowledgeGraphAll').addEventListener('click',()=>graph.open());
  $('knowledgeGraphDoc').addEventListener('click',()=>{if(currentDocument)graph.open(currentDocument.docId);});
  $('knowledgeType').addEventListener('change', () => loadList());
  $('knowledgeGlobal').addEventListener('change', () => { resetDocument(); loadList(); });
  $('knowledgePrev').addEventListener('click', () => loadList(Math.max(0, offset - 30)));
  $('knowledgeNext').addEventListener('click', () => loadList(Number($('knowledgeNext').dataset.offset)));
  $('knowledgeRawNext').addEventListener('click', moreRaw);
  $('knowledgeLevel').addEventListener('change', () => { parentId = null; loadHierarchy(); });
  $('hierarchyPrev').addEventListener('click', () => loadHierarchy(Math.max(0, hierarchyOffset - 30)));
  $('hierarchyNext').addEventListener('click', () => loadHierarchy(Number($('hierarchyNext').dataset.offset)));
  $('knowledgeChunkNext').addEventListener('click', () => { if (chunk) openChunk(chunk.level, chunk.id, chunk.nextTextOffset); });
  $('knowledgeLinksNext').addEventListener('click', () => loadLinks(Number($('knowledgeLinksNext').dataset.offset)));
  $('documentAddLink').addEventListener('click', () => { if (currentDocument) editLink({ docId: currentDocument.docId }); });
  return {
    async refreshLinks() { if (currentDocument) await loadLinks(); await graph.refresh(); },
    async activate({ reload = false } = {}) {
      active = true;
      if (loadedKey !== scopeKey() || reload) { loadedKey = scopeKey(); resetDocument(); await loadList(); }
    },
    deactivate() { active = false; listSequence++; documentSequence++; hierarchySequence++; chunkSequence++; loadedKey = null; },
    async open(docId, startLine) {
      if (!$('knowledgeGlobal').checked) { $('knowledgeGlobal').checked = true; await loadList(); }
      await openDocument(docId, startLine);
    },
  };
}
