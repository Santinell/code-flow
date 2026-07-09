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

// Python-аналог developer-nodejs.dataset.ts. Те же сценарии (subtract/multiply/
// README badge/multiply default/non-negative assert/format pipeline), но в
// конвенциях Python: src/utils/math.py, tests/utils/test_math.py, pyproject.toml,
// snake_case, type hints, pytest.
export const developerPythonDataset: DeveloperDatasetItem[] = [
  {
    id: 'add-math-subtract',
    input: createDeveloperPrompt({
      taskId: 'mock-task-001',
      taskIdentifier: 'PY-201',
      taskTitle: 'Add subtract function to math utils',
      taskDescription: `Add a new function \`subtract(a: int, b: int) -> int\` to \`src/utils/math.py\`.
The function should return a - b.
Define it alongside the existing functions.`,
      branchName: 'PY-201/math-subtract',
    }),
    groundTruth: {
      taskId: 'mock-task-001',
      taskIdentifier: 'PY-201',
      taskTitle: 'Add subtract function to math utils',
      branchName: 'PY-201/math-subtract',
      expectedChanges: ['src/utils/math.py'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['src/utils/math.py', 'tests/utils/test_math.py', 'pyproject.toml'],
    },
  },
  {
    id: 'add-multiply-helper',
    input: createDeveloperPrompt({
      taskId: 'mock-task-002',
      taskIdentifier: 'PY-202',
      taskTitle: 'Add multiply helper to math utils',
      taskDescription: `Add a new helper function \`multiply(a: int, b: int) -> int\` in \`src/utils/math.py\`.
It should simply return a * b. Add it next to the existing functions.`,
      branchName: 'PY-202/math-multiply',
    }),
    groundTruth: {
      taskId: 'mock-task-002',
      taskIdentifier: 'PY-202',
      taskTitle: 'Add multiply helper to math utils',
      branchName: 'PY-202/math-multiply',
      expectedChanges: ['src/utils/math.py'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['src/utils/math.py'],
    },
  },
  {
    id: 'readme-badge-section',
    input: createDeveloperPrompt({
      taskId: 'mock-task-003',
      taskIdentifier: 'PY-203',
      taskTitle: 'Add status badge section to README',
      taskDescription: `Add a "## Status Badges" section at the end of the README.md with the following lines:

\`\`\`
## Status Badges

![CI](https://github.com/example/repo/actions/workflows/ci.yml/badge.svg)
\`\`\`

Do not modify any other files.`,
      branchName: 'PY-203/readme-badges',
    }),
    groundTruth: {
      taskId: 'mock-task-003',
      taskIdentifier: 'PY-203',
      taskTitle: 'Add status badge section to README',
      branchName: 'PY-203/readme-badges',
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
      taskIdentifier: 'PY-204',
      taskTitle: 'Add default value to multiply',
      taskDescription: `Update the \`multiply\` function in \`src/utils/math.py\` so that the second parameter defaults to 1:
\`def multiply(a: int, b: int = 1) -> int:\`
If \`multiply\` does not exist yet, create it with this signature.`,
      branchName: 'PY-204/multiply-default',
    }),
    groundTruth: {
      taskId: 'mock-task-004',
      taskIdentifier: 'PY-204',
      taskTitle: 'Add default value to multiply',
      branchName: 'PY-204/multiply-default',
      expectedChanges: ['src/utils/math.py'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['src/utils/math.py'],
    },
  },
  {
    id: 'add-non-negative-validation',
    input: createDeveloperPrompt({
      taskId: 'mock-task-005',
      taskIdentifier: 'PY-205',
      taskTitle: 'Add assert_non_negative utility',
      taskDescription: `Add a new function in \`src/utils/math.py\`:

\`\`\`
def assert_non_negative(value: int, name: str) -> None:
    if value < 0:
        raise ValueError(f"{name} must not be negative, got {value}")
\`\`\`

Define it at the module level.`,
      branchName: 'PY-205/non-negative-check',
    }),
    groundTruth: {
      taskId: 'mock-task-005',
      taskIdentifier: 'PY-205',
      taskTitle: 'Add assert_non_negative utility',
      branchName: 'PY-205/non-negative-check',
      expectedChanges: ['src/utils/math.py'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['src/utils/math.py', 'tests/utils/test_math.py'],
    },
  },
  {
    id: 'complex-formatting-pipeline',
    input: createDeveloperPrompt({
      taskId: 'mock-task-006',
      taskIdentifier: 'PY-206',
      taskTitle: 'Create string formatting pipeline',
      taskDescription: `Create a new file \`src/utils/format.py\` that defines a function \`format_name(first: str, last: str) -> str\` which:
1. Strips whitespace from both parts
2. Capitalizes the first letter of each part
3. Joins them with a single space
4. Returns the result

Also add tests in \`tests/utils/test_format.py\` using the same test framework the project uses.`,
      branchName: 'PY-206/format-pipeline',
    }),
    groundTruth: {
      taskId: 'mock-task-006',
      taskIdentifier: 'PY-206',
      taskTitle: 'Create string formatting pipeline',
      branchName: 'PY-206/format-pipeline',
      expectedChanges: ['src/utils/format.py', 'tests/utils/test_format.py'],
      mustRunTests: true,
      mustNotCallGit: true,
      expectedFilesToRead: ['pyproject.toml', 'src/utils/math.py', 'tests/utils/test_math.py'],
    },
  },
];
