const path = require('path');
const fs = require('fs');

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

const COMMANDS = {
  estimate: {
    description: 'Estimate effort and affected files without making changes',
    allowedTools: 'Read,Glob,Grep,Bash',
    buildPrompt: ({ issueTitle, issueBody, claudeMd }) => `You are an autonomous software engineer estimating the effort to solve a GitHub issue.

## Issue: "${issueTitle}"
${issueBody || 'No description.'}

${claudeMd ? `## Project context\n### CLAUDE.md\n${claudeMd}` : ''}

## Your task
Analyze the codebase and estimate what it would take to solve this issue. Do NOT make any changes.

## What to report
SUMMARY_START
### Effort Estimate

**Complexity:** [Simple / Medium / Complex]
**Estimated time:** [1-2 min / 2-5 min / 5-15 min]

### Affected Files
- \`path/to/file1.ts\` — what needs to change
- \`path/to/file2.ts\` — what needs to change

### Approach
[Brief description of how you would solve this]

### Risks
- [Potential risk 1]
- [Potential risk 2]
SUMMARY_END`,
  },

  explain: {
    description: 'Explain the relevant code without making changes',
    allowedTools: 'Read,Glob,Grep,Bash',
    buildPrompt: ({ issueTitle, issueBody, claudeMd }) => `You are an autonomous software engineer explaining code related to a GitHub issue.

## Issue: "${issueTitle}"
${issueBody || 'No description.'}

${claudeMd ? `## Project context\n### CLAUDE.md\n${claudeMd}` : ''}

## Your task
Find and explain the code relevant to this issue. Do NOT make any changes.

## What to report
SUMMARY_START
### Code Explanation

[Explain the relevant code, how it works, and how it relates to the issue. Include file paths and line numbers. Keep it clear and concise.]
SUMMARY_END`,
  },

  test: {
    description: 'Write tests only, no implementation changes',
    allowedTools: 'Read,Write,Edit,Glob,Grep,Bash',
    buildPrompt: ({ issueTitle, issueBody, claudeMd }) => `You are an autonomous software engineer writing tests for a GitHub issue.

## Issue: "${issueTitle}"
${issueBody || 'No description.'}

${claudeMd ? `## Project context\n### CLAUDE.md\n${claudeMd}` : ''}

## Your task
Write tests that cover the behavior described in this issue. Do NOT implement the actual feature/fix — only write tests.

## Rules
- Only write test files — do not modify source code
- Follow existing test patterns in the repo
- Cover happy path, edge cases, and error cases
- Do NOT run git add, git commit, or git push

## After implementation
SUMMARY_START
[What tests you wrote and what they cover]
SUMMARY_END`,
  },

  refactor: {
    description: 'Refactor code without changing behavior',
    allowedTools: 'Read,Write,Edit,Glob,Grep,Bash',
    buildPrompt: ({ issueTitle, issueBody, claudeMd }) => `You are an autonomous software engineer refactoring code described in a GitHub issue.

## Issue: "${issueTitle}"
${issueBody || 'No description.'}

${claudeMd ? `## Project context\n### CLAUDE.md\n${claudeMd}` : ''}

## Your task
Refactor the code as described. Do NOT add new features or change behavior.

## Rules
- Preserve existing behavior exactly
- Run existing tests to make sure nothing breaks
- Only refactor what the issue asks for
- Do NOT run git add, git commit, or git push

## After implementation
SUMMARY_START
[What you refactored and why this improves the code]
SUMMARY_END`,
  },
};

function parseSlashCommand(commentBody) {
  const match = commentBody.match(/\/claude\s+(estimate|explain|test|refactor)\b/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

function buildSlashCommandPrompt({ command, issueTitle, issueBody }) {
  const claudeMd = readFileIfExists(path.join(process.cwd(), 'CLAUDE.md'));
  const cmd = COMMANDS[command];
  if (!cmd) return null;
  return {
    prompt: cmd.buildPrompt({ issueTitle, issueBody, claudeMd }),
    allowedTools: cmd.allowedTools,
    description: cmd.description,
  };
}

module.exports = { parseSlashCommand, buildSlashCommandPrompt, COMMANDS };
