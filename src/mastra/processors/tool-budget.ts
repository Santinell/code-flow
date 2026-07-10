import type {
  ProcessInputArgs,
  ProcessInputResult,
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from '@mastra/core/processors';
import fs from 'node:fs';
import path from 'node:path';
import type { JsonObject, JsonValue } from '#mastra/types';
import { getCurrentWorktreePath } from '#utils/worktree-context';

type ToolBudgetOptions = {
  maxSteps: number;
  toolBudgets?: Record<string, number>;
  disableAfterWrite?: string[];
  writeTools?: string[];
};

export class ToolBudgetProcessor implements Processor {
  readonly id = 'tool-budget-processor';

  private readonly maxSteps: number;
  private readonly toolBudgets: Record<string, number>;
  private readonly disableAfterWrite: string[];
  private readonly writeTools: string[];

  constructor(options: ToolBudgetOptions) {
    this.maxSteps = options.maxSteps;
    this.toolBudgets = options.toolBudgets ?? {};
    this.disableAfterWrite = options.disableAfterWrite ?? [];
    this.writeTools = options.writeTools ?? ['writeFile', 'deleteFile', 'moveFile'];
  }

  processInput({ messages, systemMessages, state }: ProcessInputArgs): ProcessInputResult {
    state.hasExplicitExistingPath = this.hasExplicitExistingPath(messages);
    return { messages, systemMessages };
  }

  async processInputStep({
    stepNumber,
    sendSignal,
    messages,
    messageList,
    state,
    steps,
    tools,
    activeTools,
  }: ProcessInputStepArgs): Promise<ProcessInputStepResult | undefined> {
    const isFinalStep = stepNumber >= this.maxSteps - 1;
    const usedTools = this.countToolCalls(steps);
    const hasWritten = this.writeTools.some((toolName) => (usedTools[toolName] ?? 0) > 0);
    const hasExplicitExistingPath =
      state.hasExplicitExistingPath === true ||
      this.hasExplicitExistingPath(messages) ||
      this.hasExplicitExistingPathText(messageList.getLatestUserContent() ?? '');
    const availableTools = this.getAvailableTools(
      tools as Record<string, JsonValue> | undefined,
      activeTools
    );
    const allowedTools = isFinalStep
      ? []
      : availableTools.filter((toolName) =>
          this.isToolAllowed(toolName, usedTools, hasWritten, hasExplicitExistingPath)
        );

    if (isFinalStep || allowedTools.length === 0) {
      await sendSignal?.({
        type: 'reactive',
        contents:
          `This is your final step (step ${stepNumber + 1} of ${this.maxSteps}). ` +
          'Do not call any more tools. Provide the final implementation summary now.',
        attributes: { reason: 'final-step', step: stepNumber + 1 },
      });

      return {
        activeTools: [],
        tools: {},
        toolChoice: 'none',
      };
    }

    if (allowedTools.length !== availableTools.length) {
      return {
        activeTools: allowedTools,
        tools: this.pickTools(tools as Record<string, JsonValue> | undefined, allowedTools),
      };
    }

    return undefined;
  }

  private isToolAllowed(
    toolName: string,
    usedTools: Record<string, number>,
    hasWritten: boolean,
    hasExplicitExistingPath: boolean
  ): boolean {
    if (hasExplicitExistingPath && (toolName === 'listDir' || toolName === 'globSearch')) {
      return false;
    }

    if (hasWritten && this.disableAfterWrite.includes(toolName)) {
      return false;
    }

    const budget = this.toolBudgets[toolName];
    if (budget === undefined) {
      return true;
    }

    return (usedTools[toolName] ?? 0) < budget;
  }

  private getAvailableTools(tools?: Record<string, JsonValue>, activeTools?: string[]): string[] {
    const toolNames = Object.keys(tools ?? {});
    if (!activeTools?.length) {
      return toolNames;
    }

    return toolNames.filter((toolName) => activeTools.includes(toolName));
  }

  private pickTools(
    tools: Record<string, JsonValue> | undefined,
    allowedTools: string[]
  ): Record<string, JsonValue> {
    if (!tools) {
      return {};
    }

    const allowedToolSet = new Set(allowedTools);
    return Object.fromEntries(
      Object.entries(tools).filter(([toolName]) => allowedToolSet.has(toolName))
    );
  }

  private countToolCalls(steps: ProcessInputStepArgs['steps']): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const step of steps) {
      for (const toolCall of step.toolCalls ?? []) {
        const toolName = String(toolCall.toolName ?? '');
        if (!toolName) {
          continue;
        }
        counts[toolName] = (counts[toolName] ?? 0) + 1;
      }
    }

    return counts;
  }

  private hasExplicitExistingPath(messages: ProcessInputStepArgs['messages']): boolean {
    const promptText = messages
      .map((message) => {
        const textPart = message.content?.content ?? '';
        return this.stringifyContent(textPart);
      })
      .join('\n');
    return this.hasExplicitExistingPathText(promptText);
  }

  private hasExplicitExistingPathText(promptText: string): boolean {
    const projectRoot = getCurrentWorktreePath();
    const pathPattern = new RegExp(
      '(?:^|[`\\s"\'(])((?:[\\w.-]+/)+[\\w.-]+|[A-Z0-9_.-]+\\.md)(?=$|[`\\s"\',).])',
      'gim'
    );

    for (const match of promptText.matchAll(pathPattern)) {
      const candidate = match[1];
      if (!candidate || path.isAbsolute(candidate)) {
        continue;
      }

      const resolvedPath = path.resolve(projectRoot, candidate);
      const relativePath = path.relative(projectRoot, resolvedPath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        continue;
      }

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        return true;
      }
    }

    return false;
  }

  private stringifyContent(content: JsonValue | string): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as JsonObject).text);
          }
          return '';
        })
        .join('\n');
    }

    return '';
  }
}
