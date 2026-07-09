import 'dotenv/config';
import { execaSync } from 'execa';
import { z } from 'zod';
import fs from 'node:fs';

const pathExists = (path: string) => {
  return fs.existsSync(path);
};

const gitExists = (path: string) => {
  return fs.existsSync(`${path}/.git`);
};

// Repos created with `git init` but never committed point HEAD at an unborn
// branch — checkout/worktree/pull operations all fail on it. Require at least
// one commit so the developer workflow has a base ref to branch from.
const hasCommits = (path: string) => {
  try {
    execaSync('git', ['-C', path, 'rev-parse', '--verify', 'HEAD'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

// The agent pulls from and pushes to a remote to sync the main branch.
// Require that remote to exist, otherwise pull/push fail mid-workflow.
const hasRemote = (repoPath: string, remote: string) => {
  try {
    execaSync('git', ['-C', repoPath, 'remote', 'get-url', remote], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

const envSchema = z
  .object({
    // Telegram
    TELEGRAM_BOT_TOKEN: z.string().min(1),

    // Git
    PROJECT_PATH: z
      .string()
      .min(1)
      .refine(pathExists, {
        message: 'PROJECT_PATH does not exist',
      })
      .refine(gitExists, {
        message: 'PROJECT_PATH is not a git repository',
      })
      .refine(hasCommits, {
        message:
          'PROJECT_PATH has no commits yet — make an initial commit before starting the agent',
      }),
    WORKTREE_PATH: z.string().min(1).refine(pathExists, {
      message: 'WORKTREE_PATH does not exist',
    }),
    GIT_MAIN_BRANCH: z.string().default('main'),
    GIT_REMOTE: z.string().min(1).default('origin'),
    GIT_AUTHOR_NAME: z.string().default('DevAgent'),
    GIT_AUTHOR_EMAIL: z.string().default('agent@dev.local'),

    // Workflow
    POLL_INTERVAL_MS: z.coerce.number().int().default(30_000),
    MAX_CLARIFICATION_ROUNDS: z.coerce.number().int().default(5),
    MAX_CONCURRENT_DEVELOPER_TASKS: z.coerce.number().int().min(1).default(1),
    MAX_CONCURRENT_REVIEWER_TASKS: z.coerce.number().int().min(1).default(1),
    MAX_CONCURRENT_EVAL: z.coerce.number().int().min(1).default(1),

    // Additional binaries allowed in LLM-derived install/test commands (unknown
    // stacks only; known stacks use the tested deterministic builders in exec.ts).
    // Supplements the built-in allowlist in command-security.ts — cannot remove
    // the builtin entries, only extend them. Comma-separated, e.g. "dvc,just".
    ALLOWED_BINARIES: z
      .string()
      .optional()
      .describe('Comma-separated extra binaries allowed in agent-derived commands'),

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
  })
  .superRefine((data, ctx) => {
    if (!hasRemote(data.PROJECT_PATH, data.GIT_REMOTE)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GIT_REMOTE'],
        message: `Git remote '${data.GIT_REMOTE}' is not configured in PROJECT_PATH — add it with: git remote add ${data.GIT_REMOTE} <url>`,
      });
    }
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
