import { RequestContext } from '@mastra/core/request-context';

export const EVAL_SANDBOX_PATH_CONTEXT_KEY = 'evalSandboxPath';

export function getEvalSandboxPath(requestContext?: RequestContext): string | undefined {
  const sandboxPath = requestContext?.get<string, string>(EVAL_SANDBOX_PATH_CONTEXT_KEY);
  return typeof sandboxPath === 'string' ? sandboxPath : undefined;
}

export function withEvalSandboxRequestContext<TItem extends object>(
  item: TItem,
  sandboxPath: string
): TItem & { requestContext: RequestContext } {
  const requestContext = new RequestContext();
  requestContext.set(EVAL_SANDBOX_PATH_CONTEXT_KEY, sandboxPath);

  return {
    ...item,
    requestContext,
  };
}
