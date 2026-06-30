import { runEvals } from '@mastra/core/evals';
import { execa } from 'execa';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getEnv } from '../../../../config/env.js';
import {
  cleanForce,
  commitFiles,
  initGitRepo,
  resetHard,
  stageAllFiles,
} from '../../../../integrations/git.js';
import { runProjectTests } from '../../../../utils/exec.js';
import { createLogger } from '../../../../utils/logger.js';
import { runInWorktree } from '../../../../utils/worktree-context.js';
import { developerAgent } from '../../../agents/developer.agent.js';
import { developerDataset } from '../../datasets/developer.dataset.js';
import { developerScorers, trajectoryScorers } from '../../scorers/index.js';

export const log = createLogger('developer-eval');
export const env = getEnv();
export const DEVELOPER_SANDBOX_PREFIX = 'developer-sandbox-';

async function setupEvalWorktree(): Promise<string> {
  const fixturePath = path.join(import.meta.dirname, '../../../../../eval-fixtures/project');
  const sandboxPath = path.join(os.tmpdir(), `${DEVELOPER_SANDBOX_PREFIX}${Date.now()}`);

  log.info({ fixturePath, sandboxPath }, 'Creating eval sandbox from fixture');

  await execa('cp', ['-a', fixturePath, sandboxPath]);

  const agentNodeModules = path.join(import.meta.dirname, '../../../../../node_modules');
  const sandboxNodeModules = path.join(sandboxPath, 'node_modules');
  if (fs.existsSync(agentNodeModules) && !fs.existsSync(sandboxNodeModules)) {
    fs.symlinkSync(agentNodeModules, sandboxNodeModules);
  }

  await initGitRepo(sandboxPath);
  await stageAllFiles(sandboxPath);
  await commitFiles(sandboxPath, 'eval-fixture');

  log.info({ sandboxPath }, 'Eval sandbox ready');
  return sandboxPath;
}

function teardownEvalWorktree(sandboxPath: string): void {
  log.info({ sandboxPath }, 'Tearing down eval sandbox');
  fs.rmSync(sandboxPath, { recursive: true, force: true });
}

export async function runDeveloperAgentEvals() {
  const worktreePath = await setupEvalWorktree();

  let result;
  try {
    result = await runInWorktree(worktreePath, async () => {
      return runEvals({
        target: developerAgent,
        data: developerDataset,
        scorers: {
          agent: Object.values(developerScorers).map((entry) => entry.scorer),
          trajectory: Object.values(trajectoryScorers).map((entry) => entry.scorer),
        },
        targetOptions: {
          modelSettings: {
            temperature: 0,
            maxRetries: 3,
          },
        },
        concurrency: 1,
        onItemComplete: async ({ item, scorerResults }) => {
          const taskLabel = item.groundTruth?.taskTitle ?? item.input.slice(0, 60);
          console.log(`[developer] ${taskLabel}...`);
          console.log(JSON.stringify(scorerResults.agent ?? scorerResults, null, 2));
          if (scorerResults.trajectory) {
            console.log(JSON.stringify(scorerResults.trajectory, null, 2));
          }
          await resetHard(worktreePath);
          await cleanForce(worktreePath);
        },
      });
    });
  } finally {
    const testTasks = developerDataset.filter((d) => d.groundTruth?.mustRunTests);
    if (testTasks.length > 0) {
      const testResult = await runProjectTests(worktreePath);
      console.log(
        `\n[post-eval tests] ${testTasks.length} tasks require tests: ${testResult.passed ? 'PASS' : 'FAIL'}`
      );
      if (!testResult.passed) {
        const output = `exit=${testResult.exitCode}\nstdout:\n${testResult.stdout.slice(-500)}\nstderr:\n${testResult.stderr.slice(-500)}`;
        console.log(output);
      }
    }
    await teardownEvalWorktree(worktreePath);
  }

  console.log('\nDeveloper average scores:');
  console.log(JSON.stringify(result.scores, null, 2));
  console.log(`Processed ${result.summary.totalItems} developer eval items`);

  return result;
}
