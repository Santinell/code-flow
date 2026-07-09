import type { EvalLanguage } from './developer-evals';
import { runEvals } from '@mastra/core/evals';
import { execa } from 'execa';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnv } from '#config/env';
import {
  architectNodejsDataset,
  architectPythonDataset,
  type ArchitectDatasetItem,
} from '#evals/datasets/architect.dataset';
import { architectScorerRegistry, setGroundTruthData } from '#evals/scorers/index';
import { createTokenUsageTracker } from '#evals/utils/token-usage';
import { wrapAgent } from '#evals/utils/wrap-agent';
import { applyPatch, commitFiles, initGitRepo, stageAllFiles } from '#integrations/git';
import { architectAgent } from '#mastra/agents/architect-agent';
import { architectGenerateOutputSchema } from '#mastra/workflows/architect-workflow.types';
import { installProjectDependencies } from '#utils/exec';
import { createLogger } from '#utils/logger';

export const log = createLogger('architect-eval');
export const env = getEnv();
export const ARCHITECT_SANDBOX_PREFIX = 'architect-sandbox-';

interface ArchitectLanguageConfig {
  /** Имя поддиректории в eval-fixtures/ */
  fixtureDir: string;
  /** Патч-файл, добавляющий веб-структуру (компоненты/роуты/сервисы) */
  patchFile: string;
  /** Датасет требований для этого языка */
  dataset: ArchitectDatasetItem[];
}

const LANGUAGE_CONFIGS: Record<EvalLanguage, ArchitectLanguageConfig> = {
  node: {
    fixtureDir: 'project-nodejs',
    patchFile: 'architect-nodejs-sandbox.patch',
    dataset: architectNodejsDataset,
  },
  python: {
    fixtureDir: 'project-python',
    patchFile: 'architect-python-sandbox.patch',
    dataset: architectPythonDataset,
  },
};

async function setupSandbox(lang: EvalLanguage): Promise<string> {
  const config = LANGUAGE_CONFIGS[lang];
  const fixturePath = path.join(
    import.meta.dirname,
    `../../../../../eval-fixtures/${config.fixtureDir}`
  );
  const sandboxPath = path.join(os.tmpdir(), `${ARCHITECT_SANDBOX_PREFIX}${lang}-${Date.now()}`);

  log.info({ lang, fixturePath, sandboxPath }, 'Creating eval sandbox from fixture');

  await execa('cp', ['-a', fixturePath, sandboxPath]);

  // Ставим зависимости тем же путём, что и в проде (installDepsStep).
  // Для Node это pnpm/npm install, для Python — uv sync.
  const installResult = await installProjectDependencies(sandboxPath);
  if (!installResult.passed) {
    throw new Error(
      `Sandbox dependency install failed: ${installResult.command}\n${installResult.stderr}`
    );
  }

  const patchPath = path.join(import.meta.dirname, `../../fixtures/${config.patchFile}`);
  await initGitRepo(sandboxPath);
  await applyPatch(sandboxPath, patchPath);
  await stageAllFiles(sandboxPath);
  await commitFiles(sandboxPath, 'eval-fixture');

  log.info({ lang, sandboxPath }, 'Eval sandbox ready');
  return sandboxPath;
}

function teardownEvalSandbox(sandboxPath: string): void {
  log.info({ sandboxPath }, 'Tearing down eval sandbox');
  fs.rmSync(sandboxPath, { recursive: true, force: true });
}

export type ScoreValue = string | number | boolean | null | undefined;
export type ScoreResult = {
  score?: ScoreValue;
  result?: ScoreValue;
  value?: ScoreValue;
};
export type ScoreResultGroup = Record<string, ScoreResult>;
export type ScorerResultsForLog = ScoreResultGroup & {
  agent?: ScoreResultGroup;
};

export function formatDuration(startedAt: number): string {
  const elapsedMs = Date.now() - startedAt;
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

export function getScoreValue(result: ScoreResult): string {
  const score = result.score ?? result.result ?? result.value;
  return typeof score === 'number' ? score.toFixed(2) : String(score ?? 'n/a');
}

export function formatScorerResults(scorerResults: ScorerResultsForLog): string {
  const resultGroup = scorerResults.agent ?? scorerResults;
  const summary = Object.entries(resultGroup)
    .map(([name, result]) => `${name}=${getScoreValue(result)}`)
    .join(', ');

  return summary || 'no scorer results';
}

export async function runArchitectAgentEvals(lang: EvalLanguage) {
  const config = LANGUAGE_CONFIGS[lang];
  const dataset = config.dataset;

  // Initialize ground truth data for scorers
  setGroundTruthData(dataset);

  const worktreePath = await setupSandbox(lang);

  const tokenUsage = createTokenUsageTracker();
  const totalItems = dataset.length;
  const scorerNames = Object.keys(architectScorerRegistry);
  const concurrency = env.MAX_CONCURRENT_EVAL;
  const itemLabelsByInput = new Map(dataset.map((item) => [item.input, item.id]));
  const startedAt = Date.now();
  let completedItems = 0;

  console.log(
    `[architect:${lang}] Starting evals: ${totalItems} items, ${scorerNames.length} scorers, concurrency=${concurrency}`
  );
  console.log(`[architect:${lang}] Scorers: ${scorerNames.join(', ')}`);

  const heartbeat = setInterval(() => {
    const runningItems = Math.min(concurrency, totalItems - completedItems);
    const avgItemWallTime =
      completedItems > 0
        ? `${Math.round((Date.now() - startedAt) / completedItems / 1000)}s`
        : 'n/a';
    console.log(
      `[architect:${lang}] Still running: ${completedItems}/${totalItems} complete, ~${runningItems} in flight, avg wall/item ${avgItemWallTime}, elapsed ${formatDuration(startedAt)}`
    );
  }, 30_000);

  const wrappedArchitectAgent = wrapAgent(architectAgent, {
    retryOptions: {
      maxAttempts: 3,
      schema: architectGenerateOutputSchema,
    },
    getWorktreePath: () => worktreePath,
  });

  try {
    const result = await runEvals({
      target: wrappedArchitectAgent,
      data: dataset,
      scorers: {
        agent: Object.values(architectScorerRegistry),
      },
      targetOptions: {
        modelSettings: {
          temperature: 0,
          maxRetries: 3,
          maxOutputTokens: env.MAX_OUTPUT_TOKENS_ARCHITECT,
        },
        structuredOutput: {
          schema: architectGenerateOutputSchema,
          errorStrategy: 'warn',
        },
      },
      concurrency,
      onItemComplete: async ({ item, targetResult, scorerResults }) => {
        completedItems++;
        const callbackStartedAt = Date.now();
        const inputLabel =
          typeof item.input === 'string' ? item.input.slice(0, 60) : 'unknown-item';
        const label =
          typeof item.input === 'string'
            ? (itemLabelsByInput.get(item.input) ?? inputLabel)
            : inputLabel;
        const parsedOutput = architectGenerateOutputSchema.safeParse(targetResult.object);
        const outputSummary = parsedOutput.success
          ? `needsClarification=${parsedOutput.data.needsClarification}, tasks=${parsedOutput.data.tasks.length}, message="${parsedOutput.data.message.replace(/\s+/g, ' ')}"`
          : `text="${targetResult.text.replace(/\s+/g, ' ')}"`;
        tokenUsage.record(targetResult);

        console.log(
          `\n[architect:${lang}] Completed ${completedItems}/${totalItems}: ${label} (${formatDuration(startedAt)} elapsed)`
        );
        console.log(`[architect:${lang}:${label}] output: ${outputSummary}`);
        console.log(`[architect:${lang}:${label}] scores: ${formatScorerResults(scorerResults)}`);
        if (parsedOutput.success && parsedOutput.data.tasks.length > 0) {
          console.log(`[architect:${lang}:${label}] tasks:`);
          for (const task of parsedOutput.data.tasks) {
            console.log(`  --- ${task.title} (priority ${task.priority}) ---`);
            console.log(task.description);
          }
        }
        console.log(
          `[architect:${lang}:${label}] callback logged in ${Date.now() - callbackStartedAt}ms`
        );
      },
    }).finally(() => {
      clearInterval(heartbeat);
    });

    console.log(`\nArchitect (${lang}) average scores:`);
    console.log(JSON.stringify(result.scores, null, 2));
    console.log(`\nArchitect (${lang}) token usage:`);
    console.log(JSON.stringify(tokenUsage.getStats(), null, 2));
    console.log(
      `Processed ${result.summary.totalItems} architect (${lang}) eval items in ${formatDuration(startedAt)}`
    );

    return result;
  } finally {
    teardownEvalSandbox(worktreePath);
  }
}
