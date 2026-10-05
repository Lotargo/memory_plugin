import os from 'node:os';
import path from 'node:path';
import {readFile, readdir, realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const MiB = 1024 ** 2;
const number = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const pci = value => String(value || '').toLowerCase().replace(/^00000000:/, '0000:');
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const unavailable = (source, reason = 'unavailable') => ({source, reason});

// No shell, elevation, model imports, background timers, or network access.
async function run(file, args) {
  return (await exec(file, args, {timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8'})).stdout;
}

export function parseNvidiaMemory(text) {
  return String(text).trim().split(/\r?\n/).filter(Boolean).slice(0, 32).map(line => {
    const fields = line.match(/(?:"[^"]*"|[^,])+/g)?.map(value => value.trim().replace(/^"|"$/g, '')) || [];
    if (fields.length !== 6 || !/^GPU-/.test(fields[0])) return null;
    const [id, name, busId, index, used, total] = fields;
    const usedMB = number(used), totalMB = number(total);
    return {id, name, vendor: 'NVIDIA', pciBusId: pci(busId), index: number(index), memoryKind: 'dedicated',
      usedBytes: usedMB === null ? null : usedMB * MiB, totalBytes: totalMB === null ? null : totalMB * MiB,
      sharedUsedBytes: null, source: 'nvidia-smi', reason: usedMB === null || totalMB === null ? 'metric-unavailable' : null};
  }).filter(Boolean);
}

export function parseMeminfo(text) {
  return Object.fromEntries([...String(text).matchAll(/^([A-Za-z_()]+):\s+(\d+)\s+kB\s*$/gm)].map(match => [match[1], Number(match[2]) * 1024]));
}

export function parseMemorySize(text) {
  const match = String(text ?? '').match(/^\s*([\d.]+)\s*(B|K[B]?|M[B]?|G[B]?|T[B]?)\b/i);
  return match && number(match[1]) !== null ? Number(match[1]) * 1024 ** ('BKMGT'.indexOf(match[2][0].toUpperCase())) : null;
}

export function createResourceMonitor(dependencies = {}) {
  const deps = {platform: process.platform, arch: process.arch, release: os.release(), totalmem: os.totalmem,
    freemem: os.freemem, readFile, readdir, realpath, run, now: Date.now, ...dependencies};
  let cached, pending, discovered, discoveryTime = -Infinity;
  const platform = {id: deps.platform, name: ({win32: 'Windows', linux: 'Linux', darwin: 'macOS'})[deps.platform] || deps.platform,
    arch: deps.arch, release: deps.release, environment: deps.platform === 'linux' && /microsoft/i.test(deps.release) ? 'wsl' : 'native'};

  async function safeRead(file) { try { return String(await deps.readFile(file, 'utf8')).trim(); } catch { return null; } }

  async function ram() {
    const total = number(deps.totalmem()), free = number(deps.freemem());
    const result = {totalBytes: total, freeBytes: free, availableBytes: deps.platform === 'win32' ? free : null,
      usedBytes: total !== null && free !== null ? Math.max(0, total - free) : null, usedBasis: 'total-minus-free',
      source: 'node:os', swap: {totalBytes: null, usedBytes: null, source: null}};
    if (deps.platform === 'win32') result.usedBasis = 'total-minus-available';
    if (deps.platform === 'linux') {
      const text = await safeRead('/proc/meminfo');
      if (text !== null) {
        const values = parseMeminfo(text);
        result.totalBytes = values.MemTotal ?? total;
        result.freeBytes = values.MemFree ?? free;
        result.availableBytes = values.MemAvailable ?? null;
        result.usedBasis = result.availableBytes === null ? 'total-minus-free' : 'total-minus-available';
        const remainder = result.availableBytes ?? result.freeBytes;
        result.usedBytes = result.totalBytes !== null && remainder !== null ? Math.max(0, result.totalBytes - remainder) : null;
        result.source = '/proc/meminfo';
        result.swap = {totalBytes: values.SwapTotal ?? null, usedBytes: values.SwapTotal !== undefined && values.SwapFree !== undefined ? Math.max(0, values.SwapTotal - values.SwapFree) : null, source: '/proc/meminfo'};
      }
    } else if (deps.platform === 'darwin') {
      try {
        const text = await deps.run('/usr/sbin/sysctl', ['-n', 'vm.swapusage']);
        result.swap = {totalBytes: parseMemorySize(text.match(/total\s*=\s*([\d.]+[KMGT]?)/i)?.[1]), usedBytes: parseMemorySize(text.match(/used\s*=\s*([\d.]+[KMGT]?)/i)?.[1]), source: 'sysctl:vm.swapusage'};
      } catch { /* Swap is optional; never substitute zero for unavailable. */ }
    }
    return result;
  }

  async function nvidia() {
    const args = ['--query-gpu=uuid,name,pci.bus_id,index,memory.used,memory.total', '--format=csv,noheader,nounits'];
    try { return parseNvidiaMemory(await deps.run('nvidia-smi', args)); }
    catch {
      if (platform.environment === 'wsl') {
        try { return parseNvidiaMemory(await deps.run('/usr/lib/wsl/lib/nvidia-smi', args)); } catch {}
      }
      return [];
    }
  }

  // Slow hardware discovery is cached separately from live memory measurements.
  async function discover() {
    if (discovered && deps.now() - discoveryTime < 60000) return discovered;
    let result;
    if (deps.platform === 'linux') {
      try {
        const cards = (await deps.readdir('/sys/class/drm')).filter(name => /^card\d+$/.test(name)).slice(0, 32);
        const gpus = (await Promise.all(cards.map(async card => {
          const base = `/sys/class/drm/${card}/device`;
          const vendorId = await safeRead(base + '/vendor');
          if (!vendorId) return null;
          const vendor = ({'0x10de': 'NVIDIA', '0x1002': 'AMD', '0x8086': 'Intel'})[vendorId] || vendorId;
          let busId = null;
          try { busId = pci(path.basename(await deps.realpath(base))); } catch {}
          return {id: card, name: `${vendor} GPU (${await safeRead(base + '/device') || card})`, vendor, pciBusId: busId, base,
            memoryKind: 'unknown', usedBytes: null, totalBytes: null, sharedUsedBytes: null,
            source: 'drm-sysfs', reason: 'metric-unavailable'};
        }))).filter(Boolean);
        result = {gpus, source: 'drm-sysfs'};
      } catch { result = {gpus: [], ...unavailable('drm-sysfs', 'discovery-unavailable')}; }
    } else if (deps.platform === 'win32') {
      try {
        const text = await deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; @(Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID) | ConvertTo-Json -Compress']);
        result = {source: 'windows-cim', gpus: array(JSON.parse(text || '[]')).slice(0, 32).map((gpu, index) => ({
          id: gpu.PNPDeviceID || `windows-${index}`, name: gpu.Name || 'GPU', vendor: /VEN_10DE/i.test(gpu.PNPDeviceID) ? 'NVIDIA' : /VEN_1002/i.test(gpu.PNPDeviceID) ? 'AMD' : /VEN_8086/i.test(gpu.PNPDeviceID) ? 'Intel' : 'unknown',
          memoryKind: 'unknown', usedBytes: null, totalBytes: null, sharedUsedBytes: null, source: 'windows-cim', reason: 'metric-unavailable'
        }))};
      } catch { result = {gpus: [], ...unavailable('windows-cim', 'discovery-unavailable')}; }
    } else if (deps.platform === 'darwin') {
      try {
        const data = JSON.parse(await deps.run('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json']));
        result = {source: 'system_profiler', gpus: array(data.SPDisplaysDataType).slice(0, 32).map((gpu, index) => {
          const name = gpu.sppci_model || gpu._name || 'GPU';
          const unified = deps.arch === 'arm64' && /apple/i.test(name);
          const shared = unified || Boolean(gpu.spdisplays_vram_shared || gpu.spdisplays_vram_dynamic);
          const dedicated = !shared && Boolean(gpu.spdisplays_vram) && !/intel/i.test(name);
          return {id: `metal-${index}`, name, vendor: unified ? 'Apple' : gpu.spdisplays_vendor || 'unknown',
            memoryKind: unified ? 'unified' : shared ? 'shared' : dedicated ? 'dedicated' : 'unknown',
            totalBytes: dedicated ? parseMemorySize(gpu.spdisplays_vram) : null, usedBytes: null, sharedUsedBytes: null,
            source: 'system_profiler', reason: unified ? 'unified-memory' : 'metric-unavailable'};
        })};
      } catch { result = {gpus: [], ...unavailable('system_profiler', 'discovery-unavailable')}; }
    } else result = {gpus: [], ...unavailable('none', 'unsupported-platform')};
    discovered = result; discoveryTime = deps.now(); return result;
  }

  async function gpuMemory() {
    const [inventory, measured] = await Promise.all([discover(), deps.platform === 'darwin' ? [] : nvidia()]);
    const devices = measured.slice();
    for (const gpu of inventory.gpus) {
      if (measured.some(item => item.pciBusId && item.pciBusId === gpu.pciBusId) || (deps.platform === 'win32' && gpu.vendor === 'NVIDIA' && measured.some(item => item.name === gpu.name))) continue;
      const device = {...gpu}; delete device.base;
      if (deps.platform === 'linux' && gpu.vendor === 'AMD') {
        const [used, total] = await Promise.all([safeRead(gpu.base + '/mem_info_vram_used'), safeRead(gpu.base + '/mem_info_vram_total')]);
        device.usedBytes = number(used); device.totalBytes = number(total);
        if (device.totalBytes > 0) {device.memoryKind = 'dedicated'; device.reason = device.usedBytes === null ? 'metric-unavailable' : null;}
        // APUs may expose no dedicated VRAM. Do not turn system RAM into VRAM.
        else {device.totalBytes = null; device.usedBytes = null;}
      }
      devices.push(device);
    }
    if (deps.platform === 'win32' && devices.length === 1 && !measured.length) {
      try {
        const counters = array(JSON.parse(await deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Select-Object Name,DedicatedUsage,SharedUsage) | ConvertTo-Json -Compress'])));
        // CIM controller ordering does not identify a LUID in multi-GPU systems.
        // Only the unambiguous one-controller/one-adapter case is attributed.
        if (counters.length === 1) {
          devices[0].usedBytes = number(counters[0].DedicatedUsage);
          devices[0].sharedUsedBytes = number(counters[0].SharedUsage);
          devices[0].source = 'windows-gpu-counters';
          devices[0].reason = devices[0].usedBytes === null && devices[0].sharedUsedBytes === null ? 'metric-unavailable' : null;
        }
      } catch {}
    }
    return {devices, status: devices.some(gpu => gpu.usedBytes !== null || gpu.sharedUsedBytes !== null) ? 'available' : devices.length ? 'partial' : inventory.reason ? 'unavailable' : 'empty',
      reason: inventory.reason || null, discoverySource: inventory.source};
  }

  return {async snapshot() {
    if (cached && deps.now() - cached.observedAt < 2500) return structuredClone(cached);
    if (!pending) pending = (async () => {
      const [memory, gpu] = await Promise.all([ram(), gpuMemory()]);
      cached = {platform, ram: memory, gpu, observedAt: deps.now(), refreshIntervalMs: 3000};
      return cached;
    })().finally(() => {pending = null;});
    return structuredClone(await pending);
  }};
}

export const resourceMonitor = createResourceMonitor();
