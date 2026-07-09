import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { APICallError } from '@ai-sdk/provider';

async function tryAll<T>(
  models: LanguageModelV3[],
  fn: (model: LanguageModelV3) => PromiseLike<T>
): Promise<T> {
  let lastError: Error | undefined;

  for (const model of models) {
    try {
      return await fn(model);
    } catch (error) {
      if (APICallError.isInstance(error) && (error.statusCode === 429 || !error.isRetryable)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('All models exhausted');
}

export function wrapModel(models: LanguageModelV3[]): LanguageModelV3 {
  if (models.length === 0) {
    throw new Error('wrapModel requires at least one model');
  }

  const [primary] = models;

  if (models.length === 1) {
    return primary;
  }

  return {
    specificationVersion: 'v3' as const,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate(options: LanguageModelV3CallOptions): PromiseLike<LanguageModelV3GenerateResult> {
      return tryAll(models, (m) => m.doGenerate(options));
    },
    doStream(options: LanguageModelV3CallOptions): PromiseLike<LanguageModelV3StreamResult> {
      return tryAll(models, (m) => m.doStream(options));
    },
  };
}
