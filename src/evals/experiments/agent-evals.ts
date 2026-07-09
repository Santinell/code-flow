import { fileURLToPath } from 'node:url';
import { runArchitectAgentEvals } from './agents/architect-evals';
import { runDeveloperAgentEvals, type EvalLanguage } from './agents/developer-evals';
import { runReviewerAgentEvals } from './agents/reviewer-evals';

const cliArgs = process.argv.slice(2);
const agentFlag = cliArgs.find((a) => a.startsWith('--agent='))?.split('=')[1] as
  | 'architect'
  | 'developer'
  | 'reviewer'
  | undefined;
const langFlag = cliArgs.find((a) => a.startsWith('--lang='))?.split('=')[1] as
  | EvalLanguage
  | undefined;
const isCI = cliArgs.includes('--ci');

const SUPPORTED_LANGS: EvalLanguage[] = ['node', 'python'];

async function main() {
  if (!agentFlag && !isCI) {
    console.error(
      'Usage: tsx agent-evals.ts --agent=architect|developer|reviewer [--lang=node|python] [--ci]'
    );
    process.exit(1);
  }
  if (langFlag && !SUPPORTED_LANGS.includes(langFlag)) {
    console.error(`Unsupported --lang=${langFlag}. Supported: ${SUPPORTED_LANGS.join(', ')}.`);
    process.exit(1);
  }
  const langs: EvalLanguage[] = langFlag ? [langFlag] : SUPPORTED_LANGS;

  const mode = agentFlag ?? 'ci';
  console.log(`Agent eval mode: ${mode}, langs: ${langs.join(', ')}`);

  switch (true) {
    case mode === 'developer' || isCI:
      for (const lang of langs) {
        await runDeveloperAgentEvals(lang);
      }
      break;
    case mode === 'reviewer' || isCI:
      for (const lang of langs) {
        await runReviewerAgentEvals(lang);
      }
      break;
    case mode === 'architect' || isCI:
      for (const lang of langs) {
        await runArchitectAgentEvals(lang);
      }
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
