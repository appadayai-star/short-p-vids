import { memo, useEffect, useState, useRef } from "react";
import { isVideoDebug } from "@/lib/cloudinary";

interface VideoDebugInfo {
  videoId: string;
  srcAttempted: string;
  errorCode: number | null;
  errorMessage: string;
  networkState: number;
  readyState: number;
  lastError: string;
  cspBlocked: boolean;
  cspViolation: string;
  timestamp: number;
}

interface VideoDebugOverlayProps {
  videoId: string;
  currentSrc: string;
  videoRef: React.RefObject<HTMLVideoElement>;
}

// CSP violation logger - global to catch all violations
let cspViolations: string[] = [];
let cspListenerAdded = false;

const addCspListener = () => {
  if (cspListenerAdded || typeof window === 'undefined') return;
  cspListenerAdded = true;
  
  window.addEventListener('securitypolicyviolation', (e) => {
    const violation = `${e.violatedDirective}: ${e.blockedURI}`;
    console.error('[CSP Violation]', violation);
    cspViolations.push(violation);
    // Keep only last 10
    if (cspViolations.length > 10) {
      cspViolations = cspViolations.slice(-10);
    }
  });
};

export const VideoDebugOverlay = memo(({ videoId, currentSrc, videoRef }: VideoDebugOverlayProps) => {
  const [debugInfo, setDebugInfo] = useState<VideoDebugInfo | null>(null);
  const [enabled, setEnabled] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check if debug is enabled
  useEffect(() => {
    setEnabled(isVideoDebug());
    addCspListener();
    
    // Re-check periodically in case localStorage changes
    const checkInterval = setInterval(() => {
      setEnabled(isVideoDebug());
    }, 1000);
    
    return () => clearInterval(checkInterval);
  }, []);

  // Update debug info periodically
  useEffect(() => {
    if (!enabled) return;

    const updateDebugInfo = () => {
      const video = videoRef.current;
      const error = video?.error;
      
      setDebugInfo({
        videoId,
        srcAttempted: currentSrc || 'none',
        errorCode: error?.code ?? null,
        errorMessage: error?.message || '',
        networkState: video?.networkState ?? -1,
        readyState: video?.readyState ?? -1,
        lastError: error ? `Code ${error.code}: ${error.message}` : 'none',
        cspBlocked: cspViolations.length > 0,
        cspViolation: cspViolations[cspViolations.length - 1] || '',
        timestamp: Date.now(),
      });
    };

    updateDebugInfo();
    intervalRef.current = setInterval(updateDebugInfo, 500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, videoId, currentSrc, videoRef]);

  if (!enabled || !debugInfo) return null;

  const networkStateLabels = ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE'];
  const readyStateLabels = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];

  return (
    <div className="fixed top-4 left-4 right-4 z-50 bg-black/90 text-green-400 font-mono text-xs p-3 rounded-lg max-h-[50vh] overflow-auto pointer-events-auto">
      <div className="font-bold text-yellow-400 mb-2">🔧 VIDEO DEBUG (localStorage.videoDebug=1)</div>
      
      <div className="space-y-1">
        <div>
          <span className="text-gray-400">videoId:</span> {debugInfo.videoId.substring(0, 8)}...
        </div>
        
        <div className="break-all">
          <span className="text-gray-400">srcAttempted:</span>{' '}
          <span className={debugInfo.srcAttempted.includes('cloudinary') ? 'text-cyan-400' : 'text-orange-400'}>
            {debugInfo.srcAttempted.substring(0, 100)}
            {debugInfo.srcAttempted.length > 100 && '...'}
          </span>
        </div>
        
        <div>
          <span className="text-gray-400">networkState:</span>{' '}
          <span className={debugInfo.networkState === 3 ? 'text-red-400' : 'text-green-400'}>
            {debugInfo.networkState} ({networkStateLabels[debugInfo.networkState] || 'UNKNOWN'})
          </span>
        </div>
        
        <div>
          <span className="text-gray-400">readyState:</span>{' '}
          <span className={debugInfo.readyState < 2 ? 'text-yellow-400' : 'text-green-400'}>
            {debugInfo.readyState} ({readyStateLabels[debugInfo.readyState] || 'UNKNOWN'})
          </span>
        </div>
        
        {debugInfo.errorCode !== null && (
          <div className="text-red-400">
            <span className="text-gray-400">error.code:</span> {debugInfo.errorCode}
          </div>
        )}
        
        {debugInfo.errorMessage && (
          <div className="text-red-400 break-all">
            <span className="text-gray-400">error.message:</span> {debugInfo.errorMessage}
          </div>
        )}
        
        <div>
          <span className="text-gray-400">lastError:</span>{' '}
          <span className={debugInfo.lastError === 'none' ? 'text-green-400' : 'text-red-400'}>
            {debugInfo.lastError}
          </span>
        </div>
        
        <div>
          <span className="text-gray-400">CSP blocked:</span>{' '}
          <span className={debugInfo.cspBlocked ? 'text-red-400' : 'text-green-400'}>
            {debugInfo.cspBlocked ? 'YES' : 'no'}
          </span>
        </div>
        
        {debugInfo.cspViolation && (
          <div className="text-red-400 break-all">
            <span className="text-gray-400">CSP violation:</span> {debugInfo.cspViolation}
          </div>
        )}
        
        <div className="text-gray-500 mt-2">
          Updated: {new Date(debugInfo.timestamp).toLocaleTimeString()}
        </div>
      </div>
      
      <div className="mt-2 text-gray-500 border-t border-gray-700 pt-2">
        To disable: localStorage.removeItem('videoDebug') then refresh
      </div>
    </div>
  );
});

VideoDebugOverlay.displayName = 'VideoDebugOverlay';
