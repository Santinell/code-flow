import { createStep } from '@mastra/core/workflows';
import * as git from '../../../integrations/git.js';
import { createLogger } from '../../../utils/logger.js';
import { getWorktreePath, runInWorktree } from '../../../utils/worktree-context.js';
import {
  developerCommitInputSchema,
  developerCommitOutputSchema,
  parseDeveloperCommitInput,
} from '../../workflows/developer.workflow.types.js';

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
