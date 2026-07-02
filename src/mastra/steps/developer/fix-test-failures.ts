import { createStep } from '@mastra/core/workflows';
import { getEnv } from '../../../config/env.js';
import { createAgentStepLogger } from '../../../utils/agent-step-logger.js';
import { createLogger } from '../../../utils/logger.js';
import { getWorktreePath, runInWorktree } from '../../../utils/worktree-context.js';
import { developerAgent } from '../../agents/developer.agent.js';
import {
  developerFixStepOutputSchema,
  developerRunTestsOutputSchema,
} from '../../workflows/developer.workflow.types.js';

const env = getEnv();
const log = createLogger('fix-test-failures-step');
const stepLog = createAgentStepLogger('fix-test-failures-step');

const FIX_INSTRUCTIONS = `You are a Software Developer agent fixing test failures. You have at most ${env.MAX_STEPS_FIX} steps.

## Your job
Fix failing tests by editing code. Do NOT explore the project — you already know it.
Testing is handled by a separate workflow step — do not try to run tests.

## Process
1. Read the files that need fixing (use readFile)
2. Edit them using writeFile
3. **Report what you fixed** — be specific about changes made

## Rules
- Do NOT explore — go straight to fixing
- Do NOT run git commands or tests — the system handles that`;

export const fixTestFailuresStep = createStep({
  id: 'fix-test-failures',
  inputSchema: developerRunTestsOutputSchema,
  outputSchema: developerFixStepOutputSchema,
  execute: async ({ inputData }) => {
    const worktreePath = getWorktreePath(inputData.branchName);

    stepLog.logStepStart(inputData.taskIdentifier);

    const result = await runInWorktree(worktreePath, async () => {
      const prompt = `## Task: ${inputData.taskIdentifier}

## Test Failure
Command: \`${inputData.testResult.command}\`
Exit code: ${inputData.testResult.exitCode}

Stdout:
\`\`\`
${inputData.testResult.stdout}
\`\`\`

Stderr:
\`\`\`
${inputData.testResult.stderr}
\`\`\`

Fix the failures now. Read the failing files, edit them with writeFile, and re-run tests.`;

      return developerAgent.generate(prompt, {
        instructions: FIX_INSTRUCTIONS,
        maxSteps: env.MAX_STEPS_FIX,
        activeTools: ['readFile', 'writeFile'],
        onStepFinish: (payload) => stepLog.logStepFinish(inputData.taskIdentifier, payload),
      });
    });

    stepLog.logStepComplete(inputData.taskIdentifier);
    log.info({ taskIdentifier: inputData.taskIdentifier }, 'Test fix attempt complete');

    return { ...inputData, fixResult: result.text ?? '', fixSkipped: false };
  },
});
