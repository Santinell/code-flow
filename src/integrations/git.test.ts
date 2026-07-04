import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Моки для всей цепочки зависимостей git.ts ─────────────────────

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../config/env.js', () => ({
  getEnv: () => ({
    PROJECT_PATH: '/home/user/project',
    WORKTREE_PATH: '/home/user/worktrees',
    GIT_MAIN_BRANCH: 'main',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@test.local',
  }),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../utils/worktree-context.js', () => ({
  getCurrentWorktreePath: () => '/home/user/project',
  getWorktreePath: (branch: string) => `/home/user/worktrees/${branch}`,
  runInWorktree: (_path: string, fn: () => Promise<never>) => fn(),
}));

// Мокаем node:fs — git.ts использует existsSync и join
const mockExistsSync = vi.fn();
vi.mock('node:fs', () => ({
  default: { existsSync: mockExistsSync },
  existsSync: mockExistsSync,
}));

// Мокаем node:path
vi.mock('node:path', () => ({
  default: {
    join: (...parts: string[]) => parts.join('/'),
  },
  join: (...parts: string[]) => parts.join('/'),
}));

// Мокаем execa (execaSync используется в getWorktreeDiffSync)
const mockExecaSync = vi.fn();
vi.mock('execa', () => ({
  execaSync: (...args: [string, string[], Record<string, string>]) => mockExecaSync(...args),
}));

// Мокаем simple-git
const mockGitInstance = {
  status: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  diff: vi.fn(),
  raw: vi.fn(),
  checkout: vi.fn(),
  pull: vi.fn(),
  merge: vi.fn(),
  push: vi.fn(),
  revparse: vi.fn(),
  deleteLocalBranch: vi.fn(),
  init: vi.fn(),
  addConfig: vi.fn(),
  clean: vi.fn(),
  reset: vi.fn(),
  applyPatch: vi.fn(),
};
vi.mock('simple-git', () => ({
  simpleGit: () => mockGitInstance,
}));

const { getWorktreeDiffSync } = await import('./git.js');

describe('getWorktreeDiffSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string when .git does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = getWorktreeDiffSync('/home/user/worktrees/no-git');
    expect(result).toBe('');
    // execaSync НЕ должен вызываться
    expect(mockExecaSync).not.toHaveBeenCalled();
    // warn НЕ вызывается — отсутствие .git это норма
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns diff output on success', () => {
    mockExistsSync.mockReturnValue(true);
    mockExecaSync.mockReturnValue({
      stdout: '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@',
      stderr: '',
    });

    const result = getWorktreeDiffSync('/home/user/worktrees/feat-1');
    expect(result).toContain('--- a/file.ts');
    expect(mockExecaSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--unified=3', 'HEAD'],
      expect.objectContaining({
        cwd: '/home/user/worktrees/feat-1',
        timeout: 5000,
      })
    );
  });

  it('logs warning and returns empty string when execaSync throws', () => {
    mockExistsSync.mockReturnValue(true);
    const error = new Error('git: not in a git repository');
    mockExecaSync.mockImplementation(() => {
      throw error;
    });

    const result = getWorktreeDiffSync('/home/user/worktrees/broken');
    expect(result).toBe('');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { worktreePath: '/home/user/worktrees/broken', error },
      'Failed to compute worktree diff'
    );
  });

  it('returns empty string when diff is empty (no changes)', () => {
    mockExistsSync.mockReturnValue(true);
    mockExecaSync.mockReturnValue({
      stdout: '',
      stderr: '',
    });

    const result = getWorktreeDiffSync('/home/user/worktrees/clean');
    expect(result).toBe('');
    // warn не вызывается — пустой diff это норма
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
