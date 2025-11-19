import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Video {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  views_count: number;
  likes_count: number;
  comments_count: number;
  tags: string[] | null;
  created_at: string;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

interface CategoryPreference {
  category: string;
  interaction_score: number;
  view_count: number;
  like_count: number;
  comment_count: number;
}

interface ScoredVideo extends Video {
  recommendationScore: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, page = 0, limit = 10, excludeVideoIds = [] } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Fetching recommendations for user: ${userId}, page: ${page}`);

    // Step 1: Get ALL videos the user has already viewed (like TikTok - never show again)
    let viewedVideoIds: string[] = [];
    if (userId) {
      const { data: viewedVideos, error: viewsError } = await supabase
        .from("video_views")
        .select("video_id")
        .eq("user_id", userId);

      if (viewsError) {
        console.error("Error fetching viewed videos:", viewsError);
      } else {
        viewedVideoIds = viewedVideos?.map(v => v.video_id) || [];
        console.log(`User has viewed ${viewedVideoIds.length} videos`);
      }
    }

    // Step 2: Get user's category preferences
    let userPreferences: CategoryPreference[] = [];
    if (userId) {
      const { data: preferences, error: prefError } = await supabase
        .from("user_category_preferences")
        .select("category, interaction_score, view_count, like_count, comment_count")
        .eq("user_id", userId);

      if (prefError) {
        console.error("Error fetching preferences:", prefError);
      } else {
        userPreferences = preferences || [];
        console.log(`Found ${userPreferences.length} category preferences`);
      }
    }

    // Calculate total interaction score for normalization
    const totalInteractionScore = userPreferences.reduce(
      (sum, pref) => sum + pref.interaction_score,
      0
    );

    // Create category preference map with normalized scores
    const categoryScoreMap = new Map<string, number>();
    userPreferences.forEach((pref) => {
      const normalizedScore = totalInteractionScore > 0
        ? pref.interaction_score / totalInteractionScore
        : 0;
      categoryScoreMap.set(pref.category, normalizedScore);
    });

    // Step 3: Fetch a pool of candidate videos (larger than requested limit)
    const poolSize = Math.max(limit * 10, 50); // Get 10x videos for better selection
    
    // Combine all video IDs to exclude: viewed videos + current session exclusions
    const allExcludedIds = [...new Set([...viewedVideoIds, ...excludeVideoIds])];
    console.log(`Excluding ${allExcludedIds.length} videos (${viewedVideoIds.length} viewed + ${excludeVideoIds.length} from session)`);
    
    let query = supabase
      .from("videos")
      .select(`
        id,
        user_id,
        title,
        description,
        video_url,
        thumbnail_url,
        duration_seconds,
        views_count,
        likes_count,
        comments_count,
        tags,
        created_at,
        profiles!inner(username, avatar_url)
      `);
    
    // Exclude ALL previously viewed videos + current session videos (TikTok behavior)
    if (allExcludedIds.length > 0) {
      query = query.not("id", "in", `(${allExcludedIds.join(",")})`);
    }
    
    const { data: videos, error: videosError } = await query
      .order("created_at", { ascending: false })
      .limit(poolSize);

    if (videosError) {
      console.error("Error fetching videos:", videosError);
      throw videosError;
    }

    if (!videos || videos.length === 0) {
      return new Response(
        JSON.stringify({ videos: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Fetched ${videos.length} candidate videos`);

    // Step 3: Score each video using sophisticated algorithm
    const now = new Date().getTime();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;

    const scoredVideos: ScoredVideo[] = videos.map((video: any) => {
      let score = 0;

      // 1. CATEGORY RELEVANCE SCORE (0-40 points)
      // Most important factor - matches user's interests
      let categoryScore = 0;
      if (video.tags && video.tags.length > 0 && userPreferences.length > 0) {
        video.tags.forEach((tag: string) => {
          const preferenceScore = categoryScoreMap.get(tag) || 0;
          categoryScore += preferenceScore * 40; // Up to 40 points per tag
        });
        // Average if multiple tags
        categoryScore = categoryScore / video.tags.length;
      } else {
        // Default score for videos with no tags or new users
        categoryScore = 10;
      }
      score += categoryScore;

      // 2. ENGAGEMENT SCORE (0-25 points)
      // Popularity indicator
      const totalEngagement = video.views_count + video.likes_count * 5 + video.comments_count * 10;
      const engagementScore = Math.min(25, Math.log(totalEngagement + 1) * 3);
      score += engagementScore;

      // 3. RECENCY SCORE (0-20 points)
      // Boost newer content
      const videoAge = now - new Date(video.created_at).getTime();
      let recencyScore = 0;
      if (videoAge < ONE_HOUR) {
        recencyScore = 20; // Brand new
      } else if (videoAge < ONE_DAY) {
        recencyScore = 15; // Less than a day
      } else if (videoAge < ONE_DAY * 3) {
        recencyScore = 10; // Less than 3 days
      } else if (videoAge < ONE_DAY * 7) {
        recencyScore = 5; // Less than a week
      }
      score += recencyScore;

      // 4. QUALITY SCORE (0-10 points)
      // Engagement rate relative to views
      const engagementRate = video.views_count > 0
        ? ((video.likes_count + video.comments_count) / video.views_count) * 100
        : 0;
      const qualityScore = Math.min(10, engagementRate * 2);
      score += qualityScore;

      // 5. DIVERSITY BONUS (0-5 points)
      // Small bonus for categories user hasn't seen much
      let diversityBonus = 0;
      if (video.tags && video.tags.length > 0) {
        const hasUnexploredCategory = video.tags.some(
          (tag: string) => !categoryScoreMap.has(tag)
        );
        if (hasUnexploredCategory) {
          diversityBonus = 5;
        }
      }
      score += diversityBonus;

      // Add some randomness for diversity (0-5 points)
      score += Math.random() * 5;

      return {
        ...video,
        profiles: video.profiles || { username: "Unknown", avatar_url: null },
        recommendationScore: score,
      };
    });

    // Step 4: Sort by recommendation score and apply pagination
    scoredVideos.sort((a, b) => b.recommendationScore - a.recommendationScore);

    // Apply diversity filter to ensure variety
    const diversifiedVideos: ScoredVideo[] = [];
    const seenCategories = new Set<string>();
    const categoryLimit = 3; // Max consecutive videos from same category

    for (const video of scoredVideos) {
      if (diversifiedVideos.length >= limit) break;

      // Check if we've seen too many of this category consecutively
      if (video.tags && video.tags.length > 0) {
        const recentCategoryCount = diversifiedVideos
          .slice(-categoryLimit)
          .filter((v) => v.tags?.some((tag) => video.tags?.includes(tag)))
          .length;

        // If we've seen too many of this category, skip (unless it's highly scored)
        if (recentCategoryCount >= categoryLimit && video.recommendationScore < 70) {
          continue;
        }
      }

      diversifiedVideos.push(video);
      video.tags?.forEach((tag) => seenCategories.add(tag));
    }

    console.log(`Returning ${diversifiedVideos.length} recommended videos`);

    // Remove the recommendation score before returning
    const finalVideos = diversifiedVideos.map(({ recommendationScore, ...video }) => video);

    return new Response(
      JSON.stringify({ videos: finalVideos }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in get-recommended-feed:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
