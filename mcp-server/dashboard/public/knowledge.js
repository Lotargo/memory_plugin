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
  const text = (id, value) => { $(id).textContent = value; };
  const params = input => new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined && value !== null)).toString();
  const request = input => api(`/api/knowledge?${params({ scopeKey: scopeKey(), includeGlobal: $('knowledgeGlobal').checked, ...input })}`);
  const failure = error => notice(error.code === 'NOT_FOUND' ? 'Источник или чанк недоступен в выбранной области.'
    : error.code === 'BUSY' ? 'Хранилище занято. Повторите чтение через несколько секунд.'
    : error.code === 'CONFLICT' ? 'Источник изменился. Откройте его заново, чтобы прочитать текущую ревизию.'
    : 'Не удалось прочитать знания. Проверьте локальное хранилище и повторите действие.', true);
  function button(label, run, className = 'button secondary') {
    const element = node('button', label, className); element.type = 'button'; element.addEventListener('click', run); return element;
  }
  function resetDocument() {
    currentDocument = null; chunk = null; documentSequence++; hierarchySequence++; chunkSequence++;
    $('knowledgeReader').hidden = true; $('knowledgeEmpty').hidden = false; $('knowledgeChunk').hidden = true;
    $('knowledgeRawNext').hidden = true; $('knowledgeRaw').textContent = '';
    renderContent($('knowledgeRendered'), ''); renderContent($('knowledgeChunkRendered'), '');
  }
  async function loadList(nextOffset = 0) {
    offset = nextOffset;
    const sequence = ++listSequence;
    $('knowledgeDocuments').replaceChildren();
    $('knowledgeDocuments').setAttribute('aria-busy', 'true'); text('knowledgeListState', 'Читаем сохранённые источники…');
    $('knowledgePrev').disabled = true; $('knowledgeNext').disabled = true;
    try {
      const result = await request({ action: 'list', query: $('knowledgeSearch').value, sourceType: $('knowledgeType').value, offset });
      if (sequence !== listSequence || !active) return;
      $('knowledgeDocuments').replaceChildren();
      text('knowledgeListState', result.total ? `${offset + 1}–${offset + result.items.length} из ${result.total}` : 'В выбранной области источников не найдено.');
      for (const doc of result.items) {
        const item = node('li');
        const row = button('', () => openDocument(doc.docId), 'record-row');
        row.append(node('span', doc.source_type === 'note' ? `Note · ${doc.note_kind}` : `Источник · ${doc.source_type}`, 'row-top'),
          node('span', doc.title || doc.docId, 'row-title'), node('span', doc.tags.join(', ') || doc.path, 'row-summary'));
        item.append(row); $('knowledgeDocuments').append(item);
      }
      $('knowledgePrev').disabled = offset === 0; $('knowledgeNext').disabled = result.nextOffset === null;
      $('knowledgeNext').dataset.offset = result.nextOffset ?? '';
    } catch (error) { if (sequence === listSequence && active) { text('knowledgeListState', 'Данные недоступны. Повторите поиск.'); failure(error); } }
    finally { if (sequence === listSequence) $('knowledgeDocuments').setAttribute('aria-busy', 'false'); }
  }
  async function openDocument(docId, startLine) {
    resetDocument();
    const sequence = ++documentSequence;
    $('knowledgeEmpty').hidden = true; $('knowledgeReader').hidden = false; $('knowledgeReader').setAttribute('aria-busy', 'true');
    text('knowledgeTitle', 'Читаем источник…'); $('knowledgeProperties').replaceChildren(); $('knowledgeHierarchy').replaceChildren(); $('knowledgeLinks').replaceChildren();
    try {
      const doc = await request({ action: 'read', docId, startLine });
      if (sequence !== documentSequence || !active) return;
      currentDocument = doc;
      text('knowledgeTitle', doc.title || doc.docId);
      const properties = [['ID', doc.docId], ['Происхождение', doc.source_type], ['Вид Note', doc.note_kind || '—'], ['Путь источника', doc.path],
        ['Теги', doc.tags.join(', ') || '—'], ['Видимые области', doc.visibleScopes.join(', ')], ['Общий документ', doc.shared ? `Да · других областей: ${doc.otherScopeCount}` : 'Нет'],
        ['Создан', new Date(doc.created_at).toLocaleString('ru')], ['Изменён', new Date(doc.updated_at).toLocaleString('ru')], ['Ревизия чтения', doc.version],
        ['Индекс', `${doc.index.state} · ${doc.index.vectorCount}/${doc.index.microCount} micro-чанков с вектором · модель ${doc.index.model}`]];
      const owned=doc.visibleScopes.includes(scopeKey());
      $('knowledgeEditNote').hidden=doc.source_type!=='note';$('knowledgeRefresh').hidden=doc.source_type==='note';
      for(const id of ['knowledgeEditNote','knowledgeRefresh','knowledgeMetadata','knowledgeUnlink','knowledgeDelete'])$(id).disabled=!owned;
      $('knowledgeOwnershipHint').textContent=owned?'': 'Для изменения выберите область, которая владеет документом.';
      if (doc.metadataTruncated) properties.push(['Ограничение', 'Длинные метаданные показаны частично.']);
      for (const [label, value] of properties) $('knowledgeProperties').append(node('dt', label), node('dd', value, 'identifier'));
      showRaw(doc.raw, false);
      text('knowledgePositionHint', startLine ? `Открыта запрошенная строка ${startLine}. Актуальность legacy-связи требует проверки.` : 'Нормализованный сохранённый текст. Нумерация строк с 1; CRLF и CR приводятся к LF.');
      parentId = null; hierarchyOffset = 0; $('knowledgeLevel').value = 'section';
      await Promise.all([loadHierarchy(), loadLinks()]);
      if (sequence === documentSequence && active) $('knowledgeTitle').focus();
    } catch (error) { if (sequence === documentSequence && active) { text('knowledgeTitle', 'Источник недоступен'); failure(error); } }
    finally { if (sequence === documentSequence) $('knowledgeReader').setAttribute('aria-busy', 'false'); }
  }
  function showRaw(raw, append) {
    if (append) $('knowledgeRaw').append(globalThis.document.createTextNode(raw.text)); else text('knowledgeRaw', raw.text);
    renderContent($('knowledgeRendered'), $('knowledgeRaw').textContent, { headingLevel: 4 });
    text('knowledgeRawState', raw.state === 'available' ? `Строки ${raw.lineStart}–${raw.lineEnd} из ${raw.totalLines}${raw.truncated ? ' · показан фрагмент' : ''}`
      : ({ missing: 'Сохранённый blob отсутствует.', corrupt: 'Сохранённый blob повреждён.', too_large: 'Текст превышает лимит просмотра 16 МиБ.' }[raw.state] || 'Текст недоступен.'));
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
      text('knowledgeHierarchyState', `${result.total} ${level} · ${parentId ? `родитель ${parentId}` : 'весь документ'} · порядок по ID; координаты исходника UNKNOWN`);
      $('knowledgeHierarchy').replaceChildren();
      for (const item of result.items) {
        const row = node('li'), inspect = button(item.heading || item.id, () => openChunk(level, item.id));
        row.append(inspect, node('span', ` ${item.token_count} токенов · родитель ${item.medium_id || item.section_id || item.doc_id} · ${item.parentState}`, 'caption'));
        if (level !== 'micro' && item.parentState === 'available') row.append(button(level === 'section' ? 'Medium-чанки' : 'Micro-чанки', () => {
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
      text('knowledgeChunkTitle', `${level} · ${result.id}`);
      text('knowledgeChunkInfo', `section: ${result.section_id || '—'} · medium: ${result.medium_id || '—'} · ${result.block_type || result.retrieval_policy || 'section'} · policy_source: ${result.policy_source_id || '—'}\n${result.breadcrumbs || ''}\n${result.vector ? `Вектор: ${result.vector.present ? `${result.vector.bytes} байт, ${result.vector.dimension ?? 'UNKNOWN'} измерений` : 'отсутствует'}; модель ${result.vector.model} (${result.vector.provenance})` : ''}\nКоординаты в raw: UNKNOWN (${result.coordinates.reason})`);
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
      if (!result.total) $('knowledgeLinks').append(node('li', 'Связанных фактов в этом контексте нет.', 'caption'));
      for (const link of result.items) {
        const item = node('li');
        item.append(link.factRef ? button(link.factTitle || link.factText, () => openFact(link.factKey, link.factRef)) : node('span', link.factText));
        item.append(node('p', `${link.relationType} · ${link.status} · ${link.reason}${link.requestedLines.start ? ` · ${link.coordinatesConfirmed ? 'подтверждены' : 'запрошены'} строки ${link.requestedLines.start}–${link.requestedLines.end || link.requestedLines.start}` : ''}`, 'caption'));
        if (link.factKey === scopeKey()) {
          item.append(button('Изменить связь', () => editLink({ operation: 'update', linkId: link.linkId })),
            button('Удалить связь', () => editLink({ operation: 'delete', linkId: link.linkId })));
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
