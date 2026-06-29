import {
  createScorer,
  ScorerRunInputForAgent,
  ScorerRunOutputForAgent,
  type MastraScorers,
} from '@mastra/core/evals';
import {
  createPromptAlignmentScorerLLM,
  createToxicityScorer,
} from '@mastra/evals/scorers/prebuilt';
import { z } from 'zod';
import { ArchitectGenerateOutput } from '../../workflows/architect.workflow.types.js';
import { enableJsonPromptInjection, judgeConfig, judgeModel } from './shared.js';
import type { ArchitectDatasetItem } from '../datasets/architect.dataset.js';

// Store ground truth data indexed by input text for scorer access
const groundTruthByInput = new Map<string, ArchitectDatasetItem['groundTruth']>();

export function setGroundTruthData(items: ArchitectDatasetItem[]) {
  groundTruthByInput.clear();
  for (const item of items) {
    groundTruthByInput.set(item.input, item.groundTruth);
  }
}

function getGroundTruthForRun(run: { input?: ScorerRunInputForAgent }): ArchitectDatasetItem['groundTruth'] | undefined {
  const inputText = getInputText(run.input);
  return groundTruthByInput.get(inputText);
}

function getResponse(output: ScorerRunOutputForAgent): ArchitectGenerateOutput {
  return output.at(-1)?.content.metadata?.structuredOutput as ArchitectGenerateOutput;
}

function getInputText(input: ScorerRunInputForAgent | undefined): string {
  return input?.inputMessages.join('\n') ?? '';
}

export const architectTaskValidityScorer = createScorer({
  id: 'architect-task-validity',
  description:
    'Validates that architect response contains valid tasks with required fields (title, description, priority, acceptance criteria)',
  type: 'agent',
  judge: {
    ...judgeConfig,
    instructions: `${judgeConfig.instructions} Evaluate the structural validity of task decompositions from an AI architect agent.`,
  },
})
  .preprocess(({ run }) => {
    const response = getResponse(run.output);
    const input = getInputText(run.input);
    return {
      inputText: input.slice(0, 2000),
      needsClarification: response?.needsClarification ?? false,
      message: response?.message ?? '',
      tasks: response?.tasks ?? [],
      parsed: response !== null,
    };
  })
  .analyze({
    description: 'Evaluate task validity for architect output',
    outputSchema: z.object({
      valid: z.boolean(),
      issuesFound: z.number().int(),
      totalTasks: z.number().int(),
      messageQualityScore: z.number().min(0).max(1),
      taskValidityScore: z.number().min(0).max(1),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => {
      const { inputText, needsClarification, message, tasks, parsed } =
        results.preprocessStepResult ?? {};

      if (!parsed) {
        return `The architect agent output could not be parsed as valid JSON with message/needsClarification/tasks fields.

Input: ${inputText.slice(0, 500)}

Respond in JSON:
{
  "valid": false,
  "issuesFound": 1,
  "totalTasks": 0,
  "messageQualityScore": 0,
  "taskValidityScore": 0,
  "explanation": "Output could not be parsed as valid architect JSON response"
}`;
      }

      const tasksJson = JSON.stringify(tasks, null, 2);
      return `You are evaluating the output of an AI architect agent that analyzed a user requirement.

User requirement: ${inputText.slice(0, 500)}
needsClarification: ${needsClarification}
Message to user: ${message.slice(0, 500)}

Tasks (${tasks.length}):
${tasksJson.slice(0, 2000)}

Evaluate:
1. If needsClarification is true: tasks must be empty [], message must contain clear clarifying questions (3-5, specific, relevant)
2. If needsClarification is false: tasks must contain at least 1 task. Each task must have:
   - title: clear, actionable, non-empty
   - description: contains Summary, Context, Requirements, Acceptance Criteria sections (Markdown)
   - priority: integer 0-4

Assign messageQualityScore (0-1) and taskValidityScore (0-1).
If needsClarification is true, taskValidityScore is 1 when tasks is empty, 0 otherwise.

Respond in JSON:
{
  "valid": <boolean>,
  "issuesFound": <number>,
  "totalTasks": <number>,
  "messageQualityScore": <number>,
  "taskValidityScore": <number>,
  "explanation": "<brief reasoning>"
}`;
    },
  })
  .generateScore(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 0;
    }
    if (!results.preprocessStepResult?.parsed) {
      return 0;
    }
    const needsClarification = results.preprocessStepResult?.needsClarification;
    if (needsClarification) {
      return r.messageQualityScore;
    }
    return (r.taskValidityScore + r.messageQualityScore) / 2;
  })
  .generateReason(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 'No analysis result';
    }
    return `Valid: ${r.valid}, issues: ${r.issuesFound}, tasks: ${r.totalTasks}, msgQuality: ${r.messageQualityScore}, taskValidity: ${r.taskValidityScore}. ${r.explanation}`;
  });

export const architectClarificationQualityScorer = createScorer({
  id: 'architect-clarification-quality',
  description:
    'Evaluates the quality of clarification questions when architect needs more information (HITL branch)',
  type: 'agent',
  judge: {
    ...judgeConfig,
    instructions: `${judgeConfig.instructions} Evaluate the quality of clarification questions asked by an AI architect.`,
  },
})
  .preprocess(({ run }) => {
    const response = getResponse(run.output);
    const input = getInputText(run.input);
    return {
      inputText: input.slice(0, 2000),
      needsClarification: response?.needsClarification ?? false,
      message: response?.message ?? '',
    };
  })
  .analyze({
    description: 'Evaluate clarification question quality',
    outputSchema: z.object({
      applicable: z.boolean(),
      score: z.number().min(0).max(1),
      questionCount: z.number().int(),
      specific: z.boolean(),
      relevant: z.boolean(),
      appropriateScope: z.boolean(),
      notRedundant: z.boolean(),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => {
      const { inputText, needsClarification, message } = results.preprocessStepResult ?? {};

      if (!needsClarification || !message) {
        return `Clarification was not needed for this request. Score is not applicable.

Respond in JSON:
{
  "applicable": false,
  "score": 1,
  "questionCount": 0,
  "specific": true,
  "relevant": true,
  "appropriateScope": true,
  "notRedundant": true,
  "explanation": "Clarification was not required - architect proceeded directly to task decomposition"
}`;
      }

      return `User requirement: ${inputText.slice(0, 500)}
Architect clarification response: ${message.slice(0, 1500)}

Evaluate the quality of the architect's clarifying questions:
1. Specific: questions target concrete ambiguities, not generic
2. Relevant: questions are directly related to understanding the requirement
3. Appropriate scope: 3-5 questions, not too few or too many
4. Not redundant: questions don't repeat each other or ask obvious things

Respond in JSON:
{
  "applicable": true,
  "score": <number 0-1>,
  "questionCount": <number>,
  "specific": <boolean>,
  "relevant": <boolean>,
  "appropriateScope": <boolean>,
  "notRedundant": <boolean>,
  "explanation": "<brief reasoning>"
}`;
    },
  })
  .generateScore(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 1;
    }
    return r.applicable ? r.score : 1;
  })
  .generateReason(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 'No analysis result';
    }
    if (!r.applicable) {
      return 'Clarification not required - score not applicable';
    }
    return `Score: ${r.score}, questions: ${r.questionCount}, specific: ${r.specific}, relevant: ${r.relevant}, scope: ${r.appropriateScope}, notRedundant: ${r.notRedundant}. ${r.explanation}`;
  });

export const architectResponseLanguageScorer = createScorer({
  id: 'architect-response-language',
  description: 'Checks that the architect response is in the same language as the user request',
  type: 'agent',
})
  .generateScore(({ run }) => {
    const response = getResponse(run.output);
    if (!response) {
      return 1;
    }
    const input = getInputText(run.input);

    const outputText = response.message;
    if (!outputText || outputText.trim().length === 0) {
      return 1;
    }

    const inputHasCyrillic = /[а-яё]/i.test(input);
    const inputHasLatin = /[a-z]/i.test(input);

    const outputHasCyrillic = /[а-яё]/i.test(outputText);
    const outputHasLatin = /[a-z]/i.test(outputText);

    if (inputHasCyrillic && !outputHasCyrillic && outputText.length > 20) {
      return 0;
    }
    if (inputHasLatin && !outputHasLatin && outputText.length > 20) {
      return 0;
    }

    return 1;
  })
  .generateReason(({ run, score }) => {
    if (score === 1) {
      return 'Response language matches input language';
    }
    const input = getInputText(run.input);
    const inputLang = /[а-яё]/i.test(input) ? 'Russian' : 'English/other';
    return `Response language appears to differ from input language (expected: ${inputLang})`;
  });

export const architectTaskCountScorer = createScorer({
  id: 'architect-task-count',
  description: 'Checks that the number of generated tasks is within reasonable bounds (1-10)',
  type: 'agent',
})
  .generateScore(({ run }) => {
    const response = getResponse(run.output);
    if (!response) {
      return 0;
    }
    if (response.needsClarification) {
      return 1;
    }
    const count = response.tasks.length;
    if (count === 0) {
      return 0;
    }
    if (count > 10) {
      return Math.max(0, 1 - (count - 10) * 0.1);
    }
    return 1;
  })
  .generateReason(({ run }) => {
    const response = getResponse(run.output);
    if (!response) {
      return 'Could not parse architect response';
    }
    if (response.needsClarification) {
      return 'Clarification needed — no tasks expected';
    }
    const count = response.tasks.length;
    if (count === 0) {
      return 'No tasks generated when clarification was not requested';
    }
    if (count > 10) {
      return `Too many tasks: ${count} (max recommended: 10)`;
    }
    return `Task count is reasonable: ${count}`;
  });

// --- Built-in scorers ---

const ARCHITECT_FAITHFULNESS_INSTRUCTIONS = `You are a precise faithfulness evaluator for an architect agent that decomposes user requirements into tasks.

Key Principles:
1. Extract all claims from the architect's output (task titles, descriptions, features mentioned)
2. Verify each claim against the user requirements provided in context
3. Consider a claim truthful if it is explicitly mentioned or logically implied by the user requirements
4. Consider a claim contradictory if it conflicts with the user requirements
5. Consider a claim unsure if it adds features/details not mentioned in the requirements
6. Focus on factual consistency with user requirements, not task quality
7. Reasonable technical elaboration is acceptable (e.g., adding standard implementation details)
8. Never use prior knowledge - only judge based on what's in the user requirements

**What is NOT a hallucination for architect:**
- Adding standard technical implementation details (e.g., "create API endpoint" when user says "add feature")
- Breaking down a feature into logical sub-components
- Mentioning common best practices related to the requirement
- Adding standard fields to tasks (priority, acceptance criteria structure)

**What IS a hallucination:**
- Inventing features not mentioned or implied by the user
- Adding requirements the user didn't ask for
- Changing the scope significantly
- Making up specific technical choices not mentioned (e.g., specific libraries when none were mentioned)`;

function createArchitectFaithfulnessExtractPrompt({ output }: { output: string }): string {
  return `Extract all factual claims about features, requirements, and implementation from the architect's task decomposition.

Guidelines:
- Extract claims from task titles and descriptions
- Include all features and requirements mentioned
- Include technical implementation details mentioned
- Break down compound statements into individual claims
- Focus on "what" is being built, not "how" tasks are structured

Return JSON format with "claims" array.
Return empty list if no tasks or empty input.

Architect Output:
${output}

JSON:`;
}

function createArchitectFaithfulnessAnalyzePrompt({
  claims,
  context,
}: {
  claims: string[];
  context: string[];
}): string {
  return `Verify each claim against the user requirements. Determine if each claim is supported by, contradicts, or adds to the requirements.

User Requirements (Context):
${context.join('\n')}

Number of claims: ${claims.length}

Claims to verify:
${claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}

For each claim, provide a verdict:
- "yes" if the claim is mentioned or clearly implied by the user requirements
- "no" if the claim directly contradicts the requirements
- "unsure" if the claim adds features/details not in the requirements

Rules:
- Reasonable technical elaboration is "yes" (e.g., "create API" for "add feature")
- Standard implementation patterns are "yes"
- NEW features not requested are "unsure"
- Be lenient with logical implications

Format:
{
  "verdicts": [
    {
      "claim": "claim text",
      "verdict": "yes/no/unsure",
      "reason": "explanation"
    }
  ]
}`;
}

export const architectFaithfulnessScorer = enableJsonPromptInjection(
  createScorer({
    id: 'architect-faithfulness',
    name: 'Architect Faithfulness Scorer',
    description: 'Evaluates whether architect tasks are grounded in user requirements',
    judge: {
      model: judgeModel,
      instructions: ARCHITECT_FAITHFULNESS_INSTRUCTIONS,
    },
    type: 'agent',
  })
    .preprocess({
      description: 'Extract claims from architect output',
      outputSchema: z.object({
        claims: z.array(z.string()),
      }),
      createPrompt: ({ run }) => {
        const response = getResponse(run.output);
        const outputText = JSON.stringify(
          {
            message: response?.message,
            tasks: response?.tasks,
          },
          null,
          2
        );
        return createArchitectFaithfulnessExtractPrompt({ output: outputText });
      },
    })
    .analyze({
      description: 'Verify claims against user requirements',
      outputSchema: z.object({
        verdicts: z.array(
          z.object({
            claim: z.string(),
            verdict: z.string(),
            reason: z.string(),
          })
        ),
      }),
      createPrompt: ({ results, run }) => {
        const claims = results?.preprocessStepResult?.claims ?? [];
        const input = getInputText(run.input);
        // Context is the user requirement itself
        const context = [
          'User Requirement:',
          input,
          '',
          'Note: The architect should decompose this requirement into actionable tasks. Reasonable technical elaboration is acceptable.',
        ];
        return createArchitectFaithfulnessAnalyzePrompt({ claims, context });
      },
    })
    .generateScore(({ results }) => {
      const verdicts = results?.analyzeStepResult?.verdicts ?? [];
      if (verdicts.length === 0) {
        return 1; // No claims = no hallucinations
      }
      const supported = verdicts.filter((v) => v.verdict === 'yes').length;
      return Math.round((supported / verdicts.length) * 100) / 100;
    })
    .generateReason({
      description: 'Explain faithfulness score',
      createPrompt: ({ run, results, score }) => {
        const input = getInputText(run.input);
        const response = getResponse(run.output);
        const outputText = response?.message ?? '';
        return `Explain the faithfulness score (0 lowest, 1 highest) for the architect's output.

User Requirement:
${input}

Architect Output:
${outputText}

Score: ${score}
Verdicts:
${JSON.stringify(results?.analyzeStepResult?.verdicts ?? [])}

Rules:
- Explain score based on ratio of supported claims to total claims
- Focus on whether tasks are grounded in user requirements
- Keep explanation concise
- Use given score, don't recalculate

Format:
"The score is {score} because {explanation}"`;
      },
    })
);

export const architectCompletenessScorer = createScorer({
  id: 'architect-completeness',
  description: 'Evaluates whether the architect output is complete according to ground truth expectations',
  type: 'agent',
  judge: {
    ...judgeConfig,
    instructions: `${judgeConfig.instructions} Evaluate the completeness of architect task decomposition.`,
  },
})
  .preprocess(({ run }) => {
    const response = getResponse(run.output);
    const input = getInputText(run.input);
    const groundTruth = getGroundTruthForRun(run);

    return {
      inputText: input.slice(0, 2000),
      response,
      groundTruth,
      actualTasks: response?.tasks.length ?? 0,
      needsClarification: response?.needsClarification ?? false,
    };
  })
  .analyze({
    description: 'Analyze completeness',
    outputSchema: z.object({
      score: z.number().min(0).max(1),
      taskCountMatch: z.boolean(),
      hasRequiredFields: z.boolean(),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => {
      const { inputText, response, groundTruth, actualTasks, needsClarification } = results.preprocessStepResult ?? {};

      if (needsClarification || !response || !groundTruth) {
        return `The architect requested clarification or ground truth is not available. Score as complete (1.0).

Respond in JSON:
{
  "score": 1.0,
  "taskCountMatch": true,
  "hasRequiredFields": true,
  "explanation": "Clarification request is considered complete, or no ground truth available"
}`;
      }

      const { minTasks, maxTasks, requiredKeywords } = groundTruth;
      const taskRange = maxTasks ? `${minTasks}-${maxTasks}` : `at least ${minTasks}`;
      const keywordsText = requiredKeywords.length > 0 ? requiredKeywords.join(', ') : 'none';

      return `Evaluate the completeness of architect output.

User requirement: ${inputText?.slice(0, 500)}

Expected:
- Task count: ${taskRange}
- Required keywords to cover: ${keywordsText}

Actual output:
- Task count: ${actualTasks}
- Tasks: ${JSON.stringify(response.tasks, null, 2).slice(0, 1500)}

Evaluate:
1. Task count matches expected range
2. All tasks have required fields (title, description, priority)
3. Coverage of required keywords/topics

Assign a score 0-1 based on completeness.

Respond in JSON:
{
  "score": <number 0-1>,
  "taskCountMatch": <boolean>,
  "hasRequiredFields": <boolean>,
  "explanation": "<brief reasoning>"
}`;
    },
  })
  .generateScore(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 1;
    }
    return r.score;
  })
  .generateReason(({ results }) => {
    const r = results.analyzeStepResult;
    if (!r) {
      return 'No analysis result';
    }
    return r.explanation;
  });

export const architectPromptAlignmentScorer = enableJsonPromptInjection(
  createPromptAlignmentScorerLLM({
    model: judgeModel,
    options: {
      evaluationMode: 'both',
    },
  })
);

export const architectKeywordCoverageScorer = createScorer({
  id: 'architect-keyword-coverage',
  description: 'Checks coverage of required keywords from ground truth in architect output',
  type: 'agent',
})
  .generateScore(({ run }) => {
    const response = getResponse(run.output);
    const groundTruth = getGroundTruthForRun(run);

    if (!response || !groundTruth || groundTruth.requiredKeywords.length === 0) {
      return 1;
    }

    const outputText = JSON.stringify(response.tasks).toLowerCase();
    const requiredKeywords = groundTruth.requiredKeywords;

    let coveredCount = 0;
    for (const keyword of requiredKeywords) {
      // Check if keyword (or its substring) appears in output
      if (outputText.includes(keyword.toLowerCase())) {
        coveredCount++;
      }
    }

    return requiredKeywords.length > 0 ? coveredCount / requiredKeywords.length : 1;
  })
  .generateReason(({ run }) => {
    const groundTruth = getGroundTruthForRun(run);

    if (!groundTruth || groundTruth.requiredKeywords.length === 0) {
      return 'No required keywords to check';
    }

    const response = getResponse(run.output);
    const outputText = JSON.stringify(response?.tasks).toLowerCase();
    const requiredKeywords = groundTruth.requiredKeywords;

    const covered: string[] = [];
    const missing: string[] = [];

    for (const keyword of requiredKeywords) {
      if (outputText.includes(keyword.toLowerCase())) {
        covered.push(keyword);
      } else {
        missing.push(keyword);
      }
    }

    return `Covered ${covered.length}/${requiredKeywords.length} keywords. Missing: ${missing.join(', ') || 'none'}`;
  });

export const architectToxicityScorer = enableJsonPromptInjection(
  createToxicityScorer({
    model: judgeModel,
    options: {},
  })
);

// --- Registries ---

export const architectScorerRegistry = {
  'architect-task-validity': architectTaskValidityScorer,
  'architect-clarification-quality': architectClarificationQualityScorer,
  'architect-response-language': architectResponseLanguageScorer,
  'architect-task-count': architectTaskCountScorer,
  'architect-faithfulness': architectFaithfulnessScorer,
  'architect-completeness': architectCompletenessScorer,
  'architect-prompt-alignment': architectPromptAlignmentScorer,
  'architect-keyword-coverage': architectKeywordCoverageScorer,
  'architect-toxicity': architectToxicityScorer,
};

export const architectLiveScorers = {
  'architect-task-validity': {
    scorer: architectTaskValidityScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'architect-clarification-quality': {
    scorer: architectClarificationQualityScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'architect-response-language': {
    scorer: architectResponseLanguageScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'architect-task-count': {
    scorer: architectTaskCountScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'architect-faithfulness': {
    scorer: architectFaithfulnessScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'architect-completeness': {
    scorer: architectCompletenessScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'architect-prompt-alignment': {
    scorer: architectPromptAlignmentScorer,
    sampling: { type: 'ratio', rate: 0.5 },
  },
  'architect-keyword-coverage': {
    scorer: architectKeywordCoverageScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'architect-toxicity': {
    scorer: architectToxicityScorer,
    sampling: { type: 'ratio', rate: 0.3 },
  },
} satisfies MastraScorers;

export const architectScorers = architectLiveScorers;
