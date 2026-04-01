import { useUpload } from "@/contexts/UploadContext";
import { Loader2, Check, X } from "lucide-react";

export const UploadProgressWidget = () => {
  const { uploadState, dismiss } = useUpload();

  if (uploadState.status === 'idle') return null;

  const isComplete = uploadState.status === 'complete';
  const isError = uploadState.status === 'error';
  const isActive = uploadState.status === 'uploading' || uploadState.status === 'processing';
  const showBatchInfo = uploadState.totalInBatch > 1;

  return (
    <div className="fixed top-3 left-3 z-[100] flex items-center gap-2 bg-card border border-border rounded-full px-3 py-2 shadow-lg animate-in slide-in-from-left-2 fade-in duration-300">
      {isActive && (
        <>
          <div className="relative h-6 w-6">
            <svg className="h-6 w-6 -rotate-90" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="hsl(var(--muted))" strokeWidth="2.5" />
              <circle
                cx="12" cy="12" r="10" fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="2.5"
                strokeDasharray={`${2 * Math.PI * 10}`}
                strokeDashoffset={`${2 * Math.PI * 10 * (1 - uploadState.progress / 100)}`}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
            <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-primary" />
          </div>
          <span className="text-xs font-medium text-foreground whitespace-nowrap">
            {uploadState.status === 'uploading' ? 'Uploading' : 'Processing'}
            {showBatchInfo && ` ${uploadState.currentIndex}/${uploadState.totalInBatch}`}
            {!showBatchInfo && '...'}
            {uploadState.queueCount > 0 && (
              <span className="text-muted-foreground ml-1">+{uploadState.queueCount}</span>
            )}
          </span>
        </>
      )}
      {isComplete && (
        <>
          <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center">
            <Check className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-xs font-medium text-foreground">
            {showBatchInfo ? `${uploadState.totalInBatch} videos posted!` : 'Posted!'}
          </span>
        </>
      )}
      {isError && (
        <>
          <div className="h-6 w-6 rounded-full bg-destructive flex items-center justify-center">
            <X className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-xs font-medium text-foreground">Failed</span>
        </>
      )}
      {(isComplete || isError) && (
        <button onClick={dismiss} className="ml-1 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
