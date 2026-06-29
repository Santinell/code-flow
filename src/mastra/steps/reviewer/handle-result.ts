import { createStep } from '@mastra/core/workflows';
import * as git from '../../../integrations/git.js';
import * as linear from '../../../integrations/linear.js';
import { createLogger } from '../../../utils/logger.js';
import {
  reviewerHandleResultOutputSchema,
  reviewerReviewOutputSchema,
} from '../../workflows/reviewer.workflow.types.js';

const log = createLogger('handle-review-result-step');

export const handleReviewResultStep = createStep({
  id: 'handle-review-result',
  inputSchema: reviewerReviewOutputSchema,
  outputSchema: reviewerHandleResultOutputSchema,
  execute: async ({ inputData }) => {
    if (inputData.isApproved) {
      await linear.updateTaskStatus(inputData.taskId, 'Done');
      await linear.addComment(
        inputData.taskId,
        `✅ **Code Review Approved**\n\n${inputData.reviewText}`
      );

      try {
        await git.mergeBranch(inputData.branchName);
        log.info({ taskIdentifier: inputData.taskIdentifier }, 'Branch merged');
      } catch (error) {
        log.warn({ taskIdentifier: inputData.taskIdentifier, error }, 'Merge failed');
        await linear.addComment(
          inputData.taskId,
          `⚠️ Auto-merge failed. Please merge manually: \`${inputData.branchName}\``
        );
      }

      return {
        ...inputData,
        finalStatus: 'Done' as const,
        merged: true,
      };
    }

    await linear.updateTaskStatus(inputData.taskId, 'Todo');
    await linear.addComment(
      inputData.taskId,
      `🔄 **Changes Requested**\n\n${inputData.reviewText}`
    );

    log.info({ taskIdentifier: inputData.taskIdentifier }, 'Changes requested');

    return {
      ...inputData,
      finalStatus: 'Todo' as const,
      merged: false,
    };
  },
});
