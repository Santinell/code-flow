/**
 * Tracks token usage across eval items so each agent run can report
 * min/max/avg consumption alongside its scores.
 *
 * Tokens are collected **per LLM step** (from `targetResult.steps[].usage`),
 * not as the aggregate over an item. This keeps the numbers comparable to the
 * per-step `modelSettings.maxOutputTokens` budget: an agent that runs N tool
 * steps produces N samples, each bounded by `maxOutputTokens`, rather than one
 * summed sample that can't be checked against the limit.
 *
 * Falls back to `totalUsage` / `usage` when `steps` is unavailable (e.g. a
 * single-step `generate()` with no recorded steps).
 */

export type TokenUsageStats = {
  min: number;
  max: number;
  avg: number;
};

export type TokenUsageSummary = {
  input: TokenUsageStats;
  output: TokenUsageStats;
  total: TokenUsageStats;
  /** Number of per-step samples collected. */
  steps: number;
};

type UsageShape = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type StepShape = {
  usage?: UsageShape;
};

type TargetResultShape = {
  usage?: UsageShape;
  totalUsage?: UsageShape;
  steps?: StepShape[];
};

export type TokenUsageTracker = {
  record: (result: TargetResultShape) => void;
  getStats: () => TokenUsageSummary | undefined;
};

function totalOf(usage: UsageShape): number {
  return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

function statsFor(values: number[]): TokenUsageStats | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Math.round(sum / values.length),
  };
}

export function createTokenUsageTracker(): TokenUsageTracker {
  const input: number[] = [];
  const output: number[] = [];
  const total: number[] = [];

  function recordUsage(usage: UsageShape): void {
    input.push(usage.inputTokens ?? 0);
    output.push(usage.outputTokens ?? 0);
    total.push(totalOf(usage));
  }

  return {
    record(result) {
      // Per-step samples — the primary path for multi-step agents.
      if (result.steps && result.steps.length > 0) {
        for (const step of result.steps) {
          if (step.usage) {
            recordUsage(step.usage);
          }
        }
        return;
      }
      // Fallback when steps aren't recorded (e.g. single generate()).
      const fallback = result.totalUsage ?? result.usage;
      if (fallback) {
        recordUsage(fallback);
      }
    },
    getStats() {
      const totalStats = statsFor(total);
      if (!totalStats) {
        return undefined;
      }
      return {
        input: statsFor(input) ?? { min: 0, max: 0, avg: 0 },
        output: statsFor(output) ?? { min: 0, max: 0, avg: 0 },
        total: totalStats,
        steps: total.length,
      };
    },
  };
}
