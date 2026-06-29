import { Mastra } from '@mastra/core';
import { architectAgent } from './agents/architect.agent.js';
import { developerAgent } from './agents/developer.agent.js';
import { reviewerAgent } from './agents/reviewer.agent.js';
import {
  architectScorerRegistry,
  developerScorerRegistry,
  reviewerScorerRegistry,
  stepScorerRegistry,
  trajectoryScorerRegistry,
} from './evals/scorers/index.js';
import { storage } from './storage.js';
import { architectWorkflow } from './workflows/architect.workflow.js';
import { developerWorkflow } from './workflows/developer.workflow.js';
import { reviewerWorkflow } from './workflows/reviewer.workflow.js';

export const mastra = new Mastra({
  storage,
  agents: {
    architect: architectAgent,
    developer: developerAgent,
    reviewer: reviewerAgent,
  },
  workflows: {
    'architect-workflow': architectWorkflow,
    'developer-workflow': developerWorkflow,
    'reviewer-workflow': reviewerWorkflow,
  },
  scorers: {
    ...architectScorerRegistry,
    ...reviewerScorerRegistry,
    ...developerScorerRegistry,
    ...stepScorerRegistry,
    ...trajectoryScorerRegistry,
  },
});
