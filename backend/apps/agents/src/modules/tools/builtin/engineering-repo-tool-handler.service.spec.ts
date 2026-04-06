import { RepoToolHandler } from './engineering-repo-tool-handler.service';

describe('RepoToolHandler parseCommand', () => {
  const parseCommand = (command: string): string[] => {
    const handler = new RepoToolHandler() as any;
    return handler.parseCommand(command);
  };

  it('parses single quoted arguments', () => {
    expect(parseCommand("grep 'repo-read' docs/development/CODE_DOCS_MCP_PLAN.md")).toEqual([
      'grep',
      'repo-read',
      'docs/development/CODE_DOCS_MCP_PLAN.md',
    ]);
  });

  it('parses double quoted arguments', () => {
    expect(parseCommand('git log --since="1 day ago" -5')).toEqual(['git', 'log', '--since=1 day ago', '-5']);
  });

  it('keeps pipe as literal argument instead of shell operator', () => {
    expect(parseCommand('ls docs | wc -l')).toEqual(['ls', 'docs', '|', 'wc', '-l']);
  });
});

describe('RepoToolHandler repo writer guards', () => {
  it('rejects non-https repo url', () => {
    const handler = new RepoToolHandler() as any;
    expect(() => handler.validateHttpsRepoUrl('git@github.com:example/repo.git')).toThrow(
      'repo_writer repoUrl must be a valid HTTPS URL',
    );
    expect(() => handler.validateHttpsRepoUrl('ssh://github.com/example/repo.git')).toThrow(
      'repo_writer only supports HTTPS repository URLs',
    );
  });

  it('rejects targetDir path traversal', () => {
    const handler = new RepoToolHandler() as any;
    expect(() => handler.normalizeRepoWriterTargetDir('../escape')).toThrow('repo_writer targetDir is invalid');
    expect(() => handler.normalizeRepoWriterTargetDir('/absolute/path')).toThrow('repo_writer targetDir is invalid');
  });
});
