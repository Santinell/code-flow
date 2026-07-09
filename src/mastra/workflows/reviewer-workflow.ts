import { createWorkflow } from '@mastra/core/workflows';
import { getDiffStep } from '../steps/reviewer/get-diff';
import { handleReviewResultStep } from '../steps/reviewer/handle-result';
import { reviewCodeStep } from '../steps/reviewer/review-code';
import {
  reviewerWorkflowInputSchema,
  reviewerWorkflowOutputSchema,
} from './reviewer-workflow.types';

export {
  reviewerWorkflowInputSchema,
  reviewerWorkflowOutputSchema,
} from './reviewer-workflow.types';

export type { ReviewerWorkflowInput, ReviewerWorkflowOutput } from './reviewer-workflow.types';

export const reviewerWorkflow = createWorkflow({
  id: 'reviewer-workflow',
  inputSchema: reviewerWorkflowInputSchema,
  outputSchema: reviewerWorkflowOutputSchema,
})
  .then(getDiffStep)
  .then(reviewCodeStep)
  .then(handleReviewResultStep)
  .commit();
