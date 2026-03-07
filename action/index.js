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
      model: 'claude-opus-4-6',
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
    case 'Bash': {
      const cmd = (toolInput.command || '').slice(0, 80);
      return `Running \`${cmd}\``;
    }
    default:
      return `Using ${toolName}`;
  }
}

async function runClaude(prompt, model, updater) {
  const startTime = Date.now();
  const activities = [];
  const filesChanged = new Set();
  const filesRead = new Set();
  let turnCount = 0;
  let eventCount = 0;
  let lastUpdateTime = 0;
  let phase = 'starting';
  let hasReceivedOutput = false;

  const phaseLabels = {
    starting: 'Starting up...',
    analyzing: 'Analyzing codebase',
    implementing: 'Writing code',
    testing: 'Running tests',
    finishing: 'Wrapping up',
  };

  function trackActivity(desc) {
    activities.push({ time: Date.now(), desc });
    if (activities.length > 10) activities.shift();
  }

  function detectPhase() {
    const recent = activities.slice(-3).map(a => a.desc).join(' ');
    if (recent.match(/test|spec|jest|vitest|npm run/i)) return 'testing';
    if (recent.match(/Write|Edit/)) return 'implementing';
    if (recent.match(/Read|Glob|Grep|Search/)) return 'analyzing';
    return phase;
  }

  async function pushUpdate(force) {
    const now = Date.now();
    if (!force && now - lastUpdateTime < 20000) return;
    lastUpdateTime = now;

    phase = detectPhase();
    const elapsed = Math.round((now - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    const lines = [
      `**Issue2Claude working** — #${updater.issueNumber}`,
      '',
      `| | |`,
      `|---|---|`,
      `| **Phase** | ${phaseLabels[phase] || phase} |`,
      `| **Elapsed** | ${timeStr} |`,
      `| **Turns** | ${turnCount} / 3000 |`,
      `| **Events** | ${eventCount} |`,
    ];

    if (!hasReceivedOutput) {
      lines.push('', '> Waiting for Claude to respond...');
    }

    if (filesRead.size > 0) {
      lines.push('', `**Files read:** ${filesRead.size}`);
    }

    if (filesChanged.size > 0) {
      lines.push('', `**Files modified:** ${filesChanged.size}`);
      [...filesChanged].forEach(f => lines.push(`- \`${f}\``));
    }

    if (activities.length > 0) {
      lines.push('', '**Recent activity:**');
      activities.slice(-6).forEach(a => {
        const ago = Math.round((Date.now() - a.time) / 1000);
        const agoStr = ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`;
        lines.push(`- ${a.desc} *(${agoStr})*`);
      });
    }

    try {
      await updater.updateProgress(lines.join('\n'));
    } catch (e) {
      core.warning(`Failed to update progress: ${e.message}`);
    }
  }

  // Write prompt to temp file to avoid shell escaping issues
  const promptFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'claude-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  core.info(`Running Claude CLI (model: ${model})...`);

  return new Promise((resolve, reject) => {
    // Use shell to read prompt from file
    const child = spawn('bash', ['-c', `cat "${promptFile}" | claude -p - --allowedTools Read,Write,Edit,Bash,Glob,Grep --max-turns 3000 --output-format stream-json --verbose --model ${model} --dangerously-skip-permissions`], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let lastResult = null;
    let lastAssistantText = '';
    let buffer = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      buffer += chunk;
      hasReceivedOutput = true;

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          eventCount++;

          if (event.type === 'result') {
            lastResult = event;
            phase = 'finishing';
            core.info(`Result: cost=$${event.cost_usd || event.total_cost_usd || '?'}, turns=${event.num_turns || '?'}`);
          } else if (event.type === 'assistant' && event.message) {
            turnCount++;
            const msg = event.message;
            if (msg.content && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_use') {
                  const desc = describeToolUse(block.name, block.input || {});
                  trackActivity(desc);
                  core.info(`[Turn ${turnCount}] ${desc}`);

                  const fp = block.input?.file_path;
                  if (fp) {
                    const relPath = fp.replace(process.cwd() + '/', '');
                    if (block.name === 'Write' || block.name === 'Edit') {
                      filesChanged.add(relPath);
                    } else if (block.name === 'Read') {
                      filesRead.add(relPath);
                    }
                  }
                  pushUpdate();
                } else if (block.type === 'text' && block.text) {
                  lastAssistantText = block.text;
                }
              }
            }
          } else if (event.type === 'error') {
            const errMsg = event.error?.message || event.message || JSON.stringify(event);
            core.error(`Claude error event: ${errMsg}`);
            trackActivity(`Error: ${errMsg.slice(0, 100)}`);
            pushUpdate(true);
          }
        } catch {
          // Skip unparseable
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Periodic updates
    const monitor = setInterval(() => {
      lastUpdateTime = 0;
      pushUpdate();
    }, 30000);

    // Initial update
    setTimeout(() => pushUpdate(true), 5000);

    child.on('close', (code) => {
      clearInterval(monitor);
      const duration = Date.now() - startTime;

      if (stderr) {
        core.info(`Claude stderr: ${stderr.slice(-300)}`);
      }

      if (code !== 0 && !lastResult && !lastAssistantText) {
        reject(new Error(`Claude exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }

      resolve({
        output: lastResult?.result || lastAssistantText || '',
        cost: lastResult?.cost_usd || lastResult?.total_cost_usd || null,
        duration: lastResult?.duration_ms || duration,
        turns: lastResult?.num_turns || turnCount,
        exitCode: code,
        filesChanged: [...filesChanged],
      });
    });

    child.on('error', (err) => {
      clearInterval(monitor);
      reject(new Error(`Failed to spawn Claude: ${err.message}`));
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

  // Set auth
  if (authMode === 'max' || authMode === 'oauth') {
    if (!oauthToken) {
      core.setFailed('oauth-token is required when auth-mode is "max"');
      return;
    }
    let token = oauthToken;
    try {
      const parsed = JSON.parse(oauthToken);
      if (parsed.claudeAiOauth?.accessToken) {
        token = parsed.claudeAiOauth.accessToken;
      }
    } catch { /* plain token */ }
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
    core.info(`Auth mode: Max/Pro (token: ${token.slice(0, 20)}...)`);
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
  const model = modelInput || config.model || 'claude-opus-4-6';
  const updater = new IssueUpdater(octokit, owner, repo, issueNumber);

  try {
    core.info(`Starting Issue2Claude for issue #${issueNumber}`);
    await updater.postStartComment(model);

    const comments = await updater.fetchComments();
    core.info(`Fetched ${comments.length} issue comments for context`);

    const prompt = buildPrompt({ issueNumber, issueTitle, issueBody, comments, config });
    core.info('Prompt built successfully');

    const result = await runClaude(prompt, model, updater);
    core.info(`Claude finished in ${Math.round(result.duration / 1000)}s`);

    if (result.exitCode !== 0) {
      core.warning(`Claude exited with code ${result.exitCode}, checking for changes anyway...`);
    }

    // Check for changes: either uncommitted OR committed by Claude
    let gitStatus = execSync('git status --porcelain').toString().trim();
    const newCommits = execSync('git log --oneline HEAD --not --remotes 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();

    if (!gitStatus && newCommits) {
      // Claude committed changes itself — reset to keep them as uncommitted
      core.info(`Claude made ${newCommits.split('\n').length} commit(s) — resetting to unstaged for our PR flow`);
      const baseCommit = execSync('git merge-base HEAD origin/HEAD 2>/dev/null || git rev-parse HEAD~1', { encoding: 'utf-8' }).trim();
      execSync(`git reset --soft ${baseCommit}`);
      gitStatus = execSync('git status --porcelain').toString().trim();
    }

    if (!gitStatus) {
      const summary = parseSummary(result.output) || result.output.slice(0, 500);
      core.info('No changes detected');
      await updater.postNoChangesComment(summary);
      return;
    }

    core.info('Changes detected, creating PR...');
    const summary = parseSummary(result.output) || 'Claude made changes but did not provide a structured summary.';

    const pr = await createPR({
      octokit, owner, repo, issueNumber, issueTitle, summary, model,
      cost: result.cost ? result.cost.toFixed(2) : null,
      duration: result.duration,
      tokens: result.turns ? `${result.turns} turns` : null,
    });

    core.info(`PR created: ${pr.prUrl}`);

    await updater.postFinishComment({
      prNumber: pr.prNumber, branchName: pr.branchName, summary,
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
