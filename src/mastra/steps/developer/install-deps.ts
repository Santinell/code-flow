import { createStep } from '@mastra/core/workflows';
import {
  developerAnalysisOutputSchema,
  developerInstallDepsOutputSchema,
} from '#mastra/workflows/developer-workflow.types';
import { validateCommand } from '#utils/command-security';
import { detectProjectStack, installProjectDependencies, runCommandSequence } from '#utils/exec';
import { createLogger } from '#utils/logger';
import { getWorktreePath, runInWorktree } from '#utils/worktree-context';

const log = createLogger('install-deps-step');

export const installDepsStep = createStep({
  id: 'install-deps',
  inputSchema: developerAnalysisOutputSchema,
  outputSchema: developerInstallDepsOutputSchema,
  execute: async ({ inputData }) => {
    const worktreePath = getWorktreePath(inputData.branchName);

    const installResult = await runInWorktree(worktreePath, async () => {
      const { stackCommands } = inputData;
      const knownStack = detectProjectStack(worktreePath);

      // Known stack (node/python/make) → tested deterministic path.
      // Also used when the agent reported no install commands.
      if (knownStack || stackCommands.installCommands.length === 0) {
        return installProjectDependencies(worktreePath);
      }

      // Unknown stack → validate and run the agent-derived commands.
      const validated = stackCommands.installCommands
        .map((cmd) => validateCommand(cmd))
        .filter((v): v is { allowed: true; parsed: NonNullable<typeof v.parsed> } => v.allowed)
        .map((v) => v.parsed);

      if (validated.length === 0) {
        return {
          stdout: '',
          stderr:
            stackCommands.installCommands.length > 0
              ? `All install commands rejected by validator: ${stackCommands.installCommands.join(', ')}`
              : 'No install commands provided',
          exitCode: 1,
          passed: false,
          skipped: false,
          command: 'unknown',
          manager: null,
        };
      }

      const result = await runCommandSequence(validated, worktreePath);
      return {
        ...result,
        skipped: false,
        manager: null,
      };
    });

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
