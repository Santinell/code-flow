import { createStep } from '@mastra/core/workflows';
import {
  developerFixStepOutputSchema,
  developerRunTestsOutputSchema,
} from '#mastra/workflows/developer-workflow.types';

export const skipFixStep = createStep({
  id: 'skip-fix',
  inputSchema: developerRunTestsOutputSchema,
  outputSchema: developerFixStepOutputSchema,
  execute: async ({ inputData }) => ({ ...inputData, fixResult: '', fixSkipped: true as const }),
});
