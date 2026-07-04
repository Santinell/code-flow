import { z } from 'zod';
import providersConfig from '../../providers.json' with { type: 'json' };

const providerModeSchema = z.enum([
  'openai',
  'openai-responses',
  'deepseek',
  'z-ai',
  'anthropic',
  'ollama',
  'embedding-openai',
  'embedding-ollama',
]);

const providerConfigSchema = z.object({
  mode: providerModeSchema,
  baseUrl: z.string(),
  apiKey: z.string().optional(),
});

const modelEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  dimensions: z.number().optional(),
});

const agentConfigSchema = modelEntrySchema.extend({
  fallbacks: z.array(modelEntrySchema).optional(),
});

const providersSchema = z.object({
  providers: z.record(z.string(), providerConfigSchema),
  agents: z.record(z.string(), agentConfigSchema),
});

export type ProviderMode = z.infer<typeof providerModeSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type ProvidersSchema = z.infer<typeof providersSchema>;

const config = providersSchema.parse(providersConfig);

export function getAgentConfig(agentName: string): AgentConfig {
  const agent = config.agents[agentName];
  if (!agent) {
    throw new Error(`No config found for agent "${agentName}" in providers.json`);
  }
  return agent;
}

export function getAgentMainEntry(agentName: string): ModelEntry {
  const agent = getAgentConfig(agentName);
  return { provider: agent.provider, model: agent.model, dimensions: agent.dimensions };
}

export function getAgentFallbackEntries(agentName: string): ModelEntry[] {
  const agent = getAgentConfig(agentName);
  return agent.fallbacks ?? [];
}

export function getAgentModelEntries(agentName: string): ModelEntry[] {
  return [getAgentMainEntry(agentName), ...getAgentFallbackEntries(agentName)];
}

export function getProviderConfig(providerName: string): ProviderConfig {
  const provider = config.providers[providerName];
  if (!provider) {
    throw new Error(`Provider "${providerName}" not found in providers.json`);
  }
  return provider;
}
