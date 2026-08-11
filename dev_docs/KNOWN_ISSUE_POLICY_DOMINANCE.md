# KNOWN ISSUE: Policy Chunks Dominate Results Across All Modes

> Date: 2026-08-11
> Status: **RESOLVED** — investigated, feature made toggleable
> Severity: Low — trade-off between recall and precision, configurable

---

## Summary

Investigated whether policy chunks (table_summary, code_signature) unfairly dominate search results. Created a dedicated benchmark with raw documents containing tables, code, and text. **Finding: policy chunks do NOT dominate on realistic data** — they act as a safety net for ambiguous queries, adding ~23% policy chunks to results overall.

The feature is now **toggleable** via `config.policyExpansion` (default: `true`).

---

## Investigation Results

### New Benchmark: `policy_dominance_test.js`

Uses 8 raw documents across 4 categories:
- `table_only` — structured data in markdown tables
- `code_only` — code blocks with JSDoc
- `text_only` — prose only (control group)
- `mixed` — tables + code + prose interleaved

14 queries designed to favor different chunk types (summary, exact_value, code_symbol).

### Chunk-Type Distribution (policyExpansion=true)

| Mode | Policy % | Micro % |
|------|----------|---------|
| BM25 | 27.7% | 72.3% |
| Vector | 16.9% | 83.1% |
| RRF | 26.2% | 73.8% |
| RSF | 21.5% | 78.5% |
| **Global** | **23.1%** | **76.9%** |

**Conclusion**: Micro chunks dominate. Policy chunks are a supplementary layer, not a dominant force.

### Impact on Search Quality (before vs after policy chunks)

| Mode | MRR Δ | Recall Δ |
|------|-------|----------|
| BM25 | **+0.083** | **+0.095** |
| Vector | −0.032 | **+0.095** |
| RRF | −0.024 | **+0.048** |
| RSF | −0.016 | **+0.048** |

**Trade-off**: Policy chunks boost recall (+5-10%) at a small MRR cost (−1.5-3.2%). BM25 is a clear winner (both metrics improve). RSF achieves perfect recall (1.0).

---

## Implementation: Toggleable Policy Expansion

### Config

Added to `config_manager.js`:
```javascript
policyExpansion: true,  // default ON — boosts recall
```

### Usage

```javascript
// Per-call override
await hybridQuery({ query: "...", policyExpansion: false });

// Global config
await updateConfig({ policyExpansion: false });
```

### Behavior

| `policyExpansion` | Effect |
|-------------------|--------|
| `true` (default) | Policy chunks expand to full content, coexist with micro_chunks |
| `false` | All chunks treated as micro_chunk, no expansion, no policy dedup |

### Files Modified

- `mcp-server/config/config_manager.js` — added `policyExpansion: true` default
- `mcp-server/retrieval/retriever.js` — `hybridQuery()` respects the flag
- `tests/unit/policy_retrieval.test.js` — added 2 tests for `policyExpansion=false`

---

## Recommendation

**Keep `policyExpansion: true` by default.** In real usage, top 5-10 results are sent to LLM. The slight MRR decrease is worth the recall increase — relevant data is more likely to reach the LLM. Users who need pure precision can disable it via config.

---

## Debug Files

- `mcp-server/benchmarks/policy_dominance_test.js` — standalone benchmark
- `mcp-server/benchmarks/raw_corpus_data.js` — raw corpus with tables/code/text
