import { createStep } from '@mastra/core/workflows';
import * as git from '#integrations/git';
import {
  developerCommitInputSchema,
  developerCommitOutputSchema,
  parseDeveloperCommitInput,
} from '#mastra/workflows/developer-workflow.types';
import { createLogger } from '#utils/logger';
import { getWorktreePath, runInWorktree } from '#utils/worktree-context';

const log = createLogger('commit-changes-step');

export const commitChangesStep = createStep({
  id: 'commit-changes',
  inputSchema: developerCommitInputSchema,
  outputSchema: developerCommitOutputSchema,
  execute: async ({ inputData }) => {
    const taskInput = parseDeveloperCommitInput(inputData);
    const worktreePath = getWorktreePath(taskInput.branchName);

    const commitHash = await runInWorktree(worktreePath, async () => {
      return git.commitChanges(taskInput.taskIdentifier, taskInput.taskTitle);
    });

    log.info({ taskIdentifier: taskInput.taskIdentifier, commitHash }, 'Changes committed');

    return { ...taskInput, commitHash };
  },
});
