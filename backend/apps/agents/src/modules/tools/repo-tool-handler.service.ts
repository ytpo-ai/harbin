import { Injectable } from '@nestjs/common';
import { access, appendFile, mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { codeDocsReader } from './local-repo-docs-reader.util';
import { codeUpdatesReader } from './local-repo-updates-reader.util';
import { RD_DOCS_WRITE_TOOL_ID } from './builtin-tool-definitions';

const execFileAsync = promisify(execFile);

@Injectable()
export class RepoToolHandler {
  async getCodeDocsReader(params: {
    focus?: string;
    maxFiles?: number;
  }): Promise<any> {
    const maxFiles = Math.max(1, Math.min(Number(params?.maxFiles || 20), 50));
    const workspaceRoot = await this.resolveWorkspaceRoot();
    const result = codeDocsReader.read({
      focus: params?.focus,
      maxFiles,
      workspaceRoot,
    });

    if (result.error) {
      return {
        focus: params?.focus || 'all',
        workspaceRoot,
        totalDocs: result.totalFiles,
        returnedFiles: 0,
        files: [],
        error: result.error,
        errorType: result.errorType || result.error.split(':')[0],
        matchMode: result.matchMode || 'none',
        focusMatchedCount: result.focusMatchedCount || 0,
        suggestions: result.suggestions || [],
        fallbackApplied: result.fallbackApplied || false,
        retryCount: result.retryCount || 0,
        attemptedKeywords: result.attemptedKeywords || [],
        troubleshooting: [
          'Check if AGENT_WORKSPACE_ROOT environment variable is set correctly',
          'Verify the docs/ directory exists in the workspace root',
          'Ensure the agent service has been restarted after setting environment variables',
        ],
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      focus: params?.focus || 'all',
      workspaceRoot,
      totalDocs: result.totalFiles,
      returnedFiles: result.files.length,
      matchMode: result.matchMode || 'all',
      focusMatchedCount: result.focusMatchedCount ?? result.files.length,
      suggestions: result.suggestions || [],
      fallbackApplied: result.fallbackApplied || false,
      retryCount: result.retryCount || 0,
      attemptedKeywords: result.attemptedKeywords || [],
      files: result.files.map((f) => ({
        path: f.path,
        lastModified: f.lastModified,
        content: f.content,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async getCodeUpdatesReader(params: {
    hours?: number;
    limit?: number;
  }): Promise<any> {
    const hours = Math.max(1, Math.min(Number(params?.hours || 24), 168));
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 50));
    const workspaceRoot = await this.resolveWorkspaceRoot();

    const result = codeUpdatesReader.read({ hours, limit, workspaceRoot });

    if (result.error) {
      return {
        hours,
        limit,
        workspaceRoot,
        totalCommits: result.totalCommits,
        commits: [],
        error: result.error,
        errorType: result.error.split(':')[0],
        troubleshooting: [
          'Verify AGENT_WORKSPACE_ROOT points to a valid git repository',
          'Ensure the directory contains a .git folder',
          'Check if git is installed and accessible',
        ],
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      hours,
      limit,
      workspaceRoot,
      totalCommits: result.totalCommits,
      commits: result.commits,
      generatedAt: new Date().toISOString(),
    };
  }

  async executeDocsWrite(params: {
    filePath?: string;
    content?: string;
    mode?: 'create' | 'update' | 'append';
    overwrite?: boolean;
  }): Promise<any> {
    const workspaceRoot = await this.resolveWorkspaceRoot();
    const rawFilePath = String(params?.filePath || '').trim();
    const content = String(params?.content || '');
    const requestedMode = String(params?.mode || 'create').trim().toLowerCase();
    const overwrite = params?.overwrite === true;

    if (!rawFilePath) {
      throw new Error('docs_write requires filePath');
    }

    if (!content.trim()) {
      throw new Error('docs_write requires content');
    }

    if (path.isAbsolute(rawFilePath)) {
      throw new Error('docs_write filePath must be relative path under docs/');
    }

    const normalizedRelPath = path.posix
      .normalize(rawFilePath.replace(/\\/g, '/'))
      .replace(/^\.\//, '');

    if (normalizedRelPath.includes('..')) {
      throw new Error('docs_write does not allow path traversal');
    }

    if (!normalizedRelPath.startsWith('docs/')) {
      throw new Error('docs_write only supports docs/** paths');
    }

    if (!normalizedRelPath.endsWith('.md')) {
      throw new Error('docs_write only supports .md files');
    }

    if (!['create', 'update', 'append'].includes(requestedMode)) {
      throw new Error('docs_write mode must be one of: create, update, append');
    }

    const docsRoot = path.resolve(workspaceRoot, 'docs');
    const targetPath = path.resolve(workspaceRoot, normalizedRelPath);
    if (!(targetPath === docsRoot || targetPath.startsWith(`${docsRoot}${path.sep}`))) {
      throw new Error('docs_write target path is outside docs directory');
    }

    const existedBefore = await this.fileExists(targetPath);
    if (requestedMode === 'create' && existedBefore && !overwrite) {
      throw new Error('docs_write create mode conflict: file exists, set overwrite=true to replace it');
    }
    if (requestedMode === 'update' && !existedBefore) {
      throw new Error('docs_write update mode requires an existing file');
    }
    if (requestedMode === 'append' && !existedBefore) {
      throw new Error('docs_write append mode requires an existing file');
    }

    const parentDir = path.dirname(targetPath);
    await mkdir(parentDir, { recursive: true });

    if (requestedMode === 'append') {
      await appendFile(targetPath, content, 'utf8');
    } else {
      await writeFile(targetPath, content, 'utf8');
    }

    return {
      success: true,
      toolId: RD_DOCS_WRITE_TOOL_ID,
      workspaceRoot,
      filePath: normalizedRelPath,
      mode: requestedMode,
      overwrite,
      existedBefore,
      bytesWritten: Buffer.byteLength(content, 'utf8'),
      writtenAt: new Date().toISOString(),
    };
  }

  async executeRepoRead(params: { command: string }): Promise<any> {
    const allowedCommands = ['git log', 'git show', 'git diff', 'cat', 'ls', 'grep', 'head', 'tail', 'find'];
    const command = (params.command || '').trim();
    const workspaceRoot = await this.resolveWorkspaceRoot();

    if (!command) {
      return {
        error: 'MISSING_COMMAND: No command provided',
        command: '',
        workspaceRoot,
        troubleshooting: ['Provide a valid command parameter, e.g., "git log --oneline -10" or "ls docs/"'],
      };
    }

    const isAllowed = allowedCommands.some((cmd) =>
      command.toLowerCase().startsWith(cmd.toLowerCase()),
    );

    if (!isAllowed) {
      return {
        error: `COMMAND_NOT_ALLOWED: "${command}" is not permitted`,
        command,
        workspaceRoot,
        allowedCommands,
        troubleshooting: [`Only read-only commands are allowed: ${allowedCommands.join(', ')}`],
      };
    }

    try {
      const [file, ...args] = this.parseCommand(command);
      const { stdout, stderr } = await execFileAsync(file, args, {
        cwd: workspaceRoot,
        maxBuffer: 5 * 1024 * 1024,
      });

      const output = stdout || stderr;

      if (!output.trim()) {
        return {
          command,
          workspaceRoot,
          output: '',
          success: true,
          message: 'Command executed successfully but returned no output',
        };
      }

      return {
        command,
        workspaceRoot,
        output,
        success: true,
      };
    } catch (error: any) {
      return {
        command,
        workspaceRoot,
        output: '',
        success: false,
        error: `COMMAND_FAILED: ${error.message}`,
        errorDetails: error.stderr || error.stdout,
        troubleshooting: [
          'Check if the command syntax is correct',
          'Verify the file or directory exists',
          'Ensure you have read permissions',
          `Working directory: ${workspaceRoot}`,
        ],
      };
    }
  }

  private parseCommand(command: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (const char of command) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
        if (current) {
          parts.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (escaped) {
      current += '\\';
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  private async resolveWorkspaceRoot(): Promise<string> {
    const envWorkspaceRoot = process.env.AGENT_WORKSPACE_ROOT;
    if (envWorkspaceRoot) {
      if (await this.fileExists(path.join(envWorkspaceRoot, 'README.md'))) {
        return envWorkspaceRoot;
      }
    }

    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..'),
      path.resolve(process.cwd(), '../..'),
      path.resolve(__dirname, '../../../../../../'),
    ];

    for (const candidate of candidates) {
      if ((await this.fileExists(path.join(candidate, 'README.md'))) && (await this.fileExists(path.join(candidate, 'docs')))) {
        return candidate;
      }
    }

    return process.cwd();
  }

  private async fileExists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }
}
