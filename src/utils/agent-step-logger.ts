import type { LLMStepResult } from '@mastra/core/agent';
import { createLogger } from './logger';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
interface JsonObject {
  [key: string]: JsonValue;
}
interface JsonArray extends Array<JsonValue> {}

type StepFinishPayload = Pick<
  LLMStepResult,
  'text' | 'toolCalls' | 'toolResults' | 'finishReason' | 'usage'
>;

export function createAgentStepLogger(context: string) {
  const log = createLogger(context);

  let stepNumber = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  function logStepStart(taskIdentifier: string) {
    stepNumber = 0;
    totalInputTokens = 0;
    totalOutputTokens = 0;
    log.info({ taskIdentifier }, 'Agent generation started — sending prompt to model');
  }

  function logStepFinish(taskIdentifier: string, step: StepFinishPayload) {
    stepNumber++;

    const calls = step.toolCalls.map((tc) => ({
      tool: tc.payload.toolName,
      callId: tc.payload.toolCallId,
      args: summarizeToolArgs(tc.payload.toolName, tc.payload.args),
    }));

    const results = step.toolResults.map((tr) => ({
      tool: tr.payload.toolName,
      callId: tr.payload.toolCallId,
      output: summarizeToolResult(tr.payload.toolName, tr.payload.result as object),
    }));

    const { inputTokens = 0, outputTokens = 0 } = step.usage;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    log.info(
      {
        taskIdentifier,
        stepNumber,
        finishReason: step.finishReason,
        textLength: step.text?.length ?? 0,
        textPreview: step.text ? truncate(step.text, 200) : '',
        toolCallsCount: calls.length,
        toolCalls: calls,
        toolResults: results,
        tokens: { input: inputTokens, output: outputTokens },
      },
      `Agent step ${stepNumber} finished (${step.finishReason ?? 'unknown'})`
    );
  }

  function logStepComplete(taskIdentifier: string) {
    log.info(
      {
        taskIdentifier,
        totalSteps: stepNumber,
        totalTokens: { input: totalInputTokens, output: totalOutputTokens },
      },
      'Agent generation complete'
    );
  }

  return { logStepStart, logStepFinish, logStepComplete };
}

function summarizeToolArgs(toolName: string, args: object | undefined): JsonValue {
  if (args === undefined) {
    return null;
  }
  const a = args as Record<string, JsonValue>;
  if (toolName === 'writeFile') {
    return {
      path: a.path,
      contentLength: typeof a.content === 'string' ? a.content.length : 0,
      contentPreview: typeof a.content === 'string' ? truncate(a.content, 100) : '',
    };
  }
  if (toolName === 'runCommand') {
    return { command: a.command };
  }
  return a as JsonValue;
}

function summarizeToolResult(toolName: string, result: object | undefined): JsonValue {
  if (result === undefined || result === null) {
    return {};
  }
  const r = result as Record<string, JsonValue>;
  if (toolName === 'readFile') {
    return {
      path: r.path,
      contentLength: typeof r.content === 'string' ? r.content.length : 0,
    };
  }
  if (toolName === 'writeFile') {
    return { success: r.success, path: r.path };
  }
  if (toolName === 'runCommand') {
    return {
      exitCode: r.exitCode,
      stdoutLength: typeof r.stdout === 'string' ? r.stdout.length : 0,
      stderrLength: typeof r.stderr === 'string' ? r.stderr.length : 0,
    };
  }
  return r as JsonValue;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return str.slice(0, maxLen) + '…';
}
