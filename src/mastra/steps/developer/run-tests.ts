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

    const result = await runInWorktree(worktreePath, async () => {
      const r = await runProjectTests(worktreePath);

      return {
        testResult: {
          stdout: r.stdout,
          stderr: r.stderr,
          exitCode: r.exitCode,
        },
        usedCommand: r.command,
      };
    });

    log.info(
      {
        taskIdentifier: inputData.taskIdentifier,
        command: result.usedCommand,
        exitCode: result.testResult.exitCode,
      },
      'Tests executed'
    );

    return {
      ...inputData,
      testResult: {
        command: result.usedCommand,
        ...result.testResult,
        passed: result.testResult.exitCode === 0,
      },
    };
  },
});
