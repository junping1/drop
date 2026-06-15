import type {
  FilePreviewData,
  GitCommitDiffResponse,
  GitCommitsResponse,
  GitInfoResponse,
  GitUnlockResponse,
} from './types';

const cache: Map<string, FilePreviewData> = new Map();
const inflight: Map<string, Promise<FilePreviewData>> = new Map();

export function getCached(relPath: string): FilePreviewData | undefined {
  return cache.get(relPath);
}

export function fetchFile(token: string, basePath: string, relPath: string): Promise<FilePreviewData> {
  const cached = cache.get(relPath);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(relPath);
  if (existing) return existing;

  const url = `${basePath}/d/${token}/api/file?path=${encodeURIComponent(relPath)}`;
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<FilePreviewData>;
    })
    .then((data) => {
      cache.set(relPath, data);
      inflight.delete(relPath);
      return data;
    })
    .catch((err) => {
      inflight.delete(relPath);
      throw err;
    });

  inflight.set(relPath, p);
  return p;
}

export function prefetch(token: string, basePath: string, relPath: string): void {
  if (!cache.has(relPath) && !inflight.has(relPath)) {
    fetchFile(token, basePath, relPath);
  }
}

export function fetchGitInfo(token: string, basePath: string): Promise<GitInfoResponse> {
  return fetch(`${basePath}/d/${token}/api/git`, {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<GitInfoResponse>;
  });
}

export function fetchGitCommits(token: string, basePath: string): Promise<GitCommitsResponse> {
  return fetch(`${basePath}/d/${token}/api/git/commits`, {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<GitCommitsResponse>;
  });
}

export function fetchGitCommitDiff(token: string, basePath: string, sha: string): Promise<GitCommitDiffResponse> {
  return fetch(`${basePath}/d/${token}/api/git/commit/${encodeURIComponent(sha)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<GitCommitDiffResponse>;
  });
}

export function unlockGitHistory(
  token: string,
  basePath: string,
  ownerKey: string,
): Promise<GitUnlockResponse> {
  return fetch(`${basePath}/d/${token}/api/git/unlock`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_key: ownerKey }),
  }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<GitUnlockResponse>;
  });
}
