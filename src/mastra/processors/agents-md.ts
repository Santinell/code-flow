import type { ProcessInputArgs, ProcessInputResult } from '@mastra/core/processors';
import fs from 'node:fs';
import path from 'node:path';
import { getCurrentWorktreePath } from '../../utils/worktree-context.js';

const cachedContentByPath = new Map<string, string | null>();

function loadAgentsMd(): string | null {
  const projectRoot = getCurrentWorktreePath();
  if (cachedContentByPath.has(projectRoot)) {
    return cachedContentByPath.get(projectRoot)!;
  }
  try {
    const agentsMdPath = path.resolve(projectRoot, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) {
      cachedContentByPath.set(projectRoot, null);
      return null;
    }
    const content = fs.readFileSync(agentsMdPath, 'utf-8');
    cachedContentByPath.set(projectRoot, content);
    return content;
  } catch {
    cachedContentByPath.set(projectRoot, null);
    return null;
  }
}

export const agentsMdProcessor = {
  id: 'agents-md-injector' as const,
  processInput(args: ProcessInputArgs): ProcessInputResult {
    const content = loadAgentsMd();
    if (!content) {
      return { messages: args.messages, systemMessages: args.systemMessages };
    }
    return {
      messages: args.messages,
      systemMessages: [
        ...args.systemMessages,
        {
          role: 'system' as const,
          content: `## Project AGENTS.md\n\nThe following conventions must be followed:\n\n${content}`,
        },
      ],
    };
  },
};
