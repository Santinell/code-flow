import { createStep } from '@mastra/core/workflows';
import {
  developerFixStepOutputSchema,
  developerRunTestsOutputSchema,
} from '../../workflows/developer.workflow.types.js';

export const skipFixStep = createStep({
  id: 'skip-fix',
  inputSchema: developerRunTestsOutputSchema,
  outputSchema: developerFixStepOutputSchema,
  execute: async ({ inputData }) => ({ ...inputData, fixResult: '', fixSkipped: true as const }),
});
