import { z } from 'zod';

export const reviewerVerdictSchema = z.enum(['approve', 'request_changes']);

export const reviewerWorkflowInputSchema = z.object({
  taskId: z.string(),
  taskIdentifier: z.string(),
  taskTitle: z.string(),
  taskDescription: z.string(),
  taskComments: z.array(z.string()),
  branchName: z.string(),
});

export const reviewerDiffOutputSchema = reviewerWorkflowInputSchema.extend({
  diff: z.string(),
  changedFiles: z.array(z.string()),
});

export const reviewerReviewOutputSchema = reviewerDiffOutputSchema.extend({
  reviewText: z.string(),
  verdict: reviewerVerdictSchema,
  isApproved: z.boolean(),
});

export const reviewerHandleResultOutputSchema = reviewerReviewOutputSchema.extend({
  finalStatus: z.enum(['Done', 'Todo']),
  merged: z.boolean(),
});

export const reviewerWorkflowOutputSchema = reviewerHandleResultOutputSchema.extend({
  workflowStatus: z.literal('completed'),
});

export const reviewerGenerateOutputSchema = z.object({
  feedback: z.string().describe('Detailed code review feedback'),
  verdict: reviewerVerdictSchema.describe('Review verdict'),
  issues: z.array(z.string()).describe('List of specific issues found. Empty if approved.'),
});

export type ReviewerVerdict = z.infer<typeof reviewerVerdictSchema>;
export type ReviewerGenerateOutput = z.infer<typeof reviewerGenerateOutputSchema>;
export type ReviewerWorkflowInput = z.infer<typeof reviewerWorkflowInputSchema>;
export type ReviewerDiffOutput = z.infer<typeof reviewerDiffOutputSchema>;
export type ReviewerReviewOutput = z.infer<typeof reviewerReviewOutputSchema>;
export type ReviewerHandleResultOutput = z.infer<typeof reviewerHandleResultOutputSchema>;
export type ReviewerWorkflowOutput = z.infer<typeof reviewerWorkflowOutputSchema>;
