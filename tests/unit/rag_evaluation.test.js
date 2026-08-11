/**
 * RAG Evaluation Test — runs analytical queries against the knowledge base
 * and checks whether the retrieved chunks contain the expected data.
 *
 * Design:
 *   - Each question has "expected facts" — specific numbers/values that MUST
 *     appear in the retrieved chunks for the answer to be correct.
 *   - Search queries are pre-optimized (simulating what an agent would send
 *     after translating the user's natural language intent).
 *   - Test passes if ≥80% of expected facts are found in the top-K results.
 *
 * Usage: node tests/unit/rag_evaluation.test.js
 */

import { readFile } from "node:fs/promises";
import { hybridQuery } from "../../mcp-server/retrieval/retriever.js";

// ── Test Cases ────────────────────────────────────────────────────────────
// Each case: { question, queries (optimized search strings), expectedFacts }

const TEST_CASES = [
  {
    id: "Q1",
    question: "Сформируй сводную таблицу сравнения плана и факта по Выручке, EBITDA и Чистой прибыли за Q1, Q2 и Q3 2025 года.",
    queries: [
      "Выручка план факт Q1 Q2 Q3 2025 квартал",
      "EBITDA план факт Q1 Q2 Q3 2025 отклонение",
      "Чистая прибыль Q1 Q2 Q3 2025 млн рублей",
    ],
    expectedFacts: [
      "1 240,5", "1 415,8", "1 510,4", // revenue facts
      "1 200,0", "1 380,0", "1 480,0", // revenue plans
      "104,2", "124,5", "135,2", // EBITDA facts
      "96,0", "115,0", "128,0", // EBITDA plans
      "68,2", "81,4", "91,8", // net profit
      "3,38", "2,59", "2,05", // plan deviation %
    ],
  },
  {
    id: "Q2",
    question: "Проанализируй динамику рентабельности по EBITDA (от 8.4% в Q1 до 8.95% в Q3).",
    queries: [
      "EBITDA рентабельность Q1 Q2 Q3 процент",
      "Валовая маржа EBITDA динамика квартал",
    ],
    expectedFacts: [
      "8,4%", "8,8%", "8,95%",
      "23,1%", "23,6%", "23,8%", // gross margin
    ],
  },
  {
    id: "Q3",
    question: "Сравни динамику Среднего чека (AOV) и Количества заказов за 3 квартала.",
    queries: [
      "Средний чек AOV Q1 Q2 Q3 рублей",
      "Количество заказов тыс шт Q1 Q2 Q3",
    ],
    expectedFacts: [
      "7 121", "6 981", "7 451", // AOV
      "174,2", "202,8", "202,7", // orders
      "6 667", "6 900", "7 400", // AOV plans
    ],
  },
  {
    id: "Q4",
    question: "Кросс-квартальный анализ категории Умный дом и климат и Ноутбуки и ПК.",
    queries: [
      "Умный дом климат выручка доля маржа Q1 Q2 Q3",
      "Ноутбуки ПК выручка доля маржа Q1 Q2 Q3",
    ],
    expectedFacts: [
      "148,9", "212,4", "151,0", // smart home revenue
      "34,0%", "34,5%", "33,0%", // smart home margin
      "310,1", "311,5", "422,9", // laptops revenue
      "19,0%", "19,2%", "19,5%", // laptops margin
    ],
  },
  {
    id: "Q5",
    question: "Оцени эффективность запуска новой категории Садовая техника и инструмент.",
    queries: [
      "Садовая техника инструмент выручка доля Q2 Q3",
      "Новая категория садовая запуск",
    ],
    expectedFacts: [
      "84,9", // Q2 new category revenue
      "75,5", // Q3 new category revenue
      "6,0%", "5,0%", // share
    ],
  },
  {
    id: "Q6",
    question: "Составь рейтинг товарных категорий по уровню валовой маржинальности за 9М 2025.",
    queries: [
      "Валовая маржинальность категория смартфоны ноутбуки бытовая умный дом аксессуары",
      "Маржа категория рейтинг 2025",
    ],
    expectedFacts: [
      "16,5%", "16,8%", "17,0%", // smartphones margin
      "28,5%", "28,0%", "28,2%", // large appliances
      "42,0%", "43,5%", "44,0%", // accessories margin
    ],
  },
  {
    id: "Q7",
    question: "Сравни динамику CAC и ДРР за Q1, Q2 и Q3.",
    queries: [
      "CAC стоимость привлечения клиента Q1 Q2 Q3 рублей",
      "ДРР доля рекламных расходов Q1 Q2 Q3 процент",
    ],
    expectedFacts: [
      "890", "845", "830", // CAC
      "850", "860", "840", // CAC plans
      "4,95", // min DRR
    ],
  },
  {
    id: "Q8",
    question: "Проанализируй эффективность CRM-маркетинга за 3 квартала.",
    queries: [
      "CRM email push канал привлечения выручка ДРР",
      "Контекстная реклама PPC канал выручка затраты",
      "Маркетинговые каналы эффективность ДРР конверсия",
    ],
    expectedFacts: [
      "CRM", "Email", "Push", "PPC", "SEO",
      "256,8", // CRM revenue Q3
      "528,6", // PPC revenue Q3
      "1,64%", // CRM DRR
      "7,23%", // PPC DRR
      "4,2", // CRM cost
      "38,2", // PPC cost
    ],
  },
  {
    id: "Q9",
    question: "Как открытие логистического центра и автоматизация склада отразились на доле возвратов?",
    queries: [
      "Доля возвратов Q1 Q2 Q3 процент",
      "Логистический центр Поволжье автоматизация склад",
    ],
    expectedFacts: [
      "2,1%", "1,9%", "1,8%", // return rates
      "35%", // automation boost
      "85%", // fulfillment capacity
    ],
  },
  {
    id: "Q10",
    question: "Сравни динамику повторных покупок (Repeat Purchase Rate) от Q1 до Q3.",
    queries: [
      "Repeat Purchase Rate повторные покупки Q1 Q2 Q3",
      "Лояльность клиентов динамика квартал",
    ],
    expectedFacts: [
      "35,1%", "38,5%", "41,2%",
    ],
  },
];

// ── Test Runner ────────────────────────────────────────────────────────────

async function runEvaluation() {
  console.log("--- RAG Evaluation Test ---\n");
  console.log(`Running ${TEST_CASES.length} analytical queries against knowledge base...\n`);

  let totalFacts = 0;
  let foundFacts = 0;
  let passedCases = 0;
  const results = [];

  for (const tc of TEST_CASES) {
    // Execute all search queries for this test case in parallel
    const queryResults = await Promise.all(
      tc.queries.map((q) => hybridQuery({ query: q, limit: 5, generateEmbeddings: true }))
    );

    // Merge all retrieved chunks into a single text corpus
    const allChunks = queryResults.flat();
    const allText = allChunks.map((c) => c.snippet || c.full_section_content || "").join("\n---\n");

    // Check which expected facts are found
    const factResults = tc.expectedFacts.map((fact) => {
      const found = allText.includes(fact);
      return { fact, found };
    });

    const caseFound = factResults.filter((f) => f.found).length;
    const caseTotal = factResults.length;
    const caseScore = caseTotal > 0 ? caseFound / caseTotal : 0;
    const passed = caseScore >= 0.8;

    totalFacts += caseTotal;
    foundFacts += caseFound;
    if (passed) passedCases++;

    results.push({
      id: tc.id,
      score: caseScore,
      passed,
      missing: factResults.filter((f) => !f.found).map((f) => f.fact),
    });

    const status = passed ? "✅" : "❌";
    console.log(`${status} ${tc.id}: ${caseFound}/${caseTotal} facts found (${(caseScore * 100).toFixed(0)}%)`);
    if (!passed) {
      console.log(`   Missing: ${results[results.length - 1].missing.join(", ")}`);
    }
  }

  // Summary
  const globalScore = totalFacts > 0 ? (foundFacts / totalFacts) * 100 : 0;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Total: ${foundFacts}/${totalFacts} facts found (${globalScore.toFixed(1)}%)`);
  console.log(`Cases passed: ${passedCases}/${TEST_CASES.length}`);
  console.log(`Status: ${passedCases === TEST_CASES.length ? "✅ ALL PASSED" : "⚠️  SOME FAILED"}`);

  return { totalFacts, foundFacts, passedCases, globalScore };
}
// ── Comparison: Raw vs Optimized Queries ──────────────────────────────────
// Demonstrates that sending the user's question verbatim produces worse
// results than sending optimized search queries (what an agent would do).

async function runComparison() {
  console.log("\n\n=== Comparison: Raw Question vs Optimized Queries ===\n");

  const cases = [
    {
      question: "Сформируй сводную таблицу сравнения плана и факта по Выручке, EBITDA и Чистой прибыли за Q1, Q2 и Q3 2025 года.",
      optimized: ["Выручка план факт Q1 Q2 Q3 2025", "EBITDA план факт Q1 Q2 Q3 2025", "Чистая прибыль Q1 Q2 Q3 2025"],
      keyFacts: ["1 240,5", "1 415,8", "1 510,4", "104,2", "124,5", "135,2", "68,2", "81,4", "91,8"],
    },
    {
      question: "Проведи кросс-квартальный анализ категории Умный дом и климат и категории Ноутбуки и ПК.",
      optimized: ["Умный дом климат выручка доля маржа Q1 Q2 Q3", "Ноутбуки ПК выручка доля маржа Q1 Q2 Q3"],
      keyFacts: ["148,9", "212,4", "34,0%", "310,1", "422,9", "19,5%"],
    },
  ];

  for (const c of cases) {
    const rawResults = await hybridQuery({ query: c.question, limit: 5, generateEmbeddings: true });
    const rawText = rawResults.map((r) => r.snippet || "").join("\n");
    const rawFound = c.keyFacts.filter((f) => rawText.includes(f)).length;

    const optResults = await Promise.all(
      c.optimized.map((q) => hybridQuery({ query: q, limit: 5, generateEmbeddings: true }))
    );
    const optText = optResults.flat().map((r) => r.snippet || "").join("\n");
    const optFound = c.keyFacts.filter((f) => optText.includes(f)).length;

    console.log("Question: " + c.question.substring(0, 60) + "...");
    console.log("  Raw query:      " + rawFound + "/" + c.keyFacts.length + " key facts (" + ((rawFound / c.keyFacts.length) * 100).toFixed(0) + "%)");
    console.log("  Optimized:      " + optFound + "/" + c.keyFacts.length + " key facts (" + ((optFound / c.keyFacts.length) * 100).toFixed(0) + "%)");
    console.log("  Improvement:    +" + (((optFound - rawFound) / c.keyFacts.length) * 100).toFixed(0) + "%");
    console.log("");
  }
}

// Run main evaluation, then comparison
runEvaluation()
  .then(async ({ passedCases }) => {
    await runComparison();
    process.exit(passedCases === TEST_CASES.length ? 0 : 1);
  })
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
