import { createStep } from '@mastra/core/workflows';
import { getEnv } from '#config/env';
import { developerAgent } from '#mastra/agents/developer-agent';
import {
  developerAnalysisOutputSchema,
  developerBranchOutputSchema,
  stackCommandsSchema,
  type StackCommands,
} from '#mastra/workflows/developer-workflow.types';
import { buildWorkspaceRequestContext } from '#mastra/workspace';
import { createAgentStepLogger } from '#utils/agent-step-logger';
import { buildInstallCommand, buildTestCommand, detectProjectStack } from '#utils/exec';
import { createLogger } from '#utils/logger';
import { getWorktreePath, runInWorktree } from '#utils/worktree-context';

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

## Structured Output (fill ALL fields after exploration)
- **analysis**: 2-4 sentences with concrete facts about the detected language, framework, and test runner. Note whether the target file exists yet.
- **detectedLanguage**: primary language identifier (e.g. "typescript", "python", "rust", "go")
- **installCommands**: the exact commands to install dependencies for this project, as full strings (e.g. ["uv sync"], ["cargo fetch"], ["go mod download"]). Use an empty array [] if no install step is needed.
- **testCommand**: the exact command to run tests (e.g. "cargo test", "go test ./...", "pytest"). Use null if there are no tests.

Base the commands on the project's manifests (package.json, pyproject.toml, Cargo.toml, go.mod, Makefile, etc.). Do not invent commands for stacks you cannot detect from the files present.`;

/**
 * Builds deterministic install/test commands for a known stack, keeping the
 * agent's analysis text. Known stacks (node/python/make detected by lockfiles
 * /manifests) skip the LLM command path entirely — tested exec.ts logic wins.
 */
function buildDeterministicStackCommands(worktreePath: string, analysis: string): StackCommands {
  const stack = detectProjectStack(worktreePath);
  if (!stack) {
    // Should not happen — caller checks detectProjectStack first. Defensive.
    return {
      analysis,
      detectedLanguage: 'unknown',
      installCommands: [],
      testCommand: null,
    };
  }

  const installCommands = buildInstallCommand(stack).map((c) =>
    `${c.command} ${c.args.join(' ')}`.trim()
  );
  const test = buildTestCommand(stack);
  const testCommand = test ? `${test.command} ${test.args.join(' ')}`.trim() : null;

  return {
    analysis,
    detectedLanguage: stack.language === 'node' ? 'node' : stack.language,
    installCommands,
    testCommand,
  };
}

export const analyzeCodebaseStep = createStep({
  id: 'analyze-codebase',
  inputSchema: developerBranchOutputSchema,
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
        structuredOutput: { schema: stackCommandsSchema },
        requestContext: buildWorkspaceRequestContext(worktreePath),
        onStepFinish: (payload) => stepLog.logStepFinish(inputData.taskIdentifier, payload),
      });
    });

    const output = result.object;

    // Hybrid: known stacks use the deterministic, tested command builders;
    // unknown stacks (Rust/Go/Java/...) fall back to the agent's commands,
    // which install-deps/run-tests will validate before executing.
    const knownStack = detectProjectStack(worktreePath);
    const stackCommands: StackCommands = knownStack
      ? buildDeterministicStackCommands(worktreePath, output.analysis)
      : output;

    stepLog.logStepComplete(inputData.taskIdentifier);
    log.info(
      {
        taskIdentifier: inputData.taskIdentifier,
        detectedLanguage: stackCommands.detectedLanguage,
        knownStack: !!knownStack,
        installCommands: stackCommands.installCommands,
        testCommand: stackCommands.testCommand,
      },
      'Codebase analysis complete'
    );

    return {
      ...inputData,
      codebaseAnalysis: output.analysis,
      stackCommands,
    };
  },
});
