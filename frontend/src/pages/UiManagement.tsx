import React, { useMemo, useState } from 'react';
import * as HeroOutlineIcons from '@heroicons/react/24/outline';
import * as HeroSolidIcons from '@heroicons/react/24/solid';

type TabKey = 'icon-management';
type IconSet = 'all' | 'outline' | 'solid';

type IconEntry = {
  name: string;
  set: Exclude<IconSet, 'all'>;
  component: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const iconNameRegex = /Icon$/;

const pickIcons = (icons: Record<string, unknown>, set: Exclude<IconSet, 'all'>): IconEntry[] =>
  Object.entries(icons)
    .filter(([name]) => iconNameRegex.test(name))
    .map(([name, component]) => ({
      name,
      set,
      component: component as React.ComponentType<React.SVGProps<SVGSVGElement>>,
    }));

const UiManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('icon-management');
  const [keyword, setKeyword] = useState('');
  const [iconSet, setIconSet] = useState<IconSet>('all');
  const [copiedTipVisible, setCopiedTipVisible] = useState(false);

  const copyText = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.focus();
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  };

  const handleCopyIconName = async (name: string) => {
    try {
      await copyText(name);
      setCopiedTipVisible(true);
      window.setTimeout(() => {
        setCopiedTipVisible(false);
      }, 1200);
    } catch {
      setCopiedTipVisible(false);
    }
  };

  const allIcons = useMemo(() => {
    return [...pickIcons(HeroOutlineIcons, 'outline'), ...pickIcons(HeroSolidIcons, 'solid')].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, []);

  const filteredIcons = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return allIcons.filter((icon) => {
      const matchSet = iconSet === 'all' || icon.set === iconSet;
      const matchKeyword = !normalizedKeyword || icon.name.toLowerCase().includes(normalizedKeyword);
      return matchSet && matchKeyword;
    });
  }, [allIcons, iconSet, keyword]);

  return (
    <div className="space-y-4">
      {copiedTipVisible && (
        <div className="fixed right-6 top-20 z-50 rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
          已复制
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">UI管理</h1>
        <p className="mt-1 text-sm text-gray-500">集中查看系统可用 UI 资源，当前提供图标管理。</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <div className="inline-flex rounded-md bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('icon-management')}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'icon-management' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              图标管理
            </button>
          </div>
        </div>

        {activeTab === 'icon-management' && (
          <div className="space-y-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索图标名称，如: chart, user"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none ring-primary-500 focus:border-primary-500 focus:ring-1 sm:max-w-sm"
                />
                <select
                  value={iconSet}
                  onChange={(event) => setIconSet(event.target.value as IconSet)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none ring-primary-500 focus:border-primary-500 focus:ring-1"
                >
                  <option value="all">全部风格</option>
                  <option value="outline">Outline</option>
                  <option value="solid">Solid</option>
                </select>
              </div>
              <p className="text-sm text-gray-500">当前显示 {filteredIcons.length} 个图标</p>
            </div>

            <div className="max-h-[65vh] overflow-y-auto rounded-md border border-gray-200 p-3">
              {filteredIcons.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-500">未找到匹配图标，请调整筛选条件。</div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {filteredIcons.map((icon) => {
                    const IconComponent = icon.component;
                    return (
                      <button
                        type="button"
                        key={`${icon.set}-${icon.name}`}
                        onClick={() => void handleCopyIconName(icon.name)}
                        className="rounded-md border border-gray-200 bg-gray-50 p-3 text-center transition-colors hover:border-primary-300 hover:bg-primary-50"
                        title={icon.name}
                      >
                        <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md bg-white text-gray-700">
                          <IconComponent className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <p className="mt-2 break-all text-[11px] text-gray-600">{icon.name}</p>
                        <p className="mt-1 text-[10px] uppercase text-gray-400">{icon.set}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UiManagement;
