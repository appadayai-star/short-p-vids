import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify admin status
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to check admin status
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: adminRole, error: roleError } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !adminRole) {
      console.error("Role check error:", roleError);
      return new Response(JSON.stringify({ error: "Forbidden - Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const isLifetime = url.searchParams.get("lifetime") === "true";

    console.log(`Fetching stats ${isLifetime ? "lifetime" : `from ${startDate} to ${endDate}`}`);

    // Build date filters - EXCLUSIVE end for consistency (>= start AND < end)
    // This ensures adjacent date ranges don't double-count events
    const dateFilter = (query: any, dateCol: string) => {
      if (isLifetime) return query;
      return query.gte(dateCol, startDate).lt(dateCol, endDate);
    };

    // Get all-time totals for lifetime stats
    const [
      viewsResult,
      profilesResult, // Renamed from signupsResult - we count profiles, not auth.users
      likesResult,
      savesResult,
      uploadsResult,
      uniqueViewersResult,
      allViewsForSession,
      sharesResult,
      profileViewsResult,
      followsResult,
    ] = await Promise.all([
      dateFilter(serviceClient.from("video_views").select("id", { count: "exact", head: true }), "viewed_at"),
      dateFilter(serviceClient.from("profiles").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("likes").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("saved_videos").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("videos").select("id", { count: "exact", head: true }), "created_at"),
      // Unique viewers (distinct user_id + session_id combinations)
      dateFilter(serviceClient.from("video_views").select("user_id, session_id"), "viewed_at"),
      // All views for session, watch time, and repeat views calculations (includes video_id)
      dateFilter(serviceClient.from("video_views").select("user_id, session_id, video_id, viewed_at, watch_duration_seconds, video_duration_seconds, watch_completion_percent, time_to_first_frame_ms"), "viewed_at"),
      // Shares
      dateFilter(serviceClient.from("shares").select("id", { count: "exact", head: true }), "created_at"),
      // Profile views
      dateFilter(serviceClient.from("profile_views").select("id", { count: "exact", head: true }), "created_at"),
      // Follows
      dateFilter(serviceClient.from("follows").select("id", { count: "exact", head: true }), "created_at"),
    ]);

    // Calculate unique viewers (user_id or session_id)
    const uniqueViewerSet = new Set<string>();
    (uniqueViewersResult.data || []).forEach((v: any) => {
      const key = v.user_id || v.session_id || 'anonymous';
      uniqueViewerSet.add(key);
    });
    const uniqueViewers = uniqueViewerSet.size;

    // Calculate session-based metrics
    // Group views by session (user_id + session_id combo, or infer from 30-min gaps)
    const viewsBySession = new Map<string, { views: number; timestamps: number[]; durations: number[] }>();
    const sortedViews = (allViewsForSession.data || []).sort((a: any, b: any) => 
      new Date(a.viewed_at).getTime() - new Date(b.viewed_at).getTime()
    );
    
    let sessionCounter = 0;
    const userLastSession = new Map<string, { sessionKey: string; lastTimestamp: number }>();
    
    // Watch time metrics
    let totalWatchTimeSeconds = 0;
    let viewsWithWatchTime = 0;
    let completion25 = 0, completion50 = 0, completion75 = 0, completion95 = 0;
    const ttffValues: number[] = [];
    
    sortedViews.forEach((v: any) => {
      const userId = v.user_id || v.session_id || 'anon_' + sessionCounter++;
      const timestamp = new Date(v.viewed_at).getTime();
      const duration = v.watch_duration_seconds || 0;
      
      // Track watch time
      if (duration > 0) {
        totalWatchTimeSeconds += duration;
        viewsWithWatchTime++;
      }
      
      // Track completion buckets
      const completionPercent = v.watch_completion_percent || 0;
      if (completionPercent >= 25) completion25++;
      if (completionPercent >= 50) completion50++;
      if (completionPercent >= 75) completion75++;
      if (completionPercent >= 95) completion95++;
      
      // Track TTFF
      if (v.time_to_first_frame_ms && v.time_to_first_frame_ms > 0) {
        ttffValues.push(v.time_to_first_frame_ms);
      }
      
      // Check if this is a new session (30-min gap)
      const lastInfo = userLastSession.get(userId);
      let sessionKey: string;
      
      if (lastInfo && (timestamp - lastInfo.lastTimestamp) < 30 * 60 * 1000) {
        // Same session
        sessionKey = lastInfo.sessionKey;
      } else {
        // New session
        sessionKey = `${userId}_${sessionCounter++}`;
      }
      
      userLastSession.set(userId, { sessionKey, lastTimestamp: timestamp });
      
      if (!viewsBySession.has(sessionKey)) {
        viewsBySession.set(sessionKey, { views: 0, timestamps: [], durations: [] });
      }
      const session = viewsBySession.get(sessionKey)!;
      session.views++;
      session.timestamps.push(timestamp);
      session.durations.push(duration);
    });

    // Calculate TTFF metrics (median and p95)
    ttffValues.sort((a, b) => a - b);
    const medianTTFF = ttffValues.length > 0 
      ? ttffValues[Math.floor(ttffValues.length / 2)] 
      : 0;
    const p95TTFF = ttffValues.length > 0 
      ? ttffValues[Math.floor(ttffValues.length * 0.95)] 
      : 0;

    // Calculate averages and percentiles for session metrics
    const sessionCount = viewsBySession.size || 1;
    const sessionsArray = Array.from(viewsBySession.values());
    const videosPerSessionArray = sessionsArray.map(s => s.views).sort((a, b) => a - b);
    
    // Videos per session stats
    const totalVideosWatched = videosPerSessionArray.reduce((sum, v) => sum + v, 0);
    const avgVideosPerSession = totalVideosWatched / sessionCount;
    
    // Median videos per session
    const medianVideosPerSession = videosPerSessionArray.length > 0 
      ? videosPerSessionArray[Math.floor(videosPerSessionArray.length / 2)] 
      : 0;
    
    // P90 videos per session
    const p90VideosPerSession = videosPerSessionArray.length > 0 
      ? videosPerSessionArray[Math.floor(videosPerSessionArray.length * 0.90)] 
      : 0;
    
    // Note: "Scroll Depth" was removed as it's redundant with "Videos per Session"
    // If true scroll depth tracking is needed, add a video_impressions event

    // Average Session Duration calculation method:
    // HYBRID APPROACH: (last_view_timestamp - first_view_timestamp) + avg_watch_duration_of_last_video
    // - For multi-view sessions: timestamp span + estimated time for last video
    // - For single-view sessions: just the watch_duration_seconds of that view
    // This provides a more accurate estimate than pure timestamps (which would undercount)
    // or pure watch time sum (which would miss navigation/scroll time between videos)
    let totalSessionDuration = 0;
    sessionsArray.forEach((session) => {
      if (session.timestamps.length > 1) {
        const duration = Math.max(...session.timestamps) - Math.min(...session.timestamps);
        const avgDuration = session.durations.reduce((a, b) => a + b, 0) / session.durations.length;
        totalSessionDuration += duration + (avgDuration * 1000);
      } else if (session.durations[0]) {
        totalSessionDuration += session.durations[0] * 1000;
      }
    });
    const avgSessionDurationMs = sessionCount > 0 ? totalSessionDuration / sessionCount : 0;
    const avgSessionDurationMinutes = Math.floor(avgSessionDurationMs / 60000);
    const avgSessionDurationSeconds = Math.floor((avgSessionDurationMs % 60000) / 1000);

    // Watch time metrics
    const avgWatchTimeSeconds = viewsWithWatchTime > 0 
      ? Math.round(totalWatchTimeSeconds / viewsWithWatchTime) 
      : 0;
    const totalViews = viewsResult.count || 1;

    // Engagement metrics
    const totalLikes = likesResult.count || 0;
    const totalSaves = savesResult.count || 0;
    const engagementRate = ((totalLikes + totalSaves) / totalViews) * 100;
    const likeRate = (totalLikes / totalViews) * 100;
    const saveRate = (totalSaves / totalViews) * 100;

    // Scroll continuation rate (views > 1 per session / total sessions)
    const sessionsWithMultipleViews = sessionsArray.filter(s => s.views > 1).length;
    const scrollContinuationRate = (sessionsWithMultipleViews / sessionCount) * 100;

    // Return rate calculations
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get users who viewed before the period and returned
    const { data: returningUsers24h } = await serviceClient
      .from("video_views")
      .select("user_id, session_id, viewed_at")
      .gte("viewed_at", oneDayAgo.toISOString())
      .lte("viewed_at", now.toISOString());

    const { data: previousUsers24h } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .lt("viewed_at", oneDayAgo.toISOString())
      .gte("viewed_at", new Date(oneDayAgo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const previousUserSet24h = new Set((previousUsers24h || []).map((u: any) => u.user_id || u.session_id).filter(Boolean));
    const returningUserSet24h = new Set((returningUsers24h || []).map((u: any) => u.user_id || u.session_id).filter(Boolean));
    const returnedCount24h = Array.from(returningUserSet24h).filter(u => previousUserSet24h.has(u)).length;
    const returnRate24h = previousUserSet24h.size > 0 ? (returnedCount24h / previousUserSet24h.size) * 100 : 0;

    // 7-day return rate
    const { data: returningUsers7d } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .gte("viewed_at", sevenDaysAgo.toISOString())
      .lte("viewed_at", now.toISOString());

    const { data: previousUsers7d } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .lt("viewed_at", sevenDaysAgo.toISOString())
      .gte("viewed_at", thirtyDaysAgo.toISOString());

    const previousUserSet7d = new Set((previousUsers7d || []).map((u: any) => u.user_id || u.session_id).filter(Boolean));
    const returningUserSet7d = new Set((returningUsers7d || []).map((u: any) => u.user_id || u.session_id).filter(Boolean));
    const returnedCount7d = Array.from(returningUserSet7d).filter(u => previousUserSet7d.has(u)).length;
    const returnRate7d = previousUserSet7d.size > 0 ? (returnedCount7d / previousUserSet7d.size) * 100 : 0;

    // DAU / MAU
    const { data: dauData } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .gte("viewed_at", oneDayAgo.toISOString());
    const dauSet = new Set((dauData || []).map((u: any) => u.user_id || u.session_id).filter(Boolean));
    const dau = dauSet.size;

    const { data: mauData } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .gte("viewed_at", thirtyDaysAgo.toISOString());
    const mauSet = new Set((mauData || []).map((u: any) => u.user_id || u.session_id).filter(Boolean));
    const mau = mauSet.size;

    const dauMauRatio = mau > 0 ? (dau / mau) * 100 : 0;

    // REPEAT VIEWS (renamed from "Repeat Exposure" for accuracy)
    // IMPORTANT: This measures VIEWS (scroll-away/unmount events), NOT impressions (when video becomes visible)
    // Definition:
    // - 7-Day Repeat Rate: % of views where user already viewed that video in last 7 days
    // - Per-Session Repeat Rate: % of views where same video was viewed multiple times in same session
    // To measure true "impressions", add a video_impressions table with events fired on video becoming active
    
    const userVideoViewsMap = new Map<string, Map<string, { count: number; firstSeen: number }>>();
    let repeatViewsTotal = 0;
    let repeatViewsCount = 0;
    let perSessionRepeatCount = 0;
    
    const sessionVideoViewsMap = new Map<string, Set<string>>();
    
    sortedViews.forEach((v: any) => {
      const odId = v.user_id || v.session_id || 'anonymous';
      const videoId = v.video_id;
      const timestamp = new Date(v.viewed_at).getTime();
      const sessionKey = userLastSession.get(odId)?.sessionKey || odId;
      
      if (!videoId) return;
      
      repeatViewsTotal++;
      
      // Check for 7-day repeat view
      if (!userVideoViewsMap.has(odId)) {
        userVideoViewsMap.set(odId, new Map());
      }
      const userVideos = userVideoViewsMap.get(odId)!;
      
      if (userVideos.has(videoId)) {
        const firstSeen = userVideos.get(videoId)!.firstSeen;
        if (timestamp - firstSeen < 7 * 24 * 60 * 60 * 1000) {
          repeatViewsCount++;
        }
        userVideos.get(videoId)!.count++;
      } else {
        userVideos.set(videoId, { count: 1, firstSeen: timestamp });
      }
      
      // Check for per-session repeat
      if (!sessionVideoViewsMap.has(sessionKey)) {
        sessionVideoViewsMap.set(sessionKey, new Set());
      }
      const sessionVideos = sessionVideoViewsMap.get(sessionKey)!;
      if (sessionVideos.has(videoId)) {
        perSessionRepeatCount++;
      } else {
        sessionVideos.add(videoId);
      }
    });
    
    const repeatViewRate7d = repeatViewsTotal > 0 ? (repeatViewsCount / repeatViewsTotal) * 100 : 0;
    const perSessionRepeatRate = repeatViewsTotal > 0 ? (perSessionRepeatCount / repeatViewsTotal) * 100 : 0;

    // Active creators (uploaded in last 7 days)
    const { count: activeCreators } = await serviceClient
      .from("videos")
      .select("user_id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo.toISOString());

    // Get comparison period stats for trends
    let trendData = null;
    if (!isLifetime && startDate && endDate) {
      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      const periodMs = endMs - startMs;
      const prevStartDate = new Date(startMs - periodMs).toISOString();
      const prevEndDate = new Date(startMs).toISOString();

      const [prevViews, prevLikes, prevSaves, prevSignups, prevUploads, prevShares] = await Promise.all([
        serviceClient.from("video_views").select("id", { count: "exact", head: true })
          .gte("viewed_at", prevStartDate).lt("viewed_at", prevEndDate),
        serviceClient.from("likes").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lt("created_at", prevEndDate),
        serviceClient.from("saved_videos").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lt("created_at", prevEndDate),
        serviceClient.from("profiles").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lt("created_at", prevEndDate),
        serviceClient.from("videos").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lt("created_at", prevEndDate),
        serviceClient.from("shares").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lt("created_at", prevEndDate),
      ]);

      const calcTrend = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
      };

      trendData = {
        views: calcTrend(viewsResult.count || 0, prevViews.count || 0),
        likes: calcTrend(likesResult.count || 0, prevLikes.count || 0),
        saves: calcTrend(savesResult.count || 0, prevSaves.count || 0),
        profilesCreated: calcTrend(profilesResult.count || 0, prevSignups.count || 0),
        uploads: calcTrend(uploadsResult.count || 0, prevUploads.count || 0),
        shares: calcTrend(sharesResult.count || 0, prevShares.count || 0),
      };
    }

    // Build daily array (skip for lifetime)
    const daily: { date: string; views: number; profilesCreated: number; likes: number; saves: number; uploads: number; shares: number }[] = [];
    
    if (!isLifetime && startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days: string[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split("T")[0]);
      }

      const dailyPromises = days.map(async (dateStr) => {
        const dayStart = `${dateStr}T00:00:00.000Z`;
        // Use exclusive end: next day at 00:00:00
        const nextDay = new Date(dateStr);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const dayEnd = nextDay.toISOString();

        const [views, profiles, likes, saves, uploads, shares] = await Promise.all([
          serviceClient.from("video_views").select("id", { count: "exact", head: true })
            .gte("viewed_at", dayStart).lt("viewed_at", dayEnd),
          serviceClient.from("profiles").select("id", { count: "exact", head: true })
            .gte("created_at", dayStart).lt("created_at", dayEnd),
          serviceClient.from("likes").select("id", { count: "exact", head: true })
            .gte("created_at", dayStart).lt("created_at", dayEnd),
          serviceClient.from("saved_videos").select("id", { count: "exact", head: true })
            .gte("created_at", dayStart).lt("created_at", dayEnd),
          serviceClient.from("videos").select("id", { count: "exact", head: true })
            .gte("created_at", dayStart).lt("created_at", dayEnd),
          serviceClient.from("shares").select("id", { count: "exact", head: true })
            .gte("created_at", dayStart).lt("created_at", dayEnd),
        ]);

        return {
          date: dateStr,
          views: views.count || 0,
          profilesCreated: profiles.count || 0,
          likes: likes.count || 0,
          saves: saves.count || 0,
          uploads: uploads.count || 0,
          shares: shares.count || 0,
        };
      });

      const dailyResults = await Promise.all(dailyPromises);
      daily.push(...dailyResults);
    }

    // Format watch time
    const formatWatchTime = (seconds: number) => {
      if (seconds >= 3600) {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
      } else if (seconds >= 60) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
      }
      return `${seconds}s`;
    };

    const stats = {
      // Core usage
      views: viewsResult.count || 0,
      uniqueViewers,
      // Session behavior
      videosPerSession: {
        avg: Math.round(avgVideosPerSession * 10) / 10,
        median: medianVideosPerSession,
        p90: p90VideosPerSession,
      },
      // Note: scrollDepth removed - use videosPerSession instead (same metric)
      avgSessionDuration: `${avgSessionDurationMinutes}m ${avgSessionDurationSeconds}s`,
      avgSessionDurationMs,
      
      // Watch time metrics (NEW)
      totalWatchTimeSeconds,
      totalWatchTimeFormatted: formatWatchTime(totalWatchTimeSeconds),
      avgWatchTimeSeconds,
      avgWatchTimeFormatted: formatWatchTime(avgWatchTimeSeconds),
      watchCompletion: {
        views25: completion25,
        views50: completion50,
        views75: completion75,
        views95: completion95,
        rate25: totalViews > 0 ? Math.round((completion25 / totalViews) * 10000) / 100 : 0,
        rate50: totalViews > 0 ? Math.round((completion50 / totalViews) * 10000) / 100 : 0,
        rate75: totalViews > 0 ? Math.round((completion75 / totalViews) * 10000) / 100 : 0,
        rate95: totalViews > 0 ? Math.round((completion95 / totalViews) * 10000) / 100 : 0,
      },
      
      // Playback performance (NEW)
      ttff: {
        median: medianTTFF,
        p95: p95TTFF,
        sampleSize: ttffValues.length,
      },
      
      // Engagement
      engagementRate: Math.round(engagementRate * 100) / 100,
      likeRate: Math.round(likeRate * 100) / 100,
      saveRate: Math.round(saveRate * 100) / 100,
      likes: likesResult.count || 0,
      saves: savesResult.count || 0,
      shares: sharesResult.count || 0,
      profileViews: profileViewsResult.count || 0,
      follows: followsResult.count || 0,
      
      // Retention
      scrollContinuationRate: Math.round(scrollContinuationRate * 100) / 100,
      returnRate24h: Math.round(returnRate24h * 100) / 100,
      returnRate7d: Math.round(returnRate7d * 100) / 100,
      
      // Repeat Views (measures views, not impressions - see comment in code)
      repeatViews: {
        rate7d: Math.round(repeatViewRate7d * 100) / 100,
        perSessionRate: Math.round(perSessionRepeatRate * 100) / 100,
        totalViews: repeatViewsTotal,
        repeatCount: repeatViewsCount,
        perSessionRepeatCount,
      },
      
      // Growth
      profilesCreated: profilesResult.count || 0,
      dau,
      mau,
      dauMauRatio: Math.round(dauMauRatio * 100) / 100,
      
      // Creator supply
      uploads: uploadsResult.count || 0,
      activeCreators: activeCreators || 0,
      
      // Trends
      trends: trendData,
      
      // Daily breakdown
      daily,
    };

    console.log("Stats:", { ...stats, daily: `${daily.length} days` });

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
