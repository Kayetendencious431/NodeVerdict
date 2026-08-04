import { useState, useEffect, useRef } from 'react';
import { toHtml, downloadReport } from './exportUtils';
import { useI18n } from '../../shared/i18n/useI18n';

interface ExportButtonProps {
  /** Function that returns the markdown content */
  onExportMarkdown: () => string;
  /** Suggested filename without extension */
  filename: string;
  /** Optional: additional button styling */
  className?: string;
}

export function ExportButton({ onExportMarkdown, filename, className }: ExportButtonProps) {
  const { t } = useI18n();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);
  
  function handleExport(type: 'markdown' | 'html') {
    const content = type === 'markdown' 
      ? onExportMarkdown() 
      : toHtml(onExportMarkdown());
    const ext = type === 'markdown' ? 'md' : 'html';
    downloadReport(content, `${filename}.${ext}`, type === 'markdown' ? 'text/markdown' : 'text/html');
    setShowMenu(false);
  }
  
  return (
    <div ref={menuRef} className="relative inline-block">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className={`px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center gap-1.5 ${className ?? ''}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {t('common.export')}
      </button>
      {showMenu && (
        <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50">
          <button
            onClick={() => handleExport('markdown')}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 first:rounded-t-lg"
          >
            {t('common.exportMarkdown')}
          </button>
          <button
            onClick={() => handleExport('html')}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 last:rounded-b-lg"
          >
            {t('common.exportHtml')}
          </button>
        </div>
      )}
    </div>
  );
}