# Code Flow

Automated agentic development system built on the [Mastra](https://mastra.ai) AI agent framework. Code Flow acts as an autonomous development team — Architect, Developer, and Reviewer — that turns user requirements into production code.

## How It Works

1. **User** sends a feature request via Telegram
2. **Architect Agent** analyzes the request, asks clarifying questions if needed, decomposes it into tasks, and creates them in Linear
3. **Developer Agent** picks up Todo tasks, creates an isolated git worktree, implements the changes, runs tests, commits, and moves the task to Review
4. **Reviewer Agent** reviews the diff for security, quality, error handling, testing, and performance — then either approves (merges the branch) or requests changes

## Agents

| Agent         | Role                                                               | Tools                                                                      |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **Architect** | Analyzes requirements, decomposes into actionable tasks            | `readFile`, `listDir`, `globSearch`                                        |
| **Developer** | Implements code in isolated worktrees, follows project conventions | `readFile`, `writeFile`, `deleteFile`, `moveFile`, `listDir`, `globSearch` |
| **Reviewer**  | Reviews diffs and makes approve/request_changes decisions          | `readFile`                                                                 |

## Key Capabilities

- **Human-in-the-Loop** — the Architect asks clarifying questions and shows task proposals for confirmation via Telegram inline buttons
- **Isolated Worktrees** — each Developer task runs in its own git worktree, ensuring isolation and parallel safety
- **Path Security** — all file-system operations are validated against path traversal, symlink attacks, and protected entry access
- **Tool Budgeting** — configurable step limits and per-tool usage budgets prevent runaway agent loops
- **Auto Test Detection** — automatically detects the package manager (`pnpm`, `npm`, `yarn`, `bun`, `make`) and runs the test suite
- **AGENTS.md Injection** — project-specific instructions from `AGENTS.md` are injected as system context for all agents
- **Multi-Provider LLM Support** — OpenAI, DeepSeek, Anthropic, and Ollama
- **Concurrency Control** — configurable limits for simultaneous Developer and Reviewer tasks
- **Comprehensive Eval System** — 60+ scorers across agents, workflow steps, and trajectories with CI integration

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Configure LLM providers
cp providers-example.json providers.json
# Edit providers.json with your provider API keys

# Start the system (Telegram bot + Linear polling)
pnpm start

# Or run individual triggers
pnpm trigger:architect   # Telegram/Architect only
pnpm trigger:poller      # Linear polling only (Developer + Reviewer)
```

## Environment Variables

See `.env.example` for the full list. Main key variables:

| Variable              | Description                         |
| --------------------- | ----------------------------------- |
| `TELEGRAM_BOT_TOKEN`  | Telegram bot token                  |
| `LINEAR_API_KEY`      | Linear API key                      |
| `LINEAR_TEAM_KEY`     | Linear team key for task creation   |
| `LINEAR_PROJECT_SLUG` | Linear project slug                 |
| `PROJECT_PATH`        | Path to target project              |
| `WORKTREE_PATH`       | Path to worktrees (should be empty) |

## Evaluation

```bash
pnpm eval:architect    # Architect agent evals only
pnpm eval:developer    # Developer agent evals only
pnpm eval:reviewer     # Reviewer agent evals only
pnpm eval:ci           # CI mode (threshold-based pass/fail)
```

## Tech Stack

TypeScript 6, Mastra, Linear SDK, Grammy (Telegram), simple-git, SQLite (better-sqlite3 + LibSQL), Zod, Pino, Vitest, oxlint/oxfmt

## License

MIT
