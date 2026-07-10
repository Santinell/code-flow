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
import { isMeaningfulRequirement } from '#utils/input-validation';
import { createLogger } from '#utils/logger';

const log = createLogger('analyze-requirements-step');

const resumeSchema = z.object({
  userMessage: z.string().min(1),
});

const suspendSchema = z.object({
  chatId: z.number().int().positive(),
  question: z.string(),
});

const GARBAGE_INPUT_QUESTION =
  'Пожалуйста, опишите задачу более подробно: что нужно сделать, изменить или исправить в проекте?';

export const analyzeRequirementsStep = createStep({
  id: 'analyze-requirements',
  inputSchema: architectWorkflowInputSchema,
  outputSchema: architectParseTasksOutputSchema,
  resumeSchema,
  suspendSchema,
  retries: 3,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { userId, chatId, threadId } = inputData;
    const userMessage = resumeData?.userMessage ?? inputData.userMessage;

    if (!isMeaningfulRequirement(userMessage)) {
      log.info({ userId, chatId }, 'Rejecting garbage input before LLM call');
      await telegram.sendMessage(chatId, GARBAGE_INPUT_QUESTION);
      return await suspend({
        chatId,
        question: GARBAGE_INPUT_QUESTION,
      });
    }

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
    const questions = output.questions ?? [];
    const tasks = output.tasks ?? [];

    // Clarification branch: architect returned questions (tasks empty).
    // Telegram-сообщение: предпочтительно message (контекст/приветствие от модели),
    // иначе собираем нумерованный список из questions.
    if (questions.length > 0) {
      const questionText =
        output.message?.trim() || questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
      await telegram.sendMessage(chatId, questionText);
      return await suspend({
        chatId,
        question: questionText,
      });
    }

    log.info({ userId, chatId, taskCount: tasks.length }, 'Tasks generated successfully');

    return {
      userId,
      chatId,
      threadId,
      tasks: tasks.map((task) => ({
        title: task.title,
        description: task.description,
        priority: task.priority ?? 3,
      })),
      parseError: false as const,
    };
  },
});
