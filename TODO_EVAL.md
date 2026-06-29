# План внедрения системы Eval для agent-dev-system (Mastra)

## Обзор

Проект `agent-dev-system` — автоматизированный конвейер разработки на базе Mastra:

- **Architect Agent** — анализирует требования из Telegram, раскладывает на задачи Linear
- **Developer Agent** — берёт задачу, изучает кодовую базу, пишет код, тестирует, коммитит
- **Reviewer Agent** — ревьюит diff, аппрувит/отклоняет, мёрджит ветку

На данный момент в проекте **ноль eval и ноль тестов**. План покрывает все три слоя Mastra eval:

1. **Live scoring** — скореры, прикреплённые к агентам и шагам (работают в проде асинхронно)
2. **Batch evaluation** — `runEvals()` на датасетах (для CI/CD и экспериментов)
3. **Trajectory evaluation** — валидация последовательности шагов и вызовов инструментов

---

## Этап 0: Подготовка инфраструктуры

### 0.1 Установка зависимостей

**`@mastra/evals` — обязательный пакет** для готовых фабрик скореров. Без него придётся вручную реализовывать judge-промпты для faithfulness/hallucination/completeness, логику сравнения траекторий и утилиты вроде `extractToolResults`. Пакет содержит протестированные, инженерно выверенные реализации.

```bash
pnpm add @mastra/evals@latest
pnpm add -D vitest @vitest/runner
```

**Два источника импортов:**

| Источник                         | Что даёт                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mastra/core/evals`             | Базовая инфраструктура: `createScorer`, `runEvals`, `filterRun`, `MastraScorer`                                                                                                                                                                                                                                                                                                                    |
| `@mastra/evals/scorers/prebuilt` | Готовые фабрики: `createFaithfulnessScorer`, `createHallucinationScorer`, `createCompletenessScorer`, `createToxicityScorer`, `createToolCallAccuracyScorer`, `createPromptAlignmentScorer`, `createAnswerRelevancyScorer`, `createAnswerSimilarityScorer`, `createKeywordCoverageScorer`, `createTrajectoryAccuracyScorerCode`, `createTrajectoryAccuracyScorerLLM`, `createTrajectoryScorerCode` |

```typescript
// Инфраструктура
import { createScorer, runEvals, filterRun } from '@mastra/core/evals';

// Готовые фабрики скореров — из @mastra/evals/scorers/prebuilt
import {
  createFaithfulnessScorer,
  createHallucinationScorer,
  createCompletenessScorer,
  createToxicityScorer,
  createToolCallAccuracyScorerLLM, // LLM-версия
  createToolCallAccuracyScorerCode, // Code-версия (детерминированная)
  createPromptAlignmentScorerLLM, // LLM-версия
  createAnswerRelevancyScorer,
  createAnswerSimilarityScorer,
  createKeywordCoverageScorer, // Code-based, не LLM
  createTrajectoryAccuracyScorerCode,
  createTrajectoryAccuracyScorerLLM,
  createTrajectoryScorerCode,
} from '@mastra/evals/scorers/prebuilt';

// Утилиты — из @mastra/evals/scorers (НЕ prebuilt!)
import { extractToolResults, extractToolCalls, compareTrajectories } from '@mastra/evals/scorers';
```

### 0.2 Структура директорий eval

```
src/
├── mastra/
│   ├── evals/
│   │   ├── scorers/
│   │   │   ├── agent-scorers.ts       # Скореры для агентов
│   │   │   ├── step-scorers.ts        # Скореры для шагов workflow
│   │   │   ├── trajectory-scorers.ts  # Скореры для траекторий
│   │   │   └── shared.ts             # Общие judge-конфиги, хелперы
│   │   ├── datasets/
│   │   │   ├── architect.dataset.ts   # Датасет для аrchitect
│   │   │   ├── developer.dataset.ts   # Датасет для developer
│   │   │   └── reviewer.dataset.ts    # Датасет для reviewer
│   │   ├── experiments/
│   │   │   ├── agent-evals.ts         # runEvals для агентов (в изоляции)
│   │   │   ├── workflow-evals.ts      # runEvals для целых workflow
│   │   │   └── step-evals.ts          # runEvals для отдельных шагов
│   │   ├── fixtures/                  # Моки/фикстуры для тестов
│   │   │   ├── code-diffs.ts          # Примеры диффов для reviewer
│   │   │   ├── requirements.ts        # Примеры требований для architect
│   │   │   └── tasks.ts               # Примеры задач для developer
│   │   └── run.ts                     # Единая точка запуска всех eval
│   └── index.ts                       # Mastra instance (+ scorers registration)
```

### 0.3 Регистрация скореров в Mastra

В `src/mastra/index.ts` добавить:

```typescript
import { architectScorers } from './evals/scorers/agent-scorers.js'
// ... etc

export const mastra = new Mastra({
  storage,
  agents: { architect: architectAgent, ... },
  workflows: { ... },
  scorers: {
    ...architectScorers,
    ...developerScorers,
    ...reviewerScorers,
    ...trajectoryScorers,
  },
})
```

### 0.4 Добавление скриптов в package.json

```json
{
  "eval:all": "tsx src/mastra/evals/run.ts",
  "eval:architect": "tsx src/mastra/evals/experiments/agent-evals.ts --agent=architect",
  "eval:developer": "tsx src/mastra/evals/experiments/agent-evals.ts --agent=developer",
  "eval:reviewer": "tsx src/mastra/evals/experiments/agent-evals.ts --agent=reviewer",
  "eval:workflows": "tsx src/mastra/evals/experiments/workflow-evals.ts",
  "eval:ci": "tsx src/mastra/evals/experiments/agent-evals.ts --ci"
}
```

---

## Этап 1: Скореры для агентов (Agent-level scorers)

Назначение: оценка качества ответов агентов в изоляции (без шагов workflow).

### 1.1 Architect Agent

| ID                                | Тип                                       | Метод                                                                                                                     | Назначение                        |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `architect-task-validity`         | Custom (LLM judge)                        | `createScorer` + judge — проверяет, что ответ содержит валидные задачи с title/description/priority и acceptance criteria | Проверка структурной корректности |
| `architect-clarification-quality` | Custom (LLM judge)                        | `createScorer` + judge — оценивает качество уточняющих вопросов: конкретность, релевантность, отсутствие избыточности     | Проверка HITL-ветки               |
| `architect-response-language`     | Custom (function)                         | Проверяет, что ответ на том же языке, что и запрос                                                                        | Соответствие языку                |
| `architect-task-count`            | Custom (function)                         | Проверяет, что кол-во задач в разумных пределах (1-10)                                                                    | Разумность декомпозиции           |
| `architect-faithfulness`          | Built-in `createFaithfulnessScorer`       | Проверяет, что задачи не содержат выдуманных деталей — все пункты следуют из входных требований                           | Фактическая точность              |
| `architect-completeness`          | Built-in `createCompletenessScorer`       | Проверяет, что все требования из входного сообщения покрыты задачами (ни одно не пропущено)                               | Полнота покрытия                  |
| `architect-prompt-alignment`      | Built-in `createPromptAlignmentScorerLLM` | Проверяет, что ответ соответствует формату из system prompt (JSON с message/needsClarification/tasks, 3-5 вопросов макс)  | Соблюдение инструкций             |
| `architect-keyword-coverage`      | Built-in `createKeywordCoverageScorer`    | Проверяет, что ключевые технические термины из требований присутствуют в описаниях задач                                  | Терминологическая точность        |
| `architect-toxicity`              | Built-in `createToxicityScorer`           | Детектирует вредный/неуместный контент в ответах агента                                                                   | Безопасность контента             |

### 1.2 Developer Agent

| ID                              | Тип                                                         | Метод                                                                                                      | Назначение                       |
| ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `developer-tool-usage-validity` | Custom (function)                                           | Проверяет, что агент НЕ пытался вызвать git/linear/rm и использовал только свои 5 инструментов             | Безопасность инструментов        |
| `developer-output-completeness` | Custom (LLM judge)                                          | `createScorer` + judge — проверяет, что отчёт о реализации содержит: что изменено, какие допущения сделаны | Полнота отчёта                   |
| `developer-path-security`       | Custom (function)                                           | Сканирует output на абсолютные пути и внешние ссылки                                                       | Path traversal                   |
| `developer-code-quality`        | Custom (LLM judge)                                          | `createScorer` + judge — оценивает качество сгенерированного кода (readability, error handling, patterns)  | Качество кода                    |
| `developer-hallucination`       | Built-in `createHallucinationScorer` + `extractToolResults` | Детектирует выдуманные файлы/API. Контекст из tool outputs подаётся через `options.getContext`             | Фактологическая точность         |
| `developer-faithfulness`        | Built-in `createFaithfulnessScorer`                         | Проверяет, что реализация соответствует task description — не добавляет лишнего и не упускает требования   | Соответствие ТЗ                  |
| `developer-tool-call-accuracy`  | Built-in `createToolCallAccuracyScorerLLM`                  | Проверяет правильность выбора инструмента под задачу (readFile→чтение, writeFile→запись, runCommand→тесты) | Корректность выбора инструментов |
| `developer-prompt-alignment`    | Built-in `createPromptAlignmentScorerLLM`                   | Проверяет соблюдение developer system prompt (read→implement→test workflow, без git/linear)                | Соблюдение инструкций            |
| `developer-answer-similarity`   | Built-in `createAnswerSimilarityScorer`                     | На curated датасетах сравнивает output с эталонной реализацией                                             | Точность реализации              |

### 1.3 Reviewer Agent

| ID                            | Тип                                                         | Метод                                                                                                            | Назначение                     |
| ----------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `reviewer-verdict-confidence` | Custom (function)                                           | Сравнивает verdict с ground-truth (на curated датасетах с известным вердиктом)                                   | Точность вердикта              |
| `reviewer-issue-specificity`  | Custom (LLM judge)                                          | `createScorer` + judge — проверяет, что issues содержат: severity, file path, описание проблемы, предложение fix | Структурная корректность       |
| `reviewer-false-positives`    | Custom (LLM judge)                                          | `createScorer` + judge — на curated diff'ах без багов проверяет, что ревьюер не находит ложных проблем           | False positive rate            |
| `reviewer-security-coverage`  | Custom (LLM judge)                                          | `createScorer` + judge — проверяет, что ревью покрывает все 5 focus areas из system prompt                       | Полнота ревью                  |
| `reviewer-hallucination`      | Built-in `createHallucinationScorer` + `extractToolResults` | Детектирует выдуманные уязвимости. Контекст из tool outputs подаётся через `options.getContext`                  | Фактологическая точность ревью |
| `reviewer-faithfulness`       | Built-in `createFaithfulnessScorer`                         | Проверяет, что review text не искажает суть изменений из diff'а                                                  | Точность интерпретации         |
| `reviewer-prompt-alignment`   | Built-in `createPromptAlignmentScorerLLM`                   | Проверяет соблюдение reviewer system prompt: все 5 focus areas, severity markers (🔴🟡🟢), output format         | Соблюдение инструкций          |

---

## Этап 2: Скореры для шагов workflow (Step-level scorers)

Назначение: оценка конкретных шагов внутри каждого workflow.

### 2.1 Architect Workflow

| Шаг                    | Scorer ID                     | Тип                       | Метод                                                                                                       |
| ---------------------- | ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `analyze-requirements` | `step-analyze-task-structure` | Custom scorer (function)  | Проверяет, что output содержит валидные поля (userId, tasks[], parseError: false)                           |
| `analyze-requirements` | `step-analyze-llm-quality`    | Custom scorer (LLM judge) | Оценивает качество tasks — конкретность, покрытие требований, разумный scope                                |
| `create-linear-tasks`  | `step-create-linear-success`  | Custom scorer (function)  | Проверяет, что все задачи созданы (created.length === tasks.length), все имеют taskId/identifier/branchName |
| `create-linear-tasks`  | `step-create-branch-naming`   | Custom scorer (function)  | Валидация формата branchName (e.g. `ENG-xxx/slug-title`)                                                    |

### 2.2 Developer Workflow

| Шаг                 | Scorer ID                    | Тип                       | Метод                                                                                | Live       |
| ------------------- | ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------ | ---------- |
| `claim-task`        | `step-claim-status`          | Custom scorer (function)  | Проверяет, что status === LINEAR_STATUSES.IN_PROGRESS                                | —          |
| `create-branch`     | `step-branch-created`        | Custom scorer (function)  | Проверяет, что branchCreated === true и branchName не изменился                      | —          |
| `analyze-codebase`  | `step-analysis-completeness` | Custom scorer (LLM judge) | Оценивает, что анализ содержит: структуру проекта, релевантные файлы, паттерны, план | —          |
| `implement`         | `step-implement-accuracy`    | Custom scorer (LLM judge) | На curated задачах с ground-truth изменениями — сравнивает implementationResult      | batch only |
| `implement`         | `step-implement-no-git`      | Custom scorer (function)  | Проверяет, что агент не пытался вызвать git в процессе реализации (парсинг output)   | batch only |
| `run-tests`         | `step-tests-executed`        | Custom scorer (function)  | Проверяет наличие testResult с command/stdout/stderr/exitCode/passed                 |
| `fix-test-failures` | `step-fix-effectiveness`     | Custom scorer (function)  | Проверяет, что после fix testResult.passed стало true (через аккумуляцию состояния)  |
| `commit-changes`    | `step-commit-message-format` | Custom scorer (function)  | Проверяет формат: `feat(taskIdentifier): title` и наличие commitHash                 |
| `commit-changes`    | `step-commit-not-empty`      | Custom scorer (function)  | commitHash !== null                                                                  |
| `move-to-review`    | `step-review-status`         | Custom scorer (function)  | Проверяет finalStatus === LINEAR_STATUSES.REVIEW                                     |

### 2.3 Reviewer Workflow

| Шаг             | Scorer ID                       | Тип                       | Метод                                                                   |
| --------------- | ------------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `get-diff`      | `step-diff-not-empty`           | Custom scorer (function)  | Проверяет, что diff.length > 0 и changedFiles.length > 0                |
| `get-diff`      | `step-diff-branch-match`        | Custom scorer (function)  | Проверяет, что branchName совпадает с входным                           |
| `review-code`   | `step-review-structured-output` | Custom scorer (function)  | Проверяет наличие feedback, verdict из допустимых enum, issues — array  |
| `review-code`   | `step-review-verdict-aligned`   | Custom scorer (LLM judge) | На curated diff'ах проверяет, что verdict соответствует ground-truth    |
| `handle-result` | `step-handle-approve-flow`      | Custom scorer (function)  | При isApproved: finalStatus === LINEAR_STATUSES.DONE, merged === true   |
| `handle-result` | `step-handle-reject-flow`       | Custom scorer (function)  | При !isApproved: finalStatus === LINEAR_STATUSES.TODO, merged === false |

---

## Этап 3: Trajectory scorers

Назначение: проверка последовательности вызовов инструментов и шагов.

### 3.1 Developer Agent Tool Trajectory

Использовать `createTrajectoryAccuracyScorerCode()` из `@mastra/evals/scorers/prebuilt`:

```typescript
const developerToolTrajectoryScorer = createTrajectoryAccuracyScorerCode({
  expectedTrajectory: {
    ordering: 'strict',
    steps: [
      { stepType: 'tool_call', name: 'readFile' }, // сначала чтение
      { stepType: 'tool_call', name: 'readFile' }, // ...анализ
      { stepType: 'tool_call', name: 'writeFile' }, // потом запись
      { stepType: 'tool_call', name: 'runCommand' }, // потом тесты
    ],
  },
  comparisonOptions: { strictOrder: false }, // relaxed — лишние readFile ок
});
```

Дополнительно чёрный список:

```typescript
const developerToolBlacklistScorer = createTrajectoryScorerCode({
  defaults: {
    blacklistedTools: ['file-delete'], // удаление — red flag
    maxSteps: 20,
    noRedundantCalls: true,
    maxRetriesPerTool: 3,
  },
});
```

### 3.2 Workflow Step Trajectories

| Workflow             | Ожидаемая траектория                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architect-workflow` | `analyze-requirements` → `create-linear-tasks`                                                                                                              |
| `developer-workflow` | `claim-task` → `create-branch` → `analyze-codebase` → `implement` → `run-tests` → [`fix-test-failures` \| `skip-fix`] → `commit-changes` → `move-to-review` |
| `reviewer-workflow`  | `get-diff` → `review-code` → `handle-result`                                                                                                                |

Для developer-workflow — с nested expectation на branching logic.

### 3.3 Efficiency scoring

Для всех workflow — ограничения на бюджет:

- `maxSteps` — максимум шагов
- `maxTotalDurationMs` — максимум времени выполнения
- `noRedundantCalls` — детекция повторяющихся вызовов

---

## Этап 4: Датасеты для `runEvals`

### 4.1 Architect Dataset (`src/mastra/evals/datasets/architect.dataset.ts`)

```typescript
export const architectDataset = [
  {
    input: 'Добавить тёмную тему в приложение',
    groundTruth: {
      needsClarification: false,
      minTasks: 2,
      requiredKeywords: ['тёмн', 'theme', 'dark', 'css', 'переключ'],
    },
  },
  {
    input: 'Сделать что-то', // некорректный запрос → needsClarification: true
    groundTruth: {
      needsClarification: true,
      tasksLength: 0,
    },
  },
  {
    input: 'Оптимизировать производительность главной страницы',
    groundTruth: {
      needsClarification: false,
      minTasks: 1,
    },
  },
  // ... ещё 7-10 примеров
];
```

### 4.2 Reviewer Dataset (`src/mastra/evals/datasets/reviewer.dataset.ts`)

```typescript
export const reviewerDataset = [
  {
    input: {
      taskIdentifier: 'ENG-001',
      taskTitle: 'Fix SQL injection in login',
      diff: MOCK_SQL_INJECTION_DIFF,
      changedFiles: ['src/auth/login.ts'],
    },
    groundTruth: {
      expectedVerdict: 'request_changes',
      minIssuesCount: 1,
      requiredKeywords: ['SQL', 'injection', 'sanitiz', 'parameterize'],
    },
  },
  {
    input: {
      taskIdentifier: 'ENG-002',
      taskTitle: 'Add unit test for UserService',
      diff: MOCK_CLEAN_DIFF,
      changedFiles: ['src/services/tests/user.test.ts'],
    },
    groundTruth: {
      expectedVerdict: 'approve',
      maxIssuesCount: 0,
    },
  },
  // ... ещё 8-10 примеров
];
```

### 4.3 Developer Dataset (задачи с известным ground-truth)

```typescript
export const developerDataset = [
  {
    input: {
      taskId: 'mock-task-1',
      taskIdentifier: 'ENG-003',
      taskTitle: 'Add input validation to createUser endpoint',
      taskDescription: 'Add zod schema validation for the createUser endpoint...',
      branchName: 'ENG-003/input-validation',
    },
    groundTruth: {
      expectedChanges: ['src/routes/user.ts', 'src/schemas/user.ts'],
      mustRunTests: true,
      mustNotCallGit: true,
    },
  },
  // ...
];
```

---

## Этап 5: Live Scoring (прикрепление скореров к агентам и шагам)

### 5.1 Agent-level live scoring

В файлах агентов (`architect.agent.ts`, `developer.agent.ts`, `reviewer.agent.ts`) добавить опцию `scorers`:

```typescript
import {
  createFaithfulnessScorer,
  createCompletenessScorer,
  createPromptAlignmentScorerLLM,
  createKeywordCoverageScorer,
  createToxicityScorer,
} from '@mastra/evals/scorers/prebuilt';
import { architectTaskValidityScorer } from '../../evals/scorers/agent-scorers.js';

export const architectAgent = new Agent({
  id: 'architect-agent',
  // ... остальное
  scorers: {
    // Кастомные
    'task-validity': {
      scorer: architectTaskValidityScorer,
      sampling: { type: 'ratio', rate: 1.0 }, // 100% — критический агент
    },
    // Встроенные
    faithfulness: {
      scorer: createFaithfulnessScorer({ model: 'openai/gpt-4o-mini' }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
    completeness: {
      scorer: createCompletenessScorer({ model: 'openai/gpt-4o-mini' }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
    'prompt-alignment': {
      scorer: createPromptAlignmentScorerLLM({ model: 'openai/gpt-4o-mini' }),
      sampling: { type: 'ratio', rate: 0.3 },
    },
    'keyword-coverage': {
      scorer: createKeywordCoverageScorer(),
      sampling: { type: 'ratio', rate: 0.3 },
    },
    toxicity: {
      scorer: createToxicityScorer({ model: 'openai/gpt-4o-mini' }),
      sampling: { type: 'ratio', rate: 0.3 },
    },
  },
});
```

**Developer Agent** (пояснение с `getContext` для hallucination):

```typescript
import { createHallucinationScorer } from '@mastra/evals/scorers/prebuilt';
import { extractToolResults } from '@mastra/evals/scorers';

const developerHallucinationScorer = createHallucinationScorer({
  model: 'openai/gpt-4o-mini',
  options: {
    getContext: ({ run }) => {
      const toolResults = extractToolResults(run.output);
      return toolResults.map((t) => JSON.stringify({ tool: t.toolName, result: t.result }));
    },
  },
});
```

**Reviewer Agent** (аналогично с `getContext` для hallucination):

```typescript
const reviewerHallucinationScorer = createHallucinationScorer({
  model: 'openai/gpt-4o-mini',
  options: {
    getContext: ({ run }) => {
      const toolResults = extractToolResults(run.output);
      return toolResults.map((t) => JSON.stringify({ tool: t.toolName, result: t.result }));
    },
  },
});
```

### 5.2 Step-level live scoring

В файлах шагов, которые вызывают LLM (`analyze-requirements.ts`, `analyze-codebase.ts`, `implement.ts`, `fix-test-failures.ts`, `review-code.ts`):

```typescript
import { stepAnalysisCompletenessScorer } from '../../../evals/scorers/step-scorers.js';

export const analyzeCodebaseStep = createStep({
  id: 'analyze-codebase',
  inputSchema: developerBranchOutputSchema,
  outputSchema: developerAnalysisOutputSchema,
  scorers: {
    'analysis-completeness': {
      scorer: stepAnalysisCompletenessScorer,
      sampling: { type: 'ratio', rate: 0.5 },
    },
  },
  execute: async ({ inputData }) => {
    // ... existing implementation
  },
});
```

### 5.3 Стратегия sampling rate

| Компонент                                                         | Rate | Причина                                         |
| ----------------------------------------------------------------- | ---- | ----------------------------------------------- |
| Architect Agent — task-validity, faithfulness, completeness       | 1.0  | Критический entry-point для задач               |
| Architect Agent — clarification-quality                           | 1.0  | Критический HITL flow                           |
| Architect Agent — response-language, task-count, keyword-coverage | 1.0  | Function-based, нет LLM-затрат                  |
| Architect Agent — prompt-alignment                                | 0.5  | LLM judge, полезен но не критичен               |
| Architect Agent — toxicity                                        | 0.3  | Дополнительный контроль безопасности            |
| Developer Agent — tool-call-accuracy, tool-usage-validity         | 1.0  | Безопасность инструментов критична              |
| Developer Agent — hallucination                                   | 1.0  | Фактологические ошибки недопустимы              |
| Developer Agent — остальные встроенные                            | 0.3  | Дополнительный контроль качества                |
| Reviewer Agent — все scorers                                      | 1.0  | Критическая безопасность                        |
| review-code step — `step-review-structured-output`                | 1.0  | Критический шаг — структурная валидация         |
| review-code step — `step-review-verdict-aligned`                  | 1.0  | Критический шаг — проверка вердикта (LLM judge) |

---

## Этап 6: Эксперименты и CI/CD

### 6.1 Запуск экспериментов

```typescript
// src/mastra/evals/experiments/agent-evals.ts
import { runEvals } from '@mastra/core/evals';
import { mastra } from '../../index.js';
import { architectAgent } from '../../agents/architect.agent.js';
import { architectDataset } from '../datasets/architect.dataset.js';
import { architectScorers } from '../scorers/agent-scorers.js';

const result = await runEvals({
  target: architectAgent,
  data: architectDataset,
  scorers: Object.values(architectScorers),
  concurrency: 2,
  onItemComplete: ({ item, targetResult, scorerResults }) => {
    console.log(`[${item.input}] → score:`, scorerResults);
  },
});

console.log('Average scores:', result.scores);
console.log('Summary:', result.summary);
```

### 6.2 Workflow-level experiments

```typescript
// src/mastra/evals/experiments/workflow-evals.ts
const result = await runEvals({
  target: mastra.getWorkflow('developer-workflow'),
  data: developerWorkflowDataset,
  scorers: {
    workflow: [workflowOutputQualityScorer],
    steps: {
      'analyze-codebase': [stepAnalysisCompletenessScorer],
      implement: [stepImplementAccuracyScorer, stepImplementNoGitScorer],
      'run-tests': [stepTestsExecutedScorer],
      'fix-test-failures': [stepFixEffectivenessScorer],
      'commit-changes': [stepCommitMessageFormatScorer, stepCommitNotEmptyScorer],
    },
    trajectory: [developerToolTrajectoryScorer, developerToolBlacklistScorer],
  },
  concurrency: 1, // Последовательно — шаги модифицируют состояние
  onItemComplete: ({ item, targetResult, scorerResults }) => {
    // Логирование результатов
  },
});
```

### 6.3 CI интеграция

```bash
# В .github/workflows/eval.yml (или аналог)
- name: Run evals
  run: pnpm eval:ci
  env:
    AI_API_KEY: ${{ secrets.AI_API_KEY }}
    PROJECT_PATH: ${{ github.workspace }}/fixtures/mock-project
```

Threshold-based pass/fail:

- Agent-скореры: средний score ≥ 0.7
- Step-скореры: средний score ≥ 0.8
- Trajectory-скореры: accuracy ≥ 0.9
- Toxicity/Bias: score ≤ 0.1 (чем ниже, тем лучше)

---

## Этап 7: Фикстуры и моки

### 7.1 Mock project (`src/mastra/evals/fixtures/mock-project/`)

Минимальный проект для тестирования developer agent:

```
mock-project/
├── package.json
├── README.md
├── src/
│   ├── index.ts
│   ├── utils/
│   │   └── math.ts
│   └── tests/
│       └── math.test.ts
└── tsconfig.json
```

### 7.2 Mock diffs (`src/mastra/evals/fixtures/code-diffs.ts`)

Предзаготовленные диффы для reviewer:

- `SQL_INJECTION_DIFF` — содержит SQL injection → ожидаем `request_changes`
- `HARDCODED_SECRET_DIFF` — хардкод secret key → ожидаем `request_changes`
- `CLEAN_REFACTOR_DIFF` — чистый рефакторинг → ожидаем `approve`
- `NO_TESTS_DIFF` — код без тестов → пограничный случай
- `XSS_VULNERABILITY_DIFF` — XSS уязвимость → ожидаем `request_changes`

### 7.3 Mock requirements (`src/mastra/evals/fixtures/requirements.ts`)

Примеры требований для architect:

- Полное требование с acceptance criteria
- Неполное требование (нуждается в уточнении)
- Амбициозное требование (требует декомпозиции на 5+ задач)
- Некорректный запрос (должен запросить уточнение)

---

## Этап 8: Приоритеты и порядок реализации

### Sprint 1: Базовая инфраструктура

1. Установка `@mastra/evals@latest` — пакет с готовыми фабриками скореров
2. Установка `vitest` + `@vitest/runner` для запуска eval-скриптов
3. Создание структуры директорий `src/mastra/evals/`
4. Регистрация скореров в `src/mastra/index.ts`
5. Добавление eval-скриптов в `package.json`

### Sprint 2: Agent scorers (самое важное)

1. Создание `agent-scorers.ts` со всеми скорерами из Этапа 1
2. Создание датасетов для architect, reviewer
3. Реализация `agent-evals.ts` для запуска `runEvals`
4. Прикрепление скореров к агентам (live scoring)
5. **Milestone: можно запустить `pnpm eval:architect` и получить осмысленные оценки**

### Sprint 3: Step scorers

1. Создание `step-scorers.ts` со всеми скорерами из Этапа 2
2. Прикрепление к шагам
3. Реализация `workflow-evals.ts`

### Sprint 4: Trajectory scorers

1. Создание `trajectory-scorers.ts`
2. Интеграция с runEvals для workflow
3. Настройка expected trajectories

### Sprint 5: Фикстуры и CI

1. Создание mock-project
2. Создание curated diffs
3. Настройка CI-пайплайна

---

## Приложение A: Judge Model Config

Для LLM-based скореров использовать `openai/gpt-4o-mini` (дешевле и быстрее для оценочных задач):

```typescript
// src/mastra/evals/scorers/shared.ts
import { getEnv } from '../../../config/env.js';

const env = getEnv();

export const judgeModel = env.JUDGE_MODEL ?? 'openai/gpt-4o-mini';

export const judgeConfig = {
  model: judgeModel,
  instructions: 'You are an expert evaluator for an AI-powered development pipeline...',
};
```

Добавить в `.env.example`:

```
JUDGE_MODEL=openai/gpt-4o-mini  # Модель для LLM-judge в evals
```

---

## Приложение B: Ключевые метрики для мониторинга

| Метрика                         | Способ измерения                                      | Целевое значение                  |
| ------------------------------- | ----------------------------------------------------- | --------------------------------- |
| Architect Task Validity         | `architect-task-validity` scorer score                | ≥ 0.85                            |
| Architect Faithfulness          | `faithfulness` built-in scorer                        | ≥ 0.85                            |
| Architect Completeness          | `completeness` built-in scorer                        | ≥ 0.80                            |
| Architect Prompt Alignment      | `prompt-alignment` built-in scorer                    | ≥ 0.90                            |
| Architect Keyword Coverage      | `keyword-coverage` built-in scorer                    | ≥ 0.70                            |
| Developer Code Quality          | `developer-code-quality` scorer score                 | ≥ 0.70                            |
| Developer Hallucination         | `hallucination` built-in scorer (inverted: 1-score)   | ≤ 0.10 (почти нет выдумок)        |
| Developer Faithfulness          | `faithfulness` built-in scorer                        | ≥ 0.80                            |
| Developer Tool-Call Accuracy    | `tool-call-accuracy` built-in scorer                  | ≥ 0.95                            |
| Developer Path Security         | `developer-path-security` scorer (binary)             | = 1.0 (no violations)             |
| Developer Prompt Alignment      | `prompt-alignment` built-in scorer                    | ≥ 0.85                            |
| Developer Answer Similarity     | `answer-similarity` built-in scorer (vs ground truth) | ≥ 0.75                            |
| Reviewer Verdict Accuracy       | `reviewer-verdict-confidence` vs ground truth         | ≥ 0.90                            |
| Reviewer Hallucination          | `hallucination` built-in scorer (inverted: 1-score)   | ≤ 0.05 (почти нет ложных проблем) |
| Reviewer Faithfulness           | `faithfulness` built-in scorer                        | ≥ 0.85                            |
| Reviewer Prompt Alignment       | `prompt-alignment` built-in scorer                    | ≥ 0.90                            |
| Reviewer False Positive Rate    | `reviewer-false-positives` (1 - score)                | ≤ 0.15                            |
| Reviewer Security Coverage      | `reviewer-security-coverage`                          | ≥ 0.80                            |
| Trajectory Accuracy (Developer) | `trajectory-accuracy` code scorer                     | ≥ 0.90                            |
| Workflow Step Completeness      | Среднее step-level scores                             | ≥ 0.80                            |
| Toxicity (all agents)           | `toxicity` built-in scorer                            | ≤ 0.05                            |

---

## Приложение C: Риски и ограничения

1. **LLM Judge bias**: LLM-judge может иметь bias к определённым паттернам. Рекомендуется использовать как минимум 3 judge-прогона на item и брать медиану.
2. **Cost**: Каждый LLM judge вызов стоит денег. Sampling rate на продовых live scorers должен быть консервативным (0.1-0.3 для дорогих judge, 1.0 для function-based).
3. **Developer workflow в runEvals**: Из-за интеграции с реальной файловой системой и git, runEvals на developer workflow требует изолированной среды (mock project). На CI нужен git init + minimal npm.
4. **Architect Memory**: Architect использует Memory (persistent threads). В runEvals нужно очищать threads между items или использовать `prepareRun` для изоляции.
5. **Совместимость `@mastra/evals` с `@mastra/core@^1.45.0`**: Пакет `@mastra/evals` не установлен в проекте. Перед началом работы нужно установить `@mastra/evals@latest` и проверить, что версии обоих пакетов совместимы. При конфликте — зафиксировать конкретную версию `@mastra/evals`.
6. **Hallucination scorer требует `getContext`**: Для developer и reviewer hallucination scorer должен получать контекст через `extractToolResults()` из `@mastra/evals/scorers` (НЕ из `prebuilt`!). Без этого scorer не сможет отличить правду от выдумки.
7. **Tool-call-accuracy требует tool definitions**: Built-in `createToolCallAccuracyScorerLLM` ожидает, что инструменты агента зарегистрированы в Mastra и доступны через observability traces. Если storage не настроен для traces, scorer упадёт в fallback-режим с пониженной точностью.
8. **Answer-similarity требует ground-truth**: Работает только на curated датасетах с эталонными ответами — не для live scoring. Использовать в `runEvals()` экспериментах.

---

## Приложение D: План реализации по критичности (от P0 к P3)

Критичность определяется по двум осям: **влияние на безопасность продакшена** и **необходимость для работы остальных компонентов**.

---

### P0 — Критический (невозможно работать без этого)

Без этих компонентов система не запустится, либо в проде будут недетектированные баги безопасности.

#### 1. Инфраструктура (Этап 0 полностью)

| #   | Задача                                                                             | Файлы                                                | Почему P0                                                                             |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Установка `@mastra/evals@latest` + проверка совместимости с `@mastra/core@^1.45.0` | `package.json`                                       | Без пакета невозможны ни scorers, ни runEvals. Риск несовместимости версий — blocker. |
| 2   | Установка `vitest` + `@vitest/runner`                                              | `package.json`                                       | Раннер для eval-скриптов.                                                             |
| 3   | Создание структуры директорий `src/mastra/evals/`                                  | `scorers/`, `datasets/`, `experiments/`, `fixtures/` | Каркас для всей системы eval.                                                         |
| 4   | Регистрация scorers в `src/mastra/index.ts`                                        | `src/mastra/index.ts`                                | Без этого Mastra не видит scorers, live scoring не работает.                          |
| 5   | Добавление eval-скриптов в `package.json`                                          | `package.json`                                       | Точки входа для ручного и CI запуска.                                                 |
| 6   | `shared.ts` — judge model config (`openai/gpt-4o-mini`), хелперы                   | `src/mastra/evals/scorers/shared.ts`                 | Используется всеми LLM-скорерами.                                                     |
| 7   | `.env.example` — `JUDGE_MODEL`                                                     | `.env.example`                                       | Конфигурация модели для judge.                                                        |

#### 2. Reviewer Agent Scorers (безопасность продакшена)

Reviewer — последний рубеж перед мёрджем кода. Ошибка здесь = баг/уязвимость в проде.

| #   | Scorer ID                     | Тип                                                 | Почему P0                                                                                      |
| --- | ----------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 8   | `reviewer-verdict-confidence` | Custom function                                     | Сравнение verdict с ground-truth. Ключевая метрика — не пропускает ли reviewer баги.           |
| 9   | `reviewer-hallucination`      | Built-in `createHallucinationScorer` + `getContext` | Выдуманные уязвимости подрывают доверие к reviewer и тратят время разработчиков.               |
| 10  | `reviewer-false-positives`    | Custom LLM judge                                    | False positives = разработчик получает reject на чистый код. Критично для скорости разработки. |
| 11  | `reviewer-security-coverage`  | Custom LLM judge                                    | Проверка, что все 5 focus areas покрыты. Пропуск focus area = потенциальная уязвимость.        |

#### 3. Developer Agent Scorers (безопасность инструментов)

Developer имеет доступ к файловой системе и тестам. Ошибка здесь = повреждение кодовой базы.

| #   | Scorer ID                       | Тип                                                 | Почему P0                                                                                                     |
| --- | ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 12  | `developer-tool-usage-validity` | Custom function                                     | Проверка, что агент не вызвал запрещённые инструменты (git, linear, rm). Нарушение = повреждение репозитория. |
| 13  | `developer-path-security`       | Custom function                                     | Детекция абсолютных путей и внешних ссылок в output. Path traversal = угроза безопасности.                    |
| 14  | `developer-hallucination`       | Built-in `createHallucinationScorer` + `getContext` | Выдуманные файлы/API. Без `extractToolResults()` scorer не работает — см. риск #6.                            |
| 15  | `developer-faithfulness`        | Built-in `createFaithfulnessScorer`                 | Проверка, что реализация строго соответствует ТЗ, без лишнего.                                                |
| 16  | `developer-tool-call-accuracy`  | Built-in `createToolCallAccuracyScorerLLM`          | Правильность выбора инструмента под задачу. Требует observability traces — см. риск #7.                       |

#### 4. Live Scoring для Reviewer (P0 — продакшен мониторинг)

| #   | Задача                                                                                                               | Файлы                                 | Почему P0                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| 17  | Прикрепление scorers к `reviewer.agent.ts`: все scorers с sampling rate 1.0                                          | `src/mastra/agents/reviewer.agent.ts` | Без live scoring reviewer работает вслепую. Все scorers reviewer — P0. |
| 18  | Прикрепление scorers к шагу `review-code`: `step-review-structured-output`, `step-review-verdict-aligned` с rate 1.0 | Шаг `review-code`                     | Ключевой шаг — здесь принимается решение approve/reject.               |

#### 5. Live Scoring для Developer (P0 — продакшен мониторинг безопасности)

| #   | Задача                                                                                                                                                                                                                                                              | Файлы                                  | Почему P0                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------- |
| 19  | Прикрепление scorers к `developer.agent.ts`: `tool-usage-validity` (1.0), `hallucination` (1.0), `tool-call-accuracy` (1.0), `path-security` (1.0)                                                                                                                  | `src/mastra/agents/developer.agent.ts` | Scorers безопасности должны работать на 100% вызовов. |
| 20  | _Не применяется_ — implement-шаг не использует live scorers. Agent-level `developer-tool-usage-validity` (rate 1.0) перехватывает вызовы git. Scorers `step-implement-accuracy`, `step-implement-no-git` доступны только для batch eval через `stepScorerRegistry`. | —                                      | Безопасность инструментов покрыта agent-level scorer. |

#### 6. Reviewer Dataset + Fixtures (P0 — без данных scorer не проверить)

| #   | Задача                                                                                                                            | Файлы                                           | Почему P0                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| 21  | `reviewer.dataset.ts` (10 примеров с ground-truth verdict)                                                                        | `src/mastra/evals/datasets/reviewer.dataset.ts` | Без датасета `runEvals` для reviewer невозможен.       |
| 22  | `code-diffs.ts` — `SQL_INJECTION_DIFF`, `HARDCODED_SECRET_DIFF`, `XSS_VULNERABILITY_DIFF`, `CLEAN_REFACTOR_DIFF`, `NO_TESTS_DIFF` | `src/mastra/evals/fixtures/code-diffs.ts`       | Критические security диффы — основа датасета reviewer. |

#### 7. Trajectory Scorers для Developer (P0 — безопасность последовательности инструментов)

| #   | Задача                                                                                                                               | Файлы                                            | Почему P0                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------- |
| 23  | `developer-tool-trajectory` — `createTrajectoryAccuracyScorerCode` (readFile → writeFile → runCommand)                               | `src/mastra/evals/scorers/trajectory-scorers.ts` | Нарушение порядка (write до read) = повреждение данных. |
| 24  | `developer-tool-blacklist` — `createTrajectoryScorerCode` (запрет `file-delete`, maxSteps=20, noRedundantCalls, maxRetriesPerTool=3) | `src/mastra/evals/scorers/trajectory-scorers.ts` | Предотвращение удаления файлов и бесконечных циклов.    |

---

### P1 — Высокий (необходимо для качества, но не блокирует запуск)

#### 8. Architect Agent Scorers

Architect — entry point. Ошибка здесь = неправильные задачи уходят в разработку.

| #   | Scorer ID                         | Тип                                       | Почему P1                                                                                                 |
| --- | --------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 25  | `architect-task-validity`         | Custom LLM judge                          | Структурная корректность задач (title/description/priority/acceptance criteria).                          |
| 26  | `architect-faithfulness`          | Built-in `createFaithfulnessScorer`       | Задачи не содержат выдуманных деталей.                                                                    |
| 27  | `architect-completeness`          | Built-in `createCompletenessScorer`       | Все требования покрыты задачами.                                                                          |
| 28  | `architect-clarification-quality` | Custom LLM judge                          | HITL-ветка: качество уточняющих вопросов. Без этого architect не сможет обрабатывать неполные требования. |
| 29  | `architect-prompt-alignment`      | Built-in `createPromptAlignmentScorerLLM` | Ответ соответствует формату system prompt.                                                                |
| 30  | `architect-task-count`            | Custom function                           | Разумность декомпозиции (1-10 задач).                                                                     |
| 31  | `architect-keyword-coverage`      | Built-in `createKeywordCoverageScorer`    | Технические термины из требований есть в описаниях задач.                                                 |
| 32  | `architect-toxicity`              | Built-in `createToxicityScorer`           | Безопасность контента.                                                                                    |
| 33  | `architect-response-language`     | Custom function                           | Язык ответа совпадает с языком запроса.                                                                   |

#### 9. Architect Dataset + Fixtures

| #   | Задача                                                                                               | Файлы                                            |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 34  | `architect.dataset.ts` (10 примеров: полные требования, неполные, амбициозные, некорректные запросы) | `src/mastra/evals/datasets/architect.dataset.ts` |
| 35  | `requirements.ts` — примеры требований для architect                                                 | `src/mastra/evals/fixtures/requirements.ts`      |

#### 10. Live Scoring для Architect

| #   | Задача                                                                                                                                                                                                                                                                  | Файлы                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 36  | Прикрепление scorers к `architect.agent.ts`: `task-validity` (1.0), `faithfulness` (1.0), `completeness` (1.0), `clarification-quality` (1.0), function-based (`response-language`, `task-count`, `keyword-coverage`) — 1.0, `prompt-alignment` (0.5), `toxicity` (0.3) | `src/mastra/agents/architect.agent.ts` |
| 37  | Прикрепление к шагу `analyze-requirements`: `step-analyze-task-structure` (1.0), `step-analyze-llm-quality` (0.5)                                                                                                                                                       | Шаг `analyze-requirements`             |

#### 11. Step Scorers — критические шаги

| #   | Scorer ID                       | Шаг                    | Почему P1                                                    |
| --- | ------------------------------- | ---------------------- | ------------------------------------------------------------ |
| 38  | `step-analyze-task-structure`   | `analyze-requirements` | Проверка структуры output architect workflow.                |
| 39  | `step-create-linear-success`    | `create-linear-tasks`  | Все задачи созданы в Linear.                                 |
| 40α | `step-implement-no-git`         | `implement`            | Запрет git (batch only — agent-level скорер покрывает live). |
| 40β | `step-implement-accuracy`       | `implement`            | Точность реализации (batch only).                            |
| 41  | `step-tests-executed`           | `run-tests`            | Подтверждение, что тесты реально запущены.                   |
| 42  | `step-review-structured-output` | `review-code`          | Структура ответа reviewer (feedback, verdict, issues).       |
| 43  | `step-handle-approve-flow`      | `handle-result`        | Правильная обработка approve.                                |
| 44  | `step-handle-reject-flow`       | `handle-result`        | Правильная обработка reject.                                 |

#### 12. Developer Dataset

| #   | Задача                                                                                        | Файлы                                            |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 45  | `developer.dataset.ts` (задачи с ground-truth: expectedChanges, mustRunTests, mustNotCallGit) | `src/mastra/evals/datasets/developer.dataset.ts` |

#### 13. Workflow Step Trajectories

| #   | Задача                                                                          | Почему P1                                |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| 46  | `architect-workflow` trajectory: `analyze-requirements` → `create-linear-tasks` | Валидация правильной последовательности. |
| 47  | `reviewer-workflow` trajectory: `get-diff` → `review-code` → `handle-result`    | Критично для безопасности ревью.         |

---

### P2 — Средний (улучшает качество и покрытие, можно отложить)

#### 14. Оставшиеся Developer Scorers

| #   | Scorer ID                       | Тип                                                                                |
| --- | ------------------------------- | ---------------------------------------------------------------------------------- |
| 48  | `developer-output-completeness` | Custom LLM judge — полнота отчёта о реализации                                     |
| 49  | `developer-code-quality`        | Custom LLM judge — качество кода                                                   |
| 50  | `developer-prompt-alignment`    | Built-in `createPromptAlignmentScorerLLM`                                          |
| 51  | `developer-answer-similarity`   | Built-in `createAnswerSimilarityScorer` (только на curated датасетах, не для live) |

#### 15. Оставшиеся Reviewer Scorers

| #   | Scorer ID                    | Тип                                                |
| --- | ---------------------------- | -------------------------------------------------- |
| 52  | `reviewer-issue-specificity` | Custom LLM judge — структурная корректность issues |
| 53  | `reviewer-faithfulness`      | Built-in `createFaithfulnessScorer`                |
| 54  | `reviewer-prompt-alignment`  | Built-in `createPromptAlignmentScorerLLM`          |

#### 16. Оставшиеся Step Scorers

| #   | Scorer ID                     | Шаг                    |
| --- | ----------------------------- | ---------------------- |
| 55  | `step-analyze-llm-quality`    | `analyze-requirements` |
| 56  | `step-create-branch-naming`   | `create-linear-tasks`  |
| 57  | `step-claim-status`           | `claim-task`           |
| 58  | `step-branch-created`         | `create-branch`        |
| 59  | `step-analysis-completeness`  | `analyze-codebase`     |
| 60  | `step-implement-accuracy`     | `implement`            |
| 61  | `step-fix-effectiveness`      | `fix-test-failures`    |
| 62  | `step-commit-message-format`  | `commit-changes`       |
| 63  | `step-commit-not-empty`       | `commit-changes`       |
| 64  | `step-review-status`          | `move-to-review`       |
| 65  | `step-diff-not-empty`         | `get-diff`             |
| 66  | `step-diff-branch-match`      | `get-diff`             |
| 67  | `step-review-verdict-aligned` | `review-code`          |

#### 17. Workflow-level Live Scoring (не LLM-шаги)

| #   | Задача                                                                                                                                              | Файлы                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 68  | Прикрепление scorers к шагам без LLM: `claim-task`, `create-branch`, `commit-changes`, `move-to-review`, `get-diff`, `handle-result` с rate 0.1-0.2 | Соответствующие файлы шагов |

#### 18. Developer Workflow Trajectory

| #   | Задача                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 69  | `developer-workflow` trajectory: `claim-task` → `create-branch` → `analyze-codebase` → `implement` → `run-tests` → [`fix-test-failures` \| `skip-fix`] → `commit-changes` → `move-to-review` (с nested branching logic) |

#### 19. Batch Evaluation — `runEvals` эксперименты

| #   | Задача                                                           | Файлы                                         |
| --- | ---------------------------------------------------------------- | --------------------------------------------- |
| 70  | `agent-evals.ts` — `runEvals` для всех трёх агентов с датасетами | `src/mastra/evals/experiments/agent-evals.ts` |
| 71  | `run.ts` — единая точка запуска всех eval                        | `src/mastra/evals/run.ts`                     |

---

### P3 — Низкий (nice-to-have, можно в последнюю очередь)

#### 20. Efficiency Scoring

| #   | Задача                                                                 | Почему P3                                                   |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| 72  | `maxSteps`, `maxTotalDurationMs`, `noRedundantCalls` для всех workflow | Оптимизация стоимости и времени, не влияет на корректность. |

#### 21. Mock Project

| #   | Задача                                                                                                                                 | Файлы                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 73  | Создание `mock-project/` с `package.json`, `README.md`, `src/index.ts`, `src/utils/math.ts`, `src/tests/math.test.ts`, `tsconfig.json` | `src/mastra/evals/fixtures/mock-project/` |

#### 22. Workflow-level Experiments

| #   | Задача                                                                                        | Файлы                                            |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 74  | `workflow-evals.ts` — `runEvals` для целых workflow с пошаговыми scorers и trajectory scorers | `src/mastra/evals/experiments/workflow-evals.ts` |
| 75  | `step-evals.ts` — `runEvals` для отдельных шагов                                              | `src/mastra/evals/experiments/step-evals.ts`     |

#### 23. CI/CD Интеграция

| #   | Задача                                                                               |
| --- | ------------------------------------------------------------------------------------ |
| 76  | `.github/workflows/eval.yml` — CI пайплайн с `pnpm eval:ci`                          |
| 77  | Threshold-based pass/fail: agent ≥ 0.7, step ≥ 0.8, trajectory ≥ 0.9, toxicity ≤ 0.1 |

---

### Сводная карта зависимостей

```
P0: Инфраструктура (1-7)
 ├─► P0: Reviewer Scorers (8-11)
 │    ├─► P0: Reviewer Fixtures + Dataset (21-22)
 │    └─► P0: Reviewer Live Scoring (17-18)
 ├─► P0: Developer Scorers (12-16)
 │    ├─► P0: Developer Trajectory (23-24)
 │    └─► P0: Developer Live Scoring (agent only, 19)
 ├─► P1: Architect Scorers (25-33)
 │    ├─► P1: Architect Fixtures + Dataset (34-35)
 │    └─► P1: Architect Live Scoring (36-37)
 ├─► P1: Step Scorers — критические (38-44)
 ├─► P1: Developer Dataset (45)
 └─► P1: Workflow Trajectories (46-47)
      │
      └─► P2: Оставшиеся scorers (48-67)
           ├─► P2: Workflow Live Scoring (68)
           ├─► P2: Developer Workflow Trajectory (69)
           └─► P2: Batch runEvals (70-71)
                │
                └─► P3: Efficiency + Mock + CI (72-77)
```

### Рекомендуемый порядок выполнения (merged view)

| Порядок | Задача                                                                                                                | Критичность | Номер задачи |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| 1       | Установка зависимостей + структура директорий + shared конфиг                                                         | P0          | 1-7          |
| 2       | Reviewer scorers: verdict-confidence, hallucination, false-positives, security-coverage                               | P0          | 8-11         |
| 3       | Reviewer fixtures (SQL_INJECTION, HARDCODED_SECRET, XSS, CLEAN_REFACTOR, NO_TESTS)                                    | P0          | 22           |
| 4       | Reviewer dataset (10 примеров с ground-truth)                                                                         | P0          | 21           |
| 5       | Reviewer live scoring (agent + шаг review-code)                                                                       | P0          | 17-18        |
| 6       | Developer scorers: tool-usage-validity, path-security, hallucination, faithfulness, tool-call-accuracy                | P0          | 12-16        |
| 7       | Developer trajectory scorers (accuracy + blacklist)                                                                   | P0          | 23-24        |
| 8       | Developer live scoring (agent-level, без шага implement — batch only)                                                 | P0          | 19           |
| 9       | Architect scorers (все 9 scorers)                                                                                     | P1          | 25-33        |
| 10      | Architect fixtures + dataset                                                                                          | P1          | 34-35        |
| 11      | Architect live scoring                                                                                                | P1          | 36-37        |
| 12      | Step scorers — критические (analyze, linear-success, implement-no-git, tests-executed, review-output, approve/reject) | P1          | 38-44        |
| 13      | Developer dataset                                                                                                     | P1          | 45           |
| 14      | Workflow trajectories (architect, reviewer)                                                                           | P1          | 46-47        |
| 15      | Оставшиеся developer/reviewer scorers                                                                                 | P2          | 48-54        |
| 16      | Оставшиеся step scorers (15 scorers)                                                                                  | P2          | 55-67        |
| 17      | Workflow live scoring (не LLM-шаги)                                                                                   | P2          | 68           |
| 18      | Developer workflow trajectory                                                                                         | P2          | 69           |
| 19      | runEvals эксперименты (agent-evals, run.ts)                                                                           | P2          | 70-71        |
| 20      | Efficiency scoring                                                                                                    | P3          | 72           |
| 21      | Mock project                                                                                                          | P3          | 73           |
| 22      | Workflow-level + step-level runEvals                                                                                  | P3          | 74-75        |
| 23      | CI/CD интеграция                                                                                                      | P3          | 76-77        |
