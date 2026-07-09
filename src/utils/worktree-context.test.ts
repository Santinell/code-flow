import { describe, expect, it } from 'vitest';
import { getCurrentWorktreePath, getWorktreePath, runInWorktree } from './worktree-context';

describe('getCurrentWorktreePath', () => {
  it('returns fallback PROJECT_PATH when no worktree context is set', () => {
    expect(getCurrentWorktreePath()).toBe('/tmp/__test_project__');
  });
});

describe('runInWorktree', () => {
  it('sets worktree path for the duration of the callback', async () => {
    const customPath = '/tmp/__test_worktrees__/feat-123';

    await runInWorktree(customPath, async () => {
      expect(getCurrentWorktreePath()).toBe(customPath);
    });

    // После завершения callback контекст сброшен
    expect(getCurrentWorktreePath()).toBe('/tmp/__test_project__');
  });

  it('returns the callback result', async () => {
    const result = await runInWorktree('/some/path', async () => 'done');
    expect(result).toBe('done');
  });

  it('propagates errors from the callback', async () => {
    await expect(
      runInWorktree('/some/path', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('restores previous worktree context after callback', async () => {
    await runInWorktree('/outer/path', async () => {
      expect(getCurrentWorktreePath()).toBe('/outer/path');

      await runInWorktree('/inner/path', async () => {
        expect(getCurrentWorktreePath()).toBe('/inner/path');
      });

      // Внутренний контекст сброшен, внешний сохранён
      expect(getCurrentWorktreePath()).toBe('/outer/path');
    });

    // Внешний контекст тоже сброшен
    expect(getCurrentWorktreePath()).toBe('/tmp/__test_project__');
  });
});

describe('getWorktreePath', () => {
  it('constructs worktree path from branch name', () => {
    expect(getWorktreePath('feat/new-feature')).toBe('/tmp/__test_worktrees__/feat-new-feature');
  });

  it('sanitizes slashes in branch name', () => {
    expect(getWorktreePath('feature/ticket-123/summary')).toBe(
      '/tmp/__test_worktrees__/feature-ticket-123-summary'
    );
  });

  it('handles simple branch names', () => {
    expect(getWorktreePath('main')).toBe('/tmp/__test_worktrees__/main');
  });
});
