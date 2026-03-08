<div align="center">

<img src="assets/banner.svg" alt="Issue2Claude" width="100%">

<br><br>

**Label a GitHub Issue. Get a Pull Request.**

Claude Code reads your issue, analyzes your codebase, implements the fix, and opens a PR — fully autonomous.

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-Issue2Claude-blue?logo=github)](https://github.com/marketplace/actions/issue2claude)
[![npm](https://img.shields.io/npm/v/issue2claude?color=red&logo=npm)](https://www.npmjs.com/package/issue2claude)
[![Claude Code](https://img.shields.io/badge/Powered_by-Claude_Code-cc785c?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<br>

[Quick Start](#-quick-start) · [Features](#-features) · [Configuration](#-configuration) · [How It Works](#-how-it-works) · [Workflow Examples](#-workflow-examples)

</div>

<br>

## Setup

### Option A: One command

```bash
npx issue2claude
```

The setup wizard creates your workflow file, config, and tells you which secrets to add.

### Option B: GitHub Marketplace

1. Go to the [Issue2Claude Marketplace page](https://github.com/marketplace/actions/issue2claude)
2. Click **"Use latest version"**
3. Add your secret (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`)
4. Enable PR creation: **Settings > Actions > General > Allow GitHub Actions to create pull requests**

### Option C: Manual

<details>
<summary>Click to expand</summary>

1. Create `.github/workflows/issue2claude.yml` — see [Workflow Examples](#-workflow-examples)
2. Add your auth secret to the repo
3. Enable **"Allow GitHub Actions to create and approve pull requests"** in Settings > Actions > General
4. Create an issue, add the `claude-ready` label

</details>

<br>

> **After setup:** Write an issue, add the `claude-ready` label, and watch the magic happen.

---

## Features

<table>
<tr>
<td width="50%">

### Issue → PR
Label any issue with `claude-ready`. Claude analyzes the codebase, implements the solution, auto-reviews it, and opens a PR with a summary.

**Retry:** Comment `claude-retry` on the issue to re-run.

</td>
<td width="50%">

### PR Feedback Loop
Comment `claude-fix` on a PR. Claude reads your review comments and applies the changes — then pushes to the same branch.

```
You:    "Move this to a utils file"
        "Add error handling here"
        → claude-fix
Claude: applies changes, pushes
```

Repeat until it's perfect.

</td>
</tr>
<tr>
<td>

### Auto-Review
Every PR gets a second Claude pass before creation. It reviews for bugs, security issues, and edge cases. Finds problems → fixes them → then creates the PR.

</td>
<td>

### Auto-Rebase
Comment `claude-rebase` on a PR with merge conflicts. Claude rebases the branch, resolves conflicts intelligently, and pushes. No manual conflict resolution needed.

</td>
</tr>
<tr>
<td>

### Slash Commands

| Command | What it does |
|---------|-------------|
| `/claude estimate` | Effort estimate + affected files |
| `/claude explain` | Explains the relevant code |
| `/claude test` | Writes tests (creates PR) |
| `/claude refactor` | Refactors code (creates PR) |

</td>
<td>

### PR Chain (Dependencies)
Issues can declare dependencies:

```markdown
depends-on: #12
```

Issue2Claude waits until `#12` is resolved. If `#12` has an open PR, the new branch stacks on top of it.

Also supports: `depends on #12, #13`, `after #12`, `blocked-by: #15`

</td>
</tr>
</table>

### Smart Features

<table>
<tr>
<td width="33%">

#### Smart Model Selection
Auto-detects issue complexity and picks the right model:

| Complexity | Model |
|-----------|-------|
| Simple (typo, config) | Sonnet — fast & cheap |
| Complex (feature, refactor) | Opus — best quality |

</td>
<td width="33%">

#### Repo Context Index
Uses **OpenAI Embeddings** to build a semantic index of your codebase. When an issue comes in, the most relevant code chunks are found via cosine similarity and injected into Claude's prompt.

> Embeddings = **smart file finder**, not the whole repo. Claude uses them as a starting point to navigate further.

</td>
<td width="34%">

#### Context Learning
After every successful PR, Claude extracts patterns and saves them to `.issue2claude-context.md`. Over time it learns:

- *"Components use .tsx in src/components/"*
- *"Tests use Vitest with describe/it"*
- *"API routes in src/app/api/"*

</td>
</tr>
</table>

### Live Progress

Real-time status updates in the issue comment while Claude works — current phase, files touched, activity log, elapsed time.

---

## How It Works

```
  You write an issue        GitHub Actions          Claude Code             Pull Request
  ┌─────────────────┐      ┌──────────────┐      ┌──────────────────┐     ┌──────────────┐
  │ Add label        │─────▸│ Triggers     │─────▸│ Reads codebase   │────▸│ PR created   │
  │ "claude-ready"   │      │ workflow     │      │ Finds relevant   │     │ with summary │
  │                  │      │              │      │ files (embeddings)│     │ auto-reviewed│
  └─────────────────┘      └──────────────┘      │ Implements fix   │     └──────────────┘
                                                  │ Runs tests       │
                                                  │ Self-reviews     │
                                                  └──────────────────┘
```

1. **You** write a GitHub Issue describing the task
2. **You** add the `claude-ready` label
3. **Claude** uses the repo index to find relevant code, reads files, implements the solution
4. **Claude** self-reviews the changes (auto-review) and fixes any issues
5. **A PR** appears with the solution and a summary of what changed
6. **You** review and merge

---

## Configuration

Create `.issue2claude.yml` in your repo root (optional):

```yaml
# Model (overrides smart model selection)
model: claude-opus-4-6

# Features
auto_review: true          # Self-review before PR creation (default: true)
context_learning: true     # Learn patterns after each run (default: true)

# Smart model: auto-pick based on issue complexity
smart_model:
  simple: claude-sonnet-4-6
  complex: claude-opus-4-6

# Trigger
trigger_label: claude-ready

# Security
restricted_paths:          # Files Claude cannot touch
  - ".env*"
  - "secrets/"
  - "*.key"
  - "*.pem"

# Extra context files Claude reads before working
context_files:
  - "ARCHITECTURE.md"
  - "CONTRIBUTING.md"

# Branch naming
branch_prefix: issue2claude
```

> Also reads `CLAUDE.md` if present in your repo root.

---

## Authentication

<table>
<tr>
<th></th>
<th>API Key <code>(pay per use)</code></th>
<th>Claude Max/Pro <code>(subscription)</code></th>
</tr>
<tr>
<td><strong>Cost</strong></td>
<td>~$0.02–$1.00 per issue</td>
<td>Included in subscription</td>
</tr>
<tr>
<td><strong>Setup</strong></td>
<td>Add <code>ANTHROPIC_API_KEY</code> to repo secrets</td>
<td>Add <code>CLAUDE_CODE_OAUTH_TOKEN</code> to repo secrets</td>
</tr>
<tr>
<td><strong>Get token</strong></td>
<td><a href="https://console.anthropic.com/">console.anthropic.com</a></td>
<td>Run <code>claude setup-token</code> in terminal</td>
</tr>
<tr>
<td><strong>Token expiry</strong></td>
<td>Never</td>
<td>Auto-refresh (see below)</td>
</tr>
<tr>
<td><strong>Workflow</strong></td>
<td><code>auth-mode: api-key</code></td>
<td><code>auth-mode: max</code></td>
</tr>
</table>

### OAuth Auto-Refresh (Claude Max/Pro)

OAuth tokens expire after ~12 hours. Issue2Claude can **auto-refresh** them if you store the full credentials JSON (not just the access token):

```bash
# Store full credentials with refresh token:
cat ~/.claude/.credentials.json | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo your/repo
```

Issue2Claude writes the credentials to disk so Claude Code can refresh the token itself. If you only store the plain access token, you'll need to manually run `claude setup-token` and update the secret when it expires.

### Optional: Repo Context Index

To enable the semantic code search, add `OPENAI_API_KEY` to your repo secrets and include the `update-index` job in your workflow (see examples below). The index rebuilds on every push to your main branch.

---

## Workflow Examples

<details>
<summary><strong>Full workflow — Claude Max/Pro (recommended)</strong></summary>

```yaml
name: Issue2Claude

on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]
  push:
    branches: [main]

jobs:
  # Rebuild repo index on push
  update-index:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g @anthropic-ai/claude-code@latest
      - uses: lennystepn-hue/issue2claude@main
        with:
          mode: index
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          repo: ${{ github.repository }}

  # Solve issues
  solve-issue:
    if: |
      (github.event_name == 'issues' && github.event.label.name == 'claude-ready') ||
      (github.event_name == 'issue_comment' &&
       !github.event.issue.pull_request &&
       contains(github.event.comment.body, 'claude-retry') &&
       (github.event.comment.author_association == 'OWNER' ||
        github.event.comment.author_association == 'MEMBER' ||
        github.event.comment.author_association == 'COLLABORATOR'))
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g @anthropic-ai/claude-code@latest
      - uses: lennystepn-hue/issue2claude@main
        with:
          mode: issue
          auth-mode: max
          oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          issue-number: ${{ github.event.issue.number }}
          issue-title: ${{ github.event.issue.title }}
          issue-body: ${{ github.event.issue.body }}
          repo: ${{ github.repository }}

  # Apply PR feedback
  pr-feedback:
    if: |
      github.event_name == 'issue_comment' &&
      github.event.issue.pull_request &&
      contains(github.event.comment.body, 'claude-fix') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g @anthropic-ai/claude-code@latest
      - uses: lennystepn-hue/issue2claude@main
        with:
          mode: pr-feedback
          auth-mode: max
          oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          pr-number: ${{ github.event.issue.number }}
          repo: ${{ github.repository }}

  # Auto-rebase PRs with conflicts
  rebase:
    if: |
      github.event_name == 'issue_comment' &&
      github.event.issue.pull_request &&
      contains(github.event.comment.body, 'claude-rebase') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g @anthropic-ai/claude-code@latest
      - uses: lennystepn-hue/issue2claude@main
        with:
          mode: rebase
          auth-mode: max
          oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          pr-number: ${{ github.event.issue.number }}
          repo: ${{ github.repository }}

  # Slash commands (/claude estimate, explain, test, refactor)
  slash-command:
    if: |
      github.event_name == 'issue_comment' &&
      !github.event.issue.pull_request &&
      contains(github.event.comment.body, '/claude') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g @anthropic-ai/claude-code@latest
      - uses: lennystepn-hue/issue2claude@main
        with:
          mode: slash-command
          auth-mode: max
          oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          issue-number: ${{ github.event.issue.number }}
          issue-title: ${{ github.event.issue.title }}
          issue-body: ${{ github.event.issue.body }}
          comment-body: ${{ github.event.comment.body }}
          repo: ${{ github.repository }}
```

</details>

<details>
<summary><strong>API Key mode</strong></summary>

```yaml
name: Issue2Claude

on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]

jobs:
  solve-issue:
    if: |
      (github.event_name == 'issues' && github.event.label.name == 'claude-ready') ||
      (github.event_name == 'issue_comment' &&
       !github.event.issue.pull_request &&
       contains(github.event.comment.body, 'claude-retry') &&
       (github.event.comment.author_association == 'OWNER' ||
        github.event.comment.author_association == 'MEMBER' ||
        github.event.comment.author_association == 'COLLABORATOR'))
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g @anthropic-ai/claude-code@latest
      - uses: lennystepn-hue/issue2claude@main
        with:
          mode: issue
          auth-mode: api-key
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          issue-number: ${{ github.event.issue.number }}
          issue-title: ${{ github.event.issue.title }}
          issue-body: ${{ github.event.issue.body }}
          repo: ${{ github.repository }}

  pr-feedback:
    if: |
      github.event_name == 'issue_comment' &&
      github.event.issue.pull_request &&
      contains(github.event.comment.body, 'claude-fix') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g @anthropic-ai/claude-code@latest
      - uses: lennystepn-hue/issue2claude@main
        with:
          mode: pr-feedback
          auth-mode: api-key
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          pr-number: ${{ github.event.issue.number }}
          repo: ${{ github.repository }}

  slash-command:
    if: |
      github.event_name == 'issue_comment' &&
      !github.event.issue.pull_request &&
      contains(github.event.comment.body, '/claude') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install -g @anthropic-ai/claude-code@latest
      - uses: lennystepn-hue/issue2claude@main
        with:
          mode: slash-command
          auth-mode: api-key
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          issue-number: ${{ github.event.issue.number }}
          issue-title: ${{ github.event.issue.title }}
          issue-body: ${{ github.event.issue.body }}
          comment-body: ${{ github.event.comment.body }}
          repo: ${{ github.repository }}
```

</details>

---

## For Vibe Coders

Paste this into Claude Code, Cursor, or any AI assistant and it sets up everything:

```
Add Issue2Claude to this repo. It's a GitHub Action that automatically solves
GitHub Issues with Claude Code.

1. Create .github/workflows/issue2claude.yml with this workflow:
   - Trigger on issues labeled "claude-ready" and comments containing "claude-retry"
   - Trigger on PR comments with "claude-fix" (feedback) and "claude-rebase" (conflicts)
   - Trigger on issue comments with "/claude" (slash commands)
   - Trigger on push to main (for repo index)
   - Use the action: lennystepn-hue/issue2claude@main
   - Auth mode: max with oauth-token from secrets.CLAUDE_CODE_OAUTH_TOKEN
   - Needs permissions: contents write, pull-requests write, issues write
   - Needs: actions/checkout (fetch-depth 0), actions/setup-node (22),
     npm install -g @anthropic-ai/claude-code@latest

2. Create .issue2claude.yml config with smart_model enabled and auto_review true

See https://github.com/lennystepn-hue/issue2claude for full docs.
```

---

## Architecture

```
issue2claude/
├── cli/
│   └── init.js                # npx issue2claude — setup wizard
├── action/
│   ├── index.js               # Main orchestrator
│   ├── prompt-builder.js      # Issue → Claude prompt
│   ├── pr-creator.js          # Branch, commit, push, PR
│   ├── pr-feedback.js         # claude-fix feedback loop
│   ├── pr-rebase.js           # claude-rebase conflict resolution
│   ├── auto-review.js         # Multi-agent self-review
│   ├── slash-commands.js      # /claude estimate|explain|test|refactor
│   ├── pr-chain.js            # Issue dependency resolution
│   ├── smart-model.js         # Complexity → model picker
│   ├── context-learning.js    # Pattern extraction after runs
│   ├── repo-index.js          # OpenAI embeddings code search
│   └── issue-updater.js       # Live progress in issue comments
├── action.yml                 # GitHub Action metadata
└── package.json               # npm package + CLI entry
```

---

## Security

- Claude runs in an **isolated CI container** — no access to your machine or secrets
- Restricted paths prevent Claude from touching sensitive files (`.env`, keys, workflows)
- Only repo **owners, members, and collaborators** can trigger commands
- All changes go through a **PR** — nothing touches your main branch directly
- The repo index (embeddings) contains only file previews, not full source code

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "not permitted to create pull requests" | Settings > Actions > General > Enable PR creation |
| "refusing to allow GitHub App to create workflow" | Claude tried to modify `.github/workflows/` — this is auto-blocked, retry should work |
| Claude hangs with no output | Verify your OAuth token or API key is valid |
| No changes detected | Write a more detailed issue description |
| Dependencies not resolved | Close or merge the dependency issues/PRs first |
| Index build fails | Check that `OPENAI_API_KEY` is set in repo secrets |

---

## License

MIT

---

<div align="center">

**Built by [Lenny Enderle](https://github.com/lennystepn-hue) with [Claude Code](https://docs.anthropic.com/en/docs/claude-code)**

*From issue to PR in minutes, not hours.*

</div>
