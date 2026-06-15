import { readdirSync, statSync, lstatSync, realpathSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';
import { MAX_DIR_FILES } from './constants.js';
import { isSafeSubpath, formatSize, displayPath, formatTime } from './utils.js';
import type { DirEntry } from './types.js';

// Simple TTL cache for walk_directory results
const treeCache = new Map<string, { tree: DirEntry; timestamp: number }>();
const TREE_CACHE_TTL = 30; // seconds

/**
 * Simple fnmatch-like matching: supports * and ? wildcards.
 */
function fnmatch(name: string, pattern: string): boolean {
  // Convert fnmatch pattern to regex
  let regex = '^';
  for (const ch of pattern) {
    if (ch === '*') regex += '.*';
    else if (ch === '?') regex += '.';
    else if ('.+^${}()|[]\\'.includes(ch)) regex += '\\' + ch;
    else regex += ch;
  }
  regex += '$';
  return new RegExp(regex).test(name);
}

export function isExcluded(name: string, isDir: boolean, excludes: string[]): boolean {
  for (const pattern of excludes) {
    if (pattern.endsWith('/')) {
      if (isDir && fnmatch(name, pattern.slice(0, -1))) return true;
    } else {
      if (fnmatch(name, pattern)) return true;
    }
  }
  return false;
}

/**
 * Check whether a relative path (e.g. a git diff path like "src/.env") should be
 * excluded, applying the per-segment exclude rules used elsewhere. Unlike
 * validateDirPath this does not touch the filesystem, so it works for paths that
 * no longer exist on disk (e.g. files deleted in a historical commit). Every
 * non-final segment is treated as a directory and the final segment as a file.
 */
export function isPathExcluded(relPath: string, excludes: string[]): boolean {
  const parts = relPath.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const isDir = i < parts.length - 1;
    if (isExcluded(parts[i], isDir, excludes)) return true;
  }
  return false;
}

export function walkDirectory(dirpath: string, excludes: string[]): DirEntry {
  const realDir = realpathSync(dirpath);
  const cacheKey = `${realDir}:${excludes.join(',')}`;
  const now = Date.now() / 1000;

  const cached = treeCache.get(cacheKey);
  if (cached && now - cached.timestamp < TREE_CACHE_TTL) {
    return cached.tree;
  }

  const tree = walkDirectoryUncached(dirpath, excludes);

  // Evict stale entries
  for (const [k, v] of treeCache) {
    if (now - v.timestamp > TREE_CACHE_TTL * 2) treeCache.delete(k);
  }
  treeCache.set(cacheKey, { tree, timestamp: now });

  return tree;
}

function walkDirectoryUncached(dirpath: string, excludes: string[]): DirEntry {
  const baseReal = realpathSync(dirpath);
  const visitedDirs = new Set<string>([baseReal]);
  let fileCount = 0;

  function walk(currentPath: string, relPrefix: string): DirEntry[] {
    const children: DirEntry[] = [];
    let entries: { name: string; path: string }[];

    try {
      const rawEntries = readdirSync(currentPath, { withFileTypes: true });
      // Sort: directories first, then alphabetical case-insensitive
      const sorted = rawEntries.sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      for (const entry of sorted) {
        let isDir = entry.isDirectory();
        const isLink = entry.isSymbolicLink();

        if (isExcluded(entry.name, isDir, excludes)) continue;

        const entryPath = join(currentPath, entry.name);

        // For symlinks, check they don't escape the base directory
        let realTarget: string | null = null;
        if (isLink) {
          try {
            realTarget = realpathSync(entryPath);
          } catch {
            continue;
          }
          if (!isSafeSubpath(baseReal, realTarget)) continue;
          try {
            isDir = statSync(realTarget).isDirectory();
          } catch {
            continue;
          }
        }

        const relPath = relPrefix ? join(relPrefix, entry.name) : entry.name;

        if (isDir) {
          const realDir = realTarget || realpathSync(entryPath);
          if (visitedDirs.has(realDir)) continue;
          visitedDirs.add(realDir);
          const subChildren = walk(entryPath, relPath);
          children.push({
            name: entry.name,
            rel_path: relPath,
            is_dir: true,
            size: 0,
            mtime: 0,
            children: subChildren,
          });
        } else {
          fileCount++;
          if (fileCount > MAX_DIR_FILES) {
            throw new Error(`Directory contains more than ${MAX_DIR_FILES} files. Use --exclude to narrow scope.`);
          }
          let size = 0;
          let mtime = 0;
          try {
            const st = statSync(entryPath);
            size = st.size;
            mtime = Math.floor(st.mtimeMs / 1000);
          } catch {
            // ignore
          }
          children.push({
            name: entry.name,
            rel_path: relPath,
            is_dir: false,
            size,
            mtime,
            children: [],
          });
        }
      }
    } catch (e: any) {
      if (e.code === 'EACCES') return children;
      throw e;
    }

    return children;
  }

  const dirname = basename(dirpath);
  return {
    name: dirname,
    rel_path: '',
    is_dir: true,
    size: 0,
    mtime: 0,
    children: walk(dirpath, ''),
  };
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.avif']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const MEDIA_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.weba',
  '.mp4', '.webm', '.ogv', '.mov', '.avi', '.mkv',
]);
const CSV_EXTENSIONS = new Set(['.csv', '.tsv', '.tab']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.php', '.swift', '.kt', '.scala', '.lua', '.r', '.R', '.pl', '.sh', '.bash',
  '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.proto',
  '.toml', '.ini', '.cfg', '.conf', '.yaml', '.yml', '.json', '.jsonc', '.json5',
  '.xml', '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.vue', '.svelte', '.astro',
  '.dockerfile', '.tf', '.hcl', '.nix',
  '.diff', '.patch', '.txt', '.log', '.env.example',
  '.gitignore', '.gitattributes', '.editorconfig',
  '.makefile', '.cmake',
]);

export function getFileType(filepath: string): string {
  const ext = extname(filepath).toLowerCase();
  const name = basename(filepath).toLowerCase();

  // Handle extensionless files with known names
  if (!ext) {
    if (['makefile', 'dockerfile', 'cmakelists.txt', 'gemfile', 'rakefile'].includes(name)) {
      return 'code';
    }
  }

  if (ext === '.svg') return 'svg';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (MEDIA_EXTENSIONS.has(ext)) return 'media';
  if (CSV_EXTENSIONS.has(ext)) return 'csv';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'binary';
}

export function getFileMeta(filepath: string): { display_path: string; size: string; mtime: string; ctime: string } {
  const st = statSync(filepath);
  return {
    display_path: displayPath(filepath),
    size: formatSize(st.size),
    mtime: formatTime(st.mtimeMs / 1000),
    ctime: formatTime(st.ctimeMs / 1000),
  };
}
