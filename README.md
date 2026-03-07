<div align="center">

<img src="assets/banner.svg" alt="Issue2Claude" width="100%">

<br><br>

**Label a GitHub Issue. Get a Pull Request.**

Claude Code reads your issue, analyzes your codebase, implements the fix, and opens a PR — fully autonomous.

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-Issue2Claude-blue?logo=github)](https://github.com/marketplace/actions/issue2claude)
[![npm](https://img.shields.io/npm/v/issue2claude?color=red&logo=npm)](https://www.npmjs.com/package/issue2claude)
[![Claude Code](https://img.shields.io/badge/Claude_Code-cc785c?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## Quick Start

### Option A: One command setup

```bash
npx issue2claude
```

The setup wizard creates everything you need: workflow file, config, and tells you exactly which secrets to add.

### Option B: GitHub Marketplace

1. Go to the [Issue2Claude Marketplace page](https://github.com/marketplace/actions/issue2claude)
2. Click **"Use latest version"**
3. Add your secret (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`)
4. Enable PR creation in Settings > Actions > General

### Option C: Manual setup

<details>
<summary>Click to expand</summary>

1. Create `.github/workflows/issue2claude.yml` (copy from examples below)
2. Add your auth secret
3. Enable "Allow GitHub Actions to create and approve pull requests" in Settings > Actions > General
4. Create an issue, add `claude-ready` label

</details>

**After setup:** write an issue, add the `claude-ready` label, and watch the magic happen.

---

## How It Works

```
  Issue + label           GitHub Actions         Claude Code            Pull Request
  ┌──────────┐           ┌──────────┐          ┌──────────┐          ┌──────────┐
  │  claude-  │──trigger──│ workflow │──spawn──▸│ reads    │──push──▸│ auto-    │
  │  ready    │           │ runs     │          │ codes    │          │ created  │
  │           │           │          │          │ tests    │          │ reviewed │
  └──────────┘           └──────────┘          └──────────┘          └──────────┘
```

1. You write a GitHub Issue describing what needs to be done
2. Add the label **`claude-ready`**
3. Claude Code reads your repo, implements the solution, auto-reviews it
4. A PR appears with the solution and a summary of changes
5. You review and merge

---

## Features

### Issue to PR
Label `claude-ready` on any issue. Claude solves it and opens a PR.

### PR Feedback Loop
**Comment `claude-fix` on a PR** — Claude reads your review comments and applies the changes.

```
You: "Move this to a utils file"
     "Add error handling here"
     → claude-fix

Claude: *applies feedback, pushes to branch*
```

Repeat until it's perfect. No other tool does this.

### Auto-Review
Every PR gets a second Claude pass before creation. Reviews for bugs, security issues, and missing edge cases. Finds problems → fixes them → then creates the PR.

### Slash Commands
Comment on any issue:

| Command | What it does |
|---------|-------------|
| `/claude estimate` | Estimates effort + affected files |
| `/claude explain` | Explains the relevant code |
| `/claude test` | Writes tests only (creates PR) |
| `/claude refactor` | Refactors without behavior change (creates PR) |

### PR Chain
Issues can declare dependencies:

```markdown
depends-on: #12
```

Issue2Claude waits until `#12` is resolved. If `#12` has an open PR, the new branch is based on that PR's branch — changes stack cleanly.

Also supports: `depends on #12, #13`, `after #12`, `blocked-by: #15`

### Live Progress
Real-time updates in the issue comment: phase tracking, files touched, activity log, elapsed time.

---

## Authentication

<table>
<tr><th></th><th>API Key (pay per use)</th><th>Claude Max/Pro (subscription)</th></tr>
<tr>
<td><strong>Cost</strong></td>
<td>~$0.02-$1.00 per issue</td>
<td>Included in subscription</td>
</tr>
<tr>
<td><strong>Secret</strong></td>
<td><code>ANTHROPIC_API_KEY</code></td>
<td><code>CLAUDE_CODE_OAUTH_TOKEN</code></td>
</tr>
<tr>
<td><strong>Get it</strong></td>
<td><a href="https://console.anthropic.com/">console.anthropic.com</a></td>
<td><code>claude setup-token</code></td>
</tr>
</table>

---

## Workflow Examples

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

<details open>
<summary><strong>Claude Max/Pro mode</strong></summary>

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
          auth-mode: max
          oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
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
          auth-mode: max
          oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
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
          auth-mode: max
          oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          issue-number: ${{ github.event.issue.number }}
          issue-title: ${{ github.event.issue.title }}
          issue-body: ${{ github.event.issue.body }}
          comment-body: ${{ github.event.comment.body }}
          repo: ${{ github.repository }}
```
</details>

---

## Configuration

Optionally place `.issue2claude.yml` in your repo root:

```yaml
model: claude-opus-4-6        # or claude-sonnet-4-6
auto_review: true              # second Claude pass before PR (default: true)
trigger_label: claude-ready

restricted_paths:              # files Claude cannot touch
  - ".env*"
  - "secrets/"

context_files:                 # extra files Claude reads for context
  - "ARCHITECTURE.md"
```

Also reads `CLAUDE.md` if present.

---

## Architecture

```
issue2claude/
├── cli/
│   └── init.js               # npx issue2claude setup wizard
├── action/
│   ├── index.js               # Orchestrator
│   ├── prompt-builder.js      # Issue → Claude prompt
│   ├── pr-creator.js          # Branch, commit, PR creation
│   ├── pr-feedback.js         # claude-fix feedback loop
│   ├── auto-review.js         # Multi-agent code review
│   ├── slash-commands.js      # /claude commands
│   ├── pr-chain.js            # Dependency resolution
│   └── issue-updater.js       # Live issue updates
├── action.yml                 # GitHub Action metadata
└── package.json               # npx entry point
```

---

## Security

- Claude runs in an **isolated CI container** — no access to your secrets
- `--dangerously-skip-permissions` is safe because the container is ephemeral
- Restricted paths prevent touching sensitive files
- Only owners, members, and collaborators can trigger commands
- All changes go through a PR — nothing touches main directly

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| "not permitted to create pull requests" | Settings > Actions > General > Enable PR creation |
| Claude hangs with no output | Check your OAuth token / API key |
| No changes detected | Try a more detailed issue description |
| Dependencies not resolved | Close/merge the dependency issues first |

---

## License

MIT

---

<div align="center">

**Built by [Lenny Enderle](https://github.com/lennystepn-hue) with [Claude Code](https://docs.anthropic.com/en/docs/claude-code)**

*From issue to PR in minutes, not hours.*

</div>
