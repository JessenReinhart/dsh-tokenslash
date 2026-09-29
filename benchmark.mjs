/**
 * benchmark.mjs — dsh-tokenslash end-to-end prompt pruning benchmark
 *
 * Scenario: "Audit the lib/ directory of this repo for security, error
 * handling, dead code, and async safety."
 *
 * Runs the REAL promptPruneHook (same code path as live DSH) against
 * a real assembled prompt captured from a live session, in three modes:
 *   1. off  — no pruning at all (baseline)
 *   2. normal — core tools kept, inactive tools pruned
 *   3. extreme — intent-based pruning (active only)
 *
 * Token estimate: chars / 4  (same formula used by the plugin itself).
 * Jev triage: real HTTP call to the live 9router endpoint.
 *
 * Prints ONLY measured data; no estimates or extrapolations.
 */

import { readFileSync } from 'node:fs';
import { createPromptPruneHook, TOOL_GROUPS } from './lib/hooks/prompt-prune.js';
import { JevClient } from './lib/jev-client.js';
import { TokenslashTelemetry } from './lib/telemetry.js';

// ── 1. Load real tool schemas captured from live session ──────────────────────
const TOOLS = JSON.parse(readFileSync('./benchmark-tools.json', 'utf-8'));
console.log(`Loaded ${TOOLS.length} real tool schemas from live session.`);

// ── 2. Build real sections from the live system message ───────────────────────
// Sections in DSH are named blocks of the system message. We reconstruct them
// from the real system-message text by splitting on markdown ## headings.
const sysMsg = JSON.parse(readFileSync('./benchmark-system-message.json', 'utf-8'));
const sysText = sysMsg.content[0].text;

function parseSections(text) {
  const sections = [];
  const lines = text.split('\n');
  let currentName = 'persona';
  let currentLines = [];

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    const h1 = line.match(/^#\s+(.+)/);
    const heading = h2 || h1;
    if (heading) {
      if (currentLines.length > 0) {
        sections.push({ name: currentName.toLowerCase().replace(/\s+/g, '-'), text: currentLines.join('\n').trim() });
      }
      currentName = heading[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ name: currentName.toLowerCase().replace(/\s+/g, '-'), text: currentLines.join('\n').trim() });
  }
  return sections;
}

const SECTIONS = parseSections(sysText);
console.log(`Parsed ${SECTIONS.length} sections from live system message.`);
console.log(`Section names: ${SECTIONS.map(s => s.name).join(', ')}`);

// ── 3. Compute total chars of baseline assembly ────────────────────────────────
function assemblyChars(tools, sections) {
  const toolChars = tools.reduce((s, t) => s + JSON.stringify(t).length, 0);
  const sectionChars = sections.reduce((s, sec) => s + sec.text.length, 0);
  return { toolChars, sectionChars, total: toolChars + sectionChars };
}

function tokensFrom(chars) { return Math.round(chars / 4); }

// ── 4. Set up Jev client pointing at live 9router endpoint ────────────────────
const jevConfig = {
  provider: '9router',
  customBaseUrl: 'http://127.0.0.1:20128/v1/systemone',
  model: 'openrouter/typesafe/jev-1.13',
  apiKey: '',
  failOpen: true,
};
const jevClient = new JevClient(jevConfig);

// ── 5. Run benchmark ───────────────────────────────────────────────────────────
const TASK = 'Audit the lib/ directory of this repo for security issues, error handling gaps, dead code, and async safety problems. Report specific issues with file and line references.';

async function runMode(mode, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`MODE: ${label} (toolPruningMode="${mode}")`);
  console.log(`${'='.repeat(60)}`);

  const telemetry = new TokenslashTelemetry();
  const config = {
    enabled: mode !== 'off',
    toolPruningMode: mode === 'off' ? 'off' : mode,
    modules: { promptPruning: mode !== 'off' },
    pinnedTools: [],
    failOpen: true,
    model: jevConfig.model,
    customBaseUrl: jevConfig.customBaseUrl,
  };

  const hook = createPromptPruneHook(
    { logger: { debug: () => {}, warn: (m) => console.warn('  [warn]', m) } },
    jevClient,
    () => config,
    telemetry,
    null,
  );

  const assembled = { tools: [...TOOLS], sections: [...SECTIONS] };

  // Simulate agent context: provide user prompt via agent.inbox
  const context = {
    agent: {
      id: 'benchmark-agent',
      inbox: {
        hasPending: true,
        nextStep: [{ content: TASK }],
      },
    },
  };

  const baseline = assemblyChars(TOOLS, SECTIONS);
  console.log(`Baseline: ${TOOLS.length} tools (${baseline.toolChars} chars / ${tokensFrom(baseline.toolChars)} tokens), ${SECTIONS.length} sections (${baseline.sectionChars} chars / ${tokensFrom(baseline.sectionChars)} tokens)`);
  console.log(`Baseline total: ${baseline.total} chars / ${tokensFrom(baseline.total)} tokens`);

  const start = Date.now();
  const result = await hook(assembled, context, async () => assembled);
  const elapsed = Date.now() - start;

  const after = assemblyChars(result.tools ?? [], result.sections ?? []);
  const toolsSaved = baseline.toolChars - after.toolChars;
  const sectionsSaved = baseline.sectionChars - after.sectionChars;
  const totalSaved = toolsSaved + sectionsSaved;

  console.log(`\nAfter pruning:`);
  console.log(`  Tools:    ${result.tools?.length ?? 0} tools (${after.toolChars} chars / ${tokensFrom(after.toolChars)} tokens) — saved ${toolsSaved} chars / ${tokensFrom(toolsSaved)} tokens`);
  console.log(`  Sections: ${result.sections?.length ?? 0} sections (${after.sectionChars} chars / ${tokensFrom(after.sectionChars)} tokens) — saved ${sectionsSaved} chars / ${tokensFrom(sectionsSaved)} tokens`);
  console.log(`  Total saved: ${totalSaved} chars / ${tokensFrom(totalSaved)} tokens`);
  console.log(`  Reduction: ${baseline.total > 0 ? ((totalSaved / baseline.total) * 100).toFixed(1) : 0}%`);
  console.log(`  Hook wall time: ${elapsed}ms`);

  const stats = telemetry.getStats();
  console.log(`  Telemetry: toolsPrunedCount=${stats.toolsPrunedCount} promptsPrunedCount=${stats.promptsPrunedCount} totalTokensSaved=${stats.totalTokensSaved}`);

  const prunedToolNames = TOOLS.map(t => t.name).filter(n => !result.tools?.some(rt => rt.name === n));
  const keptToolNames = result.tools?.map(t => t.name) ?? [];
  console.log(`  Pruned tools (${prunedToolNames.length}): ${prunedToolNames.join(', ')}`);
  console.log(`  Kept tools (${keptToolNames.length}): ${keptToolNames.join(', ')}`);

  const prunedSectionNames = SECTIONS.map(s => s.name).filter(n => !result.sections?.some(rs => rs.name === n));
  console.log(`  Pruned sections (${prunedSectionNames.length}): ${prunedSectionNames.join(', ')}`);

  return {
    mode,
    label,
    baselineToolCount: TOOLS.length,
    keptToolCount: result.tools?.length ?? 0,
    prunedToolCount: prunedToolNames.length,
    baselineSectionCount: SECTIONS.length,
    keptSectionCount: result.sections?.length ?? 0,
    prunedSectionCount: prunedSectionNames.length,
    baselineChars: baseline.total,
    afterChars: after.total,
    savedChars: totalSaved,
    baselineTokens: tokensFrom(baseline.total),
    afterTokens: tokensFrom(after.total),
    savedTokens: tokensFrom(totalSaved),
    reductionPct: baseline.total > 0 ? ((totalSaved / baseline.total) * 100).toFixed(1) : '0.0',
    hookMs: elapsed,
  };
}

// ── 6. Execute all modes ───────────────────────────────────────────────────────
console.log(`\nTask: "${TASK}"`);
console.log('\nJev endpoint: http://127.0.0.1:20128/v1/systemone');
console.log(`Jev model: ${jevConfig.model}`);

const results = [];
results.push(await runMode('off', 'Baseline (pruning off)'));
results.push(await runMode('normal', 'Normal mode'));
results.push(await runMode('extreme', 'Extreme mode'));

// ── 7. Summary table ───────────────────────────────────────────────────────────
console.log('\n\n' + '='.repeat(80));
console.log('BENCHMARK SUMMARY — MEASURED DATA ONLY');
console.log('='.repeat(80));
console.log(`Task: "${TASK}"`);
console.log(`Date: ${new Date().toISOString()}`);
console.log(`Node.js: ${process.version}`);
console.log(`Jev model: ${jevConfig.model}`);
console.log('');

const header = ['Mode', 'Tools kept', 'Tools pruned', 'Sections pruned', 'Total tokens', 'Tokens saved', 'Reduction%', 'Hook ms'];
const rows = results.map(r => [
  r.label,
  `${r.keptToolCount}/${r.baselineToolCount}`,
  `${r.prunedToolCount}`,
  `${r.prunedSectionCount}/${r.baselineSectionCount}`,
  `${r.afterTokens}`,
  `${r.savedTokens}`,
  `${r.reductionPct}%`,
  `${r.hookMs}ms`,
]);

// Format table
const colWidths = header.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
const row2str = cells => '| ' + cells.map((c, i) => String(c).padEnd(colWidths[i])).join(' | ') + ' |';
const divider = '+-' + colWidths.map(w => '-'.repeat(w)).join('-+-') + '-+';

console.log(divider);
console.log(row2str(header));
console.log(divider);
for (const row of rows) {
  console.log(row2str(row));
}
console.log(divider);

// JSON output for use in docs
const outputPath = 'benchmark-results.json';
const output = {
  task: TASK,
  date: new Date().toISOString(),
  nodeVersion: process.version,
  jevModel: jevConfig.model,
  jevEndpoint: jevConfig.customBaseUrl,
  totalToolsInSession: TOOLS.length,
  totalSectionsInSystemMessage: SECTIONS.length,
  baselineChars: tokensFrom(results[0].baselineChars) + ' tokens (' + results[0].baselineChars + ' chars)',
  results: results.map(r => ({
    mode: r.mode,
    label: r.label,
    tools: { baseline: r.baselineToolCount, kept: r.keptToolCount, pruned: r.prunedToolCount },
    sections: { baseline: r.baselineSectionCount, kept: r.keptSectionCount, pruned: r.prunedSectionCount },
    tokens: { baseline: r.baselineTokens, after: r.afterTokens, saved: r.savedTokens, reductionPct: r.reductionPct },
    chars: { baseline: r.baselineChars, after: r.afterChars, saved: r.savedChars },
    hookMs: r.hookMs,
  })),
};
import { writeFileSync } from 'node:fs';
writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`\nFull results written to ${outputPath}`);
