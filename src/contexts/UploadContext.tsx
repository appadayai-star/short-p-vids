import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type UploadStatus = 'idle' | 'uploading' | 'processing' | 'complete' | 'error';

interface UploadState {
  status: UploadStatus;
  progress: number;
  videoId: string | null;
}

interface UploadContextType {
  uploadState: UploadState;
  startUpload: (file: File, description: string, categories: string[], userId: string) => void;
  dismiss: () => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

export const useUpload = () => {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used within UploadProvider");
  return ctx;
};

export const UploadProvider = ({ children }: { children: ReactNode }) => {
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
    videoId: null,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
  }, []);

  const dismiss = useCallback(() => {
    cleanup();
    setUploadState({ status: 'idle', progress: 0, videoId: null });
  }, [cleanup]);

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

  const pollProcessing = useCallback((videoId: string) => {
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('videos')
        .select('processing_status')
        .eq('id', videoId)
        .single();

      if (data?.processing_status === 'completed') {
        cleanup();
        setUploadState({ status: 'complete', progress: 100, videoId });
        toast.success("Video uploaded successfully!");
        setTimeout(() => setUploadState({ status: 'idle', progress: 0, videoId: null }), 3000);
      } else if (data?.processing_status === 'failed') {
        cleanup();
        setUploadState({ status: 'error', progress: 0, videoId });
        toast.error("Video processing failed.");
        setTimeout(() => setUploadState({ status: 'idle', progress: 0, videoId: null }), 3000);
      }
    }, 2000);

    // Timeout after 2 min — assume success
    timeoutRef.current = setTimeout(() => {
      cleanup();
      setUploadState({ status: 'complete', progress: 100, videoId });
      toast.success("Video uploaded! Processing continues in background.");
      setTimeout(() => setUploadState({ status: 'idle', progress: 0, videoId: null }), 3000);
    }, 120000);
  }, [cleanup]);

  const startUpload = useCallback(async (file: File, description: string, categories: string[], userId: string) => {
    cleanup();
    setUploadState({ status: 'uploading', progress: 0, videoId: null });
    simulateProgress('uploading');

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;

      const { error: uploadError } = await supabase.storage.from("videos").upload(filePath, file);
      if (uploadError) throw uploadError;

      setUploadState(prev => ({ ...prev, progress: 50 }));

      const { data: { publicUrl } } = supabase.storage.from("videos").getPublicUrl(filePath);

      const { data: insertData, error: insertError } = await supabase.from("videos").insert({
        user_id: userId,
        title: `Video ${Date.now()}`,
        description: description.trim() || null,
        video_url: publicUrl,
        tags: categories.length > 0 ? categories : null,
        processing_status: 'pending',
      }).select('id').single();

      if (insertError) throw insertError;

      setUploadState({ status: 'processing', progress: 50, videoId: insertData.id });
      simulateProgress('processing');
      pollProcessing(insertData.id);

      supabase.functions.invoke('process-video-cloudflare', {
        body: { videoUrl: publicUrl, videoId: insertData.id }
      }).catch(err => console.error('Video processing error:', err));

    } catch (error: any) {
      cleanup();
      setUploadState({ status: 'error', progress: 0, videoId: null });
      toast.error(error.message || "Failed to upload video");
      setTimeout(() => setUploadState({ status: 'idle', progress: 0, videoId: null }), 3000);
    }
  }, [cleanup, simulateProgress, pollProcessing]);

  return (
    <UploadContext.Provider value={{ uploadState, startUpload, dismiss }}>
      {children}
    </UploadContext.Provider>
  );
};
