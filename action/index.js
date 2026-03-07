const core = require('@actions/core');
const github = require('@actions/github');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { buildPrompt, readFileIfExists } = require('./prompt-builder');
const { IssueUpdater } = require('./issue-updater');
const { createPR } = require('./pr-creator');

function loadConfig() {
  const configPath = path.join(process.cwd(), '.issue2claude.yml');
  const content = readFileIfExists(configPath);
  if (!content) {
    return {
      model: 'claude-sonnet-4-6',
      trigger_label: 'claude-ready',
      restricted_paths: ['.env*', 'secrets/', '*.key', '*.pem'],
      context_files: [],
      branch_prefix: 'issue2claude',
    };
  }
  return yaml.load(content);
}

function parseSummary(output) {
  const match = output.match(/SUMMARY_START\s*([\s\S]*?)\s*SUMMARY_END/);
  return match ? match[1].trim() : null;
}

function parseClaudeResult(stdout) {
  // Claude --output-format json returns a JSON object
  try {
    const result = JSON.parse(stdout);
    return {
      output: result.result || '',
      cost: result.cost_usd || null,
      duration: result.duration_ms || null,
      turns: result.num_turns || null,
    };
  } catch {
    // If JSON parsing fails, treat the whole output as text
    return {
      output: stdout,
      cost: null,
      duration: null,
      turns: null,
    };
  }
}

async function runClaude(prompt, model, updater) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const args = [
      '-p', prompt,
      '--allowedTools', 'Read,Write,Bash,Glob,Grep',
      '--max-turns', '30',
      '--output-format', 'json',
      '--model', model,
      '--dangerously-skip-permissions',
    ];

    const child = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Progress updates every 60 seconds
    const progressInterval = setInterval(async () => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      try {
        await updater.updateProgress(`Working... (${elapsed}s elapsed)`);
      } catch {
        // Ignore update errors
      }
    }, 60000);

    child.on('close', (code) => {
      clearInterval(progressInterval);
      const duration = Date.now() - startTime;

      if (code !== 0 && !stdout) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        return;
      }

      const result = parseClaudeResult(stdout);
      result.duration = result.duration || duration;
      result.exitCode = code;
      result.stderr = stderr;
      resolve(result);
    });

    child.on('error', (err) => {
      clearInterval(progressInterval);
      reject(err);
    });
  });
}

async function run() {
  const authMode = core.getInput('auth-mode') || 'api-key';
  const apiKey = core.getInput('anthropic-api-key');
  const oauthToken = core.getInput('oauth-token');
  const githubToken = core.getInput('github-token', { required: true });
  const issueNumber = parseInt(core.getInput('issue-number', { required: true }), 10);
  const issueTitle = core.getInput('issue-title', { required: true });
  const issueBody = core.getInput('issue-body', { required: true });
  const repoFull = core.getInput('repo', { required: true });
  const modelInput = core.getInput('model');

  const [owner, repo] = repoFull.split('/');

  // Set auth based on mode
  if (authMode === 'max' || authMode === 'oauth') {
    if (!oauthToken) {
      core.setFailed('oauth-token is required when auth-mode is "max"');
      return;
    }
    // Write credentials file so Claude Code picks up the OAuth session
    const claudeDir = path.join(process.env.HOME || '/root', '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, '.credentials.json'),
      JSON.stringify({ oauthToken }),
    );
    core.info('Auth mode: Claude Max/Pro (OAuth)');
  } else {
    if (!apiKey) {
      core.setFailed('anthropic-api-key is required when auth-mode is "api-key"');
      return;
    }
    process.env.ANTHROPIC_API_KEY = apiKey;
    core.info('Auth mode: API Key');
  }
  process.env.GITHUB_TOKEN = githubToken;

  const octokit = github.getOctokit(githubToken);
  const config = loadConfig();
  const model = modelInput || config.model || 'claude-sonnet-4-6';

  const updater = new IssueUpdater(octokit, owner, repo, issueNumber);

  try {
    // Step 1: Post start comment
    core.info(`Starting Issue2Claude for issue #${issueNumber}`);
    await updater.postStartComment(model);

    // Step 2: Fetch issue comments for context
    const comments = await updater.fetchComments();
    core.info(`Fetched ${comments.length} issue comments for context`);

    // Step 3: Build prompt
    const prompt = buildPrompt({
      issueNumber,
      issueTitle,
      issueBody,
      comments,
      config,
    });
    core.info('Prompt built successfully');

    // Step 4: Run Claude Code
    core.info(`Running Claude Code (model: ${model})...`);
    const result = await runClaude(prompt, model, updater);
    core.info(`Claude finished in ${Math.round(result.duration / 1000)}s`);

    if (result.exitCode !== 0) {
      core.warning(`Claude exited with code ${result.exitCode}, checking for changes anyway...`);
    }

    // Step 5: Check for git changes
    const gitStatus = execSync('git status --porcelain').toString().trim();

    if (!gitStatus) {
      // No changes made
      const summary = parseSummary(result.output) || result.output.slice(0, 500);
      core.info('No changes detected');
      await updater.postNoChangesComment(summary);
      return;
    }

    // Step 6: Create PR
    core.info(`Changes detected, creating PR...`);
    const summary = parseSummary(result.output) || 'Claude made changes but did not provide a structured summary.';

    const pr = await createPR({
      octokit,
      owner,
      repo,
      issueNumber,
      issueTitle,
      summary,
      model,
      cost: result.cost ? result.cost.toFixed(2) : null,
      duration: result.duration,
      tokens: result.turns ? `${result.turns} turns` : null,
    });

    core.info(`PR created: ${pr.prUrl}`);

    // Step 7: Post finish comment
    await updater.postFinishComment({
      prNumber: pr.prNumber,
      branchName: pr.branchName,
      summary,
      cost: result.cost ? result.cost.toFixed(2) : null,
      duration: result.duration,
      tokens: result.turns ? `${result.turns} turns` : null,
    });

    core.setOutput('pr-number', pr.prNumber);
    core.setOutput('pr-url', pr.prUrl);
    core.setOutput('branch', pr.branchName);

  } catch (error) {
    core.error(`Issue2Claude failed: ${error.message}`);
    await updater.postErrorComment(error.message);
    core.setFailed(error.message);
  }
}

run();
