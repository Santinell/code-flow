import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mockExeca = vi.fn();
vi.mock('execa', () => ({
  execa: (...args: [string, string[], object]) => mockExeca(...args),
}));

const { ensureToolAvailable, getInstallHint, hasPep621Metadata, isToolAvailable } =
  await import('./tool-availability.js');

describe('isToolAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when execa exits 0', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0, failed: false });
    expect(await isToolAvailable('uv')).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('uv', ['--version'], expect.any(Object));
  });

  it('returns false when execa exits non-zero', async () => {
    mockExeca.mockResolvedValue({ exitCode: 127, failed: true });
    expect(await isToolAvailable('nonexistent-tool')).toBe(false);
  });

  it('returns false when execa throws (ENOENT)', async () => {
    mockExeca.mockRejectedValue(new Error('spawn ENOENT'));
    expect(await isToolAvailable('missing')).toBe(false);
  });
});

describe('getInstallHint', () => {
  it('returns a hint for known tools', () => {
    expect(getInstallHint('uv')).toContain('astral.sh/uv');
    expect(getInstallHint('poetry')).toContain('install.python-poetry.org');
    expect(getInstallHint('npm')).toContain('nodejs.org');
  });

  it('returns a generic hint for unknown tools', () => {
    expect(getInstallHint('strangetool')).toContain("Ensure 'strangetool'");
  });
});

describe('ensureToolAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when tool is available', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0, failed: false });
    expect(await ensureToolAvailable('uv')).toBeNull();
  });

  it('returns error message when tool is missing', async () => {
    mockExeca.mockResolvedValue({ exitCode: 127, failed: true });
    const error = await ensureToolAvailable('uv');
    expect(error).toContain("Tool 'uv' not found");
    expect(error).toContain('astral.sh/uv');
  });
});

describe('hasPep621Metadata', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'cf-pep621-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when pyproject.toml has [project] section', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[project]\nname = "myapp"\nversion = "0.1.0"\n`
    );
    expect(hasPep621Metadata(tmpDir)).toBe(true);
  });

  it('returns false when only legacy [tool.poetry.dependencies] exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[tool.poetry]\nname = "myapp"\n\n[tool.poetry.dependencies]\npython = "^3.11"\n`
    );
    expect(hasPep621Metadata(tmpDir)).toBe(false);
  });

  it('returns true when no pyproject.toml exists', () => {
    expect(hasPep621Metadata(tmpDir)).toBe(true);
  });

  it('returns true when [project] appears anywhere in the file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[build-system]\nrequires = ["hatchling"]\n\n[project]\nname = "x"\n`
    );
    expect(hasPep621Metadata(tmpDir)).toBe(true);
  });
});
