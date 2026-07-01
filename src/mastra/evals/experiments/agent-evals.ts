import { fileURLToPath } from 'node:url';
import { runArchitectAgentEvals } from './agents/architect-evals.js';
import { runDeveloperAgentEvals } from './agents/developer-evals.js';
import { runReviewerAgentEvals } from './agents/reviewer-evals.js';

const cliArgs = process.argv.slice(2);
const agentFlag = cliArgs.find((a) => a.startsWith('--agent='))?.split('=')[1];
const isCI = cliArgs.includes('--ci');

async function main() {
  if (!agentFlag && !isCI) {
    console.error('Usage: tsx agent-evals.ts --agent=architect|developer|reviewer [--ci]');
    process.exit(1);
  }

  const mode = agentFlag ?? 'ci';
  console.log(`Agent eval mode: ${mode}`);

  switch (true) {
    case mode === 'developer' || isCI:
      await runDeveloperAgentEvals();
      break;
    case mode === 'reviewer' || isCI:
      await runReviewerAgentEvals();
      break;
    case mode === 'architect' || isCI:
      await runArchitectAgentEvals();
      break;
    default:
      console.log(`${agentFlag} agent evals are not implemented yet.`);
      console.log('Supported agents: architect, developer, reviewer');
      process.exit(1);
  }

  process.exit(0);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
