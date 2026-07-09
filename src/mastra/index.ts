import { Mastra } from '@mastra/core';
import {
  architectScorerRegistry,
  developerScorerRegistry,
  reviewerScorerRegistry,
  stepScorerRegistry,
  trajectoryScorerRegistry,
} from '#evals/scorers/index';
import { architectAgent } from './agents/architect-agent';
import { developerAgent } from './agents/developer-agent';
import { reviewerAgent } from './agents/reviewer-agent';
import { storage } from './storage';
import { architectWorkflow } from './workflows/architect-workflow';
import { developerWorkflow } from './workflows/developer-workflow';
import { reviewerWorkflow } from './workflows/reviewer-workflow';

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
