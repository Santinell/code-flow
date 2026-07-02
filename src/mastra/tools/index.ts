import { createTool } from '@mastra/core/tools';
import fg from 'fast-glob';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { runProjectTests } from '../../utils/exec.js';
import { createLogger } from '../../utils/logger.js';
import { validatePath } from '../../utils/path-security.js';

const log = createLogger('agent-tools');

// ════════════════════════════════════════════════════════════════════
//  AGENT TOOLS — only what agents are allowed to do directly
//
//  ❌ No git operations     → handled by workflow code steps
//  ❌ No Linear operations  → handled by workflow code steps
//  ✅ File read/write/delete → with path validation (sandboxed)
//  ✅ Restricted shell       → exact binary whitelist, no shell
// ════════════════════════════════════════════════════════════════════

// ── Filesystem Tools (path-validated) ──────────────────────────────

export const fileReadTool = createTool({
  id: 'file-read',
  description: 'Read the contents of a file in the target project. Use a relative path.',
  inputSchema: z.object({
    path: z.string().describe('Relative file path within the project'),
  }),
  execute: async (inputData) => {
    const validation = validatePath(inputData.path, 'read');
    if (!validation.allowed) {
      return { content: '', error: validation.reason };
    }

    if (!fs.existsSync(validation.resolvedPath)) {
      return { content: '', error: `File not found: ${inputData.path}` };
    }

    const content = await fs.promises.readFile(validation.resolvedPath, 'utf-8');
    log.info({ path: inputData.path, size: content.length }, 'File read');
    return { content, path: inputData.path };
  },
});

export const fileWriteTool = createTool({
  id: 'file-write',
  description: 'Write or create a file in the target project. Use a relative path.',
  inputSchema: z.object({
    path: z.string().describe('Relative file path within the project'),
    content: z.string().describe('File content to write'),
  }),
  execute: async (inputData) => {
    const validation = validatePath(inputData.path, 'write');
    if (!validation.allowed) {
      return { success: false, error: validation.reason };
    }

    await fs.promises.mkdir(path.dirname(validation.resolvedPath), { recursive: true });
    await fs.promises.writeFile(validation.resolvedPath, inputData.content, 'utf-8');

    log.info({ path: inputData.path }, 'File written');
    return { success: true, path: inputData.path };
  },
});

export const fileDeleteTool = createTool({
  id: 'file-delete',
  description: `Delete a file or directory in the target project. Use a relative path.
Supports both files and directories (directories are deleted recursively).
Cannot delete protected paths: .git, .env, .env.local, etc.
Use with caution — prefer moving/refactoring over deleting when possible.`,
  inputSchema: z.object({
    path: z.string().describe('Relative path to file or directory to delete'),
  }),
  execute: async (inputData) => {
    const validation = validatePath(inputData.path, 'delete');
    if (!validation.allowed) {
      return { success: false, error: validation.reason };
    }

    const fullPath = validation.resolvedPath;

    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `Path does not exist: ${inputData.path}` };
    }

    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      await fs.promises.rm(fullPath, { recursive: true });
      log.info({ path: inputData.path, type: 'directory' }, 'Directory deleted');
    } else {
      await fs.promises.unlink(fullPath);
      log.info({ path: inputData.path, type: 'file' }, 'File deleted');
    }

    return { success: true, deletedPath: inputData.path, wasDirectory: stat.isDirectory() };
  },
});

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

// ── Project Exploration Tools (no shell, pure Node.js) ─────────────

export const listDirTool = createTool({
  id: 'list-dir',
  description: `List the contents of a directory in the project. Returns an array of entry names.
Use this instead of "ls" or "ls -la" — shell commands are restricted.
Directories are suffixed with "/" for easy identification.`,
  inputSchema: z.object({
    path: z
      .string()
      .describe('Relative directory path within the project (e.g. "src/", "tests/unit")'),
  }),
  execute: async (inputData) => {
    const validation = validatePath(inputData.path, 'read');
    if (!validation.allowed) {
      return { content: '', error: validation.reason };
    }

    if (!fs.existsSync(validation.resolvedPath)) {
      return { content: '', error: `Directory not found: ${inputData.path}` };
    }

    const stat = fs.statSync(validation.resolvedPath);
    if (!stat.isDirectory()) {
      return { content: '', error: `Not a directory: ${inputData.path}` };
    }

    const entries = await fs.promises.readdir(validation.resolvedPath, { withFileTypes: true });
    const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

    log.info({ path: inputData.path, count: names.length }, 'Directory listed');
    return { entries: names, path: inputData.path };
  },
});

export const globSearchTool = createTool({
  id: 'glob-search',
  description: `Search for files matching a glob pattern in the project.
Supports recursive patterns like "src/**/*.ts", "**/*.test.ts", etc.
Returns relative file paths sorted alphabetically. Use this instead of "find" — shell commands are restricted.`,
  inputSchema: z.object({
    pattern: z
      .string()
      .max(500, 'Pattern too long — maximum 500 characters')
      .describe('Glob pattern relative to project root (e.g. "src/**/*.ts", "tests/**/*.test.ts")'),
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
      ignore: ['**/node_modules/**', '**/.git/**'],
      absolute: false,
      unique: true,
    });

    const results = files.sort();
    log.info({ pattern: inputData.pattern, count: results.length }, 'Glob search complete');
    return { files: results, pattern: inputData.pattern };
  },
});

export const runTestsTool = createTool({
  id: 'run-tests',
  description: `Run the project's test suite. Auto-detects the package manager (npm, pnpm, yarn, bun, make).
Use this instead of "npm test", "pnpm test", etc. — it picks the right command automatically.
Optionally pass a filter to run a specific test file or test name.`,
  inputSchema: z.object({
    filter: z
      .string()
      .optional()
      .describe(
        'Optional: test file path or test name pattern to run (e.g. "src/utils/format.test.ts" or "formatName")'
      ),
  }),
  execute: async (inputData) => {
    const validation = validatePath('.', 'read');
    if (!validation.allowed) {
      return { stdout: '', stderr: validation.reason ?? 'Path not allowed', exitCode: 1 };
    }

    const projectRoot = path.dirname(validation.resolvedPath);
    const result = await runProjectTests(projectRoot, inputData.filter);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      manager: result.manager,
      command: result.command,
    };
  },
});
