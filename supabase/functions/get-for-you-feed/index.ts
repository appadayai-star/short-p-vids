import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Video {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url: string | null;
  stream_url: string | null;
  cloudinary_public_id: string | null;
  thumbnail_url: string | null;
  processing_status: string | null;
  views_count: number;
  likes_count: number;
  tags: string[] | null;
  created_at: string;
  user_id: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

interface VideoMetrics {
  video_id: string;
  avg_completion: number;
  avg_watch_duration: number;
  view_count: number;
  share_count: number;
}

interface ScoreBreakdown {
  videoId: string;
  title: string;
  finalScore: number;
  components: {
    likesScore: number;
    viewsScore: number;
    recencyScore: number;
    completionScore: number;
    watchTimeScore: number;
    sharesScore: number;
    affinityScore: number;
    explorationFactor: number;
    qualityBonus: number;
    viewedPenalty: number;
  };
}

// Deterministic seeded RNG using simple hash
function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Mulberry32 PRNG
  return function() {
    hash |= 0;
    hash = hash + 0x6D2B79F5 | 0;
    let t = Math.imul(hash ^ hash >>> 15, 1 | hash);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Get today's date string for seed stability
function getTodayDateString(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

// Apply creator diversity filter (no same creator within last N items)
function applyCreatorDiversity(videos: any[], maxGap = 4): any[] {
  if (videos.length <= maxGap) return videos;
  
  const result: any[] = [];
  const remaining = [...videos];
  const recentCreators: string[] = [];
  
  while (remaining.length > 0 && result.length < videos.length) {
    const nextIdx = remaining.findIndex(v => !recentCreators.slice(-maxGap).includes(v.user_id));
    
    if (nextIdx === -1) {
      const video = remaining.shift()!;
      result.push(video);
      recentCreators.push(video.user_id);
    } else {
      const video = remaining.splice(nextIdx, 1)[0];
      result.push(video);
      recentCreators.push(video.user_id);
    }
  }
  
  return result;
}

// Shuffle array using seeded RNG
function shuffleArraySeeded<T>(array: T[], rng: () => number): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const algoDebug = url.searchParams.get('algoDebug') === '1';
    
    const { 
      userId, 
      viewerId,      // Anonymous persistent ID from client
      sessionId,     // Session ID from client
      cursor,        // Cursor for pagination: { score: number, id: string } or null
      limit = 10, 
      sessionViewedIds = [] 
    } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""  // Use service role for aggregation queries
    );

    // Determine viewer identity for seeding and seen tracking
    const viewerIdentity = userId || viewerId || sessionId || 'anonymous';
    const dateStr = getTodayDateString();
    const seed = `${viewerIdentity}-${dateStr}`;
    const rng = seededRandom(seed);
    
    console.log(`[get-for-you-feed] Viewer: ${viewerIdentity.substring(0, 8)}..., Seed date: ${dateStr}`);

    // Hard session dedup: create set of IDs to exclude
    const sessionExcludeSet = new Set<string>(sessionViewedIds || []);
    console.log(`[get-for-you-feed] Session excluded: ${sessionExcludeSet.size} videos`);

    // Fetch recent videos (last 30 days, up to 500)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentVideos, error } = await supabaseClient
      .from("videos")
      .select(`
        id, title, description, video_url, optimized_video_url, stream_url,
        cloudinary_public_id, thumbnail_url, processing_status,
        views_count, likes_count, tags, created_at, user_id,
        profiles!inner(username, avatar_url)
      `)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    console.log(`[get-for-you-feed] Fetched ${recentVideos?.length || 0} recent videos`);

    // HARD FILTER: Remove session-excluded videos BEFORE any scoring
    const eligibleVideos = (recentVideos || []).filter(
      (v: any) => !sessionExcludeSet.has(v.id)
    );
    console.log(`[get-for-you-feed] After session dedup: ${eligibleVideos.length} videos`);

    // Fetch 7-day video metrics (watch completion, duration, shares)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get video IDs for metrics query
    const videoIds = eligibleVideos.map((v: any) => v.id);

    // Aggregate watch metrics per video (7-day window)
    const { data: watchMetrics } = await supabaseClient
      .from("video_views")
      .select("video_id, watch_completion_percent, watch_duration_seconds")
      .in("video_id", videoIds)
      .gte("viewed_at", sevenDaysAgo.toISOString())
      .not("watch_completion_percent", "is", null);

    // Aggregate shares per video (7-day window)
    const { data: shareData } = await supabaseClient
      .from("shares")
      .select("video_id")
      .in("video_id", videoIds)
      .gte("created_at", sevenDaysAgo.toISOString());

    // Build metrics map
    const metricsMap = new Map<string, VideoMetrics>();
    
    // Process watch metrics
    const watchByVideo = new Map<string, { completions: number[], durations: number[] }>();
    for (const row of (watchMetrics || [])) {
      if (!watchByVideo.has(row.video_id)) {
        watchByVideo.set(row.video_id, { completions: [], durations: [] });
      }
      const entry = watchByVideo.get(row.video_id)!;
      if (row.watch_completion_percent != null && row.watch_completion_percent > 0) {
        entry.completions.push(row.watch_completion_percent);
      }
      if (row.watch_duration_seconds != null && row.watch_duration_seconds > 0) {
        entry.durations.push(row.watch_duration_seconds);
      }
    }

    // Process shares
    const sharesByVideo = new Map<string, number>();
    for (const row of (shareData || [])) {
      sharesByVideo.set(row.video_id, (sharesByVideo.get(row.video_id) || 0) + 1);
    }

    // Build final metrics map
    for (const videoId of videoIds) {
      const watchData = watchByVideo.get(videoId);
      const avgCompletion = watchData && watchData.completions.length > 0
        ? watchData.completions.reduce((a, b) => a + b, 0) / watchData.completions.length
        : -1; // -1 = no data (neutral)
      const avgDuration = watchData && watchData.durations.length > 0
        ? watchData.durations.reduce((a, b) => a + b, 0) / watchData.durations.length
        : -1; // -1 = no data (neutral)
      
      metricsMap.set(videoId, {
        video_id: videoId,
        avg_completion: avgCompletion,
        avg_watch_duration: avgDuration,
        view_count: watchData ? watchData.completions.length + watchData.durations.length : 0,
        share_count: sharesByVideo.get(videoId) || 0
      });
    }

    // Get view history for "seen in last 7 days" penalty
    let viewedVideoIds = new Set<string>();
    
    if (userId) {
      // Logged-in user: check by user_id
      const { data: recentViews } = await supabaseClient
        .from("video_views")
        .select("video_id")
        .eq("user_id", userId)
        .gte("viewed_at", sevenDaysAgo.toISOString());
      
      viewedVideoIds = new Set(recentViews?.map(v => v.video_id) || []);
      console.log(`[get-for-you-feed] User ${userId.substring(0, 8)}... has ${viewedVideoIds.size} viewed videos in last 7 days`);
    } else if (viewerId) {
      // Guest: check by viewer_id
      const { data: recentViews } = await supabaseClient
        .from("video_views")
        .select("video_id")
        .eq("viewer_id", viewerId)
        .gte("viewed_at", sevenDaysAgo.toISOString());
      
      viewedVideoIds = new Set(recentViews?.map(v => v.video_id) || []);
      console.log(`[get-for-you-feed] Guest ${viewerId.substring(0, 8)}... has ${viewedVideoIds.size} viewed videos in last 7 days`);
    }

    // Compute global max values for normalization
    const maxLikes = Math.max(...eligibleVideos.map((v: any) => v.likes_count), 1);
    const maxViews = Math.max(...eligibleVideos.map((v: any) => v.views_count), 1);
    const maxShares = Math.max(...Array.from(metricsMap.values()).map(m => m.share_count), 1);

    // Score function (same for guest and logged-in, with affinity added for logged-in)
    const scoreVideo = (video: any, affinityScore: number = 0): { score: number; breakdown: ScoreBreakdown["components"] } => {
      const metrics = metricsMap.get(video.id);
      
      // Base engagement signals
      const normalizedLikes = video.likes_count / maxLikes;
      const normalizedViews = video.views_count / maxViews;
      
      // Recency score (exponential decay with 7-day half-life)
      const ageInDays = (Date.now() - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageInDays / 7);

      // Watch-based quality signals (treat missing data as neutral 0.5)
      let completionScore = 0.5; // neutral
      if (metrics && metrics.avg_completion >= 0) {
        completionScore = Math.min(metrics.avg_completion / 100, 1); // 0-1
      }

      let watchTimeScore = 0.5; // neutral
      if (metrics && metrics.avg_watch_duration >= 0) {
        watchTimeScore = Math.min(metrics.avg_watch_duration / 20, 1); // cap at 20s
      }

      // Shares per view (higher weight than likes)
      let sharesScore = 0;
      if (metrics && metrics.view_count > 0) {
        const sharesPerView = metrics.share_count / metrics.view_count;
        sharesScore = Math.min(sharesPerView * 10, 1); // scale up, cap at 1
      } else if (metrics && metrics.share_count > 0) {
        sharesScore = metrics.share_count / maxShares;
      }

      // Deterministic exploration factor (seeded RNG per video)
      const videoRng = seededRandom(`${seed}-${video.id}`);
      const explorationFactor = videoRng() * 0.20; // 0-20%

      // Quality bonus for processed videos
      const qualityBonus = video.cloudinary_public_id ? 0.05 : 0;

      // Viewed penalty (seen in last 7 days)
      const viewedPenalty = viewedVideoIds.has(video.id) ? -1.5 : 0;

      // Final score formula:
      // - 15% likes
      // - 5% views  
      // - 15% recency
      // - 20% completion (watch quality)
      // - 15% watch time
      // - 10% shares (high-value engagement)
      // - 10% affinity (logged-in only)
      // - 5% quality bonus + exploration
      // - viewed penalty
      const likesScore = 0.15 * normalizedLikes;
      const viewsScoreWeighted = 0.05 * normalizedViews;
      const recencyScoreWeighted = 0.15 * recencyScore;
      const completionScoreWeighted = 0.20 * completionScore;
      const watchTimeScoreWeighted = 0.15 * watchTimeScore;
      const sharesScoreWeighted = 0.10 * sharesScore;
      const affinityScoreWeighted = 0.10 * Math.min(affinityScore, 1);

      const score = 
        likesScore +
        viewsScoreWeighted +
        recencyScoreWeighted +
        completionScoreWeighted +
        watchTimeScoreWeighted +
        sharesScoreWeighted +
        affinityScoreWeighted +
        explorationFactor +
        qualityBonus +
        viewedPenalty;

      return {
        score,
        breakdown: {
          likesScore,
          viewsScore: viewsScoreWeighted,
          recencyScore: recencyScoreWeighted,
          completionScore: completionScoreWeighted,
          watchTimeScore: watchTimeScoreWeighted,
          sharesScore: sharesScoreWeighted,
          affinityScore: affinityScoreWeighted,
          explorationFactor,
          qualityBonus,
          viewedPenalty
        }
      };
    };

    let scoredVideos: any[];
    
    if (!userId) {
      // Guest: score without affinity
      scoredVideos = eligibleVideos.map((video: any) => {
        const { score, breakdown } = scoreVideo(video, 0);
        return { ...video, score, breakdown, isViewed: viewedVideoIds.has(video.id) };
      });
    } else {
      // Logged-in: add affinity scoring
      const { data: userLikes } = await supabaseClient
        .from("likes")
        .select("video_id, videos(user_id, tags)")
        .eq("user_id", userId);

      const { data: categoryPrefs } = await supabaseClient
        .from("user_category_preferences")
        .select("category, interaction_score")
        .eq("user_id", userId)
        .order("interaction_score", { ascending: false })
        .limit(10);

      // Extract preferences
      const likedUploaderIds = new Set(
        userLikes?.map((l: any) => l.videos?.user_id).filter(Boolean) || []
      );
      const likedTags = new Set(
        userLikes?.flatMap((l: any) => l.videos?.tags || []) || []
      );
      const preferredCategories = new Map(
        categoryPrefs?.map(p => [p.category.toLowerCase(), p.interaction_score]) || []
      );

      scoredVideos = eligibleVideos.map((video: any) => {
        // Calculate affinity
        let affinity = 0;
        
        if (likedUploaderIds.has(video.user_id)) {
          affinity += 0.5;
        }

        if (video.tags) {
          for (const tag of video.tags) {
            const catScore = preferredCategories.get(tag.toLowerCase());
            if (catScore) {
              affinity += Math.min(catScore / 100, 0.25);
            }
            if (likedTags.has(tag)) {
              affinity += 0.1;
            }
          }
        }

        const { score, breakdown } = scoreVideo(video, affinity);
        return { ...video, score, breakdown, isViewed: viewedVideoIds.has(video.id) };
      });
    }

    // Separate unviewed and viewed (viewed go to end)
    const unviewedVideos = scoredVideos.filter(v => !v.isViewed);
    const viewedVideos = scoredVideos.filter(v => v.isViewed);

    console.log(`[get-for-you-feed] Unviewed: ${unviewedVideos.length}, Viewed (penalized): ${viewedVideos.length}`);

    // Sort by score descending
    const sortedUnviewed = unviewedVideos.sort((a, b) => b.score - a.score);
    const sortedViewed = viewedVideos.sort((a, b) => b.score - a.score);

    // Shuffle within tiers (5 videos per tier) using seeded RNG
    const tierSize = 5;
    const shuffledUnviewed: typeof sortedUnviewed = [];
    for (let i = 0; i < sortedUnviewed.length; i += tierSize) {
      const tier = sortedUnviewed.slice(i, i + tierSize);
      shuffledUnviewed.push(...shuffleArraySeeded(tier, rng));
    }

    // Apply creator diversity
    let finalResult = applyCreatorDiversity(shuffledUnviewed, 4);

    // Add viewed videos at end (also with diversity)
    const shuffledViewed = shuffleArraySeeded(sortedViewed, rng);
    const diverseViewed = applyCreatorDiversity(shuffledViewed, 4);
    finalResult = [...finalResult, ...diverseViewed];

    // Cursor-based pagination
    // Cursor format: { score: number, id: string }
    let startIndex = 0;
    if (cursor && cursor.id) {
      // Find the position after the cursor
      const cursorIndex = finalResult.findIndex(v => v.id === cursor.id);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const paginatedVideos = finalResult.slice(startIndex, startIndex + limit);
    
    // Generate next cursor
    const lastVideo = paginatedVideos[paginatedVideos.length - 1];
    const nextCursor = lastVideo ? { score: lastVideo.score, id: lastVideo.id } : null;
    const hasMore = startIndex + limit < finalResult.length;

    // Clean up response (remove internal fields)
    const responseVideos = paginatedVideos.map(({ score, breakdown, isViewed, ...video }) => video);

    // Debug mode: include score breakdown for top 10
    let debugInfo = null;
    if (algoDebug) {
      debugInfo = finalResult.slice(0, 10).map(v => ({
        videoId: v.id,
        title: v.title?.substring(0, 50),
        finalScore: Math.round(v.score * 1000) / 1000,
        components: Object.fromEntries(
          Object.entries(v.breakdown).map(([k, val]) => [k, Math.round((val as number) * 1000) / 1000])
        ),
        isViewed: v.isViewed
      }));
    }

    // Cache headers
    const isAnonymous = !userId;
    const cacheControl = isAnonymous
      ? "public, max-age=15, stale-while-revalidate=60"
      : "private, max-age=0";

    return new Response(
      JSON.stringify({ 
        videos: responseVideos, 
        nextCursor, 
        hasMore,
        ...(debugInfo ? { debug: debugInfo } : {})
      }),
      { 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json",
          "Cache-Control": cacheControl
        } 
      }
    );
  } catch (error) {
    console.error("[get-for-you-feed] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
