import type { TicketProvider } from './types';
import { getTicketSystemConfig, getTicketProviderConfig } from '#config/providers';
import { createLogger } from '#utils/logger';
import { GitHubProvider } from './github-provider';
import { LinearProvider } from './linear-provider';

const log = createLogger('ticket');

let provider: TicketProvider | null = null;

/** Get or create the singleton ticket provider based on ticket-system config */
export function getTicketProvider(): TicketProvider {
  if (provider) {
    return provider;
  }

  const system = getTicketSystemConfig();
  const creds = getTicketProviderConfig(system.provider);

  if (!creds) {
    throw new Error(
      `Ticket provider "${system.provider}" not configured in ticket-providers block of providers.json`
    );
  }

  log.info({ provider: system.provider }, 'Initializing ticket provider');

  switch (system.provider) {
    case 'linear':
      provider = new LinearProvider(creds, system.statuses);
      break;
    case 'github':
      provider = new GitHubProvider(creds, system.statuses);
      break;
    default:
      throw new Error(`Unknown ticket provider: ${system.provider}`);
  }

  return provider;
}

/** Reset the singleton — useful for tests */
export function resetTicketProvider(): void {
  provider = null;
}

export type { CreateTaskInput, Task, StatusMap, TicketProvider } from './types';
