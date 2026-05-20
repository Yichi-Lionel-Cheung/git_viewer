# Git History Viewer

A small Python app that serves a local browser UI and animates how code files
change through a git repository's commit history.

The visualization is intentionally high level:

- every active or currently changed code file is a rectangle in one
  folder-grouped plane
- nested folders keep their files spatially together at each directory level
- rectangle area is recalculated for each frame from current line counts
- the whole canvas uses one fixed scale from the largest historical visual
  footprint, so frames are not normalized independently and a smaller project
  leaves visible empty space
- green rectangles show lines added by the current commit
- red rectangles show lines removed by the current commit
- the timeline can be played, paused, stepped, or dragged
- loading large repositories shows commit parsing progress before rendering

The app uses only the Python standard library, a browser, and the local `git`
executable. The Python entrypoint is intentionally small; the backend lives in
the `git_history_viewer/` package, and the browser UI lives in
`git_history_viewer/templates/` plus `git_history_viewer/static/`.

## Run

```bash
python3 git_history_viewer.py /path/to/repo
```

This starts a local server and opens the browser. The repository input accepts a
local path, a GitHub URL, or `owner/repo`. You can also start it without
arguments and enter the repository in the UI:

```bash
python3 git_history_viewer.py https://github.com/owner/repo
python3 git_history_viewer.py owner/repo
```

```bash
python3 git_history_viewer.py
```

The package entrypoint is equivalent:

```bash
python3 -m git_history_viewer /path/to/repo
```

For an installed command-line entrypoint:

```bash
pip install .
git-history-viewer /path/to/repo
```

You can also install directly from GitHub:

```bash
pip install git+https://github.com/Yichi-Lionel-Cheung/git_viewer.git
```

To avoid opening the browser automatically:

```bash
python3 git_history_viewer.py /path/to/repo --no-browser
```

By default the app visualizes the first-parent history of `HEAD`, which gives a
linear view of the project state over time. To inspect another branch, tag, or
commit, pass a ref:

```bash
python3 git_history_viewer.py /path/to/repo --ref main
```

## Smoke Test Mode

For a non-GUI parse check:

```bash
python3 git_history_viewer.py /path/to/repo --json-summary
```

## Project Layout

```text
git_history_viewer.py          compatibility CLI entrypoint
pyproject.toml                 Python packaging metadata and CLI script
git_history_viewer/
  cli.py                       argument parsing and mode selection
  server.py                    local HTTP API and static asset server
  jobs.py                      background history loading progress
  history.py                   git history builder
  git_client.py                git subprocess wrapper and repo resolution
  filters.py                   file type and skip rules
  numstat.py                   git numstat parsing and rename handling
  payloads.py                  browser and summary JSON shaping
  templates/index.html         app shell
  static/styles.css            UI styling
  static/app.js                browser interaction and canvas renderer
```

## Notes

- Binary files are skipped.
- The UI can optionally ignore files under any `tests/` directory.
- Common lock files, build outputs, dependency directories, and minified bundles
  are skipped so they do not dominate the picture.
- File renames are tracked when git reports them through rename detection.
- Rectangles resize smoothly between commits. Deleted files remain visible as
  red rectangles during the commit that removes them, then collapse away.

## License

MIT License. See [LICENSE](LICENSE).
