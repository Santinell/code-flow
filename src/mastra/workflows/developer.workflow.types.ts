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

export const developerRunTestsOutputSchema = developerImplementationOutputSchema.extend({
  testResult: z.object({
    command: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
    passed: z.boolean(),
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
  finalStatus: z.literal(env.LINEAR_STATUS_REVIEW),
});

export const developerWorkflowOutputSchema = developerMoveToReviewOutputSchema.extend({
  workflowStatus: z.literal('completed'),
});

export type DeveloperCommitInput = z.infer<typeof developerCommitInputSchema>;
export type DeveloperWorkflowInput = z.infer<typeof developerWorkflowInputSchema>;
export type DeveloperClaimTaskOutput = z.infer<typeof developerClaimTaskOutputSchema>;
export type DeveloperBranchOutput = z.infer<typeof developerBranchOutputSchema>;
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
