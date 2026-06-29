import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { getEnv } from '../../config/env.js';
import { ARCHITECT_SYSTEM_PROMPT } from '../../config/prompts.js';
import { architectScorers } from '../evals/scorers/index.js';
import { getLocalEmbeddingModel, getModel } from '../model.js';
import { storage, vector } from '../storage.js';
import { agentsMdProcessor } from '../processors/agents-md.js';
import { ToolBudgetProcessor } from '../processors/tool-budget.js';
import { fileReadTool, globSearchTool, listDirTool } from '../tools/index.js';

const env = getEnv();

export const architectAgent = new Agent({
  id: 'architect-agent',
  name: 'architect',
  instructions: ARCHITECT_SYSTEM_PROMPT,
  model: getModel(env.ARCHITECT_MODEL),
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
    },
    providerOptions: {
      openai: {
        reasoningEffort: 'high'
      },
      deepseek: {
        reasoningEffort: 'high',
      },
    },
  },
  memory: getMemory(),
  scorers: architectScorers,
});

function getMemory() {
  if (env.EMBEDDING_MEMORY) {
    return new Memory({
      storage,
      vector,
      embedder: getLocalEmbeddingModel(env.EMBEDDING_MODEL, env.EMBEDDING_MODEL_DIMENSIONS),
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
