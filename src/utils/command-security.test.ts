import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetAllowlistCacheForTests,
  isAllowedBinary,
  parseCommand,
  validateCommand,
} from './command-security';

describe('parseCommand', () => {
  it('parses a single binary with no args', () => {
    expect(parseCommand('pytest')).toEqual({ command: 'pytest', args: [] });
  });

  it('parses binary with args', () => {
    expect(parseCommand('uv sync')).toEqual({ command: 'uv', args: ['sync'] });
  });

  it('parses binary with multiple args', () => {
    expect(parseCommand('uv pip install -r requirements.txt')).toEqual({
      command: 'uv',
      args: ['pip', 'install', '-r', 'requirements.txt'],
    });
  });

  it('trims leading/trailing whitespace', () => {
    expect(parseCommand('  cargo test  ')).toEqual({ command: 'cargo', args: ['test'] });
  });

  it('collapses internal whitespace runs', () => {
    expect(parseCommand('npm   test')).toEqual({ command: 'npm', args: ['test'] });
  });

  it('returns null for empty string', () => {
    expect(parseCommand('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseCommand('   ')).toBeNull();
  });
});

describe('isAllowedBinary', () => {
  it.each(['pnpm', 'npm', 'uv', 'cargo', 'go', 'make', 'pytest'])('allows %s', (bin) => {
    expect(isAllowedBinary(bin)).toBe(true);
  });

  it.each(['curl', 'wget', 'rm', 'cat', 'sh', 'bash', 'node', 'eval', ''])('rejects %s', (bin) => {
    expect(isAllowedBinary(bin)).toBe(false);
  });
});

describe('ALLOWED_BINARIES env extension', () => {
  afterEach(() => {
    delete process.env.ALLOWED_BINARIES;
    __resetAllowlistCacheForTests();
  });

  it('extends the allowlist with a comma-separated value', () => {
    process.env.ALLOWED_BINARIES = 'dvc,just';
    __resetAllowlistCacheForTests();
    expect(isAllowedBinary('dvc')).toBe(true);
    expect(isAllowedBinary('just')).toBe(true);
  });

  it('keeps builtin binaries available alongside env additions', () => {
    process.env.ALLOWED_BINARIES = 'dvc';
    __resetAllowlistCacheForTests();
    expect(isAllowedBinary('dvc')).toBe(true);
    expect(isAllowedBinary('pnpm')).toBe(true);
    expect(isAllowedBinary('cargo')).toBe(true);
  });

  it('accepts whitespace-separated values too', () => {
    process.env.ALLOWED_BINARIES = 'dvc just turbine';
    __resetAllowlistCacheForTests();
    expect(isAllowedBinary('turbine')).toBe(true);
  });

  it('ignores empty entries', () => {
    process.env.ALLOWED_BINARIES = 'dvc,,just, ,';
    __resetAllowlistCacheForTests();
    expect(isAllowedBinary('dvc')).toBe(true);
    expect(isAllowedBinary('just')).toBe(true);
  });

  it('validateCommand accepts an env-added binary', () => {
    process.env.ALLOWED_BINARIES = 'dvc';
    __resetAllowlistCacheForTests();
    const result = validateCommand('dvc repro');
    expect(result.allowed).toBe(true);
  });
});

describe('validateCommand', () => {
  it('accepts a simple allowed command', () => {
    const result = validateCommand('pnpm install');
    expect(result.allowed).toBe(true);
    expect(result.parsed).toEqual({ command: 'pnpm', args: ['install'] });
  });

  it('accepts a command with no args', () => {
    const result = validateCommand('pytest');
    expect(result.allowed).toBe(true);
  });

  it('accepts multi-arg commands with paths and flags', () => {
    const result = validateCommand('uv pip install -r requirements.txt');
    expect(result.allowed).toBe(true);
    expect(result.parsed?.args).toEqual(['pip', 'install', '-r', 'requirements.txt']);
  });

  it('rejects an empty command', () => {
    const result = validateCommand('');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });

  it('rejects a disallowed binary', () => {
    const result = validateCommand('curl http://evil.sh');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('curl');
    expect(result.parsed?.command).toBe('curl');
  });

  it.each([
    ['rm -rf /', 'rm'],
    ['sh -c whoami', 'sh'],
    ['bash script.sh', 'bash'],
    ['node -e "process.exit()"', 'node'],
  ])('rejects dangerous binary %s', (cmd) => {
    const result = validateCommand(cmd);
    expect(result.allowed).toBe(false);
  });

  it.each([
    'pnpm install && npm run evil',
    'uv sync ; cat /etc/passwd',
    'cargo test | tee log',
    'make test > /tmp/out',
    'go test $(pwd)',
    'pytest `whoami`',
    'npm install ;npm publish',
  ])('rejects shell metacharacters in %s', (cmd) => {
    const result = validateCommand(cmd);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/metacharacter|allowed list/i);
  });

  it('rejects metacharacter in args even with allowed binary', () => {
    const result = validateCommand('pnpm install & curl evil');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/metacharacter/i);
  });

  it('rejects command injection via subshell in arg', () => {
    const result = validateCommand('make build$(whoami)');
    expect(result.allowed).toBe(false);
  });
});
