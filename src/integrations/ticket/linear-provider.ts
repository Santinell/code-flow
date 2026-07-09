import type { TicketProvider, CreateTaskInput, Task, StatusMap } from './types';
import { LinearClient, PaginationOrderBy } from '@linear/sdk';
import type { TicketProviderConfig } from '#config/providers';
import { createLogger } from '#utils/logger';

const log = createLogger('ticket-linear');

export interface LinearProviderConfig {
  apiKey: string;
  teamKey: string;
  projectSlug: string;
}

/**
 * Linear ticket provider.
 *
 * Validates config in the constructor and resolves remote IDs (project, team)
 * lazily and once, so the provider can be instantiated synchronously without
 * awaiting network calls.
 */
export class LinearProvider implements TicketProvider {
  private readonly client: LinearClient;
  private readonly config: LinearProviderConfig;
  private readonly statusToLinear: Record<string, string>;

  private projectId?: string;
  private teamId?: string;

  constructor(
    config: TicketProviderConfig,
    private readonly statuses: StatusMap
  ) {
    if (!('apiKey' in config)) {
      throw new Error(
        'Linear ticket provider requires "apiKey", "teamKey", "projectSlug" ' +
          'under ticket-providers.linear in providers.json'
      );
    }
    this.config = config;
    this.client = new LinearClient({ apiKey: config.apiKey });

    this.statusToLinear = {
      todo: statuses.todo,
      inProgress: statuses.inProgress,
      review: statuses.review,
      done: statuses.done,
    };
  }

  /** Resolve project slug → UUID once and cache it. */
  private async getProjectId(): Promise<string> {
    if (this.projectId) {
      return this.projectId;
    }
    const project = await this.client.project(this.config.projectSlug);
    if (!project) {
      throw new Error(`Linear project not found: ${this.config.projectSlug}`);
    }
    this.projectId = project.id;
    log.info({ slug: this.config.projectSlug, id: this.projectId }, 'Resolved project id');
    return this.projectId;
  }

  /** Resolve team key → UUID once and cache it. */
  private async getTeamId(): Promise<string> {
    if (this.teamId) {
      return this.teamId;
    }
    const team = await this.client.team(this.config.teamKey);
    if (!team) {
      throw new Error(`Linear team ${this.config.teamKey} not found`);
    }
    this.teamId = team.id;
    return this.teamId;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const [teamId, projectId] = await Promise.all([this.getTeamId(), this.getProjectId()]);

    const states = await this.client.workflowStates({
      filter: { team: { id: { eq: teamId } } },
    });
    const todoState = states.nodes.find((s) => s.name === this.statusToLinear.todo);
    if (!todoState) {
      throw new Error(`State "${this.statusToLinear.todo}" not found in Linear workflow`);
    }

    const result = await this.client.createIssue({
      teamId,
      title: input.title,
      description: input.description,
      priority: input.priority ?? 3,
      projectId,
      stateId: todoState.id,
      parentId: input.parentId,
    });

    const issue = await result.issue;
    if (!issue) {
      throw new Error('Failed to create Linear issue');
    }

    const state = await issue.state;
    const branchName = issue.branchName ?? `feature/${issue.identifier.toLowerCase()}`;

    log.info({ taskId: issue.identifier, title: input.title }, 'Task created');

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      comments: [],
      description: issue.description ?? '',
      status: state?.name ?? this.statusToLinear.todo,
      branchName,
    };
  }

  async getFirstTodoTask(): Promise<Task | null> {
    return this.getFirstTaskByStatus('todo', PaginationOrderBy.CreatedAt);
  }

  async getFirstReviewTask(): Promise<Task | null> {
    return this.getFirstTaskByStatus('review', PaginationOrderBy.UpdatedAt);
  }

  private async getFirstTaskByStatus(
    status: keyof StatusMap,
    orderBy: PaginationOrderBy
  ): Promise<Task | null> {
    const projectId = await this.getProjectId();
    const linearStatus = this.statusToLinear[status];

    const issues = await this.client.issues({
      filter: {
        team: { key: { eq: this.config.teamKey } },
        state: { name: { eq: linearStatus } },
        project: { id: { eq: projectId } },
      },
      first: 1,
      orderBy,
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
      comments: comments.nodes.map((c) => c.body),
      description: issue.description ?? '',
      status: state?.name ?? linearStatus,
      branchName: issue.branchName ?? `feature/${issue.identifier.toLowerCase()}`,
    };
  }

  async updateTaskStatus(taskId: string, status: string): Promise<void> {
    const linearStatus = this.statusToLinear[status] ?? status;
    const teamId = await this.getTeamId();

    const states = await this.client.workflowStates({
      filter: { team: { id: { eq: teamId } } },
    });
    const targetState = states.nodes.find((s) => s.name === linearStatus);
    if (!targetState) {
      throw new Error(`State "${linearStatus}" not found in Linear workflow`);
    }
    await this.client.updateIssue(taskId, { stateId: targetState.id });
    log.info({ taskId, status: linearStatus }, 'Task status updated');
  }

  async addComment(taskId: string, body: string): Promise<void> {
    await this.client.createComment({ issueId: taskId, body });
    log.info({ taskId }, 'Comment added to task');
  }

  getTaskUrl(identifier: string): string {
    // identifier is like "ENG-123". Linear supports a short URL form that
    // redirects to the full workspace-scoped issue page, so no workspace slug is needed.
    return `https://linear.app/issue/${identifier}`;
  }
}

/** Get team name for building Linear URLs (e.g. in Telegram messages) */
export async function getTeamName(config: LinearProviderConfig): Promise<string> {
  const client = new LinearClient({ apiKey: config.apiKey });
  const team = await client.team(config.teamKey);
  if (!team) {
    throw new Error(`Linear team ${config.teamKey} not found`);
  }
  return team.name.toLowerCase();
}
