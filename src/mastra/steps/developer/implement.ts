import { createStep } from '@mastra/core/workflows';
import { getEnv } from '#config/env';
import { developerAgent } from '#mastra/agents/developer-agent';
import {
  developerImplementationOutputSchema,
  developerInstallDepsOutputSchema,
} from '#mastra/workflows/developer-workflow.types';
import { buildWorkspaceRequestContext } from '#mastra/workspace';
import { createAgentStepLogger } from '#utils/agent-step-logger';
import { createLogger } from '#utils/logger';
import { getWorktreePath, runInWorktree } from '#utils/worktree-context';

const env = getEnv();
const log = createLogger('implement-step');
const stepLog = createAgentStepLogger('implement-step');

const IMPLEMENT_INSTRUCTIONS = `You are a Software Developer agent implementing a task. The codebase has already been analyzed. You have at most ${env.MAX_STEPS_IMPLEMENT} steps.

## Your job
Write code changes using writeFile. Do NOT explore the project structure again.
Testing is handled by a separate workflow step — do not try to run tests.

## Process
1. Read the specific files you need to change (use readFile)
2. Write the implementation using writeFile
3. **Report what you implemented** — list files created/modified and what was changed

## Rules
- Do NOT explore the project — the analysis is done
- Write production-quality code, follow existing patterns
- Do NOT run git commands or tests — the system handles that`;

export const implementStep = createStep({
  id: 'implement',
  inputSchema: developerInstallDepsOutputSchema,
  outputSchema: developerImplementationOutputSchema,
  execute: async ({ inputData }) => {
    const worktreePath = getWorktreePath(inputData.branchName);

    stepLog.logStepStart(inputData.taskIdentifier);

    const result = await runInWorktree(worktreePath, async () => {
      const prompt = `## Task: ${inputData.taskIdentifier} — ${inputData.taskTitle}

## Description
${inputData.taskDescription}

## Existing Codebase Analysis
${inputData.codebaseAnalysis}

Implement the changes now. Read files you need to modify, then write the implementation.`;

      return developerAgent.generate(prompt, {
        instructions: IMPLEMENT_INSTRUCTIONS,
        maxSteps: env.MAX_STEPS_IMPLEMENT,
        activeTools: ['readFile', 'writeFile'],
        requestContext: buildWorkspaceRequestContext(worktreePath),
        onStepFinish: (payload) => stepLog.logStepFinish(inputData.taskIdentifier, payload),
      });
    });

    stepLog.logStepComplete(inputData.taskIdentifier);
    log.info({ taskIdentifier: inputData.taskIdentifier }, 'Implementation complete');

    return { ...inputData, implementationResult: result.text ?? '' };
  },
});
