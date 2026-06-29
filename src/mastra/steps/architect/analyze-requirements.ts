import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import * as telegram from '../../../integrations/telegram.js';
import { createLogger } from '../../../utils/logger.js';
import { architectAgent } from '../../agents/architect.agent.js';
import {
  architectGenerateOutputSchema,
  architectParseTasksOutputSchema,
  architectWorkflowInputSchema,
} from '../../workflows/architect.workflow.types.js';

const log = createLogger('analyze-requirements-step');

const resumeSchema = z.object({
  userMessage: z.string().min(1),
});

const suspendSchema = z.object({
  chatId: z.number().int().positive(),
  question: z.string(),
});

export const analyzeRequirements = createStep({
  id: 'analyze-requirements',
  inputSchema: architectWorkflowInputSchema,
  outputSchema: architectParseTasksOutputSchema,
  resumeSchema,
  suspendSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { userId, chatId, threadId } = inputData;
    const userMessage = resumeData?.userMessage ?? inputData.userMessage;

    const result = await architectAgent.generate(userMessage, {
      memory: {
        thread: threadId,
        resource: `user-${userId}`,
      },
      structuredOutput: {
        schema: architectGenerateOutputSchema,
      },
    });
    const output = result.object;

    if (output.needsClarification || output.tasks.length === 0) {
      await telegram.sendMessage(chatId, output.message);
      return await suspend({
        chatId,
        question: output.message,
      });
    }

    log.info({ userId, chatId, taskCount: output.tasks.length }, 'Tasks generated successfully');

    return {
      userId,
      chatId,
      threadId,
      tasks: output.tasks,
      parseError: false as const,
    };
  },
});
