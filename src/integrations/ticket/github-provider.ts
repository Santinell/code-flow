import type { TicketProvider, CreateTaskInput, Task, StatusMap } from './types';
import type { TicketProviderConfig } from '#config/providers';
import { createLogger } from '#utils/logger';

const log = createLogger('ticket-github');

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

export interface GitHubProviderConfig {
  token: string;
  owner: string;
  repo: string;
  projectNumber: number;
}

interface GitHubSetup {
  repoId: string;
  projectId: string;
  statusFieldId: string;
  /** Internal status name → GitHub SingleSelect option ID */
  statusOptionIds: Record<string, string>;
}

// ── GraphQL helper ────────────────────────────────────────────────────

async function graphqlRequest<T>(
  token: string,
  query: string,
  variables: Record<string, string | number | boolean | null>
): Promise<T> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GraphQL error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL: ${json.errors.map((e) => e.message).join(', ')}`);
  }
  return json.data;
}

// ── GraphQL documents ─────────────────────────────────────────────────

const SETUP_QUERY = `
query Setup($owner: String!, $repo: String!, $projectNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    id
  }
  userOrOrg: repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $projectNumber) {
        id
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            options { id, name }
          }
        }
      }
    }
  }
}
`;

const CREATE_ISSUE_MUTATION = `
mutation CreateIssue($repoId: ID!, $title: String!, $body: String) {
  createIssue(input: { repositoryId: $repoId, title: $title, body: $body }) {
    issue { id, number, title, body }
  }
}
`;

const ADD_TO_PROJECT_MUTATION = `
mutation AddToProject($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item { id }
  }
}
`;

const UPDATE_STATUS_MUTATION = `
mutation UpdateStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId,
      itemId: $itemId,
      fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }
  ) {
    projectV2Item { id }
  }
}
`;

const QUERY_ITEMS_BY_STATUS = `
query ItemsByStatus($projectId: ID!, $optionId: String!, $first: Int!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: $first, filter: { singleSelectOptionId: { eq: $optionId } }) {
        nodes {
          id
          content {
            ... on Issue { id, number, title, body }
          }
        }
      }
    }
  }
}
`;

const FIND_ISSUE_ID_QUERY = `
query FindIssueId($projectId: ID!, $itemId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 1, filter: { id: { eq: $itemId } }) {
        nodes {
          content {
            ... on Issue { id }
          }
        }
      }
    }
  }
}
`;

const ADD_COMMENT_MUTATION = `
mutation AddComment($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) {
    comment { id }
  }
}
`;

const LIST_COMMENTS_QUERY = `
query IssueComments($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      comments(first: 10, orderBy: { direction: DESC, field: CREATED_AT }) {
        nodes { body }
      }
    }
  }
}
`;

// ── Provider ──────────────────────────────────────────────────────────

/**
 * GitHub Projects (v2) ticket provider.
 *
 * Validates config in the constructor and resolves remote IDs / status option
 * IDs lazily and once, so the provider can be instantiated synchronously
 * without awaiting network calls.
 */
export class GitHubProvider implements TicketProvider {
  private readonly config: GitHubProviderConfig;
  private readonly statuses: StatusMap;

  private setupPromise?: Promise<GitHubSetup>;

  constructor(config: TicketProviderConfig, statuses: StatusMap) {
    if (!('token' in config)) {
      throw new Error(
        'GitHub ticket provider requires "token", "owner", "repo", "projectNumber" ' +
          'under ticket-providers.github in providers.json'
      );
    }
    this.config = config;
    this.statuses = statuses;
  }

  /** Resolve repo/project/status-field IDs once and cache the promise. */
  private getSetup(): Promise<GitHubSetup> {
    if (!this.setupPromise) {
      this.setupPromise = this.resolveSetup();
    }
    return this.setupPromise;
  }

  private async resolveSetup(): Promise<GitHubSetup> {
    const { token, owner, repo, projectNumber } = this.config;

    const data = await graphqlRequest<{
      repository: { id: string };
      userOrOrg: {
        projectV2: {
          id: string;
          field: { id: string; options: Array<{ id: string; name: string }> } | null;
        } | null;
      };
    }>(token, SETUP_QUERY, { owner, repo, projectNumber });

    if (!data.repository?.id) {
      throw new Error(`GitHub repository not found: ${owner}/${repo}`);
    }

    const project = data.userOrOrg?.projectV2;
    if (!project?.id) {
      throw new Error(`GitHub project #${projectNumber} not found for ${owner}`);
    }

    if (!project.field?.id) {
      throw new Error(
        `GitHub project #${projectNumber} has no "Status" field (SingleSelect). ` +
          `Make sure the project has a Status field configured.`
      );
    }

    // Build status option ID map
    const optionMap: Record<string, string> = {};
    for (const opt of project.field.options) {
      optionMap[opt.name] = opt.id;
    }

    const statusOptionIds: Record<string, string> = {};
    for (const [internal, external] of Object.entries(this.statuses)) {
      const optionId = optionMap[external];
      if (!optionId) {
        throw new Error(
          `GitHub Status field has no option "${external}" (needed for internal status "${internal}"). ` +
            `Available options: ${Object.keys(optionMap).join(', ')}`
        );
      }
      statusOptionIds[internal] = optionId;
    }

    log.info(
      {
        repo: `${owner}/${repo}`,
        projectId: project.id,
        statusFieldId: project.field.id,
        statuses: Object.keys(statusOptionIds),
      },
      'GitHub project setup resolved'
    );

    return {
      repoId: data.repository.id,
      projectId: project.id,
      statusFieldId: project.field.id,
      statusOptionIds,
    };
  }

  private graphql<T>(
    query: string,
    variables: Record<string, string | number | boolean | null>
  ): Promise<T> {
    return graphqlRequest<T>(this.config.token, query, variables);
  }

  private identifier(number: number): string {
    return `${this.config.owner}/${this.config.repo}#${number}`;
  }

  private branchName(title: string, number: number): string {
    return `feature/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${number}`;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const setup = await this.getSetup();

    // Step 1: Create issue in repo
    const createResult = await this.graphql<{
      createIssue: { issue: { id: string; number: number; title: string; body: string | null } };
    }>(CREATE_ISSUE_MUTATION, {
      repoId: setup.repoId,
      title: input.title,
      body: input.description,
    });

    const issue = createResult.createIssue.issue;
    const issueId = issue.id;
    const issueNumber = issue.number;

    // Step 2: Add to project
    const addToProjectResult = await this.graphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(ADD_TO_PROJECT_MUTATION, {
      projectId: setup.projectId,
      contentId: issueId,
    });

    const itemId = addToProjectResult.addProjectV2ItemById.item.id;

    // Step 3: Set status = Todo
    await this.graphql(UPDATE_STATUS_MUTATION, {
      projectId: setup.projectId,
      itemId,
      fieldId: setup.statusFieldId,
      optionId: setup.statusOptionIds.todo,
    });

    log.info({ taskId: issueId, number: issueNumber, title: input.title }, 'Task created');

    return {
      id: itemId, // project item ID for status updates
      identifier: this.identifier(issueNumber),
      title: issue.title,
      comments: [],
      description: issue.body ?? '',
      status: this.statuses.todo,
      branchName: this.branchName(issue.title, issue.number),
    };
  }

  async getFirstTodoTask(): Promise<Task | null> {
    return this.getFirstTaskByStatus('todo');
  }

  async getFirstReviewTask(): Promise<Task | null> {
    return this.getFirstTaskByStatus('review');
  }

  private async getFirstTaskByStatus(status: keyof StatusMap): Promise<Task | null> {
    const setup = await this.getSetup();

    const data = await this.graphql<{
      node: {
        items: {
          nodes: Array<{
            id: string;
            content: { id: string; number: number; title: string; body: string | null } | null;
          }>;
        };
      };
    }>(QUERY_ITEMS_BY_STATUS, {
      projectId: setup.projectId,
      optionId: setup.statusOptionIds[status],
      first: 1,
    });

    const item = data.node.items.nodes[0];
    if (!item?.content) {
      return null;
    }

    const issue = item.content;
    const comments = await this.fetchComments(issue.number);

    return {
      id: item.id,
      identifier: this.identifier(issue.number),
      title: issue.title,
      comments,
      description: issue.body ?? '',
      status: this.statuses[status],
      branchName: this.branchName(issue.title, issue.number),
    };
  }

  async updateTaskStatus(taskId: string, status: string): Promise<void> {
    const setup = await this.getSetup();
    const optionId = setup.statusOptionIds[status];
    if (!optionId) {
      throw new Error(`Unknown status "${status}" for GitHub provider`);
    }

    await this.graphql(UPDATE_STATUS_MUTATION, {
      projectId: setup.projectId,
      itemId: taskId,
      fieldId: setup.statusFieldId,
      optionId,
    });

    log.info({ taskId, status }, 'Task status updated');
  }

  async addComment(taskId: string, body: string): Promise<void> {
    // taskId for GitHub is the project item ID, but comments need the issue node ID
    const setup = await this.getSetup();
    const data = await this.graphql<{
      node: {
        items: {
          nodes: Array<{ content: { id: string } | null }>;
        };
      };
    }>(FIND_ISSUE_ID_QUERY, { projectId: setup.projectId, itemId: taskId });

    const item = data.node.items.nodes[0];
    if (!item?.content?.id) {
      throw new Error(`Could not resolve issue ID for project item ${taskId}`);
    }

    await this.graphql(ADD_COMMENT_MUTATION, {
      subjectId: item.content.id,
      body,
    });

    log.info({ taskId }, 'Comment added to task');
  }

  getTaskUrl(identifier: string): string {
    // identifier is "owner/repo#42" → https://github.com/owner/repo/issues/42
    const match = identifier.match(/^(.+\/.+)#(\d+)$/);
    if (match) {
      return `https://github.com/${match[1]}/issues/${match[2]}`;
    }
    return identifier;
  }

  private async fetchComments(issueNumber: number): Promise<string[]> {
    try {
      const data = await this.graphql<{
        repository: { issue: { comments: { nodes: Array<{ body: string }> } } };
      }>(LIST_COMMENTS_QUERY, {
        owner: this.config.owner,
        repo: this.config.repo,
        number: issueNumber,
      });
      return data.repository.issue.comments.nodes.map((c) => c.body);
    } catch (error) {
      log.warn({ issueNumber, error }, 'Failed to fetch comments');
      return [];
    }
  }
}
