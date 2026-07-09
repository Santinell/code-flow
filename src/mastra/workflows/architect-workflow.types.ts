import { z } from 'zod';

export const architectPrioritySchema = z
  .number()
  .int()
  .min(0)
  .max(4)
  .default(3)
  .describe('Linear priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low');

export const architectTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: architectPrioritySchema,
});

export const architectWorkflowInputSchema = z.object({
  userId: z.number().int().positive(),
  chatId: z.number().int().positive(),
  userMessage: z.string().min(1),
  threadId: z.string().min(1),
});

export const architectTasksResultSchema = z.object({
  userId: z.number().int().positive(),
  chatId: z.number().int().positive(),
  threadId: z.string().min(1),
  tasks: z.array(architectTaskSchema).min(1),
  parseError: z.literal(false),
});

export const architectParseTasksOutputSchema = architectTasksResultSchema;

export const architectCreateTasksInputSchema = architectTasksResultSchema;

export const architectCreatedTaskSchema = z.object({
  taskId: z.string(),
  identifier: z.string(),
  title: z.string(),
  branchName: z.string(),
});

export const architectWorkflowOutputSchema = z.object({
  chatId: z.number().int().positive(),
  status: z.enum(['clarification_required', 'parse_error', 'completed']),
  created: z.array(architectCreatedTaskSchema).default([]),
  rawOutput: z.string().default(''),
  error: z.string().default(''),
});

export const architectGenerateOutputSchema = z.object({
  message: z.string().describe('Conversational response to the user in Russian'),
  needsClarification: z.boolean().describe('Whether user requirements need clarification'),
  tasks: z.array(architectTaskSchema).describe('List of tasks extracted from the requirement'),
});

export type ArchitectTask = z.infer<typeof architectTaskSchema>;
export type ArchitectGenerateOutput = z.infer<typeof architectGenerateOutputSchema>;
export type ArchitectWorkflowInput = z.infer<typeof architectWorkflowInputSchema>;
export type ArchitectParseTasksOutput = z.infer<typeof architectParseTasksOutputSchema>;
export type ArchitectCreateTasksInput = z.infer<typeof architectCreateTasksInputSchema>;
export type ArchitectCreatedTask = z.infer<typeof architectCreatedTaskSchema>;
export type ArchitectWorkflowOutput = z.infer<typeof architectWorkflowOutputSchema>;
