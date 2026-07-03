import { createWorkflow } from '@mastra/core/workflows';
import { analyzeCodebaseStep } from '../steps/developer/analyze-codebase.js';
import { claimTaskStep } from '../steps/developer/claim-task.js';
import { commitChangesStep } from '../steps/developer/commit-changes.js';
import { createBranchStep } from '../steps/developer/create-branch.js';
import { fixTestFailuresStep } from '../steps/developer/fix-test-failures.js';
import { implementStep } from '../steps/developer/implement.js';
import { installDepsStep } from '../steps/developer/install-deps.js';
import { moveToReviewStep } from '../steps/developer/move-to-review.js';
import { runTestsStep } from '../steps/developer/run-tests.js';
import { skipFixStep } from '../steps/developer/skip-fix.js';
import {
  developerWorkflowInputSchema,
  developerWorkflowOutputSchema,
} from './developer.workflow.types.js';

export {
  developerWorkflowInputSchema,
  developerWorkflowOutputSchema,
} from './developer.workflow.types.js';

export const developerWorkflow = createWorkflow({
  id: 'developer-workflow',
  inputSchema: developerWorkflowInputSchema,
  outputSchema: developerWorkflowOutputSchema,
})
  .then(claimTaskStep)
  .then(createBranchStep)
  .then(installDepsStep)
  .then(analyzeCodebaseStep)
  .then(implementStep)
  .then(runTestsStep)
  .branch([
    [async ({ inputData }) => !inputData.testResult.passed, fixTestFailuresStep],
    [async () => true, skipFixStep],
  ])
  .then(commitChangesStep)
  .then(moveToReviewStep)
  .commit();
