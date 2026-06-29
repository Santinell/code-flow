import { z } from 'zod';
import { getEnv } from '../../config/env';

const env = getEnv();

export const developerWorkflowInputSchema = z.object({
  taskId: z.string(),
  taskIdentifier: z.string(),
  taskTitle: z.string(),
  taskDescription: z.string(),
  taskComments: z.array(z.string()),
  branchName: z.string().min(1),
});

export const developerClaimTaskOutputSchema = developerWorkflowInputSchema.extend({
  status: z.literal(env.LINEAR_STATUS_IN_PROGRESS),
});

export const developerBranchOutputSchema = developerClaimTaskOutputSchema.extend({
  branchCreated: z.boolean(),
});

export const developerAnalysisOutputSchema = developerBranchOutputSchema.extend({
  codebaseAnalysis: z.string(),
});

export const developerImplementationOutputSchema = developerAnalysisOutputSchema.extend({
  implementationResult: z.string(),
});

export const developerTestCommandSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.string()),
});

export const developerTestResultSchema = z.object({
  command: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  passed: z.boolean(),
});

export const developerRunTestsOutputSchema = developerImplementationOutputSchema.extend({
  testResult: developerTestResultSchema,
});

export const developerFixTestFailuresOutputSchema = developerRunTestsOutputSchema.extend({
  fixResult: z.string(),
});

export const developerNoFixOutputSchema = developerRunTestsOutputSchema.extend({
  fixSkipped: z.literal(true),
});

export const developerCommitInputSchema = z.object({}).passthrough();

export const developerCommitOutputSchema = developerCommitInputSchema.extend({
  commitHash: z.string().nullable(),
});

export const developerMoveToReviewOutputSchema = developerCommitOutputSchema.extend({
  finalStatus: z.literal(env.LINEAR_STATUS_REVIEW),
});

export const developerWorkflowOutputSchema = developerMoveToReviewOutputSchema.extend({
  workflowStatus: z.literal('completed'),
});

export type DeveloperWorkflowInput = z.infer<typeof developerWorkflowInputSchema>;
export type DeveloperClaimTaskOutput = z.infer<typeof developerClaimTaskOutputSchema>;
export type DeveloperBranchOutput = z.infer<typeof developerBranchOutputSchema>;
export type DeveloperAnalysisOutput = z.infer<typeof developerAnalysisOutputSchema>;
export type DeveloperImplementationOutput = z.infer<typeof developerImplementationOutputSchema>;
export type DeveloperTestCommand = z.infer<typeof developerTestCommandSchema>;
export type DeveloperTestResult = z.infer<typeof developerTestResultSchema>;
export type DeveloperRunTestsOutput = z.infer<typeof developerRunTestsOutputSchema>;
export type DeveloperFixTestFailuresOutput = z.infer<typeof developerFixTestFailuresOutputSchema>;
export type DeveloperNoFixOutput = z.infer<typeof developerNoFixOutputSchema>;
export type DeveloperCommitInput = z.infer<typeof developerCommitInputSchema>;
export type DeveloperCommitOutput = z.infer<typeof developerCommitOutputSchema>;
export type DeveloperMoveToReviewOutput = z.infer<typeof developerMoveToReviewOutputSchema>;
export type DeveloperWorkflowOutput = z.infer<typeof developerWorkflowOutputSchema>;

// oxlint-disable-next-line typescript/no-restricted-types
export function parseDeveloperCommitInput(inputData: unknown): DeveloperCommitInput {
  // oxlint-disable-next-line typescript/no-restricted-types
  const parsed = developerCommitInputSchema.parse(inputData) as Record<string, unknown>;
  const fixed = developerFixTestFailuresOutputSchema.safeParse(parsed['fix-test-failures']);
  const skipped = developerNoFixOutputSchema.safeParse(parsed['skip-fix']);

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
