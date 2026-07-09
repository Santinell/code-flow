import { createStep } from '@mastra/core/workflows';
import {
  developerImplementationOutputSchema,
  developerRunTestsOutputSchema,
} from '#mastra/workflows/developer-workflow.types';
import { validateCommand } from '#utils/command-security';
import { detectProjectStack, runProjectTests, runSingleCommand } from '#utils/exec';
import { createLogger } from '#utils/logger';
import { getWorktreePath, runInWorktree } from '#utils/worktree-context';

const log = createLogger('run-tests-step');

export const runTestsStep = createStep({
  id: 'run-tests',
  inputSchema: developerImplementationOutputSchema,
  outputSchema: developerRunTestsOutputSchema,
  execute: async ({ inputData }) => {
    const worktreePath = getWorktreePath(inputData.branchName);

    const testResult = await runInWorktree(worktreePath, async () => {
      const { stackCommands } = inputData;
      const knownStack = detectProjectStack(worktreePath);

      // Known stack (node/python/make) → tested deterministic path.
      if (knownStack) {
        return runProjectTests(worktreePath);
      }

      // Unknown stack with no test command → treat as pass (no tests to run).
      if (!stackCommands.testCommand) {
        return {
          stdout: '',
          stderr: 'No test command for this project',
          exitCode: 0,
          passed: true,
          command: 'none',
          manager: null,
        };
      }

      // Unknown stack → validate and run the agent-derived test command.
      const validated = validateCommand(stackCommands.testCommand);
      if (!validated.allowed || !validated.parsed) {
        return {
          stdout: '',
          stderr: validated.reason ?? 'Invalid test command',
          exitCode: 1,
          passed: false,
          command: 'unknown',
          manager: null,
        };
      }

      const result = await runSingleCommand(
        validated.parsed.command,
        validated.parsed.args,
        worktreePath
      );
      return { ...result, manager: null };
    });

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
