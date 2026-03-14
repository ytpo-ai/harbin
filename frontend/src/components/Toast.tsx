import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ToastState } from '../hooks/useToast';

interface ToastProps {
  toast: ToastState;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  return (
    <div className="fixed right-4 top-4 z-[120] max-w-sm" role="status" aria-live="polite">
      <div
        className={`rounded-lg border shadow-lg px-3 py-2 pr-9 text-sm ${
          toast.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}
      >
        {toast.message}
        <button
          onClick={onClose}
          className="absolute right-2 top-2 text-current/70 hover:text-current"
          aria-label="关闭提示"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default Toast;
