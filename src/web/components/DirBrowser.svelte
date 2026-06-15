<script lang="ts">
  import type { DirEntry, FilePreviewData } from '../lib/types';
  import { fetchFile, fetchGitInfo, prefetch, getCached } from '../lib/api';
  import SearchBox from './SearchBox.svelte';
  import FileTree from './FileTree.svelte';
  import Preview from './Preview.svelte';
  import CommitsTab from './CommitsTab.svelte';

  interface Props {
    token: string;
    dirname: string;
    tree: DirEntry;
    expiresAt: number;
    initialFile: string;
    basePath: string;
  }

  let { token, dirname, tree, expiresAt, initialFile, basePath }: Props = $props();

  let currentFile = $state('');
  let previewData: FilePreviewData | null = $state(null);
  let previewLoading = $state(false);
  let previewError = $state('');
  let searchQuery = $state('');
  let sidebarOpen = $state(false);
  let activeTab = $state<'files' | 'commits'>('files');
  let isGitRepo = $state(false);

  // Mobile: 'list' | 'preview'
  let mobileView = $state<'list' | 'preview'>('list');

  // Keyboard navigation
  let focusedIndex = $state(-1);
  let sidebarEl: HTMLElement | undefined = $state();

  function findTreeNode(relPath: string): DirEntry | null {
    if (!relPath) return tree;
    const parts = relPath.split('/');
    let node = tree;
    for (const part of parts) {
      const found = (node.children || []).find(c => c.name === part);
      if (!found) return null;
      node = found;
    }
    return node;
  }

  function closeSidebar() {
    sidebarOpen = false;
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }

  function loadFile(relPath: string, pushHistory = true) {
    const node = findTreeNode(relPath);
    if (node && node.is_dir) return;

    if (currentFile === relPath) return;
    currentFile = relPath;
    activeTab = 'files';
    closeSidebar();
    mobileView = 'preview';

    if (pushHistory) {
      const newUrl = basePath + '/d/' + token + '/' + relPath;
      history.pushState({ file: relPath }, '', newUrl);
    }

    const cached = getCached(relPath);
    if (cached) {
      previewData = cached;
      previewLoading = false;
      previewError = '';
      return;
    }

    previewData = null;
    previewLoading = true;
    previewError = '';

    fetchFile(token, basePath, relPath)
      .then((data) => {
        if (currentFile !== relPath) return;
        previewData = data;
        previewLoading = false;
      })
      .catch(() => {
        if (currentFile !== relPath) return;
        previewLoading = false;
        previewError = relPath;
      });
  }

  function handleSelect(relPath: string) {
    loadFile(relPath, true);
  }

  function handlePrefetch(relPath: string) {
    prefetch(token, basePath, relPath);
  }

  function handleNavigate(targetPath: string) {
    loadFile(targetPath, true);
  }

  function handleExpandDir(dirPath: string) {
    // On mobile, switch back to list view to show the directory
    if (window.innerWidth <= 768) {
      mobileView = 'list';
    }
  }

  function handleMobileBack() {
    mobileView = 'list';
  }

  function showFilesTab() {
    activeTab = 'files';
  }

  function showCommitsTab() {
    activeTab = 'commits';
    closeSidebar();
    mobileView = 'preview';
  }

  $effect(() => {
    fetchGitInfo(token, basePath)
      .then((info) => {
        isGitRepo = info.is_git_repo;
      })
      .catch(() => {
        isGitRepo = false;
      });
  });

  // Handle popstate (browser back/forward)
  $effect(() => {
    function onPopState() {
      const prefix = basePath + '/d/' + token + '/';
      const path = window.location.pathname;
      if (path.indexOf(prefix) === 0) {
        const relPath = decodeURIComponent(path.substring(prefix.length));
        if (relPath) {
          currentFile = ''; // reset so loadFile doesn't skip
          loadFile(relPath, false); // don't push state — we're responding to a pop
        } else {
          // User went back to the root directory view (no file selected)
          currentFile = '';
          previewData = null;
          previewLoading = false;
          previewError = '';
          mobileView = 'list';
        }
      }
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  // Load initial file
  $effect(() => {
    if (initialFile) {
      queueMicrotask(() => {
        handleSelect(initialFile);
      });
    }
  });

  // Keyboard navigation on sidebar
  function getVisibleItems(): HTMLElement[] {
    if (!sidebarEl) return [];
    return Array.from(sidebarEl.querySelectorAll('.tree-item'));
  }

  function handleSidebarKeydown(e: KeyboardEvent) {
    const items = getVisibleItems();
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      items[focusedIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
      items[focusedIndex]?.focus();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const item = items[focusedIndex];
      if (item && item.getAttribute('aria-expanded') === 'false') {
        item.click(); // expand folder
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const item = items[focusedIndex];
      if (item && item.getAttribute('aria-expanded') === 'true') {
        item.click(); // collapse folder
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[focusedIndex];
      if (item) {
        const path = item.getAttribute('data-path');
        if (path != null) {
          const node = findTreeNode(path);
          if (node && !node.is_dir) {
            handleSelect(path);
          } else {
            item.click();
          }
        }
      }
    }
  }

  // Get the filename from currentFile
  let currentFileName = $derived(currentFile ? currentFile.split('/').pop() || '' : '');
</script>

<div class="header">
  <button class="menu-btn" onclick={toggleSidebar} aria-label="Toggle sidebar">&#9776;</button>
  <span class="dirname">{dirname}</span>
  {#if isGitRepo}
    <div class="dir-tabs" role="tablist" aria-label="Directory views">
      <button class="dir-tab" class:active={activeTab === 'files'} role="tab" aria-selected={activeTab === 'files'} onclick={showFilesTab}>Files</button>
      <button class="dir-tab" class:active={activeTab === 'commits'} role="tab" aria-selected={activeTab === 'commits'} onclick={showCommitsTab}>Commits</button>
    </div>
  {/if}
  <span class="shared-badge">
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a4 4 0 00-4 4v2H3a1 1 0 00-1 1v6a1 1 0 001 1h10a1 1 0 001-1V8a1 1 0 00-1-1h-1V5a4 4 0 00-4-4zm2.5 6H5.5V5a2.5 2.5 0 015 0v2z"/></svg>
    shared
  </span>
</div>

<div class="layout" class:mobile-preview={mobileView === 'preview'}>
  <div
    class="sidebar-overlay"
    class:visible={sidebarOpen}
    onclick={closeSidebar}
    role="presentation"
  ></div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <nav
    class="sidebar"
    class:mobile-open={sidebarOpen}
    bind:this={sidebarEl}
    onkeydown={handleSidebarKeydown}
  >
    <SearchBox bind:query={searchQuery} />
    <FileTree
      {tree}
      activePath={currentFile}
      {searchQuery}
      onSelect={handleSelect}
      onPrefetch={handlePrefetch}
    />
  </nav>
  <main class="preview-pane">
    {#if mobileView === 'preview' && (currentFile || activeTab === 'commits')}
      <div class="mobile-back-bar">
        <button class="mobile-back-btn" onclick={handleMobileBack} aria-label="Back to file list">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z"/></svg>
        </button>
        <span class="mobile-back-filename">{activeTab === 'commits' ? 'Commits' : currentFileName}</span>
      </div>
    {/if}
    {#if activeTab === 'commits'}
      <CommitsTab {token} {basePath} />
    {:else}
      <Preview
        data={previewData}
        relPath={currentFile}
        {dirname}
        {tree}
        loading={previewLoading}
        error={previewError}
        onNavigate={handleNavigate}
        onExpandDir={handleExpandDir}
      />
    {/if}
  </main>
</div>

<style>
  .dir-tabs {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
  }

  .dir-tab {
    border: none;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
  }

  .dir-tab.active {
    background: var(--accent);
    color: #fff;
  }

  .dir-tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (max-width: 768px) {
    .dir-tabs {
      margin-left: auto;
    }
    .dir-tab {
      padding: 4px 8px;
    }
  }
</style>
