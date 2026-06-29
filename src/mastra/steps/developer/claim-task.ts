import { createStep } from '@mastra/core/workflows';
import * as linear from '../../../integrations/linear.js';
import { getEnv } from '../../../config/env.js';
import { createLogger } from '../../../utils/logger.js';
import {
  developerClaimTaskOutputSchema,
  developerWorkflowInputSchema,
} from '../../workflows/developer.workflow.types.js';

const env = getEnv();
const log = createLogger('claim-task-step');

export const claimTaskStep = createStep({
  id: 'claim-task',
  inputSchema: developerWorkflowInputSchema,
  outputSchema: developerClaimTaskOutputSchema,
  execute: async ({ inputData }) => {
    await linear.updateTaskStatus(inputData.taskId, env.LINEAR_STATUS_IN_PROGRESS);

    log.info(
      {
        taskId: inputData.taskId,
        taskIdentifier: inputData.taskIdentifier,
        branchName: inputData.branchName,
      },
      'Task claimed'
    );

    return { ...inputData, status: env.LINEAR_STATUS_IN_PROGRESS };
  },
});
