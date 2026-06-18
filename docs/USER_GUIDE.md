# Treeline User Guide

A task-oriented tour of the GUI. For installation and a high-level feature
overview see the [README](../README.md); for the scriptable CLI see
[CLI.md](./CLI.md).

---

## Five-minute quick start

1. **Add a repo.** Click **+ Add repo / folder** in the sidebar and pick a git
   repo with the native file picker. It appears in the sidebar with its
   worktrees.
2. **Open a terminal.** Hover the repo row and click its **`>_`** button — a
   terminal tab opens with a shell at the repo root. (Clicking the repo *name*
   just expands/collapses its worktrees.)
3. **Start a dev server.** Run your server in that terminal (`npm run dev`,
   etc.).
4. **View it.** A dim-cyan **`:PORT`** chip appears on the worktree row once the
   server is listening — **click it** to open `http://localhost:PORT` in the
   embedded browser pane. Or click the `http://localhost:…` URL your server
   prints in the terminal; it opens in the same pane (other URLs go to your OS
   browser).
5. **Look at changed files.** Click the **folder icon** on a worktree row,
   switch to the **Changed** tab, and click a file to open its diff beside the
   terminal. Click **Edit** + **⌘S** to edit and save.
6. **Work in a worktree.** Run `claude` (or `git worktree add`) in the repo-root
   terminal; the new worktree appears in the sidebar within ~500ms. Click it to
   open a tab cd'd into it.

---

## The sidebar

![Sidebar with repos and worktrees](img/02-sidebar.png)

| Action | Where |
| ------ | ----- |
| Add an existing repo (or non-git folder) | **+ Add repo / folder** (native picker) |
| Create a new repo | **✱ New repo** (modal — `git init` in a new/empty folder) |
| Open a scratch terminal | **`>_ Scratch`** (shell in your home dir) |
| Filter worktrees by branch/path | **Filter…** input above the list |
| Open a repo root in a new tab | **`>_`** icon on hover (next to the repo name) |
| Create a worktree | **`+`** icon on hover (next to the repo name) |
| Browse a worktree's files | **folder** icon at the left of a worktree row |
| Remove a repo from the sidebar | **`×`** icon on hover (data on disk untouched) |
| Delete a worktree | **`×`** icon on hover (next to the worktree row) |
| Collapse/expand the sidebar | **`‹` / `›`** in the title bar, or **⌘B** |

**Resizing the sidebar.** Drag the divider on the sidebar's right edge to widen
or narrow it. **Double-click the divider** to reset it to the default width.
(The divider is hidden while the sidebar is collapsed — the **⌘B** toggle is the
way back.)

Each worktree row shows: the branch name, short SHA, a yellow **`●`** if the
working tree is dirty, a status dot for any open tabs on that path (green =
running, cyan = idle, dim = exited), a magenta `claude`/`opencode`/`aider` badge
if one of those CLIs is in that worktree, a **`:PORT`** chip per listening port,
and a **`#NNN`** badge for the branch's linked GitHub PR.

Claude-managed worktrees (paths under `.claude/worktrees/` or branches starting
with `worktree-`) get a magenta **`✦`** and group into a **`✦ Claude`**
sub-section per repo.

---

## Terminals, tabs & splits

![A terminal tab](img/03-terminal.png)

Terminals are real PTYs (`node-pty` + `xterm.js`).

- **Click a worktree** → focus the most-recently-used tab for that path, or open
  one if none exists.
- **Click `+` in the tab bar** → open an *additional* tab on the selected
  sidebar item, even if one already exists.
- **Click a repo's `>_`** → open a fresh tab at the repo root.
- **Drag a tab** along the tab strip to reorder it. A plain click still selects
  (the drag only engages past a small threshold).
- **Click a tab's `×`** → close the tab and kill its PTY.
- **Click a link in terminal output** → a local dev-server URL opens in the
  embedded browser pane; any other URL opens in your OS browser.

**Splits.** A tab is a *tree* of panes:

![A tab split into two panes](img/25-split-right.png)

- **⌘D** splits the focused pane right; **⌘⇧D** splits it down.
- **⌘⌥ + arrows** move focus between panes (the focused pane has the cyan ring).
- **⌘⇧W** closes the focused pane and collapses the split.
- **Drag a divider** between panes to resize.

Tabs and panes stay mounted when hidden, so output keeps flowing and switching
back is instant.

---

## Dev servers & the browser pane

When a server, test runner, or preview starts listening inside a worktree, a
**`:PORT`** chip appears on that row (attributed by the listener's cwd, so even
a server you launched outside treeline shows up).

![Listening-port chips](img/32-listening-ports.png)

- **Click a `:PORT` chip** → opens `http://localhost:PORT` in the embedded
  browser pane.
- **Toggle the pane** any time with **⌘⇧B** (or **View → Toggle Browser**).

![The embedded browser pane](img/27-browser.png)

The pane is real Chromium (an Electron `<webview>` with its own isolated
session), with an address bar, back/forward/reload, and a draggable divider. A
bare host typed in the address bar is assumed `http://`; non-web schemes are
refused. Links that try to open a new window go to your OS browser. The pane is
also scriptable from the [CLI](./CLI.md#browser-verbs).

---

## Reading & editing files

![Code viewer showing a diff](img/21-code-viewer-diff.png)

Click the **folder icon** on a worktree row to expand its file tree.

- **All | Changed toggle.** **Changed** swaps the tree for a flat list of the
  worktree's working-tree changes, each tagged with a colored status letter:

  | Letter | Meaning | Color |
  | ------ | ------- | ----- |
  | `M` | modified | yellow |
  | `A` | added | green |
  | `?` | untracked | green |
  | `D` | deleted | red |
  | `R` | renamed | cyan |
  | `U` | conflicted | red |

  Deleted entries are struck-through and not clickable; collapsed untracked
  directories are shown but aren't themselves clickable (expand to reach their
  files).
- **Click a file** → opens read-only and syntax-highlighted, splitting in beside
  the terminal. Clicking a file in **Changed** opens its **diff** (working tree
  vs `HEAD`); a **`Diff | File`** toggle flips between them.
- **Markdown** files open on a rendered **Preview** (`Preview | Diff | File`).
- **Editing.** Click **Edit**, change the file, and save with **⌘S** (an amber
  dot marks unsaved changes; writes are atomic). Navigating away with unsaved
  edits prompts first.

![Editing a file](img/22-file-editing.png)

Files over 1 MB are shown truncated; binary files show a placeholder.

### Non-git folders

**+ Add repo / folder** also accepts plain directories (dotfiles, a notes dir,
`~/.claude/commands`). A non-git folder is pinned as a top-level node with the
same editable file tree — but no worktrees and no **Changed**/diff view (those
are git-only). Editing existing files only; creating new files from the tree
isn't supported yet.

![A non-git folder open in the sidebar](img/33-open-folder.png)

---

## Creating repos & scratch terminals

**Create a new repo.** Click **✱ New repo** to skip `mkdir && git init`: choose
new-vs-existing folder, location, and initial branch; treeline runs `git init`,
registers the repo, and drops you into a terminal at the root.

![New repo modal](img/20-create-repo-modal.png)

**Scratch terminals.** Click **`>_ Scratch`** for a shell not tied to any repo
(spawns in your home dir, pinned above the repo list as `Scratch 1`, `Scratch 2`,
…). They're ephemeral — closing the tab or quitting the app drops them.

![Scratch terminals](img/19-scratch-terminals.png)

---

## Automatic repository discovery

If a terminal's working directory moves into a git repo that **isn't** tracked
yet, treeline surfaces a toast in the bottom-right offering to track it. (This
applies to any PTY cwd change — `cd`-ing in a scratch terminal, a Claude
worktree path, etc.)

![The discovered-repo toast](img/16-discovery-toast.png)

The toast has three actions:

- **Add** — persists the repo to your sidebar and loads its worktrees (and parks
  focus on it so you can click straight through).
- **Dismiss** — suppresses it **for this session only**; it can re-prompt on the
  next launch if you land inside the repo again.
- **Don't ask again** — suppresses it **persistently** (recorded so it won't
  prompt for that path in future).

Multiple discoveries **queue**: the toast shows the first with a **`+N more`**
counter, and the next appears as you clear each one.

---

## Settings & theming

![The Settings modal](img/28-settings-modal.png)

Open **Settings** with **⌘,** (or **treeline → Settings…**). Three sections:

- **Appearance — theme.** Pick a preset (**Graphite Dark**, **Graphite Light**,
  **Midnight**). The theme repaints the whole app *and* re-themes the live xterm
  instances — no reload.
- **Terminal — font.** Set the monospace font family and size (the whole app
  renders in it).
- **Keybindings.** Rebind the app's accelerators; conflicts and reserved system
  shortcuts are validated inline and block **Save** until fixed.

![Light theme](img/30-theme-light.png)

---

## Keeping the app up to date

Packaged (signed) builds update themselves:

- They **check at launch and every 4 hours**.
- When an update is found, treeline **asks before downloading** it.
- After the download finishes, it **offers to restart** to install (otherwise it
  installs on next quit).
- You can check on demand any time via **Treeline → Check for Updates…**.

(Auto-update only applies to packaged builds, not a `npm run dev` session.)
