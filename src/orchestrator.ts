import 'dotenv/config';
import { initSchema } from './db/index.js';
import { startPolling } from './triggers/linear-poller.js';
import { startTelegramTrigger } from './triggers/telegram-webhook.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('orchestrator');

async function main(): Promise<void> {
  log.info('🚀 Starting Agent Development System...');

  // Initialize SQLite schema
  initSchema();
  log.info('📦 Database initialized');

  // Start all triggers in parallel
  await Promise.all([startTelegramTrigger(), Promise.resolve(startPolling())]);

  log.info('✅ All triggers running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  log.fatal({ error }, 'Failed to start orchestrator');
  process.exit(1);
});
