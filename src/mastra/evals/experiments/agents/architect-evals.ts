import { runEvals } from '@mastra/core/evals';
import { getEnv } from '../../../../config/env.js';
import { architectAgent } from '../../../agents/architect.agent.js';
import { architectGenerateOutputSchema } from '../../../workflows/architect.workflow.types.js';
import { architectDataset } from '../../datasets/architect.dataset.js';
import { architectScorers, setGroundTruthData } from '../../scorers/index.js';

export const env = getEnv();

export type ScoreValue = string | number | boolean | null | undefined;
export type ScoreResult = {
  score?: ScoreValue;
  result?: ScoreValue;
  value?: ScoreValue;
};
export type ScoreResultGroup = Record<string, ScoreResult>;
export type ScorerResultsForLog = ScoreResultGroup & {
  agent?: ScoreResultGroup;
};

export function formatDuration(startedAt: number): string {
  const elapsedMs = Date.now() - startedAt;
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

export function getScoreValue(result: ScoreResult): string {
  const score = result.score ?? result.result ?? result.value;
  return typeof score === 'number' ? score.toFixed(2) : String(score ?? 'n/a');
}

export function formatScorerResults(scorerResults: ScorerResultsForLog): string {
  const resultGroup = scorerResults.agent ?? scorerResults;
  const summary = Object.entries(resultGroup)
    .map(([name, result]) => `${name}=${getScoreValue(result)}`)
    .join(', ');

  return summary || 'no scorer results';
}

export async function runArchitectAgentEvals() {
  // Initialize ground truth data for scorers
  setGroundTruthData(architectDataset);

  const totalItems = architectDataset.length;
  const scorerNames = Object.keys(architectScorers);
  const concurrency = env.MAX_CONCURRENT_EVAL;
  const itemLabelsByInput = new Map(architectDataset.map((item) => [item.input, item.id]));
  const startedAt = Date.now();
  let completedItems = 0;

  console.log(
    `[architect] Starting evals: ${totalItems} items, ${scorerNames.length} scorers, concurrency=${concurrency}`
  );
  console.log(`[architect] Scorers: ${scorerNames.join(', ')}`);

  const heartbeat = setInterval(() => {
    const runningItems = Math.min(concurrency, totalItems - completedItems);
    const avgItemWallTime =
      completedItems > 0
        ? `${Math.round((Date.now() - startedAt) / completedItems / 1000)}s`
        : 'n/a';
    console.log(
      `[architect] Still running: ${completedItems}/${totalItems} complete, ~${runningItems} in flight, avg wall/item ${avgItemWallTime}, elapsed ${formatDuration(startedAt)}`
    );
  }, 30_000);

  const result = await runEvals({
    target: architectAgent,
    data: architectDataset,
    scorers: {
      agent: Object.values(architectScorers).map((entry) => entry.scorer),
    },
    targetOptions: {
      modelSettings: {
        temperature: 0,
        maxRetries: 3,
      },
      structuredOutput: {
        schema: architectGenerateOutputSchema,
        errorStrategy: 'warn',
      },
    },
    concurrency,
    onItemComplete: async ({ item, targetResult, scorerResults }) => {
      completedItems++;
      const callbackStartedAt = Date.now();
      const inputLabel = typeof item.input === 'string' ? item.input.slice(0, 60) : 'unknown-item';
      const label =
        typeof item.input === 'string'
          ? (itemLabelsByInput.get(item.input) ?? inputLabel)
          : inputLabel;
      const parsedOutput = architectGenerateOutputSchema.safeParse(targetResult.object);
      const outputSummary = parsedOutput.success
        ? `needsClarification=${parsedOutput.data.needsClarification}, tasks=${parsedOutput.data.tasks.length}, message="${parsedOutput.data.message.replace(/\s+/g, ' ').slice(0, 100)}"`
        : `text="${targetResult.text.replace(/\s+/g, ' ').slice(0, 100)}"`;

      console.log(
        `\n[architect] Completed ${completedItems}/${totalItems}: ${label} (${formatDuration(startedAt)} elapsed)`
      );
      console.log(`[architect:${label}] output: ${outputSummary}`);
      console.log(`[architect:${label}] scores: ${formatScorerResults(scorerResults)}`);
      console.log(`[architect:${label}] callback logged in ${Date.now() - callbackStartedAt}ms`);
    },
  }).finally(() => {
    clearInterval(heartbeat);
  });

  console.log('\nArchitect average scores:');
  console.log(JSON.stringify(result.scores, null, 2));
  console.log(
    `Processed ${result.summary.totalItems} architect eval items in ${formatDuration(startedAt)}`
  );

  return result;
}
