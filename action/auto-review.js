const core = require('@actions/core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function buildReviewPrompt(changedFiles) {
  // Read current state of changed files
  const fileContents = [];
  for (const file of changedFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      fileContents.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
    } catch {
      // File might have been deleted
    }
  }

  // Get the diff
  let diff = '';
  try {
    diff = execSync('git diff HEAD', { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
    if (!diff) {
      diff = execSync('git diff --cached', { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
    }
    if (!diff) {
      diff = execSync('git diff HEAD~1 HEAD', { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
    }
  } catch {
    diff = 'Could not generate diff.';
  }

  return `You are a senior code reviewer. Another AI agent just implemented changes to solve a GitHub issue. Your job is to review the code and find problems.

## Changes made (diff)
\`\`\`diff
${diff.slice(0, 50000)}
\`\`\`

## Changed files (current state)
${fileContents.join('\n\n').slice(0, 50000)}

## Your review checklist
1. **Bugs** — Logic errors, off-by-one, null/undefined issues, race conditions
2. **Security** — XSS, injection, exposed secrets, unsafe operations
3. **Missing edge cases** — Error handling, empty states, boundary conditions
4. **Code quality** — Dead code, unused imports, inconsistent naming
5. **Breaking changes** — Does this break existing functionality?

## How to respond
If you find issues, list them clearly:

REVIEW_START
ISSUES_FOUND: yes

- **[BUG]** file.ts:23 — Description of the bug
- **[SECURITY]** file.ts:45 — Description of the security issue
- **[EDGE_CASE]** file.ts:67 — Missing error handling for X
- **[QUALITY]** file.ts:89 — Unused import

FIX_INSTRUCTIONS:
1. In file.ts line 23, change X to Y because...
2. In file.ts line 45, add input sanitization...
REVIEW_END

If everything looks good:

REVIEW_START
ISSUES_FOUND: no
The implementation looks correct. No issues found.
REVIEW_END`;
}

function buildFixPrompt(reviewOutput) {
  return `You are an autonomous software engineer. A code reviewer found issues in your implementation. Fix them.

## Review feedback
${reviewOutput}

## What you need to do
1. Read the files mentioned in the review
2. Fix each issue the reviewer found
3. Make sure you don't break anything else

## Rules
- Only fix what the reviewer flagged — nothing more
- Do NOT run git add, git commit, or git push
- When in doubt, make the smallest possible change

## After fixing
Write a short summary:
SUMMARY_START
[What you fixed based on the review]
SUMMARY_END`;
}

function parseReview(output) {
  const match = output.match(/REVIEW_START\s*([\s\S]*?)\s*REVIEW_END/);
  if (!match) return { hasIssues: false, review: null };

  const review = match[1].trim();
  const hasIssues = review.includes('ISSUES_FOUND: yes');

  return { hasIssues, review };
}

module.exports = { buildReviewPrompt, buildFixPrompt, parseReview };
