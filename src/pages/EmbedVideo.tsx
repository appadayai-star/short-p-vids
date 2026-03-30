import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getVideoSource, getCloudflareStreamUrl, supportsHlsNatively } from "@/lib/cloudinary";
import Hls from "hls.js";

interface EmbedVideoData {
  id: string;
  title: string;
  video_url: string;
  cloudflare_video_id: string | null;
}

const EmbedVideo = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const [video, setVideo] = useState<EmbedVideoData | null>(null);
  const [error, setError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    if (!videoId) return;
    supabase
      .from("videos")
      .select("id, title, video_url, cloudflare_video_id")
      .eq("id", videoId)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError(true);
          return;
        }
        setVideo(data);
      });
  }, [videoId]);

  useEffect(() => {
    if (!video || !videoRef.current) return;
    const el = videoRef.current;

    if (video.cloudflare_video_id) {
      const hlsUrl = getCloudflareStreamUrl(video.cloudflare_video_id);

      if (supportsHlsNatively()) {
        el.src = hlsUrl;
      } else if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 30 });
        hls.loadSource(hlsUrl);
        hls.attachMedia(el);
        hlsRef.current = hls;
      } else {
        // Fallback to MP4 download URL
        el.src = getVideoSource(video.cloudflare_video_id, video.video_url);
      }
    } else {
      el.src = video.video_url;
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [video]);

  if (error) {
    return (
      <div style={{ background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", width: "100vw", height: "100vh", fontFamily: "sans-serif" }}>
        Video not found
      </div>
    );
  }

  if (!video) {
    return (
      <div style={{ background: "#000", color: "#888", display: "flex", alignItems: "center", justifyContent: "center", width: "100vw", height: "100vh", fontFamily: "sans-serif" }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ background: "#000", width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <video
        ref={videoRef}
        controls
        autoPlay
        playsInline
        loop
        muted
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        title={video.title}
      />
    </div>
  );
};

export default EmbedVideo;
