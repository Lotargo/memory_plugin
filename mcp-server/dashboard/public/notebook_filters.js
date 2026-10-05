// Presentation filters use engine-provided kind/reasons; they do not determine
// whether a directive is active or change Notebook storage semantics.
export const historicalRecord = record => record.reasons.some(reason => ['expired', 'superseded'].includes(reason));

export function filterNotebookRecords(records, { view = 'notebook', status = 'active', kind = 'all', tags = '', since = '', until = '', query = '' } = {}) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const wantedTags = tags.toLocaleLowerCase().split(',').map(tag => tag.trim()).filter(Boolean);
  if (since && until && since > until) return [];
  return records.filter(record => {
    if (view === 'archive' && !historicalRecord(record)) return false;
    if (view === 'persona' && record.kind !== 'directive') return false;
    if (view !== 'archive' && status === 'active' && historicalRecord(record)) return false;
    if (status === 'protected' && record.meta?.keep !== '1') return false;
    if (['disabled', 'expired', 'superseded'].includes(status) && !record.reasons.includes(status)) return false;
    if (kind !== 'all' && record.kind !== kind) return false;
    if ((since || until) && (!record.date || (since && record.date < since) || (until && record.date > until))) return false;
    const haveTags = (record.meta?.tags || '').toLocaleLowerCase().split(',').map(tag => tag.trim());
    if (wantedTags.length && !wantedTags.some(tag => haveTags.includes(tag))) return false;
    const text = `${record.title || ''} ${record.body} ${record.id || ''} ${record.meta?.tags || ''} ${record.date || ''}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
