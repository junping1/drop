<script lang="ts">
  import type { GitCommitDiffResponse, GitCommitSummary } from '../lib/types';
  import { fetchGitCommitDiff, fetchGitCommits, unlockGitHistory } from '../lib/api';
  import { fade } from 'svelte/transition';

  interface Props {
    token: string;
    basePath: string;
  }

  let { token, basePath }: Props = $props();

  let commits = $state<GitCommitSummary[]>([]);
  let selectedSha = $state('');
  let diff = $state<GitCommitDiffResponse | null>(null);
  let loadingCommits = $state(true);
  let loadingDiff = $state(false);
  let error = $state('');
  let diffError = $state('');
  let iframeEl: HTMLIFrameElement | undefined = $state();
  let unlockButtonEl: HTMLButtonElement | undefined = $state();
  let ownerKeyInputEl: HTMLInputElement | undefined = $state();
  let commitListHeaderEl: HTMLElement | undefined = $state();
  let loadCommitsRequestId = 0;
  let unlockRequestId = 0;
  let previousToken = '';
  let previousBasePath = '';
  let showUnlockModal = $state(false);
  let ownerKey = $state('');
  let unlocking = $state(false);
  let unlockError = $state('');
  let unlocked = $state(false);
  let currentLimit = $state(5);

  function formatDate(value: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function resetCommitState() {
    commits = [];
    selectedSha = '';
    diff = null;
    diffError = '';
    loadingDiff = false;
    error = '';
    unlocked = false;
    currentLimit = 5;
    showUnlockModal = false;
    ownerKey = '';
    unlockError = '';
    unlocking = false;
    unlockRequestId += 1;
  }

  async function loadCommits() {
    const requestId = ++loadCommitsRequestId;
    loadingCommits = true;
    error = '';

    try {
      const data = await fetchGitCommits(token, basePath);
      if (requestId !== loadCommitsRequestId) return;

      commits = data.commits;
      currentLimit = data.limit;
      unlocked = Boolean(data.unlocked);
      loadingCommits = false;

      const stillSelected = selectedSha && commits.some((commit) => commit.sha === selectedSha);
      if (!stillSelected) {
        selectedSha = '';
        diff = null;
        diffError = '';
        if (commits.length > 0) {
          void selectCommit(commits[0].sha);
        }
      }
    } catch {
      if (requestId !== loadCommitsRequestId) return;
      loadingCommits = false;
      error = 'Failed to load commit history';
    }
  }

  function openUnlockModal() {
    unlockError = '';
    ownerKey = '';
    showUnlockModal = true;
    queueMicrotask(() => ownerKeyInputEl?.focus());
  }

  function closeUnlockModal() {
    ownerKey = '';
    unlockError = '';
    showUnlockModal = false;
    queueMicrotask(() => unlockButtonEl?.focus());
  }

  function handleOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeUnlockModal();
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!showUnlockModal) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeUnlockModal();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.unlock-modal button:not([disabled]), .unlock-modal input:not([disabled])',
      ),
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submitUnlock() {
    if (unlocking) return;

    const submittedOwnerKey = ownerKey;
    const submittedToken = token;
    const submittedBasePath = basePath;
    const requestId = ++unlockRequestId;
    ownerKey = '';
    unlockError = '';
    unlocking = true;

    try {
      const result = await unlockGitHistory(submittedToken, submittedBasePath, submittedOwnerKey);
      if (requestId !== unlockRequestId || submittedToken !== token || submittedBasePath !== basePath) return;

      unlocked = Boolean(result.unlocked);
      currentLimit = result.limit;
      showUnlockModal = false;
      await loadCommits();
      queueMicrotask(() => commitListHeaderEl?.focus());
    } catch {
      if (requestId !== unlockRequestId || submittedToken !== token || submittedBasePath !== basePath) return;
      unlockError = 'Could not unlock more history. Please try again.';
    } finally {
      if (requestId === unlockRequestId && submittedToken === token && submittedBasePath === basePath) {
        ownerKey = '';
        unlocking = false;
      }
    }
  }

  async function selectCommit(sha: string) {
    if (!sha) return;
    if (selectedSha === sha && (loadingDiff || diff)) return;

    selectedSha = sha;
    diff = null;
    diffError = '';
    loadingDiff = true;

    try {
      const nextDiff = await fetchGitCommitDiff(token, basePath, sha);
      if (selectedSha === sha) diff = nextDiff;
    } catch {
      if (selectedSha === sha) diffError = 'Failed to load commit diff';
    } finally {
      if (selectedSha === sha) loadingDiff = false;
    }
  }

  function patchIframe() {
    if (!iframeEl) return;
    const iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
    if (!iframeDoc) return;

    const style = iframeDoc.createElement('style');
    style.textContent = `
      body {
        margin: 0;
        padding: 16px;
        background: #ffffff;
        color: #1f2328;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .commit-header { margin-bottom: 14px; }
      .commit-subject {
        color: #1f2328;
        font-size: 16px;
        font-weight: 700;
        margin-bottom: 6px;
      }
      .commit-body { white-space: pre-wrap; color: #57606a; }
      .commit-meta, .file-summary, .file-stats {
        color: #57606a;
        font-size: 12px;
      }
      .hash {
        color: #0969da;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .file-path {
        color: #1f2328;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-weight: 700;
      }
      details {
        border: 1px solid #c8d1dc;
        border-radius: 8px;
        margin: 12px 0;
        overflow: hidden;
        background: #ffffff;
      }
      summary {
        cursor: pointer;
        padding: 10px 12px;
        background: #f1f6fd;
        color: #1f2328;
      }
      pre {
        margin: 0;
        padding: 12px;
        overflow: auto;
        background: #ffffff;
        color: #24292f;
        font-size: 12px;
        line-height: 1.45;
      }
      .hljs {
        background: #ffffff !important;
        color: #24292f;
      }
      .hljs-addition,
      .hljs-deletion,
      .hljs-meta {
        display: block;
        margin: 0 -12px;
        padding: 0 12px;
      }
      .hljs-addition {
        background: #dafbe1;
        color: #116329;
      }
      .hljs-deletion {
        background: #ffebe9;
        color: #82071e;
      }
      .hljs-meta {
        background: #f6f8fa;
        color: #8250df;
        font-weight: 700;
      }
      .hljs-comment {
        color: #57606a;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #1e1e1e; color: #e5e7eb; }
        .commit-subject, .file-path { color: #f3f4f6; }
        .hash { color: #79c0ff; }
        .commit-meta, .file-summary, .file-stats, .commit-body { color: #cbd5e1; }
        details {
          border-color: #4b5563;
          background: #111827;
        }
        summary {
          background: #1f2937;
          color: #f3f4f6;
        }
        pre {
          background: #0f172a;
          color: #e5e7eb;
        }
        .hljs {
          background: #0f172a !important;
          color: #e5e7eb;
        }
        .hljs-addition {
          background: #0f5132;
          color: #aff5b4;
        }
        .hljs-deletion {
          background: #67060c;
          color: #ffdcd7;
        }
        .hljs-meta {
          background: #111827;
          color: #d8b4fe;
        }
        .hljs-comment {
          color: #94a3b8;
        }
      }
    `;
    iframeDoc.head.appendChild(style);
  }

  $effect(() => {
    if (token !== previousToken || basePath !== previousBasePath) {
      previousToken = token;
      previousBasePath = basePath;
      resetCommitState();
    }
    void loadCommits();
  });

  $effect(() => {
    if (iframeEl && diff?.diff_html) {
      iframeEl.srcdoc = diff.diff_html;
      iframeEl.onload = () => patchIframe();
    }
  });
</script>

<div class="commits-tab" in:fade={{ duration: 120 }}>
  <aside class="commit-list" aria-label="Recent commits">
    <div class="commit-list-header" bind:this={commitListHeaderEl} tabindex="-1">
      <div class="commit-list-title">Recent commits</div>
      {#if unlocked}
        <div class="commit-list-note success">
          More history is unlocked for this share until the share expires. Showing up to {currentLimit} commits.
        </div>
      {:else}
        <div class="commit-list-note">
          Showing the latest {currentLimit || 5} commits. Owner can temporarily unlock more history.
        </div>
        <button class="unlock-button" type="button" bind:this={unlockButtonEl} onclick={openUnlockModal}>
          Owner unlock
        </button>
      {/if}
    </div>

    {#if loadingCommits}
      <div class="commit-state">Loading commits…</div>
    {:else if error}
      <div class="commit-state error">{error}</div>
    {:else if commits.length === 0}
      <div class="commit-state">No commits found.</div>
    {:else}
      <div class="commit-items">
        {#each commits as commit (commit.sha)}
          <button
            class="commit-item"
            class:active={commit.sha === selectedSha}
            onclick={() => selectCommit(commit.sha)}
            title={commit.subject}
          >
            <span class="commit-subject-line">{commit.subject || '(no subject)'}</span>
            <span class="commit-meta-line">
              <span class="commit-sha">{commit.short_sha}</span>
              <span>{commit.author_name}</span>
            </span>
            <span class="commit-date">{formatDate(commit.authored_at)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </aside>

  <section class="commit-preview" aria-label="Commit diff">
    {#if loadingDiff}
      <div class="commit-state">Loading diff…</div>
    {:else if diffError}
      <div class="commit-state error">{diffError}</div>
    {:else if diff}
      <iframe class="preview-frame" sandbox="allow-same-origin" bind:this={iframeEl} title="Commit diff"></iframe>
    {:else}
      <div class="commit-state">Select a commit to view its diff.</div>
    {/if}
  </section>
</div>

<svelte:window onkeydown={handleWindowKeydown} />

{#if showUnlockModal}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={handleOverlayClick}
  >
    <div
      class="unlock-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-modal-title"
      aria-describedby="unlock-modal-description"
      tabindex="-1"
    >
      <form onsubmit={(event) => { event.preventDefault(); void submitUnlock(); }}>
        <div class="modal-header">
          <div>
            <h2 id="unlock-modal-title">Unlock owner history</h2>
            <p id="unlock-modal-description">Enter the owner key to temporarily show more commits for this share.</p>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close unlock modal"
            onclick={closeUnlockModal}
          >
            ×
          </button>
        </div>

        <label class="owner-key-label" for="owner-key-input">Owner key</label>
        <input
          id="owner-key-input"
          class="owner-key-input"
          type="password"
          autocomplete="off"
          bind:this={ownerKeyInputEl}
          bind:value={ownerKey}
          disabled={unlocking}
        />

        {#if unlockError}
          <div class="unlock-error" role="alert">{unlockError}</div>
        {/if}

        <div class="modal-actions">
          <button class="secondary-button" type="button" onclick={closeUnlockModal}>
            Cancel
          </button>
          <button class="primary-button" type="submit" disabled={unlocking || ownerKey.length === 0}>
            {unlocking ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .commits-tab {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
    background: var(--bg);
  }

  .commit-list {
    width: 340px;
    min-width: 280px;
    max-width: 42%;
    border-right: 1px solid var(--border);
    background: var(--bg-sidebar);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .commit-list-header {
    padding: 14px 14px 10px;
    border-bottom: 1px solid var(--border);
  }

  .commit-list-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
  }

  .commit-list-note {
    margin-top: 4px;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.4;
  }

  .commit-list-note.success {
    color: var(--accent);
  }

  .unlock-button {
    margin-top: 10px;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
    border-radius: 7px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .unlock-button:hover {
    background: var(--bg-hover);
  }

  .commit-items {
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 4px;
  }

  .commit-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    text-align: left;
    background: transparent;
    color: var(--text);
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 10px;
    cursor: pointer;
  }

  .commit-item:hover {
    background: var(--bg-hover);
  }

  .commit-item.active {
    background: var(--bg-active);
    border-color: var(--accent);
  }

  .commit-subject-line {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-header);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .commit-meta-line,
  .commit-date {
    display: flex;
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .commit-sha {
    font-family: var(--font-mono);
    color: var(--accent);
  }

  .commit-preview {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow: hidden;
  }

  .commit-state {
    margin: auto;
    color: var(--text-dim);
    font-size: 14px;
    padding: 24px;
    text-align: center;
  }

  .commit-state.error {
    color: #cf222e;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(15, 23, 42, 0.54);
  }

  .unlock-modal {
    width: min(420px, 100%);
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  }

  .unlock-modal form {
    padding: 18px;
  }

  .modal-header {
    display: flex;
    gap: 16px;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
  }

  .modal-header p {
    margin: 6px 0 0;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.45;
  }

  .icon-button {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .icon-button:disabled,
  .secondary-button:disabled,
  .primary-button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .owner-key-label {
    display: block;
    margin-bottom: 6px;
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
  }

  .owner-key-input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--bg-sidebar);
    color: var(--text);
    padding: 10px 12px;
    font: inherit;
  }

  .owner-key-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .unlock-error {
    margin-top: 10px;
    color: #cf222e;
    font-size: 12px;
    line-height: 1.4;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 18px;
  }

  .secondary-button,
  .primary-button {
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .secondary-button {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
  }

  .primary-button {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #fff;
  }

  @media (max-width: 768px) {
    .modal-backdrop {
      align-items: flex-start;
      padding: 12px;
      overflow-y: auto;
    }

    .commits-tab {
      flex-direction: column;
    }

    .commit-list {
      width: 100%;
      min-width: 100%;
      max-width: none;
      max-height: 42%;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }

    .commit-preview {
      min-height: 0;
    }
  }
</style>
