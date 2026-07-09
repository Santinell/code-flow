import { LocalFilesystem, Workspace } from '@mastra/core/workspace';
import { WORKTREE_PATH_CONTEXT_KEY } from './request-context';
import { ValidatingFilesystem } from './validating-filesystem';

export { ValidatingFilesystem } from './validating-filesystem';
export { WORKTREE_PATH_CONTEXT_KEY, buildWorkspaceRequestContext } from './request-context';

// Cache of ValidatingFilesystem instances keyed by worktree path.
// createWorkspaceTools is called once at agent construction; the filesystem
// resolver runs on every tool invocation. LocalFilesystem init() is cheap but
// memoizing avoids rebuilding the wrapper + re-running init on every call.
const fsCache = new Map<string, ValidatingFilesystem>();

function getWorktreeFilesystem(worktreePath: string): ValidatingFilesystem {
  let cached = fsCache.get(worktreePath);
  if (cached) {
    return cached;
  }
  const local = new LocalFilesystem({
    basePath: worktreePath,
    contained: true,
  });
  cached = new ValidatingFilesystem(local);
  fsCache.set(worktreePath, cached);
  return cached;
}

/**
 * Creates a Workspace whose filesystem is resolved per-request from the
 * worktree path stored in RequestContext. This is what lets all agents share
 * a single Workspace instance while operating on different git worktrees
 * (one per task) without reconfiguring the agent.
 *
 * Tool aliases map the long `mastra_workspace_*` IDs onto the short names the
 * agents, prompts, and ToolBudgetProcessor already reference (readFile,
 * writeFile, etc.). `execute_command`, `grep`, and `search` are intentionally
 * disabled: install/test run via workflow steps, and file-pattern search stays
 * on the custom globSearch tool.
 */
export function createWorktreeWorkspace(): Workspace {
  return new Workspace({
    filesystem: ({ requestContext }) => {
      const worktreePath = requestContext.get<string, string>(WORKTREE_PATH_CONTEXT_KEY);
      if (!worktreePath || typeof worktreePath !== 'string') {
        throw new Error(
          'worktreePath not set in requestContext — pass buildWorkspaceRequestContext(worktreePath) to generate()'
        );
      }
      return getWorktreeFilesystem(worktreePath);
    },
    tools: {
      mastra_workspace_read_file: { name: 'readFile' },
      mastra_workspace_write_file: { name: 'writeFile' },
      mastra_workspace_delete: { name: 'deleteFile' },
      mastra_workspace_list_files: { name: 'listDir' },
      mastra_workspace_edit_file: { name: 'editFile' },
      mastra_workspace_file_stat: { name: 'fileStat' },
      mastra_workspace_mkdir: { name: 'mkdir' },
      // Disabled — handled by workflow steps (install-deps / run-tests)
      mastra_workspace_execute_command: { enabled: false },
      mastra_workspace_get_process_output: { enabled: false },
      mastra_workspace_kill_process: { enabled: false },
      // Disabled — globSearch stays on the custom tool (pattern-by-name search)
      mastra_workspace_grep: { enabled: false },
      mastra_workspace_search: { enabled: false },
      mastra_workspace_index: { enabled: false },
      mastra_workspace_ast_edit: { enabled: false },
      mastra_workspace_lsp_inspect: { enabled: false },
    },
  });
}
