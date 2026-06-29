import { createWorkflow } from '@mastra/core/workflows';
import { analyzeRequirements } from '../steps/architect/analyze-requirements.js';
import { confirmTasksStep } from '../steps/architect/confirm-tasks.js';
import { createLinearTasksStep } from '../steps/architect/create-linear-tasks.js';
import {
  architectWorkflowInputSchema,
  architectWorkflowOutputSchema,
} from './architect.workflow.types.js';

export {
  architectWorkflowInputSchema,
  architectWorkflowOutputSchema,
} from './architect.workflow.types.js';

export type {
  ArchitectWorkflowInput,
  ArchitectWorkflowOutput,
} from './architect.workflow.types.js';

export const architectWorkflow = createWorkflow({
  id: 'architect-workflow',
  inputSchema: architectWorkflowInputSchema,
  outputSchema: architectWorkflowOutputSchema,
})
  .then(analyzeRequirements)
  .then(confirmTasksStep)
  .then(createLinearTasksStep)
  .commit();
