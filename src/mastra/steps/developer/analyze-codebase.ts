import { createStep } from '@mastra/core/workflows';
import { getEnv } from '../../../config/env.js';
import { createAgentStepLogger } from '../../../utils/agent-step-logger.js';
import { createLogger } from '../../../utils/logger.js';
import { getWorktreePath, runInWorktree } from '../../../utils/worktree-context.js';
import { developerAgent } from '../../agents/developer.agent.js';
import {
  developerAnalysisOutputSchema,
  developerInstallDepsOutputSchema,
} from '../../workflows/developer.workflow.types.js';

const env = getEnv();
const log = createLogger('analyze-codebase-step');
const stepLog = createAgentStepLogger('analyze-codebase-step');

const ANALYZE_INSTRUCTIONS = `You are a Software Developer agent analyzing a codebase to prepare for implementation. You have at most ${env.MAX_STEPS_ANALYZE} steps.

## Your job
Explore the project structure using listDir, globSearch, and readFile. **Do NOT explore endlessly — 3-4 tools calls then report.**

## Tool selection
- listDir for listing a specific directory
- globSearch for pattern-based file search (e.g. "src/**/*.ts", "src/**/*.py")
- readFile for reading individual files

## Required Report (output as TEXT after exploration)
Output 2-4 sentences with concrete facts about the detected language, framework, and test runner. Example formats:

TypeScript/Node:
"Project uses TypeScript with strict mode. Found package.json with vitest. The file src/utils/math.ts does not exist yet. I will create it with the requested function."

Python:
"Project uses Python 3.11 with pyproject.toml (uv). Found pytest. The file src/utils/math.py does not exist yet. I will create it with the requested function."`;

export const analyzeCodebaseStep = createStep({
  id: 'analyze-codebase',
  inputSchema: developerInstallDepsOutputSchema,
  outputSchema: developerAnalysisOutputSchema,
  execute: async ({ inputData }) => {
    const worktreePath = getWorktreePath(inputData.branchName);

    stepLog.logStepStart(inputData.taskIdentifier);

    const result = await runInWorktree(worktreePath, async () => {
      const prompt = `## Task: ${inputData.taskIdentifier} — ${inputData.taskTitle}

## Description
${inputData.taskDescription}

## Task Comments
${inputData.taskComments?.length ? inputData.taskComments.join('\n') : 'No comments'}

Explore the project structure and report your findings.`;

      return developerAgent.generate(prompt, {
        instructions: ANALYZE_INSTRUCTIONS,
        maxSteps: env.MAX_STEPS_ANALYZE,
        onStepFinish: (payload) => stepLog.logStepFinish(inputData.taskIdentifier, payload),
      });
    });

    stepLog.logStepComplete(inputData.taskIdentifier);
    log.info({ taskIdentifier: inputData.taskIdentifier }, 'Codebase analysis complete');

    return { ...inputData, codebaseAnalysis: result.text ?? '' };
  },
});
