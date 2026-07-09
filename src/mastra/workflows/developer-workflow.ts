import { createWorkflow } from '@mastra/core/workflows';
import { analyzeCodebaseStep } from '../steps/developer/analyze-codebase';
import { claimTaskStep } from '../steps/developer/claim-task';
import { commitChangesStep } from '../steps/developer/commit-changes';
import { createBranchStep } from '../steps/developer/create-branch';
import { fixTestFailuresStep } from '../steps/developer/fix-test-failures';
import { implementStep } from '../steps/developer/implement';
import { installDepsStep } from '../steps/developer/install-deps';
import { moveToReviewStep } from '../steps/developer/move-to-review';
import { runTestsStep } from '../steps/developer/run-tests';
import { skipFixStep } from '../steps/developer/skip-fix';
import {
  developerWorkflowInputSchema,
  developerWorkflowOutputSchema,
} from './developer-workflow.types';

export {
  developerWorkflowInputSchema,
  developerWorkflowOutputSchema,
} from './developer-workflow.types';

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
