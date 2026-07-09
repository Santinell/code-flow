import Database from 'better-sqlite3';
import path from 'node:path';
import { createLogger } from '#utils/logger';

const log = createLogger('db');

import fs from 'node:fs';

let db: Database.Database | null = null;

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'agent-dev.db');

export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  log.info({ path: DB_PATH }, 'SQLite database opened');
  return db;
}

// ── Schema Migration ───────────────────────────────────────────────

export function initSchema(): void {
  const db = getDb();

  db.exec(`
    -- Branch → Task mapping (cache, source of truth is Linear)
    CREATE TABLE IF NOT EXISTS task_branches (
      task_id        TEXT PRIMARY KEY,
      task_identifier TEXT NOT NULL,
      branch_name    TEXT NOT NULL,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Workflow run tracking (HITL resume + poll guard)
    CREATE TABLE IF NOT EXISTS user_workflows (
      run_id         TEXT PRIMARY KEY,
      user_id        INTEGER,
      thread_id      TEXT,
      task_id        TEXT,
      workflow_type  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_workflows_user ON user_workflows(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_workflows_task ON user_workflows(task_id);
    CREATE INDEX IF NOT EXISTS idx_user_workflows_type ON user_workflows(workflow_type);
  `);

  // Add workflow_type column to existing databases (safe to run repeatedly)
  try {
    db.exec('ALTER TABLE user_workflows ADD COLUMN workflow_type TEXT');
  } catch {
    // Column already exists — ignore
  }

  log.info('Database schema initialized');
}

// ── Branch Mapping ─────────────────────────────────────────────────

export function saveTaskBranch(taskId: string, taskIdentifier: string, branchName: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO task_branches (task_id, task_identifier, branch_name) VALUES (?, ?, ?)'
  ).run(taskId, taskIdentifier, branchName);
}

export function getTaskBranch(taskId: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT branch_name FROM task_branches WHERE task_id = ?').get(taskId) as
    | { branch_name: string }
    | undefined;
  return row?.branch_name ?? null;
}

export function getBranchByIdentifier(identifier: string): string | null {
  const db = getDb();
  const row = db
    .prepare<string, { branch_name: string }>(
      'SELECT branch_name FROM task_branches WHERE task_identifier = ?'
    )
    .get(identifier);
  return row?.branch_name ?? null;
}

// ── Workflow Run Tracking ──────────────────────────────────────────

export interface WorkflowRunData {
  userId?: number;
  threadId?: string;
  taskId?: string;
  workflowType?: string;
}

export function saveWorkflowRun(runId: string, data: WorkflowRunData): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_workflows (run_id, user_id, thread_id, task_id, workflow_type)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      user_id       = COALESCE(excluded.user_id, user_workflows.user_id),
      thread_id     = COALESCE(excluded.thread_id, user_workflows.thread_id),
      task_id       = COALESCE(excluded.task_id, user_workflows.task_id),
      workflow_type = COALESCE(excluded.workflow_type, user_workflows.workflow_type)
  `).run(
    runId,
    data.userId ?? null,
    data.threadId ?? null,
    data.taskId ?? null,
    data.workflowType ?? null
  );
}

export function countActiveRunsByType(workflowType: string): number {
  const db = getDb();
  const row = db
    .prepare<string, { count: number }>(
      'SELECT COUNT(*) AS count FROM user_workflows WHERE workflow_type = ?'
    )
    .get(workflowType);
  return row?.count ?? 0;
}

export function getActiveRunByUser(
  userId: number
): { runId: string; threadId: string | null } | null {
  const db = getDb();
  const row = db
    .prepare<number, { run_id: string; thread_id: string | null }>(
      'SELECT run_id, thread_id FROM user_workflows WHERE user_id = ? ORDER BY rowid DESC LIMIT 1'
    )
    .get(userId);
  return row ? { runId: row.run_id, threadId: row.thread_id } : null;
}

export function getActiveRunByTask(taskId: string): { runId: string } | null {
  const db = getDb();
  const row = db
    .prepare<string, { run_id: string }>(
      'SELECT run_id FROM user_workflows WHERE task_id = ? LIMIT 1'
    )
    .get(taskId);
  return row ? { runId: row.run_id } : null;
}

export function deleteWorkflowRun(runId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM user_workflows WHERE run_id = ?').run(runId);
}
