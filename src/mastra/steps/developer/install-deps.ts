import { createStep } from '@mastra/core/workflows';
import { installProjectDependencies } from '../../../utils/exec.js';
import { createLogger } from '../../../utils/logger.js';
import { getWorktreePath, runInWorktree } from '../../../utils/worktree-context.js';
import {
  developerBranchOutputSchema,
  developerInstallDepsOutputSchema,
} from '../../workflows/developer.workflow.types.js';

const log = createLogger('install-deps-step');

export const installDepsStep = createStep({
  id: 'install-deps',
  inputSchema: developerBranchOutputSchema,
  outputSchema: developerInstallDepsOutputSchema,
  execute: async ({ inputData }) => {
    const worktreePath = getWorktreePath(inputData.branchName);

    const installResult = await runInWorktree(worktreePath, async () =>
      installProjectDependencies(worktreePath)
    );

    log.info(
      {
        taskIdentifier: inputData.taskIdentifier,
        command: installResult.command,
        skipped: installResult.skipped,
        exitCode: installResult.exitCode,
      },
      installResult.skipped ? 'Dependencies install skipped' : 'Dependencies installed'
    );

    return { ...inputData, installResult };
  },
});
