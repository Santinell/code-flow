import { createStep } from '@mastra/core/workflows';
import { getEnv } from '#config/env';
import {
  stepReviewStructuredOutputScorer,
  stepReviewVerdictAlignedScorer,
} from '#evals/scorers/step-scorers';
import { reviewerAgent } from '#mastra/agents/reviewer-agent';
import {
  reviewerReviewOutputSchema,
  reviewerDiffOutputSchema,
  reviewerGenerateOutputSchema,
} from '#mastra/workflows/reviewer-workflow.types';
import { buildWorkspaceRequestContext } from '#mastra/workspace';
import { createLogger } from '#utils/logger';
import { getWorktreePath, runInWorktree } from '#utils/worktree-context';

const log = createLogger('review-code-step');
const env = getEnv();

export const reviewCodeStep = createStep({
  id: 'review-code',
  inputSchema: reviewerDiffOutputSchema,
  outputSchema: reviewerReviewOutputSchema,
  scorers: {
    'step-review-structured-output': {
      scorer: stepReviewStructuredOutputScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    'step-review-verdict-aligned': {
      scorer: stepReviewVerdictAlignedScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
  retries: 3,
  execute: async ({ inputData }) => {
    const worktreePath = getWorktreePath(inputData.branchName);

    const prompt = `Review the following code changes for task **${inputData.taskIdentifier}: ${inputData.taskTitle}**.

## Task Description
${inputData.taskDescription}

## Task Comments
${inputData.taskComments?.length ? inputData.taskComments.join('\n') : 'No comments'}

## Branch: \`${inputData.branchName}\`

## Changed Files
${inputData.changedFiles.map((file) => `- \`${file}\``).join('\n')}

## Full Diff
\`\`\`diff
${inputData.diff}
\`\`\`

Perform a thorough code review.
Use the readFile tool to inspect any file in detail if you need more context.
You cannot run commands or modify anything — only read and analyze.`;

    const result = await runInWorktree(worktreePath, async () => {
      return reviewerAgent.generate(prompt, {
        structuredOutput: {
          schema: reviewerGenerateOutputSchema,
        },
        modelSettings: {
          maxRetries: 3,
          maxOutputTokens: env.MAX_OUTPUT_TOKENS_REVIEWER,
        },
        requestContext: buildWorkspaceRequestContext(worktreePath),
        returnScorerData: true,
      });
    });

    const output = result.object;
    const reviewText = output.feedback ?? '';
    const isApproved = output.verdict === 'approve';
    const verdict = output.verdict ?? 'request_changes';

    log.info({ taskIdentifier: inputData.taskIdentifier, verdict }, 'Code review complete');

    return { ...inputData, reviewText, verdict, isApproved };
  },
});
