import { createWorkflow } from '@mastra/core/workflows';
import { getDiffStep } from '../steps/reviewer/get-diff.js';
import { handleReviewResultStep } from '../steps/reviewer/handle-result.js';
import { reviewCodeStep } from '../steps/reviewer/review-code.js';
import {
  reviewerWorkflowInputSchema,
  reviewerWorkflowOutputSchema,
} from './reviewer.workflow.types.js';

export {
  reviewerWorkflowInputSchema,
  reviewerWorkflowOutputSchema,
} from './reviewer.workflow.types.js';

export type { ReviewerWorkflowInput, ReviewerWorkflowOutput } from './reviewer.workflow.types.js';

export const reviewerWorkflow = createWorkflow({
  id: 'reviewer-workflow',
  inputSchema: reviewerWorkflowInputSchema,
  outputSchema: reviewerWorkflowOutputSchema,
})
  .then(getDiffStep)
  .then(reviewCodeStep)
  .then(handleReviewResultStep)
  .commit();
