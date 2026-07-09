import { createScorer, type MastraScorers } from '@mastra/core/evals';
import { createTrajectoryScorerCode } from '@mastra/evals/scorers/prebuilt';

// Tools that count as "modifying" the codebase — the agent must read before
// calling any of these. editFile was added by the workspace migration and is
// preferred over writeFile for surgical changes (as stated in the prompt).
const MODIFY_TOOLS = new Set(['writeFile', 'editFile', 'file-write']);

export const developerToolTrajectoryScorer = createScorer({
  id: 'code-trajectory-accuracy-scorer',
  name: 'Trajectory Accuracy Scorer',
  description: 'Verifies the agent reads files before modifying them (via writeFile or editFile)',
  type: 'trajectory',
})
  .preprocess(({ run }) => {
    const actualTrajectory = run.output;
    const steps = (actualTrajectory as { steps?: Array<{ name: string }> })?.steps ?? [];
    const stepNames = steps.map((s) => s.name);

    const firstReadIdx = stepNames.indexOf('readFile');
    const firstModifyIdx = stepNames.findIndex((n) => MODIFY_TOOLS.has(n));

    const hasRead = firstReadIdx !== -1;
    const hasModify = firstModifyIdx !== -1;
    const readBeforeModify = hasRead && hasModify && firstReadIdx < firstModifyIdx;

    return {
      actualTrajectory,
      actualStepNames: stepNames,
      hasRead,
      hasModify,
      readBeforeModify,
      firstReadIdx,
      firstModifyIdx,
    };
  })
  .generateScore(({ results }) => {
    const p = results.preprocessStepResult as
      | {
          hasRead?: boolean;
          readBeforeModify?: boolean;
        }
      | undefined;
    if (!p) {
      return 0;
    }

    let score = 0;
    if (p.hasRead) {
      score += 0.5;
    }
    if (p.readBeforeModify) {
      score += 0.5;
    }

    return score;
  })
  .generateReason(({ results, score }) => {
    const p = results.preprocessStepResult as
      | {
          actualStepNames?: string[];
          hasRead?: boolean;
          hasModify?: boolean;
        }
      | undefined;
    const names = p?.actualStepNames ?? [];

    if (score === 1) {
      return `Agent correctly read before modifying. Steps: ${names.join(' → ')}`;
    }
    if (score >= 0.5 && p?.hasRead) {
      return p.hasModify
        ? `Agent modified files but modification step did not follow read. Steps: ${names.join(' → ')}`
        : `Agent read files but did not modify any. Steps: ${names.join(' → ')}`;
    }
    return `Agent did not follow read-before-modify discipline. Steps: ${names.join(' → ')}`;
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
