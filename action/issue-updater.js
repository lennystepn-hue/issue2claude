class IssueUpdater {
  constructor(octokit, owner, repo, issueNumber) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
    this.issueNumber = issueNumber;
    this.progressCommentId = null;
  }

  async postStartComment(model) {
    const body = [
      `**Issue2Claude started** — #${this.issueNumber}`,
      '',
      'Claude Code is analyzing your repository and working on a solution...',
      'Updates will follow here. This may take 2-10 minutes.',
      '',
      `\`Model: ${model}\``,
    ].join('\n');

    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issueNumber,
      body,
    });

    this.progressCommentId = data.id;
    return data.id;
  }

  async updateProgress(body) {
    if (!this.progressCommentId) return;

    await this.octokit.rest.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: this.progressCommentId,
      body,
    });
  }

  async postFinishComment({ prNumber, branchName, summary, cost, duration, tokens }) {
    const durationMin = Math.round(duration / 60000);
    const body = [
      `**Issue2Claude done!**`,
      '',
      `PR opened: #${prNumber}`,
      `Branch: \`${branchName}\``,
      '',
      '**What Claude did:**',
      summary || 'No summary provided.',
      '',
      `**Token usage:** ${tokens || 'N/A'} | **Cost:** ~$${cost || '?'} | **Duration:** ${durationMin}min`,
      '',
      'Please review and merge the PR when everything looks good.',
    ].join('\n');

    await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issueNumber,
      body,
    });
  }

  async postNoChangesComment(reason) {
    const body = [
      `**Issue2Claude — No changes made**`,
      '',
      'Claude analyzed the issue but did not make any code changes.',
      `Reason: ${reason || 'Unknown'}`,
      '',
      'Please add more details to the issue and re-apply the label.',
    ].join('\n');

    await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issueNumber,
      body,
    });
  }

  async postErrorComment(error) {
    const body = [
      `**Issue2Claude — Error**`,
      '',
      `Something went wrong: ${error}`,
      '',
      'Please check the Action logs for more details.',
      'You can comment `claude-retry` to try again.',
    ].join('\n');

    await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issueNumber,
      body,
    });
  }

  async fetchComments() {
    const { data } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.issueNumber,
      per_page: 50,
    });

    return data
      .filter(c => !c.body.includes('Issue2Claude'))
      .map(c => ({
        user: c.user.login,
        body: c.body,
        date: c.created_at.split('T')[0],
      }));
  }
}

module.exports = { IssueUpdater };
