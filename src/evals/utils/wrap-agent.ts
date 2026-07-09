import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { WORKTREE_PATH_CONTEXT_KEY } from '#mastra/workspace';
import { createLogger } from '#utils/logger';
import { runInWorktree } from '#utils/worktree-context';

const log = createLogger('wrap-agent');

type GenerateArgs = Parameters<Agent['generate']>;
export type GenerateResult = Awaited<ReturnType<Agent['generate']>>;

export type WrapAgentOptions = {
  retryOptions?: {
    /** Total attempts (including the first), e.g. 3 = 1 initial + 2 retries. */
    maxAttempts: number;
    /** Schema used by the default structured-output retry predicate. */
    schema: z.ZodSchema;
    /**
     * Decide whether a generate() result should be retried, e.g. because
     * structuredOutput failed to parse into anything usable.
     */
    shouldRetry?: (result: GenerateResult) => boolean;
  };
  /** Resolve a per-run worktree from the Mastra request context. */
  getWorktreePath: (requestContext?: RequestContext) => string | undefined;
};

function hasRetryableStructuredOutputError(schema: z.ZodSchema, result: GenerateResult): boolean {
  const text = result.text?.trim() ?? '';
  if (text.length === 0) {
    return true;
  }
  const parsed = schema.safeParse(result.object);
  return !parsed.success;
}

// generate()'s overloads collapse Parameters to a 1-tuple, so we restate the
// call shape we actually depend on (prompt + optional options object).
type GeneratePrompt = GenerateArgs[0];
type GenerateOptions = {
  requestContext?: RequestContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};
type GenerateArgsRest = [prompt: GeneratePrompt, options?: GenerateOptions];

/**
 * Wraps a Mastra Agent so that `generate()` transparently retries when the
 * model returns a semantically broken response (e.g. empty text, or output
 * that fails structuredOutput parsing) — cases `modelSettings.maxRetries`
 * does not cover, since those are HTTP/transport retries, not "the call
 * succeeded but the content is unusable" retries.
 *
 * Implemented as a Proxy so it stays a drop-in `Agent` for callers like
 * `runEvals()` that introspect the target (getModel, mastra, id, etc.) —
 * only `generate` is intercepted.
 */
export function wrapAgent<TAgent extends Agent>(agent: TAgent, options: WrapAgentOptions): TAgent {
  const retryOptions = options.retryOptions;
  const maxAttempts = retryOptions?.maxAttempts ?? 1;
  const shouldRetry =
    retryOptions?.shouldRetry ??
    (retryOptions
      ? hasRetryableStructuredOutputError.bind(null, retryOptions.schema)
      : () => false);

  const generate = async (...args: GenerateArgs): Promise<GenerateResult> => {
    let lastResult: GenerateResult | undefined;
    const [generatePrompt, generateOptions] = args as GenerateArgsRest;
    const worktreePath = options.getWorktreePath(generateOptions?.requestContext);

    // Inject the worktree path into requestContext so the resolver-backed
    // workspace filesystem resolves to the correct sandbox/worktree. Merges
    // with any existing requestContext from the caller (evals may set their
    // own keys). Custom tools (globSearch, moveFile) still resolve via the
    // runInWorktree AsyncLocalStorage set below — both channels point at the
    // same worktree, so they stay consistent.
    let effectiveRequestContext = generateOptions?.requestContext;
    if (worktreePath) {
      effectiveRequestContext = effectiveRequestContext
        ? new RequestContext(effectiveRequestContext.entries())
        : new RequestContext();
      effectiveRequestContext.set(WORKTREE_PATH_CONTEXT_KEY, worktreePath);
    }

    const effectiveOptions = {
      ...generateOptions,
      requestContext: effectiveRequestContext,
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const runGenerate = () => agent.generate(generatePrompt, effectiveOptions);
      const result = await (worktreePath
        ? runInWorktree(worktreePath, runGenerate)
        : runGenerate());

      if (!shouldRetry(result)) {
        return result;
      }

      lastResult = result;
      log.warn(
        { attempt, maxAttempts, agentId: agent.id },
        'Agent generate() returned an unusable result, retrying'
      );
    }

    return lastResult as GenerateResult;
  };

  return new Proxy(agent, {
    get(target, prop) {
      if (prop === 'generate') {
        return generate;
      }
      // Bind to `target` (not the receiver/Proxy) so methods relying on
      // private class fields (e.g. #mastra) keep working — private fields
      // are only accessible on the real instance, not the Proxy wrapper.
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
