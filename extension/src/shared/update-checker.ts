import type { GitHubReleaseCheckResult } from './types';

export function normalizeSemver(version: string): [number, number, number] {
  const cleaned = version.trim().replace(/^v/i, '').split('-')[0];
  const parts = cleaned.split('.').map((n) => {
    const parsed = Number.parseInt(n, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function isNewerVersion(currentVersion: string, candidateVersion: string): boolean {
  const cur = normalizeSemver(currentVersion);
  const cand = normalizeSemver(candidateVersion);
  for (let i = 0; i < 3; i++) {
    if (cand[i] > cur[i]) return true;
    if (cand[i] < cur[i]) return false;
  }
  return false;
}

export async function checkGitHubReleaseUpdate(params: {
  currentVersion: string;
  githubRepo: string;
  fetchImpl?: typeof fetch;
}): Promise<GitHubReleaseCheckResult> {
  const checkedAt = new Date().toISOString();
  const repo = params.githubRepo.trim();

  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    return {
      checkedAt,
      currentVersion: params.currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      error: 'Ungültiger Repository-Bezeichner.',
    };
  }

  const doFetch = params.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await doFetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        checkedAt,
        currentVersion: params.currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        error: `GitHub API HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
    };

    const tagName = typeof payload.tag_name === 'string' ? payload.tag_name : null;
    const htmlUrl = typeof payload.html_url === 'string' ? payload.html_url : null;

    if (!tagName) {
      return {
        checkedAt,
        currentVersion: params.currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: htmlUrl,
        error: 'Keine Versionsnummer im Release gefunden.',
      };
    }

    return {
      checkedAt,
      currentVersion: params.currentVersion,
      latestVersion: tagName.replace(/^v/i, ''),
      updateAvailable: isNewerVersion(params.currentVersion, tagName),
      releaseUrl: htmlUrl,
      error: null,
    };
  } catch (err) {
    return {
      checkedAt,
      currentVersion: params.currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      error: err instanceof Error ? err.message : 'Versionsprüfung fehlgeschlagen',
    };
  }
}
