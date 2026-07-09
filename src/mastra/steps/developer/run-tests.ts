import { createStep } from '@mastra/core/workflows';
import {
  developerImplementationOutputSchema,
  developerRunTestsOutputSchema,
} from '#mastra/workflows/developer-workflow.types';
import { runProjectTests } from '#utils/exec';
import { createLogger } from '#utils/logger';
import { getWorktreePath, runInWorktree } from '#utils/worktree-context';

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
