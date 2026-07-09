import { createTool } from '@mastra/core/tools';
import fg from 'fast-glob';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '#utils/logger';
import { validatePath } from '#utils/path-security';

const log = createLogger('agent-tools');

// ════════════════════════════════════════════════════════════════════
//  CUSTOM AGENT TOOLS — tools without a workspace equivalent
//
//  Most file operations (read/write/delete/list/edit/mkdir/stat) now come
//  from the workspace subsystem (src/mastra/workspace), which resolves paths
//  per-request to the current git worktree and enforces the protected-entry
//  denylist via ValidatingFilesystem. The two tools here have no direct
//  workspace analog and stay custom, using validatePath() for containment.
//
//  - globSearch: find files by name pattern (workspace has content grep /
//    semantic search, not name-based glob) — uses fast-glob.
//  - moveFile: atomic rename (workspace has no move/rename tool).
//
//  ❌ No git operations     → handled by workflow code steps
//  ❌ No ticket operations  → handled by workflow code steps
// ════════════════════════════════════════════════════════════════════

// ── Project Exploration (no shell, pure Node.js) ─────────────────────

export const globSearchTool = createTool({
  id: 'glob-search',
  description: `Search for files matching a glob pattern in the project.
Supports recursive patterns like "src/**/*.ts", "**/*.test.ts", "src/**/*.py", "**/test_*.py", etc.
Returns relative file paths sorted alphabetically. Use this instead of "find" — shell commands are restricted.`,
  inputSchema: z.object({
    pattern: z
      .string()
      .max(500, 'Pattern too long — maximum 500 characters')
      .describe(
        'Glob pattern relative to project root (e.g. "src/**/*.ts", "tests/**/*.test.ts", "src/**/*.py", "tests/**/*.py")'
      ),
  }),
  execute: async (inputData) => {
    const validation = validatePath('.', 'read');
    if (!validation.allowed) {
      return { content: '', error: validation.reason };
    }

    const root = validation.resolvedPath;

    const files = await fg(inputData.pattern, {
      cwd: root,
      onlyFiles: true,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/__pycache__/**',
        '**/.venv/**',
        '**/*.egg-info/**',
        '**/.pytest_cache/**',
      ],
      absolute: false,
      unique: true,
    });

    const results = files.sort();
    log.info({ pattern: inputData.pattern, count: results.length }, 'Glob search complete');
    return { files: results, pattern: inputData.pattern };
  },
});

// ── Filesystem Tool (path-validated) ──────────────────────────────────

export const fileMoveTool = createTool({
  id: 'file-move',
  description: `Move or rename a file or directory. Use relative paths for both source and destination.`,
  inputSchema: z.object({
    sourcePath: z.string().describe('Relative source path'),
    destinationPath: z.string().describe('Relative destination path'),
  }),
  execute: async (inputData) => {
    const srcValidation = validatePath(inputData.sourcePath, 'read');
    if (!srcValidation.allowed) {
      return { success: false, error: `Source: ${srcValidation.reason}` };
    }

    const dstValidation = validatePath(inputData.destinationPath, 'write');
    if (!dstValidation.allowed) {
      return { success: false, error: `Destination: ${dstValidation.reason}` };
    }

    if (!fs.existsSync(srcValidation.resolvedPath)) {
      return { success: false, error: `Source does not exist: ${inputData.sourcePath}` };
    }

    await fs.promises.mkdir(path.dirname(dstValidation.resolvedPath), { recursive: true });
    await fs.promises.rename(srcValidation.resolvedPath, dstValidation.resolvedPath);

    log.info({ from: inputData.sourcePath, to: inputData.destinationPath }, 'File moved');
    return { success: true, from: inputData.sourcePath, to: inputData.destinationPath };
  },
});
