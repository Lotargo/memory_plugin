# KNOWN ISSUE: Policy Chunks Dominate Results Across All Modes

> Date: 2026-08-11
> Status: INVESTIGATING
> Severity: Medium — affects benchmark validity, not production correctness

---

## Symptom

Benchmark shows identical policy hit rates across BM25, Vector, RRF, and RSF modes:

```
BM25:  4/7 (57%) table, 6/6 (100%) code
Vector: 4/7 (57%) table, 6/6 (100%) code
RRF:   4/7 (57%) table, 6/6 (100%) code
RSF:   5/7 (71%) table, 6/6 (100%) code
```

This is suspicious because fundamentally different algorithms should produce different result orderings.

---

## Root Cause Analysis

### What's happening

1. **BM25Search correctly returns BOTH chunk types**: Debug shows BM25 returns `table_summary` (ranks 1-5) AND `micro_chunk` (ranks 6-10) for the same query.

2. **Parent-Child Rollup was collapsing them**: Original code deduplicated by `medium_id`, and since `table_summary` has higher BM25 score than `micro_chunk` (same medium_id), only `table_summary` survived.

3. **Fix attempt**: Added `policy:` / `micro:` prefix to dedup key so both types coexist. Debug confirms this works — after dedup, both `table_summary` AND `micro_chunk` survive.

4. **BUT benchmark still shows only policy chunks in top-5**: Even after the fix, `hybridQuery()` returns only `table_summary` in top-5 for all modes.

### Why policy chunks dominate

**Table summary content**: "Table with columns [Model, MRR@5, Recall@5, Latency] containing 4 rows. Context: Benchmark Results."

**Micro chunk content**: Raw table rows with pipe delimiters and values.

For query "Table with columns containing Model and MRR":
- `table_summary` matches "Table", "columns", "Model", "MRR" → high BM25 score
- `micro_chunk` matches "Model", "MRR" (in header row) → lower BM25 score

**Result**: `table_summary` always ranks higher → occupies all top-5 slots → `micro_chunk` never appears in results.

### Why all modes are identical

- **BM25**: Finds table_summary first (lexical match on "Table", "columns")
- **Vector**: Finds table_summary first (semantic match — summary describes the table)
- **RRF/RSF**: Both BM25 and vector agree on table_summary → fusion keeps it on top

The algorithms aren't broken — they correctly identify `table_summary` as the best match. The issue is that **policy chunks are designed to be better search targets** (they contain descriptive text), so they naturally dominate.

---

## Impact

### Production: LOW
- Policy chunks expanding to full content is the desired behavior
- Users get full table/function when searching — this is correct
- No data loss, no incorrect results

### Benchmark: HIGH
- Cannot measure "policy hit rate" accurately if policy chunks always dominate
- Cannot compare modes meaningfully if they all return the same chunk types
- Need a benchmark where policy and micro chunks are genuinely competitive

---

## Proposed Solutions (for next session)

### Option A: Separate policy and micro_chunk in results
- Return N policy hits + M micro_chunk hits (e.g., 3+2 instead of 5 mixed)
- Ensures both content types are represented

### Option B: Deduplicate by source, not by chunk
- Group all chunks by `policy_source_id` or `medium_id`
- Return the BEST chunk from each group
- Prevents policy chunks from occupying all top slots

### Option C: Benchmark with queries that favor micro_chunks
- Use exact-value queries ("What is the MRR@5 score for RRF?") where raw rows win
- Use summary queries ("Table with columns") where policy chunks win
- Measure the difference

### Option D: Disable policy dedup in benchmark mode
- Add a `policyExpansion` flag to `hybridQuery`
- When false, treat all chunks as `micro_chunk` (baseline comparison)
- Compare baseline vs policy-enabled directly

---

## Debug Files (preserve for next session)

- `temp_debug_modes.mjs` — shows per-mode results
- `temp_debug_bm25.mjs` — shows raw BM25 output
- `temp_debug_dedup.mjs` — shows dedup trace

---

## Verification Steps for Next Session

1. Run `node temp_debug_bm25.mjs` — confirm BM25 returns both types
2. Run `node temp_debug_dedup.mjs` — confirm dedup keeps both types
3. Run `node temp_debug_modes.mjs` — confirm hybridQuery returns only policy
4. Trace through `hybridQuery()` to find where micro_chunks are lost
5. Implement fix (Option A, B, C, or D)
6. Re-run benchmark — expect DIFFERENT results per mode
