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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, deviceId, page = 0, limit = 10 } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

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

    // Shuffle function
    const shuffleArray = <T,>(array: T[]): T[] => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    // Get view history for deduplication (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    let viewedVideoIds = new Set<string>();
    
    if (userId) {
      const { data: recentViews } = await supabaseClient
        .from("video_views")
        .select("video_id")
        .eq("user_id", userId)
        .gte("viewed_at", sevenDaysAgo.toISOString());
      
      viewedVideoIds = new Set(recentViews?.map(v => v.video_id) || []);
      console.log(`[get-for-you-feed] User ${userId} has ${viewedVideoIds.size} viewed videos in last 7 days`);
    }

    // For guests, use deviceId if available (stored on client)
    // Note: deviceId-based tracking would need separate implementation

    // For guests (no userId), return engagement-ranked + random mix
    if (!userId) {
      const scoredVideos = (recentVideos || []).map((video: any) => {
        const maxLikes = Math.max(...(recentVideos?.map((v: any) => v.likes_count) || [1]));
        const maxViews = Math.max(...(recentVideos?.map((v: any) => v.views_count) || [1]));
        
        const normalizedLikes = video.likes_count / (1 + maxLikes);
        const normalizedViews = video.views_count / (1 + maxViews);
        
        const ageInDays = (Date.now() - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-ageInDays / 7);
        
        // Randomization component (20-30%)
        const randomFactor = Math.random() * 0.25;
        
        // Prioritize videos with cloudinary_public_id (faster loading)
        const qualityBonus = video.cloudinary_public_id ? 0.1 : 0;
        
        const score = 0.25 * normalizedLikes + 0.15 * normalizedViews + 0.25 * recencyScore + randomFactor + qualityBonus;
        
        return { ...video, score };
      });

      // Sort by score and shuffle within tiers
      const sortedVideos = scoredVideos.sort((a, b) => b.score - a.score);
      const tierSize = 5;
      const shuffledResult: typeof sortedVideos = [];
      
      for (let i = 0; i < sortedVideos.length; i += tierSize) {
        const tier = sortedVideos.slice(i, i + tierSize);
        shuffledResult.push(...shuffleArray(tier));
      }

      // Apply creator diversity (no same creator within 3 items)
      const diverseResult: typeof shuffledResult = [];
      const recentCreators: string[] = [];
      
      for (const video of shuffledResult) {
        if (recentCreators.slice(-3).includes(video.user_id)) continue;
        diverseResult.push(video);
        recentCreators.push(video.user_id);
      }

      const paginatedVideos = diverseResult
        .slice(page * limit, (page + 1) * limit)
        .map(({ score, ...video }) => video);

      return new Response(
        JSON.stringify({ videos: paginatedVideos }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For logged-in users, use personalized algorithm
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
      categoryPrefs?.map(p => [p.category, p.interaction_score]) || []
    );

    // Calculate scores for each video
    const scoredVideos = (recentVideos || []).map((video: any) => {
      const maxLikes = Math.max(...(recentVideos?.map((v: any) => v.likes_count) || [1]));
      const maxViews = Math.max(...(recentVideos?.map((v: any) => v.views_count) || [1]));
      
      const normalizedLikes = video.likes_count / (1 + maxLikes);
      const normalizedViews = video.views_count / (1 + maxViews);

      // Recency score (exponential decay with 7-day half-life)
      const ageInDays = (Date.now() - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageInDays / 7);

      // User affinity score
      let affinityScore = 0;
      
      // Boost from liked uploader
      if (likedUploaderIds.has(video.user_id)) {
        affinityScore += 0.4;
      }

      // Boost from preferred categories
      if (video.tags) {
        for (const tag of video.tags) {
          const catScore = preferredCategories.get(tag.toLowerCase());
          if (catScore) {
            affinityScore += Math.min(catScore / 100, 0.3);
          }
          if (likedTags.has(tag)) {
            affinityScore += 0.15;
          }
        }
      }

      // Heavy penalty for already viewed (in last 7 days)
      const viewedPenalty = viewedVideoIds.has(video.id) ? -2.0 : 0;

      // Quality bonus for processed videos
      const qualityBonus = video.cloudinary_public_id ? 0.1 : 0;

      // Exploration factor (20-30% random)
      const explorationFactor = Math.random() * 0.25;

      const baseScore =
        0.25 * normalizedLikes +
        0.1 * normalizedViews +
        0.2 * recencyScore +
        0.15 * Math.min(affinityScore, 0.6) +
        explorationFactor +
        qualityBonus +
        viewedPenalty;

      return { ...video, baseScore, isViewed: viewedVideoIds.has(video.id) };
    });

    // Separate unviewed and viewed
    const unviewedVideos = scoredVideos.filter(v => !v.isViewed);
    const viewedVideos = scoredVideos.filter(v => v.isViewed);

    console.log(`[get-for-you-feed] Unviewed: ${unviewedVideos.length}, Viewed: ${viewedVideos.length}`);

    // Sort unviewed by score, then shuffle within tiers
    const sortedUnviewed = unviewedVideos.sort((a, b) => b.baseScore - a.baseScore);
    
    const tierSize = 5;
    const shuffledResult: typeof sortedUnviewed = [];
    for (let i = 0; i < sortedUnviewed.length; i += tierSize) {
      const tier = sortedUnviewed.slice(i, i + tierSize);
      shuffledResult.push(...shuffleArray(tier));
    }

    // Apply creator diversity (no same creator within 3-5 items)
    const diverseResult: typeof shuffledResult = [];
    const recentCreators: string[] = [];
    
    for (const video of shuffledResult) {
      if (recentCreators.slice(-4).includes(video.user_id)) continue;
      diverseResult.push(video);
      recentCreators.push(video.user_id);
    }

    // Add viewed videos at the end as fallback (also with diversity)
    const shuffledViewed = shuffleArray(viewedVideos);
    for (const video of shuffledViewed) {
      if (recentCreators.slice(-4).includes(video.user_id)) continue;
      diverseResult.push(video);
      recentCreators.push(video.user_id);
    }

    // Paginate and clean up
    const paginatedVideos = diverseResult
      .slice(page * limit, (page + 1) * limit)
      .map(({ baseScore, isViewed, ...video }) => video);

    return new Response(
      JSON.stringify({ videos: paginatedVideos }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[get-for-you-feed] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});