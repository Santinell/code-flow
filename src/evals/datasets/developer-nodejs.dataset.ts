export type DeveloperDatasetItem = {
  id: string;
  input: string;
  groundTruth: {
    taskId: string;
    taskIdentifier: string;
    taskTitle: string;
    branchName: string;
    expectedChanges: string[];
    mustRunTests: boolean;
    mustNotCallGit: boolean;
    expectedFilesToRead: string[];
  };
};

function createDeveloperPrompt(params: {
  taskId: string;
  taskIdentifier: string;
  taskTitle: string;
  taskDescription: string;
  branchName: string;
}): string {
  return `## Task: ${params.taskIdentifier}: ${params.taskTitle}

### Task ID
${params.taskId}

### Description
${params.taskDescription}

### Branch
\`${params.branchName}\`

Implement the changes described above. Follow the project conventions.
Read relevant files first, then make your changes and report results. Testing is handled by a separate workflow step.`;
}

export const developerDataset: DeveloperDatasetItem[] = [
  {
    id: 'add-math-subtract',
    input: createDeveloperPrompt({
      taskId: 'mock-task-001',
      taskIdentifier: 'ENG-201',
      taskTitle: 'Add subtract function to math utils',
      taskDescription: `Add a new exported function \`subtract(a: number, b: number): number\` to \`src/utils/math.ts\`.
The function should return a - b.
Export it alongside the existing functions.`,
      branchName: 'ENG-201/math-subtract',
    }),
    groundTruth: {
      taskId: 'mock-task-001',
      taskIdentifier: 'ENG-201',
      taskTitle: 'Add subtract function to math utils',
      branchName: 'ENG-201/math-subtract',
      expectedChanges: ['src/utils/math.ts'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['src/utils/math.ts', 'src/utils/math.test.ts', 'package.json'],
    },
  },
  {
    id: 'add-multiply-helper',
    input: createDeveloperPrompt({
      taskId: 'mock-task-002',
      taskIdentifier: 'ENG-202',
      taskTitle: 'Add multiply helper to math utils',
      taskDescription: `Add a new helper function \`multiply(a: number, b: number): number\` in \`src/utils/math.ts\`.
It should simply return a * b. Update the file's exports accordingly.`,
      branchName: 'ENG-202/math-multiply',
    }),
    groundTruth: {
      taskId: 'mock-task-002',
      taskIdentifier: 'ENG-202',
      taskTitle: 'Add multiply helper to math utils',
      branchName: 'ENG-202/math-multiply',
      expectedChanges: ['src/utils/math.ts'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['src/utils/math.ts'],
    },
  },
  {
    id: 'readme-badge-section',
    input: createDeveloperPrompt({
      taskId: 'mock-task-003',
      taskIdentifier: 'ENG-203',
      taskTitle: 'Add status badge section to README',
      taskDescription: `Add a "## Status Badges" section at the end of the README.md with the following lines:

\`\`\`
## Status Badges

![CI](https://github.com/example/repo/actions/workflows/ci.yml/badge.svg)
\`\`\`

Do not modify any other files.`,
      branchName: 'ENG-203/readme-badges',
    }),
    groundTruth: {
      taskId: 'mock-task-003',
      taskIdentifier: 'ENG-203',
      taskTitle: 'Add status badge section to README',
      branchName: 'ENG-203/readme-badges',
      expectedChanges: ['README.md'],
      mustRunTests: false,
      mustNotCallGit: true,
      expectedFilesToRead: ['README.md'],
    },
  },
  {
    id: 'refactor-multiply-default',
    input: createDeveloperPrompt({
      taskId: 'mock-task-004',
      taskIdentifier: 'ENG-204',
      taskTitle: 'Add default value to multiply',
      taskDescription: `Update the \`multiply\` function in \`src/utils/math.ts\` so that the second parameter defaults to 1:
\`multiply(a: number, b: number = 1): number\`
If \`multiply\` does not exist yet, create it with this signature.`,
      branchName: 'ENG-204/multiply-default',
    }),
    groundTruth: {
      taskId: 'mock-task-004',
      taskIdentifier: 'ENG-204',
      taskTitle: 'Add default value to multiply',
      branchName: 'ENG-204/multiply-default',
      expectedChanges: ['src/utils/math.ts'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['src/utils/math.ts'],
    },
  },
  {
    id: 'add-non-negative-validation',
    input: createDeveloperPrompt({
      taskId: 'mock-task-005',
      taskIdentifier: 'ENG-205',
      taskTitle: 'Add assertNonNegative utility',
      taskDescription: `Add a new exported function in \`src/utils/math.ts\`:

\`\`\`
export function assertNonNegative(value: number, name: string): void {
  if (value < 0) {
    throw new Error(\`\${name} must not be negative, got \${value}\`);
  }
}
\`\`\`

Export it at the module level.`,
      branchName: 'ENG-205/non-negative-check',
    }),
    groundTruth: {
      taskId: 'mock-task-005',
      taskIdentifier: 'ENG-205',
      taskTitle: 'Add assertNonNegative utility',
      branchName: 'ENG-205/non-negative-check',
      expectedChanges: ['src/utils/math.ts'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['src/utils/math.ts', 'src/utils/math.test.ts'],
    },
  },
  {
    id: 'complex-formatting-pipeline',
    input: createDeveloperPrompt({
      taskId: 'mock-task-006',
      taskIdentifier: 'ENG-206',
      taskTitle: 'Create string formatting pipeline',
      taskDescription: `Create a new file \`src/utils/format.ts\` that exports a function \`formatName(first: string, last: string): string\` which:
1. Trims both parts
2. Capitalizes the first letter of each part
3. Joins them with a single space
4. Returns the result

Also add tests in \`src/utils/format.test.ts\` using the same test framework the project uses.`,
      branchName: 'ENG-206/format-pipeline',
    }),
    groundTruth: {
      taskId: 'mock-task-006',
      taskIdentifier: 'ENG-206',
      taskTitle: 'Create string formatting pipeline',
      branchName: 'ENG-206/format-pipeline',
      expectedChanges: ['src/utils/format.ts', 'src/utils/format.test.ts'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: [
        'package.json',
        'src/utils/math.ts',
        'src/utils/math.test.ts',
        'tsconfig.json',
      ],
    },
  },
];
