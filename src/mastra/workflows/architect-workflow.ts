import { createWorkflow } from '@mastra/core/workflows';
import { analyzeRequirementsStep } from '../steps/architect/analyze-requirements';
import { confirmTasksStep } from '../steps/architect/confirm-tasks';
import { createTasksStep } from '../steps/architect/create-tasks';
import {
  architectWorkflowInputSchema,
  architectWorkflowOutputSchema,
} from './architect-workflow.types';

export {
  architectWorkflowInputSchema,
  architectWorkflowOutputSchema,
} from './architect-workflow.types';

export type { ArchitectWorkflowInput, ArchitectWorkflowOutput } from './architect-workflow.types';

export const architectWorkflow = createWorkflow({
  id: 'architect-workflow',
  inputSchema: architectWorkflowInputSchema,
  outputSchema: architectWorkflowOutputSchema,
})
  .then(analyzeRequirementsStep)
  .then(confirmTasksStep)
  .then(createTasksStep)
  .commit();
