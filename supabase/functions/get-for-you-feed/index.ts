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

serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  
  console.log(`[get-for-you-feed][${requestId}] Request received`);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, page = 0, limit = 10 } = await req.json();
    console.log(`[get-for-you-feed][${requestId}] Params - userId: ${userId || 'null'}, page: ${page}, limit: ${limit}`);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Get user's liked videos and viewed videos for personalization
    const { data: userLikes } = await supabaseClient
      .from("likes")
      .select("video_id, videos(user_id, tags)")
      .eq("user_id", userId);

    const { data: userViews } = await supabaseClient
      .from("video_views")
      .select("video_id")
      .eq("user_id", userId);

    // Extract user preferences
    const viewedVideoIds = new Set(userViews?.map((v) => v.video_id) || []);
    const likedUploaderIds = new Set(
      userLikes?.map((l: any) => l.videos?.user_id).filter(Boolean) || []
    );
    const likedTags = new Set(
      userLikes?.flatMap((l: any) => l.videos?.tags || []) || []
    );

    // Fetch recent videos (last 500 or last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentVideos, error } = await supabaseClient
      .from("videos")
      .select(
        `
        *,
        profiles!inner(username, avatar_url)
      `
      )
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    // Shuffle function for randomization
    const shuffleArray = <T,>(array: T[]): T[] => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    // Calculate scores for each video
    const scoredVideos = (recentVideos || []).map((video: Video) => {
      // Normalize metrics (0-1 scale)
      const maxLikes = Math.max(...(recentVideos?.map((v: any) => v.likes_count) || [1]));
      const maxViews = Math.max(...(recentVideos?.map((v: any) => v.views_count) || [1]));
      
      const normalizedLikes = video.likes_count / (1 + maxLikes);
      const normalizedViews = video.views_count / (1 + maxViews);

      // Recency score (exponential decay)
      const ageInDays = (Date.now() - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageInDays / 7); // Half-life of 7 days

      // User affinity score
      let affinityScore = 0;
      
      // Boost if from liked uploader
      if (likedUploaderIds.has(video.user_id)) {
        affinityScore += 0.5;
      }

      // Boost if tags overlap with liked videos
      if (video.tags) {
        const tagOverlap = video.tags.filter((tag) => likedTags.has(tag)).length;
        affinityScore += tagOverlap * 0.2;
      }

      // Penalize viewed videos heavily
      const viewedPenalty = viewedVideoIds.has(video.id) ? -1.0 : 0;

      // Calculate base score (without randomization)
      const baseScore =
        0.3 * normalizedLikes +
        0.1 * normalizedViews +
        0.2 * recencyScore +
        0.2 * affinityScore +
        viewedPenalty;

      return { ...video, baseScore };
    });

    // Separate viewed and unviewed videos
    const unviewedVideos = scoredVideos.filter(v => !viewedVideoIds.has(v.id));
    const viewedVideos = scoredVideos.filter(v => viewedVideoIds.has(v.id));

    // Sort unviewed by score, then shuffle within score tiers for variety
    const sortedUnviewed = unviewedVideos.sort((a, b) => b.baseScore - a.baseScore);
    
    // Group into tiers and shuffle within each tier for TikTok-like variety
    const tierSize = 5;
    const shuffledResult: typeof sortedUnviewed = [];
    for (let i = 0; i < sortedUnviewed.length; i += tierSize) {
      const tier = sortedUnviewed.slice(i, i + tierSize);
      shuffledResult.push(...shuffleArray(tier));
    }

    // Add shuffled viewed videos at the end as fallback
    const finalVideos = [...shuffledResult, ...shuffleArray(viewedVideos)];

    // Paginate and clean up
    const paginatedVideos = finalVideos
      .slice(page * limit, (page + 1) * limit)
      .map(({ baseScore, ...video }) => video);

    const elapsed = Date.now() - startTime;
    console.log(`[get-for-you-feed][${requestId}] Success - returned ${paginatedVideos.length} videos in ${elapsed}ms`);

    return new Response(
      JSON.stringify({ videos: paginatedVideos }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[get-for-you-feed][${requestId}] Error after ${elapsed}ms:`, error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
