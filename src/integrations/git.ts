import { execaSync } from 'execa';
import { CleanOptions, SimpleGit, simpleGit } from 'simple-git';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { getCurrentWorktreePath, getWorktreePath } from '../utils/worktree-context.js';

const log = createLogger('git');
const env = getEnv();

const gitInstances = new Map<string, SimpleGit>();

function getGitForPath(repoPath: string): SimpleGit {
  let instance = gitInstances.get(repoPath);
  if (!instance) {
    instance = simpleGit(repoPath);
    gitInstances.set(repoPath, instance);
  }
  return instance;
}

export function getGit(): SimpleGit {
  return getGitForPath(getCurrentWorktreePath());
}

export function getMainGit(): SimpleGit {
  return getGitForPath(env.PROJECT_PATH);
}

export async function hasChanges(): Promise<boolean> {
  const git = getGit();
  const status = await git.status();
  return !status.isClean();
}

export async function commitChanges(
  taskIdentifier: string,
  message: string
): Promise<string | null> {
  const git = getGit();

  if (!(await hasChanges())) {
    log.info({ taskIdentifier }, 'No changes to commit');
    return null;
  }

  await git.add('.');
  const commitMessage = `feat(${taskIdentifier}): ${message}`;
  const result = await git.commit(commitMessage);

  log.info({ commit: result.commit, message: commitMessage }, 'Changes committed');
  return result.commit;
}

export async function getBranchDiff(branchName: string): Promise<string> {
  const git = getMainGit();
  const diff = await git.diff([`${env.GIT_MAIN_BRANCH}..${branchName}`]);
  log.info({ branch: branchName, diffLength: diff.length }, 'Diff computed');
  return diff;
}

export async function getChangedFiles(branchName: string): Promise<string[]> {
  const git = getMainGit();

  const result = await git.diff(['--name-only', `${env.GIT_MAIN_BRANCH}..${branchName}`]);
  return result.trim().split('\n').filter(Boolean);
}

export function getWorktreeDiffSync(worktreePath: string): string {
  if (!existsSync(join(worktreePath, '.git'))) {
    return '';
  }

  try {
    const result = execaSync('git', ['diff', '--unified=3', 'HEAD'], {
      cwd: worktreePath,
      timeout: 5000,
      stdio: 'pipe',
    });

    return result.stdout.trim();
  } catch (error) {
    log.warn({ worktreePath, error }, 'Failed to compute worktree diff');
    return '';
  }
}

export async function createWorktree(branchName: string): Promise<string> {
  const mainGit = getMainGit();
  const worktreePath = getWorktreePath(branchName);

  await mainGit.checkout(env.GIT_MAIN_BRANCH);
  await mainGit.pull('origin', env.GIT_MAIN_BRANCH);

  const branchExists = await branchExistsLocal(mainGit, branchName);

  if (branchExists) {
    log.info({ branch: branchName }, 'Branch already exists, checking worktree');

    const worktreeExists = await worktreeExistsAt(mainGit, worktreePath);

    if (worktreeExists) {
      log.info({ branch: branchName, path: worktreePath }, 'Reusing existing worktree');
      return worktreePath;
    }

    await mainGit.raw(['worktree', 'add', worktreePath, branchName]);
    log.info({ branch: branchName, path: worktreePath }, 'Worktree added for existing branch');
    return worktreePath;
  }

  await mainGit.raw(['worktree', 'add', '-b', branchName, worktreePath, env.GIT_MAIN_BRANCH]);

  log.info({ branch: branchName, path: worktreePath }, 'Worktree created');
  return worktreePath;
}

async function branchExistsLocal(git: SimpleGit, branchName: string): Promise<boolean> {
  try {
    await git.revparse(['--verify', `refs/heads/${branchName}`]);
    return true;
  } catch (error) {
    // revparse fails when the branch doesn't exist — expected control flow
    log.debug({ branchName, error }, 'Branch does not exist (revparse failed)');
    return false;
  }
}

async function worktreeExistsAt(git: SimpleGit, worktreePath: string): Promise<boolean> {
  try {
    const list = await git.raw(['worktree', 'list']);
    return list.includes(worktreePath);
  } catch (error) {
    // worktree list may fail on freshly init'd repos — expected control flow
    log.debug({ worktreePath, error }, 'Could not list worktrees');
    return false;
  }
}

export async function mergeBranch(branchName: string): Promise<void> {
  const mainGit = getMainGit();
  const worktreePath = getWorktreePath(branchName);

  await mainGit.checkout(env.GIT_MAIN_BRANCH);
  await mainGit.merge(['--no-ff', branchName]);
  await mainGit.push('origin', env.GIT_MAIN_BRANCH);

  try {
    await mainGit.raw(['worktree', 'remove', worktreePath, '--force']);
    log.info({ path: worktreePath }, 'Worktree removed');
  } catch (error) {
    log.warn({ path: worktreePath, error }, 'Failed to remove worktree directory');
  }

  await mainGit.deleteLocalBranch(branchName);

  log.info({ branch: branchName }, 'Branch merged and worktree cleaned up');
}

export async function initGitRepo(repoPath: string): Promise<void> {
  const git = getGitForPath(repoPath);
  await git.init();
  await git.addConfig('user.name', env.GIT_AUTHOR_NAME);
  await git.addConfig('user.email', env.GIT_AUTHOR_EMAIL);
  log.info({ repoPath }, 'Git repo initialized');
}

export async function stageAllFiles(repoPath: string): Promise<void> {
  const git = getGitForPath(repoPath);
  await git.add('.');
  log.info({ repoPath }, 'All files staged');
}

export async function commitFiles(repoPath: string, message: string): Promise<void> {
  const git = getGitForPath(repoPath);
  await git.commit(message);
  log.info({ repoPath, message }, 'Files committed');
}

export async function resetHard(repoPath: string, ref = 'HEAD'): Promise<void> {
  const git = getGitForPath(repoPath);
  try {
    await git.reset(['--hard', ref]);
    log.info({ repoPath, ref }, 'Git hard reset completed');
  } catch (error) {
    log.warn({ repoPath, ref, error }, 'Git hard reset failed');
  }
}

export async function cleanForce(repoPath: string): Promise<void> {
  const git = getGitForPath(repoPath);
  try {
    await git.clean(CleanOptions.FORCE + CleanOptions.RECURSIVE);
    log.info({ repoPath }, 'Git force clean completed');
  } catch (error) {
    log.warn({ repoPath, error }, 'Git force clean failed');
  }
}

export async function applyPatch(repoPath: string, patchFilePath: string): Promise<void> {
  const git = getGitForPath(repoPath);
  await git.applyPatch(patchFilePath);
  log.info({ repoPath, patchFilePath }, 'Patch applied');
}
