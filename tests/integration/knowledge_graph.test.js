import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fs.mkdtempSync(join(tmpdir(),'knowledge-graph-'));
process.env.MEMORY_DIR=join(root,'memory');process.env.OPENCODE_CONFIG_DIR=join(root,'opencode');process.env.MEMORY_DISABLE_PERSONA_SYNC='1';process.env.MEMORY_DISABLE_BACKGROUND_SYNC='1';
const {createKnowledgeFixture}=await import('../fixtures/knowledge_fixture.js');
const {closeDatabase}=await import('../../mcp-server/db/database.js');
const {inspectKnowledge}=await import('../../mcp-server/services/knowledge_service.js');
const {migrateKnowledge,manageKnowledgeLinks}=await import('../../mcp-server/services/knowledge_links_service.js');
const {ingestDocument}=await import('../../mcp-server/ingest/pipeline.js');
const {factNode}=await import('../../mcp-server/storage/knowledge_schema.js');
const nativeFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Offline graph');};
try {
  const f=await createKnowledgeFixture(),sql=f.db.localDb;await migrateKnowledge();
  const graph=input=>inspectKnowledge({action:'graph',scopeKey:f.a,...input});
  const initial=await graph({docId:f.shared});assert.ok(initial.edges.length);assert.equal(initial.complete,true);
  assert.ok(!JSON.stringify(initial).includes('link-b'));assert.ok(!JSON.stringify(initial).includes(f.b));
  assert.ok(initial.nodes.some(node=>node.type==='fact'&&node.target.scopeKey===f.a));
  const structural=initial.edges.find(edge=>edge.relationType==='CONTAINS');assert.equal(structural.editable,false);assert.equal(structural.provenance,'structure-origin-unrecorded');
  const manual=initial.edges.find(edge=>edge.links.some(link=>link.linkId==='link-a'));assert.equal(manual.provenance,'manual-link');assert.equal(manual.editable,true);
  const foreignMicro=sql.prepare('SELECT id FROM micro_chunks WHERE doc_id=?').get(f.privateB).id;
  sql.prepare('INSERT INTO graph_edges(source_id,target_id,relation_type) VALUES(?,?,?)').run(f.shared,foreignMicro,'SPOOF');
  sql.prepare('INSERT INTO graph_edges(source_id,target_id,relation_type,metadata_json) VALUES(?,?,?,?)').run(f.shared,'symbol:SafeName','SPOOF',JSON.stringify({knowledgeProjection:true,linkIds:['link-b']}));
  sql.prepare('INSERT INTO graph_edges(source_id,target_id,relation_type) VALUES(?,?,?)').run(f.shared,factNode(f.b,'same'),'SPOOF');
  const scoped=await graph({docId:f.shared});assert.ok(!JSON.stringify(scoped).includes(foreignMicro));assert.ok(!JSON.stringify(scoped).includes('link-b'));assert.ok(!JSON.stringify(scoped).includes(f.b));
  assert.equal(scoped.edges.find(edge=>edge.targetId==='symbol:SafeName').editable,false);
  await assert.rejects(graph({docId:f.privateB}),e=>e.code==='NOT_FOUND');
  const onlyFacts=await graph({nodeType:'fact'});assert.ok(onlyFacts.edges.every(edge=>edge.sourceId.startsWith('fact:')||edge.targetId.startsWith('fact:')));
  const contains=await graph({relationType:'CONTAINS'});assert.ok(contains.edges.every(edge=>edge.relationType==='CONTAINS'));
  const page=await graph({limit:1});assert.equal(page.edges.length,1);assert.equal(page.complete,false);assert.equal(page.nextOffset,1);
  const next=await graph({limit:1,offset:page.nextOffset});assert.notEqual(page.edges[0].edgeId,next.edges[0].edgeId);
  const all=await graph({includeGlobal:true});assert.ok(all.nodes.some(node=>node.docId===f.global));
  const remote=await inspectKnowledge({action:'graph',scopeKey:f.ragOnly});assert.ok(remote.nodes.some(node=>node.docId===f.remote));
  // Saved symbol name is explicit nonunique state, never a definition identity.
  const code=await ingestDocument({path:'symbols.js',content:'function DuplicateName() { return 1; }',type:'file',projectScope:f.a,generateEmbeddings:false});
  const symbols=await graph({docId:code.docId,nodeType:'symbol'});assert.ok(symbols.nodes.some(node=>node.type==='symbol'&&node.state==='name-only-nonunique'&&node.target===null));
  // Primary K2 link change is visible after reopening the graph; structural edges survive.
  const update={scopeKey:f.a,operation:'update',linkId:'link-a',fields:{factRef:'id:same',docId:f.shared,sectionId:null,startLine:3,endLine:3,relationType:'DECISION'}};
  const preview=await manageKnowledgeLinks({action:'preview',...update});await manageKnowledgeLinks({action:'apply',...update,previewToken:preview.previewToken});
  const changed=await graph({docId:f.shared});assert.ok(changed.edges.some(edge=>edge.relationType==='DECISION'&&edge.links.some(link=>link.linkId==='link-a')));assert.ok(changed.edges.some(edge=>edge.edgeId===structural.edgeId));
  const del={scopeKey:f.a,operation:'delete',linkId:'link-a'},dp=await manageKnowledgeLinks({action:'preview',...del});await manageKnowledgeLinks({action:'apply',...del,previewToken:dp.previewToken});
  assert.ok(!(await graph({docId:f.shared})).edges.some(edge=>edge.links.some(link=>link.linkId==='link-a')));
  const cli=JSON.parse(execFileSync(process.execPath,['mcp-server/cli_boot.js','knowledge','graph','--scope-key',f.a,'--doc-id',f.shared,'--node-type','document'],{env:process.env,encoding:'utf8'}));assert.equal(cli.docId,f.shared);
  const {inspectKnowledgeTool}=await import('../../mcp-server/tools/core/knowledge_inspect_core.js');assert.equal(JSON.parse((await inspectKnowledgeTool({action:'graph',scopeKey:f.a})).content[0].text).scopeKey,f.a);
  assert.equal(calls,0);console.log('K5 PASS: saved bounded graph, both-endpoint isolation/spoof checks, filters/pagination/global/offline scope, nonunique symbols, manual link update/delete preserving structure, CLI/MCP shared contract and zero network.');
}finally{globalThis.fetch=nativeFetch;closeDatabase();fs.rmSync(root,{recursive:true,force:true,maxRetries:5});}
