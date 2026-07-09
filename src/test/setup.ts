import { vi } from 'vitest';

// Global env mock — isolates ALL tests from .env and process.exit(1).
//
// Source modules call getEnv() eagerly at top-level (logger.ts, git.ts,
// worktree-context.ts), which would parse process.env and exit(1) if the
// .env file is missing or invalid. This mock replaces #config/env globally
// so tests never touch the real env loader.
//
// IMPORTANT: this setup file must NOT import #config/env itself — Vitest
// caches modules imported in setup files, which would prevent the mock from
// intercepting. See https://github.com/vitest-dev/vitest/issues/1450
//
// The factory returns the full Env shape so any module's top-level
// `const env = getEnv()` gets valid data without crashing.
vi.mock('#config/env', () => ({
  getEnv: () => ({
    TELEGRAM_BOT_TOKEN: 'test-token',
    PROJECT_PATH: '/tmp/__test_project__',
    WORKTREE_PATH: '/tmp/__test_worktrees__',
    GIT_MAIN_BRANCH: 'main',
    GIT_REMOTE: 'origin',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@test.local',
    POLL_INTERVAL_MS: 30_000,
    MAX_CLARIFICATION_ROUNDS: 5,
    MAX_CONCURRENT_DEVELOPER_TASKS: 1,
    MAX_CONCURRENT_REVIEWER_TASKS: 1,
    MAX_CONCURRENT_EVAL: 1,
    EMBEDDING_MEMORY: false,
    MAX_STEPS_ANALYZE: 15,
    MAX_STEPS_IMPLEMENT: 20,
    MAX_STEPS_FIX: 15,
    MAX_STEPS_AGENT_DEVELOPER: 6,
    MAX_STEPS_AGENT_REVIEWER: 5,
    MAX_STEPS_AGENT_ARCHITECT: 10,
    MAX_OUTPUT_TOKENS_DEVELOPER: 2048,
    MAX_OUTPUT_TOKENS_REVIEWER: 2048,
    MAX_OUTPUT_TOKENS_ARCHITECT: 8192,
    DB_PATH: './data/agent-dev.db',
    LOG_LEVEL: 'info',
  }),
}));
