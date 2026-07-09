import { createWorkflowStateReader } from '@mastra/core/workflows';
import { Context } from 'grammy';
import * as db from '#db/index';
import { startPolling } from '#integrations/telegram';
import { mastra } from '#mastra/index';
import { createLogger } from '#utils/logger';

const log = createLogger('telegram-trigger');

async function cancelUserSession(userId: number): Promise<void> {
  const active = db.getActiveRunByUser(userId);
  if (!active) {
    return;
  }

  db.deleteWorkflowRun(active.runId);

  if (active.threadId) {
    try {
      const agent = mastra.getAgent('architect');
      const memory = await agent.getMemory();
      await memory?.deleteThread(active.threadId);
    } catch (error) {
      log.warn({ userId, error }, 'Failed to clear architect thread');
    }
  }
}

async function handleMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text;

  if (!userId || !chatId || !text) {
    return;
  }

  // Handle commands
  if (text.startsWith('/')) {
    if (text === '/start' || text === '/new') {
      await ctx.reply(
        '🏗 *Архитектор-бот*\n\n' +
          'Опишите задачу, которую нужно реализовать.\n' +
          'Я задам уточняющие вопросы и создам задачи в Linear.\n\n' +
          '/cancel — сбросить текущую сессию',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    if (text === '/cancel' || text === '/stop') {
      await cancelUserSession(userId);
      await ctx.reply('❌ Текущая сессия сброшена.');
      return;
    }
    return;
  }

  log.info({ userId, chatId, messageLength: text.length }, 'Received Telegram message');

  try {
    const workflow = mastra.getWorkflow('architect-workflow');

    const active = db.getActiveRunByUser(userId);
    if (active) {
      const state = await workflow.getWorkflowRunById(active.runId);

      if (state?.status === 'suspended') {
        const reader = createWorkflowStateReader(state);
        const suspendedStep = reader.getSuspendedStep();
        const run = await workflow.createRun({ runId: active.runId });

        const result = await run.resume({
          step: suspendedStep?.path ?? 'analyze-requirements',
          resumeData: { userMessage: text },
        });

        log.info({ userId, chatId, status: result.status }, 'Architect workflow resumed');

        if (result.status !== 'suspended') {
          db.deleteWorkflowRun(active.runId);
          if (active.threadId) {
            const agent = mastra.getAgent('architect');
            const memory = await agent.getMemory();
            await memory?.deleteThread(active.threadId);
          }
        }
        return;
      }
    }

    // Start a new run
    const threadId = crypto.randomUUID();
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: { userId, chatId, userMessage: text, threadId },
    });

    log.info(
      { userId, chatId, status: result.status, runId: run.runId },
      'Architect workflow started'
    );

    if (result.status === 'suspended') {
      db.saveWorkflowRun(run.runId, { userId, threadId });
    } else {
      cancelUserSession(userId);
    }
  } catch (error) {
    log.error({ userId, chatId, error }, 'Architect workflow failed');
    await ctx.reply('❌ Произошла ошибка при обработке. Попробуйте ещё раз.');
  }
}

async function disableButtons(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup();
  } catch {
    // message may be already edited or deleted
  }
}

async function handleCallback(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;

  if (!callbackData || !userId) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  log.info({ userId, callbackData }, 'Received Telegram callback query');

  try {
    const workflow = mastra.getWorkflow('architect-workflow');
    const active = db.getActiveRunByUser(userId);

    if (!active) {
      await ctx.answerCallbackQuery({ text: 'Сессия истекла. Отправьте /new.' }).catch(() => {});
      await disableButtons(ctx);
      return;
    }

    const state = await workflow.getWorkflowRunById(active.runId);

    if (state?.status !== 'suspended') {
      await ctx.answerCallbackQuery({ text: 'Действие уже не актуально.' }).catch(() => {});
      await disableButtons(ctx);
      return;
    }

    const reader = createWorkflowStateReader(state);
    const suspendedStep = reader.getSuspendedStep();
    const run = await workflow.createRun({ runId: active.runId });

    const result = await run.resume({
      step: suspendedStep?.path ?? 'confirm-tasks',
      resumeData: { action: callbackData },
    });

    log.info({ userId, status: result.status }, 'Architect workflow resumed via callback');

    await ctx.answerCallbackQuery().catch(() => {});

    if (result.status !== 'suspended') {
      await disableButtons(ctx);
      db.deleteWorkflowRun(active.runId);
      if (active.threadId) {
        const agent = mastra.getAgent('architect');
        const memory = await agent.getMemory();
        await memory?.deleteThread(active.threadId);
      }
    }
  } catch (error) {
    log.error({ userId, error }, 'Architect workflow callback failed');
    await ctx.answerCallbackQuery({ text: 'Ошибка. Попробуйте ещё раз.' }).catch(() => {});
    await disableButtons(ctx);
  }
}

// ── Start Bot ──────────────────────────────────────────────────────
export async function startTelegramTrigger(): Promise<void> {
  log.info('Starting Telegram Architect bot trigger...');
  startPolling(
    async (ctx) => {
      await handleMessage(ctx);
    },
    async (ctx) => {
      await handleCallback(ctx);
    }
  );
}

if (process.argv[1]?.includes('telegram-webhook')) {
  startTelegramTrigger().catch(console.error);
}
