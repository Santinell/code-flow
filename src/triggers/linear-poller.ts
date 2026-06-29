import { Workflow } from '@mastra/core/workflows';
import { getEnv } from '../config/env.js';
import * as db from '../db/index.js';
import { getFirstTodoTask, getFirstReviewTask } from '../integrations/linear.js';
import { developerWorkflow } from '../mastra/workflows/developer.workflow.js';
import { reviewerWorkflow } from '../mastra/workflows/reviewer.workflow.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('linear-poller');

const ACTIVE_STATUSES = ['running', 'waiting', 'suspended'] as const;

async function isTaskActive(workflow: Workflow, taskId: string): Promise<boolean> {
  const active = db.getActiveRunByTask(taskId);
  if (!active) {
    return false;
  }

  const state = await workflow.getWorkflowRunById(active.runId);
  return (
    state !== null && ACTIVE_STATUSES.includes(state.status as (typeof ACTIVE_STATUSES)[number])
  );
}

async function pollAndProcessDeveloper(): Promise<void> {
  try {
    const env = getEnv();
    const active = db.countActiveRunsByType('developer');
    if (active >= env.MAX_CONCURRENT_DEVELOPER_TASKS) {
      log.debug(
        { active, limit: env.MAX_CONCURRENT_DEVELOPER_TASKS },
        'Developer concurrency limit reached — skipping poll'
      );
      return;
    }

    const task = await getFirstTodoTask();
    if (!task) {
      return;
    }

    if (await isTaskActive(developerWorkflow, task.id)) {
      return;
    }

    if (!task.branchName) {
      log.warn(
        { taskId: task.identifier },
        'Task has no branch name assigned — skipping (Architect should set it)'
      );
      return;
    }

    log.info({ taskId: task.identifier, branchName: task.branchName }, 'Processing ToDo task');

    const run = await developerWorkflow.createRun();
    db.saveWorkflowRun(run.runId, { taskId: task.id, workflowType: 'developer' });

    await run.start({
      inputData: {
        taskId: task.id,
        taskIdentifier: task.identifier,
        taskTitle: task.title,
        taskDescription: task.description,
        branchName: task.branchName,
        taskComments: task.comments ?? [],
      },
    });

    db.deleteWorkflowRun(run.runId);

    log.info({ taskId: task.identifier }, 'Developer workflow completed');
  } catch (error) {
    log.error({ error }, 'Developer poll error');
  }
}

async function pollAndProcessReviewer(): Promise<void> {
  try {
    const env = getEnv();
    const active = db.countActiveRunsByType('reviewer');
    if (active >= env.MAX_CONCURRENT_REVIEWER_TASKS) {
      log.debug(
        { active, limit: env.MAX_CONCURRENT_REVIEWER_TASKS },
        'Reviewer concurrency limit reached — skipping poll'
      );
      return;
    }

    const task = await getFirstReviewTask();
    if (!task) {
      return;
    }

    if (await isTaskActive(reviewerWorkflow, task.id)) {
      return;
    }

    if (!task.branchName) {
      log.warn({ taskId: task.identifier }, 'Review task has no branch name — skipping');
      return;
    }

    log.info({ taskId: task.identifier, branchName: task.branchName }, 'Processing Review task');

    const run = await reviewerWorkflow.createRun();
    db.saveWorkflowRun(run.runId, { taskId: task.id, workflowType: 'reviewer' });

    await run.start({
      inputData: {
        taskId: task.id,
        taskIdentifier: task.identifier,
        taskTitle: task.title,
        taskDescription: task.description,
        branchName: task.branchName,
        taskComments: task.comments ?? [],
      },
    });

    db.deleteWorkflowRun(run.runId);

    log.info({ taskId: task.identifier }, 'Reviewer workflow completed');
  } catch (error) {
    log.error({ error }, 'Reviewer poll error');
  }
}

// ── Main Poll Loop ─────────────────────────────────────────────────
export function startPolling(): void {
  const env = getEnv();
  const interval = env.POLL_INTERVAL_MS;

  log.info({ intervalMs: interval }, 'Starting Linear poller');

  pollAndProcessDeveloper();
  pollAndProcessReviewer();

  setInterval(() => {
    pollAndProcessDeveloper();
    pollAndProcessReviewer();
  }, interval);
}

if (process.argv[1]?.includes('linear-poller')) {
  startPolling();
}
