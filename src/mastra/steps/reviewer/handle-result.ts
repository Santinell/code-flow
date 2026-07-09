import { createStep } from '@mastra/core/workflows';
import { getTicketSystemConfig } from '#config/providers';
import * as git from '#integrations/git';
import { getTicketProvider } from '#integrations/ticket/index';
import {
  reviewerHandleResultOutputSchema,
  reviewerReviewOutputSchema,
} from '#mastra/workflows/reviewer-workflow.types';
import { createLogger } from '#utils/logger';

const log = createLogger('handle-review-result-step');

export const handleReviewResultStep = createStep({
  id: 'handle-review-result',
  inputSchema: reviewerReviewOutputSchema,
  outputSchema: reviewerHandleResultOutputSchema,
  execute: async ({ inputData }) => {
    const ticketSystem = getTicketProvider();
    const { statuses } = getTicketSystemConfig();

    if (inputData.isApproved) {
      await ticketSystem.updateTaskStatus(inputData.taskId, statuses.done);
      await ticketSystem.addComment(
        inputData.taskId,
        `**Code Review Approved**\n\n${inputData.reviewText}`
      );

      try {
        await git.mergeBranch(inputData.branchName);
        log.info({ taskIdentifier: inputData.taskIdentifier }, 'Branch merged');
      } catch (error) {
        log.warn({ taskIdentifier: inputData.taskIdentifier, error }, 'Merge failed');
        await ticketSystem.addComment(
          inputData.taskId,
          `Auto-merge failed. Please merge manually: \`${inputData.branchName}\``
        );
      }

      return {
        ...inputData,
        finalStatus: 'Done' as const,
        merged: true,
      };
    }

    await ticketSystem.updateTaskStatus(inputData.taskId, statuses.todo);
    await ticketSystem.addComment(
      inputData.taskId,
      `**Changes Requested**\n\n${inputData.reviewText}`
    );

    log.info({ taskIdentifier: inputData.taskIdentifier }, 'Changes requested');

    return {
      ...inputData,
      finalStatus: 'Todo' as const,
      merged: false,
    };
  },
});
