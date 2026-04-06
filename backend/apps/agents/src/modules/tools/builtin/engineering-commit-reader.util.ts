import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface CodeUpdatesReaderCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  files: string[];
}

export interface CodeUpdatesReaderResult {
  commits: CodeUpdatesReaderCommit[];
  totalCommits: number;
  error?: string;
  workspaceRoot?: string;
}

function execGit(command: string, cwd: string): { output: string; error?: string } {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { output };
  } catch (error: any) {
    return { output: '', error: error.message || 'Git command failed' };
  }
}

function getRecentCommits(hours: number, limit: number, cwd: string): { commits: CodeUpdatesReaderCommit[]; error?: string } {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const format = '%H%n%h%n%an%n%ad%n%s%n%b%n---END---';
  const gitLogResult = execGit(
    `git log --since="${since}" --format="${format}" -n ${limit}`,
    cwd,
  );

  if (gitLogResult.error) {
    return { commits: [], error: `GIT_ERROR: ${gitLogResult.error}. Make sure this is a git repository.` };
  }

  if (!gitLogResult.output.trim()) {
    return { commits: [] };
  }

  const commits: CodeUpdatesReaderCommit[] = [];
  const commitBlocks = gitLogResult.output.split('---END---').filter((block) => block.trim());

  for (const block of commitBlocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 5) continue;

    const [hash, shortHash, author, date, subject, ...bodyLines] = lines;
    const body = bodyLines.join('\n').trim();

    const filesOutput = execGit(`git diff --name-only ${hash}~1..${hash}`, cwd);
    const files = filesOutput.output
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f);

    commits.push({
      hash,
      shortHash,
      author,
      date,
      subject,
      body,
      files: files.slice(0, 20),
    });
  }

  return { commits };
}

export const codeUpdatesReader = {
  read(options: {
    hours?: number;
    limit?: number;
    workspaceRoot?: string;
  } = {}): CodeUpdatesReaderResult {
    const { hours = 24, limit = 20, workspaceRoot } = options;
    const cwd = workspaceRoot || process.env.AGENT_WORKSPACE_ROOT || process.cwd();

    if (!fs.existsSync(cwd)) {
      return {
        commits: [],
        totalCommits: 0,
        error: `WORKSPACE_ROOT_NOT_FOUND: Directory does not exist: ${cwd}. Please check AGENT_WORKSPACE_ROOT configuration.`,
        workspaceRoot: cwd,
      };
    }

    const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
    if (!isGitRepo) {
      return {
        commits: [],
        totalCommits: 0,
        error: `NOT_A_GIT_REPOSITORY: ${cwd} is not a git repository. Code updates require a valid git repository.`,
        workspaceRoot: cwd,
      };
    }

    const result = getRecentCommits(hours, limit, cwd);

    if (result.error) {
      return {
        commits: [],
        totalCommits: 0,
        error: result.error,
        workspaceRoot: cwd,
      };
    }

    return {
      commits: result.commits,
      totalCommits: result.commits.length,
      workspaceRoot: cwd,
    };
  },
};
