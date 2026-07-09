import { z } from 'zod';
import providersConfig from '../../providers.json' with { type: 'json' };

// ── AI Provider Schemas ───────────────────────────────────────────────

const aiProviderModeSchema = z.enum([
  'openai',
  'openai-responses',
  'deepseek',
  'z-ai',
  'anthropic',
  'ollama',
  'embedding-openai',
  'embedding-ollama',
]);

const aiProviderConfigSchema = z.object({
  mode: aiProviderModeSchema,
  baseUrl: z.string(),
  apiKey: z.string().optional(),
});

// ── Agent Schemas ──────────────────────────────────────────────────────

const modelEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  dimensions: z.number().optional(),
});

const agentConfigSchema = modelEntrySchema.extend({
  fallbacks: z.array(modelEntrySchema).optional(),
});

// ── Ticket Provider Schemas ────────────────────────────────────────────

const linearTicketProviderSchema = z.object({
  apiKey: z.string().min(1),
  teamKey: z.string().min(1),
  projectSlug: z.string().min(1),
});

const githubTicketProviderSchema = z.object({
  token: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  projectNumber: z.number().int().positive(),
});

const ticketProvidersSchema = z.object({
  linear: linearTicketProviderSchema.optional(),
  github: githubTicketProviderSchema.optional(),
});

const ticketSystemSchema = z.object({
  provider: z.enum(['linear', 'github']),
  statuses: z.object({
    todo: z.string().min(1),
    inProgress: z.string().min(1),
    review: z.string().min(1),
    done: z.string().min(1),
  }),
});

// ── Top-level Schema ──────────────────────────────────────────────────
// Supports both new (ai-providers) and legacy (providers) keys.
// If both are present, ai-providers takes precedence.

const providersSchema = z.object({
  'ai-providers': z.record(z.string(), aiProviderConfigSchema).optional(),
  agents: z.record(z.string(), agentConfigSchema),
  'ticket-providers': ticketProvidersSchema,
  'ticket-system': ticketSystemSchema,
});

// ── Exported Types ────────────────────────────────────────────────────

export type AiProviderMode = z.infer<typeof aiProviderModeSchema>;
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;
export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type LinearTicketProviderConfig = z.infer<typeof linearTicketProviderSchema>;
export type GitHubTicketProviderConfig = z.infer<typeof githubTicketProviderSchema>;
/** Union of all ticket provider config shapes (as stored under ticket-providers.*) */
export type TicketProviderConfig = LinearTicketProviderConfig | GitHubTicketProviderConfig;
export type TicketSystemConfig = z.infer<typeof ticketSystemSchema>;

// ── Parse & Cache ─────────────────────────────────────────────────────

const raw = providersSchema.parse(providersConfig);

const aiProviders = raw['ai-providers'] ?? {};

const config = {
  aiProviders,
  agents: raw.agents,
  ticketProviders: raw['ticket-providers'],
  ticketSystem: raw['ticket-system'],
};

// ── AI Provider Accessors ─────────────────────────────────────────────

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

export function getProviderConfig(providerName: string): AiProviderConfig {
  const provider = config.aiProviders[providerName];
  if (!provider) {
    throw new Error(`Provider "${providerName}" not found in providers.json`);
  }
  return provider;
}

// ── Ticket System Accessors ───────────────────────────────────────────

export function getTicketSystemConfig(): TicketSystemConfig {
  return config.ticketSystem;
}

export function getTicketProviderConfig(provider: string): TicketProviderConfig | undefined {
  const providers = config.ticketProviders;
  return provider === 'linear'
    ? providers.linear
    : provider === 'github'
      ? providers.github
      : undefined;
}
