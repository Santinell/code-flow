import { Agent } from '@mastra/core/agent';
import { getEnv } from '../../config/env.js';
import { DEVELOPER_SYSTEM_PROMPT } from '../../config/prompts.js';
import { developerScorers } from '../evals/scorers/index.js';
import { getModel } from '../model.js';
import { agentsMdProcessor } from '../processors/agents-md.js';
import { ToolBudgetProcessor } from '../processors/tool-budget.js';
import {
  fileReadTool,
  fileWriteTool,
  fileDeleteTool,
  fileMoveTool,
  listDirTool,
  globSearchTool,
} from '../tools/index.js';

const env = getEnv();

export const developerAgent = new Agent({
  id: 'developer-agent',
  name: 'developer',
  instructions: DEVELOPER_SYSTEM_PROMPT,
  model: getModel(env.DEVELOPER_MODEL),
  inputProcessors: [
    agentsMdProcessor,
    new ToolBudgetProcessor({
      maxSteps: env.MAX_STEPS_AGENT_DEVELOPER,
      toolBudgets: {
        listDir: 1,
        globSearch: 2,
        readFile: 5,
      },
      disableAfterWrite: ['listDir', 'globSearch', 'readFile'],
    }),
  ],
  tools: {
    readFile: fileReadTool,
    writeFile: fileWriteTool,
    deleteFile: fileDeleteTool,
    moveFile: fileMoveTool,
    listDir: listDirTool,
    globSearch: globSearchTool,
  },
  defaultOptions: {
    maxSteps: env.MAX_STEPS_AGENT_DEVELOPER,
  },
  scorers: developerScorers,
});
