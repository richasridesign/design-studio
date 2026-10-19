import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { projectsRoot } from './settings.js';

// Every project folder in the projects root is its own git repo, so each step of the work is saved as a commit:
// project created, Figma file linked, flow created, iteration created, frozen or reopened, adoption merged.
// One queue for all commits, so two never overlap. Git runs with the designer's own identity (her global config).
// It never pushes and never adds a remote. A folder outside the projects root, the projects root itself, the chats
// root and the Design Studio repo are never touched. A failure is logged and never reaches the caller.

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const GITIGNORE = `# Made by Design Studio. Caches, renders and anything that could hold a secret stay out of git.
.claude/
.figma-cache/
.trash/
review/shots/
shots/
buildcheck/
refs/
node_modules/
*.png
*.jpg
*.jpeg
*.gif
*.webp
*.mp4
*.mov
*.pdf
*.zip
*.fig
*.tmp
.DS_Store
.mcp.json
.env
.env.*
*.pem
*.key
`;

export type GitRun = (args: string[], cwd: string) => Promise<string>;

/** Plain git, never interactive, never signing, with a timeout so a stuck call cannot hold the queue. */
export const runGit: GitRun = (args, cwd) =>
  new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: path.dirname(cwd) };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    execFile('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, timeout: 20_000 }, (err, out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim().split('\n')[0])) : resolve(String(out)));
  });

const exists = (p: string) => stat(p).then(() => true, () => false);

/** The folder git may run in, or null: a direct child of the projects root that is a project, never the repo. */
export async function gitFolder(dir: string, root = projectsRoot()): Promise<string | null> {
  const r = path.resolve(root);
  let d = path.resolve(dir);
  // A chat in a flow's iteration folder commits its project, the root's direct child.
  while (path.dirname(d) !== r && d.startsWith(r + path.sep)) d = path.dirname(d);
  if (path.dirname(d) !== r || !d.startsWith(r + path.sep)) return null;
  if (d === REPO || REPO.startsWith(d + path.sep) || d.startsWith(REPO + path.sep)) return null;
  if (path.basename(d).startsWith('.')) return null;
  if (!(await exists(path.join(d, 'project.json'))) && !(await exists(path.join(d, 'figma.json')))) return null;
  return d;
}

export type CommitResult = 'committed' | 'clean' | 'skipped' | 'failed';

async function commitNow(dir: string, message: string, root: string, git: GitRun): Promise<CommitResult> {
  const d = await gitFolder(dir, root);
  if (!d) return 'skipped';
  try {
    if (!(await exists(path.join(d, '.git')))) await git(['init', '-q', '-b', 'main'], d);
    // Git must answer for this folder, not a repo above it.
    const top = await realpath(path.resolve((await git(['rev-parse', '--show-toplevel'], d)).trim()));
    if (top !== (await realpath(d))) return 'skipped';
    const ignore = path.join(d, '.gitignore');
    if (!(await readFile(ignore, 'utf8').then(() => true, () => false))) await writeFile(ignore, GITIGNORE);
    await git(['add', '-A'], d);
    const staged = (await git(['diff', '--cached', '--name-only'], d)).trim();
    if (!staged) return 'clean';
    await git(['commit', '-q', '-m', message.replace(/\s+/g, ' ').trim().slice(0, 200)], d);
    return 'committed';
  } catch (err) {
    console.error(`git ${path.basename(d)}: ${(err as Error).message}`);
    return 'failed';
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Commits everything in the project folder that holds `dir`, after any commit already queued. Resolves with what
 * happened and never rejects. Tests never run git unless they pass their own runner.
 */
export function commitProject(dir: string, message: string, opts: { root?: string; git?: GitRun } = {}): Promise<CommitResult> {
  if (process.env.VITEST && !opts.git) return Promise.resolve('skipped');
  const root = opts.root ?? projectsRoot();
  const run = queue.then(() => commitNow(dir, message, root, opts.git ?? runGit), () => commitNow(dir, message, root, opts.git ?? runGit));
  queue = run.catch(() => 'failed');
  return run.catch((err) => (console.error('git:', (err as Error).message), 'failed' as const));
}
