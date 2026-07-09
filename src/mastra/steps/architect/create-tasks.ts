import { createStep } from '@mastra/core/workflows';
import * as db from '#db/index';
import * as telegram from '#integrations/telegram';
import { getTicketProvider } from '#integrations/ticket/index';
import { mastra } from '#mastra/index';
import {
  architectCreateTasksInputSchema,
  architectWorkflowOutputSchema,
} from '#mastra/workflows/architect-workflow.types';
import { createLogger } from '#utils/logger';
import { escapeMarkdown } from '#utils/telegram-md';

const log = createLogger('create-tasks-step');

async function clearArchitectThread(userId: number, threadId: string): Promise<void> {
  try {
    const agent = mastra.getAgent('architect');
    const memory = await agent.getMemory();
    await memory?.deleteThread(threadId);
    const activeRun = db.getActiveRunByUser(userId);
    if (activeRun) {
      db.deleteWorkflowRun(activeRun.runId);
    }
  } catch (error) {
    log.warn({ userId, error }, 'Failed to clear architect state');
  }
}

export const createTasksStep = createStep({
  id: 'create-tasks',
  inputSchema: architectCreateTasksInputSchema,
  outputSchema: architectWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    const ticketSystem = getTicketProvider();
    const created = [];

    for (const task of inputData.tasks) {
      const ticketTask = await ticketSystem.createTask({
        title: task.title,
        description: task.description,
        priority: task.priority,
      });
      db.saveTaskBranch(ticketTask.id, ticketTask.identifier, ticketTask.branchName);

      created.push({
        taskId: ticketTask.id,
        identifier: ticketTask.identifier,
        title: ticketTask.title,
        branchName: ticketTask.branchName,
      });

      log.info(
        { identifier: ticketTask.identifier, branchName: ticketTask.branchName },
        'Task created'
      );
    }

    const summary = created
      .map(
        (task) =>
          `• **[${task.identifier}](${ticketSystem.getTaskUrl(task.identifier)})**: ${escapeMarkdown(task.title)}\n`
      )
      .join('\n');

    await telegram.sendMessage(
      inputData.chatId,
      `✅ Создано задач: ${created.length}\n\n${summary}`
    );

    await clearArchitectThread(inputData.userId, inputData.threadId);

    return {
      chatId: inputData.chatId,
      status: 'completed' as const,
      created,
      rawOutput: '',
      error: '',
    };
  },
});
