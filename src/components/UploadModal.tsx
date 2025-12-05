import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Upload, X, Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";

const CATEGORIES = [
  { id: "beauty", name: "Beauty" },
  { id: "real", name: "Real" },
  { id: "public", name: "Public" },
  { id: "homemade", name: "Homemade" },
  { id: "pov", name: "POV" },
  { id: "mom", name: "Mom" },
];

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

type UploadStage = 'idle' | 'uploading' | 'processing' | 'complete' | 'error';

export const UploadModal = ({ open, onOpenChange, userId }: UploadModalProps) => {
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);

  // Simulate upload progress
  useEffect(() => {
    if (uploadStage === 'uploading') {
      const interval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 45) {
            clearInterval(interval);
            return 45;
          }
          return prev + 5;
        });
      }, 200);
      return () => clearInterval(interval);
    } else if (uploadStage === 'processing') {
      const interval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 95) {
            clearInterval(interval);
            return 95;
          }
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

      if (error) {
        console.error('Poll error:', error);
        return;
      }

      if (data?.processing_status === 'completed') {
        setUploadProgress(100);
        setUploadStage('complete');
        clearInterval(pollInterval);
        
        toast.success("Video uploaded successfully!");
        
        // Close modal after short delay
        setTimeout(() => {
          resetAndClose();
          window.location.reload();
        }, 1500);
      } else if (data?.processing_status === 'failed') {
        setUploadStage('error');
        clearInterval(pollInterval);
        toast.error("Video processing failed. Your video was uploaded but may not be optimized.");
        
        setTimeout(() => {
          resetAndClose();
          window.location.reload();
        }, 2000);
      }
    }, 2000);

    // Timeout after 2 minutes
    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      if (uploadStage === 'processing') {
        setUploadProgress(100);
        setUploadStage('complete');
        toast.success("Video uploaded! Processing continues in background.");
        setTimeout(() => {
          resetAndClose();
          window.location.reload();
        }, 1500);
      }
    }, 120000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [currentVideoId, uploadStage]);

  const resetAndClose = () => {
    setUploadStage('idle');
    setUploadProgress(0);
    setCurrentVideoId(null);
    handleRemoveVideo();
    setDescription("");
    setSelectedCategories([]);
    onOpenChange(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type.startsWith("video/")) {
        setVideoFile(file);
        const previewUrl = URL.createObjectURL(file);
        setVideoPreview(previewUrl);
      } else {
        toast.error("Please select a valid video file");
      }
    }
  };

  const handleRemoveVideo = () => {
    setVideoFile(null);
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
      setVideoPreview(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!videoFile) {
      toast.error("Please select a video file");
      return;
    }

    setUploadStage('uploading');
    setUploadProgress(0);

    try {
      // Upload video file to storage
      const fileExt = videoFile.name.split(".").pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("videos")
        .upload(filePath, videoFile);

      if (uploadError) throw uploadError;

      setUploadProgress(50);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("videos")
        .getPublicUrl(filePath);

      // Create video record
      const { data: videoData, error: dbError } = await supabase.from("videos").insert({
        user_id: userId,
        title: `Video ${Date.now()}`,
        description: description.trim() || null,
        video_url: publicUrl,
        tags: selectedCategories.length > 0 ? selectedCategories : null,
        processing_status: 'pending',
      }).select('id').single();

      if (dbError) throw dbError;

      setCurrentVideoId(videoData.id);
      setUploadStage('processing');

      // Trigger video processing
      const { error: processError } = await supabase.functions.invoke('process-video', {
        body: { videoUrl: publicUrl, videoId: videoData.id }
      });

      if (processError) {
        console.error('Video processing error:', processError);
        // Processing failed but video is uploaded - complete anyway
        setUploadProgress(100);
        setUploadStage('complete');
        toast.success("Video uploaded! (Processing skipped)");
        setTimeout(() => {
          resetAndClose();
          window.location.reload();
        }, 1500);
      }
    } catch (error: any) {
      setUploadStage('error');
      toast.error(error.message || "Failed to upload video");
      console.error("Upload error:", error);
      
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

  const getButtonContent = () => {
    switch (uploadStage) {
      case 'uploading':
        return (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Uploading... {uploadProgress}%</span>
          </div>
        );
      case 'processing':
        return (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Processing... {uploadProgress}%</span>
          </div>
        );
      case 'complete':
        return (
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" />
            <span>Complete!</span>
          </div>
        );
      case 'error':
        return <span>Error - Try Again</span>;
      default:
        return "Upload Video";
    }
  };

  const isUploading = uploadStage === 'uploading' || uploadStage === 'processing';

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!isUploading) {
        onOpenChange(newOpen);
      }
    }}>
      <DialogContent className="sm:max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>Upload Video</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Progress Bar */}
          {(uploadStage === 'uploading' || uploadStage === 'processing' || uploadStage === 'complete') && (
            <div className="space-y-2">
              <Progress value={uploadProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                {uploadStage === 'uploading' && "Uploading your video..."}
                {uploadStage === 'processing' && "Optimizing for fast playback..."}
                {uploadStage === 'complete' && "Done!"}
              </p>
            </div>
          )}

          {/* Video Preview or Upload Area */}
          {videoPreview ? (
            <div className="space-y-3">
              <div className="relative w-32 h-48 mx-auto cursor-pointer" onClick={() => !isUploading && setShowFullPreview(true)}>
                <video
                  src={videoPreview}
                  className="w-full h-full object-cover rounded-lg border-2 border-border"
                />
                <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                  <span className="text-white font-semibold text-sm">Preview</span>
                </div>
                {!isUploading && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveVideo();
                    }}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1.5 hover:bg-destructive/90 transition-colors z-10"
                    aria-label="Remove video"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="video-file">Video File *</Label>
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer">
                <input
                  id="video-file"
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={isUploading}
                />
                <label htmlFor="video-file" className="cursor-pointer">
                  <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Click to upload video
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    MP4, MOV, AVI (max 100MB)
                  </p>
                </label>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              className="resize-none rounded-xl"
              rows={3}
              disabled={isUploading}
            />
          </div>

          {/* Categories */}
          <div className="space-y-3">
            <Label>Categories</Label>
            <div className="grid grid-cols-2 gap-3">
              {CATEGORIES.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center space-x-2"
                >
                  <Checkbox
                    id={`category-${category.id}`}
                    checked={selectedCategories.includes(category.id)}
                    onCheckedChange={() => toggleCategory(category.id)}
                    disabled={isUploading}
                  />
                  <label
                    htmlFor={`category-${category.id}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {category.name}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Upload Button */}
          <Button
            type="submit"
            className="w-full"
            disabled={isUploading || !videoFile || uploadStage === 'complete'}
          >
            {getButtonContent()}
          </Button>
        </form>
      </DialogContent>

      {/* Full Screen Preview Modal */}
      {showFullPreview && videoPreview && (
        <div 
          className="fixed inset-0 z-[200] bg-black flex items-center justify-center"
          onClick={() => setShowFullPreview(false)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowFullPreview(false);
            }}
            className="absolute top-4 right-4 bg-white/10 text-white rounded-full p-2 hover:bg-white/20 transition-colors z-10"
            aria-label="Close preview"
          >
            <X className="h-6 w-6" />
          </button>
          <video
            src={videoPreview}
            className="w-full h-full object-contain"
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Dialog>
  );
};
