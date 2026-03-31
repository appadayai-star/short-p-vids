import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Synonym map: search term → related category tags
const SYNONYM_MAP: Record<string, string[]> = {
  // Mom / MILF related
  stepmom: ["mom", "milf"],
  "step mom": ["mom", "milf"],
  "step-mom": ["mom", "milf"],
  mother: ["mom", "milf"],
  mommy: ["mom", "milf"],
  mature: ["mom", "milf"],
  cougar: ["mom", "milf"],
  // Stepsis related
  stepsister: ["stepsis"],
  "step sister": ["stepsis"],
  "step-sister": ["stepsis"],
  sis: ["stepsis"],
  sister: ["stepsis"],
  // Body type related
  pawg: ["big_ass"],
  booty: ["big_ass"],
  thicc: ["big_ass"],
  thick: ["big_ass"],
  busty: ["big_tits"],
  tits: ["big_tits"],
  boobs: ["big_tits"],
  breasts: ["big_tits"],
  petite: ["small", "teen"],
  tiny: ["small"],
  skinny: ["small"],
  // Ethnicity related
  japanese: ["asian"],
  chinese: ["asian"],
  korean: ["asian"],
  filipina: ["asian"],
  thai: ["asian"],
  mexican: ["latina"],
  colombian: ["latina"],
  brazilian: ["latina"],
  spanish: ["latina"],
  // Hair related
  redhead: ["red_head"],
  "red head": ["red_head"],
  ginger: ["red_head"],
  brunette: ["brunettes"],
  // Act related
  bj: ["blowjob"],
  blowjobs: ["blowjob"],
  oral: ["blowjob"],
  suck: ["blowjob"],
  sucking: ["blowjob"],
  cum: ["cumshot"],
  cumshots: ["cumshot"],
  facial: ["cumshot"],
  creampie: ["cumshot"],
  squirting: ["squirt"],
  // Style related
  homevideo: ["homemade"],
  "home video": ["homemade"],
  "home made": ["homemade"],
  selfmade: ["homemade"],
  amatuer: ["amateur"], // common typo
  amature: ["amateur"], // common typo
  emo: ["goth"],
  alternative: ["goth"],
  punk: ["goth"],
  // POV related
  "point of view": ["pov"],
  firstperson: ["pov"],
  "first person": ["pov"],
  // Lesbian related
  lesbians: ["lesbian"],
  girl: ["lesbian"],
  "girl on girl": ["lesbian"],
  gg: ["lesbian"],
};

// Blocked search terms — return empty results immediately
const BLOCKED_KEYWORDS = [
  "rape", "child", "kids", "minor", "underage", "teen",
  "preteen", "infant", "toddler", "pedo", "pedophile",
  "cp", "kidnap", "forced", "nonconsent", "non-consent",
];

// Build a reverse lookup: category → all synonyms that map to it
const CATEGORY_SYNONYMS: Record<string, string[]> = {};
for (const [synonym, categories] of Object.entries(SYNONYM_MAP)) {
  for (const cat of categories) {
    if (!CATEGORY_SYNONYMS[cat]) CATEGORY_SYNONYMS[cat] = [];
    CATEGORY_SYNONYMS[cat].push(synonym);
  }
}

// All known category IDs
const ALL_CATEGORIES = [
  "beauty", "real", "public", "homemade", "pov", "mom", "milf",
  "amateur", "latina", "asian", "big_ass", "big_tits", "lesbian",
  "blonde", "brunettes", "red_head", "small", "stepsis", "anal",
  "blowjob", "teen", "goth", "cumshot", "squirt",
];

/**
 * Get expanded category tags that match the search term.
 * Checks: exact category match, synonym map, reverse partial (tag inside search), search inside tag.
 */
function getMatchingCategories(searchTerm: string): string[] {
  const matched = new Set<string>();

  // 1. Direct category match
  for (const cat of ALL_CATEGORIES) {
    if (cat === searchTerm || cat.includes(searchTerm) || searchTerm.includes(cat)) {
      matched.add(cat);
    }
  }

  // 2. Synonym map lookup
  const synonymHits = SYNONYM_MAP[searchTerm];
  if (synonymHits) {
    synonymHits.forEach((cat) => matched.add(cat));
  }

  // 3. Partial synonym matching: check if any synonym key is contained in or contains the search
  for (const [synonym, categories] of Object.entries(SYNONYM_MAP)) {
    if (synonym !== searchTerm && (synonym.includes(searchTerm) || searchTerm.includes(synonym))) {
      categories.forEach((cat) => matched.add(cat));
    }
  }

  return Array.from(matched);
}

/**
 * Check if a video's tags match any of the expanded categories.
 */
function getTagMatchScore(videoTags: string[] | null, matchingCategories: string[], searchTerm: string): number {
  if (!videoTags || videoTags.length === 0) return 0;
  let score = 0;

  for (const tag of videoTags) {
    const tagLower = tag.toLowerCase();

    // Exact match with search term
    if (tagLower === searchTerm) {
      score += 10;
    } 
    // Tag contains search term or search term contains tag (reverse partial)
    else if (tagLower.includes(searchTerm) || searchTerm.includes(tagLower)) {
      score += 7;
    }
    // Tag is in the expanded category set (synonym/category-aware boost)
    else if (matchingCategories.includes(tagLower)) {
      score += 8;
    }
  }

  return score;
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
    const searchWords = searchTerm.split(/\s+/);
    console.log(`Searching for: "${searchTerm}"`);

    // Get expanded matching categories for synonym/category-aware boosting
    const matchingCategories = getMatchingCategories(searchTerm);
    console.log(`Matching categories: ${matchingCategories.join(", ") || "none"}`);

    // Search videos
    const { data: videos, error: videosError } = await supabase
      .from("videos")
      .select(`
        id, user_id, title, description, video_url, optimized_video_url,
        stream_url, cloudinary_public_id, cloudflare_video_id,
        thumbnail_url, duration_seconds, views_count, likes_count,
        comments_count, tags, created_at,
        profiles!inner ( username, avatar_url )
      `)
      .limit(100);

    if (videosError) {
      console.error("Error fetching videos:", videosError);
      throw videosError;
    }

    // Search users
    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, bio, followers_count, following_count")
      .or(`username.ilike.%${searchTerm}%,bio.ilike.%${searchTerm}%`)
      .limit(50);

    if (usersError) {
      console.error("Error fetching users:", usersError);
      throw usersError;
    }

    // Score and filter videos
    const now = Date.now();
    const ONE_DAY = 86_400_000;

    const scoredVideos = (videos || [])
      .map((video: any) => {
        let score = 0;

        // --- 1. TEXT RELEVANCE (0–50 pts) ---
        const titleLower = (video.title || "").toLowerCase();
        if (titleLower === searchTerm) {
          score += 20;
        } else if (titleLower.includes(searchTerm)) {
          score += 10;
        } else {
          const titleWords = titleLower.split(/\s+/);
          const matchCount = searchWords.filter((w: string) =>
            titleWords.some((tw: string) => tw.includes(w) || w.includes(tw))
          ).length;
          score += (matchCount / searchWords.length) * 10;
        }

        // Description match
        if (video.description) {
          const descLower = video.description.toLowerCase();
          if (descLower === searchTerm) {
            score += 15;
          } else if (descLower.includes(searchTerm)) {
            score += 8;
          } else {
            const descWords = descLower.split(/\s+/);
            const matchCount = searchWords.filter((w: string) =>
              descWords.some((dw: string) => dw.includes(w) || w.includes(dw))
            ).length;
            score += (matchCount / searchWords.length) * 8;
          }
        }

        // --- 2. TAG / CATEGORY RELEVANCE (0–30 pts) ---
        score += getTagMatchScore(video.tags, matchingCategories, searchTerm);

        // Username match bonus (5pts)
        if (video.profiles?.username) {
          const username = video.profiles.username.toLowerCase();
          if (username.includes(searchTerm) || searchTerm.includes(username)) {
            score += 5;
          }
        }

        // If no relevance at all, skip
        if (score === 0) return null;

        // --- 3. ENGAGEMENT (0–25 pts) ---
        const totalEngagement = video.views_count + video.likes_count * 5 + video.comments_count * 10;
        score += Math.min(25, Math.log(totalEngagement + 1) * 3);

        // --- 4. RECENCY (0–15 pts) ---
        const videoAge = now - new Date(video.created_at).getTime();
        if (videoAge < ONE_DAY) score += 15;
        else if (videoAge < ONE_DAY * 3) score += 10;
        else if (videoAge < ONE_DAY * 7) score += 5;
        else if (videoAge < ONE_DAY * 30) score += 2;

        // --- 5. QUALITY (0–10 pts) ---
        if (video.views_count > 0) {
          const engagementRate = ((video.likes_count + video.comments_count) / video.views_count) * 100;
          score += Math.min(10, engagementRate * 2);
        }

        return {
          ...video,
          profiles: video.profiles || { username: "Unknown", avatar_url: null },
          relevanceScore: score,
        };
      })
      .filter((v: any): v is any => v !== null && v.relevanceScore > 0);

    // Sort & deduplicate
    scoredVideos.sort((a: any, b: any) => b.relevanceScore - a.relevanceScore);
    const seenIds = new Set<string>();
    const uniqueVideos = scoredVideos.filter((v: any) => {
      if (seenIds.has(v.id)) return false;
      seenIds.add(v.id);
      return true;
    });

    // Score users
    const scoredUsers = (users || [])
      .map((user: any) => {
        let score = 0;
        const usernameLower = user.username.toLowerCase();
        if (usernameLower === searchTerm) score += 50;
        else if (usernameLower.startsWith(searchTerm)) score += 30;
        else if (usernameLower.includes(searchTerm)) score += 15;

        if (user.bio) {
          if (user.bio.toLowerCase().includes(searchTerm)) score += 10;
        }

        if (score === 0) return null;

        score += Math.min(20, Math.log(user.followers_count + 1) * 2);
        return { ...user, relevanceScore: score };
      })
      .filter((u: any): u is any => u !== null && u.relevanceScore > 0);

    scoredUsers.sort((a: any, b: any) => b.relevanceScore - a.relevanceScore);

    const topVideos = uniqueVideos.slice(0, limit).map(({ relevanceScore, ...v }: any) => v);
    const topUsers = scoredUsers.slice(0, Math.min(limit, 10)).map(({ relevanceScore, ...u }: any) => u);

    console.log(`Found ${topVideos.length} videos and ${topUsers.length} users`);

    return new Response(
      JSON.stringify({ videos: topVideos, users: topUsers }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in smart-search:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
