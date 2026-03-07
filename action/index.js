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

function describeToolUse(toolName, toolInput) {
  switch (toolName) {
    case 'Read':
      return `Reading \`${toolInput.file_path || 'file'}\``;
    case 'Write':
      return `Writing \`${toolInput.file_path || 'file'}\``;
    case 'Edit':
      return `Editing \`${toolInput.file_path || 'file'}\``;
    case 'Glob':
      return `Searching for \`${toolInput.pattern || 'files'}\``;
    case 'Grep':
      return `Searching for \`${toolInput.pattern || 'text'}\``;
    case 'Bash':
      const cmd = (toolInput.command || '').slice(0, 80);
      return `Running \`${cmd}\``;
    default:
      return `Using ${toolName}`;
  }
}

async function runClaude(prompt, model, updater) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const args = [
      '-p', prompt,
      '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep',
      '--max-turns', '30',
      '--output-format', 'stream-json',
      '--model', model,
      '--dangerously-skip-permissions',
    ];

    const child = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let lastResult = null;
    let lastAssistantText = '';
    let activities = [];
    let filesChanged = new Set();
    let lastUpdateTime = 0;
    let buffer = '';

    function trackActivity(desc) {
      activities.push(desc);
      if (activities.length > 8) activities.shift();
    }

    async function pushUpdate() {
      const now = Date.now();
      // Rate limit: max one update per 30 seconds
      if (now - lastUpdateTime < 30000) return;
      lastUpdateTime = now;

      const elapsed = Math.round((now - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

      const lines = [
        `**Issue2Claude working** — #${updater.issueNumber}`,
        '',
        `**Elapsed:** ${timeStr}`,
      ];

      if (filesChanged.size > 0) {
        lines.push('', `**Files touched:** ${filesChanged.size}`);
        const fileList = [...filesChanged].slice(-5);
        fileList.forEach(f => lines.push(`- \`${f}\``));
        if (filesChanged.size > 5) lines.push(`- ... and ${filesChanged.size - 5} more`);
      }

      if (activities.length > 0) {
        lines.push('', '**Recent activity:**');
        activities.slice(-5).forEach(a => lines.push(`- ${a}`));
      }

      try {
        await updater.updateProgress(lines.join('\n'));
      } catch {
        // Ignore update errors
      }
    }

    child.stdout.on('data', (data) => {
      buffer += data.toString();

      // Parse newline-delimited JSON events
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === 'result') {
            lastResult = event;
          } else if (event.type === 'assistant' && event.message) {
            // Track tool use from assistant messages
            const msg = event.message;
            if (msg.content && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_use') {
                  const desc = describeToolUse(block.name, block.input || {});
                  trackActivity(desc);
                  core.info(`Claude: ${desc}`);

                  // Track files
                  const fp = block.input?.file_path;
                  if (fp && (block.name === 'Write' || block.name === 'Edit')) {
                    filesChanged.add(fp.replace(process.cwd() + '/', ''));
                  }

                  pushUpdate();
                } else if (block.type === 'text' && block.text) {
                  lastAssistantText = block.text;
                }
              }
            }
          }
        } catch {
          // Skip unparseable lines
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Fallback: update every 60s even without events
    const fallbackInterval = setInterval(() => {
      lastUpdateTime = 0; // Force update
      pushUpdate();
    }, 60000);

    child.on('close', (code) => {
      clearInterval(fallbackInterval);
      const duration = Date.now() - startTime;

      if (code !== 0 && !lastResult && !lastAssistantText) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        return;
      }

      const result = {
        output: lastResult?.result || lastAssistantText || '',
        cost: lastResult?.cost_usd || null,
        duration: lastResult?.duration_ms || duration,
        turns: lastResult?.num_turns || null,
        exitCode: code,
        stderr,
        filesChanged: [...filesChanged],
      };
      resolve(result);
    });

    child.on('error', (err) => {
      clearInterval(fallbackInterval);
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
