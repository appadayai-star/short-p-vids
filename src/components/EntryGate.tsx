import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "shortpv_entered";

interface Video {
  id: string;
  video_url: string;
  optimized_video_url?: string | null;
}

interface EntryGateProps {
  children: React.ReactNode;
}

export const EntryGate = ({ children }: EntryGateProps) => {
  const [hasEntered, setHasEntered] = useState<boolean | null>(null);
  const [isWarmingUp, setIsWarmingUp] = useState(false);

  useEffect(() => {
    const entered = localStorage.getItem(STORAGE_KEY) === "true";
    setHasEntered(entered);
  }, []);

  const warmUpFirstVideo = (videos: Video[]) => {
    if (videos.length === 0) return;
    
    const firstVideo = videos[0];
    const videoUrl = firstVideo.optimized_video_url || firstVideo.video_url;
    
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = videoUrl;
    video.style.position = "absolute";
    video.style.left = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";
    
    document.body.appendChild(video);
    
    const cleanup = () => {
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
    };
    
    video.onloadedmetadata = cleanup;
    setTimeout(cleanup, 2000);
    
    video.load();
  };

  const warmUpFeed = async (): Promise<Video[]> => {
    try {
      // Try recommendation feed first
      const { data, error } = await supabase.functions.invoke('get-recommended-feed', {
        body: { userId: null, page: 0, limit: 10 }
      });

      if (!error && data?.videos?.length > 0) {
        return data.videos;
      }

      // Fallback to direct query
      const { data: fallbackData } = await supabase
        .from("videos")
        .select("id, video_url, optimized_video_url")
        .order("created_at", { ascending: false })
        .limit(10);

      return fallbackData || [];
    } catch {
      return [];
    }
  };

  const handleEnter = async () => {
    setIsWarmingUp(true);
    localStorage.setItem(STORAGE_KEY, "true");
    
    const videos = await warmUpFeed();
    warmUpFirstVideo(videos);
    
    setHasEntered(true);
  };

  const handleLeave = () => {
    window.location.href = "https://google.com";
  };

  // Still loading initial state
  if (hasEntered === null) {
    return null;
  }

  // Already entered, show content
  if (hasEntered) {
    return <>{children}</>;
  }

  // Show gate
  return (
    <>
      <Helmet>
        <link rel="preconnect" href="https://res.cloudinary.com" />
        <link rel="dns-prefetch" href="https://res.cloudinary.com" />
        <link rel="preconnect" href="https://mbuajcicosojebakdtsn.supabase.co" />
        <link rel="dns-prefetch" href="https://mbuajcicosojebakdtsn.supabase.co" />
      </Helmet>
      
      <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <h1 className="text-2xl font-bold text-foreground mb-4">
            Welcome
          </h1>
          
          <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
            By entering, you confirm that you agree to our terms of service and privacy policy.
          </p>
          
          <div className="flex flex-col gap-3">
            <button
              onClick={handleEnter}
              disabled={isWarmingUp}
              className="w-full py-3 px-6 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-70"
            >
              {isWarmingUp ? "Loading..." : "Enter"}
            </button>
            
            <button
              onClick={handleLeave}
              className="w-full py-3 px-6 bg-muted text-muted-foreground font-medium rounded-xl hover:bg-muted/80 transition-colors"
            >
              Leave
            </button>
          </div>
        </div>
      </div>
      
      {/* Render children hidden for SEO */}
      <div className="sr-only" aria-hidden="true">
        {children}
      </div>
    </>
  );
};
