import { AsyncLocalStorage } from 'node:async_hooks';
import { getEnv } from '#config/env';

const env = getEnv();
const currentWorktreeStorage = new AsyncLocalStorage<string>();

export function getCurrentWorktreePath(): string {
  return currentWorktreeStorage.getStore() ?? env.PROJECT_PATH;
}

export function runInWorktree<T>(worktreePath: string, fn: () => Promise<T>): Promise<T> {
  return currentWorktreeStorage.run(worktreePath, fn);
}

export function getWorktreePath(branchName: string): string {
  const sanitized = branchName.replace(/\//g, '-');
  return `${env.WORKTREE_PATH}/${sanitized}`;
}
