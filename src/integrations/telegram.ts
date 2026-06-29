import { Bot, Context, InlineKeyboard } from 'grammy';
import { getEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const env = getEnv();
const log = createLogger('telegram');

let bot: Bot | null = null;

export function getTelegramBot(): Bot {
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  }
  return bot;
}

/** Send a text message to a chat */
export async function sendMessage(chatId: number, text: string): Promise<void> {
  const bot = getTelegramBot();
  await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  log.info({ chatId }, 'Message sent to Telegram');
}

/** Send a message with inline keyboard buttons (for clarification) */
export async function sendWithButtons(
  chatId: number,
  text: string,
  buttons: { text: string; callbackData: string }[]
): Promise<void> {
  const bot = getTelegramBot();
  const keyboard = new InlineKeyboard();
  buttons.forEach((btn) => {
    keyboard.text(btn.text, btn.callbackData);
  });
  await bot.api.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/** Send a question and wait for text reply (simplified) */
export async function askQuestion(chatId: number, question: string): Promise<void> {
  await sendMessage(chatId, `❓ ${question}`);
}

/** Start long polling for messages and optional callback queries */
export function startPolling(
  onMessage: (ctx: Context) => Promise<void>,
  onCallback?: (ctx: Context) => Promise<void>
): void {
  const bot = getTelegramBot();
  bot.on('message:text', onMessage);
  if (onCallback) {
    bot.on('callback_query', onCallback);
  }
  bot.start({ onStart: () => log.info('Telegram bot started (polling)') });
}
