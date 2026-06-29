import { type MastraScorers } from '@mastra/core/evals';
import {
  createTrajectoryAccuracyScorerCode,
  createTrajectoryScorerCode,
} from '@mastra/evals/scorers/prebuilt';

export const developerToolTrajectoryScorer = createTrajectoryAccuracyScorerCode({
  // Core required steps: read before write, then write. Exploration tools
  // (listDir, globSearch) are free — they don't affect the score.
  // test is a separate workflow step, not the agent's responsibility.
  expectedTrajectory: [
    { stepType: 'tool_call', name: 'readFile' },
    { stepType: 'tool_call', name: 'writeFile' },
  ],
  comparisonOptions: { ordering: 'relaxed' },
});

export const developerToolBlacklistScorer = createTrajectoryScorerCode({
  defaults: {
    blacklistedTools: ['file-delete'],
    maxSteps: 20,
    noRedundantCalls: true,
    maxRetriesPerTool: 3,
  },
});

export const trajectoryScorerRegistry = {
  'developer-tool-trajectory': developerToolTrajectoryScorer,
  'developer-tool-blacklist': developerToolBlacklistScorer,
};

export const trajectoryLiveScorers = {
  'developer-tool-trajectory': {
    scorer: developerToolTrajectoryScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
  'developer-tool-blacklist': {
    scorer: developerToolBlacklistScorer,
    sampling: { type: 'ratio', rate: 1 },
  },
} satisfies MastraScorers;

export const trajectoryScorers = trajectoryLiveScorers;
