import { createStep } from '@mastra/core/workflows';
import { getTicketSystemConfig } from '#config/providers';
import { getTicketProvider } from '#integrations/ticket/index';
import {
  developerClaimTaskOutputSchema,
  developerWorkflowInputSchema,
} from '#mastra/workflows/developer-workflow.types';
import { createLogger } from '#utils/logger';

const log = createLogger('claim-task-step');

export const claimTaskStep = createStep({
  id: 'claim-task',
  inputSchema: developerWorkflowInputSchema,
  outputSchema: developerClaimTaskOutputSchema,
  execute: async ({ inputData }) => {
    const ticketSystem = getTicketProvider();
    const { statuses } = getTicketSystemConfig();

    await ticketSystem.updateTaskStatus(inputData.taskId, statuses.inProgress);

    log.info(
      {
        taskId: inputData.taskId,
        taskIdentifier: inputData.taskIdentifier,
        branchName: inputData.branchName,
      },
      'Task claimed'
    );

    return { ...inputData, status: statuses.inProgress };
  },
});
