import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// exec.ts не импортирует env/logger, но импортирует execa — мокаем его
const mockExeca = vi.fn();
vi.mock('execa', () => ({
  execa: (...args: [string, string[], Record<string, string>]) => mockExeca(...args),
}));

const { detectPackageManager, runProjectTests } = await import('./exec.js');

describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects pnpm (highest priority)', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('detects npm when pnpm lock is absent', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');
    expect(detectPackageManager(tmpDir)).toBe('npm');
  });

  it('detects yarn when npm and pnpm locks are absent', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(detectPackageManager(tmpDir)).toBe('yarn');
  });

  it('detects bun when only bun lockb exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(detectPackageManager(tmpDir)).toBe('bun');
  });

  it('falls back to make when only Makefile exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'Makefile'), '');
    expect(detectPackageManager(tmpDir)).toBe('make');
  });

  it('returns null when no indicators are present', () => {
    expect(detectPackageManager(tmpDir)).toBeNull();
  });

  it('respects priority order: pnpm > npm > yarn > bun', () => {
    // Все lock-файлы присутствуют — pnpm должен выиграть
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });
});

describe('runProjectTests', () => {
  const projectRoot = '/tmp/__cf_test_project__';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns failure when no package manager detected', async () => {
    // mockExeca не будет вызван — detectPackageManager вернёт null
    const result = await runProjectTests(projectRoot);
    expect(result.passed).toBe(false);
    expect(result.manager).toBeNull();
    expect(result.stderr).toContain('No package manager detected');
    expect(result.command).toBe('unknown');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('calls execa with npm test when package-lock.json exists', async () => {
    // Создаём временную директорию с package-lock.json
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');

    mockExeca.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    });

    const result = await runProjectTests(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'npm',
      ['test'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.passed).toBe(true);
    expect(result.command).toBe('npm test');
    expect(result.manager).toBe('npm');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes exit code correctly when tests fail', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    mockExeca.mockResolvedValue({
      stdout: 'FAIL',
      stderr: '2 tests failed',
      exitCode: 1,
    });

    const result = await runProjectTests(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.command).toBe('pnpm test');
    expect(result.exitCode).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds --filter flag for non-make managers', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');

    mockExeca.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const result = await runProjectTests(tmpDir, 'my-filter');
    expect(mockExeca).toHaveBeenCalledWith(
      'yarn',
      ['test', '--filter', 'my-filter'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.command).toBe('yarn test --filter my-filter');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not add --filter for make manager', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'Makefile'), '');

    mockExeca.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const result = await runProjectTests(tmpDir, 'should-be-ignored');
    expect(mockExeca).toHaveBeenCalledWith(
      'make',
      ['test'], // без --filter
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.command).toBe('make test');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes custom timeout to execa', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');

    mockExeca.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    await runProjectTests(tmpDir, undefined, 5000);
    expect(mockExeca).toHaveBeenCalledWith(
      'bun',
      ['test'],
      expect.objectContaining({ timeout: 5000 })
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
