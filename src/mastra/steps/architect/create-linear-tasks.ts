import { createStep } from '@mastra/core/workflows';
import * as db from '../../../db/index.js';
import * as linear from '../../../integrations/linear.js';
import * as telegram from '../../../integrations/telegram.js';
import { createLogger } from '../../../utils/logger.js';
import { escapeMarkdown } from '../../../utils/telegram-md.js';
import { mastra } from '../../index.js';
import {
  architectCreateTasksInputSchema,
  architectWorkflowOutputSchema,
} from '../../workflows/architect.workflow.types.js';
import { getTeam } from '../../../integrations/linear.js';

const log = createLogger('create-linear-tasks-step');

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

export const createLinearTasksStep = createStep({
  id: 'create-linear-tasks',
  inputSchema: architectCreateTasksInputSchema,
  outputSchema: architectWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    const created = [];

    for (const task of inputData.tasks) {
      const linearTask = await linear.createTask({
        title: task.title,
        description: task.description,
        priority: task.priority,
      });
      const branchName = linearTask.branchName ?? `feature/${linearTask.identifier.toLowerCase()}`;
      db.saveTaskBranch(linearTask.id, linearTask.identifier, branchName);

      created.push({
        taskId: linearTask.id,
        identifier: linearTask.identifier,
        title: linearTask.title,
        branchName,
      });

      log.info({ identifier: linearTask.identifier, branchName }, 'Task created in Linear');
    }

    const team = await getTeam();
    const workspace = team.name.toLowerCase();

    const summary = created
      .map(
        (task) =>
          `• **[${task.identifier}](https://linear.app/${workspace}/issue/${task.identifier})**: ${escapeMarkdown(task.title)}\n`
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
    };
  },
});
