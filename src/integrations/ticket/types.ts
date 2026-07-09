// ── Ticket System — Common Types & Interface ──────────────────────────

export interface CreateTaskInput {
  title: string;
  description: string;
  priority?: number; // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  labels?: string[];
  parentId?: string;
}

export interface Task {
  id: string;
  identifier: string; // e.g. "ENG-123" (Linear) or "owner/repo#42" (GitHub)
  title: string;
  comments: string[];
  description: string;
  status: string;
  branchName: string;
}

export interface StatusMap {
  todo: string;
  inProgress: string;
  review: string;
  done: string;
}

export interface TicketProvider {
  /** Create a new task in the "Todo" status */
  createTask(input: CreateTaskInput): Promise<Task>;

  /** Get the first task in the "Todo" status */
  getFirstTodoTask(): Promise<Task | null>;

  /** Get the first task in the "In Review" status */
  getFirstReviewTask(): Promise<Task | null>;

  /** Move a task to a different status */
  updateTaskStatus(taskId: string, status: string): Promise<void>;

  /** Add a comment to a task */
  addComment(taskId: string, body: string): Promise<void>;

  /** Build a web URL for a task by its identifier */
  getTaskUrl(identifier: string): string;
}
