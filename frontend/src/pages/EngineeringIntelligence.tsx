import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  FolderIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  engineeringIntelligenceService,
  EngineeringDocTreeNode,
} from '../services/engineeringIntelligenceService';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdownToHtml(line: string): string {
  return line
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-gray-100 rounded text-xs">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-primary-600 underline">$1</a>');
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const html: string[] = [];
  let inCodeBlock = false;
  let inUnorderedList = false;
  let inOrderedList = false;

  const closeLists = () => {
    if (inUnorderedList) {
      html.push('</ul>');
      inUnorderedList = false;
    }
    if (inOrderedList) {
      html.push('</ol>');
      inOrderedList = false;
    }
  };

  const parseTableRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => inlineMarkdownToHtml(escapeHtml(cell.trim())));

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\r/g, '');

    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        closeLists();
        html.push('<pre class="bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto text-xs"><code>');
        inCodeBlock = true;
      } else {
        html.push('</code></pre>');
        inCodeBlock = false;
      }
      i += 1;
      continue;
    }

    if (inCodeBlock) {
      html.push(`${escapeHtml(line)}\n`);
      i += 1;
      continue;
    }

    const escaped = escapeHtml(line);
    const nextLine = (lines[i + 1] || '').replace(/\r/g, '');
    const isTableHeader = line.includes('|') && /^\|?\s*[:-]+[-| :]*\|?\s*$/.test(nextLine.trim());

    if (isTableHeader) {
      closeLists();
      const headers = parseTableRow(line);
      html.push('<div class="overflow-x-auto my-3"><table class="min-w-full border border-gray-200 text-sm">');
      html.push('<thead class="bg-gray-50"><tr>');
      headers.forEach((cell) => {
        html.push(`<th class="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">${cell}</th>`);
      });
      html.push('</tr></thead><tbody>');

      i += 2;
      while (i < lines.length) {
        const bodyLine = lines[i].replace(/\r/g, '');
        if (!bodyLine.includes('|') || bodyLine.trim().length === 0) {
          break;
        }
        const cells = parseTableRow(bodyLine);
        html.push('<tr>');
        cells.forEach((cell) => {
          html.push(`<td class="border border-gray-200 px-3 py-2 text-gray-800">${cell}</td>`);
        });
        html.push('</tr>');
        i += 1;
      }
      html.push('</tbody></table></div>');
      continue;
    }

    if (/^#{1,6}\s+/.test(escaped)) {
      closeLists();
      const level = escaped.match(/^#+/)?.[0].length || 1;
      const content = inlineMarkdownToHtml(escaped.replace(/^#{1,6}\s+/, ''));
      const headingClass = level <= 2 ? 'text-xl font-semibold mt-4 mb-2' : 'text-lg font-semibold mt-3 mb-2';
      html.push(`<h${level} class="${headingClass}">${content}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(escaped)) {
      if (inOrderedList) {
        html.push('</ol>');
        inOrderedList = false;
      }
      if (!inUnorderedList) {
        html.push('<ul class="list-disc pl-6 my-2 space-y-1">');
        inUnorderedList = true;
      }
      const content = inlineMarkdownToHtml(escaped.replace(/^[-*]\s+/, ''));
      html.push(`<li class="text-sm text-gray-800">${content}</li>`);
      i += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(escaped)) {
      if (inUnorderedList) {
        html.push('</ul>');
        inUnorderedList = false;
      }
      if (!inOrderedList) {
        html.push('<ol class="list-decimal pl-6 my-2 space-y-1">');
        inOrderedList = true;
      }
      const content = inlineMarkdownToHtml(escaped.replace(/^\d+\.\s+/, ''));
      html.push(`<li class="text-sm text-gray-800">${content}</li>`);
      i += 1;
      continue;
    }

    closeLists();

    if (escaped.trim().length === 0) {
      html.push('<div class="h-3"></div>');
      i += 1;
      continue;
    }

    html.push(`<p class="text-sm text-gray-800 leading-6">${inlineMarkdownToHtml(escaped)}</p>`);
    i += 1;
  }

  closeLists();
  if (inCodeBlock) {
    html.push('</code></pre>');
  }

  return html.join('');
}

function findFirstFile(nodes: EngineeringDocTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node.path;
    }
    if (node.children?.length) {
      const nested = findFirstFile(node.children);
      if (nested) return nested;
    }
  }
  return null;
}

const EngineeringIntelligence: React.FC = () => {
  const queryClient = useQueryClient();
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [activeRepoId, setActiveRepoId] = useState('');
  const [selectedDocPath, setSelectedDocPath] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ docs: true });

  const { data: repositories = [], isLoading: repositoriesLoading, refetch: refetchRepositories } = useQuery(
    'ei-repositories',
    () => engineeringIntelligenceService.listRepositories(),
    { retry: false },
  );

  const createRepoMutation = useMutation(
    () => engineeringIntelligenceService.createRepository({ repositoryUrl: repositoryUrl.trim(), branch: branch.trim() || undefined }),
    {
      onSuccess: () => {
        setRepositoryUrl('');
        queryClient.invalidateQueries('ei-repositories');
      },
    },
  );

  const deleteRepoMutation = useMutation((id: string) => engineeringIntelligenceService.deleteRepository(id), {
    onSuccess: () => {
      queryClient.invalidateQueries('ei-repositories');
      setActiveRepoId('');
      setSelectedDocPath('');
      setDrawerOpen(false);
    },
  });

  const { data: docsTree, isLoading: docsTreeLoading, refetch: refetchDocsTree } = useQuery(
    ['ei-docs-tree', activeRepoId],
    () => engineeringIntelligenceService.getDocsTree(activeRepoId),
    {
      enabled: !!activeRepoId,
      retry: false,
      onSuccess: (result) => {
        if (!selectedDocPath) {
          const first = findFirstFile(result.tree || []);
          if (first) setSelectedDocPath(first);
        }
      },
    },
  );

  const { data: docContent, isLoading: docContentLoading, error: docContentError, refetch: refetchDocContent } = useQuery(
    ['ei-doc-content', activeRepoId, selectedDocPath],
    () => engineeringIntelligenceService.getDocContent(activeRepoId, selectedDocPath),
    { enabled: !!activeRepoId && !!selectedDocPath && drawerOpen, retry: false },
  );

  const { data: docHistory, isLoading: docHistoryLoading, refetch: refetchDocHistory } = useQuery(
    ['ei-doc-history', activeRepoId, selectedDocPath],
    () => engineeringIntelligenceService.getDocHistory(activeRepoId, selectedDocPath),
    { enabled: !!activeRepoId && !!selectedDocPath, retry: false },
  );

  const activeRepo = useMemo(() => repositories.find((item) => item._id === activeRepoId), [repositories, activeRepoId]);

  const toggleDir = (path: string) => setExpandedDirs((prev) => ({ ...prev, [path]: !prev[path] }));

  const renderTree = (nodes: EngineeringDocTreeNode[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
      if (node.type === 'dir') {
        const expanded = expandedDirs[node.path] ?? depth === 0;
        return (
          <div key={node.path}>
            <button
              onClick={() => toggleDir(node.path)}
              className="w-full flex items-center gap-1 text-left px-2 py-1 rounded hover:bg-gray-100"
              style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
              {expanded ? <ChevronDownIcon className="h-4 w-4 text-gray-500" /> : <ChevronRightIcon className="h-4 w-4 text-gray-500" />}
              <FolderIcon className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-gray-700">{node.name}</span>
            </button>
            {expanded && node.children?.length ? renderTree(node.children, depth + 1) : null}
          </div>
        );
      }

      const active = selectedDocPath === node.path;
      return (
        <button
          key={node.path}
          onClick={() => {
            setSelectedDocPath(node.path);
            setDrawerOpen(true);
          }}
          className={`w-full flex items-center gap-1 text-left px-2 py-1 rounded ${active ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-100 text-gray-700'}`}
          style={{ paddingLeft: `${28 + depth * 12}px` }}
        >
          <DocumentTextIcon className="h-4 w-4" />
          <span className="text-xs truncate">{node.name}</span>
        </button>
      );
    });

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h1 className="text-lg font-semibold text-gray-900">研发智能</h1>
        <p className="mt-1 text-sm text-gray-600">基于仓库 docs 的技术状态感知与文档追踪。</p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-2">
          <input
            value={repositoryUrl}
            onChange={(e) => setRepositoryUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="md:col-span-8 border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="branch"
            className="md:col-span-2 border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <button
            onClick={() => createRepoMutation.mutate()}
            disabled={!repositoryUrl.trim() || createRepoMutation.isLoading}
            className="md:col-span-2 bg-primary-600 text-white rounded px-3 py-2 text-sm disabled:bg-gray-300"
          >
            添加仓库
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-4 bg-white border border-gray-200 rounded-lg">
          <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
            <p className="text-sm font-semibold">仓库</p>
            <button onClick={() => refetchRepositories()}><ArrowPathIcon className="h-4 w-4 text-gray-500" /></button>
          </div>
          <div className="p-3 space-y-2 max-h-[680px] overflow-y-auto">
            {repositoriesLoading ? (
              <p className="text-xs text-gray-500">加载中...</p>
            ) : (
              repositories.map((repo) => (
                <div key={repo._id} className="border border-gray-200 rounded p-2 bg-gray-50">
                  <p className="text-xs font-medium break-all">{repo.repositoryUrl}</p>
                  <p className="text-xs text-gray-500 mt-1">{repo.branch}</p>
                  {repo.lastError ? <p className="text-xs text-red-600 mt-1">{repo.lastError}</p> : null}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setActiveRepoId(repo._id);
                        setSelectedDocPath('');
                        setDrawerOpen(false);
                      }}
                      className="text-xs border border-gray-300 rounded px-2 py-1"
                    >
                      打开
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确认删除仓库配置？\n${repo.repositoryUrl}`)) {
                          deleteRepoMutation.mutate(repo._id);
                        }
                      }}
                      className="text-xs border border-red-200 text-red-600 rounded px-2 py-1"
                    >
                      <span className="inline-flex items-center gap-1"><TrashIcon className="h-3 w-3" />删除</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="xl:col-span-8 bg-white border border-gray-200 rounded-lg">
          <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
            <p className="text-sm font-semibold">文档与历史</p>
            <p className="text-xs text-gray-500">{activeRepo?.repositoryUrl || '请选择仓库'}</p>
          </div>
          <div className="p-3 grid grid-cols-1 xl:grid-cols-12 gap-3">
            <div className="xl:col-span-5 border border-gray-200 rounded">
              <div className="px-2 py-2 border-b border-gray-200 flex items-center justify-between">
                <p className="text-xs font-semibold">docs目录</p>
                <button onClick={() => refetchDocsTree()}><ArrowPathIcon className="h-4 w-4 text-gray-500" /></button>
              </div>
              <div className="p-2 max-h-[540px] overflow-y-auto">
                {docsTreeLoading ? <p className="text-xs text-gray-500">加载中...</p> : docsTree?.tree ? renderTree(docsTree.tree) : <p className="text-xs text-gray-400">暂无文档</p>}
              </div>
            </div>

            <div className="xl:col-span-7 border border-gray-200 rounded">
              <div className="px-2 py-2 border-b border-gray-200 flex items-center justify-between">
                <p className="text-xs font-semibold">更新记录</p>
                <button onClick={() => refetchDocHistory()} disabled={!selectedDocPath}><ArrowPathIcon className="h-4 w-4 text-gray-500" /></button>
              </div>
              <div className="p-3 max-h-[540px] overflow-y-auto">
                {!selectedDocPath ? (
                  <p className="text-xs text-gray-400">点击左侧文档后在右侧抽屉阅读正文。</p>
                ) : docHistoryLoading ? (
                  <p className="text-xs text-gray-500">加载中...</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-600">提交次数: {docHistory?.totalCommits ?? 0}</p>
                    <p className="text-xs text-gray-600">贡献者: {docHistory?.uniqueContributors ?? 0}</p>
                    <p className="text-xs text-gray-600">
                      最近更新: {docHistory?.lastUpdatedAt ? new Date(docHistory.lastUpdatedAt).toLocaleString() : '-'}
                    </p>
                    {(docHistory?.commits || []).map((item) => (
                      <a key={item.sha} href={item.htmlUrl} target="_blank" rel="noreferrer" className="block border border-gray-200 rounded p-2 hover:bg-gray-50">
                        <p className="text-xs font-medium">{item.shortSha}</p>
                        <p className="text-xs text-gray-700 mt-1 line-clamp-2">{item.message}</p>
                        <p className="text-xs text-gray-500 mt-1">{item.author}</p>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-[90]">
          <button className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-label="关闭抽屉" />
          <aside className="absolute right-0 top-0 h-full w-full sm:w-[88vw] lg:w-[64vw] bg-white border-l border-gray-200 shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">文档阅读</p>
                <p className="text-xs text-gray-500 mt-1 break-all">{selectedDocPath}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => refetchDocContent()}><ArrowPathIcon className="h-4 w-4 text-gray-500" /></button>
                <button onClick={() => setDrawerOpen(false)}><XMarkIcon className="h-5 w-5 text-gray-500" /></button>
              </div>
            </div>
            <div className="px-4 py-2 border-b border-gray-100 text-xs text-gray-600 flex gap-4">
              <span>大小: {docContent?.document.size ?? 0} bytes</span>
              {docContent?.document.htmlUrl ? (
                <a href={docContent.document.htmlUrl} target="_blank" rel="noreferrer" className="text-primary-600 underline">GitHub</a>
              ) : null}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {docContentLoading ? (
                <p className="text-sm text-gray-500">加载中...</p>
              ) : docContentError ? (
                <p className="text-sm text-red-600">文档加载失败，请检查路径或权限。</p>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: markdownToHtml(docContent?.document.content || '') }} />
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
};

export default EngineeringIntelligence;
