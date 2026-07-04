import type { EvalLanguage } from './developer-evals.js';
import { runEvals } from '@mastra/core/evals';
import { execa } from 'execa';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnv } from '../../../../config/env.js';
import {
  applyPatch,
  commitFiles,
  initGitRepo,
  stageAllFiles,
} from '../../../../integrations/git.js';
import { createLogger } from '../../../../utils/logger.js';
import { reviewerAgent } from '../../../agents/reviewer.agent.js';
import { reviewerGenerateOutputSchema } from '../../../workflows/reviewer.workflow.types.js';
import { reviewerDataset } from '../../datasets/reviewer-nodejs.dataset.js';
import {
  ReviewerDatasetItem,
  reviewerPythonDataset,
} from '../../datasets/reviewer-python.dataset.js';
import { reviewerScorers } from '../../scorers/index.js';
import {
  getEvalSandboxPath,
  withEvalSandboxRequestContext,
} from '../../utils/sandbox-context.js';
import { createTokenUsageTracker } from '../../utils/token-usage.js';
import { wrapAgent } from '../../utils/wrap-agent.js';
import { wrapScorer } from '../../utils/wrap-scorer.js';

export const log = createLogger('reviewer-eval');
export const env = getEnv();
export const REVIEWER_SANDBOX_PREFIX = 'reviewer-sandbox-';

interface ReviewerLanguageConfig {
  /** Имя поддиректории в eval-fixtures/ */
  fixtureDir: string;
  /** Патч-файл для создания базовых файлов, упоминаемых в диффах */
  patchFile: string;
  /** Датасет для этого языка */
  dataset: ReviewerDatasetItem[];
}

const LANGUAGE_CONFIGS: Record<EvalLanguage, ReviewerLanguageConfig> = {
  node: {
    fixtureDir: 'project-nodejs',
    patchFile: 'reviewer-nodejs-sandbox.patch',
    dataset: reviewerDataset,
  },
  python: {
    fixtureDir: 'project-python',
    patchFile: 'reviewer-python-sandbox.patch',
    dataset: reviewerPythonDataset,
  },
};

async function setupSandbox(lang: EvalLanguage): Promise<string> {
  const config = LANGUAGE_CONFIGS[lang];
  const fixturePath = path.join(
    import.meta.dirname,
    `../../../../../eval-fixtures/${config.fixtureDir}`
  );
  const sandboxPath = path.join(os.tmpdir(), `${REVIEWER_SANDBOX_PREFIX}${lang}-${Date.now()}`);

  log.info({ lang, fixturePath, sandboxPath }, 'Creating reviewer eval sandbox');

  await execa('cp', ['-a', fixturePath, sandboxPath]);

  const patchPath = path.join(import.meta.dirname, `../../fixtures/${config.patchFile}`);
  await initGitRepo(sandboxPath);
  await applyPatch(sandboxPath, patchPath);
  await stageAllFiles(sandboxPath);
  await commitFiles(sandboxPath, 'eval-fixture');

  log.info({ lang, sandboxPath }, 'Reviewer eval sandbox ready');
  return sandboxPath;
}

function teardownEvalSandbox(sandboxPath: string): void {
  log.info({ sandboxPath }, 'Tearing down reviewer eval sandbox');
  fs.rmSync(sandboxPath, { recursive: true, force: true });
}

function createItemSandboxPath(lang: EvalLanguage, itemId: string): string {
  const safeItemId = itemId.replace(/[^a-zA-Z0-9._-]/g, '-');
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(os.tmpdir(), `${REVIEWER_SANDBOX_PREFIX}${lang}-${safeItemId}-${uniqueSuffix}`);
}

async function cloneSandboxForItem(
  baseSandboxPath: string,
  lang: EvalLanguage,
  item: ReviewerDatasetItem
): Promise<string> {
  const sandboxPath = createItemSandboxPath(lang, item.id);
  log.info(
    { lang, itemId: item.id, baseSandboxPath, sandboxPath },
    'Cloning reviewer eval sandbox'
  );
  await execa('cp', ['-a', baseSandboxPath, sandboxPath]);
  await applyReviewerItemFiles(sandboxPath, item);
  return sandboxPath;
}

function teardownTrackedSandbox(sandboxPath: string, sandboxes: Set<string>): void {
  teardownEvalSandbox(sandboxPath);
  sandboxes.delete(sandboxPath);
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

export async function runReviewerAgentEvals(lang: EvalLanguage) {
  const config = LANGUAGE_CONFIGS[lang];
  const dataset = config.dataset;
  const baseWorktreePath = await setupSandbox(lang);
  const itemSandboxes = new Set<string>();
  const tokenUsage = createTokenUsageTracker();
  const concurrency = env.MAX_CONCURRENT_EVAL;

  const wrappedReviewerAgent = wrapAgent(reviewerAgent, {
    retryOptions: {
      maxAttempts: 3,
      schema: reviewerGenerateOutputSchema,
    },
    getWorktreePath: getEvalSandboxPath,
  });

  try {
    const preparedDataset = await Promise.all(
      dataset.map(async (item) => {
        const sandboxPath = await cloneSandboxForItem(baseWorktreePath, lang, item);
        itemSandboxes.add(sandboxPath);
        return withEvalSandboxRequestContext(item, sandboxPath);
      })
    );

    console.log(
      `[reviewer:${lang}] Starting evals: ${dataset.length} items, concurrency=${concurrency}`
    );

    const result = await runEvals({
      target: wrappedReviewerAgent,
      data: preparedDataset,
      scorers: {
        agent: Object.values(reviewerScorers).map((entry) =>
          wrapScorer(entry.scorer, { getWorktreePath: getEvalSandboxPath })
        ),
      },
      targetOptions: {
        structuredOutput: {
          schema: reviewerGenerateOutputSchema,
          errorStrategy: 'warn',
        },
        modelSettings: {
          temperature: 0,
          maxRetries: 3,
          maxOutputTokens: env.MAX_OUTPUT_TOKENS_REVIEWER,
        },
      },
      concurrency,
      onItemComplete: async ({ item: completedItem, targetResult, scorerResults }) => {
        console.log(
          `[reviewer:${lang}:${completedItem.groundTruth?.expectedVerdict}] ${completedItem.input.slice(0, 80)}...`
        );
        console.log(JSON.stringify(scorerResults.agent ?? scorerResults, null, 2));
        tokenUsage.record(targetResult);

        const sandboxPath = getEvalSandboxPath(completedItem.requestContext);
        if (sandboxPath) {
          teardownTrackedSandbox(sandboxPath, itemSandboxes);
        }
      },
    });

    console.log(`\nReviewer (${lang}) average scores:`);
    console.log(JSON.stringify(result.scores, null, 2));
    console.log(`\nReviewer (${lang}) token usage:`);
    console.log(JSON.stringify(tokenUsage.getStats(), null, 2));
    console.log(`Processed ${result.summary.totalItems} reviewer (${lang}) eval items`);

    return { processed: result.summary.totalItems };
  } finally {
    for (const sandboxPath of itemSandboxes) {
      teardownTrackedSandbox(sandboxPath, itemSandboxes);
    }
    teardownEvalSandbox(baseWorktreePath);
  }
}
