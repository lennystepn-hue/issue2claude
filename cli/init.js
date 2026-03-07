#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

const WORKFLOW_API_KEY = (model) => `name: Issue2Claude

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
          mode: issue
          auth-mode: api-key
          anthropic-api-key: \${{ secrets.ANTHROPIC_API_KEY }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          issue-number: \${{ github.event.issue.number }}
          issue-title: \${{ github.event.issue.title }}
          issue-body: \${{ github.event.issue.body }}
          repo: \${{ github.repository }}
          model: '${model}'

  pr-feedback:
    if: |
      github.event_name == 'issue_comment' &&
      github.event.issue.pull_request &&
      contains(github.event.comment.body, 'claude-fix') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')

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
          mode: pr-feedback
          auth-mode: api-key
          anthropic-api-key: \${{ secrets.ANTHROPIC_API_KEY }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          pr-number: \${{ github.event.issue.number }}
          repo: \${{ github.repository }}

  slash-command:
    if: |
      github.event_name == 'issue_comment' &&
      !github.event.issue.pull_request &&
      contains(github.event.comment.body, '/claude') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')

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
          mode: slash-command
          auth-mode: api-key
          anthropic-api-key: \${{ secrets.ANTHROPIC_API_KEY }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          issue-number: \${{ github.event.issue.number }}
          issue-title: \${{ github.event.issue.title }}
          issue-body: \${{ github.event.issue.body }}
          comment-body: \${{ github.event.comment.body }}
          repo: \${{ github.repository }}
`;

const WORKFLOW_MAX = (model) => `name: Issue2Claude

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
          mode: issue
          auth-mode: max
          oauth-token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          issue-number: \${{ github.event.issue.number }}
          issue-title: \${{ github.event.issue.title }}
          issue-body: \${{ github.event.issue.body }}
          repo: \${{ github.repository }}
          model: '${model}'

  pr-feedback:
    if: |
      github.event_name == 'issue_comment' &&
      github.event.issue.pull_request &&
      contains(github.event.comment.body, 'claude-fix') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')

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
          mode: pr-feedback
          auth-mode: max
          oauth-token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          pr-number: \${{ github.event.issue.number }}
          repo: \${{ github.repository }}

  slash-command:
    if: |
      github.event_name == 'issue_comment' &&
      !github.event.issue.pull_request &&
      contains(github.event.comment.body, '/claude') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')

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
          mode: slash-command
          auth-mode: max
          oauth-token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          issue-number: \${{ github.event.issue.number }}
          issue-title: \${{ github.event.issue.title }}
          issue-body: \${{ github.event.issue.body }}
          comment-body: \${{ github.event.comment.body }}
          repo: \${{ github.repository }}
`;

const CONFIG_TEMPLATE = (model) => `# Issue2Claude Configuration
# See: https://github.com/lennystepn-hue/issue2claude

# Model to use
model: ${model}

# Auto-review before PR creation (second Claude pass)
auto_review: true

# Files Claude is NOT allowed to touch
restricted_paths:
  - ".env*"
  - "secrets/"
  - "*.key"
  - "*.pem"

# Additional context files Claude should read
# context_files:
#   - "ARCHITECTURE.md"
#   - "docs/conventions.md"
`;

async function main() {
  console.log('');
  console.log('  Issue2Claude Setup');
  console.log('  ==================');
  console.log('  Label an issue. Get a PR.');
  console.log('');

  // Check if we're in a git repo
  if (!fs.existsSync('.git')) {
    console.error('  Error: Not a git repository. Run this from your project root.');
    process.exit(1);
  }

  // Step 1: Auth mode
  console.log('  1. How do you want to authenticate?');
  console.log('     [1] API Key (pay per use, ~$0.02-$1.00 per issue)');
  console.log('     [2] Claude Max/Pro (included in subscription)');
  console.log('');
  const authChoice = await ask('  Choice [1/2]: ');
  const authMode = authChoice.trim() === '2' ? 'max' : 'api-key';
  console.log('');

  // Step 2: Model
  console.log('  2. Which model?');
  console.log('     [1] claude-opus-4-6 (best quality, slower)');
  console.log('     [2] claude-sonnet-4-6 (good balance, faster)');
  console.log('');
  const modelChoice = await ask('  Choice [1/2]: ');
  const model = modelChoice.trim() === '2' ? 'claude-sonnet-4-6' : 'claude-opus-4-6';
  console.log('');

  // Step 3: Create workflow
  const workflowDir = path.join('.github', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });

  const workflowPath = path.join(workflowDir, 'issue2claude.yml');
  const workflowContent = authMode === 'max' ? WORKFLOW_MAX(model) : WORKFLOW_API_KEY(model);

  if (fs.existsSync(workflowPath)) {
    const overwrite = await ask('  Workflow already exists. Overwrite? [y/N]: ');
    if (overwrite.trim().toLowerCase() !== 'y') {
      console.log('  Skipping workflow.');
    } else {
      fs.writeFileSync(workflowPath, workflowContent);
      console.log(`  Created ${workflowPath}`);
    }
  } else {
    fs.writeFileSync(workflowPath, workflowContent);
    console.log(`  Created ${workflowPath}`);
  }

  // Step 4: Create config
  const configPath = '.issue2claude.yml';
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, CONFIG_TEMPLATE(model));
    console.log(`  Created ${configPath}`);
  } else {
    console.log(`  ${configPath} already exists, skipping.`);
  }

  // Step 5: Summary
  console.log('');
  console.log('  Setup complete!');
  console.log('  ===============');
  console.log('');

  if (authMode === 'max') {
    console.log('  Next steps:');
    console.log('  1. Generate an OAuth token:  claude setup-token');
    console.log('  2. Add it as a repo secret:  CLAUDE_CODE_OAUTH_TOKEN');
    console.log('     Go to: Settings > Secrets and variables > Actions > New repository secret');
  } else {
    console.log('  Next steps:');
    console.log('  1. Get your API key from: https://console.anthropic.com/');
    console.log('  2. Add it as a repo secret:  ANTHROPIC_API_KEY');
    console.log('     Go to: Settings > Secrets and variables > Actions > New repository secret');
  }

  console.log('');
  console.log('  3. Enable PR creation:');
  console.log('     Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests"');
  console.log('');
  console.log('  4. Commit and push the new files:');
  console.log('     git add .github/workflows/issue2claude.yml .issue2claude.yml');
  console.log('     git commit -m "chore: add issue2claude"');
  console.log('     git push');
  console.log('');
  console.log('  5. Create an issue and label it "claude-ready"');
  console.log('');
  console.log('  Commands available after setup:');
  console.log('    claude-ready label    -> Claude solves the issue and opens a PR');
  console.log('    claude-retry comment  -> Re-run on failure');
  console.log('    claude-fix on PR      -> Apply review feedback');
  console.log('    /claude estimate      -> Estimate effort');
  console.log('    /claude explain       -> Explain relevant code');
  console.log('    /claude test          -> Write tests only');
  console.log('    /claude refactor      -> Refactor without behavior change');
  console.log('');

  rl.close();
}

main().catch(e => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
