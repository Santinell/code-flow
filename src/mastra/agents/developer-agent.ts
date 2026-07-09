import { Agent } from '@mastra/core/agent';
import { getEnv } from '#config/env';
import { DEVELOPER_SYSTEM_PROMPT } from '#config/prompts';
// import { developerLiveScorers } from '#evals/scorers/index';
import { getModel } from '../model';
import { agentsMdProcessor } from '../processors/agents-md';
import { ToolBudgetProcessor } from '../processors/tool-budget';
import { fileMoveTool, globSearchTool } from '../tools/index';
import { createWorktreeWorkspace } from '../workspace';

const env = getEnv();

export const developerAgent = new Agent({
  id: 'developer-agent',
  name: 'developer',
  instructions: DEVELOPER_SYSTEM_PROMPT,
  model: getModel('developer'),
  // Workspace auto-injects the read/write/delete/list/edit/mkdir/stat tools
  // (aliased to short names). Filesystem path resolves per-request to the
  // current git worktree via buildWorkspaceRequestContext.
  workspace: createWorktreeWorkspace(),
  inputProcessors: [
    agentsMdProcessor,
    new ToolBudgetProcessor({
      maxSteps: env.MAX_STEPS_AGENT_DEVELOPER,
      toolBudgets: {
        // Workspace tools (short aliases)
        listDir: 1, // mastra_workspace_list_files
        readFile: 5, // mastra_workspace_read_file
        editFile: 3, // mastra_workspace_edit_file
        fileStat: 2, // mastra_workspace_file_stat
        mkdir: 2, // mastra_workspace_mkdir
        // Custom tools
        globSearch: 2, // custom globSearch (no workspace equivalent)
      },
      disableAfterWrite: ['listDir', 'globSearch', 'readFile'],
      writeTools: [
        'writeFile', // mastra_workspace_write_file
        'deleteFile', // mastra_workspace_delete
        'editFile', // mastra_workspace_edit_file
        'mkdir', // mastra_workspace_mkdir
        'moveFile', // custom moveFile
      ],
    }),
  ],
  tools: {
    // Only custom tools remain; read/write/delete/list come from workspace
    globSearch: globSearchTool,
    moveFile: fileMoveTool,
  },
  defaultOptions: {
    maxSteps: env.MAX_STEPS_AGENT_DEVELOPER,
    modelSettings: {
      maxOutputTokens: env.MAX_OUTPUT_TOKENS_DEVELOPER,
    },
  },
  // scorers: developerLiveScorers,
});
