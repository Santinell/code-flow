import { runEvals } from '@mastra/core/evals';
import { execa } from 'execa';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getEnv } from '../../../../config/env.js';
import {
  applyPatch,
  commitFiles,
  initGitRepo,
  stageAllFiles,
} from '../../../../integrations/git.js';
import { createLogger } from '../../../../utils/logger.js';
import { runInWorktree } from '../../../../utils/worktree-context.js';
import { architectAgent } from '../../../agents/architect.agent.js';
import { architectGenerateOutputSchema } from '../../../workflows/architect.workflow.types.js';
import { architectDataset } from '../../datasets/architect.dataset.js';
import { architectScorers, setGroundTruthData } from '../../scorers/index.js';
import { withGenerateRetry } from '../../utils/retry-agent.js';

export const log = createLogger('architect-eval');
export const env = getEnv();
export const ARCHITECT_SANDBOX_PREFIX = 'architect-sandbox-';

async function setupEvalWorktree(): Promise<string> {
  const fixturePath = path.join(import.meta.dirname, '../../../../../eval-fixtures/project');
  const sandboxPath = path.join(os.tmpdir(), `${ARCHITECT_SANDBOX_PREFIX}${Date.now()}`);

  log.info({ fixturePath, sandboxPath }, 'Creating eval sandbox from fixture');

  await execa('cp', ['-a', fixturePath, sandboxPath]);

  const agentNodeModules = path.join(import.meta.dirname, '../../../../../node_modules');
  const sandboxNodeModules = path.join(sandboxPath, 'node_modules');
  if (fs.existsSync(agentNodeModules) && !fs.existsSync(sandboxNodeModules)) {
    fs.symlinkSync(agentNodeModules, sandboxNodeModules);
  }

  const patchPath = path.join(import.meta.dirname, '../../fixtures/architect-sandbox.patch');
  await initGitRepo(sandboxPath);
  await applyPatch(sandboxPath, patchPath);
  await stageAllFiles(sandboxPath);
  await commitFiles(sandboxPath, 'eval-fixture');

  log.info({ sandboxPath }, 'Eval sandbox ready');
  return sandboxPath;
}

function teardownEvalWorktree(sandboxPath: string): void {
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

export async function runArchitectAgentEvals() {
  // Initialize ground truth data for scorers
  setGroundTruthData(architectDataset);

  const worktreePath = await setupEvalWorktree();

  const totalItems = architectDataset.length;
  const scorerNames = Object.keys(architectScorers);
  const concurrency = env.MAX_CONCURRENT_EVAL;
  const itemLabelsByInput = new Map(architectDataset.map((item) => [item.input, item.id]));
  const startedAt = Date.now();
  let completedItems = 0;

  console.log(
    `[architect] Starting evals: ${totalItems} items, ${scorerNames.length} scorers, concurrency=${concurrency}`
  );
  console.log(`[architect] Scorers: ${scorerNames.join(', ')}`);

  const heartbeat = setInterval(() => {
    const runningItems = Math.min(concurrency, totalItems - completedItems);
    const avgItemWallTime =
      completedItems > 0
        ? `${Math.round((Date.now() - startedAt) / completedItems / 1000)}s`
        : 'n/a';
    console.log(
      `[architect] Still running: ${completedItems}/${totalItems} complete, ~${runningItems} in flight, avg wall/item ${avgItemWallTime}, elapsed ${formatDuration(startedAt)}`
    );
  }, 30_000);

  const retryingArchitectAgent = withGenerateRetry(architectAgent, {
    maxAttempts: 3,
    shouldRetry: (result) => {
      const text = result.text?.trim() ?? '';
      if (text.length === 0) {
        return true;
      }
      const parsed = architectGenerateOutputSchema.safeParse(result.object);
      return !parsed.success;
    },
  });

  try {
    const result = await runInWorktree(worktreePath, () =>
      runEvals({
        target: retryingArchitectAgent,
        data: architectDataset,
        scorers: {
          agent: Object.values(architectScorers).map((entry) => entry.scorer),
        },
        targetOptions: {
          modelSettings: {
            temperature: 0,
            maxRetries: 3,
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

          console.log(
            `\n[architect] Completed ${completedItems}/${totalItems}: ${label} (${formatDuration(startedAt)} elapsed)`
          );
          console.log(`[architect:${label}] output: ${outputSummary}`);
          console.log(`[architect:${label}] scores: ${formatScorerResults(scorerResults)}`);
          if (parsedOutput.success && parsedOutput.data.tasks.length > 0) {
            console.log(`[architect:${label}] tasks:`);
            for (const task of parsedOutput.data.tasks) {
              console.log(`  --- ${task.title} (priority ${task.priority}) ---`);
              console.log(task.description);
            }
          }
          console.log(
            `[architect:${label}] callback logged in ${Date.now() - callbackStartedAt}ms`
          );
        },
      })
    ).finally(() => {
      clearInterval(heartbeat);
    });

    console.log('\nArchitect average scores:');
    console.log(JSON.stringify(result.scores, null, 2));
    console.log(
      `Processed ${result.summary.totalItems} architect eval items in ${formatDuration(startedAt)}`
    );

    return result;
  } finally {
    teardownEvalWorktree(worktreePath);
  }
}
