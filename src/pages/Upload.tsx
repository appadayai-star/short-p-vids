import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useUpload } from "@/contexts/UploadContext";
import { toast } from "sonner";
import { ArrowLeft, Upload as UploadIcon } from "lucide-react";

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

const Upload = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { uploadState, startUpload } = useUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [hasTriggeredPicker, setHasTriggeredPicker] = useState(false);

  useEffect(() => {
    if (!user) navigate("/auth", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (!hasTriggeredPicker && fileInputRef.current) {
      setHasTriggeredPicker(true);
      setTimeout(() => fileInputRef.current?.click(), 100);
    }
  }, [hasTriggeredPicker]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
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
      if (tempVideo.duration > 90) {
        toast.error("Video must be 90 seconds or shorter");
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

  const handleSubmit = () => {
    if (!videoFile || !user) return;

    startUpload(videoFile, description, selectedCategories, user.id);
    toast.success("Upload started! You can keep browsing.");
    navigate(-1);
  };

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  if (!user) return null;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background z-10">
        <button onClick={() => navigate(-1)} className="p-1 text-foreground">
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">New post</h1>
        <div className="w-10" />
      </div>

      {videoPreview ? (
        <div className="flex-1 overflow-y-auto pb-24">
          <div className="flex gap-4 p-4">
            <div className="flex-1 min-w-0">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write a caption..."
                className="resize-none border-0 bg-transparent p-0 text-base placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[120px]"
                rows={5}
              />
            </div>
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

          <div className="p-4 space-y-3">
            <Label className="text-base font-semibold">Categories</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => {
                const isSelected = selectedCategories.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-foreground border-border hover:border-primary/50"
                    }`}
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
          <UploadIcon className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">Tap to select a video</p>
        </div>
      )}

      <div className="sticky bottom-0 p-4 bg-background border-t border-border" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
        <Button
          onClick={handleSubmit}
          disabled={!videoFile}
          className="w-full rounded-full gap-2 h-12 text-base"
        >
          Post
        </Button>
      </div>
    </div>
  );
};

export default Upload;
