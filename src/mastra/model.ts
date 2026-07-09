import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import type { ModelWithRetries } from '@mastra/core/agent';
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
import { createOllama, OllamaProvider, OllamaProviderSettings } from 'ollama-ai-provider-v2';
import {
  getAgentMainEntry,
  getAgentModelEntries,
  getProviderConfig,
  type ModelEntry,
  type AiProviderConfig,
} from '#config/providers';

let openaiProvider: OpenAIProvider | null = null;
let deepseekProvider: DeepSeekProvider | null = null;
let anthropicProvider: AnthropicProvider | null = null;
let ollamaProvider: OllamaProvider | null = null;

type getEmbeddingModelOptions = Omit<OllamaProviderSettings, 'baseURL'>;

type getModelOptions =
  | Omit<AnthropicProviderSettings, 'apiKey' | 'baseURL'>
  | Omit<OpenAIProviderSettings, 'apiKey' | 'baseURL'>
  | Omit<DeepSeekProviderSettings, 'apiKey' | 'baseURL'>;

function createLanguageModel(
  config: AiProviderConfig,
  modelName: string,
  options?: getModelOptions
): LanguageModelV3 {
  const { mode, baseUrl: baseURL, apiKey } = config;

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
    case 'ollama': {
      if (!ollamaProvider) {
        ollamaProvider = createOllama({ baseURL, ...options });
      }
      return ollamaProvider.chat(modelName);
    }
    default: {
      throw new Error(`Unknown provider mode: ${mode}`);
    }
  }
}

function createEmbeddingModel(
  config: AiProviderConfig,
  modelName: string,
  dimensions: number,
  options?: getEmbeddingModelOptions
): EmbeddingModelV3 {
  const { baseUrl: baseURL, apiKey, mode } = config;

  switch (mode) {
    case 'embedding-openai': {
      if (!openaiProvider) {
        openaiProvider = createOpenAI({ apiKey, baseURL, ...options });
      }
      return openaiProvider.embedding(modelName);
    }
    case 'embedding-ollama': {
      const ollama = createOllama({ baseURL, ...options });
      return ollama.embedding(modelName, { dimensions });
    }
    default: {
      throw new Error(`Unknown embedding provider mode: ${mode}`);
    }
  }
}

function entryToModel(entry: ModelEntry): ModelWithRetries {
  const providerConfig = getProviderConfig(entry.provider);
  return {
    id: `${entry.provider}/${entry.model}`,
    model: createLanguageModel(providerConfig, entry.model),
  };
}

export function getEmbeddingModel(agentName: string): EmbeddingModelV3 {
  const entry = getAgentMainEntry(agentName);
  const providerConfig = getProviderConfig(entry.provider);
  return createEmbeddingModel(providerConfig, entry.model, entry.dimensions ?? 768);
}

export function getMainModel(agentName: string): LanguageModelV3 {
  const entry = getAgentMainEntry(agentName);
  const providerConfig = getProviderConfig(entry.provider);
  return createLanguageModel(providerConfig, entry.model);
}

export function getModel(agentName: string): ModelWithRetries[] {
  const entries = getAgentModelEntries(agentName);
  return entries.map(entryToModel);
}
