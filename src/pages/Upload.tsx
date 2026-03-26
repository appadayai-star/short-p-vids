import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Check } from "lucide-react";

const CATEGORIES = [
  { id: "beauty", name: "Beauty" },
  { id: "real", name: "Real" },
  { id: "public", name: "Public" },
  { id: "homemade", name: "Homemade" },
  { id: "pov", name: "POV" },
  { id: "mom", name: "Mom" },
  { id: "milf", name: "MILF" },
  { id: "amateur", name: "Amateur" },
  { id: "latina", name: "Latina" },
  { id: "asian", name: "Asian" },
  { id: "big_ass", name: "Big Ass" },
  { id: "big_tits", name: "Big Tits" },
  { id: "lesbian", name: "Lesbian" },
  { id: "blonde", name: "Blonde" },
  { id: "brunettes", name: "Brunettes" },
  { id: "red_head", name: "Red Head" },
  { id: "small", name: "Small" },
  { id: "stepsis", name: "Stepsis" },
  { id: "anal", name: "Anal" },
  { id: "blowjob", name: "Blowjob" },
  { id: "teen", name: "Teen" },
  { id: "goth", name: "Goth" },
  { id: "cumshot", name: "Cumshot" },
  { id: "squirt", name: "Squirt" },
];

type UploadStage = 'idle' | 'uploading' | 'processing' | 'complete' | 'error';

const Upload = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [hasTriggeredPicker, setHasTriggeredPicker] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!user) {
      navigate("/auth", { replace: true });
    }
  }, [user, navigate]);

  // Auto-trigger file picker on mount
  useEffect(() => {
    if (!hasTriggeredPicker && fileInputRef.current) {
      setHasTriggeredPicker(true);
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 100);
    }
  }, [hasTriggeredPicker]);

  // Simulate upload progress
  useEffect(() => {
    if (uploadStage === 'uploading') {
      const interval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 45) { clearInterval(interval); return 45; }
          return prev + 5;
        });
      }, 200);
      return () => clearInterval(interval);
    } else if (uploadStage === 'processing') {
      const interval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 95) { clearInterval(interval); return 95; }
          return prev + 2;
        });
      }, 500);
      return () => clearInterval(interval);
    }
  }, [uploadStage]);

  // Poll for processing status
  useEffect(() => {
    if (!currentVideoId || uploadStage !== 'processing') return;

    const pollInterval = setInterval(async () => {
      const { data, error } = await supabase
        .from('videos')
        .select('processing_status, optimized_video_url')
        .eq('id', currentVideoId)
        .single();

      if (error) return;

      if (data?.processing_status === 'completed') {
        setUploadProgress(100);
        setUploadStage('complete');
        clearInterval(pollInterval);
        toast.success("Video uploaded successfully!");
        setTimeout(() => {
          navigate("/profile", { replace: true });
        }, 1500);
      } else if (data?.processing_status === 'failed') {
        setUploadStage('error');
        clearInterval(pollInterval);
        toast.error("Video processing failed. Your video was uploaded but may not be optimized.");
        setTimeout(() => {
          navigate("/profile", { replace: true });
        }, 2000);
      }
    }, 2000);

    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      if (uploadStage === 'processing') {
        setUploadProgress(100);
        setUploadStage('complete');
        toast.success("Video uploaded! Processing continues in background.");
        setTimeout(() => {
          navigate("/profile", { replace: true });
        }, 1500);
      }
    }, 120000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [currentVideoId, uploadStage, navigate]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      // User cancelled file picker - go back
      if (!videoFile) navigate(-1);
      return;
    }

    if (!file.type.startsWith("video/")) {
      toast.error("Please select a valid video file");
      return;
    }

    const tempVideo = document.createElement("video");
    tempVideo.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    tempVideo.src = objectUrl;

    tempVideo.onloadedmetadata = () => {
      if (tempVideo.duration < 10) {
        toast.error("Video must be at least 10 seconds long");
        URL.revokeObjectURL(objectUrl);
        if (!videoFile) navigate(-1);
        return;
      }
      setVideoFile(file);
      setVideoPreview(objectUrl);
    };

    tempVideo.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      toast.error("Could not read video file");
      if (!videoFile) navigate(-1);
    };
  };

  const handleSubmit = async () => {
    if (!videoFile || !user) return;

    setUploadStage('uploading');
    setUploadProgress(0);

    try {
      const fileExt = videoFile.name.split(".").pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const uploadPromise = supabase.storage.from("videos").upload(filePath, videoFile);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Upload timeout - please try again")), 120000)
      );

      const uploadResult = await Promise.race([uploadPromise, timeoutPromise]) as any;
      if (uploadResult.error) throw uploadResult.error;

      setUploadProgress(50);

      const { data: { publicUrl } } = supabase.storage.from("videos").getPublicUrl(filePath);

      const insertPromise = supabase.from("videos").insert({
        user_id: user.id,
        title: `Video ${Date.now()}`,
        description: description.trim() || null,
        video_url: publicUrl,
        tags: selectedCategories.length > 0 ? selectedCategories : null,
        processing_status: 'pending',
      }).select('id').single();

      const insertTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database timeout - please try again")), 30000)
      );

      const insertResult = await Promise.race([insertPromise, insertTimeout]) as any;
      if (insertResult.error) throw insertResult.error;

      setCurrentVideoId(insertResult.data.id);
      setUploadStage('processing');

      supabase.functions.invoke('process-video', {
        body: { videoUrl: publicUrl, videoId: insertResult.data.id }
      }).catch(err => console.error('Video processing error:', err));
    } catch (error: any) {
      setUploadStage('error');
      toast.error(error.message || "Failed to upload video");
      setTimeout(() => {
        setUploadStage('idle');
        setUploadProgress(0);
      }, 2000);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const isUploading = uploadStage === 'uploading' || uploadStage === 'processing';

  const getButtonContent = () => {
    switch (uploadStage) {
      case 'uploading':
        return <><Loader2 className="h-4 w-4 animate-spin" /><span>Uploading... {uploadProgress}%</span></>;
      case 'processing':
        return <><Loader2 className="h-4 w-4 animate-spin" /><span>Processing... {uploadProgress}%</span></>;
      case 'complete':
        return <><Check className="h-4 w-4" /><span>Complete!</span></>;
      case 'error':
        return <span>Error - Try Again</span>;
      default:
        return "Post";
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background z-10">
        <button
          onClick={() => !isUploading && navigate(-1)}
          disabled={isUploading}
          className="p-1 text-foreground disabled:opacity-50"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">New post</h1>
        <div className="w-10" /> {/* Spacer for centering */}
      </div>

      {/* Progress Bar */}
      {(uploadStage === 'uploading' || uploadStage === 'processing' || uploadStage === 'complete') && (
        <div className="px-4 pt-3">
          <Progress value={uploadProgress} className="h-1.5" />
          <p className="text-xs text-muted-foreground text-center mt-1">
            {uploadStage === 'uploading' && "Uploading your video..."}
            {uploadStage === 'processing' && "Optimizing for fast playback..."}
            {uploadStage === 'complete' && "Done!"}
          </p>
        </div>
      )}

      {/* Main content */}
      {videoPreview ? (
        <div className="flex-1 overflow-y-auto pb-24">
          {/* Caption + Preview row */}
          <div className="flex gap-4 p-4">
            <div className="flex-1 min-w-0">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write a caption..."
                className="resize-none border-0 bg-transparent p-0 text-base placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[120px]"
                rows={5}
                disabled={isUploading}
              />
            </div>
            {/* Video preview */}
            <div className="w-28 h-40 flex-shrink-0 rounded-lg overflow-hidden bg-muted relative">
              <video
                src={videoPreview}
                className="w-full h-full object-cover"
                muted
                playsInline
                autoPlay
                loop
              />
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Categories */}
          <div className="p-4 space-y-3">
            <Label className="text-base font-semibold">Categories</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => {
                const isSelected = selectedCategories.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => !isUploading && toggleCategory(category.id)}
                    disabled={isUploading}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-foreground border-border hover:border-primary/50"
                    } disabled:opacity-50`}
                  >
                    {category.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex-1 flex flex-col items-center justify-center p-8 cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">Tap to select a video</p>
        </div>
      )}

      {/* Bottom Post Button */}
      <div className="sticky bottom-0 p-4 bg-background border-t border-border" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
        <Button
          onClick={handleSubmit}
          disabled={isUploading || !videoFile || uploadStage === 'complete'}
          className="w-full rounded-full gap-2 h-12 text-base"
        >
          {getButtonContent()}
        </Button>
      </div>
    </div>
  );
};

export default Upload;
