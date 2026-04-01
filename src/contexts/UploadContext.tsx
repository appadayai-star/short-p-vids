import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type UploadStatus = 'idle' | 'uploading' | 'processing' | 'complete' | 'error';

interface QueuedUpload {
  file: File;
  description: string;
  categories: string[];
  userId: string;
}

interface UploadState {
  status: UploadStatus;
  progress: number;
  videoId: string | null;
  queueCount: number; // how many are waiting (excluding current)
  currentIndex: number; // 1-based index of current upload in batch
  totalInBatch: number; // total uploads in this batch
}

interface UploadContextType {
  uploadState: UploadState;
  startUpload: (file: File, description: string, categories: string[], userId: string) => void;
  dismiss: () => void;
  isUploading: boolean;
}

const UploadContext = createContext<UploadContextType | null>(null);

export const useUpload = () => {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used within UploadProvider");
  return ctx;
};

const initialState: UploadState = {
  status: 'idle',
  progress: 0,
  videoId: null,
  queueCount: 0,
  currentIndex: 0,
  totalInBatch: 0,
};

export const UploadProvider = ({ children }: { children: ReactNode }) => {
  const [uploadState, setUploadState] = useState<UploadState>(initialState);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<QueuedUpload[]>([]);
  const isProcessingRef = useRef(false);
  const batchTotalRef = useRef(0);
  const batchIndexRef = useRef(0);

  const isUploading = uploadState.status === 'uploading' || uploadState.status === 'processing';

  // Warn before closing tab during active upload
  useEffect(() => {
    if (!isUploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isUploading]);

  const cleanupTimers = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
  }, []);

  const dismiss = useCallback(() => {
    cleanupTimers();
    queueRef.current = [];
    isProcessingRef.current = false;
    batchTotalRef.current = 0;
    batchIndexRef.current = 0;
    setUploadState(initialState);
  }, [cleanupTimers]);

  const simulateProgress = useCallback((stage: 'uploading' | 'processing') => {
    if (progressRef.current) clearInterval(progressRef.current);
    const max = stage === 'uploading' ? 45 : 95;
    const step = stage === 'uploading' ? 5 : 2;
    const interval = stage === 'uploading' ? 200 : 500;
    progressRef.current = setInterval(() => {
      setUploadState(prev => {
        if (prev.progress >= max) {
          if (progressRef.current) clearInterval(progressRef.current);
          return prev;
        }
        return { ...prev, progress: prev.progress + step };
      });
    }, interval);
  }, []);

  const processNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      isProcessingRef.current = false;
      batchTotalRef.current = 0;
      batchIndexRef.current = 0;
      return;
    }

    isProcessingRef.current = true;
    const item = queueRef.current.shift()!;
    batchIndexRef.current += 1;

    setUploadState({
      status: 'uploading',
      progress: 0,
      videoId: null,
      queueCount: queueRef.current.length,
      currentIndex: batchIndexRef.current,
      totalInBatch: batchTotalRef.current,
    });
    simulateProgress('uploading');

    try {
      const fileExt = item.file.name.split(".").pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `${item.userId}/${fileName}`;

      const { error: uploadError } = await supabase.storage.from("videos").upload(filePath, item.file);
      if (uploadError) throw uploadError;

      setUploadState(prev => ({ ...prev, progress: 50 }));

      const { data: { publicUrl } } = supabase.storage.from("videos").getPublicUrl(filePath);

      const { data: insertData, error: insertError } = await supabase.from("videos").insert({
        user_id: item.userId,
        title: `Video ${Date.now()}`,
        description: item.description.trim() || null,
        video_url: publicUrl,
        tags: item.categories.length > 0 ? item.categories : null,
        processing_status: 'pending',
      }).select('id').single();

      if (insertError) throw insertError;

      setUploadState(prev => ({
        ...prev,
        status: 'processing',
        progress: 50,
        videoId: insertData.id,
      }));
      simulateProgress('processing');

      // Fire processing in background
      supabase.functions.invoke('process-video-cloudflare', {
        body: { videoUrl: publicUrl, videoId: insertData.id }
      }).catch(err => console.error('Video processing error:', err));

      // Poll for completion, then move to next
      await new Promise<void>((resolve) => {
        const startTime = Date.now();
        pollRef.current = setInterval(async () => {
          const { data } = await supabase
            .from('videos')
            .select('processing_status')
            .eq('id', insertData.id)
            .single();

          if (data?.processing_status === 'completed' || data?.processing_status === 'failed') {
            cleanupTimers();
            if (data.processing_status === 'completed') {
              toast.success(`Video ${batchIndexRef.current}/${batchTotalRef.current} uploaded!`);
            } else {
              toast.error(`Video ${batchIndexRef.current}/${batchTotalRef.current} processing failed.`);
            }
            resolve();
          } else if (Date.now() - startTime > 120000) {
            // Timeout — assume success and move on
            cleanupTimers();
            toast.success(`Video ${batchIndexRef.current}/${batchTotalRef.current} uploaded!`);
            resolve();
          }
        }, 2000);
      });

    } catch (error: any) {
      cleanupTimers();
      toast.error(error.message || `Upload ${batchIndexRef.current} failed`);
    }

    // Process next in queue or finish
    if (queueRef.current.length > 0) {
      processNext();
    } else {
      setUploadState({
        status: 'complete',
        progress: 100,
        videoId: null,
        queueCount: 0,
        currentIndex: batchIndexRef.current,
        totalInBatch: batchTotalRef.current,
      });
      setTimeout(() => {
        setUploadState(initialState);
        isProcessingRef.current = false;
        batchTotalRef.current = 0;
        batchIndexRef.current = 0;
      }, 3000);
    }
  }, [cleanupTimers, simulateProgress]);

  const startUpload = useCallback((file: File, description: string, categories: string[], userId: string) => {
    queueRef.current.push({ file, description, categories, userId });
    batchTotalRef.current += 1;

    // Update queue count in UI
    setUploadState(prev => ({
      ...prev,
      queueCount: queueRef.current.length,
      totalInBatch: batchTotalRef.current,
    }));

    // If nothing is currently processing, start
    if (!isProcessingRef.current) {
      processNext();
    } else {
      toast.success("Added to upload queue");
    }
  }, [processNext]);

  return (
    <UploadContext.Provider value={{ uploadState, startUpload, dismiss, isUploading }}>
      {children}
    </UploadContext.Provider>
  );
};
