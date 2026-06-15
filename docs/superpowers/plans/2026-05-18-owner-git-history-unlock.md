# Owner Git History Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner can unlock the current Git directory share from 5 recent commits to 100 recent commits using an in-page modal and a share-scoped signed cookie.

**Architecture:** Add a narrow server-side unlock capability for directory Git history. The unlock API validates owner key via same-origin POST, signs a cookie scoped to the real share token, and existing Git list/diff APIs choose limit 5 or 100 based on that cookie and share expiry. The Svelte Commits tab gets an owner-key modal and refreshes commit data after unlock.

**Tech Stack:** Bun, Hono, Svelte 5, SQLite-backed share authorization, HMAC-signed cookies, existing `scripts/verify.sh`.

---

## Execution status

Implemented in this session with subagents. Backend, frontend, documentation, security review fixes, online smoke verification, and full verification are complete. This plan records the execution history for the committed implementation.

## File map

- Modify `src/server/middleware/auth.ts`: export signed value helpers or add narrow Git-history cookie helpers.
- Modify `src/server/routes/dir.ts`: add unlock POST route and make Git commit list/diff use effective limit.
- Modify `src/server/git/repo.ts`: support caller-provided max limit up to 100 without weakening default 5 behavior.
- Modify `src/web/lib/types.ts`: add unlock/status response types and optional commit list metadata.
- Modify `src/web/lib/api.ts`: add POST unlock API call and allow commit fetch to consume returned limit/status.
- Modify `src/web/components/CommitsTab.svelte`: add owner unlock modal, status text, refresh to 100 commits after unlock.
- Modify `tests/dir-git-api.test.ts`: add backend security and behavior coverage.
- Modify `README.md`, `README.zh-CN.md`, `TODO.md`, `CHANGELOG.md`: document completed behavior and move TODO state after implementation.

## Constants and decisions

- `DEFAULT_DIR_GIT_COMMIT_LIMIT = 5` remains the public default.
- Add `OWNER_DIR_GIT_COMMIT_LIMIT = 100`.
- Unlock cookie name: `drop_dir_git_history`.
- Cookie payload fields: real token, scope `dir_git_history`, limit, expires_at.
- Cookie signing secret: existing owner key.
- Unlock scope: current share only.
- Unlock lifetime: share expiry; never beyond share expiry.
- Owner key submission: same-origin POST JSON body only; reject query key.
- Metadata remains unchanged: no author email.

## Task 1: Backend auth and Git API unlock

**Files:**
- Modify: `src/server/middleware/auth.ts`
- Modify: `src/server/git/repo.ts`
- Modify: `src/server/routes/dir.ts`
- Test: `tests/dir-git-api.test.ts`

- [x] **Step 1: Write failing backend tests**

Add tests to `tests/dir-git-api.test.ts` covering:

```ts
// Expected new cases inside describe('directory git API', ...):
// 1. Without unlock, /api/git/commits still returns 5 for a repo with 101 commits.
// 2. POST /d/:token/api/git/unlock with { owner_key: ownerKey } returns 200 and Set-Cookie drop_dir_git_history.
// 3. After passing that cookie, /api/git/commits returns 100.
// 4. After passing that cookie, /api/git/commit/:sha can open the 100th commit but not the 101st.
// 5. Unlock endpoint rejects ?key=ownerKey query-only attempts.
// 6. Unlock endpoint rejects cross-site Origin / Sec-Fetch-Site requests.
// 7. Forged cookie cannot unlock.
// 8. Cookie from one token cannot unlock another token.
// 9. Expired share rejects expanded history even with old cookie.
// 10. Unlock errors do not include owner key, local repo path, or git stderr.
```

Use the existing temp DB pattern. Set `process.env.DROP_DB` per test and use `addDirAuthorization`. Use `loadConfig`/`getOwnerKey` if available, or read the generated config through existing helpers. Create repos with 101 commits only in one or two tests to keep runtime acceptable.

- [x] **Step 2: Run backend tests and confirm they fail**

Run:

```bash
bun test tests/dir-git-api.test.ts
```

Actual: tests failed before implementation and now pass after implementation.

- [x] **Step 3: Implement signed cookie helpers**

In `src/server/middleware/auth.ts`, expose narrow helpers without changing existing owner cookie behavior:

```ts
export function signAuthValue(value: string, secret: string): string {
  return signValue(value, secret);
}

export function verifyAuthValue(signed: string, secret: string): string | null {
  return verifySignedValue(signed, secret);
}
```

If direct export of private helpers is cleaner than wrappers, export the functions but keep their behavior unchanged. Do not make the existing `drop_owner` cookie shorter or broader.

- [x] **Step 4: Implement Git limit constants and variable commit listing**

In `src/server/git/repo.ts`:

```ts
export const DEFAULT_DIR_GIT_COMMIT_LIMIT = 5;
export const OWNER_DIR_GIT_COMMIT_LIMIT = 100;

export function normalizeDirGitCommitLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_DIR_GIT_COMMIT_LIMIT;
  return Math.max(0, Math.min(Math.floor(limit), OWNER_DIR_GIT_COMMIT_LIMIT));
}
```

Update `listCommits(repoPath, limit)` to cap by `OWNER_DIR_GIT_COMMIT_LIMIT`, not by default 5. Keep route callers responsible for passing 5 or 100. Update `isCommitInRecentWindow` to use the passed limit.

- [x] **Step 5: Implement unlock cookie payload and effective limit in dir route**

In `src/server/routes/dir.ts`, add local helpers near Git API routes:

```ts
const DIR_GIT_HISTORY_COOKIE = 'drop_dir_git_history';
const DIR_GIT_HISTORY_SCOPE = 'dir_git_history';

interface DirGitHistoryUnlockPayload {
  token: string;
  scope: typeof DIR_GIT_HISTORY_SCOPE;
  limit: number;
  expires_at: number;
}
```

Add helpers:

```ts
function encodeUnlockPayload(payload: DirGitHistoryUnlockPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeUnlockPayload(value: string): DirGitHistoryUnlockPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed.scope !== DIR_GIT_HISTORY_SCOPE) return null;
    if (typeof parsed.token !== 'string') return null;
    if (typeof parsed.limit !== 'number') return null;
    if (typeof parsed.expires_at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}
```

Add `getDirGitHistoryLimit(c, row)`:

- Read `drop_dir_git_history` cookie.
- Verify signature with owner key.
- Decode payload.
- Require payload token equals `row.token`.
- Require payload scope equals `dir_git_history`.
- Require current time <= payload expires_at.
- Require current time <= row.expires_at.
- Return `Math.min(payload.limit, OWNER_DIR_GIT_COMMIT_LIMIT)` if valid; else return 5.

- [x] **Step 6: Implement POST unlock route**

Add route:

```ts
dirRoutes.post('/d/:token/api/git/unlock', async (c) => { ... });
```

Behavior:

- Resolve `row` using existing `getDirAuth(c)`.
- If missing/expired/non-git, return generic 403 or 404 without details.
- Reject any `?key=` query attempt with 403.
- Reject cross-site requests: if `Origin` exists and does not match request URL origin, 403; if `Sec-Fetch-Site` is `cross-site`, 403.
- Parse JSON body `{ owner_key: string }`; invalid body returns 403.
- Compare with `getOwnerKey()` using `safeCompare`.
- On success, set signed cookie with payload token = real `row.token`, scope, limit 100, expires_at = `row.expires_at`.
- Cookie maxAge = `Math.max(0, Math.floor(row.expires_at - Date.now()/1000))`.
- Cookie path can be `/d/${publicId}` or `/`; if path-scoped path creates slug/token mismatch issues, use `/` but enforce token in payload server-side.
- Cookie options: `httpOnly: true`, `sameSite: 'Lax'`, `secure` when request protocol is HTTPS or forwarded proto is HTTPS.
- Add `Cache-Control: no-store`.
- Return JSON: `{ unlocked: true, limit: 100, expires_at: row.expires_at }`.

- [x] **Step 7: Wire effective limit into existing Git APIs**

Update:

- `GET /d/:token/api/git` returns default limit 5 and an unlock URL for Git repos if desired.
- `GET /d/:token/api/git/commits` uses effective limit from cookie, returns `{ limit, commits, unlocked }`.
- `GET /d/:token/api/git/commit/:sha` checks membership with effective limit.

Do not expose author email.

- [x] **Step 8: Run backend tests**

Run:

```bash
bun test tests/dir-git-api.test.ts
bun run tsc --noEmit
```

Actual: pass.

## Task 2: Frontend unlock modal and commit list refresh

**Files:**
- Modify: `src/web/lib/types.ts`
- Modify: `src/web/lib/api.ts`
- Modify: `src/web/components/CommitsTab.svelte`

- [x] **Step 1: Add API types**

In `src/web/lib/types.ts`, extend Git types:

```ts
export interface GitCommitsResponse {
  limit: number;
  commits: GitCommitSummary[];
  unlocked?: boolean;
}

export interface GitUnlockResponse {
  unlocked: boolean;
  limit: number;
  expires_at: number;
}
```

- [x] **Step 2: Add unlock API call**

In `src/web/lib/api.ts`:

```ts
export function unlockGitHistory(token: string, basePath: string, ownerKey: string): Promise<GitUnlockResponse> {
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
```

Do not put the key in URL, localStorage, sessionStorage, console logs, or error messages.

- [x] **Step 3: Add modal state to CommitsTab**

In `src/web/components/CommitsTab.svelte`, add state:

```ts
let showUnlockModal = $state(false);
let ownerKey = $state('');
let unlocking = $state(false);
let unlockError = $state('');
let unlocked = $state(false);
let currentLimit = $state(5);
```

When loading commits, set `unlocked = Boolean(data.unlocked)` and `currentLimit = data.limit`.

- [x] **Step 4: Implement submit handler**

Add:

```ts
async function submitUnlock() {
  const key = ownerKey;
  ownerKey = '';
  unlockError = '';
  unlocking = true;
  try {
    const result = await unlockGitHistory(token, basePath, key);
    unlocked = result.unlocked;
    currentLimit = result.limit;
    showUnlockModal = false;
    await loadCommits();
  } catch {
    unlockError = 'Unlock failed. Check the owner key and try again.';
  } finally {
    unlocking = false;
  }
}
```

Ensure no console logging of `key`.

- [x] **Step 5: Add UI**

In the commit list header:

- If not unlocked: show “Showing latest 5 commits” and an `Owner unlock` button.
- If unlocked: show “Unlocked for this share: showing latest 100 commits until the share expires.”

Modal contents:

- Title: `Owner unlock`
- Body: `Enter the owner key to unlock more Git history for this share.`
- Password input bound to `ownerKey`.
- Buttons: `Cancel`, `Unlock`.
- On cancel: clear `ownerKey`, `unlockError`, close modal.

- [x] **Step 6: Build frontend**

Run:

```bash
bun run build:web
bun run tsc --noEmit
```

Actual: pass.

## Task 3: Documentation, integration review, and verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `TODO.md`
- Modify: `CHANGELOG.md`
- Verify all code touched above.

- [x] **Step 1: Update docs**

Update directory sharing docs to mention:

- Git directory shares show 5 commits by default.
- Owner can unlock current share to latest 100 commits from the Commits tab.
- Unlock is current-share scoped and lasts until the share expires.
- Owner key is submitted from the page and should not be shared with visitors.

- [x] **Step 2: Update TODO**

In `TODO.md`, mark second-stage items complete only after implementation and verification. If implementation is partial, leave incomplete items unchecked.

- [x] **Step 3: Update CHANGELOG**

Under Unreleased, add completed feature, security, tests, and docs bullets after verification.

- [x] **Step 4: Run full verification**

Run:

```bash
scripts/verify.sh
```

Actual: all tests pass and build succeeds after final verification.

- [x] **Step 5: Manual smoke test**

If local service is running with new binary/source, verify these URLs or equivalent local routes:

```bash
curl -fsS https://share.niaite.com/d/writing-craft-project/api/git/commits
```

Then unlock through browser modal if available. Do not put owner key in shell history or URL.

- [ ] **Step 6: Commit**

Pending after user approval:

```bash
git add docs/superpowers/specs/2026-05-18-owner-git-history-unlock-design.md docs/superpowers/plans/2026-05-18-owner-git-history-unlock.md README.md README.zh-CN.md TODO.md CHANGELOG.md src/server/middleware/auth.ts src/server/git/repo.ts src/server/routes/dir.ts src/web/lib/types.ts src/web/lib/api.ts src/web/components/CommitsTab.svelte tests/dir-git-api.test.ts
git commit -m "feat: add owner unlock for git history"
```
