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
    const TIMEOUT_MS = 15 * 60 * 1000; // 15 min hard timeout
    const STALL_MS = 3 * 60 * 1000; // 3 min no output = stalled

    const args = [
      '-p', prompt,
      '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep',
      '--max-turns', '30',
      '--output-format', 'stream-json',
      '--model', model,
      '--dangerously-skip-permissions',
    ];

    core.info(`Spawning: claude ${args.join(' ').slice(0, 200)}...`);

    const child = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let lastResult = null;
    let lastAssistantText = '';
    let activities = [];
    let filesChanged = new Set();
    let filesRead = new Set();
    let lastUpdateTime = 0;
    let lastOutputTime = Date.now();
    let eventCount = 0;
    let turnCount = 0;
    let buffer = '';
    let phase = 'starting'; // starting, analyzing, implementing, testing, finishing
    let hasReceivedOutput = false;

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

    const phaseLabels = {
      starting: 'Starting up...',
      analyzing: 'Analyzing codebase',
      implementing: 'Writing code',
      testing: 'Running tests',
      finishing: 'Wrapping up',
    };

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
        `| **Turns** | ${turnCount} / 30 |`,
        `| **Events** | ${eventCount} |`,
      ];

      if (!hasReceivedOutput) {
        lines.push('', '> Waiting for Claude Code to start producing output...');
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
          const ago = Math.round((now - a.time) / 1000);
          const agoStr = ago < 60 ? `${ago}s ago` : `${Math.floor(ago/60)}m ago`;
          lines.push(`- ${a.desc} *(${agoStr})*`);
        });
      }

      // Stall warning
      const silentSec = Math.round((now - lastOutputTime) / 1000);
      if (silentSec > 120 && hasReceivedOutput) {
        lines.push('', `> No output for ${silentSec}s — Claude may be processing a large task or waiting on rate limits`);
      }

      if (stderr) {
        const lastStderr = stderr.slice(-300).trim();
        if (lastStderr) {
          lines.push('', '**Stderr (last):**', '```', lastStderr, '```');
        }
      }

      try {
        await updater.updateProgress(lines.join('\n'));
      } catch (e) {
        core.warning(`Failed to update progress: ${e.message}`);
      }
    }

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      buffer += chunk;
      lastOutputTime = Date.now();
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
            core.info(`Claude result received: cost=$${event.cost_usd || '?'}, turns=${event.num_turns || '?'}`);
          } else if (event.type === 'assistant' && event.message) {
            turnCount = event.message.turn || turnCount;
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
                  // Log short thinking snippets
                  const preview = block.text.slice(0, 150).replace(/\n/g, ' ');
                  core.info(`[Turn ${turnCount}] Claude: ${preview}...`);
                }
              }
            }
          } else if (event.type === 'error') {
            const errMsg = event.error?.message || event.message || JSON.stringify(event);
            core.error(`Claude stream error: ${errMsg}`);
            trackActivity(`Error: ${errMsg.slice(0, 100)}`);
            pushUpdate(true);
          }
        } catch {
          // Skip unparseable lines
        }
      }
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      core.warning(`Claude stderr: ${chunk.trim()}`);

      // If we see auth errors, immediately report
      if (chunk.match(/unauthorized|auth|token.*invalid|403|401/i)) {
        trackActivity(`Auth error: ${chunk.trim().slice(0, 100)}`);
        pushUpdate(true);
      }
    });

    // Update every 30s, detect stalls
    const monitorInterval = setInterval(async () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const silent = now - lastOutputTime;

      // Hard timeout
      if (elapsed > TIMEOUT_MS) {
        core.error(`Hard timeout reached (${TIMEOUT_MS/1000}s). Killing Claude.`);
        trackActivity('TIMEOUT — killed after 15 minutes');
        await pushUpdate(true);
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
        return;
      }

      // Stall detection (only after we've received some output)
      if (hasReceivedOutput && silent > STALL_MS) {
        core.warning(`No output for ${Math.round(silent/1000)}s — possible stall`);
      }

      // Force update
      lastUpdateTime = 0;
      pushUpdate();
    }, 30000);

    // Initial update after 5s to confirm startup
    setTimeout(() => {
      if (!hasReceivedOutput) {
        trackActivity('Waiting for Claude Code to initialize...');
        core.info('No output from Claude yet after 5s');
      }
      pushUpdate(true);
    }, 5000);

    child.on('close', (code) => {
      clearInterval(monitorInterval);
      const duration = Date.now() - startTime;

      core.info(`Claude process exited with code ${code} after ${Math.round(duration/1000)}s`);
      core.info(`Events received: ${eventCount}, Turns: ${turnCount}, Files changed: ${filesChanged.size}`);

      if (stderr) {
        core.info(`Stderr output:\n${stderr.slice(-500)}`);
      }

      if (code !== 0 && !lastResult && !lastAssistantText) {
        const errMsg = stderr
          ? `Claude exited with code ${code}:\n${stderr.slice(-500)}`
          : `Claude exited with code ${code} (no output received — check auth config)`;
        reject(new Error(errMsg));
        return;
      }

      if (!hasReceivedOutput) {
        reject(new Error('Claude produced no output at all — likely an auth or startup issue. Check CLAUDE_OAUTH_TOKEN or ANTHROPIC_API_KEY.'));
        return;
      }

      const result = {
        output: lastResult?.result || lastAssistantText || '',
        cost: lastResult?.cost_usd || null,
        duration: lastResult?.duration_ms || duration,
        turns: lastResult?.num_turns || turnCount,
        exitCode: code,
        stderr,
        filesChanged: [...filesChanged],
      };
      resolve(result);
    });

    child.on('error', (err) => {
      clearInterval(monitorInterval);
      core.error(`Failed to spawn Claude: ${err.message}`);
      reject(new Error(`Failed to spawn Claude Code: ${err.message}. Is @anthropic-ai/claude-code installed?`));
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
    // The token should be the full JSON content of ~/.claude/.credentials.json
    const claudeDir = path.join(process.env.HOME || '/root', '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    // Support both raw JSON and plain access token
    let credContent;
    try {
      const parsed = JSON.parse(oauthToken);
      if (parsed.claudeAiOauth) {
        // Full credentials JSON — write as-is
        credContent = oauthToken;
      } else {
        // Unknown structure, wrap it
        credContent = JSON.stringify(parsed);
      }
    } catch {
      // Plain access token string — build the credentials structure
      credContent = JSON.stringify({
        claudeAiOauth: {
          accessToken: oauthToken,
        },
      });
    }

    fs.writeFileSync(path.join(claudeDir, '.credentials.json'), credContent);
    core.info('Auth mode: Claude Max/Pro (OAuth)');
    core.info(`Credentials written to ${claudeDir}/.credentials.json`);
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
