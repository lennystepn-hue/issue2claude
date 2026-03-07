const fs = require('fs');
const path = require('path');

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

function buildPrompt({ issueNumber, issueTitle, issueBody, comments, config }) {
  const claudeMd = readFileIfExists(path.join(process.cwd(), 'CLAUDE.md'));
  const configContent = readFileIfExists(path.join(process.cwd(), '.issue2claude.yml'));

  // Read additional context files from config
  let additionalContext = '';
  if (config.context_files) {
    for (const file of config.context_files) {
      const content = readFileIfExists(path.join(process.cwd(), file));
      if (content) {
        additionalContext += `\n### ${file}\n${content}\n`;
      }
    }
  }

  // Build restricted paths section
  let restrictedSection = '';
  if (config.restricted_paths && config.restricted_paths.length > 0) {
    restrictedSection = `- Do NOT touch: ${config.restricted_paths.join(', ')}`;
  } else {
    restrictedSection = '- Do NOT touch: .env*, secrets/, .github/workflows/';
  }

  // Build comments section
  let commentsSection = '';
  if (comments && comments.length > 0) {
    commentsSection = comments
      .map(c => `**@${c.user}** (${c.date}):\n${c.body}`)
      .join('\n\n');
  }

  const prompt = `You are an autonomous software engineer solving GitHub Issues.

## Your task
GitHub Issue #${issueNumber}: "${issueTitle}"

## Issue description
${issueBody || 'No description provided.'}

${commentsSection ? `## Issue comments (for more context)\n${commentsSection}` : ''}

## Project context
${claudeMd ? `### CLAUDE.md\n${claudeMd}` : ''}
${configContent ? `### .issue2claude.yml\n${configContent}` : ''}
${additionalContext}

## What you need to do
1. Analyze the issue carefully
2. Find the relevant files in the repo
3. Implement the solution
4. Make sure existing tests still pass
5. Write tests for new functionality where it makes sense

## Rules
- Only do what the issue asks — nothing more
- Do not change files unrelated to the issue
${restrictedSection}
- When in doubt, make the smallest possible change
- Write code comments in English
- If you cannot fully solve the issue: still commit what you have
  and explain in the commit message what is missing

## After implementation
Write a short summary of what you did.
Format:
SUMMARY_START
[What you changed, which files, why this approach]
SUMMARY_END`;

  return prompt;
}

module.exports = { buildPrompt, readFileIfExists };
