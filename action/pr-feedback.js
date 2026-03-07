const core = require('@actions/core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function fetchPRContext(octokit, owner, repo, prNumber) {
  // Get PR details
  const { data: pr } = await octokit.rest.pulls.get({
    owner, repo, pull_number: prNumber,
  });

  // Get PR diff
  const { data: diff } = await octokit.rest.pulls.get({
    owner, repo, pull_number: prNumber,
    mediaType: { format: 'diff' },
  });

  // Get review comments (inline comments on code)
  const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
    owner, repo, pull_number: prNumber, per_page: 100,
  });

  // Get issue comments (regular comments on the PR)
  const { data: issueComments } = await octokit.rest.issues.listComments({
    owner, repo, issue_number: prNumber, per_page: 100,
  });

  return { pr, diff, reviewComments, issueComments };
}

function buildFeedbackPrompt({ pr, diff, reviewComments, issueComments, config }) {
  const claudeMd = readFileIfExists(path.join(process.cwd(), 'CLAUDE.md'));

  // Filter to only human feedback (not bot comments)
  const humanReviewComments = reviewComments
    .filter(c => !c.user.login.includes('[bot]') && !c.body.includes('Issue2Claude'))
    .map(c => ({
      file: c.path,
      line: c.line || c.original_line,
      body: c.body,
      user: c.user.login,
      diff_hunk: c.diff_hunk,
    }));

  const humanIssueComments = issueComments
    .filter(c => !c.user.login.includes('[bot]') && !c.body.includes('Issue2Claude'))
    .filter(c => c.body.toLowerCase().includes('claude-fix') || c.body.toLowerCase().includes('claude fix'))
    .map(c => ({
      body: c.body.replace(/claude-fix/gi, '').trim(),
      user: c.user.login,
    }));

  // Build restricted paths section
  let restrictedSection = '';
  if (config.restricted_paths && config.restricted_paths.length > 0) {
    restrictedSection = `- Do NOT touch: ${config.restricted_paths.join(', ')}`;
  } else {
    restrictedSection = '- Do NOT touch: .env*, secrets/, .github/workflows/';
  }

  let feedbackSection = '';

  if (humanReviewComments.length > 0) {
    feedbackSection += '### Inline Review Comments\n';
    for (const c of humanReviewComments) {
      feedbackSection += `\n**@${c.user}** on \`${c.file}\`${c.line ? ` (line ${c.line})` : ''}:\n`;
      if (c.diff_hunk) {
        feedbackSection += `\`\`\`diff\n${c.diff_hunk}\n\`\`\`\n`;
      }
      feedbackSection += `> ${c.body}\n`;
    }
  }

  if (humanIssueComments.length > 0) {
    feedbackSection += '\n### General Feedback Comments\n';
    for (const c of humanIssueComments) {
      feedbackSection += `\n**@${c.user}:**\n${c.body}\n`;
    }
  }

  const prompt = `You are an autonomous software engineer applying review feedback to an existing Pull Request.

## Your task
Apply the requested changes from PR #${pr.number}: "${pr.title}"

## Original PR description
${pr.body || 'No description.'}

## Current diff of this PR
\`\`\`diff
${diff}
\`\`\`

## Review feedback to address
${feedbackSection || 'No specific feedback found.'}

## Project context
${claudeMd ? `### CLAUDE.md\n${claudeMd}` : ''}

## What you need to do
1. Read the review comments carefully
2. Find the relevant files
3. Apply the requested changes
4. Make sure existing tests still pass

## Rules
- Only address what the reviewers asked for — nothing more
- Do not change files unrelated to the feedback
${restrictedSection}
- When in doubt, make the smallest possible change
- Write code comments in English
- Do NOT run git add, git commit, or git push — the CI system handles that

## After implementation
Write a short summary of what you changed.
Format:
SUMMARY_START
[What you changed based on the review feedback]
SUMMARY_END`;

  return prompt;
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

module.exports = { fetchPRContext, buildFeedbackPrompt };
