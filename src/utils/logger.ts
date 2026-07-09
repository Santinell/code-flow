import pino from 'pino';
import { getEnv } from '#config/env';

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: null,
  transport: {
    target: 'pino/file',
    options: { destination: 1 }, // stdout
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function createLogger(context: string) {
  return logger.child({ context });
}
