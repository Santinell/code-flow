import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { getEnv } from '#config/env';
import { ARCHITECT_SYSTEM_PROMPT } from '#config/prompts';
// import { architectLiveScorers } from '#evals/scorers/index';
import { getEmbeddingModel, getModel } from '../model';
import { agentsMdProcessor } from '../processors/agents-md';
import { ToolBudgetProcessor } from '../processors/tool-budget';
import { storage, vector } from '../storage';
import { fileReadTool, globSearchTool, listDirTool } from '../tools/index';

const env = getEnv();

export const architectAgent = new Agent({
  id: 'architect-agent',
  name: 'architect',
  instructions: ARCHITECT_SYSTEM_PROMPT,
  model: getModel('architect'),
  inputProcessors: [
    agentsMdProcessor,
    new ToolBudgetProcessor({
      maxSteps: env.MAX_STEPS_AGENT_ARCHITECT,
      toolBudgets: {
        listDir: 1,
        globSearch: 2,
        readFile: 5,
      },
    }),
  ],
  tools: {
    readFile: fileReadTool,
    listDir: listDirTool,
    globSearch: globSearchTool,
  },
  defaultOptions: {
    maxSteps: env.MAX_STEPS_AGENT_ARCHITECT,
    modelSettings: {
      maxRetries: 3,
      reasoning: 'high',
      maxOutputTokens: env.MAX_OUTPUT_TOKENS_ARCHITECT,
    },
  },
  memory: getMemory(),
  // scorers: architectLiveScorers,
});

function getMemory() {
  if (env.EMBEDDING_MEMORY) {
    return new Memory({
      storage,
      vector,
      embedder: getEmbeddingModel('embedding'),
      options: {
        lastMessages: 30,
        semanticRecall: {
          topK: 5,
          messageRange: 2,
        },
      },
    });
  }

  return new Memory({
    storage,
    options: {
      lastMessages: 30,
    },
  });
}
