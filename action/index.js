const core = require('@actions/core');
const github = require('@actions/github');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { buildPrompt, readFileIfExists } = require('./prompt-builder');
const { IssueUpdater } = require('./issue-updater');
const { createPR } = require('./pr-creator');
const { fetchPRContext, buildFeedbackPrompt } = require('./pr-feedback');

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

function setupAuth(authMode, apiKey, oauthToken) {
  if (authMode === 'max' || authMode === 'oauth') {
    if (!oauthToken) {
      core.setFailed('oauth-token is required when auth-mode is "max"');
      return false;
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
      return false;
    }
    process.env.ANTHROPIC_API_KEY = apiKey;
    core.info('Auth mode: API Key');
  }
  return true;
}

async function runIssueMode({ octokit, owner, repo, issueNumber, issueTitle, issueBody, model, config }) {
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

async function runPRFeedbackMode({ octokit, owner, repo, prNumber, model, config }) {
  const updater = new IssueUpdater(octokit, owner, repo, prNumber);

  try {
    core.info(`Starting Issue2Claude PR feedback for PR #${prNumber}`);

    // Post start comment on the PR
    await octokit.rest.issues.createComment({
      owner, repo, issue_number: prNumber,
      body: [
        '**Issue2Claude — Applying feedback**',
        '',
        'Claude is reading your review comments and applying changes...',
        '',
        `\`Model: ${model}\``,
      ].join('\n'),
    });

    // Fetch PR context (diff, comments, review comments)
    const ctx = await fetchPRContext(octokit, owner, repo, prNumber);
    core.info(`PR #${prNumber}: "${ctx.pr.title}", ${ctx.reviewComments.length} review comments, ${ctx.issueComments.length} issue comments`);

    // Checkout the PR branch
    const prBranch = ctx.pr.head.ref;
    core.info(`Checking out PR branch: ${prBranch}`);
    execSync(`git fetch origin ${prBranch}`);
    execSync(`git checkout ${prBranch}`);

    // Build feedback prompt
    const prompt = buildFeedbackPrompt({ pr: ctx.pr, diff: ctx.diff, reviewComments: ctx.reviewComments, issueComments: ctx.issueComments, config });
    core.info('Feedback prompt built successfully');

    const result = await runClaude(prompt, model, updater);
    core.info(`Claude finished in ${Math.round(result.duration / 1000)}s`);

    // Check for changes
    let gitStatus = execSync('git status --porcelain').toString().trim();
    const newCommits = execSync('git log --oneline HEAD --not --remotes 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();

    if (!gitStatus && newCommits) {
      core.info(`Claude made ${newCommits.split('\n').length} commit(s) — resetting for our commit flow`);
      const baseCommit = execSync(`git rev-parse origin/${prBranch}`, { encoding: 'utf-8' }).trim();
      execSync(`git reset --soft ${baseCommit}`);
      gitStatus = execSync('git status --porcelain').toString().trim();
    }

    if (!gitStatus) {
      await octokit.rest.issues.createComment({
        owner, repo, issue_number: prNumber,
        body: '**Issue2Claude — No changes needed**\n\nClaude reviewed the feedback but determined no code changes were necessary.',
      });
      return;
    }

    // Commit and push to the same PR branch
    execSync('git config user.email "issue2claude[bot]@users.noreply.github.com"');
    execSync('git config user.name "Issue2Claude"');
    execSync('git add -A');

    const summary = parseSummary(result.output) || 'Applied review feedback.';
    const commitMsg = `fix: apply review feedback on PR #${prNumber}`;
    const commitFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'commit-msg.txt');
    fs.writeFileSync(commitFile, commitMsg);
    execSync(`git commit -F "${commitFile}"`);
    execSync(`git push origin ${prBranch}`);

    core.info(`Pushed feedback changes to ${prBranch}`);

    const durationMin = Math.round(result.duration / 60000);
    await octokit.rest.issues.createComment({
      owner, repo, issue_number: prNumber,
      body: [
        '**Issue2Claude — Feedback applied!**',
        '',
        '**What Claude changed:**',
        summary,
        '',
        `**Cost:** ~$${result.cost ? result.cost.toFixed(2) : '?'} | **Duration:** ${durationMin}min`,
        '',
        'Please review the new changes.',
      ].join('\n'),
    });

  } catch (error) {
    core.error(`Issue2Claude PR feedback failed: ${error.message}`);
    await octokit.rest.issues.createComment({
      owner, repo, issue_number: prNumber,
      body: `**Issue2Claude — Error applying feedback**\n\n${error.message}\n\nComment \`claude-fix\` to try again.`,
    });
    core.setFailed(error.message);
  }
}

async function run() {
  const authMode = core.getInput('auth-mode') || 'api-key';
  const apiKey = core.getInput('anthropic-api-key');
  const oauthToken = core.getInput('oauth-token');
  const githubToken = core.getInput('github-token', { required: true });
  const repoFull = core.getInput('repo', { required: true });
  const modelInput = core.getInput('model');
  const mode = core.getInput('mode') || 'issue';

  const [owner, repo] = repoFull.split('/');

  if (!setupAuth(authMode, apiKey, oauthToken)) return;
  process.env.GITHUB_TOKEN = githubToken;

  const octokit = github.getOctokit(githubToken);
  const config = loadConfig();
  const model = modelInput || config.model || 'claude-opus-4-6';

  if (mode === 'pr-feedback') {
    const prNumber = parseInt(core.getInput('pr-number'), 10);
    if (!prNumber) {
      core.setFailed('pr-number is required for pr-feedback mode');
      return;
    }
    await runPRFeedbackMode({ octokit, owner, repo, prNumber, model, config });
  } else {
    const issueNumber = parseInt(core.getInput('issue-number'), 10);
    const issueTitle = core.getInput('issue-title');
    const issueBody = core.getInput('issue-body');
    if (!issueNumber) {
      core.setFailed('issue-number is required for issue mode');
      return;
    }
    await runIssueMode({ octokit, owner, repo, issueNumber, issueTitle, issueBody, model, config });
  }
}

run();
