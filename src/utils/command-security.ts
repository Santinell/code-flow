// ════════════════════════════════════════════════════════════════════
//  Command security — validation layer for LLM-generated commands.
//
//  Mirrors path-security.ts: commands produced by the analyze step's
//  structured output are untrusted and must be validated before execution.
//  This enforces an allowlist of binaries and rejects shell metacharacters
//  so commands run via execa({ shell: false }) safely.
// ════════════════════════════════════════════════════════════════════

export interface ParsedCommand {
  command: string;
  args: string[];
}

/**
 * Built-in binaries the agent-derived commands are allowed to invoke.
 *
 * Covers the package managers / test runners / build tools across the
 * supported stacks. Extend via the `ALLOWED_BINARIES` env var (which
 * supplements this set) rather than editing here when possible.
 */
const BUILTIN_ALLOWED_BINARIES = new Set<string>([
  // Node
  'pnpm',
  'npm',
  'yarn',
  'bun',
  // Python
  'uv',
  'poetry',
  'pdm',
  'pip',
  'python',
  'pytest',
  // Rust / Go / Java / Kotlin
  'cargo',
  'go',
  'gradle',
  'mvn',
  // C/C++ / Make
  'make',
  'cmake',
  'ninja',
  // Ruby / PHP / Elixir
  'bundle',
  'bundler',
  'composer',
  'mix',
]);

/**
 * Effective allowlist = built-in set ∪ ALLOWED_BINARIES env var.
 *
 * Parsed lazily on first use. The env value is a comma- or space-separated
 * list and only ever extends the built-ins — it cannot remove entries, so
 * core package managers (pnpm/uv/cargo/...) stay available regardless.
 *
 * Reads `process.env` directly (not via `getEnv()`) because this is a leaf
 * utility imported widely; going through the env loader would couple it to
 * the full env schema and its exit(1)-on-misconfig behavior.
 */
let effectiveAllowlist: Set<string> | undefined;

function getEffectiveAllowlist(): Set<string> {
  if (effectiveAllowlist) {
    return effectiveAllowlist;
  }
  const extra = process.env.ALLOWED_BINARIES?.trim();
  effectiveAllowlist = new Set(BUILTIN_ALLOWED_BINARIES);
  if (extra) {
    for (const bin of extra.split(/[,\s]+/)) {
      const trimmed = bin.trim();
      if (trimmed) {
        effectiveAllowlist.add(trimmed);
      }
    }
  }
  return effectiveAllowlist;
}

/**
 * Shell metacharacters that must never appear in a command or its args.
 * Because execa runs with `shell: false`, these could only inject if they
 * reached a tool that re-shells — but rejecting them here is defense-in-depth
 * and keeps the surfaced command string honest.
 */
const SHELL_METACHARS = /[|;&`$<>(){}\\\n\r]/;

export function isAllowedBinary(binary: string): boolean {
  return getEffectiveAllowlist().has(binary);
}

/**
 * Resets the lazily-built allowlist cache. Only for tests that mutate
 * ALLOWED_BINARIES on process.env between cases.
 */
export function __resetAllowlistCacheForTests(): void {
  effectiveAllowlist = undefined;
}

/**
 * Splits a command string into `{ command, args }` by whitespace.
 *
 * Intentionally simple: no quote handling, no shell syntax. The agent is
 * instructed to produce plain `binary arg arg` forms. Anything needing quotes
 * or operators is inherently shell-y and should be rejected.
 *
 * Returns null for empty / whitespace-only input.
 */
export function parseCommand(commandStr: string): ParsedCommand | null {
  const trimmed = commandStr.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  return { command: parts[0]!, args: parts.slice(1) };
}

export interface CommandValidationResult {
  allowed: boolean;
  parsed?: ParsedCommand;
  reason?: string;
}

/**
 * Validates a single command string for safe execution.
 *
 * Checks:
 *  1. Parses into a non-empty binary + args.
 *  2. Binary is in the allowlist.
 *  3. No shell metacharacters in the binary or any arg.
 *
 * Follows the "return reason, don't throw" convention of ensureToolAvailable /
 * precheck in exec.ts.
 */
export function validateCommand(commandStr: string): CommandValidationResult {
  const parsed = parseCommand(commandStr);
  if (!parsed) {
    return { allowed: false, reason: 'Empty command' };
  }

  const metacharHit = SHELL_METACHARS.exec(parsed.command);
  if (metacharHit) {
    return {
      allowed: false,
      parsed,
      reason: `Shell metacharacter '${metacharHit[0]}' not allowed in command '${parsed.command}'`,
    };
  }

  if (!isAllowedBinary(parsed.command)) {
    return {
      allowed: false,
      parsed,
      reason: `Binary '${parsed.command}' is not in the allowed list`,
    };
  }

  for (const arg of parsed.args) {
    const argHit = SHELL_METACHARS.exec(arg);
    if (argHit) {
      return {
        allowed: false,
        parsed,
        reason: `Shell metacharacter '${argHit[0]}' not allowed in argument '${arg}'`,
      };
    }
  }

  return { allowed: true, parsed };
}
