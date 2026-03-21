import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Deterministic seeded RNG
function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return function() {
    hash |= 0;
    hash = hash + 0x6D2B79F5 | 0;
    let t = Math.imul(hash ^ hash >>> 15, 1 | hash);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function getTodayDateString(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

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
      viewerId,
      sessionId,
      cursor,
      limit = 10, 
      sessionViewedIds = [],
      categoryFilter = null,
      // NEW: session watch data for mid-session adaptation
      sessionWatchData = [] // Array of { videoId, watchDuration, tags }
    } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const viewerIdentity = userId || viewerId || sessionId || 'anonymous';
    const dateStr = getTodayDateString();
    const seed = `${viewerIdentity}-${dateStr}`;
    const rng = seededRandom(seed);
    
    console.log(`[feed] Viewer: ${viewerIdentity.substring(0, 8)}..., sessionWatchData: ${sessionWatchData.length} entries`);

    const sessionExcludeSet = new Set<string>(sessionViewedIds || []);

    // === SESSION ADAPTATION (Goal #7) ===
    // Analyze what the user watched longest THIS session to adapt mid-session
    const sessionCategoryBoost = new Map<string, number>();
    const sessionSkippedCategories = new Map<string, number>();
    
    if (sessionWatchData.length >= 3) {
      for (const entry of sessionWatchData) {
        const tags = entry.tags || [];
        const duration = entry.watchDuration || 0;
        
        for (const tag of tags) {
          const tagLower = tag.toLowerCase();
          if (duration >= 8) {
            // Watched 8s+ → boost this category
            sessionCategoryBoost.set(tagLower, (sessionCategoryBoost.get(tagLower) || 0) + duration);
          } else if (duration <= 2) {
            // Skipped within 2s → penalize category
            sessionSkippedCategories.set(tagLower, (sessionSkippedCategories.get(tagLower) || 0) + 1);
          }
        }
      }
      console.log(`[feed] Session adaptation: ${sessionCategoryBoost.size} boosted categories, ${sessionSkippedCategories.size} penalized`);
    }

    // Fetch recent videos (last 30 days, up to 500)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let query = supabaseClient
      .from("videos")
      .select(`
        id, title, description, video_url, optimized_video_url, stream_url,
        cloudinary_public_id, thumbnail_url, processing_status,
        views_count, likes_count, tags, created_at, user_id,
        duration_seconds,
        profiles!inner(username, avatar_url)
      `)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);

    if (categoryFilter) {
      query = query.contains("tags", [categoryFilter]);
    }

    const { data: recentVideos, error } = await query;
    if (error) throw error;

    const eligibleVideos = (recentVideos || []).filter(
      (v: any) => !sessionExcludeSet.has(v.id)
    );
    console.log(`[feed] Eligible: ${eligibleVideos.length} videos`);

    const videoIds = eligibleVideos.map((v: any) => v.id);

    // Fetch 7-day watch metrics
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [watchResult, shareResult] = await Promise.all([
      supabaseClient
        .from("video_views")
        .select("video_id, watch_completion_percent, watch_duration_seconds")
        .in("video_id", videoIds)
        .gte("viewed_at", sevenDaysAgo.toISOString()),
      supabaseClient
        .from("shares")
        .select("video_id")
        .in("video_id", videoIds)
        .gte("created_at", sevenDaysAgo.toISOString())
    ]);

    // Build metrics map with early skip detection (Goal #5)
    const watchByVideo = new Map<string, { completions: number[], durations: number[], earlySkips: number, totalViews: number }>();
    for (const row of (watchResult.data || [])) {
      if (!watchByVideo.has(row.video_id)) {
        watchByVideo.set(row.video_id, { completions: [], durations: [], earlySkips: 0, totalViews: 0 });
      }
      const entry = watchByVideo.get(row.video_id)!;
      entry.totalViews++;
      
      if (row.watch_completion_percent != null && row.watch_completion_percent > 0) {
        entry.completions.push(row.watch_completion_percent);
      }
      if (row.watch_duration_seconds != null) {
        if (row.watch_duration_seconds <= 2) {
          entry.earlySkips++; // Goal #5: early skip detection
        }
        if (row.watch_duration_seconds > 0) {
          entry.durations.push(row.watch_duration_seconds);
        }
      }
    }

    const sharesByVideo = new Map<string, number>();
    for (const row of (shareResult.data || [])) {
      sharesByVideo.set(row.video_id, (sharesByVideo.get(row.video_id) || 0) + 1);
    }

    // Build final metrics
    interface VideoMetrics {
      avg_completion: number;
      avg_watch_duration: number;
      view_count: number;
      share_count: number;
      early_skip_rate: number;
      rewatch_signal: number;
    }
    
    const metricsMap = new Map<string, VideoMetrics>();
    for (const videoId of videoIds) {
      const watchData = watchByVideo.get(videoId);
      const avgCompletion = watchData && watchData.completions.length > 0
        ? watchData.completions.reduce((a, b) => a + b, 0) / watchData.completions.length
        : -1;
      const avgDuration = watchData && watchData.durations.length > 0
        ? watchData.durations.reduce((a, b) => a + b, 0) / watchData.durations.length
        : -1;
      
      // Early skip rate (Goal #5)
      const earlySkipRate = watchData && watchData.totalViews >= 3
        ? watchData.earlySkips / watchData.totalViews
        : 0;
      
      // Rewatch signal (Goal #4): if avg completion > 100%, video loops well
      const rewatchSignal = avgCompletion > 80 ? Math.min((avgCompletion - 80) / 50, 1) : 0;
      
      metricsMap.set(videoId, {
        avg_completion: avgCompletion,
        avg_watch_duration: avgDuration,
        view_count: watchData?.totalViews || 0,
        share_count: sharesByVideo.get(videoId) || 0,
        early_skip_rate: earlySkipRate,
        rewatch_signal: rewatchSignal,
      });
    }

    // View history for "seen" penalty
    let viewedVideoIds = new Set<string>();
    if (userId) {
      const { data: recentViews } = await supabaseClient
        .from("video_views")
        .select("video_id")
        .eq("user_id", userId)
        .gte("viewed_at", sevenDaysAgo.toISOString());
      viewedVideoIds = new Set(recentViews?.map(v => v.video_id) || []);
    } else if (viewerId) {
      const { data: recentViews } = await supabaseClient
        .from("video_views")
        .select("video_id")
        .eq("viewer_id", viewerId)
        .gte("viewed_at", sevenDaysAgo.toISOString());
      viewedVideoIds = new Set(recentViews?.map(v => v.video_id) || []);
    }

    // Global max values for normalization
    const maxLikes = Math.max(...eligibleVideos.map((v: any) => v.likes_count), 1);
    const maxViews = Math.max(...eligibleVideos.map((v: any) => v.views_count), 1);
    const maxShares = Math.max(...Array.from(metricsMap.values()).map(m => m.share_count), 1);

    // === CATEGORY PERFORMANCE (Goal #6) ===
    // Find top-performing categories based on watch metrics
    const categoryPerformance = new Map<string, { totalWatchTime: number, count: number }>();
    for (const video of eligibleVideos) {
      const metrics = metricsMap.get(video.id);
      if (!metrics || metrics.avg_watch_duration < 0) continue;
      for (const tag of (video.tags || [])) {
        const tagLower = tag.toLowerCase();
        const perf = categoryPerformance.get(tagLower) || { totalWatchTime: 0, count: 0 };
        perf.totalWatchTime += metrics.avg_watch_duration;
        perf.count++;
        categoryPerformance.set(tagLower, perf);
      }
    }
    const categoryAvgWatchTime = new Map<string, number>();
    for (const [cat, perf] of categoryPerformance) {
      if (perf.count >= 2) {
        categoryAvgWatchTime.set(cat, perf.totalWatchTime / perf.count);
      }
    }
    const maxCatWatchTime = Math.max(...Array.from(categoryAvgWatchTime.values()), 1);

    // === SCORING FUNCTION (Goals #1, #3, #4, #5, #6, #8, #9) ===
    const scoreVideo = (video: any, affinityScore: number = 0): { score: number; breakdown: any } => {
      const metrics = metricsMap.get(video.id);
      
      const normalizedLikes = video.likes_count / maxLikes;
      const normalizedViews = video.views_count / maxViews;
      
      // Recency (reduced weight, still relevant)
      const ageInDays = (Date.now() - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageInDays / 7);

      // === RETENTION SIGNALS (heavily weighted) ===
      
      // Completion score (Goal #1: PRIORITIZE HIGH RETENTION)
      let completionScore = 0.5;
      if (metrics && metrics.avg_completion >= 0) {
        completionScore = Math.min(metrics.avg_completion / 100, 1);
        // Bonus for very high completion (>70%)
        if (metrics.avg_completion > 70) {
          completionScore *= 1.3;
          completionScore = Math.min(completionScore, 1.5);
        }
      }

      // Watch time score (Goal #1: high watch duration)
      let watchTimeScore = 0.5;
      if (metrics && metrics.avg_watch_duration >= 0) {
        watchTimeScore = Math.min(metrics.avg_watch_duration / 15, 1); // Normalized to 15s target
        // Strong bonus for videos averaging 12s+
        if (metrics.avg_watch_duration >= 12) {
          watchTimeScore *= 1.2;
          watchTimeScore = Math.min(watchTimeScore, 1.5);
        }
      }

      // Shares score
      let sharesScore = 0;
      if (metrics && metrics.view_count > 0) {
        sharesScore = Math.min((metrics.share_count / metrics.view_count) * 10, 1);
      } else if (metrics && metrics.share_count > 0) {
        sharesScore = metrics.share_count / maxShares;
      }

      // === PENALTY SIGNALS ===
      
      // Early skip penalty (Goal #5: heavily reduce ranking for quick skips)
      let earlySkipPenalty = 0;
      if (metrics && metrics.early_skip_rate > 0) {
        // >50% skip rate = severe penalty
        if (metrics.early_skip_rate > 0.5) {
          earlySkipPenalty = -0.4;
        } else if (metrics.early_skip_rate > 0.3) {
          earlySkipPenalty = -0.25;
        } else if (metrics.early_skip_rate > 0.15) {
          earlySkipPenalty = -0.1;
        }
      }

      // Low quality penalty (Goal #8: underperforming videos shown less)
      let lowQualityPenalty = 0;
      if (metrics && metrics.view_count >= 5) {
        if (metrics.avg_watch_duration >= 0 && metrics.avg_watch_duration < 3) {
          lowQualityPenalty = -0.3; // Avg watch under 3s with 5+ views = bad content
        } else if (metrics.avg_completion >= 0 && metrics.avg_completion < 15) {
          lowQualityPenalty = -0.2; // Very low completion
        }
      }

      // Short video / loop boost (Goal #4)
      let loopBoost = 0;
      const videoDuration = video.duration_seconds;
      if (videoDuration && videoDuration <= 15 && metrics && metrics.rewatch_signal > 0) {
        loopBoost = metrics.rewatch_signal * 0.1; // Up to 0.1 bonus for rewatched short videos
      }

      // Category performance boost (Goal #6)
      let categoryBoost = 0;
      if (video.tags) {
        for (const tag of video.tags) {
          const avgWT = categoryAvgWatchTime.get(tag.toLowerCase());
          if (avgWT) {
            categoryBoost += (avgWT / maxCatWatchTime) * 0.05;
          }
        }
        categoryBoost = Math.min(categoryBoost, 0.15);
      }

      // Session adaptation boost (Goal #7)
      let sessionBoost = 0;
      if (video.tags && sessionCategoryBoost.size > 0) {
        for (const tag of video.tags) {
          const boost = sessionCategoryBoost.get(tag.toLowerCase());
          if (boost) {
            sessionBoost += Math.min(boost / 60, 0.1); // normalize: 60s total watch = max boost
          }
          const penalty = sessionSkippedCategories.get(tag.toLowerCase());
          if (penalty && penalty >= 2) {
            sessionBoost -= 0.1 * penalty; // penalize categories skipped multiple times
          }
        }
        sessionBoost = Math.max(-0.3, Math.min(sessionBoost, 0.2));
      }

      // Exploration factor (Goal #3: REDUCED randomness - was 0.20, now 0.08)
      const videoRng = seededRandom(`${seed}-${video.id}`);
      const explorationFactor = videoRng() * 0.08;

      // Quality bonus for processed videos
      const qualityBonus = video.cloudinary_public_id ? 0.03 : 0;

      // Viewed penalty
      const viewedPenalty = viewedVideoIds.has(video.id) ? -1.5 : 0;

      // === NEW WEIGHT DISTRIBUTION (retention-focused) ===
      // Completion:   30% (was 20%) — strongest signal for retention
      // Watch time:   25% (was 15%) — directly measures engagement
      // Affinity:     12% (was 10%) — personalization
      // Likes:        10% (was 15%) — social proof
      // Shares:        8% (was 10%) — high-value engagement
      // Recency:       8% (was 15%) — fresh content, reduced
      // Views:         3% (was 5%)  — popularity, less important
      // Quality/Exploration: ~4%
      
      const wCompletion = 0.30 * completionScore;
      const wWatchTime = 0.25 * watchTimeScore;
      const wAffinity = 0.12 * Math.min(affinityScore, 1);
      const wLikes = 0.10 * normalizedLikes;
      const wShares = 0.08 * sharesScore;
      const wRecency = 0.08 * recencyScore;
      const wViews = 0.03 * normalizedViews;

      const score = 
        wCompletion +
        wWatchTime +
        wAffinity +
        wLikes +
        wShares +
        wRecency +
        wViews +
        explorationFactor +
        qualityBonus +
        loopBoost +
        categoryBoost +
        sessionBoost +
        earlySkipPenalty +
        lowQualityPenalty +
        viewedPenalty;

      return {
        score,
        breakdown: {
          completionScore: wCompletion,
          watchTimeScore: wWatchTime,
          affinityScore: wAffinity,
          likesScore: wLikes,
          sharesScore: wShares,
          recencyScore: wRecency,
          viewsScore: wViews,
          explorationFactor,
          qualityBonus,
          loopBoost,
          categoryBoost,
          sessionBoost,
          earlySkipPenalty,
          lowQualityPenalty,
          viewedPenalty,
        }
      };
    };

    // Score all videos
    let scoredVideos: any[];
    
    if (!userId) {
      scoredVideos = eligibleVideos.map((video: any) => {
        const { score, breakdown } = scoreVideo(video, 0);
        return { ...video, score, breakdown, isViewed: viewedVideoIds.has(video.id) };
      });
    } else {
      const [likesResult, prefsResult] = await Promise.all([
        supabaseClient
          .from("likes")
          .select("video_id, videos(user_id, tags)")
          .eq("user_id", userId),
        supabaseClient
          .from("user_category_preferences")
          .select("category, interaction_score")
          .eq("user_id", userId)
          .order("interaction_score", { ascending: false })
          .limit(10)
      ]);

      const likedUploaderIds = new Set(
        likesResult.data?.map((l: any) => l.videos?.user_id).filter(Boolean) || []
      );
      const likedTags = new Set(
        likesResult.data?.flatMap((l: any) => l.videos?.tags || []) || []
      );
      const preferredCategories = new Map(
        prefsResult.data?.map(p => [p.category.toLowerCase(), p.interaction_score]) || []
      );

      scoredVideos = eligibleVideos.map((video: any) => {
        let affinity = 0;
        if (likedUploaderIds.has(video.user_id)) affinity += 0.5;
        if (video.tags) {
          for (const tag of video.tags) {
            const catScore = preferredCategories.get(tag.toLowerCase());
            if (catScore) affinity += Math.min(catScore / 100, 0.25);
            if (likedTags.has(tag)) affinity += 0.1;
          }
        }
        const { score, breakdown } = scoreVideo(video, affinity);
        return { ...video, score, breakdown, isViewed: viewedVideoIds.has(video.id) };
      });
    }

    // Separate unviewed and viewed
    const unviewedVideos = scoredVideos.filter(v => !v.isViewed);
    const viewedVideos = scoredVideos.filter(v => v.isViewed);

    // Sort by score
    const sortedUnviewed = unviewedVideos.sort((a, b) => b.score - a.score);
    const sortedViewed = viewedVideos.sort((a, b) => b.score - a.score);

    // === FIRST VIDEO IMPACT (Goal #2) ===
    // First 5 videos are strictly top-scored (NO tier shuffling)
    // Remaining use small tier shuffling (3 per tier instead of 5)
    const isFirstPage = !cursor;
    const topSlotCount = isFirstPage ? 5 : 0;
    
    let finalUnviewed: typeof sortedUnviewed;
    if (isFirstPage && sortedUnviewed.length > topSlotCount) {
      // Top 5 stay in strict score order - best content first
      const topSlot = sortedUnviewed.slice(0, topSlotCount);
      const rest = sortedUnviewed.slice(topSlotCount);
      
      // Shuffle remaining in small tiers of 3 (reduced from 5)
      const shuffledRest: typeof rest = [];
      const tierSize = 3;
      for (let i = 0; i < rest.length; i += tierSize) {
        const tier = rest.slice(i, i + tierSize);
        shuffledRest.push(...shuffleArraySeeded(tier, rng));
      }
      
      finalUnviewed = [...topSlot, ...shuffledRest];
    } else {
      // Subsequent pages: small tier shuffle
      const shuffled: typeof sortedUnviewed = [];
      const tierSize = 3;
      for (let i = 0; i < sortedUnviewed.length; i += tierSize) {
        const tier = sortedUnviewed.slice(i, i + tierSize);
        shuffled.push(...shuffleArraySeeded(tier, rng));
      }
      finalUnviewed = shuffled;
    }

    // Apply creator diversity
    let finalResult = applyCreatorDiversity(finalUnviewed, 4);

    // Add viewed videos at end
    const shuffledViewed = shuffleArraySeeded(sortedViewed, rng);
    const diverseViewed = applyCreatorDiversity(shuffledViewed, 4);
    finalResult = [...finalResult, ...diverseViewed];

    // Cursor-based pagination
    let startIndex = 0;
    if (cursor && cursor.id) {
      const cursorIndex = finalResult.findIndex(v => v.id === cursor.id);
      if (cursorIndex !== -1) startIndex = cursorIndex + 1;
    }

    const paginatedVideos = finalResult.slice(startIndex, startIndex + limit);
    const lastVideo = paginatedVideos[paginatedVideos.length - 1];
    const nextCursor = lastVideo ? { score: lastVideo.score, id: lastVideo.id } : null;
    const hasMore = startIndex + limit < finalResult.length;

    // Clean response
    const responseVideos = paginatedVideos.map(({ score, breakdown, isViewed, ...video }) => video);

    // Debug mode
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
    console.error("[feed] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
