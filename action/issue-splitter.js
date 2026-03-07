const path = require('path');
const fs = require('fs');

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

function buildSplitPrompt({ issueTitle, issueBody }) {
  const claudeMd = readFileIfExists(path.join(process.cwd(), 'CLAUDE.md'));

  return `You are an autonomous software engineer analyzing a complex GitHub issue to split it into smaller, independent sub-tasks.

## Issue: "${issueTitle}"
${issueBody || 'No description.'}

${claudeMd ? `## Project context\n### CLAUDE.md\n${claudeMd}` : ''}

## Your task
Analyze this issue and the codebase, then split it into 2-5 smaller, independent sub-issues that can each be solved in a single PR.

## Rules
- Each sub-issue should be independently implementable
- Each sub-issue should result in a working state (no broken intermediate steps)
- Order them by dependency (independent ones first)
- Do NOT make any code changes

## Output format
SUMMARY_START
SPLIT_START
---
title: [Sub-issue title 1]
body: |
  [Detailed description of what to do]

  **Acceptance criteria:**
  - [ ] Criterion 1
  - [ ] Criterion 2

  *Part of #PARENT_ISSUE*
---
title: [Sub-issue title 2]
body: |
  [Detailed description]

  **Acceptance criteria:**
  - [ ] Criterion 1

  *Part of #PARENT_ISSUE, depends on sub-issue 1*
---
SPLIT_END
SUMMARY_END`;
}

function parseSplitResult(output, parentIssueNumber) {
  const match = output.match(/SPLIT_START\s*([\s\S]*?)\s*SPLIT_END/);
  if (!match) return [];

  const content = match[1];
  const issues = [];
  const blocks = content.split('---').filter(b => b.trim());

  for (const block of blocks) {
    const titleMatch = block.match(/title:\s*(.+)/);
    const bodyMatch = block.match(/body:\s*\|\s*([\s\S]*?)(?=\n---|\n*$)/);

    if (titleMatch) {
      const title = titleMatch[1].trim();
      let body = bodyMatch ? bodyMatch[1].trim() : '';
      body = body.replace(/PARENT_ISSUE/g, parentIssueNumber);

      issues.push({ title, body });
    }
  }

  return issues;
}

module.exports = { buildSplitPrompt, parseSplitResult };
