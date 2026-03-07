const core = require('@actions/core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function buildConflictPrompt(conflictFiles, baseBranch) {
  // Read conflict markers from files
  const conflicts = [];
  for (const file of conflictFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      conflicts.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
    } catch {
      conflicts.push(`### ${file}\n(could not read)`);
    }
  }

  return `You are an autonomous software engineer resolving merge conflicts.

## Situation
A feature branch is being rebased onto \`${baseBranch}\`. There are merge conflicts in the following files.

## Conflicted files
${conflicts.join('\n\n')}

## What you need to do
1. Read each conflicted file
2. Understand both sides of the conflict (the feature changes AND the base branch changes)
3. Resolve each conflict by keeping BOTH sets of changes where possible
4. If changes are truly incompatible, prefer the feature branch changes but make sure the code compiles/works
5. Remove ALL conflict markers (<<<<<<, ======, >>>>>>)

## Rules
- Resolve ALL conflicts — do not leave any conflict markers
- Make sure the resulting code is valid and compiles
- Keep as much of both sides as possible
- Do NOT run git add, git commit, or git push — the CI system handles that
- Do NOT change any files that don't have conflicts

## After resolving
SUMMARY_START
[Which files had conflicts, how you resolved each one]
SUMMARY_END`;
}

function getConflictFiles() {
  try {
    const output = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf-8' }).trim();
    return output ? output.split('\n') : [];
  } catch {
    return [];
  }
}

module.exports = { buildConflictPrompt, getConflictFiles };
