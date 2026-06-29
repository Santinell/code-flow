import { createStep } from '@mastra/core/workflows';
import * as linear from '../../../integrations/linear.js';
import { getEnv } from '../../../config/env.js';
import { createLogger } from '../../../utils/logger.js';
import {
  developerCommitOutputSchema,
  developerWorkflowOutputSchema,
} from '../../workflows/developer.workflow.types.js';

const env = getEnv();
const log = createLogger('move-to-review-step');

export const moveToReviewStep = createStep({
  id: 'move-to-review',
  inputSchema: developerCommitOutputSchema,
  outputSchema: developerWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    const taskId = inputData.taskId as string;
    const taskIdentifier = inputData.taskIdentifier as string;

    await linear.updateTaskStatus(taskId, env.LINEAR_STATUS_REVIEW);

    log.info({ taskId, taskIdentifier }, 'Task moved to Review');

    return {
      ...inputData,
      finalStatus: env.LINEAR_STATUS_REVIEW,
      workflowStatus: 'completed' as const,
    };
  },
});
