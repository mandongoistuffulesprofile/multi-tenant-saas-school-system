import React from 'react';

interface Props {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<Props> = ({ title, description, actionLabel, onAction }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <h3 className="text-lg font-semibold text-gray-700">{title}</h3>
    {description && <p className="mt-2 text-sm text-gray-500 max-w-md">{description}</p>}
    {actionLabel && onAction && (
      <button onClick={onAction} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
        {actionLabel}
      </button>
    )}
  </div>
);
