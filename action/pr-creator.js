const core = require('@actions/core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function createPR({ octokit, owner, repo, issueNumber, issueTitle, summary, model, cost, duration, tokens }) {
  const slug = slugify(issueTitle);
  const branchName = `issue2claude/${issueNumber}-${slug}`;
  const baseBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();

  // Configure git
  execSync('git config user.email "issue2claude[bot]@users.noreply.github.com"');
  execSync('git config user.name "Issue2Claude"');

  // Create branch, stage (excluding workflow files — no workflows permission), commit
  execSync(`git checkout -b ${branchName}`);
  execSync('git reset HEAD .github/workflows/ 2>/dev/null || true');
  execSync('git checkout -- .github/workflows/ 2>/dev/null || true');
  execSync('git add -A');
  execSync('git reset HEAD .github/workflows/ 2>/dev/null || true');

  // Write commit message to file to avoid escaping issues
  const commitMsg = `feat: ${issueTitle} (closes #${issueNumber})`;
  const commitFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'commit-msg.txt');
  fs.writeFileSync(commitFile, commitMsg);
  execSync(`git commit -F "${commitFile}"`);
  execSync(`git push --force origin ${branchName}`);

  // Get changed files
  const changedFiles = execSync('git diff --name-only HEAD~1').toString().trim();

  const durationMin = Math.round(duration / 60000);

  // Build PR body
  const prBody = [
    `## Issue2Claude — Automatically generated`,
    '',
    `Closes #${issueNumber}`,
    '',
    '## What was done',
    summary || 'No summary available.',
    '',
    '## Changed files',
    changedFiles.split('\n').map(f => `- \`${f}\``).join('\n'),
    '',
    '## Notes',
    `- Automatically created by Issue2Claude`,
    `- Model: ${model}`,
    `- Token usage: ${tokens || 'N/A'}`,
    `- Cost: ~$${cost || '?'}`,
    `- Duration: ${durationMin}min`,
    '',
    '---',
    '*Please review before merging. If something is wrong: comment `claude-retry` on the issue.*',
  ].join('\n');

  // Write body to file, pass title inline (escaped)
  const prTitle = `feat: ${issueTitle} (#${issueNumber})`.replace(/"/g, '\\"').replace(/`/g, '');
  const bodyFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'pr-body.md');
  fs.writeFileSync(bodyFile, prBody);

  const cmd = `gh pr create --title "${prTitle}" --body-file "${bodyFile}" --base ${baseBranch} --head ${branchName}`;
  core.info(`PR command: ${cmd}`);
  const prUrl = execSync(cmd, { encoding: 'utf-8' }).trim();

  const prNumber = prUrl.split('/').pop();

  return { prNumber, prUrl, branchName };
}

module.exports = { createPR, slugify };
