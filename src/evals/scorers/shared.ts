import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { MastraScorer, ScorerRunOutputForAgent } from '@mastra/core/evals';
import {
  getAssistantMessageFromRunOutput,
  ScorerRunOutputForLLMJudge,
} from '@mastra/evals/scorers/utils';
import { getWorktreeDiffSync } from '#integrations/git';
import { getModel } from '#mastra/model';
import { getCurrentWorktreePath } from '#utils/worktree-context';

export const judgeModel: LanguageModelV3 = getModel('judge');

export const judgeConfig: {
  model: LanguageModelV3;
  instructions: string;
  jsonPromptInjection: boolean;
} = {
  model: judgeModel,
  instructions:
    'You are an expert evaluator for an AI-powered development pipeline. Assess the quality of agent outputs based on the provided criteria.',
  jsonPromptInjection: true,
};

/**
 * Sets jsonPromptInjection on a scorer's judge config via the public getter.
 * Pre-built scorers from @mastra/evals don't expose this option in their factory API,
 * but MastraScorer.judge returns ScorerJudgeConfig which includes jsonPromptInjection.
 */
export function enableJsonPromptInjection(scorer: MastraScorer): MastraScorer {
  const judge = scorer.judge;
  if (judge) {
    judge.jsonPromptInjection = true;
  }
  return scorer;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
interface JsonObject {
  [key: string]: JsonValue;
}
interface JsonArray extends Array<JsonValue> {}

export function getOutputText(
  output: ScorerRunOutputForAgent | ScorerRunOutputForLLMJudge
): string {
  if (typeof output === 'string') {
    return output;
  }
  if (output && typeof output === 'object' && 'object' in output) {
    return JSON.stringify((output as { object: JsonValue }).object);
  }

  return getAssistantMessageFromRunOutput(output) ?? JSON.stringify(output ?? '');
}

/**
 * Builds a human-readable context array from tool invocations.
 * Each entry is a single string like:
 *   [writeFile] src/utils/math.ts:
 *   export function add...
 *
 * For writeFile/file-write tools, includes the full file content from args.
 * For other tools, includes the result.
 */
export function getToolResultContexts(
  output: ScorerRunOutputForAgent | ScorerRunOutputForLLMJudge
): string[] {
  const ctx: string[] = [];
  const toolCalls = extractToolCallsWithArgs(output);

  for (const tc of toolCalls) {
    const label = formatToolCallContext(tc);
    if (label) {
      ctx.push(label);
    }
  }

  // Append git diff if sandbox has a git repo (shows net effect of all writes)
  const worktreePath = getCurrentWorktreePath();
  const diff = getWorktreeDiffSync(worktreePath);
  if (diff) {
    ctx.push('=== GIT DIFF (net changes made by agent) ===\n' + diff);
  }

  return ctx;
}

function formatToolCallContext(tc: ToolCallEntry): string | null {
  const path = tc.args?.path as string | undefined;

  if (tc.toolName === 'writeFile' || tc.toolName === 'file-write') {
    const content = tc.args?.content as string | undefined;
    return `[writeFile] ${path}:\n${content ?? ''}`;
  }

  if (tc.toolName === 'readFile' || tc.toolName === 'file-read') {
    const result =
      tc.result && typeof tc.result === 'object'
        ? (tc.result as Record<string, JsonValue>)
        : undefined;
    if (!result) {
      return null;
    }

    const error = result.error as string | undefined;
    if (error) {
      return `[readFile] ${path} — ERROR: ${error}`;
    }

    const content = result.content as string | undefined;
    return content != null ? `[readFile] ${path} reads:\n${content}` : null;
  }

  if (tc.toolName === 'listDir' || tc.toolName === 'list-dir') {
    const entries =
      tc.result && typeof tc.result === 'object'
        ? ((tc.result as Record<string, JsonValue>).entries as string[] | undefined)
        : undefined;
    return entries ? `[listDir] ${path} -> ${entries.join(', ')}` : null;
  }

  if (tc.toolName === 'globSearch' || tc.toolName === 'glob-search') {
    const files =
      tc.result && typeof tc.result === 'object'
        ? ((tc.result as Record<string, JsonValue>).files as string[] | undefined)
        : undefined;
    const pattern = tc.args?.pattern as string | undefined;
    return files ? `[globSearch] ${pattern ?? ''} -> ${files.join(', ') || '(none)'}` : null;
  }

  if (tc.toolName === 'deleteFile' || tc.toolName === 'file-delete') {
    return `[deleteFile] ${path}`;
  }

  if (tc.toolName === 'moveFile' || tc.toolName === 'file-move') {
    const dst = tc.args?.destinationPath as string | undefined;
    return `[moveFile] ${path} -> ${dst}`;
  }

  return `[${tc.toolName}] ${JSON.stringify(tc.result)}`;
}

interface ToolCallEntry {
  toolName: string;
  args?: Record<string, JsonValue>;
  result?: JsonValue;
}

function extractToolCallsWithArgs(
  node: ScorerRunOutputForAgent | ScorerRunOutputForLLMJudge
): ToolCallEntry[] {
  const results: ToolCallEntry[] = [];
  const visited = new WeakSet<object>();

  const visit = (n: ScorerRunOutputForAgent | ScorerRunOutputForLLMJudge | JsonValue): void => {
    if (!n || typeof n !== 'object' || visited.has(n as object)) {
      return;
    }
    visited.add(n as object);

    if (Array.isArray(n)) {
      n.forEach((item) => visit(item as JsonValue));
      return;
    }

    const obj = n as Record<string, JsonValue>;

    if (typeof obj.toolName === 'string') {
      results.push({
        toolName: obj.toolName as string,
        args: obj.args as Record<string, JsonValue> | undefined,
        result: obj.result as JsonValue,
      });
    }

    Object.values(obj).forEach((item) => visit(item as JsonValue));
  };

  visit(node);
  return results;
}

export function collectToolNames(
  value: ScorerRunOutputForAgent | ScorerRunOutputForLLMJudge
): string[] {
  const names = new Set<string>();

  const visit = (node: ScorerRunOutputForAgent | ScorerRunOutputForLLMJudge | JsonValue): void => {
    if (!node || typeof node !== 'object') {
      return;
    }

    if ('toolName' in node && typeof (node as { toolName?: JsonValue }).toolName === 'string') {
      names.add((node as { toolName: string }).toolName);
    }

    if (Array.isArray(node)) {
      node.forEach((item) => visit(item as JsonValue));
      return;
    }

    Object.values(node as Record<string, JsonValue>).forEach((item) => visit(item as JsonValue));
  };

  visit(value);
  return [...names];
}
