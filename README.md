<div align="center">

<img src="assets/banner.svg" alt="Issue2Claude" width="100%">

<br><br>

**Label a GitHub Issue. Get a Pull Request.**

Claude Code reads your issue, analyzes your codebase, implements the fix, and opens a PR — fully autonomous.

[![GitHub Action](https://img.shields.io/badge/GitHub_Action-2088FF?logo=github-actions&logoColor=white)](https://github.com/features/actions)
[![Claude Code](https://img.shields.io/badge/Claude_Code-cc785c?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## How It Works

```
                    +------------------+
                    |   GitHub Issue   |
                    | + label: claude  |
                    |   -ready         |
                    +--------+---------+
                             |
                    +--------v---------+
                    | GitHub Actions   |
                    | triggers workflow|
                    +--------+---------+
                             |
                    +--------v---------+
                    |  Claude Code     |
                    |  (headless)      |
                    |  - reads repo    |
                    |  - implements    |
                    |  - tests         |
                    +--------+---------+
                             |
                    +--------v---------+
                    | Pull Request     |
                    | auto-created     |
                    | with summary     |
                    +------------------+
```

1. You write a GitHub Issue describing what needs to be done
2. Add the label **`claude-ready`**
3. Claude Code boots up in CI, reads your entire repo, and gets to work
4. A PR appears with the solution, cost breakdown, and a summary of changes
5. You review and merge

> Something wrong? Comment **`claude-retry`** on the issue to run it again.

---

## Quick Start

**3 steps. 2 minutes. Pick your auth mode.**

### 1. Choose your authentication

<table>
<tr><th></th><th>API Key (pay per use)</th><th>Claude Max/Pro (subscription)</th></tr>
<tr>
<td><strong>Cost</strong></td>
<td>~$0.02–$1.00 per issue</td>
<td>Included in your subscription</td>
</tr>
<tr>
<td><strong>Setup</strong></td>
<td>Add <code>ANTHROPIC_API_KEY</code> secret</td>
<td>Add <code>CLAUDE_OAUTH_TOKEN</code> secret</td>
</tr>
<tr>
<td><strong>Best for</strong></td>
<td>Teams, heavy usage</td>
<td>Solo devs with Max/Pro plan</td>
</tr>
</table>

**API Key mode:** Get your key from [console.anthropic.com](https://console.anthropic.com/) and add it as `ANTHROPIC_API_KEY` in repo secrets.

**Max/Pro mode:** Extract your OAuth token:
```bash
# Login locally (if not already)
claude login

# Copy the token
cat ~/.claude/.credentials.json
```
Add the full JSON content as `CLAUDE_OAUTH_TOKEN` in repo secrets.

### 2. Add the workflow

Create `.github/workflows/issue2claude.yml`:

<details>
<summary><strong>API Key mode</strong> (click to expand)</summary>

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
       contains(github.event.comment.body, 'claude-retry') &&
       (github.event.comment.author_association == 'OWNER' ||
        github.event.comment.author_association == 'MEMBER' ||
        github.event.comment.author_association == 'COLLABORATOR'))

    runs-on: ubuntu-latest

    permissions:
      contents: write
      pull-requests: write
      issues: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: npm install -g @anthropic-ai/claude-code@latest

      - uses: lennystepn-hue/issue2claude@main
        with:
          auth-mode: api-key
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          issue-number: ${{ github.event.issue.number || github.event.comment.issue_number }}
          issue-title: ${{ github.event.issue.title }}
          issue-body: ${{ github.event.issue.body }}
          repo: ${{ github.repository }}
```
</details>

<details open>
<summary><strong>Claude Max/Pro mode</strong> (click to expand)</summary>

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
       contains(github.event.comment.body, 'claude-retry') &&
       (github.event.comment.author_association == 'OWNER' ||
        github.event.comment.author_association == 'MEMBER' ||
        github.event.comment.author_association == 'COLLABORATOR'))

    runs-on: ubuntu-latest

    permissions:
      contents: write
      pull-requests: write
      issues: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: npm install -g @anthropic-ai/claude-code@latest

      - uses: lennystepn-hue/issue2claude@main
        with:
          auth-mode: max
          oauth-token: ${{ secrets.CLAUDE_OAUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          issue-number: ${{ github.event.issue.number || github.event.comment.issue_number }}
          issue-title: ${{ github.event.issue.title }}
          issue-body: ${{ github.event.issue.body }}
          repo: ${{ github.repository }}
```
</details>

### 3. Create an issue and label it

That's it. Write an issue, add `claude-ready`, and watch the magic happen.

---

## What You Get

When Claude finishes, you get:

**In the Issue:**
- A start comment with status updates every 60s
- A finish comment with the PR link, summary, cost, and duration

**In the PR:**
- Auto-generated title referencing the issue
- Full summary of what Claude changed and why
- List of all modified files
- Cost and token usage breakdown
- `Closes #issue` for automatic issue closing on merge

---

## Configuration

Optionally place `.issue2claude.yml` in your repo root:

```yaml
# Model to use (default: claude-sonnet-4-6)
model: claude-sonnet-4-6

# Label that triggers the bot
trigger_label: claude-ready

# Files Claude is NOT allowed to touch
restricted_paths:
  - ".env*"
  - "secrets/"
  - "*.key"
  - "*.pem"

# Additional context files Claude should read
context_files:
  - "ARCHITECTURE.md"
  - "docs/conventions.md"

# Branch naming prefix
branch_prefix: "issue2claude"
```

Issue2Claude also reads your `CLAUDE.md` if present — so your existing Claude Code config carries over.

---

## Writing Good Issues

The better the issue, the better the result. Tips:

| Do | Don't |
|----|-------|
| Be specific about what to change | "Make it better" |
| Reference file paths | Assume Claude knows your naming |
| Include acceptance criteria | Leave success undefined |
| Mention edge cases | Forget error handling |

Use the included issue template (`Claude Task`) for best results.

---

## Cost

**API Key mode:** Usage is billed to your Anthropic API key.

| Complexity | Typical Cost | Duration |
|-----------|-------------|----------|
| Simple fix (typo, config) | $0.02 - $0.10 | 1-2 min |
| Small feature | $0.10 - $0.30 | 2-5 min |
| Complex feature | $0.30 - $1.00 | 5-10 min |

**Max/Pro mode:** Included in your subscription. No extra cost per issue.

Costs are shown in every PR and issue comment so there are no surprises.

---

## Architecture

```
issue2claude/
├── action/
│   ├── index.js              # Orchestrator — runs the full pipeline
│   ├── prompt-builder.js     # Builds Claude prompt from issue data
│   ├── pr-creator.js         # Creates branch, commit, and PR
│   └── issue-updater.js      # Posts live updates to the issue
├── .github/
│   ├── workflows/
│   │   └── issue2claude.yml  # The GitHub Actions workflow
│   └── ISSUE_TEMPLATE/
│       └── claude-task.md    # Issue template for Claude tasks
├── action.yml                # GitHub Action metadata
└── .issue2claude.yml         # Default configuration
```

---

## Security

- Claude runs in an **isolated CI container** — no access to your secrets or infrastructure
- `--dangerously-skip-permissions` is safe here because the container is ephemeral
- Restricted paths prevent Claude from touching sensitive files
- Only repo owners, members, and collaborators can trigger retries
- All changes go through a PR — nothing is pushed to main directly

---

## License

MIT — do whatever you want with it.

---

<div align="center">

**Built with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic**

*From issue to PR in minutes, not hours.*

</div>
