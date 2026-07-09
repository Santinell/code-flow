import { createStep } from '@mastra/core/workflows';
import { getTicketSystemConfig } from '#config/providers';
import { getTicketProvider } from '#integrations/ticket/index';
import {
  developerCommitOutputSchema,
  developerWorkflowOutputSchema,
} from '#mastra/workflows/developer-workflow.types';
import { createLogger } from '#utils/logger';

const log = createLogger('move-to-review-step');

export const moveToReviewStep = createStep({
  id: 'move-to-review',
  inputSchema: developerCommitOutputSchema,
  outputSchema: developerWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    const ticketSystem = getTicketProvider();
    const { statuses } = getTicketSystemConfig();
    const taskId = inputData.taskId as string;
    const taskIdentifier = inputData.taskIdentifier as string;

    await ticketSystem.updateTaskStatus(taskId, statuses.review);

    log.info({ taskId, taskIdentifier }, 'Task moved to Review');

    return {
      ...inputData,
      finalStatus: statuses.review,
      workflowStatus: 'completed' as const,
    };
  },
});
