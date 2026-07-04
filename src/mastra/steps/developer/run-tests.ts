import { createStep } from '@mastra/core/workflows';
import { runProjectTests } from '../../../utils/exec.js';
import { createLogger } from '../../../utils/logger.js';
import { getWorktreePath, runInWorktree } from '../../../utils/worktree-context.js';
import {
  developerImplementationOutputSchema,
  developerRunTestsOutputSchema,
} from '../../workflows/developer.workflow.types.js';

const log = createLogger('run-tests-step');

export const runTestsStep = createStep({
  id: 'run-tests',
  inputSchema: developerImplementationOutputSchema,
  outputSchema: developerRunTestsOutputSchema,
  execute: async ({ inputData }) => {
    const worktreePath = getWorktreePath(inputData.branchName);

    const testResult = await runInWorktree(worktreePath, async () => runProjectTests(worktreePath));

    log.info(
      {
        taskIdentifier: inputData.taskIdentifier,
        command: testResult.command,
        exitCode: testResult.exitCode,
      },
      'Tests executed'
    );

    return {
      ...inputData,
      testResult,
    };
  },
});
