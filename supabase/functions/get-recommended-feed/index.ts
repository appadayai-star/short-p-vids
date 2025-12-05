import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Video {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  video_url: string;
  optimized_video_url: string | null;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  comments_count: number;
  tags: string[] | null;
  created_at: string;
  profiles: { username: string; avatar_url: string | null };
}

interface CategoryPreference {
  category: string;
  interaction_score: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, page = 0, limit = 10 } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Feed request: userId=${userId}, page=${page}, limit=${limit}`);

    // Get total video count first
    const { count: totalVideos } = await supabase
      .from("videos")
      .select("*", { count: "exact", head: true });

    const MIN_VIDEOS_FOR_EXCLUSION = 20; // Only exclude viewed if we have enough content
    
    // Get viewed videos if user is logged in
    let viewedVideoIds: string[] = [];
    if (userId && totalVideos && totalVideos > MIN_VIDEOS_FOR_EXCLUSION) {
      const { data: viewedVideos } = await supabase
        .from("video_views")
        .select("video_id")
        .eq("user_id", userId);
      
      viewedVideoIds = viewedVideos?.map(v => v.video_id) || [];
      
      // Only exclude if user hasn't watched everything
      const unwatchedCount = totalVideos - viewedVideoIds.length;
      if (unwatchedCount < limit) {
        console.log(`Only ${unwatchedCount} unwatched videos, showing all content`);
        viewedVideoIds = []; // Don't exclude - show everything
      } else {
        console.log(`Excluding ${viewedVideoIds.length} viewed videos`);
      }
    }

    // Get user category preferences for personalization
    let categoryScores = new Map<string, number>();
    if (userId) {
      const { data: prefs } = await supabase
        .from("user_category_preferences")
        .select("category, interaction_score")
        .eq("user_id", userId);
      
      if (prefs && prefs.length > 0) {
        const totalScore = prefs.reduce((sum, p) => sum + (p.interaction_score || 0), 0);
        prefs.forEach(p => {
          categoryScores.set(p.category, totalScore > 0 ? p.interaction_score / totalScore : 0);
        });
        console.log(`User has ${prefs.length} category preferences`);
      }
    }

    // Fetch candidate videos
    let query = supabase
      .from("videos")
      .select(`
        id, user_id, title, description, video_url, optimized_video_url, thumbnail_url,
        views_count, likes_count, comments_count, tags, created_at,
        profiles(username, avatar_url)
      `);

    if (viewedVideoIds.length > 0) {
      query = query.not("id", "in", `(${viewedVideoIds.join(",")})`);
    }

    const { data: videos, error } = await query
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching videos:", error);
      throw error;
    }

    if (!videos || videos.length === 0) {
      console.log("No videos found");
      return new Response(
        JSON.stringify({ videos: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Scoring ${videos.length} candidate videos`);

    // Score videos
    const now = Date.now();
    const ONE_DAY = 86400000;

    const scored = videos.map((video: any) => {
      let score = 0;

      // Category relevance (0-40 pts)
      if (video.tags?.length && categoryScores.size > 0) {
        const catScore = video.tags.reduce((sum: number, tag: string) => 
          sum + (categoryScores.get(tag) || 0), 0) / video.tags.length;
        score += catScore * 40;
      } else {
        score += 10; // Base score for new users
      }

      // Engagement (0-25 pts)
      const engagement = video.views_count + video.likes_count * 5 + video.comments_count * 10;
      score += Math.min(25, Math.log(engagement + 1) * 3);

      // Recency (0-20 pts)
      const age = now - new Date(video.created_at).getTime();
      if (age < ONE_DAY) score += 20;
      else if (age < ONE_DAY * 3) score += 15;
      else if (age < ONE_DAY * 7) score += 10;
      else if (age < ONE_DAY * 14) score += 5;

      // Quality - engagement rate (0-10 pts)
      if (video.views_count > 0) {
        const rate = (video.likes_count + video.comments_count) / video.views_count;
        score += Math.min(10, rate * 20);
      }

      // Diversity bonus for unexplored categories (0-5 pts)
      if (video.tags?.some((t: string) => !categoryScores.has(t))) {
        score += 5;
      }

      // Randomness for variety
      score += Math.random() * 5;

      return { ...video, score };
    });

    // Sort by score and paginate
    scored.sort((a, b) => b.score - a.score);
    
    const start = page * limit;
    const paged = scored.slice(start, start + limit);

    // Diversify - don't show too many of same category in a row
    const result: any[] = [];
    const recentTags: string[] = [];
    
    for (const video of paged) {
      const videoTags = video.tags || [];
      const tooManyRecent = videoTags.length > 0 && 
        recentTags.slice(-3).filter(t => videoTags.includes(t)).length >= 2;
      
      if (!tooManyRecent || result.length === 0) {
        const { score, ...clean } = video;
        result.push(clean);
        recentTags.push(...videoTags);
      }
    }

    // Fill remaining slots if diversification removed some
    if (result.length < limit) {
      for (const video of paged) {
        if (result.length >= limit) break;
        if (!result.find(v => v.id === video.id)) {
          const { score, ...clean } = video;
          result.push(clean);
        }
      }
    }

    console.log(`Returning ${result.length} recommended videos`);

    return new Response(
      JSON.stringify({ videos: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Feed error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
