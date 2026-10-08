# gitlog2md

Turns a git log into a readable markdown file: one section per commit, with the hash, author, date
and the files that changed. Handy for keeping track of what changed in a project without digging
through `git log` in the terminal.

## Usage

Needs Node.js 18.3 or newer, and git (or GitHub Desktop, which comes with its own copy).

```sh
node gitlog2md.js <path-to-repo> [options]
```

```sh
node gitlog2md.js ../my-project                          # last 20 commits
node gitlog2md.js ../my-project --since 2026-09-01 -n 50
node gitlog2md.js ../my-project --diff                   # full changes instead of a file summary
node gitlog2md.js ../my-project -x package-lock.json -o CHANGES.md
node gitlog2md.js ../my-project -r owner/repo            # link each commit to GitHub
```

Run `node gitlog2md.js --help` for all the options.

## Known issues

This is still a work in progress, and a few things don't work the way you'd expect yet:

- **Always pass the repo path.** Running it without one uses the folder the script lives in rather
  than the folder you're in, so it usually ends with "not a git repository".
- **Point it at the top of the repo.** A subfolder (like `my-project/src`) is rejected, even though
  git itself would handle it fine.
- **Big diffs crash.** `--diff` over a lot of commits can go over the output limit and fail with a
  cryptic `ENOBUFS` error. Use fewer commits (`-n`) for now.
- **Can't be installed as a command yet.** `npm install -g` / `npm link` won't give you a `gitlog2md`
  command, so run it with `node gitlog2md.js` for now.
- **Long file paths get shortened** in the file summary (`.../graphs/chart.js`).
- **No tests yet.**

## License

MIT
