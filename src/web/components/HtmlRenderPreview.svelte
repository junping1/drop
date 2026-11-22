<script lang="ts">
  // Live preview of a shared HTML file. The render route answers with
  // `Content-Security-Policy: sandbox allow-scripts allow-forms`, and the iframe is
  // sandboxed the same way: scripts run, but in an opaque origin (no same-origin
  // token), so the page cannot read drop's cookies or other shares.
  interface Props {
    url: string;
    relPath: string;
  }

  let { url, relPath }: Props = $props();
</script>

<iframe class="preview-frame html-render-frame" sandbox="allow-scripts allow-forms" src={url} title={relPath}></iframe>
