import 'dotenv/config';
import { initSchema } from '#db/index';
import { createLogger } from '#utils/logger';
import { startTelegramTrigger } from './triggers/telegram-webhook';
import { startPolling } from './triggers/ticket-poller';

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
