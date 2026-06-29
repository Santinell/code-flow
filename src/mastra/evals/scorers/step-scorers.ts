import { createScorer, type MastraScorers } from '@mastra/core/evals';
import { z } from 'zod';
import { judgeConfig } from './shared.js';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
interface JsonObject {
  [key: string]: JsonValue;
}
interface JsonArray extends Array<JsonValue> {}

const ALLOWED_VERDICTS = ['approve', 'request_changes'] as const;

export const stepReviewStructuredOutputScorer = createScorer({
  id: 'step-review-structured-output',
  description:
    'Validates that review-code step output has correct structure (reviewText, verdict, isApproved)',
})
  .generateScore(({ run }) => {
    const output = run.output as Record<string, JsonValue>;
    if (!output) {
      return 0;
    }

    const reviewText = output.reviewText;
    const verdict = output.verdict;
    const isApproved = output.isApproved;

    if (typeof reviewText !== 'string' || reviewText.trim().length === 0) {
      return 0;
    }
    if (!ALLOWED_VERDICTS.includes(verdict as (typeof ALLOWED_VERDICTS)[number])) {
      return 0;
    }
    if (typeof isApproved !== 'boolean') {
      return 0;
    }
    if ((isApproved && verdict !== 'approve') || (!isApproved && verdict !== 'request_changes')) {
      return 0;
    }

    return 1;
  })
  .generateReason(({ run, score }) => {
    if (score === 1) {
      return 'Review output structure is valid';
    }
    const output = run.output as Record<string, JsonValue> | undefined;
    if (!output) {
      return 'Output is missing';
    }
    const issues: string[] = [];
    if (typeof output.reviewText !== 'string' || !(output.reviewText as string).trim()) {
      issues.push('reviewText is missing or empty');
    }
    if (!ALLOWED_VERDICTS.includes(output.verdict as (typeof ALLOWED_VERDICTS)[number])) {
      issues.push(`verdict is not one of: ${ALLOWED_VERDICTS.join(', ')}`);
    }
    if (typeof output.isApproved !== 'boolean') {
      issues.push('isApproved is not a boolean');
    }
    return `Invalid review output: ${issues.join('; ')}`;
  });

export const stepReviewVerdictAlignedScorer = createScorer({
  id: 'step-review-verdict-aligned',
  description:
    'Compares review verdict with expected verdict from ground truth, or validates verdict-diff alignment using LLM judge',
  judge: {
    ...judgeConfig,
    instructions: `${judgeConfig.instructions} Evaluate whether the reviewer's verdict aligns with the code diff content.`,
  },
})
  .preprocess(({ run }) => {
    const output = run.output as Record<string, JsonValue> | undefined;
    const gt = run.groundTruth as { expectedVerdict?: string } | undefined;
    const verdict = typeof output?.verdict === 'string' ? output.verdict : null;
    const diff = typeof output?.diff === 'string' ? output.diff : '';

    return {
      verdict,
      diff,
      expectedVerdict: gt?.expectedVerdict ?? null,
      hasGroundTruth: gt != null,
    };
  })
  .analyze({
    description: 'Check if verdict aligns with the diff or ground truth',
    outputSchema: z.object({
      aligned: z.boolean(),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => {
      const { verdict, diff, expectedVerdict, hasGroundTruth } = results.preprocessStepResult ?? {};

      if (hasGroundTruth && expectedVerdict) {
        const aligned = verdict === expectedVerdict;
        return `The reviewer verdict is "${verdict}" and the expected verdict is "${expectedVerdict}".
Verdict ${aligned ? 'matches' : 'does NOT match'} expected.

Respond in JSON:
{
  "aligned": ${aligned},
  "explanation": "Verdict ${aligned ? 'matches' : 'does NOT match'} expected ${expectedVerdict}"
}`;
      }

      if (!diff || !verdict) {
        return `No diff or verdict available for evaluation.

Respond in JSON:
{
  "aligned": true,
  "explanation": "Skipped: no diff or verdict available"
}`;
      }

      return `You are evaluating a code review. The reviewer gave verdict: "${verdict}".

Code diff:
\`\`\`diff
${diff.slice(0, 3000)}
\`\`\`

Determine if "${verdict}" is a reasonable verdict for this diff.
- "approve" = code is safe, clean, and ready to merge
- "request_changes" = code has issues that must be fixed

Respond in JSON:
{
  "aligned": <boolean>,
  "explanation": "<brief reasoning>"
}`;
    },
  })
  .generateScore(({ results }) => {
    return results.analyzeStepResult?.aligned ? 1 : 0;
  })
  .generateReason(({ results }) => {
    return results.analyzeStepResult?.explanation ?? 'No analysis result';
  });

export const stepImplementAccuracyScorer = createScorer({
  id: 'step-implement-accuracy',
  description:
    'Evaluates whether the implementation result matches the task description using LLM judge',
  judge: {
    ...judgeConfig,
    instructions: `${judgeConfig.instructions} Evaluate whether the implementation accurately addresses the task description.`,
  },
})
  .preprocess(({ run }) => {
    const output = run.output as Record<string, JsonValue> | undefined;
    const gt = run.groundTruth as { expectedChanges?: string[] } | undefined;

    return {
      implementationResult:
        typeof output?.implementationResult === 'string' ? output.implementationResult : '',
      taskDescription: typeof output?.taskDescription === 'string' ? output.taskDescription : '',
      taskTitle: typeof output?.taskTitle === 'string' ? output.taskTitle : '',
      expectedChanges: gt?.expectedChanges ?? null,
      hasGroundTruth: gt != null,
    };
  })
  .analyze({
    description: 'Assess implementation accuracy against task',
    outputSchema: z.object({
      accurate: z.boolean(),
      score: z.number().min(0).max(1),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => {
      const { implementationResult, taskDescription, taskTitle, expectedChanges, hasGroundTruth } =
        results.preprocessStepResult ?? {};

      if (!implementationResult) {
        return `No implementation result to evaluate.

Respond in JSON:
{
  "accurate": false,
  "score": 0,
  "explanation": "No implementation result found"
}`;
      }

      let prompt = `Task: ${taskTitle ?? 'N/A'}
Task description: ${taskDescription ?? 'N/A'}

Implementation result:
${implementationResult.slice(0, 3000)}`;

      if (hasGroundTruth && expectedChanges && expectedChanges.length > 0) {
        prompt += `\n\nExpected files to change: ${expectedChanges.join(', ')}
Evaluate if the implementation mention changes to the expected files.`;
      }

      prompt += `\n\nRate from 0.0 to 1.0 how accurately this implementation addresses the task.

Respond in JSON:
{
  "accurate": <boolean>,
  "score": <number 0.0-1.0>,
  "explanation": "<brief reasoning>"
}`;

      return prompt;
    },
  })
  .generateScore(({ results }) => {
    return results.analyzeStepResult?.score ?? 0;
  })
  .generateReason(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 'No analysis result';
    }
    return `Accuracy: ${r.score}, accurate: ${r.accurate}. ${r.explanation}`;
  });

const GIT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bgit\s+(?:add|commit|push|checkout|switch|merge|reset|rebase|branch|init|clone|pull|fetch|stash|log|diff)\b/i,
  /\bgits\b/i,
  /```\s*(?:bash|sh|shell)\s*\n\s*git\s+/i,
  /`git\s+/i,
];

export const stepImplementNoGitScorer = createScorer({
  id: 'step-implement-no-git',
  description: 'Checks that the implementation step output does not contain git commands',
})
  .generateScore(({ run }) => {
    const output = run.output as Record<string, JsonValue> | undefined;
    const implResult =
      typeof output?.implementationResult === 'string' ? output.implementationResult : '';

    if (!implResult) {
      return 1;
    }

    const matches = GIT_PATTERNS.some((pattern) => pattern.test(implResult));
    return matches ? 0 : 1;
  })
  .generateReason(({ score }) => {
    if (score === 1) {
      return 'No git commands found in implementation output';
    }
    return 'Implementation output contains git command references';
  });

export const stepScorerRegistry = {
  'step-review-structured-output': stepReviewStructuredOutputScorer,
  'step-review-verdict-aligned': stepReviewVerdictAlignedScorer,
  'step-implement-accuracy': stepImplementAccuracyScorer,
  'step-implement-no-git': stepImplementNoGitScorer,
};

export const stepLiveScorers = {
  'step-review-structured-output': {
    scorer: stepReviewStructuredOutputScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'step-review-verdict-aligned': {
    scorer: stepReviewVerdictAlignedScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
} satisfies MastraScorers;

export const stepScorers = stepLiveScorers;
