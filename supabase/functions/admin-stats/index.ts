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
    const dateFilter = (query: any, dateCol: string) => {
      if (isLifetime) return query;
      return query.gte(dateCol, startDate).lt(dateCol, endDate);
    };

    // Fetch all data in parallel
    const [
      viewsResult,
      profilesResult,
      likesResult,
      savesResult,
      uploadsResult,
      allViewsForAnalysis,
      sharesResult,
      profileViewsResult,
      followsResult,
    ] = await Promise.all([
      dateFilter(serviceClient.from("video_views").select("id", { count: "exact", head: true }), "viewed_at"),
      dateFilter(serviceClient.from("profiles").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("likes").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("saved_videos").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("videos").select("id", { count: "exact", head: true }), "created_at"),
      // All views for detailed analysis - high limit to get all data
      dateFilter(serviceClient.from("video_views").select("user_id, session_id, video_id, viewed_at, watch_duration_seconds, video_duration_seconds, watch_completion_percent, time_to_first_frame_ms"), "viewed_at").limit(100000),
      dateFilter(serviceClient.from("shares").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("profile_views").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("follows").select("id", { count: "exact", head: true }), "created_at"),
    ]);
    
    const allViews = allViewsForAnalysis.data || [];
    console.log(`Fetched ${allViews.length} views for analysis`);

    // === CORE METRICS ===
    // Unique Viewers = COUNT(DISTINCT user_id) - now always filled with auth.user.id OR anonymous_id
    const uniqueViewerSet = new Set<string>();
    allViews.forEach((v: any) => {
      if (v.user_id) uniqueViewerSet.add(v.user_id);
    });
    const uniqueViewers = uniqueViewerSet.size;

    // Sessions = COUNT(DISTINCT session_id) - now always filled
    const uniqueSessionSet = new Set<string>();
    allViews.forEach((v: any) => {
      if (v.session_id) uniqueSessionSet.add(v.session_id);
    });
    const totalSessions = uniqueSessionSet.size;

    // Sort views by timestamp for session analysis
    const sortedViews = [...allViews].sort((a: any, b: any) => 
      new Date(a.viewed_at).getTime() - new Date(b.viewed_at).getTime()
    );

    // === WATCH TIME METRICS ===
    let totalWatchTimeSeconds = 0;
    let viewsWithWatchDuration = 0;
    let viewsWithZeroWatchDuration = 0;
    let viewsWithNullWatchDuration = 0;
    let viewsWithViewerId = 0;
    let viewsWithoutViewerId = 0;
    let viewsWithSessionId = 0;
    let viewsWithoutSessionId = 0;
    
    // Completion buckets
    let completion25 = 0, completion50 = 0, completion75 = 0, completion95 = 0;
    const ttffValues: number[] = [];

    // Session-based grouping
    const viewsBySession = new Map<string, { views: number; durations: number[] }>();

    sortedViews.forEach((v: any) => {
      const duration = v.watch_duration_seconds;
      
      // Track data quality
      if (v.user_id) {
        viewsWithViewerId++;
      } else {
        viewsWithoutViewerId++;
      }
      
      if (v.session_id) {
        viewsWithSessionId++;
        // Group by session
        if (!viewsBySession.has(v.session_id)) {
          viewsBySession.set(v.session_id, { views: 0, durations: [] });
        }
        const session = viewsBySession.get(v.session_id)!;
        session.views++;
        session.durations.push(duration || 0);
      } else {
        viewsWithoutSessionId++;
      }
      
      // Watch duration tracking
      if (duration === null || duration === undefined) {
        viewsWithNullWatchDuration++;
      } else if (duration === 0) {
        viewsWithZeroWatchDuration++;
      } else if (duration > 0) {
        totalWatchTimeSeconds += duration;
        viewsWithWatchDuration++;
      }
      
      // Completion buckets
      const completionPercent = v.watch_completion_percent || 0;
      if (completionPercent >= 25) completion25++;
      if (completionPercent >= 50) completion50++;
      if (completionPercent >= 75) completion75++;
      if (completionPercent >= 95) completion95++;
      
      // TTFF tracking
      if (v.time_to_first_frame_ms && v.time_to_first_frame_ms > 0) {
        ttffValues.push(v.time_to_first_frame_ms);
      }
    });

    // === CALCULATED METRICS ===
    const totalViews = viewsResult.count || 1;
    
    // Avg watch time per view (only views with duration > 0)
    const avgWatchTimePerView = viewsWithWatchDuration > 0 
      ? Math.round(totalWatchTimeSeconds / viewsWithWatchDuration) 
      : 0;
    
    // Avg watch time per session = SUM(watch_duration) / COUNT(DISTINCT session_id)
    const avgWatchTimePerSession = totalSessions > 0 
      ? Math.round(totalWatchTimeSeconds / totalSessions) 
      : 0;

    // Videos per session stats
    const sessionsArray = Array.from(viewsBySession.values());
    const videosPerSessionArray = sessionsArray.map(s => s.views).sort((a, b) => a - b);
    const totalVideosWatched = videosPerSessionArray.reduce((sum, v) => sum + v, 0);
    const avgVideosPerSession = totalSessions > 0 ? totalVideosWatched / totalSessions : 0;
    const medianVideosPerSession = videosPerSessionArray.length > 0 
      ? videosPerSessionArray[Math.floor(videosPerSessionArray.length / 2)] 
      : 0;
    const p90VideosPerSession = videosPerSessionArray.length > 0 
      ? videosPerSessionArray[Math.floor(videosPerSessionArray.length * 0.90)] 
      : 0;

    // TTFF metrics
    ttffValues.sort((a, b) => a - b);
    const medianTTFF = ttffValues.length > 0 
      ? ttffValues[Math.floor(ttffValues.length / 2)] 
      : 0;
    const p95TTFF = ttffValues.length > 0 
      ? ttffValues[Math.floor(ttffValues.length * 0.95)] 
      : 0;

    // Engagement metrics
    const totalLikes = likesResult.count || 0;
    const totalSaves = savesResult.count || 0;
    const engagementRate = ((totalLikes + totalSaves) / totalViews) * 100;
    const likeRate = (totalLikes / totalViews) * 100;
    const saveRate = (totalSaves / totalViews) * 100;

    // Scroll continuation rate
    const sessionsWithMultipleViews = sessionsArray.filter(s => s.views > 1).length;
    const scrollContinuationRate = totalSessions > 0 ? (sessionsWithMultipleViews / totalSessions) * 100 : 0;

    // Return rate calculations
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 24h return rate
    const { data: returningUsers24h } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .gte("viewed_at", oneDayAgo.toISOString());

    const { data: previousUsers24h } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .lt("viewed_at", oneDayAgo.toISOString())
      .gte("viewed_at", new Date(oneDayAgo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const previousUserSet24h = new Set((previousUsers24h || []).map((u: any) => u.user_id).filter(Boolean));
    const returningUserSet24h = new Set((returningUsers24h || []).map((u: any) => u.user_id).filter(Boolean));
    const returnedCount24h = Array.from(returningUserSet24h).filter(u => previousUserSet24h.has(u)).length;
    const returnRate24h = previousUserSet24h.size > 0 ? (returnedCount24h / previousUserSet24h.size) * 100 : 0;

    // 7-day return rate
    const { data: returningUsers7d } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .gte("viewed_at", sevenDaysAgo.toISOString());

    const { data: previousUsers7d } = await serviceClient
      .from("video_views")
      .select("user_id, session_id")
      .lt("viewed_at", sevenDaysAgo.toISOString())
      .gte("viewed_at", thirtyDaysAgo.toISOString());

    const previousUserSet7d = new Set((previousUsers7d || []).map((u: any) => u.user_id).filter(Boolean));
    const returningUserSet7d = new Set((returningUsers7d || []).map((u: any) => u.user_id).filter(Boolean));
    const returnedCount7d = Array.from(returningUserSet7d).filter(u => previousUserSet7d.has(u)).length;
    const returnRate7d = previousUserSet7d.size > 0 ? (returnedCount7d / previousUserSet7d.size) * 100 : 0;

    // DAU / MAU
    const { data: dauData } = await serviceClient
      .from("video_views")
      .select("user_id")
      .gte("viewed_at", oneDayAgo.toISOString());
    const dauSet = new Set((dauData || []).map((u: any) => u.user_id).filter(Boolean));
    const dau = dauSet.size;

    const { data: mauData } = await serviceClient
      .from("video_views")
      .select("user_id")
      .gte("viewed_at", thirtyDaysAgo.toISOString());
    const mauSet = new Set((mauData || []).map((u: any) => u.user_id).filter(Boolean));
    const mau = mauSet.size;

    const dauMauRatio = mau > 0 ? (dau / mau) * 100 : 0;

    // Repeat views
    const userVideoViewsMap = new Map<string, Map<string, { count: number; firstSeen: number }>>();
    let repeatViewsTotal = 0;
    let repeatViewsCount = 0;
    let perSessionRepeatCount = 0;
    const sessionVideoViewsMap = new Map<string, Set<string>>();

    sortedViews.forEach((v: any) => {
      const odId = v.user_id || 'anonymous';
      const videoId = v.video_id;
      const timestamp = new Date(v.viewed_at).getTime();
      const sessionKey = v.session_id || odId;
      
      if (!videoId) return;
      
      repeatViewsTotal++;
      
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

    // Active creators
    const { data: creatorData } = await serviceClient
      .from("videos")
      .select("user_id")
      .gte("created_at", sevenDaysAgo.toISOString());
    const activeCreators = new Set((creatorData || []).map((v: any) => v.user_id)).size;

    // Signup health check
    const { count: profiles7d } = await serviceClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo.toISOString());

    const { data: authUsersData, error: authUsersError } = await serviceClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    
    const authUsers7d = authUsersError ? 0 : (authUsersData?.users || []).filter((u: any) => 
      new Date(u.created_at).getTime() >= sevenDaysAgo.getTime()
    ).length;
    
    const signupHealthDelta = authUsers7d - (profiles7d || 0);

    // Trends
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

    // Daily breakdown
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

    // Format helpers
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
      uniqueViewers, // COUNT(DISTINCT user_id) - now always filled
      totalSessions, // COUNT(DISTINCT session_id) - now always filled
      
      // Session behavior
      videosPerSession: {
        avg: Math.round(avgVideosPerSession * 10) / 10,
        median: medianVideosPerSession,
        p90: p90VideosPerSession,
      },
      
      // Watch time metrics
      totalWatchTimeSeconds,
      totalWatchTimeFormatted: formatWatchTime(totalWatchTimeSeconds),
      avgWatchTimePerView, // AVG(watch_duration WHERE > 0)
      avgWatchTimePerViewFormatted: formatWatchTime(avgWatchTimePerView),
      avgWatchTimePerSession, // SUM(watch_duration) / COUNT(DISTINCT session_id)
      avgWatchTimePerSessionFormatted: formatWatchTime(avgWatchTimePerSession),
      
      // Legacy compatibility (keep old field names)
      avgWatchTimeSeconds: avgWatchTimePerView,
      avgWatchTimeFormatted: formatWatchTime(avgWatchTimePerView),
      avgSessionWatchTime: formatWatchTime(avgWatchTimePerSession),
      avgSessionWatchTimeSeconds: avgWatchTimePerSession,
      
      // Completion buckets
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
      
      // Playback performance
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
      
      // Repeat views
      repeatViews: {
        rate7d: Math.round(repeatViewRate7d * 100) / 100,
        perSessionRate: Math.round(perSessionRepeatRate * 100) / 100,
        totalViews: repeatViewsTotal,
        repeatCount: repeatViewsCount,
        perSessionRepeatCount,
      },
      
      // Growth
      profilesCreated: profilesResult.count || 0,
      
      // Signup health
      signupHealth: {
        authUsers7d,
        profiles7d: profiles7d || 0,
        delta: signupHealthDelta,
        healthy: signupHealthDelta === 0,
      },
      
      dau,
      mau,
      dauMauRatio: Math.round(dauMauRatio * 100) / 100,
      
      // Creator supply
      uploads: uploadsResult.count || 0,
      activeCreators: activeCreators || 0,
      
      // DEBUG: Data quality counters
      dataQuality: {
        totalRows: allViews.length,
        // Viewer ID (user_id column) - should be 100% filled now
        withViewerId: viewsWithViewerId,
        withoutViewerId: viewsWithoutViewerId,
        viewerIdMissingPct: allViews.length > 0 ? Math.round((viewsWithoutViewerId / allViews.length) * 100) : 0,
        // Session ID - should be 100% filled now
        withSessionId: viewsWithSessionId,
        withoutSessionId: viewsWithoutSessionId,
        sessionIdMissingPct: allViews.length > 0 ? Math.round((viewsWithoutSessionId / allViews.length) * 100) : 0,
        // Watch duration
        withWatchDuration: viewsWithWatchDuration,
        withZeroWatchDuration: viewsWithZeroWatchDuration,
        withNullWatchDuration: viewsWithNullWatchDuration,
        watchDurationMissingPct: allViews.length > 0 ? Math.round(((viewsWithZeroWatchDuration + viewsWithNullWatchDuration) / allViews.length) * 100) : 0,
      },
      
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
