const { execSync } = require('child_process');

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

  // Configure git
  execSync('git config user.email "issue2claude[bot]@users.noreply.github.com"');
  execSync('git config user.name "Issue2Claude"');

  // Create branch, stage, commit
  execSync(`git checkout -b ${branchName}`);
  execSync('git add -A');

  const commitMsg = `feat: ${issueTitle} (closes #${issueNumber})`;
  execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
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

  // Create PR via gh CLI
  const prUrl = execSync(
    `gh pr create --title "feat: ${issueTitle.replace(/"/g, '\\"')} (#${issueNumber})" --body "${prBody.replace(/"/g, '\\"')}" --base main --head ${branchName}`,
    { encoding: 'utf-8' }
  ).trim();

  // Extract PR number from URL
  const prNumber = prUrl.split('/').pop();

  return { prNumber, prUrl, branchName };
}

module.exports = { createPR, slugify };
