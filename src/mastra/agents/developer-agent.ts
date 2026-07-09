import { Agent } from '@mastra/core/agent';
import { getEnv } from '#config/env';
import { DEVELOPER_SYSTEM_PROMPT } from '#config/prompts';
// import { developerLiveScorers } from '#evals/scorers/index';
import { getModel } from '../model';
import { agentsMdProcessor } from '../processors/agents-md';
import { ToolBudgetProcessor } from '../processors/tool-budget';
import {
  fileReadTool,
  fileWriteTool,
  fileDeleteTool,
  fileMoveTool,
  listDirTool,
  globSearchTool,
  installDepsTool,
} from '../tools/index';

const env = getEnv();

export const developerAgent = new Agent({
  id: 'developer-agent',
  name: 'developer',
  instructions: DEVELOPER_SYSTEM_PROMPT,
  model: getModel('developer'),
  inputProcessors: [
    agentsMdProcessor,
    new ToolBudgetProcessor({
      maxSteps: env.MAX_STEPS_AGENT_DEVELOPER,
      toolBudgets: {
        listDir: 1,
        globSearch: 2,
        readFile: 5,
        installDeps: 1,
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
    installDeps: installDepsTool,
  },
  defaultOptions: {
    maxSteps: env.MAX_STEPS_AGENT_DEVELOPER,
    modelSettings: {
      maxOutputTokens: env.MAX_OUTPUT_TOKENS_DEVELOPER,
    },
  },
  // scorers: developerLiveScorers,
});
