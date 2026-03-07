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

  // Create branch, stage, commit
  execSync(`git checkout -b ${branchName}`);
  execSync('git add -A');

  // Write commit message to file to avoid escaping issues
  const commitMsg = `feat: ${issueTitle} (closes #${issueNumber})`;
  const commitFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'commit-msg.txt');
  fs.writeFileSync(commitFile, commitMsg);
  execSync(`git commit -F "${commitFile}"`);
  execSync(`git push origin ${branchName}`);

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

  // Write PR title and body to files to avoid shell escaping issues
  const prTitle = `feat: ${issueTitle} (#${issueNumber})`;
  const titleFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'pr-title.txt');
  const bodyFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'pr-body.md');
  fs.writeFileSync(titleFile, prTitle);
  fs.writeFileSync(bodyFile, prBody);

  const prUrl = execSync(
    `gh pr create --title "$(cat '${titleFile}')" --body-file "${bodyFile}" --base ${baseBranch} --head ${branchName}`,
    { encoding: 'utf-8' }
  ).trim();

  const prNumber = prUrl.split('/').pop();

  return { prNumber, prUrl, branchName };
}

module.exports = { createPR, slugify };
