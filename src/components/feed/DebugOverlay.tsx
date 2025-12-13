import { memo, useState } from "react";
import { Bug, Copy } from "lucide-react";
import { toast } from "sonner";

export interface DebugEvent {
  time: number;
  event: string;
  detail?: string;
}

export interface VideoErrorInfo {
  code: number | null;
  message: string | null;
  mediaError: string | null;
}

export interface DebugMetrics {
  activeIndex: number;
  videoId: string;
  sourceUrl: string;
  sourceType: 'optimized' | 'cloudinary' | 'supabase';
  preflightStatus: 'pending' | 'ok' | 'failed';
  preflightError: string | null;
  preflightHttpStatus: number | null;
  timeToMetadata: number | null;
  timeToPlaying: number | null;
  abortedPrefetches: number;
  retries: number;
  readyState: number;
  networkState: number;
  currentSrc: string;
  events: DebugEvent[];
  isScrolling: boolean;
  srcAssigned: boolean;
  videoError: VideoErrorInfo | null;
  playError: string | null;
  failureReason: 'none' | 'url_404' | 'url_403' | 'url_error' | 'autoplay_blocked' | 'canplay_timeout' | 'decode_error' | 'network_error' | 'unknown';
}

const MEDIA_ERROR_CODES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK', 
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

interface DebugOverlayProps {
  metrics: DebugMetrics;
}

export const DebugOverlay = memo(({ metrics }: DebugOverlayProps) => {
  const [expanded, setExpanded] = useState(true); // Default expanded for debugging

  const copyDebugInfo = () => {
    navigator.clipboard.writeText(JSON.stringify(metrics, null, 2));
    toast.success('Debug info copied!');
  };

  const getFailureColor = (reason: DebugMetrics['failureReason']) => {
    switch (reason) {
      case 'none': return 'text-green-400';
      case 'url_404':
      case 'url_403':
      case 'url_error': return 'text-red-400';
      case 'autoplay_blocked': return 'text-yellow-400';
      case 'canplay_timeout': return 'text-orange-400';
      case 'decode_error':
      case 'network_error': return 'text-red-400';
      default: return 'text-gray-400';
    }
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
        <div className="pointer-events-auto bg-black/95 rounded-lg p-3 text-xs font-mono text-white max-h-[70vh] overflow-auto border border-white/20">
          <div className="space-y-2">
            {/* Status row */}
            <div className="flex gap-4 flex-wrap">
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
              <div>
                <span className="text-gray-400">Src:</span>{' '}
                <span className={metrics.srcAssigned ? 'text-green-400' : 'text-red-400'}>
                  {metrics.srcAssigned ? 'assigned' : 'NOT ASSIGNED'}
                </span>
              </div>
            </div>

            {/* Failure diagnosis */}
            <div className="bg-white/5 p-2 rounded">
              <span className="text-gray-400">Failure:</span>{' '}
              <span className={getFailureColor(metrics.failureReason)}>
                {metrics.failureReason.toUpperCase().replace(/_/g, ' ')}
              </span>
            </div>

            {/* Preflight status */}
            <div>
              <span className="text-gray-400">Preflight:</span>{' '}
              <span className={
                metrics.preflightStatus === 'ok' ? 'text-green-400' :
                metrics.preflightStatus === 'failed' ? 'text-red-400' : 'text-yellow-400'
              }>
                {metrics.preflightStatus.toUpperCase()}
                {metrics.preflightHttpStatus !== null && ` (${metrics.preflightHttpStatus})`}
              </span>
              {metrics.preflightError && (
                <span className="text-red-400 ml-2">{metrics.preflightError}</span>
              )}
            </div>
            
            {/* Source info */}
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
              <span className="text-blue-300 text-[10px]">{metrics.sourceUrl}</span>
            </div>

            <div className="break-all">
              <span className="text-gray-400">currentSrc:</span>{' '}
              <span className="text-purple-300 text-[10px]">{metrics.currentSrc || '(empty)'}</span>
            </div>

            {/* Video element state */}
            <div className="flex gap-4">
              <div>
                <span className="text-gray-400">readyState:</span>{' '}
                <span className={metrics.readyState >= 3 ? 'text-green-400' : 'text-yellow-400'}>
                  {metrics.readyState}
                </span>
              </div>
              <div>
                <span className="text-gray-400">networkState:</span>{' '}
                <span className="text-white">{metrics.networkState}</span>
              </div>
            </div>
            
            {/* Timing */}
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
              <div>
                <span className="text-gray-400">Retries:</span>{' '}
                <span className="text-white">{metrics.retries}</span>
              </div>
            </div>

            {/* Video error details */}
            {metrics.videoError && (
              <div className="bg-red-900/30 p-2 rounded border border-red-500/50">
                <div className="text-red-400 font-bold mb-1">VIDEO ERROR:</div>
                <div>
                  <span className="text-gray-400">Code:</span>{' '}
                  <span className="text-red-300">
                    {metrics.videoError.code} ({metrics.videoError.code ? MEDIA_ERROR_CODES[metrics.videoError.code] : 'unknown'})
                  </span>
                </div>
                {metrics.videoError.message && (
                  <div className="text-red-300 text-[10px]">{metrics.videoError.message}</div>
                )}
              </div>
            )}

            {/* Play error */}
            {metrics.playError && (
              <div className="bg-yellow-900/30 p-2 rounded border border-yellow-500/50">
                <span className="text-yellow-400">Play Error:</span>{' '}
                <span className="text-yellow-300">{metrics.playError}</span>
              </div>
            )}
            
            {/* Events */}
            <div className="text-gray-400 mt-2">Events (last 20):</div>
            <div className="space-y-0.5 max-h-40 overflow-auto bg-white/5 p-2 rounded">
              {metrics.events.length === 0 ? (
                <div className="text-gray-500">No events yet</div>
              ) : (
                metrics.events.map((ev, i) => (
                  <div key={i} className="text-gray-300">
                    <span className="text-gray-500">+{ev.time}ms</span>{' '}
                    <span className={
                      ev.event.includes('error') ? 'text-red-400' :
                      ev.event.includes('playing') ? 'text-green-400' :
                      ev.event.includes('fail') ? 'text-red-400' : 'text-white'
                    }>
                      {ev.event}
                    </span>
                    {ev.detail && <span className="text-gray-400"> - {ev.detail}</span>}
                  </div>
                ))
              )}
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
