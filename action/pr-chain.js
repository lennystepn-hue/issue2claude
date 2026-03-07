const core = require('@actions/core');

/**
 * Parse dependency declarations from issue body.
 * Supports: "depends-on: #12", "depends on #12, #13", "after #12"
 */
function parseDependencies(issueBody) {
  if (!issueBody) return [];

  const deps = [];
  // Match: depends-on: #12, depends on #12 #13, after #12
  const patterns = [
    /depends[- ]on:?\s*((?:#\d+[\s,]*)+)/gi,
    /after:?\s*((?:#\d+[\s,]*)+)/gi,
    /blocked[- ]by:?\s*((?:#\d+[\s,]*)+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(issueBody)) !== null) {
      const numbers = match[1].match(/#(\d+)/g);
      if (numbers) {
        deps.push(...numbers.map(n => parseInt(n.replace('#', ''), 10)));
      }
    }
  }

  return [...new Set(deps)]; // deduplicate
}

/**
 * Check if all dependency issues are resolved (closed or have merged PRs).
 */
async function checkDependencies(octokit, owner, repo, dependencies) {
  const results = [];

  for (const depNumber of dependencies) {
    try {
      const { data: issue } = await octokit.rest.issues.get({
        owner, repo, issue_number: depNumber,
      });

      const resolved = issue.state === 'closed';

      // Also check if there's a merged PR referencing this issue
      let mergedPR = null;
      if (resolved) {
        // Look for PRs that close this issue
        const { data: events } = await octokit.rest.issues.listEventsForTimeline({
          owner, repo, issue_number: depNumber, per_page: 100,
        });

        const crossRef = events.find(e =>
          e.event === 'cross-referenced' &&
          e.source?.issue?.pull_request?.merged_at
        );

        if (crossRef) {
          mergedPR = crossRef.source.issue.number;
        }
      }

      results.push({
        number: depNumber,
        title: issue.title,
        state: issue.state,
        resolved,
        mergedPR,
      });
    } catch (e) {
      core.warning(`Could not check dependency #${depNumber}: ${e.message}`);
      results.push({
        number: depNumber,
        title: '(unknown)',
        state: 'unknown',
        resolved: false,
        mergedPR: null,
      });
    }
  }

  return results;
}

/**
 * Check if the current issue's branch should be based on a dependency's branch.
 * If dependency has an open PR, we base our branch on that PR's branch.
 */
async function findBaseBranch(octokit, owner, repo, dependencies) {
  // Find the most recent dependency that has an open or merged PR
  for (const depNumber of dependencies.reverse()) {
    try {
      // Search for PRs that reference this issue
      const { data: prs } = await octokit.rest.pulls.list({
        owner, repo, state: 'all', per_page: 50,
      });

      const depPR = prs.find(pr =>
        pr.body && pr.body.includes(`#${depNumber}`) &&
        (pr.state === 'open' || pr.merged_at)
      );

      if (depPR) {
        if (depPR.merged_at) {
          // Dependency PR was merged — use the base branch it merged into
          core.info(`Dependency #${depNumber} was merged into ${depPR.base.ref}`);
          return depPR.base.ref;
        } else {
          // Dependency PR is still open — base our branch on it
          core.info(`Dependency #${depNumber} has open PR #${depPR.number} on branch ${depPR.head.ref}`);
          return depPR.head.ref;
        }
      }
    } catch (e) {
      core.warning(`Could not find PR for dependency #${depNumber}: ${e.message}`);
    }
  }

  return null; // Use default base branch
}

module.exports = { parseDependencies, checkDependencies, findBaseBranch };
