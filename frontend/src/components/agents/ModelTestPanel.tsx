import React from 'react';
import { BeakerIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import type { ModelTestPanelProps } from './types';

const isDeprecatedAnthropicModel = (provider?: string, model?: string) => {
  return provider === 'anthropic' && /20240229/.test(model || '');
};

export const ModelTestPanel: React.FC<ModelTestPanelProps> = ({
  selectedModel,
  selectedModelId,
  testResult,
  testedModelId,
  isTesting,
  streamingResponse,
  onTest,
}) => {
  return (
    <div>
      {isDeprecatedAnthropicModel(selectedModel?.provider, selectedModel?.model) && (
        <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-sm mb-3">
          当前选择的 Anthropic 模型版本可能已下线。若测试失败，请切换到较新的 Claude 模型后重试。
        </div>
      )}

      <button
        onClick={onTest}
        disabled={isTesting || !selectedModel}
        className="inline-flex items-center px-4 py-2 border border-indigo-300 text-sm font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
      >
        <BeakerIcon className="h-4 w-4 mr-1" />
        {isTesting ? '测试中...' : '测试模型连接'}
      </button>
      <p className="mt-2 text-xs text-gray-500">会用当前Agent设定向所选模型发送一条测试消息。</p>

      {(isTesting || streamingResponse) && (
        <div className="mt-3 p-3 rounded-md border bg-indigo-50 border-indigo-200">
          <div className="flex items-center mb-1">
            <BeakerIcon className="h-4 w-4 text-indigo-600 mr-1" />
            <span className="text-sm font-medium text-indigo-800">
              {isTesting ? '流式返回中...' : '流式返回结果'}
            </span>
          </div>
          <pre className="text-xs text-indigo-800 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {streamingResponse || '等待模型返回...'}
          </pre>
        </div>
      )}

      {testResult && testedModelId === selectedModelId && (
        <div className={`mt-3 p-3 rounded-md border ${testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center mb-1">
            {testResult.success ? (
              <CheckCircleIcon className="h-4 w-4 text-green-600 mr-1" />
            ) : (
              <XCircleIcon className="h-4 w-4 text-red-600 mr-1" />
            )}
            <span className={`text-sm font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
              {testResult.success ? '模型连接成功' : '模型连接失败'}
            </span>
          </div>
          <div className={`text-xs ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
            {testResult.success ? (
              <>
                <p>耗时: {testResult.duration || '-'}</p>
                <p>密钥来源: {testResult.keySource === 'custom' ? 'Agent绑定密钥' : '系统默认密钥'}</p>
                {testResult.note && <p className="mt-1 break-words">说明: {testResult.note}</p>}
                <p className="mt-1 break-words">响应: {testResult.response || '-'}</p>
              </>
            ) : (
              <>
                <p>密钥来源: {testResult.keySource === 'custom' ? 'Agent绑定密钥' : '系统默认密钥'}</p>
                <p className="break-words">错误: {testResult.error || '未知错误'}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
