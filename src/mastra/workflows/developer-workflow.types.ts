import { z } from 'zod';

export const developerWorkflowInputSchema = z.object({
  taskId: z.string(),
  taskIdentifier: z.string(),
  taskTitle: z.string(),
  taskDescription: z.string(),
  taskComments: z.array(z.string()),
  branchName: z.string().min(1),
});

export const developerClaimTaskOutputSchema = developerWorkflowInputSchema.extend({
  status: z.string(),
});

export const developerBranchOutputSchema = developerClaimTaskOutputSchema.extend({
  branchCreated: z.boolean(),
});

/**
 * Stack detection result produced by the analyze-codebase step.
 *
 * The agent explores the project manifests and reports these in structured
 * output. For known stacks (node/python/make) detectProjectStack overrides
 * the agent's commands with the tested deterministic ones; for unknown stacks
 * the LLM-provided commands are used (after validation by command-security).
 */
export const stackCommandsSchema = z.object({
  analysis: z.string().describe('Concrete findings about language, framework, and test runner'),
  detectedLanguage: z.string().describe('Primary language, e.g. "typescript", "python", "rust"'),
  installCommands: z
    .array(z.string())
    .describe(
      'Install commands as full strings (e.g. ["uv sync"], ["cargo fetch"]). Empty array if no install needed.'
    ),
  testCommand: z
    .string()
    .nullable()
    .describe('Test command (e.g. "cargo test", "go test ./..."). null if no tests.'),
});
export type StackCommands = z.infer<typeof stackCommandsSchema>;

// NOTE: analyze-codebase runs BEFORE install-deps now, so the schema chain is
// branch → analysis → installDeps (analysis determines the install commands).
export const developerAnalysisOutputSchema = developerBranchOutputSchema.extend({
  codebaseAnalysis: z.string(),
  stackCommands: stackCommandsSchema,
});

export const developerInstallDepsOutputSchema = developerAnalysisOutputSchema.extend({
  installResult: z.object({
    command: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
    passed: z.boolean(),
    skipped: z.boolean(),
    manager: z.string().nullable(),
  }),
});

export const developerImplementationOutputSchema = developerAnalysisOutputSchema.extend({
  implementationResult: z.string(),
});

export const developerRunTestsOutputSchema = developerImplementationOutputSchema.extend({
  testResult: z.object({
    command: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
    passed: z.boolean(),
    manager: z.string().nullable(),
  }),
});

export const developerFixStepOutputSchema = developerRunTestsOutputSchema.extend({
  fixResult: z.string(),
  fixSkipped: z.boolean(),
});

export const developerCommitInputSchema = z.object({
  'skip-fix': developerFixStepOutputSchema.optional(),
  'fix-test-failures': developerFixStepOutputSchema.optional(),
});

export const developerCommitOutputSchema = developerFixStepOutputSchema.extend({
  commitHash: z.string().nullable(),
});

export const developerMoveToReviewOutputSchema = developerCommitOutputSchema.extend({
  finalStatus: z.string(),
});

export const developerWorkflowOutputSchema = developerMoveToReviewOutputSchema.extend({
  workflowStatus: z.literal('completed'),
});

export type DeveloperCommitInput = z.infer<typeof developerCommitInputSchema>;
export type DeveloperWorkflowInput = z.infer<typeof developerWorkflowInputSchema>;
export type DeveloperClaimTaskOutput = z.infer<typeof developerClaimTaskOutputSchema>;
export type DeveloperBranchOutput = z.infer<typeof developerBranchOutputSchema>;
export type DeveloperInstallDepsOutput = z.infer<typeof developerInstallDepsOutputSchema>;
export type DeveloperAnalysisOutput = z.infer<typeof developerAnalysisOutputSchema>;
export type DeveloperImplementationOutput = z.infer<typeof developerImplementationOutputSchema>;
export type DeveloperRunTestsOutput = z.infer<typeof developerRunTestsOutputSchema>;
export type DeveloperFixStepOutput = z.infer<typeof developerFixStepOutputSchema>;
export type DeveloperCommitOutput = z.infer<typeof developerCommitOutputSchema>;
export type DeveloperMoveToReviewOutput = z.infer<typeof developerMoveToReviewOutputSchema>;
export type DeveloperWorkflowOutput = z.infer<typeof developerWorkflowOutputSchema>;

export function parseDeveloperCommitInput(inputData: DeveloperCommitInput) {
  const parsed = developerCommitInputSchema.parse(inputData);
  const fixed = developerFixStepOutputSchema.safeParse(parsed['fix-test-failures']);
  const skipped = developerFixStepOutputSchema.safeParse(parsed['skip-fix']);

  if (fixed.success) {
    return fixed.data;
  }

  if (skipped.success) {
    return skipped.data;
  }

  throw new Error(
    'Invalid developer commit input: expected fix-test-failures or skip-fix branch output'
  );
}
