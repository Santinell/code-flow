import { createStep } from '@mastra/core/workflows';
import {
  developerNoFixOutputSchema,
  developerRunTestsOutputSchema,
} from '../../workflows/developer.workflow.types.js';

export const skipFixStep = createStep({
  id: 'skip-fix',
  inputSchema: developerRunTestsOutputSchema,
  outputSchema: developerNoFixOutputSchema,
  execute: async ({ inputData }) => ({ ...inputData, fixSkipped: true as const }),
});
