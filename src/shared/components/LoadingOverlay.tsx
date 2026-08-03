interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export function LoadingOverlay({ visible, message = 'Processing...' }: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium text-gray-600">{message}</p>
      </div>
    </div>
  );
}