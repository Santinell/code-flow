import { createStep } from '@mastra/core/workflows';
import * as git from '#integrations/git';
import {
  reviewerDiffOutputSchema,
  reviewerWorkflowInputSchema,
} from '#mastra/workflows/reviewer-workflow.types';
import { createLogger } from '#utils/logger';

const log = createLogger('get-diff-step');

export const getDiffStep = createStep({
  id: 'get-diff',
  inputSchema: reviewerWorkflowInputSchema,
  outputSchema: reviewerDiffOutputSchema,
  execute: async ({ inputData }) => {
    const diff = await git.getBranchDiff(inputData.branchName);
    const changedFiles = await git.getChangedFiles(inputData.branchName);

    log.info(
      {
        taskIdentifier: inputData.taskIdentifier,
        branchName: inputData.branchName,
        diffLength: diff.length,
        fileCount: changedFiles.length,
      },
      'Diff retrieved'
    );

    return { ...inputData, diff, changedFiles };
  },
});
