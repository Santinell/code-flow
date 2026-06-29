import { createStep } from '@mastra/core/workflows';
import * as git from '../../../integrations/git.js';
import { createLogger } from '../../../utils/logger.js';
import {
  developerBranchOutputSchema,
  developerClaimTaskOutputSchema,
} from '../../workflows/developer.workflow.types.js';

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
