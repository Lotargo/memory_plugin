import assert from 'node:assert/strict';
import {createResourceView} from '../../mcp-server/dashboard/public/resources.js';

// Observable polling policy without real waiting or a browser-specific framework.
const elements = new Map(), listeners = new Map(), timers = new Map();
function node(tag, text = '') {return {tag, textContent: text, children: [], append(...children) {this.children.push(...children);}, replaceChildren(...children) {this.children = children;}};}
const oldDocument = globalThis.document, oldSetTimeout = globalThis.setTimeout, oldClearTimeout = globalThis.clearTimeout;
globalThis.document = {hidden: false, getElementById(id) {if (!elements.has(id)) elements.set(id, node('div')); return elements.get(id);}, addEventListener(type, callback) {listeners.set(type, callback);}};
let nextId = 0;
globalThis.setTimeout = (callback, delay) => {assert.equal(delay, 3000); timers.set(++nextId, callback); return nextId;};
globalThis.clearTimeout = id => timers.delete(id);
const flush = () => new Promise(resolve => setImmediate(resolve));
const data = {platform: {name: 'macOS', arch: 'arm64'}, ram: {totalBytes: 1024 ** 3, usedBytes: 512 * 1024 ** 2, freeBytes: 512 * 1024 ** 2, availableBytes: null, usedBasis: 'total-minus-free', swap: {usedBytes: null}},
  gpu: {devices: [{name: 'Apple M4', memoryKind: 'unified', source: 'system_profiler'}]}, processes: [{pid: 1, role: 'dashboard', rssBytes: 1024 ** 2, status: 'fresh'}], observedAt: Date.now()};
let calls = 0, rejectNext = false, deferred;
try {
  const view = createResourceView({node, api: async endpoint => {
    assert.equal(endpoint, '/api/resources'); calls++;
    if (rejectNext) {rejectNext = false; throw new Error('offline');}
    if (deferred) await deferred.promise;
    return data;
  }});
  view.start(); await flush();
  assert.equal(calls, 1); assert.equal(timers.size, 1);
  const ram = elements.get('resourcesRam').children;
  assert.ok(ram.some(element => element.textContent === 'Недоступно'), 'unknown memory remains explicitly unavailable');
  const gpuText = JSON.stringify(elements.get('resourcesGpu'));
  assert.ok(gpuText.includes('Unified Memory')); assert.ok(gpuText.includes('отдельный объём VRAM не применяется'));
  const [id, callback] = [...timers][0]; timers.delete(id); callback(); await flush();
  assert.equal(calls, 2);
  document.hidden = true; listeners.get('visibilitychange')(); assert.equal(timers.size, 0);
  await view.refresh(); assert.equal(calls, 2, 'hidden tabs do not request measurements');
  document.hidden = false; listeners.get('visibilitychange')(); await flush(); assert.equal(calls, 3);
  view.stop(); assert.equal(timers.size, 0);
  await view.refresh(); assert.equal(calls, 3, 'closed dialogs do not request measurements');
  rejectNext = true; view.start(); await flush();
  assert.ok(elements.get('resourcesState').textContent.includes('могли устареть'));
  assert.equal(timers.size, 1, 'errors retain a bounded retry');
  let finish; deferred = {promise: new Promise(resolve => {finish = resolve;})};
  view.refresh(); await flush(); const inFlightCalls = calls;
  await view.refresh(); assert.equal(calls, inFlightCalls, 'native requests never overlap');
  view.stop(); const statusBefore = elements.get('resourcesState').textContent;
  finish(); await flush();
  assert.equal(elements.get('resourcesState').textContent, statusBefore, 'late results cannot update a closed dialog');
  assert.equal(timers.size, 0);
  console.log('Resource UI: explicit unknown/unified memory, visible-only polling, close/reopen, failures and late-response isolation passed.');
} finally {globalThis.document = oldDocument; globalThis.setTimeout = oldSetTimeout; globalThis.clearTimeout = oldClearTimeout;}
