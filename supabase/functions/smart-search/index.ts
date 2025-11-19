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

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  followers_count: number;
  following_count: number;
}

interface ScoredVideo extends Video {
  relevanceScore: number;
}

interface ScoredProfile extends Profile {
  relevanceScore: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, limit = 20 } = await req.json();

    if (!query || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ videos: [], users: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const searchTerm = query.trim().toLowerCase();
    console.log(`Searching for: "${searchTerm}"`);

    // Search videos
    const { data: videos, error: videosError } = await supabase
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
        profiles:user_id (
          username,
          avatar_url
        )
      `)
      .limit(100); // Fetch more for better scoring

    if (videosError) {
      console.error("Error fetching videos:", videosError);
      throw videosError;
    }

    // Search users
    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, bio, followers_count, following_count")
      .limit(50);

    if (usersError) {
      console.error("Error fetching users:", usersError);
      throw usersError;
    }

    // Score and filter videos
    const now = new Date().getTime();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    const scoredVideos: ScoredVideo[] = (videos || [])
      .map((video: any) => {
        let score = 0;

        // 1. TEXT RELEVANCE SCORE (0-50 points) - Most important for search
        // Title match (exact word: 20pts, contains: 10pts)
        const titleLower = video.title.toLowerCase();
        if (titleLower === searchTerm) {
          score += 20;
        } else if (titleLower.includes(searchTerm)) {
          score += 10;
        } else {
          // Word match
          const titleWords = titleLower.split(/\s+/);
          const searchWords = searchTerm.split(/\s+/);
          const matchCount = searchWords.filter((w: string) => titleWords.some((tw: string) => tw.includes(w))).length;
          score += (matchCount / searchWords.length) * 10;
        }

        // Description match (exact: 15pts, contains: 8pts)
        if (video.description) {
          const descLower = video.description.toLowerCase();
          if (descLower === searchTerm) {
            score += 15;
          } else if (descLower.includes(searchTerm)) {
            score += 8;
          } else {
            const descWords = descLower.split(/\s+/);
            const searchWords = searchTerm.split(/\s+/);
            const matchCount = searchWords.filter((w: string) => descWords.some((dw: string) => dw.includes(w))).length;
            score += (matchCount / searchWords.length) * 8;
          }
        }

        // Tags match (exact: 10pts each, partial: 5pts)
        if (video.tags && video.tags.length > 0) {
          video.tags.forEach((tag: string) => {
            const tagLower = tag.toLowerCase();
            if (tagLower === searchTerm) {
              score += 10;
            } else if (tagLower.includes(searchTerm)) {
              score += 5;
            }
          });
        }

        // Username match bonus (5pts)
        if (Array.isArray(video.profiles) && video.profiles.length > 0) {
          const username = video.profiles[0].username.toLowerCase();
          if (username.includes(searchTerm)) {
            score += 5;
          }
        }

        // If no text match at all, skip this video
        if (score === 0) {
          return null;
        }

        // 2. ENGAGEMENT SCORE (0-25 points)
        const totalEngagement = video.views_count + video.likes_count * 5 + video.comments_count * 10;
        const engagementScore = Math.min(25, Math.log(totalEngagement + 1) * 3);
        score += engagementScore;

        // 3. RECENCY SCORE (0-15 points)
        const videoAge = now - new Date(video.created_at).getTime();
        let recencyScore = 0;
        if (videoAge < ONE_DAY) {
          recencyScore = 15;
        } else if (videoAge < ONE_DAY * 3) {
          recencyScore = 10;
        } else if (videoAge < ONE_DAY * 7) {
          recencyScore = 5;
        } else if (videoAge < ONE_DAY * 30) {
          recencyScore = 2;
        }
        score += recencyScore;

        // 4. QUALITY SCORE (0-10 points)
        const engagementRate = video.views_count > 0
          ? ((video.likes_count + video.comments_count) / video.views_count) * 100
          : 0;
        const qualityScore = Math.min(10, engagementRate * 2);
        score += qualityScore;

        return {
          ...video,
          profiles: Array.isArray(video.profiles) && video.profiles.length > 0
            ? video.profiles[0]
            : { username: "Unknown", avatar_url: null },
          relevanceScore: score,
        };
      })
      .filter((v): v is ScoredVideo => v !== null && v.relevanceScore > 0);

    // Sort videos by score
    scoredVideos.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Score and filter users
    const scoredUsers: ScoredProfile[] = (users || [])
      .map((user: any) => {
        let score = 0;

        // Username match (exact: 50pts, starts with: 30pts, contains: 15pts)
        const usernameLower = user.username.toLowerCase();
        if (usernameLower === searchTerm) {
          score += 50;
        } else if (usernameLower.startsWith(searchTerm)) {
          score += 30;
        } else if (usernameLower.includes(searchTerm)) {
          score += 15;
        }

        // Bio match (contains: 10pts)
        if (user.bio) {
          const bioLower = user.bio.toLowerCase();
          if (bioLower.includes(searchTerm)) {
            score += 10;
          }
        }

        // If no match, skip this user
        if (score === 0) {
          return null;
        }

        // Popularity bonus (0-20 points based on followers)
        const popularityScore = Math.min(20, Math.log(user.followers_count + 1) * 2);
        score += popularityScore;

        return {
          ...user,
          relevanceScore: score,
        };
      })
      .filter((u): u is ScoredProfile => u !== null && u.relevanceScore > 0);

    // Sort users by score
    scoredUsers.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Return top results
    const topVideos = scoredVideos.slice(0, limit).map(({ relevanceScore, ...video }) => video);
    const topUsers = scoredUsers.slice(0, Math.min(limit, 10)).map(({ relevanceScore, ...user }) => user);

    console.log(`Found ${topVideos.length} videos and ${topUsers.length} users`);

    return new Response(
      JSON.stringify({ videos: topVideos, users: topUsers }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in smart-search:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
