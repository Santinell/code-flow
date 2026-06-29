import { createScorer, ScorerRunOutputForAgent, type MastraScorers } from '@mastra/core/evals';
import { getUserMessageFromRunInput } from '@mastra/evals/scorers/utils';
import { z } from 'zod';
import { ReviewerGenerateOutput } from '../../workflows/reviewer.workflow.types.js';
import { getToolResultContexts, judgeConfig, judgeModel } from './shared.js';

function getResponse(output: ScorerRunOutputForAgent): ReviewerGenerateOutput {
  return output.at(-1)?.content.metadata?.structuredOutput as ReviewerGenerateOutput;
}

function isReviewerResponse(value: object): value is ReviewerGenerateOutput {
  return value != null && 'verdict' in value && value.verdict != null;
}

export const reviewerVerdictConfidenceScorer = createScorer({
  id: 'reviewer-verdict-confidence',
  description: 'Compares reviewer verdict with ground-truth expected verdict',
  type: 'agent',
})
  .generateScore(({ run }) => {
    const gt = run.groundTruth as { expectedVerdict?: string } | undefined;
    if (!gt?.expectedVerdict) {
      return 1;
    }

    const response = getResponse(run.output);
    if (!isReviewerResponse(response)) {
      return 0;
    }

    return response.verdict === gt.expectedVerdict ? 1 : 0;
  })
  .generateReason(({ run, score }) => {
    const expected = (run.groundTruth as { expectedVerdict?: string } | undefined)?.expectedVerdict;
    const response = getResponse(run.output);
    const actual = isReviewerResponse(response) ? response.verdict : 'not_parsed';
    return `Verdict ${score === 1 ? 'matches' : 'mismatches'} expected: "${expected}", got: "${actual}"`;
  });

const REVIEWER_FAITHFULNESS_JUDGE_INSTRUCTIONS = `You are a precise faithfulness evaluator for a code reviewer agent. Your job is to verify whether claims in the reviewer's output are supported by the provided context (code diff, file contents, system prompt).

**Critical distinction — what is NOT a hallucination in a code review context:**

1. **Subjective severity labels** — Terms like "critical vulnerability", "severe bug", "minor issue", "safe approach" are the reviewer's professional judgment based on the code shown. If the underlying fact (e.g., SQL injection exists, hardcoded secret is present) IS supported by the diff, then the severity label is a valid assessment and should be marked as SUPPORTED.

2. **Standard software engineering consequences** — Statements about what a vulnerability COULD lead to (e.g., "SQL injection can lead to data exfiltration", "hardcoded secrets can cause unauthorized charges", "unhandled exceptions could crash the server") are standard domain knowledge that extends from the shown code. If the vulnerability IS clearly present in the diff, these consequences are reasonable inferences and should be marked as SUPPORTED.

3. **Comparative judgments** — Statements comparing old vs new code (e.g., "the original ORM query was safer", "raw SQL adds maintenance overhead") are reasonable assessments when the diff clearly shows the change. Mark them as SUPPORTED if the change is visible in the diff.

**What IS a hallucination:**
- Claiming bugs that don't exist in the code shown
- Referencing files or code not present in the diff
- Asserting specific facts that contradict the diff (e.g., "the code uses parameterized queries" when it clearly uses concatenation)
- Inventing tool calls or file reads that didn't happen

**Verdict rules:**
- "yes" — the claim is directly supported by the diff/context OR is a reasonable professional assessment based on the shown code
- "no" — the claim directly contradicts the context
- "unsure" — the claim cannot be verified or contradicted from the context alone, AND is not a standard professional assessment of the visible code

When in doubt between "unsure" and "no", prefer "unsure".`;

function createReviewerFaithfulnessExtractPrompt(output: string): string {
  return `Extract all claims from the given code review output. A claim is any statement that asserts information, including both factual and speculative assertions.

Guidelines for claim extraction:
- Break down compound statements into individual claims
- Include all statements that assert information
- Include both definitive and speculative claims (using words like may, might, could)
- Extract specific details like numbers, dates, and quantities
- Keep relationships between entities
- Include predictions and possibilities
- Extract claims with their full context
- Exclude only questions and commands

Example:
Text: "The Tesla Model S was launched in 2012 and has a range of 405 miles. The car can accelerate from 0 to 60 mph in 1.99 seconds. I think it might be the best electric car ever made and could receive major updates next year."

{
    "claims": [
        "The Tesla Model S was launched in 2012",
        "The Tesla Model S has a range of 405 miles",
        "The Tesla Model S can accelerate from 0 to 60 mph in 1.99 seconds",
        "The Tesla Model S might be the best electric car ever made",
        "The Tesla Model S could receive major updates next year"
    ]
}
Note: All assertions are included, even speculative ones, as they need to be verified against the context.

Please return only JSON format with "claims" array.
Return empty list for empty input.

Code review text:
${output}

JSON:`;
}

function createReviewerFaithfulnessAnalyzePrompt(claims: string[], context: string[]): string {
  return `Verify each claim against the provided context. Determine if each claim is supported by, contradicts, or is not mentioned in the context.

Context:
${context.join('\n')}

Number of claims: ${claims.length}

Claims to verify:
${claims.join('\n')}

For each claim, provide a verdict and reasoning. The verdict must be one of:
- "yes" if the claim is supported by the context OR is a reasonable professional code review assessment based on the code shown
- "no" if the claim directly contradicts the context
- "unsure" if the claim cannot be verified or contradicted from the context alone

IMPORTANT: A code reviewer's job is to assess severity and consequences. Subjective labels (critical, severe, minor, safe), standard vulnerability consequences (data exfiltration, server crash), and comparative judgments (safer than before) based on visible code are VALID professional assessments and should be marked "yes", not "no" or "unsure".

The number of verdicts MUST MATCH the number of claims exactly.

Format:
{
    "verdicts": [
        {
            "claim": "claim text",
            "verdict": "yes/no/unsure",
            "reason": "explanation of verification"
        }
    ]
}

Rules:
- Only use information from the provided context
- Mark claims as "no" ONLY if they directly contradict the context
- Mark claims as "yes" if they are supported by the diff/context OR are reasonable reviewer assessments
- Mark claims as "unsure" ONLY if truly unverifiable (not just subjective — subjective assessments based on visible code are "yes")
- Claims with speculative language (may, might, possibly) that describe standard consequences of visible issues should be "yes"
- Never use prior knowledge outside of standard software engineering
- Provide clear reasoning for each verdict`;
}

function createReviewerFaithfulnessReasonPrompt(params: {
  output: string;
  context: string[];
  score: number;
  verdicts: Array<{ claim: string; verdict: string; reason: string }>;
}): string {
  return `Explain the faithfulness score (0 lowest, 1 highest) for the reviewer's output using this context:

Context:
${params.context.join('\n')}

Reviewer output:
${params.output}

Score: ${params.score}
Verdicts:
${JSON.stringify(params.verdicts)}

Rules:
- Explain score based on ratio of supported claims ("yes" verdicts) to total claims
- Focus on factual consistency with the diff and context
- Keep explanation concise and focused
- Use given score, don't recalculate
- Explain both supported and unsupported aspects

Format:
"The score is {score} because {explanation of faithfulness}"`;
}

export const reviewerHallucinationScorer = createScorer({
  id: 'reviewer-hallucination',
  description:
    'Evaluates faithfulness of reviewer output against the diff, file contents, and tool results. Distinguishes subjective assessments from factual hallucinations.',
  type: 'agent',
  judge: {
    model: judgeModel,
    instructions: REVIEWER_FAITHFULNESS_JUDGE_INSTRUCTIONS,
    jsonPromptInjection: true,
  },
})
  .preprocess({
    description: 'Extract claims from reviewer feedback',
    outputSchema: z.object({
      claims: z.array(z.string()),
    }),
    createPrompt: ({ run }) => {
      const response = getResponse(run.output);
      const reviewText = isReviewerResponse(response) ? response.feedback : '';
      return createReviewerFaithfulnessExtractPrompt(reviewText);
    },
  })
  .analyze({
    description: 'Verify claims against the diff, file contents, and tool results',
    outputSchema: z.object({
      verdicts: z.array(
        z.object({
          claim: z.string(),
          verdict: z.enum(['yes', 'no', 'unsure']),
          reason: z.string(),
        })
      ),
    }),
    createPrompt: ({ results, run }) => {
      const claims: string[] = results.preprocessStepResult?.claims ?? [];
      const context = getToolResultContexts(run.output);
      const userMessage = getUserMessageFromRunInput(run.input);
      if (userMessage) {
        context.unshift(userMessage);
      }
      return createReviewerFaithfulnessAnalyzePrompt(claims, context);
    },
  })
  .generateScore(({ results }) => {
    const verdicts = results.analyzeStepResult?.verdicts ?? [];
    if (verdicts.length === 0) {
      return 0;
    }
    const supported = verdicts.filter((v) => v.verdict === 'yes').length;
    return Math.round((supported / verdicts.length) * 100) / 100;
  })
  .generateReason({
    description: 'Explain faithfulness score',
    createPrompt: ({ run, results, score }) => {
      const response = getResponse(run.output);
      const reviewText = isReviewerResponse(response) ? response.feedback : '';
      const context = getToolResultContexts(run.output);
      return createReviewerFaithfulnessReasonPrompt({
        output: reviewText,
        context,
        score,
        verdicts: results.analyzeStepResult?.verdicts ?? [],
      });
    },
  });

export const reviewerFalsePositivesScorer = createScorer({
  id: 'reviewer-false-positives',
  description: 'On curated diffs without bugs, checks that reviewer does not find false issues',
  type: 'agent',
  judge: {
    ...judgeConfig,
    instructions: `${judgeConfig.instructions} Focus on detecting false positive claims in code review output. IMPORTANT: On clean diffs, observations about missing tests, missing documentation, or style suggestions (🟢 Suggestion severity) are NOT false positives — they are valid review observations required by the reviewer's system prompt. Only count claims of actual bugs, security vulnerabilities, logic errors, or quality regressions that do NOT exist in the clean diff.`,
  },
})
  .preprocess(({ run }) => {
    const groundTruth = run.groundTruth as { isClean?: boolean } | undefined;
    const response = getResponse(run.output);
    const reviewText = isReviewerResponse(response) ? response.feedback : '';
    return { isClean: groundTruth?.isClean === true, reviewText };
  })
  .analyze({
    description: 'Analyze the review for false positive findings',
    outputSchema: z.object({
      falsePositiveCount: z.number(),
      hasFalsePositives: z.boolean(),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => {
      const review = results.preprocessStepResult?.reviewText ?? '';
      const isClean = results.preprocessStepResult?.isClean === true;
      if (!isClean) {
        return `This reviewer false-positive scorer is only applicable to curated clean diffs.

Respond in JSON format:
{
  "falsePositiveCount": 0,
  "hasFalsePositives": false,
  "explanation": "Skipped because this eval item is not marked as a clean diff."
}`;
      }

      return `You are evaluating a code review produced by an automated reviewer agent.

The diff being reviewed is KNOWN TO BE CLEAN — it contains no bugs, security vulnerabilities, or quality issues.

IMPORTANT DISTINCTIONS for this evaluation:
- The reviewer's system prompt REQUIRES addressing all 5 focus areas (Security, Code Quality, Error Handling, Testing, Performance) — even when there are no real issues.
- Valid review observations on a clean diff INCLUDE: "no test file exists", "consider adding tests", "minor style preferences", brief notes like "no security concerns found". These are NOT false positives.
- Mark as FALSE POSITIVE ONLY claims that assert actual bugs, vulnerabilities, logic errors, or quality regressions that are NOT present in the clean diff.
- If the reviewer says "🟢 Suggestion: no tests found" this is a valid observation, not a false positive.
- If the reviewer says "🔴 Blocker: SQL injection" on a clean diff with no SQL injection, THAT is a false positive.

Review text:
${review}

Count how many claimed ISSUES are false positives (invented bugs/vulnerabilities/defects, NOT test-gap observations or style suggestions).

Respond in JSON format:
{
  "falsePositiveCount": <number>,
  "hasFalsePositives": <boolean>,
  "explanation": "<brief explanation of what was found>"
}`;
    },
  })
  .generateScore(({ results }) => {
    if (results.preprocessStepResult?.isClean !== true) {
      return 1;
    }
    return results.analyzeStepResult?.hasFalsePositives ? 0 : 1;
  })
  .generateReason(({ results }) => {
    if (results.preprocessStepResult?.isClean !== true) {
      return 'Skipped: false-positive scorer only applies to curated clean diffs';
    }

    const r = results.analyzeStepResult;
    if (!r) {
      return 'No analysis result';
    }
    return `False positives: ${r.falsePositiveCount}, hasFalsePositives: ${r.hasFalsePositives}. ${r.explanation}`;
  });

export const reviewerSecurityCoverageScorer = createScorer({
  id: 'reviewer-security-coverage',
  description: 'Validates that the review covers all 5 focus areas from the reviewer system prompt',
  type: 'agent',
  judge: {
    ...judgeConfig,
    instructions: `${judgeConfig.instructions} Evaluate whether the code review covers all required focus areas.`,
  },
})
  .preprocess(({ run }) => {
    const response = getResponse(run.output);
    const reviewText = isReviewerResponse(response) ? response.feedback : '';
    return { reviewText };
  })
  .analyze({
    description: 'Evaluate coverage of all 5 review focus areas',
    outputSchema: z.object({
      securityCovered: z.boolean(),
      codeQualityCovered: z.boolean(),
      errorHandlingCovered: z.boolean(),
      testingCovered: z.boolean(),
      performanceCovered: z.boolean(),
      coveredCount: z.number(),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => {
      const review = results.preprocessStepResult?.reviewText ?? '';
      return `You are evaluating a code review for coverage of 5 required focus areas:

1. Security - injection, XSS, secrets in code, auth issues, input validation
2. Code Quality - readability, maintainability, DRY, SOLID principles
3. Error Handling - edge cases, proper error messages, graceful failures
4. Testing - sufficient tests, edge case coverage
5. Performance - obvious performance concerns

Review text:
${review}

For each area, determine if the reviewer ADEQUATELY addressed it (at least a brief mention, not just a heading). Respond in JSON format:
{
  "securityCovered": <boolean>,
  "codeQualityCovered": <boolean>,
  "errorHandlingCovered": <boolean>,
  "testingCovered": <boolean>,
  "performanceCovered": <boolean>,
  "coveredCount": <number 0-5>,
  "explanation": "<brief summary of which areas were covered or missed>"
}`;
    },
  })
  .generateScore(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 0;
    }
    return r.coveredCount >= 5 ? 1 : r.coveredCount / 5;
  })
  .generateReason(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 'No analysis result';
    }
    return `Coverage: ${r.coveredCount}/5. Security: ${r.securityCovered}, Quality: ${r.codeQualityCovered}, ErrorHandling: ${r.errorHandlingCovered}, Testing: ${r.testingCovered}, Performance: ${r.performanceCovered}. ${r.explanation}`;
  });

export const reviewerScorerRegistry = {
  'reviewer-verdict-confidence': reviewerVerdictConfidenceScorer,
  'reviewer-hallucination': reviewerHallucinationScorer,
  'reviewer-false-positives': reviewerFalsePositivesScorer,
  'reviewer-security-coverage': reviewerSecurityCoverageScorer,
};

export const reviewerLiveScorers = {
  'reviewer-verdict-confidence': {
    scorer: reviewerVerdictConfidenceScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'reviewer-hallucination': {
    scorer: reviewerHallucinationScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'reviewer-false-positives': {
    scorer: reviewerFalsePositivesScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'reviewer-security-coverage': {
    scorer: reviewerSecurityCoverageScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
} satisfies MastraScorers;

export const reviewerScorers = reviewerLiveScorers;
