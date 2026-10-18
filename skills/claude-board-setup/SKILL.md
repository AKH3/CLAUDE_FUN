---
name: claude-board-setup
description: Installs Claude Board (CLAUDE_FUN, the `claude-fun` CLI from github.com/AKH3/CLAUDE_FUN) on this machine and wires it into a project folder end to end — checks Node and git, installs or updates the CLI, runs `claude-fun init` in the right folder, verifies the result and tells the user how to open the board. Use whenever the user asks to install, set up, update, repair or remove Claude Board / CLAUDE_FUN / claude-fun / "the board", or says things like «ثبّت لوحة كلاود», «ثبت البرنامج في هذا المجلد», «جهّز اللوحة», «شغّل CLAUDE_FUN», «سوّ كل شي», even without naming the tool exactly.
---

# Claude Board setup

Claude Board is a local visual board for Claude Code. Claude reports progress through four MCP tools (`resume`, `plan`, `update`, `await`) on a server named `board`, and the user approves each step in a browser page on `http://localhost:3000`. Your job is to get it installed and working in the user's project with as little effort from them as possible.

Reply in the user's language (Arabic if they write Arabic), keep technical names in English, and run every command yourself. Only stop and ask when a step below says so.

## Before you start: where this can run

This skill needs a shell on the user's own computer: Claude Code in a terminal, the Code tab of the Claude desktop app, or an IDE extension. In a plain claude.ai chat your commands run in a cloud sandbox, so nothing would reach their machine. In that case don't install anything; tell them to open the Code tab in the desktop app (or run `claude` in a terminal) inside their project folder and ask again there.

## Hard rules

- **Never run `init` in the home folder or a drive root** (`C:\Users\<name>`, `C:\`, `/home/<name>`, `/`). There, `.claude/settings.json` is the user's global Claude Code config and `CLAUDE.md` is read by every project. The CLI refuses these too, but check yourself before running it.
- **On Windows, call `npm.cmd` and `claude-fun.cmd`**, never bare `npm` / `claude-fun`, in both PowerShell and Git Bash. Bare names may hit the `.ps1` shims, which PowerShell's default execution policy blocks (`UnauthorizedAccess` / `PSSecurityException`).
- **Never change the PowerShell execution policy** or any other security setting. If the user wants that, give them the command and let them decide.
- **Install only from the tarball URL** below. Don't use `github:AKH3/CLAUDE_FUN` or a git URL: npm leaves a broken link for global git installs.
- **Don't edit `.mcp.json`, `.claude/settings.json` or `CLAUDE.md` by hand.** `init` merges them safely; re-run it instead.
- **Don't download or install Node.js or git yourself.** If either is missing, tell the user where to get it and wait.

Install URL:

```
https://github.com/AKH3/CLAUDE_FUN/archive/refs/heads/main.tar.gz
```

On macOS/Linux, drop the `.cmd` suffixes from every command below.

## Step 1: Pick the project folder

The target is the folder the user named. If they named none, use the current working directory.

Stop and ask the user for a project folder if the target is:
- the home folder or a drive root;
- a system or program folder (`C:\Windows`, `Program Files`, `AppData`, the npm global folder);
- a temporary session folder created by the Claude desktop app. Say that it gets deleted with the session, and ask whether they want a test install there anyway or a permanent folder.

If the folder doesn't exist yet and the user clearly asked for a new project, create it. Use the absolute path from here on and call it `<project>`.

## Step 2: Check prerequisites

Run these and read the output:

```
node -v
git --version
```

- **Node** must be v22 or newer. If it's missing or older, stop and tell the user to install the LTS from https://nodejs.org, then reopen the terminal or session.
- **git** is needed for the diff view and result stats. If it's missing, tell the user to install it from https://git-scm.com. The board still works without it, so you may continue if they want.

## Step 3: Install or update the CLI

Check whether it's already installed:

```
claude-fun.cmd --version
```

If the command is not found, or the user asked to update, install (this also updates an existing install):

```
npm.cmd i -g https://github.com/AKH3/CLAUDE_FUN/archive/refs/heads/main.tar.gz
```

Then run `claude-fun.cmd --version` again and confirm it prints a version.

If the install worked but the command is still not found, the npm global folder isn't on PATH for this shell. Get it with `npm.cmd prefix -g` and call the CLI by full path for the rest of this skill (`"<prefix>\claude-fun.cmd"` on Windows, `<prefix>/bin/claude-fun` elsewhere). Tell the user that a new terminal will pick it up.

## Step 4: git in the project (recommended)

Check whether `<project>` itself has a `.git` folder.

- **New or empty folder without git:** run `git init` there.
- **Existing project with files but no git:** ask the user before running `git init`, and explain it's only so the board can show what changed in each step.
- **Already a git repo:** nothing to do.

## Step 5: Wire the project

Run `init` with the project pinned explicitly. Otherwise the CLI walks up to the nearest parent folder that has `.git`, or uses Claude Code's own project folder, which may not be the one the user meant.

PowerShell:

```powershell
$env:CLAUDE_BOARD_ROOT = "<project>"; claude-fun.cmd init
```

Bash / Git Bash:

```bash
CLAUDE_BOARD_ROOT="<project>" claude-fun.cmd init
```

Useful options, only if the user asks: `--guard sensitive` (protect only `.env`, migrations and similar instead of all edits), `--no-hooks`, `--no-claude-md`, `--name "<name>"`, `--goal "<one line>"`.

Read the output:
- The first line must say `Claude Board ready in <project>`. If it names a different folder, stop and tell the user. Don't try to clean it up yourself without asking.
- If you see `running from a temporary npx cache`, go back to step 3 and install globally.
- If you see `is not valid JSON`, show the user which file is broken. Offer to fix that file's syntax only after they agree, then re-run `init`.

## Step 6: Verify

Check that these exist in `<project>`:
- `.claude-board/state.json`
- `.mcp.json` with a server named `board`
- `.claude/settings.json` with hooks that run `claude-fun ... hook session-start`, `hook prompt` and `hook guard`

Then run:

```powershell
$env:CLAUDE_BOARD_ROOT = "<project>"; claude-fun.cmd status
```

It should print a short summary that starts with the project name.

## Step 7: Tell the user how to start

Claude Code only loads a new MCP server when a session starts, so the board won't appear in the current conversation. Tell the user, in their language:

1. Start a new Claude Code session in `<project>`: in the desktop app, a new session with that folder; in a terminal, `cd` into it and run `claude`.
2. Approve the `board` MCP server (and trust the folder) when Claude Code asks. In a terminal session, `/mcp` should then list `board` as connected.
3. Open `http://localhost:3000`, or run `claude-fun.cmd` in that folder to open it. If port 3000 is busy the board takes the next free port, and Claude gives the right link in its first reply.
4. Ask Claude for a plan, for example «خطط لبناء …». Steps show up on the board and wait for ✓ «اعتماد البدء».
5. To try the board without a project first: `claude-fun.cmd demo --simulate`.

Finish with a short summary: the folder, the CLI version, the files that `init` added, and anything you skipped and why. Point Arabic speakers to the beginner guide: https://github.com/AKH3/CLAUDE_FUN/blob/main/docs/GUIDE-ar.md

## Updating to the latest version

When the user asks to update:

1. Note the current version with `claude-fun.cmd --version`.
2. Tell the user that open Claude Code sessions using the board keep running the old code until they restart. Suggest closing them first.
3. Reinstall from the tarball. `--prefer-online` makes npm fetch it again instead of reusing a cached copy:

   ```
   npm.cmd i -g --prefer-online https://github.com/AKH3/CLAUDE_FUN/archive/refs/heads/main.tar.gz
   ```

4. Run `claude-fun.cmd --version` again. A higher number confirms the update. The same number only means the maintainer didn't bump it, so don't report that as a failure.
5. For each project the user names, re-run step 5. It's safe on a wired project: it keeps the plan and refreshes the hooks and the `CLAUDE.md` snippet.
6. Tell the user to start a new Claude Code session in each project so the new `board` server loads.

## Removing it from a project

Only when the user asks:

```powershell
$env:CLAUDE_BOARD_ROOT = "<project>"; claude-fun.cmd remove
```

This undoes `init`, backs the touched files up first, and prints the backup location. Add `--purge` only if the user also wants the plan and its history deleted, and confirm that with them first. To uninstall the CLI itself: `npm.cmd uninstall -g claude-fun`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `UnauthorizedAccess` / `PSSecurityException` | Use `npm.cmd` / `claude-fun.cmd`. Don't change the policy. |
| `claude-fun.cmd` not recognized after install | Call it by full path from `npm.cmd prefix -g`; a new terminal fixes PATH. |
| `... is not a project folder` / `is your home folder` | Wrong target; go back to step 1. |
| `board` not in `/mcp` | The session was opened in a different folder, or it was started before `init`. Start a new session in `<project>`. |
| Board stopped working after Node or the CLI moved | Re-run step 5; the hooks store the CLI's absolute path. |
| `await` returns before the user approves | Expected after a few minutes. Wait for the user to approve, then continue. |
