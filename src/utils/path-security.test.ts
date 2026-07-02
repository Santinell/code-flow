import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── Моки ДО импорта тестируемого модуля ──────────────────────────

// logger — полностью замокан, чтобы избежать getEnv()
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
vi.mock('./logger.js', () => ({
  createLogger: () => mockLogger,
}));

// worktree-context — мокаем getCurrentWorktreePath, чтобы избежать env.ts → process.exit
const mockGetCurrentWorktreePath = vi.fn(() => '/tmp/__cf_test_project__');
vi.mock('./worktree-context.js', () => ({
  getCurrentWorktreePath: () => mockGetCurrentWorktreePath(),
}));

// Импортируем тестируемый модуль (моки уже установлены)
const { validatePath, validatePaths } = await import('./path-security.js');

describe('validatePath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-ps-'));
    mockGetCurrentWorktreePath.mockReturnValue(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ── 1. Абсолютные пути ────────────────────────────────────────

  it('blocks absolute paths', () => {
    const result = validatePath('/etc/passwd', 'read');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Absolute paths are not allowed');
  });

  it('blocks absolute paths for write and delete', () => {
    expect(validatePath('/tmp/foo', 'write').allowed).toBe(false);
    expect(validatePath('/tmp/foo', 'delete').allowed).toBe(false);
  });

  // ── 2. Path traversal ─────────────────────────────────────────

  it('blocks path traversal outside project', () => {
    const result = validatePath('../../etc/passwd', 'read');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Path traversal');
  });

  it('allows normal relative paths', () => {
    const result = validatePath('src/index.ts', 'read');
    expect(result.allowed).toBe(true);
    expect(result.relativePath).toBe(path.join('src', 'index.ts'));
    expect(result.resolvedPath).toBe(path.join(tmpDir, 'src', 'index.ts'));
  });

  // ── 3. Symlink attacks ────────────────────────────────────────

  it('blocks symlink pointing outside project', () => {
    const linkPath = path.join(tmpDir, 'safe-dir');
    try {
      fs.symlinkSync('/etc', linkPath);
    } catch {
      // В ограниченных окружениях создание symlink может быть запрещено
      return;
    }

    const result = validatePath('safe-dir/passwd', 'read');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('symlink');
  });

  // ── 4. Protected entries — корневые директории ──────────────────

  it('blocks reading .git', () => {
    const result = validatePath('.git', 'read');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('read');
    expect(result.reason).toContain('protected');
    expect(result.reason).toContain('.git');
  });

  it('blocks writing to .env', () => {
    const result = validatePath('.env', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('write');
    expect(result.reason).toContain('.env');
  });

  it('blocks deleting .env.local', () => {
    const result = validatePath('.env.local', 'delete');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('delete');
  });

  // ── 5. Protected entries — все операции для каждого entry ────

  for (const op of ['read', 'write', 'delete'] as const) {
    it(`blocks ${op} on .env.production`, () => {
      expect(validatePath('.env.production', op).allowed).toBe(false);
    });
    it(`blocks ${op} on .env.development`, () => {
      expect(validatePath('.env.development', op).allowed).toBe(false);
    });
    it(`blocks ${op} on .env.staging`, () => {
      expect(validatePath('.env.staging', op).allowed).toBe(false);
    });
    it(`blocks ${op} on .env.test`, () => {
      expect(validatePath('.env.test', op).allowed).toBe(false);
    });
    it(`blocks ${op} on .ssh`, () => {
      expect(validatePath('.ssh', op).allowed).toBe(false);
    });
    it(`blocks ${op} on .npmrc`, () => {
      expect(validatePath('.npmrc', op).allowed).toBe(false);
    });
  }

  // ── 6. Protected entries — вложенные (basename) ────────────────

  it('blocks reading nested .env (subdir/.env)', () => {
    const result = validatePath('subdir/.env', 'read');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('.env');
  });

  it('blocks writing nested id_rsa (config/id_rsa)', () => {
    const result = validatePath('config/id_rsa', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('id_rsa');
  });

  it('blocks deleting nested .npmrc (deep/path/.npmrc)', () => {
    const result = validatePath('deep/path/.npmrc', 'delete');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('.npmrc');
  });

  // ── 7. .env.example — не защищён ──────────────────────────────

  it('allows reading .env.example (template)', () => {
    const result = validatePath('.env.example', 'read');
    expect(result.allowed).toBe(true);
  });

  it('allows writing .env.example', () => {
    const result = validatePath('.env.example', 'write');
    expect(result.allowed).toBe(true);
  });

  // ── 8. Protected entries — вложенные файлы внутри защищённых dirs

  it('blocks access to .git/config', () => {
    expect(validatePath('.git/config', 'read').allowed).toBe(false);
    expect(validatePath('.git/config', 'write').allowed).toBe(false);
  });

  it('blocks access to .ssh/id_rsa', () => {
    expect(validatePath('.ssh/id_rsa', 'read').allowed).toBe(false);
  });

  // ── 9. Логирование при блокировке protected entry ──────────────

  it('calls logger.warn when protected entry is accessed', () => {
    validatePath('.env', 'read');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'read', protectedName: '.env' }),
      'Access to protected entry blocked'
    );
  });
});

// ── validatePaths (batch) ────────────────────────────────────────

describe('validatePaths', () => {
  beforeEach(() => {
    mockGetCurrentWorktreePath.mockReturnValue('/tmp/__cf_batch_project__');
  });

  it('separates valid and blocked paths', () => {
    const result = validatePaths(['src/index.ts', '.env', 'README.md'], 'read');
    expect(result.valid).toHaveLength(2);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]!.reason).toContain('.env');
  });

  it('all blocked when all paths are protected', () => {
    const result = validatePaths(['.env', '.git', '.npmrc'], 'write');
    expect(result.valid).toHaveLength(0);
    expect(result.blocked).toHaveLength(3);
  });

  it('all valid when no protected paths', () => {
    const result = validatePaths(['src/index.ts', 'README.md', 'package.json'], 'read');
    expect(result.valid).toHaveLength(3);
    expect(result.blocked).toHaveLength(0);
  });
});
