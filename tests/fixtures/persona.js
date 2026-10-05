// Call only after setting the isolated MEMORY_DIR and client config paths.
export async function seedPersonaFixture() {
  const memory = await import('../../mcp-server/memory.js');
  const { getDatabase } = await import('../../mcp-server/db/database.js');
  const { upsertIdentity } = await import('../../mcp-server/identity.js');
  const a = 'git:example.test/persona/a', b = 'git:example.test/persona/b';
  const db = await getDatabase();
  for (const [key, name] of [[a, 'Проект A'], [b, 'Проект B']]) await upsertIdentity(db, { key, name, primaryRemote: key.slice(4) });
  const line = (title, body, meta, date = '2099-01-01') => `- [${date} 10:00] **${title}** — ${body} <!-- ${meta} -->`;
  await memory.writeMemory('global', [
    line('Общее правило', 'Сохранять проверенные источники', 'id:same, kind:directive, keep:1'),
    line('Legacy-стиль', 'Отвечать коротко', 'id:legacy, tags:style'),
    line('Глобальный факт', 'Локальное хранилище', 'id:fact, kind:fact'),
  ]);
  await memory.writeMemory(a, [
    line('Правило A', 'Проверять данные проекта A', 'id:same, kind:directive'),
    line('Выключена', 'Временно отключённое правило', 'id:disabled, kind:directive, disabled:1'),
    line('Истёкшая', 'Историческое правило с истёкшим сроком', 'id:expired, kind:directive, ttl:1d, keep:1', '2000-01-01'),
    line('Заменённая', 'Прежнее правило проекта', 'id:old, kind:directive, supersededBy:same'),
    line('Legacy без ID', 'Сохранять область записи', 'tags:persona'),
    line('Недоверенный текст', '<img src=x onerror=alert(1)>', 'id:html, kind:directive'),
  ]);
  await memory.writeMemory(b, [line('Правило B', 'Данные другого проекта B', 'id:same, kind:directive')]);
  return { a, b };
}
