import { memo, useState } from "react";
import { Bug, Copy } from "lucide-react";
import { toast } from "sonner";

export interface DebugEvent {
  time: number;
  event: string;
  detail?: string;
}

export interface DebugMetrics {
  activeIndex: number;
  videoId: string;
  sourceUrl: string;
  sourceType: 'optimized' | 'cloudinary' | 'supabase';
  headCheckStatus: number | null;
  timeToMetadata: number | null;
  timeToPlaying: number | null;
  abortedPrefetches: number;
  retries: number;
  readyState: number;
  networkState: number;
  events: DebugEvent[];
  isScrolling: boolean;
}

interface DebugOverlayProps {
  metrics: DebugMetrics;
}

export const DebugOverlay = memo(({ metrics }: DebugOverlayProps) => {
  const [expanded, setExpanded] = useState(false);

  const copyDebugInfo = () => {
    navigator.clipboard.writeText(JSON.stringify(metrics, null, 2));
    toast.success('Debug info copied!');
  };

  return (
    <div className="absolute top-4 left-4 right-16 z-50 pointer-events-none">
      <button
        onClick={() => setExpanded(!expanded)}
        className="pointer-events-auto mb-2 flex items-center gap-1 px-2 py-1 bg-black/80 rounded text-xs text-white"
      >
        <Bug className="h-3 w-3" />
        {expanded ? 'Hide' : 'Debug'}
      </button>
      
      {expanded && (
        <div className="pointer-events-auto bg-black/90 rounded-lg p-3 text-xs font-mono text-white max-h-[60vh] overflow-auto">
          <div className="space-y-2">
            <div className="flex gap-4">
              <div>
                <span className="text-gray-400">Active:</span>{' '}
                <span className="text-green-400">{metrics.activeIndex}</span>
              </div>
              <div>
                <span className="text-gray-400">Scrolling:</span>{' '}
                <span className={metrics.isScrolling ? 'text-yellow-400' : 'text-green-400'}>
                  {metrics.isScrolling ? 'YES' : 'no'}
                </span>
              </div>
            </div>
            
            <div>
              <span className="text-gray-400">Source:</span>{' '}
              <span className={
                metrics.sourceType === 'optimized' ? 'text-green-400' : 
                metrics.sourceType === 'cloudinary' ? 'text-blue-400' : 'text-yellow-400'
              }>
                {metrics.sourceType.toUpperCase()}
              </span>
            </div>
            
            <div className="break-all">
              <span className="text-gray-400">URL:</span>{' '}
              <span className="text-blue-300">{metrics.sourceUrl.substring(0, 60)}...</span>
            </div>
            
            <div className="flex gap-4">
              <div>
                <span className="text-gray-400">HEAD:</span>{' '}
                <span className={metrics.headCheckStatus === 200 ? 'text-green-400' : 'text-gray-400'}>
                  {metrics.headCheckStatus ?? 'pending'}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Retries:</span>{' '}
                <span className="text-white">{metrics.retries}</span>
              </div>
              <div>
                <span className="text-gray-400">Aborts:</span>{' '}
                <span className="text-white">{metrics.abortedPrefetches}</span>
              </div>
            </div>
            
            <div className="flex gap-4">
              <div>
                <span className="text-gray-400">TTMD:</span>{' '}
                <span className={metrics.timeToMetadata ? 'text-green-400' : 'text-gray-500'}>
                  {metrics.timeToMetadata ? `${metrics.timeToMetadata}ms` : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-400">TTFF:</span>{' '}
                <span className={metrics.timeToPlaying ? 'text-green-400' : 'text-gray-500'}>
                  {metrics.timeToPlaying ? `${metrics.timeToPlaying}ms` : '-'}
                </span>
              </div>
            </div>
            
            <div>
              <span className="text-gray-400">State:</span>{' '}
              <span className="text-white">ready={metrics.readyState} net={metrics.networkState}</span>
            </div>
            
            <div className="text-gray-400 mt-2">Events (last 15):</div>
            <div className="space-y-0.5 max-h-32 overflow-auto">
              {metrics.events.map((ev, i) => (
                <div key={i} className="text-gray-300">
                  <span className="text-gray-500">+{ev.time}ms</span>{' '}
                  <span className={ev.event.includes('error') ? 'text-red-400' : 'text-white'}>
                    {ev.event}
                  </span>
                  {ev.detail && <span className="text-gray-400"> - {ev.detail}</span>}
                </div>
              ))}
            </div>
            
            <button
              onClick={copyDebugInfo}
              className="mt-2 flex items-center gap-1 px-2 py-1 bg-white/20 rounded hover:bg-white/30"
            >
              <Copy className="h-3 w-3" /> Copy Debug Info
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

DebugOverlay.displayName = 'DebugOverlay';
