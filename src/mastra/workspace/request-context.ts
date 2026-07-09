import { RequestContext } from '@mastra/core/request-context';

/**
 * RequestContext key under which the per-task git worktree path is stored.
 * Workspace filesystem/sandbox resolvers read this to scope agent file ops
 * to the current worktree (analogous to the AsyncLocalStorage store used by
 * the legacy custom tools).
 */
export const WORKTREE_PATH_CONTEXT_KEY = 'worktreePath';

/**
 * Builds a RequestContext carrying the worktree path so the
 * resolver-backed workspace filesystem resolves to the correct git worktree.
 */
export function buildWorkspaceRequestContext(worktreePath: string): RequestContext {
  const ctx = new RequestContext();
  ctx.set(WORKTREE_PATH_CONTEXT_KEY, worktreePath);
  return ctx;
}
