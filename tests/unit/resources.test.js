import assert from 'node:assert/strict';
import {createResourceMonitor, parseNvidiaMemory, parseMemorySize} from '../../mcp-server/monitoring/resources.js';

const GiB = 1024 ** 3;
const base = {arch: 'x64', release: 'test', totalmem: () => 16 * GiB, freemem: () => 2 * GiB,
  run: async () => {throw new Error('unsupported');}, readFile: async () => {throw new Error('missing');}, readdir: async () => [], realpath: async value => value};
const monitor = overrides => createResourceMonitor({...base, ...overrides});
const csv = 'GPU-one, NVIDIA One, 00000000:01:00.0, 0, 1024, 8192\nGPU-two, NVIDIA Two, 00000000:02:00.0, 1, [N/A], 4096';

const devices = parseNvidiaMemory(csv);
assert.equal(devices.length, 2);
assert.equal(devices[0].pciBusId, '0000:01:00.0');
assert.equal(devices[1].usedBytes, null, 'N/A is not zero');
assert.deepEqual(parseNvidiaMemory('not CSV'), []);
assert.equal(parseMemorySize('1536 MB'), 1536 * 1024 ** 2);
assert.equal(parseMemorySize('Dynamic, max'), null);

let commands = [], time = 10000;
const windows = monitor({platform: 'win32', now: () => time, run: async (file, args) => {
  commands.push([file, args]);
  if (file === 'nvidia-smi') return csv;
  return JSON.stringify([{Name: 'NVIDIA One', PNPDeviceID: 'PCI\\VEN_10DE'}, {Name: 'Intel Integrated', PNPDeviceID: 'PCI\\VEN_8086'}]);
}});
const [one, two] = await Promise.all([windows.snapshot(), windows.snapshot()]);
assert.equal(commands.length, 2, 'concurrent tabs share one hardware probe');
assert.equal(one.gpu.devices.length, 3, 'all NVIDIA devices plus integrated GPU, without duplicated CIM entries');
assert.equal(one.ram.availableBytes, 2 * GiB);
assert.equal(one.ram.usedBytes, 14 * GiB);
one.gpu.devices.length = 0;
assert.equal(two.gpu.devices.length, 3, 'callers cannot mutate the cache');
await windows.snapshot(); assert.equal(commands.length, 2);
time += 3000; await windows.snapshot(); assert.equal(commands.length, 3, 'discovery is cached, measurements refresh');

const counters = await monitor({platform: 'win32', run: async (file, args) => {
  if (file === 'nvidia-smi') throw new Error('not installed');
  return args.at(-1).includes('GPUAdapterMemory') ? JSON.stringify([{Name: 'luid_adapter', DedicatedUsage: 10, SharedUsage: 20}]) : JSON.stringify([{Name: 'AMD', PNPDeviceID: 'PCI\\VEN_1002'}]);
}}).snapshot();
assert.equal(counters.gpu.devices[0].usedBytes, 10);
assert.equal(counters.gpu.devices[0].totalBytes, null, '32-bit CIM AdapterRAM must not fabricate a capacity');
assert.equal(counters.gpu.devices[0].sharedUsedBytes, 20);

let ambiguousProbe = false;
const ambiguous = await monitor({platform: 'win32', run: async (file, args) => {
  if (file === 'nvidia-smi') throw new Error('absent');
  if (args.at(-1).includes('GPUAdapterMemory')) ambiguousProbe = true;
  return JSON.stringify([{Name: 'AMD', PNPDeviceID: 'PCI\\VEN_1002'}, {Name: 'Intel', PNPDeviceID: 'PCI\\VEN_8086'}]);
}}).snapshot();
assert.equal(ambiguousProbe, false, 'adapter order does not establish counter ownership');
assert.ok(ambiguous.gpu.devices.every(gpu => gpu.usedBytes === null));

const meminfo = 'MemTotal: 16777216 kB\nMemFree: 1048576 kB\nMemAvailable: 6291456 kB\nSwapTotal: 2097152 kB\nSwapFree: 1048576 kB\n';
const linux = await monitor({platform: 'linux', readdir: async () => ['card0', 'card0-DP-1', 'card1'],
  realpath: async file => file.includes('card0') ? '/sys/devices/0000:01:00.0' : '/sys/devices/0000:02:00.0',
  readFile: async file => {
    if (file === '/proc/meminfo') return meminfo;
    if (file.endsWith('/vendor')) return file.includes('card0') ? '0x1002' : '0x8086';
    if (file.endsWith('/device')) return '0x1234';
    if (file.endsWith('mem_info_vram_total')) return String(8 * GiB);
    if (file.endsWith('mem_info_vram_used')) return String(GiB);
    throw new Error('missing');
  }
}).snapshot();
assert.equal(linux.ram.availableBytes, 6 * GiB);
assert.equal(linux.ram.usedBytes, 10 * GiB, 'Linux usage excludes reclaimable memory, not just MemFree');
assert.equal(linux.ram.swap.usedBytes, GiB);
assert.equal(linux.gpu.devices.length, 2);
assert.equal(linux.gpu.devices[0].usedBytes, GiB);
assert.equal(linux.gpu.devices[1].memoryKind, 'unknown', 'Intel vendor alone cannot distinguish integrated and discrete GPUs');
assert.equal(linux.gpu.devices[1].totalBytes, null);

const wsl = await monitor({platform: 'linux', release: '6.6-microsoft-standard-WSL2', run: async file => {
  if (file === '/usr/lib/wsl/lib/nvidia-smi') return csv;
  throw new Error('PATH missing');
}}).snapshot();
assert.equal(wsl.platform.environment, 'wsl'); assert.equal(wsl.gpu.devices.length, 2);

const mac = await monitor({platform: 'darwin', arch: 'arm64', run: async file => file.includes('system_profiler') ? JSON.stringify({SPDisplaysDataType: [{sppci_model: 'Apple M4', spdisplays_vram: '16 GB'}]}) : 'total = 2048.00M  used = 1024.00M  free = 1024.00M (encrypted)'}).snapshot();
assert.equal(mac.platform.name, 'macOS');
assert.equal(mac.gpu.devices[0].memoryKind, 'unified');
assert.equal(mac.gpu.devices[0].totalBytes, null, 'unified RAM is never duplicated as VRAM');
assert.equal(mac.gpu.devices[0].usedBytes, null);
assert.equal(mac.ram.availableBytes, null, 'free pages are not claimed as available RAM');
assert.equal(mac.ram.swap.usedBytes, GiB);
const intelMac = await monitor({platform: 'darwin', run: async file => {
  if (file.includes('system_profiler')) return JSON.stringify({SPDisplaysDataType: [{sppci_model: 'AMD Radeon', spdisplays_vram: '8 GB'}, {sppci_model: 'Intel Iris', spdisplays_vram_shared: '1536 MB'}]});
  throw new Error('unavailable');
}}).snapshot();
assert.equal(intelMac.gpu.devices[0].totalBytes, 8 * GiB);
assert.equal(intelMac.gpu.devices[1].memoryKind, 'shared');

const missing = await monitor({platform: 'win32'}).snapshot();
assert.equal(missing.gpu.status, 'unavailable');
assert.equal(missing.gpu.devices.length, 0);
assert.equal((await monitor({platform: 'linux', readdir: async () => {throw new Error('denied');}}).snapshot()).gpu.status, 'unavailable');
assert.equal((await monitor({platform: 'linux'}).snapshot()).gpu.status, 'empty');
assert.equal((await monitor({platform: 'other'}).snapshot()).gpu.reason, 'unsupported-platform');
console.log('Resource adapters: Windows/Linux/macOS, multi-GPU, WSL, partial metrics, cache and single-flight passed.');
