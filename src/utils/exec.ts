import type { ParsedCommand } from './command-security';
import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEGACY_POETRY_V1_ERROR,
  ensureToolAvailable,
  hasPep621Metadata,
} from './tool-availability';

// ════════════════════════════════════════════════════════════════════
//  Project stack detection (language + package manager)
//  PYTHON_PLAN.md §2.2–2.3
// ════════════════════════════════════════════════════════════════════

export type ProjectLanguage = 'node' | 'python' | 'unknown';

export interface ProjectStack {
  language: ProjectLanguage;
  manager: string;
}

interface StackIndicator {
  file: string;
  language: ProjectLanguage;
  manager: string;
}

// Порядок = приоритет автоопределения. Python-нативные lock-файлы (poetry/pdm)
// идут раньше uv-фоллбэка: чужой lock уважаем ради воспроизводимости резолва,
// т.к. uv его не читает (см. PYTHON_PLAN.md §2.2).
const STACK_INDICATORS: StackIndicator[] = [
  // Python — нативные lock-файлы (точное воспроизведение резолва)
  { file: 'poetry.lock', language: 'python', manager: 'poetry' },
  { file: 'pdm.lock', language: 'python', manager: 'pdm' },
  // Python — uv (проектный режим: uv sync / uv run)
  { file: 'uv.lock', language: 'python', manager: 'uv' },
  { file: 'pyproject.toml', language: 'python', manager: 'uv' },
  // Python — uv-pip (bare requirements.txt без pyproject.toml: pip-режим uv).
  // Должен идти ПОСЛЕ pyproject.toml, иначе requirements+pyproject даст pip-режим
  // вместо проектного. PYTHON_PLAN.md §2.2.
  { file: 'requirements.txt', language: 'python', manager: 'uv-pip' },
  // Node
  { file: 'pnpm-lock.yaml', language: 'node', manager: 'pnpm' },
  { file: 'package-lock.json', language: 'node', manager: 'npm' },
  { file: 'yarn.lock', language: 'node', manager: 'yarn' },
  { file: 'bun.lockb', language: 'node', manager: 'bun' },
];

/**
 * Определяет стек проекта по файлам-индикаторам в директории: язык + менеджер.
 *
 * Стратегия (PYTHON_PLAN.md §2.3) — чистое динамическое детектирование по приоритету
 * индикаторов. Override-флаг намеренно НЕ используется: он глобальный и
 * неприменим в монорепо, где разные пакеты на разных языках (MONOREPO_PLAN.md M4).
 * Функция per-directory — детект для worktreePath + targetPath даёт правильный стек
 * для конкретного пакета.
 *
 * Python: poetry.lock/pdm.lock → нативный менеджер (ради воспроизводимости);
 *         uv.lock или pyproject.toml → uv (проектный режим);
 *         bare requirements.txt без pyproject.toml → uv-pip (pip-режим uv).
 * Node: по lock-файлу (pnpm > npm > yarn > bun).
 * Make (только Makefile): { language: 'unknown', manager: 'make' } — legacy.
 */
export function detectProjectStack(projectRoot: string): ProjectStack | null {
  for (const { file, language, manager } of STACK_INDICATORS) {
    if (existsSync(join(projectRoot, file))) {
      return { language, manager };
    }
  }

  if (existsSync(join(projectRoot, 'Makefile'))) {
    return { language: 'unknown', manager: 'make' };
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════
//  Command builders per language
// ════════════════════════════════════════════════════════════════════

export function buildTestCommand(
  stack: ProjectStack,
  filter?: string
): { command: string; args: string[] } {
  if (stack.language === 'node') {
    const args = ['test'];
    if (filter) {
      args.push('--filter', filter);
    }
    return { command: stack.manager, args };
  }

  // python: uv/uv-pip/poetry/pdm → "<binary> run pytest [-k <filter>]".
  // uv run находит готовый .venv в cwd и для проектного, и для pip-режима,
  // поэтому бинарный вызов одинаковый для 'uv' и 'uv-pip'. pytest использует
  // -k для фильтра по имени теста, не --filter (см. §2.4).
  const command = stack.manager === 'uv-pip' ? 'uv' : stack.manager;
  const args = ['run', 'pytest'];
  if (filter) {
    args.push('-k', filter);
  }
  return { command, args };
}

// Возвращает последовательность команд install. Большинство стеков — одна
// команда; uv-pip (bare requirements.txt) — две: создать venv + поставить.
export function buildInstallCommand(stack: ProjectStack): { command: string; args: string[] }[] {
  if (stack.language === 'node') {
    return [{ command: stack.manager, args: ['install'] }];
  }

  // python: uv → "uv sync" (создаёт .venv + ставит); poetry/pdm → "<mgr> install".
  if (stack.manager === 'uv') {
    return [{ command: 'uv', args: ['sync'] }];
  }
  if (stack.manager === 'uv-pip') {
    // pip-режим: uv sync требует pyproject.toml, которого здесь нет.
    // Поэтому вручную: создать venv, потом поставить из requirements.txt.
    // uv run pytest затем сам найдёт готовый .venv.
    return [
      { command: 'uv', args: ['venv'] },
      { command: 'uv', args: ['pip', 'install', '-r', 'requirements.txt'] },
    ];
  }
  return [{ command: stack.manager, args: ['install'] }];
}

// ════════════════════════════════════════════════════════════════════
//  Execution helpers
// ════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════
//  Generic command execution (for LLM-derived commands on unknown stacks)
//
//  These run pre-validated commands (see command-security.ts) without going
//  through detectProjectStack. They exist alongside the stack-aware
//  install/test helpers so the known-stack path stays untouched and tested.
// ════════════════════════════════════════════════════════════════════

export interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  passed: boolean;
  command: string;
}

/**
 * Runs a single command in cwd via execa({ shell: false }). The caller must
 * have already validated the command via validateCommand().
 */
export async function runSingleCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout = 120_000
): Promise<CommandRunResult> {
  const result = await execInDir(command, args, cwd, timeout);
  return {
    ...result,
    passed: result.exitCode === 0,
    command: `${command} ${args.join(' ')}`.trim(),
  };
}

/**
 * Runs a sequence of commands in order, stopping at the first failure.
 * Used for multi-step installs (e.g. `uv venv` then `uv pip install ...`)
 * derived from the analyze step's structured output. Each command must be
 * pre-validated via validateCommand().
 */
export async function runCommandSequence(
  commands: ParsedCommand[],
  cwd: string,
  timeout = 300_000
): Promise<CommandRunResult> {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  for (const { command, args } of commands) {
    const result = await execInDir(command, args, cwd, timeout);
    stdout += result.stdout;
    stderr += result.stderr;
    exitCode = result.exitCode;
    if (exitCode !== 0) {
      break; // mirrors installProjectDependencies: stop on first failure
    }
  }

  const commandLabel = commands.map((c) => `${c.command} ${c.args.join(' ')}`).join(' && ');

  return {
    stdout,
    stderr,
    exitCode,
    passed: exitCode === 0,
    command: commandLabel,
  };
}

const NO_MANAGER_ERROR = 'No package manager detected — no lock file or Makefile found';

/**
 * Пре-проверки перед запуском install/test: доступность инструмента менеджера
 * и (для uv) наличие PEP 621 в pyproject.toml. PYTHON_PLAN.md Фаза 2.
 *
 * Возвращает текст ошибки, либо null если всё ок. Не бросает.
 */
async function precheck(cwd: string, stack: ProjectStack): Promise<string | null> {
  // uv-pip использует тот же бинарник `uv`, что и проектный режим.
  const tool = stack.manager === 'uv-pip' ? 'uv' : stack.manager;

  // 1. Инструмент менеджера должен быть в PATH
  const toolError = await ensureToolAvailable(tool);
  if (toolError) {
    return toolError;
  }

  // 2. uv (проектный режим) не парсит legacy [tool.poetry.dependencies] — только
  // PEP 621 [project]. uv-pip это не касается: pip-style с requirements.txt
  // легитимен без pyproject.toml. PYTHON_PLAN.md §2.2.
  if (stack.manager === 'uv' && !hasPep621Metadata(cwd)) {
    return LEGACY_POETRY_V1_ERROR;
  }

  return null;
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
  const stack = detectProjectStack(cwd);
  if (!stack) {
    return {
      stdout: '',
      stderr: NO_MANAGER_ERROR,
      exitCode: 1,
      passed: false,
      command: 'unknown',
      manager: null,
    };
  }

  // Make-проекты: legacy, filter не поддерживается
  if (stack.language === 'unknown' && stack.manager === 'make') {
    const result = await execInDir('make', ['test'], cwd, timeout);
    return { ...result, passed: result.exitCode === 0, command: 'make test', manager: 'make' };
  }

  const precheckError = await precheck(cwd, stack);
  if (precheckError) {
    return {
      stdout: '',
      stderr: precheckError,
      exitCode: 1,
      passed: false,
      command: 'unknown',
      manager: stack.manager,
    };
  }

  const { command, args } = buildTestCommand(stack, filter);
  const result = await execInDir(command, args, cwd, timeout);
  return {
    ...result,
    passed: result.exitCode === 0,
    command: `${command} ${args.join(' ')}`,
    manager: stack.manager,
  };
}

/**
 * Восстанавливает зависимости через обнаруженный пакетный менеджер (node или python).
 *
 * Python (PYTHON_PLAN.md §2.2):
 *  - uv: `uv sync` — сам создаёт .venv и ставит Python.
 *  - uv-pip (bare requirements.txt): `uv venv` + `uv pip install -r requirements.txt`.
 *  - poetry/pdm: `<mgr> install` — нативный менеджер, уважаем lock ради воспроизводимости.
 * Node: `<manager> install`.
 * Make: skip — такие проекты управляют зависимостями сами.
 *
 * Команды выполняются последовательно; при первом провале оставшиеся не идут.
 * `command` в отчёте — вся цепочка через `&&` (как было бы в shell).
 */
export async function installProjectDependencies(
  cwd: string,
  timeout = 300_000
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  passed: boolean;
  skipped: boolean;
  command: string;
  manager: string | null;
}> {
  const stack = detectProjectStack(cwd);
  if (!stack) {
    return {
      stdout: '',
      stderr: NO_MANAGER_ERROR,
      exitCode: 1,
      passed: false,
      skipped: false,
      command: 'unknown',
      manager: null,
    };
  }

  // Make-проекты управляют зависимостями сами — install-таргет не универсален.
  if (stack.language === 'unknown' && stack.manager === 'make') {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      passed: true,
      skipped: true,
      command: 'make (skipped)',
      manager: 'make',
    };
  }

  const precheckError = await precheck(cwd, stack);
  if (precheckError) {
    return {
      stdout: '',
      stderr: precheckError,
      exitCode: 1,
      passed: false,
      skipped: false,
      command: 'unknown',
      manager: stack.manager,
    };
  }

  const commands = buildInstallCommand(stack);
  const commandLabel = commands.map((c) => `${c.command} ${c.args.join(' ')}`).join(' && ');

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  for (const { command, args } of commands) {
    const result = await execInDir(command, args, cwd, timeout);
    stdout += result.stdout;
    stderr += result.stderr;
    exitCode = result.exitCode;
    if (exitCode !== 0) {
      break; // не продолжаем после провала
    }
  }

  return {
    stdout,
    stderr,
    exitCode,
    passed: exitCode === 0,
    skipped: false,
    command: commandLabel,
    manager: stack.manager,
  };
}
