import 'dotenv/config';
import { z } from 'zod';
import fs from 'node:fs';

const pathExists = (path: string) => {
  return fs.existsSync(path);
};

const gitExists = (path: string) => {
  return fs.existsSync(`${path}/.git`);
};

const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),

  // Linear
  LINEAR_API_KEY: z.string().min(1),
  LINEAR_TEAM_KEY: z.string().min(1),
  LINEAR_PROJECT_SLUG: z.string().min(1),

  LINEAR_STATUS_TODO: z.string().min(1),
  LINEAR_STATUS_IN_PROGRESS: z.string().min(1),
  LINEAR_STATUS_REVIEW: z.string().min(1),
  LINEAR_STATUS_DONE: z.string().min(1),

  // Git
  PROJECT_PATH: z
    .string()
    .min(1)
    .refine(pathExists, {
      message: 'PROJECT_PATH does not exist',
    })
    .refine(gitExists, {
      message: 'PROJECT_PATH is not a git repository',
    }),
  WORKTREE_PATH: z.string().min(1).refine(pathExists, {
    message: 'WORKTREE_PATH does not exist',
  }),
  GIT_MAIN_BRANCH: z.string().default('main'),
  GIT_AUTHOR_NAME: z.string().default('DevAgent'),
  GIT_AUTHOR_EMAIL: z.string().default('agent@dev.local'),

  // Workflow
  POLL_INTERVAL_MS: z.coerce.number().int().default(30_000),
  MAX_CLARIFICATION_ROUNDS: z.coerce.number().int().default(5),
  MAX_CONCURRENT_DEVELOPER_TASKS: z.coerce.number().int().min(1).default(1),
  MAX_CONCURRENT_REVIEWER_TASKS: z.coerce.number().int().min(1).default(1),
  MAX_CONCURRENT_EVAL: z.coerce.number().int().min(1).default(1),

  // Embedding
  EMBEDDING_MEMORY: z.coerce.boolean().default(false),

  // Agent step budgets — used both for agent.generate() and in prompts
  MAX_STEPS_ANALYZE: z.coerce.number().int().min(15).default(15),
  MAX_STEPS_IMPLEMENT: z.coerce.number().int().min(20).default(20),
  MAX_STEPS_FIX: z.coerce.number().int().min(15).default(15),
  MAX_STEPS_AGENT_DEVELOPER: z.coerce.number().int().min(3).default(6),
  MAX_STEPS_AGENT_REVIEWER: z.coerce.number().int().min(3).default(5),
  MAX_STEPS_AGENT_ARCHITECT: z.coerce.number().int().min(5).default(10),

  // Agent output token budgets — propagated to modelSettings.maxOutputTokens
  MAX_OUTPUT_TOKENS_DEVELOPER: z.coerce.number().int().min(1024).default(2048),
  MAX_OUTPUT_TOKENS_REVIEWER: z.coerce.number().int().min(1024).default(2048),
  MAX_OUTPUT_TOKENS_ARCHITECT: z.coerce.number().int().min(1024).default(8192),

  // Storage
  DB_PATH: z.string().default('./data/agent-dev.db'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let env: Env | null = null;

export function getEnv(): Env {
  if (!env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('❌ Invalid environment variables:', result.error.format());
      process.exit(1);
    }
    env = result.data;
  }
  return env;
}
