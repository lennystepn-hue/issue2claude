const core = require('@actions/core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Quick complexity analysis using a fast model to decide which model to use.
 * Returns 'simple' or 'complex'.
 */
async function analyzeComplexity(issueTitle, issueBody, spawn) {
  const prompt = `You are a complexity estimator. Analyze this GitHub issue and respond with ONLY one word: "simple" or "complex".

Simple = typo fix, config change, rename, add a single field, small UI tweak, documentation
Complex = new feature, refactor, multiple files, new API endpoint, architecture change, anything requiring tests

Issue: "${issueTitle}"
${issueBody || ''}

Respond with ONLY "simple" or "complex". Nothing else.`;

  const promptFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'complexity-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  try {
    const output = execSync(
      `cat "${promptFile}" | claude -p - --max-turns 1 --output-format text --model claude-sonnet-4-6 --dangerously-skip-permissions`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim().toLowerCase();

    if (output.includes('simple')) return 'simple';
    return 'complex';
  } catch (e) {
    core.warning(`Complexity analysis failed: ${e.message}, defaulting to complex`);
    return 'complex';
  }
}

/**
 * Pick the right model based on complexity.
 */
function pickModel(complexity, config) {
  const models = config.smart_model || {};

  if (complexity === 'simple') {
    return models.simple || 'claude-sonnet-4-6';
  }
  return models.complex || 'claude-opus-4-6';
}

module.exports = { analyzeComplexity, pickModel };
