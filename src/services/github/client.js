const { env } = require('../../config/env');

/**
 * Minimal GitHub REST helper for PR diffs.
 * Uses GITHUB_TOKEN when set; callers may pass a stub diff instead for demo.
 */
function createGithubClient({
  token = env.github.token,
  apiBaseUrl = env.github.apiBaseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  async function fetchPullRequestDiff({ repoFullName, prNumber }) {
    if (!repoFullName || prNumber == null) {
      const err = new Error('repoFullName and prNumber are required to fetch a PR diff');
      err.status = 400;
      err.code = 'github_diff_params_required';
      throw err;
    }

    if (!token) {
      const err = new Error(
        'GITHUB_TOKEN is not set; pass a diff stub in the webhook/demo body for local demo'
      );
      err.status = 503;
      err.code = 'github_token_missing';
      throw err;
    }

    const url = `${apiBaseUrl.replace(/\/$/, '')}/repos/${repoFullName}/pulls/${prNumber}`;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.v3.diff',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'aegis-split',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`GitHub PR diff fetch failed (${res.status}): ${text.slice(0, 200)}`);
      err.status = 502;
      err.code = 'github_diff_fetch_failed';
      throw err;
    }

    return await res.text();
  }

  return {
    fetchPullRequestDiff,
    hasToken: () => Boolean(token),
  };
}

module.exports = { createGithubClient };
