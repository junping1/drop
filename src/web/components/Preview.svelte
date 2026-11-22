<script lang="ts">
  import type { DirEntry, FilePreviewData } from '../lib/types';
  import { formatSize, formatDate } from '../lib/format';
  import { fade } from 'svelte/transition';
  import CodePreview from './CodePreview.svelte';
  import HtmlRenderPreview from './HtmlRenderPreview.svelte';
  import ImagePreview from './ImagePreview.svelte';
  import PdfPreview from './PdfPreview.svelte';
  import MediaPreview from './MediaPreview.svelte';
  import BinaryPreview from './BinaryPreview.svelte';
  import Breadcrumb from './Breadcrumb.svelte';

  interface Props {
    data: FilePreviewData | null;
    relPath: string;
    dirname: string;
    tree: DirEntry;
    loading: boolean;
    error: string;
    onNavigate: (relPath: string) => void;
    onExpandDir?: (dirPath: string) => void;
  }

  let { data, relPath, dirname, tree, loading, error, onNavigate, onExpandDir }: Props = $props();

  // Look up file metadata from the tree when API data doesn't have it
  function findFileInTree(path: string): DirEntry | null {
    if (!path) return null;
    const parts = path.split('/');
    let node = tree;
    for (const part of parts) {
      const found = (node.children || []).find(c => c.name === part);
      if (!found) return null;
      node = found;
    }
    return node.is_dir ? null : node;
  }

  let treeNode = $derived(findFileInTree(relPath));
  let fileSize = $derived(data?.size ?? treeNode?.size ?? 0);
  let fileMtime = $derived(data?.mtime ?? treeNode?.mtime ?? 0);
  let fileName = $derived(relPath ? relPath.split('/').pop() || '' : '');

  // HTML files: Source (highlighted, default) or Preview (sandboxed render).
  // `?view=preview` in the page URL opens previews directly.
  let htmlView = $state<'source' | 'preview'>(
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('view') === 'preview' ? 'preview' : 'source',
  );
  let renderUrl = $derived(data?.type === 'html' ? data.render_url || '' : '');

  let infoLine = $derived(() => {
    const parts: string[] = [];
    if (fileName) parts.push(fileName);
    if (fileSize > 0) parts.push(formatSize(fileSize));
    if (fileMtime > 0) parts.push(formatDate(fileMtime));
    return parts.join(' \u00b7 ');
  });
</script>

{#if !relPath && !loading}
  <div class="preview-empty">
    <div class="empty-main">Select a file</div>
  </div>
{:else if loading}
  <div class="preview-loading">
    <div class="skeleton-container">
      <div class="skeleton-bar" style="width: 80%"></div>
      <div class="skeleton-bar" style="width: 60%"></div>
      <div class="skeleton-bar" style="width: 40%"></div>
    </div>
  </div>
{:else if error}
  <div class="preview-empty">
    <div class="empty-main">Failed to load: {relPath}</div>
  </div>
{:else if data}
  <div class="preview-header-bar">
    <Breadcrumb {relPath} {onExpandDir} />
    <span class="file-info">{infoLine()}</span>
    {#if renderUrl}
      <div class="view-toggle" role="group" aria-label="View mode">
        <button type="button" class:active={htmlView === 'source'} aria-pressed={htmlView === 'source'} onclick={() => (htmlView = 'source')}>Source</button>
        <button type="button" class:active={htmlView === 'preview'} aria-pressed={htmlView === 'preview'} onclick={() => (htmlView = 'preview')}>Preview</button>
      </div>
    {/if}
  </div>
  {#key relPath}
    <div class="preview-content-fade" in:fade={{ duration: 150 }}>
      {#if data.type === 'html' && renderUrl && htmlView === 'preview'}
        <HtmlRenderPreview url={renderUrl} {relPath} />
      {:else if data.type === 'html'}
        <CodePreview content={data.content || ''} {relPath} {onNavigate} />
      {:else if data.type === 'image'}
        <ImagePreview url={data.url || ''} alt={relPath} />
      {:else if data.type === 'pdf'}
        <PdfPreview url={data.url || ''} />
      {:else if data.type === 'media'}
        <MediaPreview url={data.url || ''} {relPath} />
      {:else}
        <BinaryPreview
          filename={data.filename || relPath}
          size={data.size || 0}
          url={data.url || ''}
        />
      {/if}
    </div>
  {/key}
{/if}
