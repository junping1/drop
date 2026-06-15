export type AuthorizationStatus = 'valid' | 'expired' | 'not_found' | 'active';

export interface FileAuthorization {
  token: string;
  filepath: string;
  filename: string;
  created_at: number;
  expires_at: number;
  live: number;
}

export interface DirAuthorization {
  token: string;
  dirpath: string;
  dirname: string;
  excludes: string; // JSON-encoded string[]
  created_at: number;
  expires_at: number;
  live: number;
}

export interface GitAuthorization {
  token: string;
  repo_path: string;
  commit_hash: string;
  created_at: number;
  expires_at: number;
}

export interface DirEntry {
  name: string;
  rel_path: string;
  is_dir: boolean;
  size: number;
  mtime: number;
  children: DirEntry[];
}

export interface FilePreviewResponse {
  type: 'image' | 'pdf' | 'html' | 'media' | 'binary';
  url?: string;
  content?: string;
  filename?: string;
  size?: number;
  mtime?: number;
}

export interface ShareListItem {
  token: string;
  slug?: string;
  type: 'file' | 'dir' | 'git';
  path: string;
  name?: string;
  status: AuthorizationStatus;
  remaining: number;
  expires_at: number;
  url: string;
}

export interface GitCommitInfo {
  hash: string;
  author_name: string;
  author_email: string;
  date: string;
  subject: string;
  body: string;
  files: GitFileInfo[];
}

export interface GitFileInfo {
  path: string;
  added: string;
  deleted: string;
  diff: string;
}
