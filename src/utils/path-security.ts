import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';
import { getCurrentWorktreePath } from './worktree-context.js';

const log = createLogger('path-security');

/**
 * Проверяет, что путь находится внутри целевого проекта.
 * Используется всеми filesystem-инструментами для защиты от path traversal.
 *
 * Защита:
 * 1. Resolve — убирает `..`, `.`, лишние слэши
 * 2. Realpath — раскрывает symlinks
 * 3. Проверка префикса — путь должен начинаться с WORKTREE_PATH
 */

// Директории/файлы, которые нельзя удалять даже внутри проекта
const PROTECTED_ENTRIES = new Set([
  '.git',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
]);

export interface PathValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath: string;
  relativePath: string;
}

/**
 * Валидирует и нормализует путь агента.
 * @param agentPath — относительный путь, который агент хочет использовать
 * @param operation — тип операции для более точных сообщений об ошибках
 */
export function validatePath(
  agentPath: string,
  operation: 'read' | 'write' | 'delete'
): PathValidationResult {
  const projectRoot = getCurrentWorktreePath();

  // 1. Запрет абсолютных путей — агент должен использовать относительные
  if (path.isAbsolute(agentPath)) {
    return {
      allowed: false,
      reason: `Absolute paths are not allowed. Use a relative path within the project.`,
      resolvedPath: '',
      relativePath: agentPath,
    };
  }

  // 2. Resolve относительно корня проекта
  const resolved = path.resolve(projectRoot, agentPath);

  // 3. Нормализуем корень тоже (на случай если в env путь с '..' или symlink)
  const normalizedRoot = path.resolve(projectRoot);

  // 4. Проверка что путь внутри проекта
  //    Сравниваем через relative: если начинается с '..' — значит снаружи
  const relative = path.relative(normalizedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    log.warn(
      { agentPath, resolved, projectRoot: normalizedRoot },
      'Path traversal attempt blocked'
    );
    return {
      allowed: false,
      reason: `Path "${agentPath}" resolves outside the project directory. Path traversal is not allowed.`,
      resolvedPath: resolved,
      relativePath: relative,
    };
  }

  // 5. Дополнительная проверка через realpath для существующих путей
  //    (ловит symlink-атаки вида: project/safe-dir → /etc/passwd)
  if (fs.existsSync(resolved)) {
    const realResolved = fs.realpathSync(resolved);
    const realRelative = path.relative(normalizedRoot, realResolved);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      log.warn(
        { agentPath, realResolved, projectRoot: normalizedRoot },
        'Symlink traversal attempt blocked'
      );
      return {
        allowed: false,
        reason: `Path "${agentPath}" points outside the project (symlink detected).`,
        resolvedPath: realResolved,
        relativePath: realRelative,
      };
    }
  }

  // 6. Проверка protected entries (только для delete)
  if (operation === 'delete') {
    const topSegment = relative.split(path.sep)[0];
    if (PROTECTED_ENTRIES.has(topSegment)) {
      return {
        allowed: false,
        reason: `Cannot delete "${topSegment}" — this directory/file is protected.`,
        resolvedPath: resolved,
        relativePath: relative,
      };
    }
  }

  return {
    allowed: true,
    resolvedPath: resolved,
    relativePath: relative,
  };
}

/**
 * Валидирует массив путей. Возвращает разделённые списки валидных и заблокированных.
 */
export function validatePaths(
  paths: string[],
  operation: 'read' | 'write' | 'delete'
): { valid: PathValidationResult[]; blocked: PathValidationResult[] } {
  const results = paths.map((p) => validatePath(p, operation));
  return {
    valid: results.filter((r) => r.allowed),
    blocked: results.filter((r) => !r.allowed),
  };
}
