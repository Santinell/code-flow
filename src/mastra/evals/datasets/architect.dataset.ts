import type { ArchitectRequirementFixture } from '../fixtures/requirements.js';
import { architectPythonRequirements, architectNodejsRequirements } from '../fixtures/requirements.js';

export type ArchitectDatasetItem = {
  id: string;
  input: string;
  groundTruth: {
    needsClarification: boolean;
    minTasks: number;
    maxTasks?: number;
    requiredKeywords: string[];
    forbiddenKeywords?: string[];
  };
};

function buildArchitectPrompt(fixture: ArchitectRequirementFixture): string {
  const msg = fixture.userMessage.trim();
  return msg || '(empty input)';
}

function toDatasetItem(fixture: ArchitectRequirementFixture): ArchitectDatasetItem {
  return {
    id: fixture.id,
    input: buildArchitectPrompt(fixture),
    groundTruth: { ...fixture.groundTruth },
  };
}

export const architectNodejsDataset: ArchitectDatasetItem[] = architectNodejsRequirements.map(toDatasetItem);

export const architectPythonDataset: ArchitectDatasetItem[] =
  architectPythonRequirements.map(toDatasetItem);
