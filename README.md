# Code Flow

Automated agentic development system built on the [Mastra](https://mastra.ai) AI agent framework. Code Flow acts as an autonomous development team — Architect, Developer, and Reviewer — that turns user requirements into production code.

## How It Works

1. **User** sends a feature request via Telegram
2. **Architect Agent** analyzes the request, asks clarifying questions if needed, decomposes it into tasks, and creates them in Linear or GitHub
3. **Developer Agent** picks up Todo tasks, creates an isolated git worktree, implements the changes, runs tests, commits, and moves the task to Review
4. **Reviewer Agent** reviews the diff across security, quality, error handling, testing, and performance — then either approves (merges the branch) or requests changes

## Agents & Tools

File-system tools (read/write/delete/list/edit/mkdir/stat) are auto-injected from the [Mastra Workspace](https://mastra.ai/docs/workspace/overview) subsystem and resolve to the current git worktree per request. `globSearch` and `moveFile` remain custom tools (no workspace equivalent).

| Agent         | Role                                                               | Tools                                                                                                       |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Architect** | Analyzes requirements, decomposes into actionable tasks            | `readFile`, `listDir`, `globSearch`                                                                         |
| **Developer** | Implements code in isolated worktrees, follows project conventions | `readFile`, `writeFile`, `editFile`, `deleteFile`, `moveFile`, `listDir`, `globSearch`, `mkdir`, `fileStat` |
| **Reviewer**  | Reviews diffs and makes approve/request_changes decisions          | `readFile`                                                                                                  |

Installing dependencies and running tests are handled by deterministic workflow steps, not agent tools.

## Key Capabilities

- **Human-in-the-Loop** — the Architect asks clarifying questions and shows task proposals for confirmation via Telegram inline buttons
- **Isolated Git Worktrees** — each Developer task runs in its own git worktree, ensuring isolation and parallel safety
- **Multi-Stack Support** — works with Node, Python, Rust, Go, Java, C/C++, Ruby, PHP, Elixir, and Make projects (see [Supported Stacks](#supported-stacks)); extend with custom binaries via `ALLOWED_BINARIES`
- **Workspace Filesystem** — all file operations go through Mastra Workspace with path-traversal containment plus a protected-entry denylist (`.git`, `.env*`, `.ssh`, credentials)
- **Command Safety** — agent-derived install/test commands for unknown stacks are validated against an allowed-binary list and shell-metacharacter rejection before execution
- **Tool Budgeting** — a processor enforces per-tool call budgets and disables exploration tools after a write, preventing runaway agent loops
- **AGENTS.md Injection** — project-specific instructions from `AGENTS.md` are injected as system context for all agents
- **Multi-Provider LLM Support** — OpenAI, Anthropic, DeepSeek, Ollama, plus any OpenAI-compatible provider
- **Concurrency Control** — configurable limits for simultaneous Developer and Reviewer tasks
- **Comprehensive Eval System** — 25 scorers across agent, workflow-step, and trajectory registries with CI integration

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Configure LLM providers and ticket system
cp providers-example.json providers.json
# Edit providers.json — see Configuration below

# Start the system (Telegram bot + ticket polling)
pnpm start

# Or run individual triggers
pnpm trigger:architect   # Telegram / Architect only
pnpm trigger:poller      # Ticket polling only (Developer + Reviewer)
```

## Configuration

Two files: `.env` (runtime settings) and `providers.json` (LLM backends, agent→model mapping, ticket integration). See `.env.example` and `providers-example.json` for the full reference.

### providers.json

Four top-level sections:

#### "ai-providers" block

Defines LLM backends. Each entry: `{ mode, baseUrl, apiKey }`.

| Mode               | Backend   | Notes                                                                                            |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------ |
| `openai`           | OpenAI    | Also for any OpenAI-compatible provider (z-ai, OpenRouter, Together) — set `baseUrl` accordingly |
| `openai-responses` | OpenAI    | Uses the Responses API instead of Chat                                                           |
| `anthropic`        | Anthropic |                                                                                                  |
| `deepseek`         | DeepSeek  |                                                                                                  |
| `ollama`           | Ollama    | Local; no `apiKey` needed                                                                        |
| `embedding-openai` | OpenAI    | For embeddings (enable via `EMBEDDING_MEMORY`)                                                   |
| `embedding-ollama` | Ollama    | For embeddings                                                                                   |

#### "agents" block

Maps each agent to a provider + model, with optional `fallbacks` (a chain tried in order if the primary model fails). Configured agents:

- `architect`, `developer`, `reviewer` — the three production agents
- `judge` — the LLM model used by eval scorers for LLM-judged scoring
- `embedding` — embedding model, used when `EMBEDDING_MEMORY=true` (requires `dimensions`)

```json
"developer": {
  "provider": "z-ai",
  "model": "glm-5",
  "fallbacks": [{ "provider": "deepseek", "model": "deepseek-v4-flash" }]
}
```

> Any OpenAI-compatible provider (z-ai, OpenRouter, etc.) is configured with `"mode": "openai"` under `ai-providers` and a custom `baseUrl`.

#### "ticket-providers" block

Credentials for the task backends. Both can be configured; `ticket-system.provider` selects which one is active.

- **Linear**: `apiKey`, `teamKey`, `projectSlug`
- **GitHub**: `token`, `owner`, `repo`, `projectNumber`

#### "ticket-system" block

Selects the active provider and maps internal statuses to your project's status names.

```json
"ticket-system": {
  "provider": "linear",
  "statuses": {
    "todo": "Todo",
    "inProgress": "In Progress",
    "review": "In Review",
    "done": "Done"
  }
}
```

### .env

Key variables (full list in `.env.example`):

| Variable                              | Description                                                           |
| ------------------------------------- | --------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                  | Telegram bot token                                                    |
| `PROJECT_PATH`                        | Path to the target project (must be a git repo with commits + remote) |
| `WORKTREE_PATH`                       | Directory for isolated worktrees                                      |
| `GIT_MAIN_BRANCH`                     | Branch to branch from (default `main`)                                |
| `GIT_REMOTE`                          | Git remote name (default `origin`)                                    |
| `MAX_CONCURRENT_*`                    | Parallelism caps for developer/reviewer/architect evals               |
| `MAX_STEPS_*` / `MAX_OUTPUT_TOKENS_*` | Per-agent step and output-token budgets                               |
| `ALLOWED_BINARIES`                    | Extra binaries for agent-derived commands (see below). Optional       |
| `EMBEDDING_MEMORY`                    | Enable semantic recall memory via embeddings                          |
| `DB_PATH`                             | SQLite database path                                                  |

## Supported Stacks

Code Flow works with projects across these languages and ecosystems:

- **Node.js** — pnpm, npm, yarn, bun
- **Python** — uv, poetry, pdm, pip
- **Rust** — cargo
- **Go** — go
- **Java** — gradle, mvn
- **C/C++** — cmake, ninja
- **Ruby** — bundle/bundler
- **PHP** — composer
- **Elixir** — mix
- **Make** projects

The built-in allowlist covers the package managers, test runners, and build tools above.

If your project uses other tools, add them with `ALLOWED_BINARIES` (comma- or space-separated) without touching code:

```bash
ALLOWED_BINARIES=dvc,just,turbine
```

This only ever extends the built-ins — the entries above stay available regardless.

## Telegram Commands

| Command   | Action                                              |
| --------- | --------------------------------------------------- |
| `/start`  | Greet the Architect bot                             |
| `/new`    | Start a new requirements session with the Architect |
| `/cancel` | Reset the current session                           |
| `/stop`   | Reset the current session                           |

During a session, the Architect asks clarifying questions and presents task proposals as inline buttons for confirmation before creating tickets.

## Evaluation

```bash
pnpm eval:architect    # Architect agent evals (--lang=node|python)
pnpm eval:developer    # Developer agent evals (--lang=node|python)
pnpm eval:reviewer     # Reviewer agent evals (--lang=node|python)
pnpm eval:workflows    # Workflow-level evals
pnpm eval:ci           # CI mode (threshold-based pass/fail)
```

## Tech Stack

TypeScript 7, Mastra (core + Workspace + evals), Linear SDK, Grammy (Telegram), simple-git, SQLite (better-sqlite3 + LibSQL), Zod, Pino, Vitest, oxlint/oxfmt.

## License

MIT
