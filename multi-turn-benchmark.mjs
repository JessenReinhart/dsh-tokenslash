/**
 * multi-turn-benchmark.mjs
 *
 * Runs a 4-turn real session sequence for the audit task in all 3 modes.
 * Tests resume-mask inheritance across turns.
 * Uses real live Jev triage calls and real schemas.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createPromptPruneHook } from './lib/hooks/prompt-prune.js';
import { JevClient } from './lib/jev-client.js';
import { TokenslashTelemetry } from './lib/telemetry.js';

const TOOLS = JSON.parse(readFileSync('./benchmark-tools.json', 'utf-8'));
const sysMsg = JSON.parse(readFileSync('./benchmark-system-message.json', 'utf-8'));
const sysText = sysMsg.content[0].text;

function parseSections(text) {
  const sections = [];
  const lines = text.split('\n');
  let currentName = 'persona';
  let currentLines = [];

  for (const line of lines) {
    const heading = line.match(/^##?\s+(.+)/);
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

function assemblyChars(tools, sections) {
  const toolChars = (tools ?? []).reduce((s, t) => s + JSON.stringify(t).length, 0);
  const sectionChars = (sections ?? []).reduce((s, sec) => s + sec.text.length, 0);
  return { toolChars, sectionChars, total: toolChars + sectionChars };
}

function tokensFrom(chars) { return Math.round(chars / 4); }

const jevConfig = {
  provider: '9router',
  customBaseUrl: 'http://127.0.0.1:20128/v1/systemone',
  model: 'openrouter/typesafe/jev-1.13',
  failOpen: true,
};
const jevClient = new JevClient(jevConfig);

const TURNS = [
  { turn: 1, prompt: 'Audit the lib/ directory of this repo for security issues, error handling gaps, dead code, and async safety problems. Start by scanning files.' },
  { turn: 2, prompt: 'Proceed to read lib/index.js and lib/jev-client.js to check error handling.' },
  { turn: 3, prompt: 'continue' }, // Resume keyword
  { turn: 4, prompt: 'Summarize the audit findings in a clear table report.' },
];

async function runSession(mode) {
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

  const baseline = assemblyChars(TOOLS, SECTIONS);
  const turnResults = [];

  for (const t of TURNS) {
    const assembled = { tools: [...TOOLS], sections: [...SECTIONS] };
    const context = {
      agent: {
        id: `bench-agent-${mode}`,
        inbox: {
          hasPending: true,
          nextStep: [{ content: t.prompt }],
        },
      },
    };

    const start = Date.now();
    const result = await hook(assembled, context, async () => assembled);
    const elapsed = Date.now() - start;

    const after = assemblyChars(result.tools, result.sections);
    const saved = baseline.total - after.total;

    turnResults.push({
      turn: t.turn,
      prompt: t.prompt,
      toolsKept: result.tools?.length ?? 0,
      toolsPruned: TOOLS.length - (result.tools?.length ?? 0),
      sectionsKept: result.sections?.length ?? 0,
      sectionsPruned: SECTIONS.length - (result.sections?.length ?? 0),
      baselineTokens: tokensFrom(baseline.total),
      actualTokens: tokensFrom(after.total),
      savedTokens: tokensFrom(saved),
      reductionPct: ((saved / baseline.total) * 100).toFixed(1),
      hookMs: elapsed,
    });
  }

  const totalBaseline = turnResults.reduce((s, r) => s + r.baselineTokens, 0);
  const totalActual = turnResults.reduce((s, r) => s + r.actualTokens, 0);
  const totalSaved = totalBaseline - totalActual;
  const overallReduction = ((totalSaved / totalBaseline) * 100).toFixed(1);

  return {
    mode,
    turns: turnResults,
    totalBaseline,
    totalActual,
    totalSaved,
    overallReduction,
  };
}

console.log('Running 4-turn multi-turn benchmark across all modes...');
const offRun = await runSession('off');
console.log('Off mode complete.');
const normalRun = await runSession('normal');
console.log('Normal mode complete.');
const extremeRun = await runSession('extreme');
console.log('Extreme mode complete.');

const multiResults = {
  task: 'Audit lib/ directory across 4 turns',
  date: new Date().toISOString(),
  turns: TURNS,
  off: offRun,
  normal: normalRun,
  extreme: extremeRun,
};

writeFileSync('benchmark-multiturn-results.json', JSON.stringify(multiResults, null, 2));

console.log('\n' + '='.repeat(90));
console.log('MULTI-TURN BENCHMARK SUMMARY (4 TURNS)');
console.log('='.repeat(90));

console.log('\nNORMAL MODE:');
console.table(normalRun.turns.map(t => ({
  Turn: t.turn,
  Prompt: t.prompt.slice(0, 35) + '...',
  'Tools Kept': t.toolsKept,
  'Sections Kept': t.sectionsKept,
  Baseline: t.baselineTokens,
  'With TS': t.actualTokens,
  Saved: t.savedTokens,
  'Red%': `${t.reductionPct}%`,
  'Time(ms)': t.hookMs,
})));
console.log(`Normal Total: Baseline=${normalRun.totalBaseline} | TS=${normalRun.totalActual} | Saved=${normalRun.totalSaved} (${normalRun.overallReduction}%)`);

console.log('\nEXTREME MODE:');
console.table(extremeRun.turns.map(t => ({
  Turn: t.turn,
  Prompt: t.prompt.slice(0, 35) + '...',
  'Tools Kept': t.toolsKept,
  'Sections Kept': t.sectionsKept,
  Baseline: t.baselineTokens,
  'With TS': t.actualTokens,
  Saved: t.savedTokens,
  'Red%': `${t.reductionPct}%`,
  'Time(ms)': t.hookMs,
})));
console.log(`Extreme Total: Baseline=${extremeRun.totalBaseline} | TS=${extremeRun.totalActual} | Saved=${extremeRun.totalSaved} (${extremeRun.overallReduction}%)`);
