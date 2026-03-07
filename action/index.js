const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { query } = require('@anthropic-ai/claude-agent-sdk');

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
  let lastResultText = '';
  let phase = 'starting';

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

  async function pushUpdate() {
    const now = Date.now();
    if (now - lastUpdateTime < 20000) return;
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

    if (filesRead.size > 0) {
      lines.push('', `**Files read:** ${filesRead.size}`);
    }

    if (filesChanged.size > 0) {
      lines.push('', `**Files modified:** ${filesChanged.size}`);
      [...filesChanged].forEach(f => lines.push(`- \`${f}\``));
    }

    if (activities.length > 0) {
      lines.push('', '**Recent activity:**');
      const now2 = Date.now();
      activities.slice(-6).forEach(a => {
        const ago = Math.round((now2 - a.time) / 1000);
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

  // Run Claude via SDK
  core.info(`Running Claude via Agent SDK (model: ${model})...`);

  const options = {
    maxTurns: 30,
    model,
    permissionMode: 'dangerouslySkipPermissions',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  };

  let resultMessage = null;

  try {
    for await (const message of query({ prompt, options })) {
      eventCount++;

      if (message.type === 'system' && message.subtype === 'init') {
        core.info(`Claude initialized: model=${message.model || model}, session=${message.session_id || 'unknown'}`);
        trackActivity('Claude Code initialized');
        await pushUpdate();
      }

      if (message.type === 'assistant') {
        turnCount++;
        if (message.message?.content && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
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
              await pushUpdate();
            } else if (block.type === 'text' && block.text) {
              lastResultText = block.text;
              const preview = block.text.slice(0, 150).replace(/\n/g, ' ');
              core.info(`[Turn ${turnCount}] Claude: ${preview}`);
            }
          }
        }
      }

      if (message.type === 'result') {
        resultMessage = message;
        core.info(`Claude finished: cost=$${message.total_cost_usd || '?'}, turns=${message.num_turns || '?'}, subtype=${message.subtype}`);
      }
    }
  } catch (error) {
    core.error(`SDK execution error: ${error.message}`);
    throw error;
  }

  const duration = Date.now() - startTime;

  if (!resultMessage) {
    throw new Error('No result message received from Claude');
  }

  return {
    output: lastResultText,
    cost: resultMessage.total_cost_usd || null,
    duration: resultMessage.duration_ms || duration,
    turns: resultMessage.num_turns || turnCount,
    exitCode: resultMessage.subtype === 'success' ? 0 : 1,
    filesChanged: [...filesChanged],
  };
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
    // Extract access token if full JSON provided
    let token = oauthToken;
    try {
      const parsed = JSON.parse(oauthToken);
      if (parsed.claudeAiOauth?.accessToken) {
        token = parsed.claudeAiOauth.accessToken;
      }
    } catch {
      // Already a plain token
    }
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
    core.info('Auth mode: Claude Max/Pro (OAuth)');
    core.info(`Token set (${token.slice(0, 20)}...)`);
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

    // Step 4: Run Claude Code via SDK
    const result = await runClaude(prompt, model, updater);
    core.info(`Claude finished in ${Math.round(result.duration / 1000)}s`);

    if (result.exitCode !== 0) {
      core.warning(`Claude finished with errors, checking for changes anyway...`);
    }

    // Step 5: Check for git changes
    const gitStatus = execSync('git status --porcelain').toString().trim();

    if (!gitStatus) {
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
