import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { getEnv } from '#config/env';
import * as telegram from '#integrations/telegram';
import { architectAgent } from '#mastra/agents/architect-agent';
import {
  architectGenerateOutputSchema,
  architectParseTasksOutputSchema,
  architectWorkflowInputSchema,
} from '#mastra/workflows/architect-workflow.types';
import { buildWorkspaceRequestContext } from '#mastra/workspace';
import { createLogger } from '#utils/logger';

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
  retries: 3,
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
      // Architect analyzes the main project (no worktree yet — design happens
      // before any branch/task exists). Workspace FS resolves to PROJECT_PATH.
      requestContext: buildWorkspaceRequestContext(getEnv().PROJECT_PATH),
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
      tasks: output.tasks.map((task) => ({
        title: task.title,
        description: task.description,
        priority: task.priority ?? 3,
      })),
      parseError: false as const,
    };
  },
});
