import React, { useEffect, useMemo, useState } from 'react';
import { DiscussionParticipant } from '../../services/discussionService';
import { dataCollectionService, DataRecordItem } from '../../services/dataCollectionService';

type MessageDataReference = {
  dataRecordId: string;
  dataSourceName: string;
  dataPreview: string;
  collectedAt: string;
};

type MessageInputProps = {
  value: string;
  sending: boolean;
  projectId?: string;
  participants: DiscussionParticipant[];
  onChange: (value: string) => void;
  onSend: (dataReferences: MessageDataReference[]) => void;
};

const MessageInput: React.FC<MessageInputProps> = ({
  value,
  sending,
  projectId,
  participants,
  onChange,
  onSend,
}) => {
  const [openDataPicker, setOpenDataPicker] = useState(false);
  const [dataKeyword, setDataKeyword] = useState('');
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [dataRecords, setDataRecords] = useState<DataRecordItem[]>([]);
  const [selectedDataMap, setSelectedDataMap] = useState<Record<string, MessageDataReference>>({});
  const mentionableParticipants = participants.filter((participant) => participant.type === 'ai_agent' || participant.role === 'on_demand');

  const appendMention = (displayName: string) => {
    const suffix = value.trimEnd().length > 0 ? ' ' : '';
    onChange(`${value}${suffix}@${displayName} `);
  };

  const formatDataPreview = (record: DataRecordItem): string => {
    const entries = Object.entries(record.data || {});
    if (!entries.length) {
      return `${record.dataCategory} (${record.status})`;
    }
    const compact = entries
      .slice(0, 4)
      .map(([key, val]) => `${key}: ${String(val)}`)
      .join(' | ');
    return compact.slice(0, 220);
  };

  const formatReferenceLine = (record: DataRecordItem): string => {
    const collectedAt = new Date(record.collectedAt);
    const collectedAtText = Number.isNaN(collectedAt.getTime()) ? record.collectedAt : collectedAt.toLocaleString();
    return `根据 ${record.dataSourceId} 数据（${collectedAtText}）：${formatDataPreview(record)}`;
  };

  useEffect(() => {
    if (!openDataPicker || !projectId) {
      return;
    }

    let cancelled = false;
    const loadDataRecords = async () => {
      try {
        setDataLoading(true);
        setDataError('');
        const list = await dataCollectionService.getDataRecords(projectId);
        if (!cancelled) {
          setDataRecords(list.slice(0, 200));
        }
      } catch {
        if (!cancelled) {
          setDataError('数据记录加载失败，请稍后重试');
        }
      } finally {
        if (!cancelled) {
          setDataLoading(false);
        }
      }
    };

    void loadDataRecords();
    return () => {
      cancelled = true;
    };
  }, [openDataPicker, projectId]);

  useEffect(() => {
    if (!sending && !value.trim()) {
      setSelectedDataMap({});
    }
  }, [sending, value]);

  const filteredRecords = useMemo(() => {
    const keyword = dataKeyword.trim().toLowerCase();
    if (!keyword) {
      return dataRecords;
    }

    return dataRecords.filter((item) => {
      const haystack = `${item.dataSourceId} ${item.dataCategory} ${JSON.stringify(item.data || {})}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [dataKeyword, dataRecords]);

  const selectedDataReferences = useMemo(() => Object.values(selectedDataMap), [selectedDataMap]);

  const toggleDataRecord = (record: DataRecordItem) => {
    const referenceLine = formatReferenceLine(record);
    setSelectedDataMap((current) => {
      if (current[record._id]) {
        const next = { ...current };
        delete next[record._id];
        if (value.includes(referenceLine)) {
          const escapedLine = referenceLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const lineRegex = new RegExp(`(^|\\n)${escapedLine}(?=\\n|$)`, 'g');
          const cleaned = value.replace(lineRegex, '').replace(/\n{3,}/g, '\n\n').trim();
          onChange(cleaned);
        }
        return next;
      }

      if (!value.includes(referenceLine)) {
        const suffix = value.trimEnd().length > 0 ? '\n\n' : '';
        onChange(`${value.trimEnd()}${suffix}${referenceLine}`);
      }

      return {
        ...current,
        [record._id]: {
          dataRecordId: record._id,
          dataSourceName: record.dataSourceId,
          dataPreview: formatDataPreview(record),
          collectedAt: record.collectedAt,
        },
      };
    });
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSend(selectedDataReferences);
    }
  };

  const appendDataToken = () => {
    const suffix = value.trimEnd().length > 0 ? ' ' : '';
    onChange(`${value}${suffix}#data:`);
    setOpenDataPicker(true);
  };

  return (
    <div className="border-t border-[#c6c6c6] bg-white p-4">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息，支持 @参与者"
        rows={4}
        className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
      />

      {mentionableParticipants.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {mentionableParticipants.map((participant) => (
            <button
              key={participant.id}
              type="button"
              onClick={() => appendMention(participant.displayName)}
              className="border border-[#78a9ff] px-2 py-1 text-xs text-[#0f62fe] hover:bg-[#edf5ff]"
            >
              @{participant.displayName}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={appendDataToken}
          disabled={!projectId}
          className="border border-[#78a9ff] px-2 py-1 text-xs text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-50"
        >
          #data: 引用采集数据
        </button>
        {!projectId ? <span className="text-xs text-[#6f6f6f]">当前空间未关联项目，暂不可引用数据</span> : null}
      </div>

      {selectedDataReferences.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedDataReferences.map((reference) => (
            <span key={reference.dataRecordId} className="border border-[#a8a8a8] bg-[#f4f4f4] px-2 py-1 text-xs text-[#393939]">
              {reference.dataSourceName}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[#6f6f6f]">支持 Ctrl/Cmd + Enter 发送</span>
        <button
          type="button"
          onClick={() => onSend(selectedDataReferences)}
          disabled={sending || !value.trim()}
          className="bg-[#0f62fe] px-4 py-2 text-sm text-white hover:bg-[#0353e9] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? '发送中...' : '发送'}
        </button>
      </div>

      {openDataPicker ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-hidden border border-[#c6c6c6] bg-white">
            <div className="flex items-center justify-between border-b border-[#e0e0e0] px-4 py-3">
              <div className="text-sm text-[#161616]">选择数据引用</div>
              <button type="button" onClick={() => setOpenDataPicker(false)} className="text-xs text-[#0f62fe] hover:underline">
                关闭
              </button>
            </div>
            <div className="space-y-3 p-4">
              <input
                value={dataKeyword}
                onChange={(event) => setDataKeyword(event.target.value)}
                placeholder="搜索数据分类或字段值"
                className="w-full border border-[#c6c6c6] px-3 py-2 text-sm outline-none focus:border-[#0f62fe]"
              />
              {dataLoading ? <div className="text-xs text-[#6f6f6f]">加载数据中...</div> : null}
              {dataError ? <div className="text-xs text-[#da1e28]">{dataError}</div> : null}
              <div className="max-h-[50vh] space-y-2 overflow-auto">
                {filteredRecords.map((record) => {
                  const checked = Boolean(selectedDataMap[record._id]);
                  return (
                    <label key={record._id} className="flex cursor-pointer gap-2 border border-[#e0e0e0] p-2 hover:bg-[#f4f4f4]">
                      <input type="checkbox" checked={checked} onChange={() => toggleDataRecord(record)} />
                      <div className="min-w-0 text-xs">
                        <div className="text-[#161616]">{record.dataSourceId}</div>
                        <div className="mt-1 text-[#525252]">{formatDataPreview(record)}</div>
                        <div className="mt-1 text-[#6f6f6f]">{new Date(record.collectedAt).toLocaleString()}</div>
                      </div>
                    </label>
                  );
                })}
                {!dataLoading && !filteredRecords.length ? <div className="text-xs text-[#6f6f6f]">未找到匹配数据记录</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default MessageInput;
