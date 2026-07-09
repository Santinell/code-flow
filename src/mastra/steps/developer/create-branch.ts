import { createStep } from '@mastra/core/workflows';
import * as git from '#integrations/git';
import {
  developerBranchOutputSchema,
  developerClaimTaskOutputSchema,
} from '#mastra/workflows/developer-workflow.types';
import { createLogger } from '#utils/logger';

const log = createLogger('create-branch-step');

export const createBranchStep = createStep({
  id: 'create-branch',
  inputSchema: developerClaimTaskOutputSchema,
  outputSchema: developerBranchOutputSchema,
  execute: async ({ inputData }) => {
    const worktreePath = await git.createWorktree(inputData.branchName);

    log.info({ branch: inputData.branchName, path: worktreePath }, 'Feature worktree created');

    return { ...inputData, branchCreated: true };
  },
});
