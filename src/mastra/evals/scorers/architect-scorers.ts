import type { ArchitectDatasetItem } from '../datasets/architect.dataset.js';
import {
  createScorer,
  ScorerRunInputForAgent,
  ScorerRunOutputForAgent,
  type MastraScorers,
} from '@mastra/core/evals';
import { createToxicityScorer } from '@mastra/evals/scorers/prebuilt';
import { getUserMessageFromRunInput, roundToTwoDecimals } from '@mastra/evals/scorers/utils';
import { z } from 'zod';
import { ArchitectGenerateOutput } from '../../workflows/architect.workflow.types.js';
import {
  enableJsonPromptInjection,
  getToolResultContexts,
  judgeConfig,
  judgeModel,
} from './shared.js';

// Store ground truth data indexed by input text for scorer access
const groundTruthByInput = new Map<string, ArchitectDatasetItem['groundTruth']>();

export function setGroundTruthData(items: ArchitectDatasetItem[]) {
  groundTruthByInput.clear();
  for (const item of items) {
    groundTruthByInput.set(item.input, item.groundTruth);
  }
}

function getGroundTruthForRun(run: {
  input?: ScorerRunInputForAgent;
}): ArchitectDatasetItem['groundTruth'] | undefined {
  const inputText = getInputText(run.input);
  return groundTruthByInput.get(inputText);
}

function getResponse(output: ScorerRunOutputForAgent): ArchitectGenerateOutput {
  return output.at(-1)?.content.metadata?.structuredOutput as ArchitectGenerateOutput;
}

function getInputText(input: ScorerRunInputForAgent | undefined): string {
  return getUserMessageFromRunInput(input) ?? '';
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

1. If needsClarification is true:
   - tasks must be empty []
   - messageQualityScore (0-1) based on the quality of clarifying questions:
     * 0.85-1.0: 3+ specific, relevant questions that reference actual project files/paths from the codebase
     * 0.65-0.84: 3+ relevant questions about specific technical choices, but no file references
     * 0.40-0.64: 1-2 relevant but generic questions (e.g. "what library to use?")
     * 0.15-0.39: one vague question or question partly irrelevant to the domain
     * 0.00-0.14: no questions or completely irrelevant/noise
   - taskValidityScore: 1.0 when tasks is empty (which is correct for clarification), 0 otherwise

 2. If needsClarification is false:
    - tasks must contain at least 1 task
    - Each task must have:
      * title: clear, actionable, non-empty
      * description: structured with clearly separated logical sections — can use English headings (Summary, Context, Requirements, Acceptance Criteria, Technical Notes) OR their Russian equivalents (Описание, Контекст, Требования, Критерии Приёмки, Технические замечания). The presence of a sectioned structure matters, not the language of headings.
      * priority: integer 0-4
    - messageQualityScore: quality and helpfulness of the architect's summary message
    - taskValidityScore: fraction of tasks that satisfy all structural requirements

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

    if (!isNaturalLanguageText(input)) {
      // Garbage/empty input has no real language to match — don't penalize the reply's language.
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

/**
 * Heuristic: does this input look like real natural-language text, as opposed to
 * garbage/keyboard-mash or empty input? Requires multiple words (whitespace-separated
 * tokens) so a single random string of Latin letters (e.g. "asdfghjkl") isn't mistaken
 * for "a request written in English".
 */
function isNaturalLanguageText(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 3) {
    return false;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

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

const ARCHITECT_FAITHFULNESS_INSTRUCTIONS = `You are a precise faithfulness evaluator for an architect agent that explores a codebase (via readFile/listDir/globSearch) and decomposes user requirements into tasks.

Key Principles:
1. Extract all claims from the architect's output (task titles, descriptions, features mentioned)
2. Verify each claim against BOTH the user requirement AND the codebase context the architect explored (provided together in context)
3. Consider a claim truthful if it is explicitly mentioned or logically implied by the user requirement, OR grounded in the actual code/files the architect read
4. Consider a claim contradictory if it conflicts with the user requirement or misrepresents the actual contents of the explored files
5. Consider a claim unsure if it adds features/details not mentioned in the requirement and not supported by the explored codebase
6. Focus on factual consistency with the requirement and the explored codebase, not task quality
7. Reasonable technical elaboration is acceptable (e.g., adding standard implementation details, or referencing specific files/functions/exports the architect actually read)
8. Never use prior knowledge - only judge based on what's in the user requirement or the explored codebase context

**What is NOT a hallucination for architect:**
- Adding standard technical implementation details (e.g., "create API endpoint" when user says "add feature")
- Breaking down a feature into logical sub-components
- Mentioning common best practices related to the requirement
- Adding standard fields to tasks (priority, acceptance criteria structure)
- Referencing specific files, functions, types, or exports that appear in the explored codebase context, even if not mentioned in the user's original message

**What IS a hallucination:**
- Inventing features not mentioned or implied by the user, and not grounded in the explored codebase
- Adding requirements the user didn't ask for
- Changing the scope significantly
- Making up specific technical choices not mentioned and not present in the explored codebase (e.g., specific libraries when none were seen)
- Misdescribing the actual contents of a file the architect read`;

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
        const toolContexts = getToolResultContexts(run.output);
        // Context is the user requirement plus whatever the architect read from the codebase
        const context = [
          'User Requirement:',
          input,
          '',
          ...(toolContexts.length > 0
            ? [
                'Codebase context explored by the architect (via readFile/listDir/globSearch):',
                ...toolContexts,
                '',
              ]
            : []),
          'Note: The architect should decompose this requirement into actionable tasks. Reasonable technical elaboration and details grounded in the explored codebase are acceptable.',
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
  description:
    'Evaluates whether the architect output is complete according to ground truth expectations',
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
      const { inputText, response, groundTruth, actualTasks, needsClarification } =
        results.preprocessStepResult ?? {};

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

// --- Prompt Alignment Scorer (custom, handles structured output) ---
//
// createPromptAlignmentScorerLLM from @mastra/evals uses
// getAssistantMessageFromRunOutput() which extracts text from raw assistant
// messages. Architect responds via structuredOutput — the text part of the
// assistant message is empty, so the built-in scorer throws:
// "Agent response is required for prompt alignment scoring".
//
// This custom scorer extracts the response from output's structuredOutput
// metadata instead, using the same getResponse() helper as other scorers.

const ARCHITECT_PROMPT_ALIGNMENT_INSTRUCTIONS = `You are an expert prompt-response alignment evaluator. Your job is to analyze how well an architect agent's response aligns with the user's prompt in terms of intent, requirements, completeness, and appropriateness.

Key Evaluation Dimensions:
1. **Intent Alignment**: Does the response address the core purpose of the prompt?
2. **Requirements Fulfillment**: Are all explicit and implicit requirements met?
3. **Completeness**: Is the response comprehensive and thorough?
4. **Response Appropriateness**: Does the format, tone, and style match expectations?

Evaluation Guidelines:
- Identify the primary intent and any secondary intents in the prompt
- Extract all explicit requirements (specific tasks, constraints, formats)
- Consider implicit requirements based on context and standard expectations
- Assess whether the response fully addresses the prompt or leaves gaps
- Evaluate if the response format and tone are appropriate for the request
- Be objective and focus on alignment rather than response quality

Score each dimension from 0.0 (completely misaligned) to 1.0 (perfectly aligned).`;

function createArchitectAlignmentAnalyzePrompt({
  userPrompt,
  agentResponse,
  needsClarification,
}: {
  userPrompt: string;
  agentResponse: string;
  needsClarification: boolean;
}): string {
  if (needsClarification) {
    return `Analyze how well the architect agent's response aligns with the user's prompt. The architect determined that the prompt needs clarification before producing tasks — this response intentionally contains no tasks, only clarifying questions.

User Prompt:
${userPrompt}

Agent Response:
${agentResponse}

Since this is a clarification response, evaluate:

1. **Intent Alignment** (score 0-1):
   - Did the architect correctly identify that the prompt is vague/ambiguous?
   - Is requesting clarification the correct approach, or was the prompt clear enough for direct decomposition?
   - Score 1.0 if clarification is clearly the right call, 0.0 if the prompt was detailed enough for tasks.
   - Provide clear reasoning.

2. **Requirements Fulfillment** (score 0-1):
   - Do the clarifying questions address the specific gaps in the prompt?
   - Are questions targeted, specific, and actionable?
   - Do they reference relevant project/tech context (files, libraries, patterns)?
   - Score 1.0 if questions cover all key ambiguities, 0.0 if they miss obvious gaps.
   - List each question as a "requirement" and mark it as fulfilled if it's a well-formed clarifying question.

3. **Completeness** (score 0-1):
   - Does the set of questions comprehensively cover what's missing from the prompt?
   - Are there 2-5 distinct, well-formed questions?
   - Score 1.0 for comprehensive coverage, 0.0 for very few or shallow questions.

4. **Response Appropriateness** (score 0-1):
   - Is the tone helpful, professional, and collaborative?
   - Is the format clear (numbered questions, logical ordering)?
   - Score 1.0 for well-structured, respectful clarification, 0.0 for abrupt or confusing format.

Format your response as:
{
  "intentAlignment": { "score": 0-1, "primaryIntent": "main purpose of prompt", "isAddressed": true/false, "reasoning": "..." },
  "requirementsFulfillment": { "requirements": [{"requirement": "...", "isFulfilled": true/false, "reasoning": "..."}], "overallScore": 0-1 },
  "completeness": { "score": 0-1, "missingElements": [...], "reasoning": "..." },
  "responseAppropriateness": { "score": 0-1, "formatAlignment": true/false, "toneAlignment": true/false, "reasoning": "..." },
  "overallAssessment": "summary of the prompt-response alignment"
}`;
  }

  return `Analyze how well the architect agent's task decomposition aligns with the user's prompt across multiple dimensions.

User Prompt:
${userPrompt}

Agent Response:
${agentResponse}

The architect produced task decomposition — evaluate:

1. **Intent Alignment**:
   - Identify the primary intent of the user's prompt
   - Assess whether the task decomposition addresses this intent
   - Score from 0.0 (completely misses intent) to 1.0 (perfectly addresses intent)
   - Provide reasoning for your assessment

2. **Requirements Fulfillment**:
   - List all explicit requirements from the user prompt
   - Check if each requirement is covered by at least one task
   - Calculate an overall score based on fulfilled vs. total requirements
   - Provide reasoning for each requirement assessment

3. **Completeness**:
   - Evaluate if the task set is comprehensive for the user's request
   - Identify any missing tasks that should have been included
   - Score from 0.0 (severely incomplete) to 1.0 (fully complete)
   - Provide reasoning for your assessment

4. **Response Appropriateness**:
   - Check if tasks have proper structure (title, description with sections, priority)
   - Evaluate if the tone is professional and technical
   - Score from 0.0 (completely inappropriate) to 1.0 (perfectly appropriate)
   - Provide reasoning for your assessment

Format your response as:
{
  "intentAlignment": { "score": 0.0-1.0, "primaryIntent": "the main purpose of the prompt", "isAddressed": true/false, "reasoning": "explanation" },
  "requirementsFulfillment": { "requirements": [{"requirement": "specific requirement from prompt", "isFulfilled": true/false, "reasoning": "explanation"}], "overallScore": 0.0-1.0 },
  "completeness": { "score": 0.0-1.0, "missingElements": ["list of missing elements if any"], "reasoning": "explanation" },
  "responseAppropriateness": { "score": 0.0-1.0, "formatAlignment": true/false, "toneAlignment": true/false, "reasoning": "explanation" },
  "overallAssessment": "summary of the prompt-response alignment"
}`;
}

const architectAlignmentAnalyzeSchema = z.object({
  intentAlignment: z.object({
    score: z.number().min(0).max(1),
    primaryIntent: z.string(),
    isAddressed: z.boolean().optional().default(true),
    reasoning: z.string(),
  }),
  requirementsFulfillment: z.object({
    requirements: z.array(
      z.object({
        requirement: z.string(),
        isFulfilled: z.boolean(),
        reasoning: z.string(),
      })
    ),
    overallScore: z.number().min(0).max(1),
  }),
  completeness: z.object({
    score: z.number().min(0).max(1),
    missingElements: z.array(z.string()),
    reasoning: z.string(),
  }),
  responseAppropriateness: z.object({
    score: z.number().min(0).max(1),
    formatAlignment: z.boolean(),
    toneAlignment: z.boolean(),
    reasoning: z.string(),
  }),
  overallAssessment: z.string(),
});

// User prompt alignment weights (same as built-in createPromptAlignmentScorerLLM USER mode)
const USER_ALIGNMENT_WEIGHTS = {
  INTENT_ALIGNMENT: 0.4,
  REQUIREMENTS_FULFILLMENT: 0.3,
  COMPLETENESS: 0.2,
  RESPONSE_APPROPRIATENESS: 0.1,
};

export const architectPromptAlignmentScorer = createScorer({
  id: 'architect-prompt-alignment',
  name: 'Architect Prompt Alignment',
  description:
    'Evaluates how well the architect output aligns with the intent and requirements of the user prompt',
  type: 'agent',
  judge: {
    model: judgeModel,
    instructions: ARCHITECT_PROMPT_ALIGNMENT_INSTRUCTIONS,
    jsonPromptInjection: true,
  },
})
  .preprocess(({ run }) => {
    const userPrompt = getInputText(run.input);
    const response = getResponse(run.output);
    const agentResponse = response
      ? JSON.stringify(
          {
            message: response.message,
            needsClarification: response.needsClarification,
            tasks: response.tasks,
          },
          null,
          2
        )
      : '(no structured output)';

    return {
      userPrompt: userPrompt.slice(0, 3000),
      agentResponse,
      needsClarification: response?.needsClarification ?? false,
    };
  })
  .analyze({
    description: 'Analyze prompt-response alignment across multiple dimensions',
    outputSchema: architectAlignmentAnalyzeSchema,
    createPrompt: ({ results }) => {
      const { userPrompt, agentResponse, needsClarification } = results.preprocessStepResult ?? {};
      return createArchitectAlignmentAnalyzePrompt({
        userPrompt: userPrompt ?? '',
        agentResponse: agentResponse ?? '',
        needsClarification: needsClarification ?? false,
      });
    },
  })
  .generateScore(({ results }) => {
    const analysis = results.analyzeStepResult;
    if (!analysis) {
      return 0;
    }

    const weightedScore =
      analysis.intentAlignment.score * USER_ALIGNMENT_WEIGHTS.INTENT_ALIGNMENT +
      analysis.requirementsFulfillment.overallScore *
        USER_ALIGNMENT_WEIGHTS.REQUIREMENTS_FULFILLMENT +
      analysis.completeness.score * USER_ALIGNMENT_WEIGHTS.COMPLETENESS +
      analysis.responseAppropriateness.score * USER_ALIGNMENT_WEIGHTS.RESPONSE_APPROPRIATENESS;

    return roundToTwoDecimals(weightedScore);
  })
  .generateReason({
    description: 'Generate human-readable explanation of prompt alignment evaluation',
    createPrompt: ({ run, results, score }) => {
      const userPrompt = getInputText(run.input);
      const analysis = results.analyzeStepResult;

      if (!analysis) {
        return `Unable to analyze prompt alignment. Score: ${score}`;
      }

      const fulfilledCount = analysis.requirementsFulfillment.requirements.filter(
        (r) => r.isFulfilled
      ).length;
      const totalRequirements = analysis.requirementsFulfillment.requirements.length;

      return `Explain the prompt alignment score based on how well the architect's task decomposition addresses the user's prompt.

User Prompt:
${userPrompt.slice(0, 2000)}

Score: ${score} out of 1.0

Evaluation Breakdown:
- Intent Alignment (40% weight): ${analysis.intentAlignment.score}
  Primary Intent: "${analysis.intentAlignment.primaryIntent}"
  Addressed: ${analysis.intentAlignment.isAddressed ? 'Yes' : 'No'}
  ${analysis.intentAlignment.reasoning}

- Requirements Fulfillment (30% weight): ${analysis.requirementsFulfillment.overallScore}
  ${fulfilledCount} out of ${totalRequirements} requirements met
  ${analysis.requirementsFulfillment.requirements.map((r) => `  ${String.fromCharCode(8226)} ${r.requirement}: ${r.isFulfilled ? String.fromCharCode(10003) : String.fromCharCode(10007)}`).join('\n')}

- Completeness (20% weight): ${analysis.completeness.score}
  ${analysis.completeness.missingElements.length > 0 ? `Missing elements: ${analysis.completeness.missingElements.join(', ')}` : 'Response is complete'}
  ${analysis.completeness.reasoning}

- Response Appropriateness (10% weight): ${analysis.responseAppropriateness.score}
  Format: ${analysis.responseAppropriateness.formatAlignment ? 'Aligned' : 'Misaligned'}
  Tone: ${analysis.responseAppropriateness.toneAlignment ? 'Aligned' : 'Misaligned'}
  ${analysis.responseAppropriateness.reasoning}

Overall Assessment: ${analysis.overallAssessment}

Rules for explanation:
- Summarize the key strengths and weaknesses of alignment
- Focus on how well the task decomposition meets the user's requirements
- Be concise but specific (2-4 sentences)
- Explain why the score is what it is
- Use the given score, don't recalculate

Format:
"Explain the score (number) based on key findings."`;
    },
  });

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

    // Search both tasks AND message (covers clarification responses where tasks is empty)
    const outputText = (
      JSON.stringify(response.tasks) + ' ' + (response.message ?? '')
    ).toLowerCase();
    const requiredKeywords = groundTruth.requiredKeywords;

    let coveredCount = 0;
    for (const keyword of requiredKeywords) {
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
    const outputText = (
      JSON.stringify(response?.tasks) + ' ' + (response?.message ?? '')
    ).toLowerCase();
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
