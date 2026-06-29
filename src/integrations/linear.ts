import { LinearClient, PaginationOrderBy } from '@linear/sdk';
import { getEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const env = getEnv();
const log = createLogger('linear');
const client  = new LinearClient({ apiKey: env.LINEAR_API_KEY });
const projectId = await getProjectId();

/** Resolve project slug to UUID. Linear API requires UUID for project.id.eq filter. */
async function getProjectId(): Promise<string> {
  const project = await client.project(env.LINEAR_PROJECT_SLUG);
  if (!project) {
    throw new Error(`Project not found: ${env.LINEAR_PROJECT_SLUG}`);
  }
  log.info({ slug: env.LINEAR_PROJECT_SLUG, id: project.id }, 'Resolved project id');
  return project.id;
}

// ── Types ──────────────────────────────────────────────────────────
export interface CreateTaskInput {
  title: string;
  description: string;
  priority?: number; // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  labels?: string[];
  parentId?: string;
}

export interface LinearTask {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  comments?: string[];
  description: string;
  status: string;
  branchName: string | null; // Native Linear-generated branch name
}

// ── Operations ─────────────────────────────────────────────────────

export async function getTeam() {
  const team = await client.team(env.LINEAR_TEAM_KEY);
  if (!team) {
    throw new Error(`Team ${env.LINEAR_TEAM_KEY} not found`);
  }

  return team;
}

/** Create a new task in ToDo */
export async function createTask(input: CreateTaskInput): Promise<LinearTask> {
  const team = await getTeam();

  const states = await team.states();
  const todoState = states.nodes.find((s) => s.name === env.LINEAR_STATUS_TODO);
  if (!todoState) {
    throw new Error(`State "${env.LINEAR_STATUS_TODO}" not found in Linear workflow`);
  }

  const result = await client.createIssue({
    teamId: team.id,
    title: input.title,
    description: input.description,
    priority: input.priority ?? 3,
    projectId,
    stateId: todoState.id,
    parentId: input.parentId,
  });

  const issue = await result.issue;
  if (!issue) {
    throw new Error('Failed to create issue');
  }

  const state = await issue.state;
  log.info({ taskId: issue.identifier, title: input.title }, 'Task created in Linear');

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? '',
    status: state?.name ?? env.LINEAR_STATUS_TODO,
    branchName: issue.branchName ?? null,
  };
}

/** Get the first task in ToDo status */
export async function getFirstTodoTask(): Promise<LinearTask | null> {
  const issues = await client.issues({
    filter: {
      team: { key: { eq: env.LINEAR_TEAM_KEY } },
      state: { name: { eq: env.LINEAR_STATUS_TODO } },
      project: { id: { eq: projectId } },
    },
    first: 1,
    orderBy: PaginationOrderBy.CreatedAt,
  });

  const issue = issues.nodes[0];
  if (!issue) {
    return null;
  }

  const comments = await issue.comments({ last: 10 });

  const state = await issue.state;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    comments: comments.nodes.map((comment) => comment.body),
    description: issue.description ?? '',
    status: state?.name ?? env.LINEAR_STATUS_TODO,
    branchName: issue.branchName ?? null,
  };
}

/** Get the first task in Review status */
export async function getFirstReviewTask(): Promise<LinearTask | null> {
  const issues = await client.issues({
    filter: {
      team: { key: { eq: env.LINEAR_TEAM_KEY } },
      state: { name: { eq: env.LINEAR_STATUS_REVIEW } },
      project: { id: { eq: projectId } },
    },
    first: 1,
    orderBy: PaginationOrderBy.UpdatedAt,
  });

  const issue = issues.nodes[0];
  if (!issue) {
    return null;
  }

  const comments = await issue.comments({ last: 10 });

  const state = await issue.state;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    comments: comments.nodes.map((comment) => comment.body),
    description: issue.description ?? '',
    status: state?.name ?? env.LINEAR_STATUS_REVIEW,
    branchName: issue.branchName ?? null,
  };
}

/** Update task status */
export async function updateTaskStatus(taskId: string, status: string): Promise<void> {
  // Find the workflow state by name
  const team = await client.team(env.LINEAR_TEAM_KEY);
  if (!team) {
    throw new Error(`Team not found`);
  }

  const states = await team.states();
  const targetState = states.nodes.find((s) => s.name === status);
  if (!targetState) {
    throw new Error(`State "${status}" not found in Linear workflow`);
  }

  await client.updateIssue(taskId, { stateId: targetState.id });
  log.info({ taskId, status }, 'Task status updated');
}

/** Add a comment to a task */
export async function addComment(taskId: string, body: string): Promise<void> {  await client.createComment({ issueId: taskId, body });
  log.info({ taskId }, 'Comment added to task');
}
