import { execa } from 'execa';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('tool-availability');

/**
 * Проверяет, доступен ли инструмент в окружении (т.е. есть ли в PATH).
 * PYTHON_PLAN.md Фаза 2 — понятные ошибки вместо молчаливых ENOENT из execa.
 *
 * Использует `<tool> --version` (надёжнее `which`/`where`: кросс-платформенно,
 * не зависит от shell-утилит). Не бросает — возвращает boolean.
 */
export async function isToolAvailable(tool: string): Promise<boolean> {
  try {
    const result = await execa(tool, ['--version'], {
      shell: false,
      reject: false,
      timeout: 10_000,
    });
    return result.exitCode === 0 || result.failed === false;
  } catch {
    return false;
  }
}

/**
 * Понятное сообщение об установке для каждого инструмента.
 * Помогает пользователю сразу понять, что сделать, а не гуглить.
 */
const INSTALL_HINTS: Record<string, string> = {
  uv: 'Install: curl -LsSf https://astral.sh/uv/install.sh | sh',
  poetry: 'Install: curl -sSL https://install.python-poetry.org | python3 -',
  pdm: 'Install: curl -sSLO https://pdm-project.org/install-pdm.py && python3 install-pdm.py',
  pnpm: 'Install: npm install -g pnpm  (or: curl -fsSL https://get.pnpm.io/install.sh | sh -)',
  npm: 'Install: install Node.js (includes npm) from https://nodejs.org',
  yarn: 'Install: npm install -g yarn',
  bun: 'Install: curl -fsSL https://bun.sh/install | bash',
  make: 'Install: system package manager (e.g. apt install make)',
};

export function getInstallHint(tool: string): string {
  return INSTALL_HINTS[tool] ?? `Ensure '${tool}' is installed and on your PATH`;
}

/**
 * Проверяет доступность инструмента менеджера и возвращает понятную ошибку,
 * если его нет. Возвращает null, если инструмент доступен.
 */
export async function ensureToolAvailable(tool: string): Promise<string | null> {
  if (await isToolAvailable(tool)) {
    return null;
  }
  return `Tool '${tool}' not found in PATH. ${getInstallHint(tool)}`;
}

// ════════════════════════════════════════════════════════════════════
//  Legacy Poetry v1 detection
//  PYTHON_PLAN.md §2.2 / Фаза 2 — единственный реальный gap uv:
//  pyproject.toml со старым [tool.poetry.dependencies] вместо PEP 621 [project].
// ════════════════════════════════════════════════════════════════════

const LEGACY_POETRY_V1_ERROR = `Project uses legacy Poetry v1 metadata in pyproject.toml, which uv cannot parse.
Options:
  - Commit poetry.lock so code-flow uses native poetry (recommended for production reproducibility)
  - Migrate the project to PEP 621 manually, or via \`uvx migrate-to-uv\` (https://github.com/osprey-oss/migrate-to-uv)
    NOTE: migration rewrites package-manager infrastructure — run it as a deliberate, reviewed change, not via code-flow.`;

/**
 * Проверяет, что pyproject.toml содержит стандартную PEP 621 секцию [project].
 * Если есть только legacy [tool.poetry.dependencies] — uv не сможет его распарсить.
 *
 * Возвращает true, если проект на PEP 621 (uv-safe).
 * Возвращает false только если pyproject.toml есть, но [project]-секции в нём нет
 * (т.е. это потенциально legacy Poetry v1 без poetry.lock).
 */
export function hasPep621Metadata(projectRoot: string): boolean {
  const pyprojectPath = join(projectRoot, 'pyproject.toml');
  if (!existsSync(pyprojectPath)) {
    return true; // нет pyproject.toml — не наша забота (PEP 621 не требуется)
  }

  let content: string;
  try {
    content = readFileSync(pyprojectPath, 'utf-8');
  } catch {
    log.warn({ pyprojectPath }, 'Failed to read pyproject.toml for PEP 621 check');
    return true; // не блокируем — пусть uv выдаст свою ошибку
  }

  // Простейшая проверка: ищем [project] как заголовок секции TOML.
  // Не используем TOML-парсер ради одной проверки (нет зависимости).
  return /^\s*\[project\]/m.test(content);
}

export { LEGACY_POETRY_V1_ERROR };
