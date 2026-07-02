import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function detectPackageManager(projectRoot: string): string | null {
  const indicators: Array<{ file: string; manager: string }> = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'bun.lockb', manager: 'bun' },
  ];
  for (const { file, manager } of indicators) {
    if (existsSync(join(projectRoot, file))) {
      return manager;
    }
  }
  if (existsSync(join(projectRoot, 'Makefile'))) {
    return 'make';
  }
  return null;
}

export async function execInDir(
  command: string,
  args: string[],
  cwd: string,
  timeout = 300_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa(command, args, {
    cwd,
    shell: false,
    reject: false,
    env: { ...process.env },
    timeout,
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? 0,
  };
}

export async function runProjectTests(
  cwd: string,
  filter?: string,
  timeout = 120_000
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  passed: boolean;
  command: string;
  manager: string | null;
}> {
  const manager = detectPackageManager(cwd);
  if (!manager) {
    return {
      stdout: '',
      stderr: 'No package manager detected — no lock file or Makefile found',
      exitCode: 1,
      passed: false,
      command: 'unknown',
      manager: null,
    };
  }

  const args = ['test'];

  if (filter && manager !== 'make') {
    args.push('--filter', filter);
  }

  const result = await execInDir(manager, args, cwd, timeout);
  return {
    ...result,
    passed: result.exitCode === 0,
    command: `${manager} ${args.join(' ')}`,
    manager,
  };
}
