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

// Creator + category diversity: no same creator within N, no same primary category within M
function applyDiversity(videos: any[], creatorGap = 4, categoryGap = 3): any[] {
  if (videos.length <= creatorGap) return videos;
  const result: any[] = [];
  const remaining = [...videos];
  const recentCreators: string[] = [];
  const recentCategories: string[] = [];

  while (remaining.length > 0 && result.length < videos.length) {
    // Find first video that satisfies both creator and category diversity
    let nextIdx = remaining.findIndex(v => {
      const creatorOk = !recentCreators.slice(-creatorGap).includes(v.user_id);
      const primaryCat = v.tags?.[0]?.toLowerCase() || '';
      const catOk = !primaryCat || !recentCategories.slice(-categoryGap).includes(primaryCat);
      return creatorOk && catOk;
    });

    // Fallback: just creator diversity
    if (nextIdx === -1) {
      nextIdx = remaining.findIndex(v => !recentCreators.slice(-creatorGap).includes(v.user_id));
    }

    // Fallback: take first
    if (nextIdx === -1) nextIdx = 0;

    const video = remaining.splice(nextIdx, 1)[0];
    result.push(video);
    recentCreators.push(video.user_id);
    const primaryCat = video.tags?.[0]?.toLowerCase() || '';
    if (primaryCat) recentCategories.push(primaryCat);
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

    console.log(`[feed] Viewer: ${viewerIdentity.substring(0, 8)}..., sessionWatch: ${sessionWatchData.length}`);

    const sessionExcludeSet = new Set<string>(sessionViewedIds || []);

    // === SESSION ADAPTATION — triggers after just 2 videos (Goal #7) ===
    const sessionCategoryBoost = new Map<string, number>();
    const sessionSkippedCategories = new Map<string, number>();

    if (sessionWatchData.length >= 2) {
      for (const entry of sessionWatchData) {
        const tags = entry.tags || [];
        const duration = entry.watchDuration || 0;

        for (const tag of tags) {
          const tagLower = tag.toLowerCase();
          if (duration >= 5) {
            // Watched 5s+ → boost (lowered from 8s for faster adaptation)
            sessionCategoryBoost.set(tagLower, (sessionCategoryBoost.get(tagLower) || 0) + duration);
          }
          if (duration <= 2) {
            sessionSkippedCategories.set(tagLower, (sessionSkippedCategories.get(tagLower) || 0) + 1);
          }
        }
      }
      console.log(`[feed] Session adapt: +${sessionCategoryBoost.size} cats, -${sessionSkippedCategories.size} cats`);
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

    // Fetch 7-day watch metrics + early skip data
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

    // Build per-video metrics
    interface WatchBucket {
      completions: number[];
      durations: number[];
      earlySkips: number;     // watched ≤2s
      hookPasses: number;     // watched >2s
      totalViews: number;
    }
    const watchByVideo = new Map<string, WatchBucket>();
    for (const row of (watchResult.data || [])) {
      if (!watchByVideo.has(row.video_id)) {
        watchByVideo.set(row.video_id, { completions: [], durations: [], earlySkips: 0, hookPasses: 0, totalViews: 0 });
      }
      const entry = watchByVideo.get(row.video_id)!;
      entry.totalViews++;

      if (row.watch_completion_percent != null && row.watch_completion_percent > 0) {
        entry.completions.push(row.watch_completion_percent);
      }
      if (row.watch_duration_seconds != null) {
        if (row.watch_duration_seconds <= 2) {
          entry.earlySkips++;
        } else {
          entry.hookPasses++;
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

    // Build metrics map
    interface VideoMetrics {
      avg_completion: number;
      avg_watch_duration: number;
      view_count: number;
      share_count: number;
      early_skip_rate: number;
      hook_rate: number;         // % of viewers who watch past 2s
      rewatch_signal: number;
      is_top_performer: boolean; // top ~15% by retention
    }

    const metricsMap = new Map<string, VideoMetrics>();
    // First pass: compute raw metrics
    const allCompletions: number[] = [];
    const allWatchDurations: number[] = [];

    for (const videoId of videoIds) {
      const wd = watchByVideo.get(videoId);
      const avgCompletion = wd && wd.completions.length > 0
        ? wd.completions.reduce((a, b) => a + b, 0) / wd.completions.length : -1;
      const avgDuration = wd && wd.durations.length > 0
        ? wd.durations.reduce((a, b) => a + b, 0) / wd.durations.length : -1;

      const earlySkipRate = wd && wd.totalViews >= 3
        ? wd.earlySkips / wd.totalViews : 0;

      // Hook rate: % of viewers watching >2s (Goal #4)
      const hookRate = wd && wd.totalViews >= 3
        ? wd.hookPasses / wd.totalViews : -1; // -1 = no data

      const rewatchSignal = avgCompletion > 80 ? Math.min((avgCompletion - 80) / 50, 1) : 0;

      metricsMap.set(videoId, {
        avg_completion: avgCompletion,
        avg_watch_duration: avgDuration,
        view_count: wd?.totalViews || 0,
        share_count: sharesByVideo.get(videoId) || 0,
        early_skip_rate: earlySkipRate,
        hook_rate: hookRate,
        rewatch_signal: rewatchSignal,
        is_top_performer: false, // set below
      });

      if (avgCompletion >= 0 && wd && wd.totalViews >= 3) allCompletions.push(avgCompletion);
      if (avgDuration >= 0 && wd && wd.totalViews >= 3) allWatchDurations.push(avgDuration);
    }

    // === IDENTIFY TOP PERFORMERS (Goal #1) ===
    // Top 15% by completion AND watch time get "top performer" status
    allCompletions.sort((a, b) => b - a);
    allWatchDurations.sort((a, b) => b - a);
    const completionP85 = allCompletions.length > 0 ? allCompletions[Math.floor(allCompletions.length * 0.15)] : 100;
    const watchDurationP85 = allWatchDurations.length > 0 ? allWatchDurations[Math.floor(allWatchDurations.length * 0.15)] : 30;

    let topPerformerCount = 0;
    for (const [videoId, m] of metricsMap) {
      if (m.view_count >= 3 && m.avg_completion >= completionP85 && m.avg_watch_duration >= watchDurationP85) {
        m.is_top_performer = true;
        topPerformerCount++;
      }
    }
    console.log(`[feed] Top performers: ${topPerformerCount} (completion≥${Math.round(completionP85)}%, watch≥${Math.round(watchDurationP85)}s)`);

    // View history for "seen" penalty
    let viewedVideoIds = new Set<string>();
    if (userId) {
      const { data: recentViews } = await supabaseClient
        .from("video_views").select("video_id")
        .eq("user_id", userId).gte("viewed_at", sevenDaysAgo.toISOString());
      viewedVideoIds = new Set(recentViews?.map(v => v.video_id) || []);
    } else if (viewerId) {
      const { data: recentViews } = await supabaseClient
        .from("video_views").select("video_id")
        .eq("viewer_id", viewerId).gte("viewed_at", sevenDaysAgo.toISOString());
      viewedVideoIds = new Set(recentViews?.map(v => v.video_id) || []);
    }

    // Normalization maxes
    const maxLikes = Math.max(...eligibleVideos.map((v: any) => v.likes_count), 1);
    const maxViews = Math.max(...eligibleVideos.map((v: any) => v.views_count), 1);
    const maxShares = Math.max(...Array.from(metricsMap.values()).map(m => m.share_count), 1);

    // === CATEGORY PERFORMANCE (Goal #6) ===
    const categoryPerformance = new Map<string, { totalCompletion: number, totalWatchTime: number, count: number }>();
    for (const video of eligibleVideos) {
      const metrics = metricsMap.get(video.id);
      if (!metrics || metrics.avg_watch_duration < 0 || metrics.view_count < 2) continue;
      for (const tag of (video.tags || [])) {
        const tagLower = tag.toLowerCase();
        const perf = categoryPerformance.get(tagLower) || { totalCompletion: 0, totalWatchTime: 0, count: 0 };
        perf.totalWatchTime += metrics.avg_watch_duration;
        perf.totalCompletion += metrics.avg_completion >= 0 ? metrics.avg_completion : 0;
        perf.count++;
        categoryPerformance.set(tagLower, perf);
      }
    }
    const categoryScore = new Map<string, number>();
    for (const [cat, perf] of categoryPerformance) {
      if (perf.count >= 2) {
        // Combined score: avg watch time + avg completion (normalized)
        const avgWT = perf.totalWatchTime / perf.count;
        const avgComp = perf.totalCompletion / perf.count;
        categoryScore.set(cat, avgWT * 0.6 + avgComp * 0.4 / 10); // weight watch time more
      }
    }
    const maxCatScore = Math.max(...Array.from(categoryScore.values()), 1);

    // === SCORING FUNCTION ===
    const scoreVideo = (video: any, affinityScore: number = 0): { score: number; breakdown: any } => {
      const metrics = metricsMap.get(video.id);
      const videoDuration = video.duration_seconds || 0;

      const normalizedLikes = video.likes_count / maxLikes;
      const normalizedViews = video.views_count / maxViews;

      // Recency
      const ageInDays = (Date.now() - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageInDays / 10); // slower decay (10 day half-life)

      // === COMPLETION SCORE (Goal #3: relative to video length) ===
      let completionScore = 0.5;
      if (metrics && metrics.avg_completion >= 0) {
        completionScore = Math.min(metrics.avg_completion / 100, 1);
        // Strong exponential bonus for high completion
        if (metrics.avg_completion > 60) {
          completionScore = Math.pow(completionScore, 0.7); // amplify high values
        }
      }

      // === WATCH TIME SCORE (Goal #3: relative to video length) ===
      let watchTimeScore = 0.5;
      if (metrics && metrics.avg_watch_duration >= 0) {
        if (videoDuration > 0) {
          // Normalize relative to video duration — a 7s video watched 6s = great
          const relativeWatch = metrics.avg_watch_duration / videoDuration;
          watchTimeScore = Math.min(relativeWatch, 1.5); // allow >1 for loops
        } else {
          // Fallback: absolute, but cap at 20s
          watchTimeScore = Math.min(metrics.avg_watch_duration / 20, 1);
        }
        // Bonus for 12s+ absolute watch time
        if (metrics.avg_watch_duration >= 12) {
          watchTimeScore = Math.min(watchTimeScore * 1.15, 1.8);
        }
      }

      // === HOOK QUALITY (Goal #4: how many users watch past first 2s) ===
      let hookScore = 0.5;
      if (metrics && metrics.hook_rate >= 0) {
        hookScore = metrics.hook_rate; // 0-1, direct mapping
        // Strong amplification: >80% hook rate = outstanding
        if (hookScore > 0.8) {
          hookScore = Math.min(hookScore * 1.3, 1.5);
        }
      }

      // Shares
      let sharesScore = 0;
      if (metrics && metrics.view_count > 0) {
        sharesScore = Math.min((metrics.share_count / metrics.view_count) * 10, 1);
      } else if (metrics && metrics.share_count > 0) {
        sharesScore = metrics.share_count / maxShares;
      }

      // === TOP PERFORMER BOOST (Goal #1: concentrate impressions on winners) ===
      let topPerformerBoost = 0;
      if (metrics?.is_top_performer) {
        topPerformerBoost = 0.25; // massive bonus for top 15%
      }

      // === EARLY SKIP PENALTY (Goal #4/#5: stronger) ===
      let earlySkipPenalty = 0;
      if (metrics && metrics.early_skip_rate > 0 && metrics.view_count >= 3) {
        if (metrics.early_skip_rate > 0.6) {
          earlySkipPenalty = -0.6; // near-death penalty
        } else if (metrics.early_skip_rate > 0.4) {
          earlySkipPenalty = -0.4;
        } else if (metrics.early_skip_rate > 0.25) {
          earlySkipPenalty = -0.2;
        } else if (metrics.early_skip_rate > 0.1) {
          earlySkipPenalty = -0.08;
        }
      }

      // === LOW QUALITY FILTER (Goal #5: stronger) ===
      let lowQualityPenalty = 0;
      if (metrics && metrics.view_count >= 5) {
        // Avg watch < 3s = almost remove from feed
        if (metrics.avg_watch_duration >= 0 && metrics.avg_watch_duration < 3) {
          lowQualityPenalty = -0.5;
        }
        // Very low completion (<15%) = strong penalty
        else if (metrics.avg_completion >= 0 && metrics.avg_completion < 15) {
          lowQualityPenalty = -0.35;
        }
        // Low completion (<25%) = moderate penalty
        else if (metrics.avg_completion >= 0 && metrics.avg_completion < 25) {
          lowQualityPenalty = -0.15;
        }
      }
      // With 10+ views and still bad = even stronger
      if (metrics && metrics.view_count >= 10) {
        if (metrics.avg_watch_duration >= 0 && metrics.avg_watch_duration < 4) {
          lowQualityPenalty = Math.min(lowQualityPenalty, -0.6);
        }
      }

      // Loop boost (Goal #4: short videos that loop)
      let loopBoost = 0;
      if (videoDuration && videoDuration <= 15 && metrics && metrics.rewatch_signal > 0) {
        loopBoost = metrics.rewatch_signal * 0.12;
      }
      // Short video fairness: don't penalize short videos with good completion
      if (videoDuration && videoDuration <= 10 && completionScore > 0.6) {
        loopBoost += 0.05; // small fairness boost
      }

      // Category performance boost (Goal #6: increased weight)
      let categoryBoost = 0;
      if (video.tags) {
        for (const tag of video.tags) {
          const cs = categoryScore.get(tag.toLowerCase());
          if (cs) {
            categoryBoost += (cs / maxCatScore) * 0.08;
          }
        }
        categoryBoost = Math.min(categoryBoost, 0.2);
      }

      // Session adaptation (Goal #7: faster, stronger)
      let sessionBoost = 0;
      if (video.tags && (sessionCategoryBoost.size > 0 || sessionSkippedCategories.size > 0)) {
        for (const tag of video.tags) {
          const tagLower = tag.toLowerCase();
          const boost = sessionCategoryBoost.get(tagLower);
          if (boost) {
            sessionBoost += Math.min(boost / 30, 0.15); // faster ramp: 30s = max (was 60)
          }
          const skipCount = sessionSkippedCategories.get(tagLower);
          if (skipCount) {
            sessionBoost -= 0.12 * skipCount; // stronger skip penalty
          }
        }
        sessionBoost = Math.max(-0.4, Math.min(sessionBoost, 0.3));
      }

      // Exploration (Goal: minimal randomness)
      const videoRng = seededRandom(`${seed}-${video.id}`);
      const explorationFactor = videoRng() * 0.05; // very low: 0-5%

      // Quality bonus
      const qualityBonus = video.cloudinary_public_id ? 0.02 : 0;

      // === VIEWED PENALTY (Goal #2: reduce for top performers) ===
      let viewedPenalty = 0;
      if (viewedVideoIds.has(video.id)) {
        if (metrics?.is_top_performer) {
          viewedPenalty = -0.3; // mild penalty — allow re-showing winners
        } else if (metrics && metrics.avg_completion >= 0 && metrics.avg_completion > 50) {
          viewedPenalty = -0.7; // moderate — decent videos still get suppressed
        } else {
          viewedPenalty = -1.8; // heavy — seen low performers almost never return
        }
      }

      // === WEIGHT DISTRIBUTION v2 (retention-maximized) ===
      // Completion:  28% — primary retention signal
      // Watch time:  22% — engagement depth
      // Hook:        15% — first impression quality (NEW)
      // Affinity:    10% — personalization
      // Likes:        8% — social proof
      // Shares:       6% — viral signal
      // Recency:      6% — freshness
      // Views:        2% — popularity
      // Remaining ~3%: quality/exploration

      const wCompletion  = 0.28 * completionScore;
      const wWatchTime   = 0.22 * watchTimeScore;
      const wHook        = 0.15 * hookScore;
      const wAffinity    = 0.10 * Math.min(affinityScore, 1);
      const wLikes       = 0.08 * normalizedLikes;
      const wShares      = 0.06 * sharesScore;
      const wRecency     = 0.06 * recencyScore;
      const wViews       = 0.02 * normalizedViews;

      const score =
        wCompletion +
        wWatchTime +
        wHook +
        wAffinity +
        wLikes +
        wShares +
        wRecency +
        wViews +
        explorationFactor +
        qualityBonus +
        topPerformerBoost +
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
          hookScore: wHook,
          affinityScore: wAffinity,
          likesScore: wLikes,
          sharesScore: wShares,
          recencyScore: wRecency,
          viewsScore: wViews,
          explorationFactor,
          qualityBonus,
          topPerformerBoost,
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
        supabaseClient.from("likes").select("video_id, videos(user_id, tags)").eq("user_id", userId),
        supabaseClient.from("user_category_preferences")
          .select("category, interaction_score").eq("user_id", userId)
          .order("interaction_score", { ascending: false }).limit(10)
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
            const catS = preferredCategories.get(tag.toLowerCase());
            if (catS) affinity += Math.min(catS / 100, 0.25);
            if (likedTags.has(tag)) affinity += 0.1;
          }
        }
        const { score, breakdown } = scoreVideo(video, affinity);
        return { ...video, score, breakdown, isViewed: viewedVideoIds.has(video.id) };
      });
    }

    // === HARD FILTER: remove truly dead content (Goal #5) ===
    const filteredVideos = scoredVideos.filter(v => {
      const m = metricsMap.get(v.id);
      if (!m || m.view_count < 10) return true; // not enough data, keep
      // Remove if avg watch <2.5s AND skip rate >50% AND completion <12%
      if (m.avg_watch_duration >= 0 && m.avg_watch_duration < 2.5 &&
          m.early_skip_rate > 0.5 &&
          m.avg_completion >= 0 && m.avg_completion < 12) {
        console.log(`[feed] Filtered out dead video: ${v.id}`);
        return false;
      }
      return true;
    });

    // Separate unviewed and viewed
    // BUT: top performers that are viewed go into a special "re-show" pool (Goal #2)
    const unviewedVideos = filteredVideos.filter(v => !v.isViewed);
    const viewedTopPerformers = filteredVideos.filter(v => v.isViewed && metricsMap.get(v.id)?.is_top_performer);
    const viewedRegular = filteredVideos.filter(v => v.isViewed && !metricsMap.get(v.id)?.is_top_performer);

    console.log(`[feed] Unviewed: ${unviewedVideos.length}, Viewed top: ${viewedTopPerformers.length}, Viewed regular: ${viewedRegular.length}`);

    // Sort all pools by score
    const sortedUnviewed = unviewedVideos.sort((a, b) => b.score - a.score);
    const sortedViewedTop = viewedTopPerformers.sort((a, b) => b.score - a.score);
    const sortedViewedRegular = viewedRegular.sort((a, b) => b.score - a.score);

    // === BUILD FINAL FEED ===
    const isFirstPage = !cursor;
    const topSlotCount = isFirstPage ? 5 : 0;

    // First page: top 5 strictly by score, then small tier shuffle
    let finalUnviewed: typeof sortedUnviewed;
    if (isFirstPage && sortedUnviewed.length > topSlotCount) {
      const topSlot = sortedUnviewed.slice(0, topSlotCount);
      const rest = sortedUnviewed.slice(topSlotCount);
      const shuffledRest: typeof rest = [];
      const tierSize = 3;
      for (let i = 0; i < rest.length; i += tierSize) {
        const tier = rest.slice(i, i + tierSize);
        shuffledRest.push(...shuffleArraySeeded(tier, rng));
      }
      finalUnviewed = [...topSlot, ...shuffledRest];
    } else {
      const shuffled: typeof sortedUnviewed = [];
      const tierSize = 3;
      for (let i = 0; i < sortedUnviewed.length; i += tierSize) {
        const tier = sortedUnviewed.slice(i, i + tierSize);
        shuffled.push(...shuffleArraySeeded(tier, rng));
      }
      finalUnviewed = shuffled;
    }

    // Interleave top performers back into feed (Goal #2: viral loops)
    // Insert one top performer every ~8 videos
    let finalResult = applyDiversity(finalUnviewed, 4, 3);

    if (sortedViewedTop.length > 0) {
      const interleaved: any[] = [];
      let topIdx = 0;
      for (let i = 0; i < finalResult.length; i++) {
        interleaved.push(finalResult[i]);
        // Every 8th position, insert a top performer if available
        if ((i + 1) % 8 === 0 && topIdx < sortedViewedTop.length) {
          interleaved.push(sortedViewedTop[topIdx]);
          topIdx++;
        }
      }
      // Add remaining top performers
      while (topIdx < sortedViewedTop.length) {
        interleaved.push(sortedViewedTop[topIdx++]);
      }
      finalResult = interleaved;
    }

    // Add regular viewed videos at end
    const shuffledViewed = shuffleArraySeeded(sortedViewedRegular, rng);
    const diverseViewed = applyDiversity(shuffledViewed, 4, 3);
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

    const responseVideos = paginatedVideos.map(({ score, breakdown, isViewed, ...video }) => video);

    // Debug mode
    let debugInfo = null;
    if (algoDebug) {
      debugInfo = finalResult.slice(0, 15).map(v => ({
        videoId: v.id,
        title: v.title?.substring(0, 50),
        finalScore: Math.round(v.score * 1000) / 1000,
        isTopPerformer: metricsMap.get(v.id)?.is_top_performer || false,
        hookRate: metricsMap.get(v.id)?.hook_rate ?? -1,
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
