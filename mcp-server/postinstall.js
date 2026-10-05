// Installation must succeed even when this host cannot run a local web panel.
try {
  const { autoStartWeb } = await import('./dashboard/runtime.js');
  const result = await autoStartWeb();
  if (!result.skipped) console.log(`Memory panel: ${result.url}`);
} catch (error) {
  console.warn(`Memory panel autostart: ${error.message}. Retry with memory-plugin web.`);
}
