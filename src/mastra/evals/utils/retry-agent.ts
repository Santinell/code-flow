import type { Agent } from '@mastra/core/agent';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('retry-agent');

type GenerateArgs = Parameters<Agent['generate']>;
type GenerateResult = Awaited<ReturnType<Agent['generate']>>;

export type RetryAgentOptions = {
  /** Total attempts (including the first), e.g. 3 = 1 initial + 2 retries. */
  maxAttempts?: number;
  /**
   * Decide whether a generate() result should be retried, e.g. because
   * structuredOutput failed to parse into anything usable.
   */
  shouldRetry: (result: GenerateResult) => boolean;
};

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
export function withGenerateRetry<TAgent extends Agent>(
  agent: TAgent,
  options: RetryAgentOptions
): TAgent {
  const maxAttempts = options.maxAttempts ?? 3;

  const retryingGenerate = async (...args: GenerateArgs): Promise<GenerateResult> => {
    let lastResult: GenerateResult | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await agent.generate(...args);

      if (!options.shouldRetry(result)) {
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
        return retryingGenerate;
      }
      // Bind to `target` (not the receiver/Proxy) so methods relying on
      // private class fields (e.g. #mastra) keep working — private fields
      // are only accessible on the real instance, not the Proxy wrapper.
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
