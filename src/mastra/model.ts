import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import {
  type AnthropicProvider,
  type AnthropicProviderSettings,
  createAnthropic,
} from '@ai-sdk/anthropic';
import {
  createDeepSeek,
  type DeepSeekProviderSettings,
  type DeepSeekProvider,
} from '@ai-sdk/deepseek';
import { createOpenAI, type OpenAIProviderSettings, type OpenAIProvider } from '@ai-sdk/openai';
import { createOllama, OllamaProviderSettings } from 'ollama-ai-provider-v2';
import { getEnv } from '../config/env.js';

let openaiProvider: OpenAIProvider | null = null;
let deepseekProvider: DeepSeekProvider | null = null;
let anthropicProvider: AnthropicProvider | null = null;

type getEmbeddingModelOptions = Omit<OllamaProviderSettings, 'baseURL'>;

type getModelOptions =
  | Omit<AnthropicProviderSettings, 'apiKey' | 'baseURL'>
  | Omit<OpenAIProviderSettings, 'apiKey' | 'baseURL'>
  | Omit<DeepSeekProviderSettings, 'apiKey' | 'baseURL'>;

const env = getEnv();

export function getModel(
  modelName: string,
  options?: getModelOptions | undefined
): LanguageModelV3 {
  const mode = env.AI_API_MODE;
  const apiKey = env.AI_API_KEY;
  const baseURL = env.AI_API_BASE;

  switch (mode) {
    case 'openai': {
      if (!openaiProvider) {
        openaiProvider = createOpenAI({ apiKey, baseURL, ...options });
      }
      return openaiProvider.chat(modelName);
    }
    case 'openai-responses': {
      if (!openaiProvider) {
        openaiProvider = createOpenAI({ apiKey, baseURL, ...options });
      }
      return openaiProvider.responses(modelName);
    }
    case 'anthropic': {
      if (!anthropicProvider) {
        anthropicProvider = createAnthropic({ apiKey, baseURL, ...options });
      }
      return anthropicProvider(modelName);
    }
    case 'deepseek': {
      if (!deepseekProvider) {
        deepseekProvider = createDeepSeek({ apiKey, baseURL, ...options });
      }
      return deepseekProvider.chat(modelName);
    }
  }
}

export function getLocalEmbeddingModel(
  modelName: string,
  dimensions: number,
  options?: getEmbeddingModelOptions
): EmbeddingModelV3 {
  const baseURL = env.EMBEDDING_API_BASE;
  const ollama = createOllama({ baseURL, ...options });

  return ollama.embedding(modelName, { dimensions });
}
