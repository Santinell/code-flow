import { Agent } from '@mastra/core/agent';
import { getEnv } from '../../config/env.js';
import { REVIEWER_SYSTEM_PROMPT } from '../../config/prompts.js';
import { reviewerScorers } from '../evals/scorers/index.js';
import { getModel } from '../model.js';
import { agentsMdProcessor } from '../processors/agents-md.js';
import { ToolBudgetProcessor } from '../processors/tool-budget.js';
import { fileReadTool } from '../tools/index.js';

const env = getEnv();

export const reviewerAgent = new Agent({
  id: 'reviewer-agent',
  name: 'reviewer',
  instructions: REVIEWER_SYSTEM_PROMPT,
  model: getModel(env.REVIEWER_MODEL),
  inputProcessors: [
    agentsMdProcessor,
    new ToolBudgetProcessor({
      maxSteps: env.MAX_STEPS_AGENT_REVIEWER,
      toolBudgets: {
        readFile: 3,
      },
    }),
  ],
  tools: {
    readFile: fileReadTool,
  },
  defaultOptions: {
    maxSteps: env.MAX_STEPS_AGENT_REVIEWER,
  },
  scorers: reviewerScorers,
});
