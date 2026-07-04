import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// exec.ts не импортирует env/logger, но импортирует execa — мокаем его
const mockExeca = vi.fn();
vi.mock('execa', () => ({
  execa: (...args: [string, string[], Record<string, string>]) => mockExeca(...args),
}));

// precheck (tool-availability) тестируется отдельно; здесь изолируем exec-логику.
// По умолчанию инструмент доступен, PEP 621 OK — install/test доходят до execa.
const mockEnsureTool = vi.fn().mockResolvedValue(null);
const mockHasPep621 = vi.fn().mockReturnValue(true);
vi.mock('./tool-availability.js', () => ({
  ensureToolAvailable: (...args: [string]) => mockEnsureTool(...args),
  hasPep621Metadata: (...args: [string]) => mockHasPep621(...args),
  LEGACY_POETRY_V1_ERROR: 'LEGACY_POETRY_V1_ERROR_PLACEHOLDER',
}));

const { detectPackageManager, detectProjectStack, installProjectDependencies, runProjectTests } =
  await import('./exec.js');

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

describe('detectProjectStack', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-stack-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Node auto-detection ──────────────────────────────────────────

  it('detects node/pnpm from pnpm-lock.yaml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'node', manager: 'pnpm' });
  });

  it('detects node/npm from package-lock.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'node', manager: 'npm' });
  });

  // ── Python auto-detection: native lock (priority) ────────────────

  it('detects python/poetry from poetry.lock', () => {
    fs.writeFileSync(path.join(tmpDir, 'poetry.lock'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'python', manager: 'poetry' });
  });

  it('detects python/pdm from pdm.lock', () => {
    fs.writeFileSync(path.join(tmpDir, 'pdm.lock'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'python', manager: 'pdm' });
  });

  // ── Python auto-detection: uv fallback ───────────────────────────

  it('detects python/uv from uv.lock', () => {
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'python', manager: 'uv' });
  });

  it('detects python/uv-pip from bare requirements.txt (no pyproject.toml)', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'python', manager: 'uv-pip' });
  });

  it('detects python/uv from pyproject.toml (no native lock)', () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'python', manager: 'uv' });
  });

  it('prefers uv (project mode) over uv-pip when both pyproject.toml and requirements.txt exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), '');
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'python', manager: 'uv' });
  });

  // ── Native lock wins over uv fallback ────────────────────────────

  it('prefers native poetry.lock over pyproject.toml (uv)', () => {
    fs.writeFileSync(path.join(tmpDir, 'poetry.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'python', manager: 'poetry' });
  });

  // ── Make / null ──────────────────────────────────────────────────

  it('falls back to make stack when only Makefile exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'Makefile'), '');
    expect(detectProjectStack(tmpDir)).toEqual({ language: 'unknown', manager: 'make' });
  });

  it('returns null when no indicators present', () => {
    expect(detectProjectStack(tmpDir)).toBeNull();
  });
});

describe('runProjectTests', () => {
  const projectRoot = '/tmp/__cf_test_project__';

  beforeEach(() => {
    vi.clearAllMocks();
    // Дефолт precheck: инструмент доступен, PEP 621 OK
    mockEnsureTool.mockResolvedValue(null);
    mockHasPep621.mockReturnValue(true);
  });

  it('returns failure when no package manager detected', async () => {
    // mockExeca не будет вызван — detectProjectStack вернёт null
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

  // ── Python ───────────────────────────────────────────────────────

  it('runs uv run pytest for uv.lock', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');

    mockExeca.mockResolvedValue({ stdout: '3 passed', stderr: '', exitCode: 0 });

    const result = await runProjectTests(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'uv',
      ['run', 'pytest'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.passed).toBe(true);
    expect(result.command).toBe('uv run pytest');
    expect(result.manager).toBe('uv');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs uv run pytest for bare requirements.txt (uv-pip mode)', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'pytest>=8.0.0\n');

    mockExeca.mockResolvedValue({ stdout: '3 passed', stderr: '', exitCode: 0 });

    const result = await runProjectTests(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'uv',
      ['run', 'pytest'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.passed).toBe(true);
    expect(result.command).toBe('uv run pytest');
    expect(result.manager).toBe('uv-pip');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs poetry run pytest for poetry.lock', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'poetry.lock'), '');

    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const result = await runProjectTests(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'poetry',
      ['run', 'pytest'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.command).toBe('poetry run pytest');
    expect(result.manager).toBe('poetry');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs pdm run pytest for pdm.lock', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'pdm.lock'), '');

    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const result = await runProjectTests(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'pdm',
      ['run', 'pytest'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.command).toBe('pdm run pytest');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses -k filter flag for python managers (not --filter)', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');

    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const result = await runProjectTests(tmpDir, 'test_addition');
    expect(mockExeca).toHaveBeenCalledWith(
      'uv',
      ['run', 'pytest', '-k', 'test_addition'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.command).toBe('uv run pytest -k test_addition');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Precheck (health-check) integration ──────────────────────────

  it('returns precheck error when manager tool is unavailable', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');

    mockEnsureTool.mockResolvedValue("Tool 'uv' not found in PATH. Install: ...");

    const result = await runProjectTests(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.command).toBe('unknown');
    expect(result.manager).toBe('uv');
    expect(result.stderr).toContain("Tool 'uv' not found");
    // execa для test-команды не должен был вызваться (только precheck через mock)
    expect(mockExeca).not.toHaveBeenCalled();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns legacy Poetry v1 error when uv project lacks PEP 621', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-run-'));
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.poetry]\n');

    mockHasPep621.mockReturnValue(false);

    const result = await runProjectTests(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.stderr).toContain('LEGACY_POETRY_V1_ERROR_PLACEHOLDER');
    expect(mockExeca).not.toHaveBeenCalled();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('installProjectDependencies', () => {
  const projectRoot = '/tmp/__cf_test_project__';

  beforeEach(() => {
    vi.clearAllMocks();
    // Дефолт precheck: инструмент доступен, PEP 621 OK
    mockEnsureTool.mockResolvedValue(null);
    mockHasPep621.mockReturnValue(true);
  });

  it('returns failure when no package manager detected', async () => {
    const result = await installProjectDependencies(projectRoot);
    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.manager).toBeNull();
    expect(result.stderr).toContain('No package manager detected');
    expect(result.command).toBe('unknown');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('skips for make-managed projects', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'Makefile'), '');

    const result = await installProjectDependencies(tmpDir);
    expect(result.skipped).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.manager).toBe('make');
    expect(result.command).toBe('make (skipped)');
    expect(mockExeca).not.toHaveBeenCalled();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs pnpm install when pnpm-lock.yaml exists', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    mockExeca.mockResolvedValue({
      stdout: 'Progress: resolved 100, reused 100',
      stderr: '',
      exitCode: 0,
    });

    const result = await installProjectDependencies(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'pnpm',
      ['install'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.command).toBe('pnpm install');
    expect(result.manager).toBe('pnpm');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs npm install when package-lock.json exists', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');

    mockExeca.mockResolvedValue({
      stdout: 'added 42 packages',
      stderr: '',
      exitCode: 0,
    });

    const result = await installProjectDependencies(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'npm',
      ['install'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.passed).toBe(true);
    expect(result.command).toBe('npm install');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes exit code through when install fails', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');

    mockExeca.mockResolvedValue({
      stdout: '',
      stderr: 'ETARGET: no matching version',
      exitCode: 1,
    });

    const result = await installProjectDependencies(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.command).toBe('yarn install');
    expect(result.exitCode).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes custom timeout to execa', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');

    mockExeca.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    await installProjectDependencies(tmpDir, 10_000);
    expect(mockExeca).toHaveBeenCalledWith(
      'bun',
      ['install'],
      expect.objectContaining({ timeout: 10_000 })
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Python ───────────────────────────────────────────────────────

  it('runs uv sync for uv.lock (creates .venv + installs)', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');

    mockExeca.mockResolvedValue({ stdout: 'Resolved 10 packages', stderr: '', exitCode: 0 });

    const result = await installProjectDependencies(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'uv',
      ['sync'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.passed).toBe(true);
    expect(result.command).toBe('uv sync');
    expect(result.manager).toBe('uv');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs uv venv + uv pip install for bare requirements.txt (uv-pip mode)', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'pytest>=8.0.0\n');

    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const result = await installProjectDependencies(tmpDir);
    // Две последовательные команды
    expect(mockExeca).toHaveBeenNthCalledWith(
      1,
      'uv',
      ['venv'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(mockExeca).toHaveBeenNthCalledWith(
      2,
      'uv',
      ['pip', 'install', '-r', 'requirements.txt'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(mockExeca).toHaveBeenCalledTimes(2);
    expect(result.passed).toBe(true);
    expect(result.command).toBe('uv venv && uv pip install -r requirements.txt');
    expect(result.manager).toBe('uv-pip');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stops uv-pip sequence if venv creation fails', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'pytest\n');

    mockExeca
      .mockResolvedValueOnce({ stdout: '', stderr: 'venv error', exitCode: 1 })
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const result = await installProjectDependencies(tmpDir);
    expect(mockExeca).toHaveBeenCalledTimes(1); // pip install не должен был вызваться
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('venv error');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs poetry install for poetry.lock', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'poetry.lock'), '');

    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const result = await installProjectDependencies(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'poetry',
      ['install'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.command).toBe('poetry install');
    expect(result.manager).toBe('poetry');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs pdm install for pdm.lock', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'pdm.lock'), '');

    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const result = await installProjectDependencies(tmpDir);
    expect(mockExeca).toHaveBeenCalledWith(
      'pdm',
      ['install'],
      expect.objectContaining({ cwd: tmpDir })
    );
    expect(result.command).toBe('pdm install');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Precheck (health-check) integration ──────────────────────────

  it('returns precheck error when manager tool is unavailable', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');

    mockEnsureTool.mockResolvedValue("Tool 'uv' not found in PATH. Install: ...");

    const result = await installProjectDependencies(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.command).toBe('unknown');
    expect(result.manager).toBe('uv');
    expect(result.stderr).toContain("Tool 'uv' not found");
    expect(mockExeca).not.toHaveBeenCalled();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns legacy Poetry v1 error when uv project lacks PEP 621', async () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-exec-install-'));
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.poetry]\n');

    mockHasPep621.mockReturnValue(false);

    const result = await installProjectDependencies(tmpDir);
    expect(result.passed).toBe(false);
    expect(result.stderr).toContain('LEGACY_POETRY_V1_ERROR_PLACEHOLDER');
    expect(mockExeca).not.toHaveBeenCalled();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
