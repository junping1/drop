export interface DirEntry {
  name: string;
  rel_path: string;
  is_dir: boolean;
  size: number;
  mtime: number;
  children: DirEntry[];
}

export interface FilePreviewData {
  type: 'image' | 'pdf' | 'html' | 'media' | 'binary';
  url?: string;
  content?: string;
  filename?: string;
  size?: number;
  mtime?: number;
}

export interface GitInfoResponse {
  is_git_repo: boolean;
  default_limit: number;
  commits_url: string | null;
}

export interface GitCommitSummary {
  sha: string;
  short_sha: string;
  subject: string;
  author_name: string;
  authored_at: string;
}

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

export interface GitCommitDiffResponse {
  commit: GitCommitSummary;
  diff_html: string;
  file_count: number;
}
