const core = require('@actions/core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONTEXT_FILE = '.issue2claude-context.md';

/**
 * Read existing context file from repo.
 */
function readContext() {
  const filePath = path.join(process.cwd(), CONTEXT_FILE);
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

/**
 * After a successful run, generate a learning entry and append to context file.
 * Called after PR is created, with info about what Claude did.
 */
function buildLearningPrompt(summary, filesChanged) {
  const existingContext = readContext();

  return `You are updating a project knowledge file. Based on what was just done, extract 1-3 short, reusable facts about this codebase.

## What was just done
${summary}

## Files changed
${filesChanged.map(f => `- ${f}`).join('\n')}

## Existing knowledge (do NOT repeat these)
${existingContext || '(none yet)'}

## Rules
- Only add NEW facts not already in the existing knowledge
- Each fact should be a single line starting with "- "
- Focus on: tech stack, patterns, conventions, file structure, naming
- Be specific: "Components use .tsx in src/components/" not "Uses React"
- If nothing new was learned, respond with NOTHING_NEW
- Maximum 3 new facts

## Output format
Respond with ONLY the new facts (one per line, starting with "- ") or NOTHING_NEW.`;
}

/**
 * Append new learnings to the context file and commit.
 */
function appendContext(newFacts) {
  const filePath = path.join(process.cwd(), CONTEXT_FILE);
  const existing = readContext();

  if (!existing) {
    // Create new file with header
    const content = `# Issue2Claude Context\n\nAutomatically learned patterns from this repo. Read by Claude on every run.\n\n${newFacts}\n`;
    fs.writeFileSync(filePath, content);
  } else {
    // Append to existing
    fs.appendFileSync(filePath, `\n${newFacts}\n`);
  }

  return filePath;
}

/**
 * Run the learning step: analyze what was done, extract facts, commit context file.
 * This is a lightweight call — uses Sonnet with 1 turn.
 */
async function learnFromRun(summary, filesChanged) {
  if (!summary || filesChanged.length === 0) return null;

  const prompt = buildLearningPrompt(summary, filesChanged);
  const promptFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'learning-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  try {
    const output = execSync(
      `cat "${promptFile}" | claude -p - --max-turns 1 --output-format text --model claude-sonnet-4-6 --dangerously-skip-permissions`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();

    if (!output || output === 'NOTHING_NEW' || output.length < 5) {
      core.info('Context learning: nothing new to learn.');
      return null;
    }

    // Only keep lines starting with "- "
    const facts = output.split('\n').filter(l => l.startsWith('- ')).join('\n');
    if (!facts) return null;

    core.info(`Context learning: adding ${facts.split('\n').length} new fact(s)`);
    const filePath = appendContext(facts);

    return { filePath, facts };
  } catch (e) {
    core.warning(`Context learning failed (non-fatal): ${e.message}`);
    return null;
  }
}

module.exports = { readContext, learnFromRun, CONTEXT_FILE };
