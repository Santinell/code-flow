import { runEvals } from '@mastra/core/evals';
import { execa } from 'execa';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getEnv } from '../../../../config/env.js';
import {
  applyPatch,
  cleanForce,
  commitFiles,
  initGitRepo,
  resetHard,
  stageAllFiles,
} from '../../../../integrations/git.js';
import { createLogger } from '../../../../utils/logger.js';
import { runInWorktree } from '../../../../utils/worktree-context.js';
import { reviewerAgent } from '../../../agents/reviewer.agent.js';
import { reviewerGenerateOutputSchema } from '../../../workflows/reviewer.workflow.types.js';
import { ReviewerDatasetItem, reviewerDataset } from '../../datasets/reviewer.dataset.js';
import { reviewerScorers } from '../../scorers/index.js';

export const log = createLogger('reviewer-eval');
export const REVIEWER_SANDBOX_PREFIX = 'reviewer-sandbox-';
export const env = getEnv();

async function setupReviewerSandbox(): Promise<string> {
  const fixturePath = path.join(import.meta.dirname, '../../../../../eval-fixtures/project');
  const sandboxPath = path.join(os.tmpdir(), `${REVIEWER_SANDBOX_PREFIX}${Date.now()}`);

  log.info({ fixturePath, sandboxPath }, 'Creating reviewer eval sandbox from fixture');

  await execa('cp', ['-a', fixturePath, sandboxPath]);

  const patchPath = path.join(import.meta.dirname, '../../fixtures/reviewer-sandbox.patch');
  await initGitRepo(sandboxPath);
  await applyPatch(sandboxPath, patchPath);
  await stageAllFiles(sandboxPath);
  await commitFiles(sandboxPath, 'eval-fixture');

  log.info({ sandboxPath }, 'Reviewer eval sandbox ready');
  return sandboxPath;
}

function teardownReviewerSandbox(sandboxPath: string): void {
  log.info({ sandboxPath }, 'Tearing down reviewer eval sandbox');
  fs.rmSync(sandboxPath, { recursive: true, force: true });
}

async function applyReviewerItemFiles(
  worktreePath: string,
  item: ReviewerDatasetItem
): Promise<void> {
  const beforeFiles = item.groundTruth?.beforeFiles;
  if (beforeFiles) {
    for (const [relPath, content] of Object.entries(beforeFiles)) {
      const fullPath = path.join(worktreePath, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
    await stageAllFiles(worktreePath);
    await commitFiles(worktreePath, `before-${item.id}`);
  }

  const afterFiles = item.groundTruth?.afterFiles;
  if (afterFiles) {
    for (const [relPath, content] of Object.entries(afterFiles)) {
      const fullPath = path.join(worktreePath, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  }
}

async function resetReviewerSandbox(worktreePath: string, hasBeforeFiles: boolean): Promise<void> {
  await resetHard(worktreePath);
  await cleanForce(worktreePath);

  if (hasBeforeFiles) {
    await resetHard(worktreePath, 'HEAD~1');
  }
}

export async function runReviewerAgentEvals() {
  const worktreePath = await setupReviewerSandbox();

  let nextIndex = 0;

  async function setupNextItem() {
    if (nextIndex < reviewerDataset.length) {
      await applyReviewerItemFiles(worktreePath, reviewerDataset[nextIndex]);
    }
  }

  await setupNextItem();
  nextIndex++;

  try {
    const result = await runInWorktree(worktreePath, async () => {
      return runEvals({
        target: reviewerAgent,
        data: reviewerDataset,
        scorers: {
          agent: Object.values(reviewerScorers).map((entry) => entry.scorer),
        },
        targetOptions: {
          structuredOutput: {
            schema: reviewerGenerateOutputSchema,
            errorStrategy: 'warn',
          },
          modelSettings: {
            temperature: 0,
            maxRetries: 3,
          },
        },
        concurrency: 1,
        onItemComplete: async ({ item: completedItem, scorerResults }) => {
          console.log(
            `[reviewer:${completedItem.groundTruth?.expectedVerdict}] ${completedItem.input.slice(0, 80)}...`
          );
          console.log(JSON.stringify(scorerResults.agent ?? scorerResults, null, 2));
          try {
            await resetReviewerSandbox(worktreePath, !!completedItem.groundTruth?.beforeFiles);
            await setupNextItem();
            nextIndex++;
          } catch (err) {
            console.error(`[reviewer] Failed to setup next sandbox after item:`, err);
          }
        },
      });
    });

    console.log('\nReviewer average scores:');
    console.log(JSON.stringify(result.scores, null, 2));
    console.log(`Processed ${result.summary.totalItems} reviewer eval items`);

    return { processed: result.summary.totalItems };
  } finally {
    teardownReviewerSandbox(worktreePath);
  }
}
