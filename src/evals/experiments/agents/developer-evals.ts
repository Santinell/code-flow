import { runEvals } from '@mastra/core/evals';
import { execa } from 'execa';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnv } from '#config/env';
import { developerDataset } from '#evals/datasets/developer-nodejs.dataset';
import { developerPythonDataset } from '#evals/datasets/developer-python.dataset';
import { developerScorerRegistry, trajectoryScorerRegistry } from '#evals/scorers/index';
import { getEvalSandboxPath, withEvalSandboxRequestContext } from '#evals/utils/sandbox-context';
import { createTokenUsageTracker } from '#evals/utils/token-usage';
import { wrapAgent } from '#evals/utils/wrap-agent';
import { wrapScorer } from '#evals/utils/wrap-scorer';
import { commitFiles, initGitRepo, stageAllFiles } from '#integrations/git';
import { developerAgent } from '#mastra/agents/developer-agent';
import { installProjectDependencies, runProjectTests } from '#utils/exec';
import { createLogger } from '#utils/logger';

export const log = createLogger('developer-eval');
export const env = getEnv();
export const DEVELOPER_SANDBOX_PREFIX = 'developer-sandbox-';

export type EvalLanguage = 'node' | 'python';

interface LanguageConfig {
  /** Имя поддиректории в eval-fixtures/ */
  fixtureDir: string;
  /** Датасет для этого языка */
  dataset: typeof developerDataset;
}

const LANGUAGE_CONFIGS: Record<EvalLanguage, LanguageConfig> = {
  node: {
    fixtureDir: 'project-nodejs',
    dataset: developerDataset,
  },
  python: {
    fixtureDir: 'project-python',
    dataset: developerPythonDataset,
  },
};

async function setupSandbox(lang: EvalLanguage): Promise<string> {
  const config = LANGUAGE_CONFIGS[lang];
  const fixturePath = path.join(
    import.meta.dirname,
    `../../../../../eval-fixtures/${config.fixtureDir}`
  );
  const sandboxPath = path.join(os.tmpdir(), `${DEVELOPER_SANDBOX_PREFIX}${lang}-${Date.now()}`);

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

  await initGitRepo(sandboxPath);
  await stageAllFiles(sandboxPath);
  await commitFiles(sandboxPath, 'eval-fixture');

  log.info({ lang, sandboxPath }, 'Eval sandbox ready');
  return sandboxPath;
}

function teardownEvalSandbox(sandboxPath: string): void {
  log.info({ sandboxPath }, 'Tearing down eval sandbox');
  fs.rmSync(sandboxPath, { recursive: true, force: true });
}

function createItemSandboxPath(lang: EvalLanguage, itemId: string): string {
  const safeItemId = itemId.replace(/[^a-zA-Z0-9._-]/g, '-');
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(os.tmpdir(), `${DEVELOPER_SANDBOX_PREFIX}${lang}-${safeItemId}-${uniqueSuffix}`);
}

async function cloneSandboxForItem(
  baseSandboxPath: string,
  lang: EvalLanguage,
  itemId: string
): Promise<string> {
  const sandboxPath = createItemSandboxPath(lang, itemId);
  log.info({ lang, itemId, baseSandboxPath, sandboxPath }, 'Cloning eval sandbox for item');
  await execa('cp', ['-a', baseSandboxPath, sandboxPath]);
  return sandboxPath;
}

function teardownTrackedSandbox(sandboxPath: string, sandboxes: Set<string>): void {
  teardownEvalSandbox(sandboxPath);
  sandboxes.delete(sandboxPath);
}

export async function runDeveloperAgentEvals(lang: EvalLanguage) {
  const config = LANGUAGE_CONFIGS[lang];
  const dataset = config.dataset;
  const baseWorktreePath = await setupSandbox(lang);
  const itemSandboxes = new Set<string>();
  const tokenUsage = createTokenUsageTracker();
  const concurrency = env.MAX_CONCURRENT_EVAL;

  let result;
  try {
    const preparedDataset = await Promise.all(
      dataset.map(async (item) => {
        const sandboxPath = await cloneSandboxForItem(baseWorktreePath, lang, item.id);
        itemSandboxes.add(sandboxPath);
        return withEvalSandboxRequestContext(item, sandboxPath);
      })
    );

    console.log(
      `[developer:${lang}] Starting evals: ${dataset.length} items, concurrency=${concurrency}`
    );

    result = await runEvals({
      target: wrapAgent(developerAgent, { getWorktreePath: getEvalSandboxPath }),
      data: preparedDataset,
      scorers: {
        agent: Object.values(developerScorerRegistry).map((scorer) =>
          wrapScorer(scorer, { maxAttempts: 3, getWorktreePath: getEvalSandboxPath })
        ),
        trajectory: Object.values(trajectoryScorerRegistry).map((scorer) =>
          wrapScorer(scorer, { getWorktreePath: getEvalSandboxPath })
        ),
      },
      targetOptions: {
        modelSettings: {
          temperature: 0,
          maxRetries: 3,
          maxOutputTokens: env.MAX_OUTPUT_TOKENS_DEVELOPER,
        },
      },
      concurrency,
      onItemComplete: async ({ item, targetResult, scorerResults }) => {
        const taskLabel = item.groundTruth?.taskTitle ?? item.input.slice(0, 60);
        console.log(`[developer:${lang}] ${taskLabel}...`);
        console.log(JSON.stringify(scorerResults.agent ?? scorerResults, null, 2));
        if (scorerResults.trajectory) {
          console.log(JSON.stringify(scorerResults.trajectory, null, 2));
        }
        tokenUsage.record(targetResult);

        const sandboxPath = getEvalSandboxPath(item.requestContext);
        if (sandboxPath) {
          teardownTrackedSandbox(sandboxPath, itemSandboxes);
        }
      },
    });
  } finally {
    const testTasks = dataset.filter((d) => d.groundTruth?.mustRunTests);
    if (testTasks.length > 0) {
      const testResult = await runProjectTests(baseWorktreePath);
      console.log(
        `\n[post-eval tests:${lang}] ${testTasks.length} tasks require tests: ${testResult.passed ? 'PASS' : 'FAIL'}`
      );
      if (!testResult.passed) {
        const output = `exit=${testResult.exitCode}\nstdout:\n${testResult.stdout.slice(-500)}\nstderr:\n${testResult.stderr.slice(-500)}`;
        console.log(output);
      }
    }

    for (const sandboxPath of itemSandboxes) {
      teardownTrackedSandbox(sandboxPath, itemSandboxes);
    }
    teardownEvalSandbox(baseWorktreePath);
  }

  console.log(`\nDeveloper (${lang}) average scores:`);
  console.log(JSON.stringify(result.scores, null, 2));
  console.log(`\nDeveloper (${lang}) token usage:`);
  console.log(JSON.stringify(tokenUsage.getStats(), null, 2));
  console.log(`Processed ${result.summary.totalItems} developer (${lang}) eval items`);

  return result;
}
