#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const util = require('node:util');
const path = require('node:path');
const fs = require('node:fs');

// --- CLI HELP message ---
const HELP = `gitlog2md - turn git change log into markdown for easier change tracking

Usage
  gitlog2md [path] [options]

Examples
  gitlog2md                          # uses the script's own directory
  gitlog2md ./pixy                   # explicit repo path
  gitlog2md --since 2026-09-01       # only commits after that date
  gitlog2md --since 2026-09-01 --until 2026-10-01 -n 50
  gitlog2md --diff                   # full patch instead of --stat
  gitlog2md -x package-lock.json -o CHANGES.md

Options
  -r, --repo <owner/name>  Link each commit hash to this GitHub repo
  -S, --since <date>       Only include commits after this date (e.g. 2026-01-01)
  -U, --until <date>       Only include commits before this date
  -n, --limit <n>          Max commits to show (default 20)
  -x, --exclude <glob>     Skip matching paths, repeatable
  -o, --output <file>      Write to a file instead of the screen
      --diff               Show full patch instead of --stat summary
      --json               Print results as JSON
  -h, --help               Show this help
  -v, --version            Show the version
`;

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

// --- Parse CLI args ---
let args;
try {
  args = util.parseArgs({
    allowPositionals: true,
    options: {
      repo:    { type: 'string', short: 'r' },
      since:   { type: 'string', short: 'S' },
      until:   { type: 'string', short: 'U' },
      limit:   { type: 'string', short: 'n' },
      exclude: { type: 'string', short: 'x', multiple: true },
      output:  { type: 'string', short: 'o' },
      diff:    { type: 'boolean' },
      json:    { type: 'boolean' },
      help:    { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
} catch (err) {
  fail(`${err.message}\nRun "gitlog2md --help" for usage.`);
}

// --- Check CLI args ---
const { values: opts, positionals } = args;

if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.version) {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  process.stdout.write(pkg.version + '\n');
  process.exit(0);
}
if (positionals.length > 1) fail('give one path to scan');

// -n must be a whole number above 0
let limit = 20;
if (opts.limit !== undefined) {
  limit = Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1) fail('--limit must be a whole number above 0');
}

// --repo must look like owner/name
if (opts.repo && !/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) fail('--repo must look like owner/name, e.g. octocat/hello-world');

// --- Resolve repo path ---
const repoPath = path.resolve(positionals[0] || __dirname);

if (!fs.existsSync(path.join(repoPath, '.git'))) {
  fail(`"${repoPath}" is not a git repository (no .git directory found)`);
}

// --- Build git log command ---
// Each commit starts with \x1e and its fields are separated by \x1f. These are control characters that never
// appear in commit messages, so a subject containing " | " can't break the parsing.
const gitArgs = [
  'log',
  '--format=%x1e%h%x1f%an%x1f%ad%x1f%s',
  '--date=format:%Y-%m-%d %H:%M:%S',
  `-${limit}`,
];

// --diff shows the full patch, otherwise just the summary of changed files
if (opts.diff) gitArgs.push('-p');
else gitArgs.push('--stat');

if (opts.since) gitArgs.push(`--since=${opts.since}`);
if (opts.until) gitArgs.push(`--until=${opts.until}`);

// --exclude: tell git to look at every path (.) except the excluded ones.
// Commits that only touched excluded paths disappear, and excluded files are left out of the stats.
if (opts.exclude) {
  gitArgs.push('--', '.');
  for (const pattern of opts.exclude) gitArgs.push(`:(exclude)${pattern}`);
}

// --- Parse git output into commits ---
function parseCommits(log) {
  const commits = [];
  for (const chunk of log.split('\x1e')) {
    if (!chunk.trim()) continue;
    const [header, ...rest] = chunk.split('\n');
    const [hash, author, date, subject] = header.split('\x1f');
    // Drop the blank lines around the stat/diff, but keep the first line's indentation so the columns line up
    const changes = rest.join('\n').replace(/^\s*\n/, '').trimEnd();
    commits.push({ hash, author, date, subject, changes });
  }
  return commits;
}

// --- Format as markdown ---
// A code fence longer than any run of backticks in the text, so a diff of a markdown file can't close it early
function codeFence(text) {
  const longestRun = Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length));
  return '`'.repeat(Math.max(3, longestRun + 1));
}

// | would end a table cell early, so escape it
const cell = (text) => text.replace(/\|/g, '\\|');

function toMarkdown(commits) {
  let md = `# Git Log\n\n`;

  // One italic info line, e.g. "Generated 2026-10-07T12:00:00Z · since 2026-09-01"
  const info = [`Generated ${new Date().toISOString()}`];
  if (opts.since) info.push(`since ${opts.since}`);
  if (opts.until) info.push(`until ${opts.until}`);
  md += `*${info.join(' · ')}*\n\n`;

  if (commits.length === 0) md += 'No commits found.\n';

  for (const commit of commits) {
    // With --repo the hash links to the commit on GitHub
    let hash = `\`${commit.hash}\``;
    if (opts.repo) hash = `[${hash}](https://github.com/${opts.repo}/commit/${commit.hash})`;

    md += `## ${commit.subject}\n\n`;
    md += `| Field | Value |\n|---|---|\n`;
    md += `| **Hash** | ${hash} |\n`;
    md += `| **Author** | ${cell(commit.author)} |\n`;
    md += `| **Date** | ${commit.date} |\n\n`;

    // Stat/diff lines
    if (commit.changes) {
      const fence = codeFence(commit.changes);
      const language = opts.diff ? 'diff' : '';
      md += `${fence}${language}\n${commit.changes}\n${fence}\n\n`;
    }
  }
  return md;
}

// --- Find git ---
// Use git if it's installed, otherwise the copy that comes with GitHub Desktop
function findGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return 'git';
  } catch {
    // git isn't installed (or isn't on the PATH) - try GitHub Desktop below
  }

  // GitHub Desktop keeps one folder per version, e.g. app-3.6.6 - use the newest one that has git
  if (process.env.LOCALAPPDATA) {
    const desktopDir = path.join(process.env.LOCALAPPDATA, 'GitHubDesktop');
    if (fs.existsSync(desktopDir)) {
      const versions = fs.readdirSync(desktopDir)
        .filter(name => name.startsWith('app-'))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // newest first
      for (const version of versions) {
        const gitPath = path.join(desktopDir, version, 'resources', 'app', 'git', 'cmd', 'git.exe');
        if (fs.existsSync(gitPath)) return gitPath;
      }
    }
  }

  fail('git not found - install git, or GitHub Desktop (it comes with its own git)');
}

// --- Execute ---
// execFileSync runs git directly, without a shell, so the | in --format and spaces in dates are passed as-is
let log;
try {
  log = execFileSync(findGit(), gitArgs, {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024, // 10 MB for large diffs
  });
} catch (err) {
  fail(`git command failed: ${err.message}`);
}

// --- Output ---
const commits = parseCommits(log);
const text = opts.json ? JSON.stringify(commits, null, 2) + '\n' : toMarkdown(commits);

if (opts.output) {
  const outPath = path.resolve(opts.output);
  fs.writeFileSync(outPath, text, 'utf8');
  process.stdout.write(`Wrote ${commits.length} commits to ${outPath}\n`);
} else {
  process.stdout.write(text);
}
