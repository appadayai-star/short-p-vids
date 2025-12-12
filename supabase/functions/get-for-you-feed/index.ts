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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, page = 0, limit = 10 } = await req.json();

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

      // Penalize if already viewed
      if (viewedVideoIds.has(video.id)) {
        affinityScore -= 0.3;
      }

      // Weighted score calculation
      const basePopularityWeight = 0.4;
      const viewWeight = 0.1;
      const recencyWeight = 0.3;
      const userAffinityWeight = 0.2;

      const score =
        basePopularityWeight * normalizedLikes +
        viewWeight * normalizedViews +
        recencyWeight * recencyScore +
        userAffinityWeight * affinityScore +
        Math.random() * 0.15; // Add randomization for variety

      return { ...video, score };
    });

    // Sort by score and paginate
    const sortedVideos = scoredVideos
      .sort((a, b) => b.score - a.score)
      .slice(page * limit, (page + 1) * limit)
      .map(({ score, ...video }) => video); // Remove score from response

    return new Response(
      JSON.stringify({ videos: sortedVideos }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in get-for-you-feed:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
