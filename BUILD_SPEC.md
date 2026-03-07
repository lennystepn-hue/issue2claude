# Issue2Claude — Build Spec

## Was ist das?
Ein GitHub Action das automatisch GitHub Issues löst via Claude Code (headless mode).
Developer setzt Label `claude-ready` auf ein Issue → Claude arbeitet autonom → PR wird geöffnet.
Kein Mensch greift ein. Claude schafft es immer — bei Problemen öffnet es trotzdem einen PR mit dem was es hat + Erklärung was fehlt.

---

## Repo Struktur die du erstellen sollst

```
issue2claude/
├── .github/
│   └── workflows/
│       └── issue2claude.yml        # Haupt-Workflow
├── action/
│   ├── index.js                    # Core Action Logic (Node.js)
│   ├── prompt-builder.js           # Baut den Claude Prompt aus dem Issue
│   ├── pr-creator.js               # Öffnet den PR nach Claude
│   └── issue-updater.js            # Postet Live-Updates ins Issue
├── .github/
│   └── ISSUE_TEMPLATE/
│       └── claude-task.md          # Issue Template für gute Claude Tasks
├── action.yml                      # GitHub Action Metadata
├── .issue2claude.yml               # Default Config (wird ins Ziel-Repo kopiert)
├── package.json
└── README.md
```

---

## 1. GitHub Actions Workflow — `.github/workflows/issue2claude.yml`

```yaml
name: Issue2Claude

on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]

jobs:
  solve-issue:
    # Trigger: Label "claude-ready" gesetzt
    if: |
      (github.event_name == 'issues' && github.event.label.name == 'claude-ready') ||
      (github.event_name == 'issue_comment' && 
       contains(github.event.comment.body, 'claude-retry') &&
       github.event.comment.author_association == 'OWNER' || 
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')

    runs-on: ubuntu-latest
    
    permissions:
      contents: write
      pull-requests: write
      issues: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code@latest

      - name: Install gh CLI
        run: |
          type -p curl >/dev/null || apt install curl -y
          curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
          chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
          echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
          apt update && apt install gh -y

      - name: Run Issue2Claude Action
        uses: ./
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          issue-number: ${{ github.event.issue.number || github.event.comment.issue_number }}
          issue-title: ${{ github.event.issue.title }}
          issue-body: ${{ github.event.issue.body }}
          repo: ${{ github.repository }}
```

---

## 2. Action Metadata — `action.yml`

```yaml
name: 'Issue2Claude'
description: 'Automatically solve GitHub Issues with Claude Code'
author: 'issue2claude'

inputs:
  anthropic-api-key:
    description: 'Anthropic API Key'
    required: true
  github-token:
    description: 'GitHub Token'
    required: true
  issue-number:
    description: 'Issue number to solve'
    required: true
  issue-title:
    description: 'Issue title'
    required: true
  issue-body:
    description: 'Issue body/description'
    required: true
  repo:
    description: 'Repository (owner/name)'
    required: true
  model:
    description: 'Claude model to use'
    default: 'claude-sonnet-4-6'

runs:
  using: 'node20'
  main: 'action/index.js'
```

---

## 3. Core Logic — `action/index.js`

Implementiere folgende Logik:

### Schritt 1 — Issue laden und Config lesen
- Issue Comments laden (für mehr Kontext)
- `.issue2claude.yml` aus dem Repo lesen falls vorhanden
- `CLAUDE.md` aus dem Repo lesen falls vorhanden

### Schritt 2 — Start-Kommentar ins Issue posten
```
🤖 **Issue2Claude started** — #[issue-number]

Claude Code is analyzing your repository and working on a solution...
Updates will follow here. This may take 2-10 minutes.

`Model: claude-sonnet-4-6`
```

### Schritt 3 — Prompt bauen (siehe prompt-builder.js)

### Schritt 4 — Claude Code headless ausführen
```bash
claude -p "[PROMPT]" \
  --allowedTools Read,Write,Bash,Glob,Grep \
  --max-turns 30 \
  --output-format json \
  --dangerously-skip-permissions
```

WICHTIG: `--dangerously-skip-permissions` ist ok weil wir in einem isolierten CI Container sind.

### Schritt 5 — Progress Updates
Während Claude läuft, parse den stream-json output und poste alle 60 Sekunden ein Update-Kommentar ins Issue mit was Claude gerade macht.

### Schritt 6 — Branch + Commit + PR erstellen
```bash
# Branch
git checkout -b issue2claude/[issue-number]-[slug-vom-titel]

# Commit
git config user.email "issue2claude[bot]@users.noreply.github.com"
git config user.name "Issue2Claude"
git add -A
git commit -m "feat: [issue title] (closes #[issue-number])"

# Push
git push origin [branch]

# PR via gh CLI
gh pr create \
  --title "feat: [issue title] (#[issue-number])" \
  --body "[PR Body - siehe unten]" \
  --base main \
  --head [branch]
```

### Schritt 7 — Finish-Kommentar ins Issue
```
✅ **Issue2Claude done!**

PR opened: #[pr-number]
Branch: `issue2claude/[branch]`

**What Claude did:**
[Summary from Claude output]

**Token usage:** [X] | **Cost:** ~$[Y] | **Duration:** [Z]min

Please review and merge the PR when everything looks good.
```

Falls Claude NICHTS geändert hat (keine Git-Changes):
```
⚠️ **Issue2Claude — No changes made**

Claude analyzed the issue but did not make any code changes.
Reason: [Claude's explanation]

Please add more details to the issue and re-apply the label.
```

---

## 4. Prompt Builder — `action/prompt-builder.js`

Der Prompt der an Claude geht soll so aussehen:

```
You are an autonomous software engineer solving GitHub Issues.

## Your task
GitHub Issue #[NUMBER]: "[TITLE]"

## Issue description
[BODY]

## Issue comments (for more context)
[COMMENTS if available]

## Project context
[CLAUDE.md content if available]
[.issue2claude.yml content if available]

## What you need to do
1. Analyze the issue carefully
2. Find the relevant files in the repo
3. Implement the solution
4. Make sure existing tests still pass
5. Write tests for new functionality where it makes sense

## Rules
- Only do what the issue asks — nothing more
- Do not change files unrelated to the issue
- Do NOT touch: .env*, secrets/, .github/workflows/
- When in doubt, make the smallest possible change
- Write code comments in English
- If you cannot fully solve the issue: still commit what you have
  and explain in the commit message what is missing

## After implementation
Write a short summary of what you did.
Format:
SUMMARY_START
[What you changed, which files, why this approach]
SUMMARY_END
```

---

## 5. PR Body Template

```markdown
## 🤖 Issue2Claude — Automatically generated

Closes #[ISSUE_NUMBER]

## What was done
[CLAUDE SUMMARY]

## Changed files
[List of changed files from git diff --name-only]

## Notes
- Automatically created by [Issue2Claude](https://github.com/[repo]/issue2claude)
- Model: [MODEL]
- Token usage: [TOKENS]
- Cost: ~$[COST]
- Duration: [DURATION]

---
*Please review before merging. If something is wrong: comment `claude-retry` on the issue.*
```

---

## 6. Issue Template — `.github/ISSUE_TEMPLATE/claude-task.md`

```markdown
---
name: 🤖 Claude Task
about: A task to be automatically solved by Issue2Claude
labels: claude-ready
---

## What needs to be done?
<!-- Be as specific as possible. Claude reads this literally. -->

## Acceptance Criteria
- [ ] 
- [ ] 

## Files likely involved (optional)
<!-- Helps Claude focus -->

## Do NOT change (optional)
<!-- Guardrails for Claude -->

## Additional context (optional)
```

---

## 7. Default Config — `.issue2claude.yml`

```yaml
# Issue2Claude configuration
# Place this file in your repo root to configure Issue2Claude

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

# Branch naming
branch_prefix: "issue2claude"
```

---

## 8. README.md

Schreibe ein README mit:
- Was ist Issue2Claude (1 Satz)
- Quick Start (3 Schritte)
- Wie benutzt man es (Label setzen)
- Configuration (.issue2claude.yml erklären)
- Kosten-Hinweis
- Self-hosting

---

## Package.json

```json
{
  "name": "issue2claude",
  "version": "0.1.0",
  "description": "Automatically solve GitHub Issues with Claude Code",
  "main": "action/index.js",
  "scripts": {
    "test": "node tests/test.js"
  },
  "dependencies": {
    "@actions/core": "^1.10.1",
    "@actions/github": "^6.0.0",
    "@octokit/rest": "^21.0.0"
  }
}
```

---

## Technische Hinweise für die Implementierung

1. **Node.js, no TypeScript** — simpler for GitHub Actions, no build step needed

2. **Parse Claude output** — Claude returns JSON:
   ```json
   {
     "type": "result",
     "result": "...",
     "cost_usd": 0.18,
     "duration_ms": 134000,
     "num_turns": 12
   }
   ```
   Parse `result` for the summary (between SUMMARY_START and SUMMARY_END).

3. **Detect git changes** — after Claude check if files were modified:
   ```bash
   git status --porcelain
   ```
   If empty → no PR, instead post error comment on issue.

4. **Error handling** — if Claude Code crashes or exit code != 0:
   - Still check if files were changed
   - If yes → open PR anyway with a warning
   - If no → comment on issue with the error

5. **Timeout** — GitHub Actions have a 6h limit.
   Limit Claude with `--max-turns 30` so it doesn't run forever.

---

## Build priority

1. First: `action.yml` + `action/index.js` + `action/prompt-builder.js` — the core
2. Then: `action/issue-updater.js` — live updates on the issue
3. Then: `action/pr-creator.js` — open the PR
4. Last: README + issue template + `.issue2claude.yml`

Start with a local `console.log` test run before building the full action.
