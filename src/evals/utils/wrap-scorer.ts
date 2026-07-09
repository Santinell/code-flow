import type { MastraScorer } from '@mastra/core/evals';
import { RequestContext } from '@mastra/core/request-context';
import { createLogger } from '#utils/logger';
import { runInWorktree } from '#utils/worktree-context';

const log = createLogger('wrap-scorer');

type ScorerRunArgs = Parameters<MastraScorer['run']>;
type ScorerRunResult = ReturnType<MastraScorer['run']>;

export type WrapScorerOptions = {
  /** Total attempts (including the first), e.g. 3 = 1 initial + 2 retries. */
  maxAttempts?: number;
  /** Decide whether a thrown scorer error should be retried. */
  shouldRetryError?: (error: Error) => boolean;
  /** Resolve a per-run worktree from the Mastra request context. */
  getWorktreePath?: (requestContext?: RequestContext) => string | undefined;
};

type ErrorValue = Error | object | string | undefined;

function getErrorValue(error: Error | object, key: string): ErrorValue {
  return error && typeof error === 'object' && key in error
    ? (error as Record<string, ErrorValue>)[key]
    : undefined;
}

function hasRetryableStructuredOutputError(error: Error): boolean {
  let current: Error | object | undefined = error;

  while (current && typeof current === 'object') {
    const id = getErrorValue(current, 'id');
    // const message =
    //   current instanceof Error
    //     ? current.message
    //     : typeof getErrorValue(current, 'message') === 'string'
    //       ? (getErrorValue(current, 'message') as string)
    //       : '';

    if (
      id === 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED' //||
      // message.includes('Structured output validation failed') ||
      // message.includes('Invalid JSON') ||
      // message.includes('No object generated')
    ) {
      return true;
    }

    const cause = getErrorValue(current, 'cause');
    current = cause && typeof cause === 'object' ? cause : undefined;
  }

  return false;
}

/**
 * Wraps a Mastra scorer so prompt-object judge failures caused by invalid
 * JSON/structured output are retried without re-running the target agent.
 */
export function wrapScorer<TScorer extends MastraScorer>(
  scorer: TScorer,
  options: WrapScorerOptions = {}
): TScorer {
  const maxAttempts = options.maxAttempts ?? 3;
  const shouldRetryError = options.shouldRetryError ?? hasRetryableStructuredOutputError;

  const run = async (...args: ScorerRunArgs): Promise<Awaited<ScorerRunResult>> => {
    let lastError: Error | undefined;
    const requestContext =
      args[0].requestContext instanceof RequestContext ? args[0].requestContext : undefined;
    const worktreePath = options.getWorktreePath?.(requestContext);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const runScorer = () => scorer.run(...args);
        return await (worktreePath ? runInWorktree(worktreePath, runScorer) : runScorer());
      } catch (error) {
        const scorerError = error instanceof Error ? error : new Error(String(error));
        lastError = scorerError;

        if (attempt >= maxAttempts || !shouldRetryError(scorerError)) {
          throw scorerError;
        }

        log.warn(
          { attempt, maxAttempts, scorerId: scorer.id, error: scorerError },
          'Scorer run failed with retryable structured output error, retrying'
        );
      }
    }

    throw lastError ?? new Error(`Scorer ${scorer.id} failed without an error object`);
  };

  return new Proxy(scorer, {
    get(target, prop) {
      if (prop === 'run') {
        return run;
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
