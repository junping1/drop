# drop

[简体中文](README.zh-CN.md) | English

Share local files, folders, stdin content, and Git diffs through time-limited preview URLs.

![drop hero](assets/readme/hero-en.png)

`drop` is a small CLI for turning local content into browser-friendly preview links. It starts a local web server when needed, stores share state under `~/.drop`, and renders common developer formats with readable previews.

## Why use it?

- Share code, logs, configs, Markdown, CSV, media, or generated artifacts without leaving the terminal.
- Give an AI coding agent a reliable way to show files it created or edited.
- Share a whole project directory with a searchable file tree and split-pane preview UI.
- Turn a Git commit into a readable page with metadata and highlighted diffs.
- Keep access temporary by default with TTL-based links.

## At a Glance

| Need | Command |
| --- | --- |
| Share one file | `drop README.md` |
| Share a browsable folder | `drop .` |
| Share terminal output | <code>command &#124; drop share --type text</code> |
| Share Markdown from stdin | <code>echo "# Hi" &#124; drop share --type markdown</code> |
| Share current Git diff | <code>git diff &#124; drop share --type diff</code> |
| Share a commit | `drop allow-git . HEAD` |
| List active shares | `drop list` |
| Stop the daemon | `drop stop` |

## Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [For AI Agents](#for-ai-agents)
- [Install](#install)
- [Usage](#usage)
- [Commands](#commands)
- [Configuration](#configuration)
- [Rendering](#rendering)
- [Security Model](#security-model)
- [Public Access](#public-access)
- [Development](#development)

## Quick Start

Install the latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/junping1/drop/master/install.sh | bash
```

Share a file:

```bash
drop README.md
```

Share a directory:

```bash
drop .
```

Share piped content:

```bash
git diff | drop share --type diff --title "current changes"
```

Each command prints a URL. Open it in a browser or send it to someone who should be able to preview the content.

## How It Works

![drop architecture and usage flow](assets/readme/architecture-en.png)

1. The CLI records an authorization in the local SQLite database.
2. The daemon serves private token URLs from your machine.
3. The browser requests `/f/:token`, `/d/:token`, or `/git/:token`.
4. The server checks expiry, reads local content, and returns a rendered preview or raw file.

Runtime state lives in `~/.drop/`:

| Path | Purpose |
| --- | --- |
| `~/.drop/drop.db` | SQLite authorization database |
| `~/.drop/config.json` | config and owner key |
| `~/.drop/drop.pid` | daemon PID |
| `~/.drop/drop.log` | daemon log |
| `~/.drop/shares/` | temporary files created from stdin shares |

## For AI Agents

Copy this block into your coding agent instructions so it can install and use `drop` consistently:

```text
Install and use `drop`, a CLI tool for sharing local files through time-limited preview URLs.

Install:
  curl -fsSL https://raw.githubusercontent.com/junping1/drop/master/install.sh | bash

Expose links:
  drop serve
  # If you use an external tunnel, set the public URL:
  drop config set base_url https://your-domain.example

Use:
  drop /path/to/file                           # share a file
  drop /path/to/dir                            # share a browsable directory
  drop /path/to/file --ttl 3600                # custom TTL in seconds
  drop /path/to/file --live                    # auto-refresh when the file changes
  echo "content" | drop share --type markdown  # share piped content
  git diff | drop share --type diff            # share a diff
  drop list                                    # list active shares

Behavior:
  - After creating or editing a file that the user should inspect, run `drop` on it and send the URL.
  - When the user asks to see a file, show a preview, or get a link, use `drop`.
  - For directories, use `drop /path/to/dir` so the user gets the browsable UI.
  - Do not share secrets, `.env` files, API keys, tokens, or credential backups.
```

### AI Decision Rules

| User intent | Agent action |
| --- | --- |
| "Show me this file" | Run `drop /path/to/file` and return the URL. |
| "Show me this folder/project" | Run `drop /path/to/dir` and return the URL. |
| "Show me your changes" | Prefer <code>git diff &#124; drop share --type diff --title "changes"</code>. |
| "Share the generated report" | Run `drop` on the generated artifact. |
| "Make this public" | Ask which tunnel/base URL to use, then set `base_url`. |
| Content may contain secrets | Do not share; ask for confirmation or exclude sensitive paths. |

Machine-readable summary:

```yaml
tool: drop
purpose: Share local content through temporary preview URLs.
default_ttl_seconds: 86400
state_dir: ~/.drop
share_file: drop /path/to/file
share_directory: drop /path/to/dir
share_stdin: command | drop share --type text
share_diff: git diff | drop share --type diff
list_shares: drop list
stop_daemon: drop stop
never_share:
  - .env
  - API keys
  - OAuth credentials
  - tokens
  - password files
  - database backups
```

## Install

One-line install for Linux/macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/junping1/drop/master/install.sh | bash
```

Install from a fork or another release repository:

```bash
curl -fsSL https://raw.githubusercontent.com/owner/drop/master/install.sh | DROP_REPO=owner/drop bash
```

Build from source:

```bash
git clone https://github.com/junping1/drop.git
cd drop
bun install
bun run build
cp dist/drop-linux-x64 ~/.local/bin/drop
```

Source builds require Bun v1.0+.

## Usage

The `allow` subcommand is implicit:

```bash
drop ~/file.py
drop allow ~/file.py
```

Both commands share the same file. The daemon starts automatically if it is not already running.

### Choosing the right command

| Content | Best command |
| --- | --- |
| Existing file | `drop /path/to/file` |
| Existing directory | `drop /path/to/dir` |
| Generated text | `drop share --content "..." --type text` |
| Command output | <code>command &#124; drop share --type text</code> |
| Markdown output | <code>command &#124; drop share --type markdown</code> |
| Code snippet | `drop share --content "..." --type code` |
| Git diff | <code>git diff &#124; drop share --type diff</code> |
| Git commit | `drop allow-git . HEAD` |

### Files

```bash
drop ~/file.py                     # share a file
drop ~/file.py --ttl 300           # expire in 5 minutes
drop ~/file.py --head 50           # show only the first 50 lines
drop ~/file.py --tail 50           # show only the last 50 lines
drop ~/file.py --live              # reload preview when the file changes
drop ~/file.py --qr                # also print a terminal QR code to stderr
drop ~/file.py --force             # scan secrets, then share even if findings exist
drop ~/file.py --no-secret-scan    # skip the pre-share secret scan
```

### Directories

```bash
drop ~/project/                    # share a browsable file tree
drop ~/project/ --ttl 7200         # custom TTL
drop ~/project/ --exclude '*.log'  # add exclude patterns
drop ~/project/ --live             # refresh when the directory changes
drop ~/project/ --qr               # also print a terminal QR code to stderr
drop ~/project/ --force            # scan secrets, then share even if findings exist
drop ~/project/ --no-secret-scan   # skip the pre-share secret scan
```

Default excludes: `.git/`, `__pycache__/`, `.env`, `node_modules/`, `.DS_Store`, `*.pyc`, `.venv/`.

### Stdin

```bash
echo "# Hello" | drop share --type markdown
git diff | drop share --type diff --title "my changes"
drop share --content "print('hi')" --type python
echo "# Hello" | drop share --type markdown --qr
drop share --content "..." --force --json
drop share --content "..." --no-secret-scan --json
```

Supported types: `markdown`, `python`, `javascript`, `json`, `yaml`, `html`, `css`, `shell`, `diff`, `code`, `text`.

### Secret scanning

Before creating a file, directory, stdin, or Git commit authorization, `drop` scans for high-confidence secrets by default. A blocking finding prevents authorization creation; for stdin shares, it also avoids writing the temporary file and avoids starting the daemon.

Covered rules include private keys, GitHub tokens, OpenAI/Anthropic API keys, Slack tokens, Stripe live keys, Google API keys, AWS access key IDs, Google service-account JSON, and sensitive filenames such as `credentials.json`, `secrets.yaml`, `*.pem`, `*.key`, `.npmrc`, and `.netrc`.

Directory scans use the same default excludes as directory sharing plus any `--exclude` patterns, and do not follow symlinks that escape the shared directory or create cycles.

Override flags:

| Flag | Behavior |
| --- | --- |
| `--force` | Run the scan but continue even when findings exist. JSON success output includes `secret_scan.forced`, `findings_count`, and sanitized `findings`. |
| `--no-secret-scan` | Skip the scan. JSON success output includes `secret_scan.disabled`. |

`--force` and `--no-secret-scan` are mutually exclusive. Secret scan output is sanitized: it reports fields such as `path`, `line`, `rule_id`, `severity`, and `fingerprint`, never the raw secret value or full source line.

### Git Commits

```bash
drop allow-git /path/to/repo abc1234
drop allow-git . HEAD
drop allow-git . HEAD --qr
drop allow-git . HEAD --force
drop allow-git . HEAD --no-secret-scan
```

Git commit shares render commit metadata, changed files, and expandable highlighted diffs.

### Terminal QR codes

Add `--qr` to print a terminal QR code for the generated URL. QR output is written to stderr, so stdout remains the plain URL or parseable JSON:

```bash
drop allow ~/file.py --qr
drop allow ~/project/ --qr
drop share --content "hello" --type text --qr
drop allow-git . HEAD --qr
drop owner-url --qr
drop allow ~/file.py --json --qr | jq .
```

If QR rendering fails, the share still succeeds and Drop prints a warning to stderr. Failed share commands do not print QR output.

## Commands

| Command | Description |
| --- | --- |
| `drop <path>` | share a file or directory |
| `drop allow <path>` | explicit form of `drop <path>` |
| `drop share` | share stdin or inline text |
| `drop allow-git <repo> <commit>` | share a Git commit diff |
| `drop allow <path> --qr` | print the share URL and a terminal QR code on stderr |
| `--force` on share commands | scan secrets but continue when findings exist |
| `--no-secret-scan` on share commands | skip the pre-share secret scan |
| `drop list` | list active and expired shares |
| `drop list --json` | list shares as JSON |
| `drop revoke <token>` | revoke a file, directory, or Git share token |
| `drop owner-url` | print the owner dashboard URL |
| `drop status` | check daemon status |
| `drop stop` | stop the daemon |
| `drop serve` | start the server in the foreground |
| `drop config get <key>` | read a config value |
| `drop config set <key> <value>` | write a config value |

## Configuration

```bash
drop config set base_url https://files.example.com
drop config get base_url
```

| Key | Default | Description |
| --- | --- | --- |
| `base_url` | `http://localhost:17173` | public URL prefix for generated links |
| `port` | `17173` | server listen port |
| `file_ttl` | `86400` | default file-share TTL in seconds |
| `dir_default_ttl` | `86400` | default directory-share TTL in seconds |
| `auto_stop` | `false` | stop the daemon when all shares expire |

## Rendering

| Type | Rendering |
| --- | --- |
| Code (`.py`, `.js`, `.ts`, `.go`, `.rs`, etc.) | syntax highlighting via highlight.js |
| Markdown (`.md`) | rendered HTML with readable document styling |
| CSV/TSV | styled HTML table |
| PDF | browser-native PDF viewer |
| SVG | image preview via data URI |
| Audio/video | HTML5 player |
| Images | inline display |
| Git commits | metadata and expandable highlighted diffs |
| Other files | raw response with guessed content type |

## Security Model

- Nothing is accessible until it is explicitly shared.
- Shares expire automatically according to their TTL.
- File, directory, and Git tokens are at least 32 hex characters (128 bits), and owner keys are 32 hex characters.
- Directory access uses path traversal checks and symlink validation.
- Pre-share secret scanning is enabled by default for file, directory, stdin/content, and Git commit shares. Blocking findings are reported only with sanitized metadata and fingerprints.
- Responses include anti-crawler headers and `robots.txt` disallows indexing.
- Owner access uses HMAC-signed cookies and timing-safe key comparison.
- Current rate limiting is 300 requests per minute per client identity. Proxy headers are ignored unless `DROP_TRUST_PROXY=1` is set for a trusted reverse proxy.
- Markdown raw HTML is escaped, SVG is rendered as an image preview, and template-controlled metadata is HTML-escaped.

Important boundaries:

- Unexpired token URLs are bearer links. Anyone with the URL can access the shared content until it expires or is revoked.
- Markdown raw HTML is escaped, SVG is rendered through an image preview, and template-controlled file metadata is HTML-escaped. Still treat shared files as bearer-link content and avoid sharing untrusted or sensitive material.
- Avoid sharing secrets, `.env` files, API keys, OAuth credentials, database backups, or directories that may contain them.

## Public Access

For local-only use, the default URL is usually enough:

```bash
drop README.md
```

For public sharing, run your preferred tunnel and set `base_url`:

```bash
cloudflared tunnel --url http://localhost:17173
ngrok http 17173
tailscale funnel 17173

drop config set base_url https://your-domain.example
```

The CLI exposes a `drop serve --tunnel` option, but verify the current implementation before relying on built-in tunnel behavior in production workflows.

## Development

```bash
bun install
bun run dev:serve          # start server in foreground
bun run build:web          # build the Svelte directory browser
bun run dev:web            # run the Svelte dev server
bun run build              # compile a standalone binary
bun run verify             # run the project verification entrypoint
```

## License

MIT
