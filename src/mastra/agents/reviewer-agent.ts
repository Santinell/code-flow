import { Agent } from '@mastra/core/agent';
import { getEnv } from '#config/env';
import { REVIEWER_SYSTEM_PROMPT } from '#config/prompts';
// import { reviewerLiveScorers } from '#evals/scorers/index';
import { getModel } from '../model';
import { agentsMdProcessor } from '../processors/agents-md';
import { ToolBudgetProcessor } from '../processors/tool-budget';
import { createWorktreeWorkspace } from '../workspace';

const env = getEnv();

export const reviewerAgent = new Agent({
  id: 'reviewer-agent',
  name: 'reviewer',
  instructions: REVIEWER_SYSTEM_PROMPT,
  model: getModel('reviewer'),
  // Workspace auto-injects readFile (resolved per-request to the worktree).
  workspace: createWorktreeWorkspace(),
  inputProcessors: [
    agentsMdProcessor,
    new ToolBudgetProcessor({
      maxSteps: env.MAX_STEPS_AGENT_REVIEWER,
      toolBudgets: {
        readFile: 3, // mastra_workspace_read_file
      },
    }),
  ],
  tools: {}, // all tools come from workspace
  defaultOptions: {
    maxSteps: env.MAX_STEPS_AGENT_REVIEWER,
    modelSettings: {
      maxOutputTokens: env.MAX_OUTPUT_TOKENS_REVIEWER,
    },
  },
  // scorers: reviewerLiveScorers,
});
