import { useState, useEffect, useRef, memo, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Radio, Users, ChevronRight } from "lucide-react";

interface Ad {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  external_link: string;
}

interface LivestreamAdItemProps {
  ad: Ad;
  index: number;
  isActive: boolean;
  shouldPreload?: boolean;
  currentUserId: string | null;
}

export const LivestreamAdItem = memo(({ ad, index, isActive, currentUserId }: LivestreamAdItemProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewTrackedRef = useRef(false);
  const navOffset = 'calc(64px + env(safe-area-inset-bottom, 0px))';

  // Random viewer count - stable per ad per session
  const viewerCount = useMemo(() => {
    return Math.floor(3256 + Math.random() * (8965 - 3256));
  }, [ad.id]);

  // Random fluctuating viewer count
  const [displayViewers, setDisplayViewers] = useState(viewerCount);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setDisplayViewers(prev => {
        const delta = Math.floor(Math.random() * 40) - 20;
        return Math.max(3000, prev + delta);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [isActive]);

  // Play/pause
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (isActive) {
      videoEl.currentTime = 0;
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
  }, [isActive]);

  // Track ad view
  useEffect(() => {
    if (!isActive || viewTrackedRef.current) return;
    viewTrackedRef.current = true;

    const viewerId = localStorage.getItem('anonymous_viewer_id_v1') || 'unknown';
    const sessionId = localStorage.getItem('video_session_v2') || 'unknown';

    supabase.from("ad_views").insert({
      ad_id: ad.id,
      viewer_id: viewerId,
      session_id: sessionId,
      user_id: currentUserId || null,
    }).then(() => {});
  }, [isActive, ad.id, currentUserId]);

  const handleClick = () => {
    // Track click
    const viewerId = localStorage.getItem('anonymous_viewer_id_v1') || 'unknown';
    const sessionId = localStorage.getItem('video_session_v2') || 'unknown';

    supabase.from("ad_clicks").insert({
      ad_id: ad.id,
      viewer_id: viewerId,
      session_id: sessionId,
      user_id: currentUserId || null,
    }).then(() => {});

    // Open link in new tab
    window.open(ad.external_link, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="relative w-full h-[100dvh] flex-shrink-0 bg-black snap-start snap-always cursor-pointer"
      data-video-index={index}
      onClick={handleClick}
    >
      {/* Video */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain bg-black"
        style={{ paddingBottom: navOffset }}
        src={isActive ? ad.video_url : undefined}
        loop
        playsInline
        muted
        preload={isActive ? "auto" : "none"}
      />

      {/* Dark overlay for livestream feel */}
      <div 
        className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none"
        style={{ paddingBottom: navOffset }}
      />

      {/* Top bar - LIVE badge + viewer count */}
      <div className="absolute top-0 left-0 right-0 z-50 p-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {/* LIVE badge */}
          <div className="flex items-center gap-1.5 bg-red-600 px-3 py-1 rounded-md">
            <Radio className="h-3.5 w-3.5 text-white animate-pulse" />
            <span className="text-white text-sm font-bold tracking-wide">LIVE</span>
          </div>
        </div>

        {/* Viewer count */}
        <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
          <Users className="h-3.5 w-3.5 text-white" />
          <span className="text-white text-sm font-semibold">
            {displayViewers.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Animated dots at top (like TikTok live) */}
      <div className="absolute top-14 left-4 z-50 flex items-center gap-1">
        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" style={{ animationDelay: '0.3s' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" style={{ animationDelay: '0.6s' }} />
      </div>

      {/* Fake chat messages floating (like TikTok live comments) */}
      {isActive && <FloatingComments />}

      {/* Bottom CTA */}
      <div
        className="absolute left-0 right-0 p-4 z-40"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="space-y-3">
          {/* Title */}
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center border-2 border-white">
              <Radio className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-base">{ad.title}</p>
              <p className="text-white/70 text-xs">Sponsored · Live</p>
            </div>
          </div>

          {/* CTA Button */}
          <button
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <span>Watch Now</span>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
});

LivestreamAdItem.displayName = 'LivestreamAdItem';

// Floating fake comments for realism
const FAKE_COMMENTS = [
  "🔥🔥🔥", "This is amazing!", "❤️", "How do I get this?",
  "Wow!!", "Link please!", "🙌", "Need this",
  "So cool 😍", "Where can I buy?", "💯", "Insane!!",
  "Take my money 💰", "👏👏", "Is this real?", "Love it!",
];

const FAKE_USERNAMES = [
  "sarah_k", "mike_j", "emma.rose", "alex_99",
  "lily_m", "jake.t", "nina_p", "chris.b",
  "maya.d", "ben_w", "zoe_c", "tom.h",
];

const FloatingComments = () => {
  const [comments, setComments] = useState<{ id: number; text: string; user: string }[]>([]);

  useEffect(() => {
    let id = 0;
    const interval = setInterval(() => {
      const text = FAKE_COMMENTS[Math.floor(Math.random() * FAKE_COMMENTS.length)];
      const user = FAKE_USERNAMES[Math.floor(Math.random() * FAKE_USERNAMES.length)];
      id++;
      const newComment = { id, text, user };
      setComments(prev => [...prev.slice(-4), newComment]);
    }, 2000 + Math.random() * 1500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div 
      className="absolute left-4 z-30 flex flex-col-reverse gap-2 pointer-events-none max-w-[60%]"
      style={{ bottom: 'calc(200px + env(safe-area-inset-bottom, 0px))' }}
    >
      {comments.map((comment) => (
        <div
          key={comment.id}
          className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5 animate-slide-up"
        >
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-[10px] text-white font-bold flex-shrink-0">
            {comment.user[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <span className="text-white/70 text-[10px] font-medium">{comment.user}</span>
            <p className="text-white text-xs truncate">{comment.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
};
