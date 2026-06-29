import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import * as telegram from '../../../integrations/telegram.js';
import { createLogger } from '../../../utils/logger.js';
import { escapeMarkdown } from '../../../utils/telegram-md.js';
import {
  architectCreateTasksInputSchema,
  architectPrioritySchema,
} from '../../workflows/architect.workflow.types.js';

const log = createLogger('confirm-tasks-step');

const resumeSchema = z.object({
  action: z.enum(['confirm', 'reject']).optional(),
  userMessage: z.string().optional(),
});

const suspendSchema = z.object({
  chatId: z.number().int().positive(),
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      priority: architectPrioritySchema,
    })
  ),
});

const PRIORITY_LABELS: Record<number, string> = {
  0: '⚪ Без приоритета',
  1: '🔴 Срочно',
  2: '🟠 Высокий',
  3: '🟡 Средний',
  4: '🟢 Низкий',
};

function formatTasksSummary(tasks: { title: string; description: string; priority: number }[]): string {
  const header = `📋 *Сформированы задачи* (${tasks.length}):\n`;
  const items = tasks
    .map((task, i) => {
      const priority = PRIORITY_LABELS[task.priority] ?? PRIORITY_LABELS[3];
      return `\n${i + 1}\\. *${escapeMarkdown(task.title)}* ${priority}\n  ${escapeMarkdown(task.description)}`;
    })
    .join('\n');
  return header + items + '\n\n_Создать задачи в Linear?_';
}

export const confirmTasksStep = createStep({
  id: 'confirm-tasks',
  inputSchema: architectCreateTasksInputSchema,
  outputSchema: architectCreateTasksInputSchema,
  resumeSchema,
  suspendSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      log.info(
        { userId: inputData.userId, chatId: inputData.chatId, taskCount: inputData.tasks.length },
        'Showing tasks for confirmation'
      );
      await telegram.sendWithButtons(inputData.chatId, formatTasksSummary(inputData.tasks), [
        { text: '✅ Да', callbackData: 'confirm' },
        { text: '❌ Нет', callbackData: 'reject' },
      ]);
      return await suspend({
        chatId: inputData.chatId,
        tasks: inputData.tasks,
      });
    }

    const action = resumeData.action;

    if (action === 'confirm') {
      log.info(
        { userId: inputData.userId, chatId: inputData.chatId },
        'Task creation confirmed by user'
      );
      await telegram.sendMessage(inputData.chatId, '✅ Создаю задачи в Linear...');
      return inputData;
    }

    if (action === 'reject') {
      log.info(
        { userId: inputData.userId, chatId: inputData.chatId },
        'Task creation rejected by user'
      );
      await telegram.sendMessage(
        inputData.chatId,
        '❌ Создание задач отменено.\n\nОтправьте /cancel для выхода или /new чтобы начать заново.'
      );

      return await suspend({
        chatId: inputData.chatId,
        tasks: inputData.tasks,
      });
    }

    log.info(
      { userId: inputData.userId, chatId: inputData.chatId },
      'Unrecognized confirmation response'
    );
    await telegram.sendMessage(
      inputData.chatId,
      '⚠️ Используйте кнопки «Да» или «Нет» под списком задач.'
    );
    return await suspend({
      chatId: inputData.chatId,
      tasks: inputData.tasks,
    });
  },
});
