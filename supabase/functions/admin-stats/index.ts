import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Reliable tracking started after this date (when viewer_id + session_id became mandatory)
const RELIABLE_TRACKING_DATE = "2024-12-17";

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

    // Build date filters - INCLUSIVE end (>= start AND <= end)
    // We now use exact timestamps from frontend, so inclusive makes sense
    const dateFilter = (query: any, dateCol: string) => {
      if (isLifetime) return query;
      return query.gte(dateCol, startDate).lte(dateCol, endDate);
    };

    // Fetch all data in parallel
    const [
      viewsResult,
      profilesResult,
      likesResult,
      savesResult,
      uploadsResult,
      sharesResult,
      profileViewsResult,
      followsResult,
    ] = await Promise.all([
      dateFilter(serviceClient.from("video_views").select("id", { count: "exact", head: true }), "viewed_at"),
      dateFilter(serviceClient.from("profiles").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("likes").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("saved_videos").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("videos").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("shares").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("profile_views").select("id", { count: "exact", head: true }), "created_at"),
      dateFilter(serviceClient.from("follows").select("id", { count: "exact", head: true }), "created_at"),
    ]);

    // Fetch ALL views for detailed analysis using pagination to overcome Supabase's 1000 row limit
    const allViews: any[] = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const { data: pageData, error: pageError } = await dateFilter(
        serviceClient.from("video_views").select("user_id, viewer_id, session_id, video_id, viewed_at, watch_duration_seconds, video_duration_seconds, watch_completion_percent, time_to_first_frame_ms"),
        "viewed_at"
      ).order("viewed_at", { ascending: false }).range(offset, offset + pageSize - 1);
      
      if (pageError) {
        console.error("Error fetching views page:", pageError);
        break;
      }
      
      if (pageData && pageData.length > 0) {
        allViews.push(...pageData);
        offset += pageSize;
        // Stop if we got fewer rows than requested (last page) or if we've hit a reasonable limit
        hasMore = pageData.length === pageSize && allViews.length < 50000;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`Fetched ${allViews.length} views for analysis (paginated)`);

    // === DEBUG COUNTERS (all rows) ===
    let rowsMissingSessionId = 0;
    let rowsMissingViewerId = 0;
    let rowsWatchDurationNull = 0;
    let rowsWatchDurationZero = 0;
    let rowsWithWatchDuration = 0;
    
    allViews.forEach((v: any) => {
      if (!v.session_id) rowsMissingSessionId++;
      if (!v.viewer_id) rowsMissingViewerId++;
      
      const duration = v.watch_duration_seconds;
      if (duration === null || duration === undefined) {
        rowsWatchDurationNull++;
      } else if (duration === 0) {
        rowsWatchDurationZero++;
      } else if (duration > 0) {
        rowsWithWatchDuration++;
      }
    });

    // === FILTER TO RELIABLE ROWS ONLY ===
    // Only use rows with session_id for metrics (reliable tracking)
    const reliableViews = allViews.filter((v: any) => v.session_id);
    console.log(`Reliable views (with session_id): ${reliableViews.length} of ${allViews.length}`);

    // === CORE METRICS (using reliable rows only) ===
    // Unique Viewers = COUNT(DISTINCT viewer_id) from reliable rows
    const uniqueViewerSet = new Set<string>();
    reliableViews.forEach((v: any) => {
      if (v.viewer_id) uniqueViewerSet.add(v.viewer_id);
    });
    const uniqueViewers = uniqueViewerSet.size;

    // Sessions = COUNT(DISTINCT session_id)
    const uniqueSessionSet = new Set<string>();
    reliableViews.forEach((v: any) => {
      if (v.session_id) uniqueSessionSet.add(v.session_id);
    });
    const totalSessions = uniqueSessionSet.size;

    // Sort views by timestamp for session analysis
    const sortedViews = [...reliableViews].sort((a: any, b: any) => 
      new Date(a.viewed_at).getTime() - new Date(b.viewed_at).getTime()
    );

    // === WATCH TIME METRICS (reliable rows only) ===
    let totalWatchTimeSeconds = 0;
    let viewsWithWatchDuration = 0;
    
    // Completion buckets
    let completion25 = 0, completion50 = 0, completion75 = 0, completion95 = 0;
    const ttffValues: number[] = [];

    // Session-based grouping
    const viewsBySession = new Map<string, { views: number; durations: number[] }>();

    sortedViews.forEach((v: any) => {
      const duration = v.watch_duration_seconds || 0;
      
      // Group by session
      if (v.session_id) {
        if (!viewsBySession.has(v.session_id)) {
          viewsBySession.set(v.session_id, { views: 0, durations: [] });
        }
        const session = viewsBySession.get(v.session_id)!;
        session.views++;
        session.durations.push(duration);
      }
      
      // Watch duration tracking
      if (duration > 0) {
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
    const reliableViewCount = reliableViews.length || 1;
    
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

    // 24h return rate (use viewer_id for reliable tracking)
    const { data: returningUsers24h } = await serviceClient
      .from("video_views")
      .select("viewer_id")
      .not("viewer_id", "is", null)
      .gte("viewed_at", oneDayAgo.toISOString());

    const { data: previousUsers24h } = await serviceClient
      .from("video_views")
      .select("viewer_id")
      .not("viewer_id", "is", null)
      .lt("viewed_at", oneDayAgo.toISOString())
      .gte("viewed_at", new Date(oneDayAgo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const previousUserSet24h = new Set((previousUsers24h || []).map((u: any) => u.viewer_id).filter(Boolean));
    const returningUserSet24h = new Set((returningUsers24h || []).map((u: any) => u.viewer_id).filter(Boolean));
    const returnedCount24h = Array.from(returningUserSet24h).filter(u => previousUserSet24h.has(u)).length;
    const returnRate24h = previousUserSet24h.size > 0 ? (returnedCount24h / previousUserSet24h.size) * 100 : 0;

    // 7-day return rate
    const { data: returningUsers7d } = await serviceClient
      .from("video_views")
      .select("viewer_id")
      .not("viewer_id", "is", null)
      .gte("viewed_at", sevenDaysAgo.toISOString());

    const { data: previousUsers7d } = await serviceClient
      .from("video_views")
      .select("viewer_id")
      .not("viewer_id", "is", null)
      .lt("viewed_at", sevenDaysAgo.toISOString())
      .gte("viewed_at", thirtyDaysAgo.toISOString());

    const previousUserSet7d = new Set((previousUsers7d || []).map((u: any) => u.viewer_id).filter(Boolean));
    const returningUserSet7d = new Set((returningUsers7d || []).map((u: any) => u.viewer_id).filter(Boolean));
    const returnedCount7d = Array.from(returningUserSet7d).filter(u => previousUserSet7d.has(u)).length;
    const returnRate7d = previousUserSet7d.size > 0 ? (returnedCount7d / previousUserSet7d.size) * 100 : 0;

    // DAU / MAU (use viewer_id)
    const { data: dauData } = await serviceClient
      .from("video_views")
      .select("viewer_id")
      .not("viewer_id", "is", null)
      .gte("viewed_at", oneDayAgo.toISOString());
    const dauSet = new Set((dauData || []).map((u: any) => u.viewer_id).filter(Boolean));
    const dau = dauSet.size;

    const { data: mauData } = await serviceClient
      .from("video_views")
      .select("viewer_id")
      .not("viewer_id", "is", null)
      .gte("viewed_at", thirtyDaysAgo.toISOString());
    const mauSet = new Set((mauData || []).map((u: any) => u.viewer_id).filter(Boolean));
    const mau = mauSet.size;

    const dauMauRatio = mau > 0 ? (dau / mau) * 100 : 0;

    // Repeat views (using reliable rows only)
    const userVideoViewsMap = new Map<string, Map<string, { count: number; firstSeen: number }>>();
    let repeatViewsTotal = 0;
    let repeatViewsCount = 0;
    let perSessionRepeatCount = 0;
    const sessionVideoViewsMap = new Map<string, Set<string>>();

    sortedViews.forEach((v: any) => {
      const odId = v.viewer_id || 'anonymous';
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
          .gte("viewed_at", prevStartDate).lte("viewed_at", prevEndDate),
        serviceClient.from("likes").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lte("created_at", prevEndDate),
        serviceClient.from("saved_videos").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lte("created_at", prevEndDate),
        serviceClient.from("profiles").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lte("created_at", prevEndDate),
        serviceClient.from("videos").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lte("created_at", prevEndDate),
        serviceClient.from("shares").select("id", { count: "exact", head: true })
          .gte("created_at", prevStartDate).lte("created_at", prevEndDate),
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

    // Time-based breakdown (hourly for 24h, daily for longer periods)
    const daily: { date: string; views: number; profilesCreated: number; likes: number; saves: number; uploads: number; shares: number }[] = [];
    let isHourlyBreakdown = false;
    
    if (!isLifetime && startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const periodMs = end.getTime() - start.getTime();
      const periodHours = periodMs / (1000 * 60 * 60);
      
      // Use hourly breakdown for periods <= 48 hours
      if (periodHours <= 48) {
        isHourlyBreakdown = true;
        const hours: Date[] = [];
        for (let d = new Date(start); d < end; d.setHours(d.getHours() + 1)) {
          hours.push(new Date(d));
        }

        const hourlyPromises = hours.map(async (hourStart) => {
          const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
          const hourStartStr = hourStart.toISOString();
          const hourEndStr = hourEnd.toISOString();

          const [views, profiles, likes, saves, uploads, shares] = await Promise.all([
            serviceClient.from("video_views").select("id", { count: "exact", head: true })
              .gte("viewed_at", hourStartStr).lt("viewed_at", hourEndStr),
            serviceClient.from("profiles").select("id", { count: "exact", head: true })
              .gte("created_at", hourStartStr).lt("created_at", hourEndStr),
            serviceClient.from("likes").select("id", { count: "exact", head: true })
              .gte("created_at", hourStartStr).lt("created_at", hourEndStr),
            serviceClient.from("saved_videos").select("id", { count: "exact", head: true })
              .gte("created_at", hourStartStr).lt("created_at", hourEndStr),
            serviceClient.from("videos").select("id", { count: "exact", head: true })
              .gte("created_at", hourStartStr).lt("created_at", hourEndStr),
            serviceClient.from("shares").select("id", { count: "exact", head: true })
              .gte("created_at", hourStartStr).lt("created_at", hourEndStr),
          ]);

          return {
            date: hourStartStr, // Full ISO string for hourly data
            views: views.count || 0,
            profilesCreated: profiles.count || 0,
            likes: likes.count || 0,
            saves: saves.count || 0,
            uploads: uploads.count || 0,
            shares: shares.count || 0,
          };
        });

        const hourlyResults = await Promise.all(hourlyPromises);
        daily.push(...hourlyResults);
      } else {
        // Daily breakdown for periods > 48 hours
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
      uniqueViewers, // COUNT(DISTINCT viewer_id) from reliable rows
      totalSessions, // COUNT(DISTINCT session_id)
      
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
      
      // Legacy compatibility
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
        rate25: reliableViewCount > 0 ? Math.round((completion25 / reliableViewCount) * 10000) / 100 : 0,
        rate50: reliableViewCount > 0 ? Math.round((completion50 / reliableViewCount) * 10000) / 100 : 0,
        rate75: reliableViewCount > 0 ? Math.round((completion75 / reliableViewCount) * 10000) / 100 : 0,
        rate95: reliableViewCount > 0 ? Math.round((completion95 / reliableViewCount) * 10000) / 100 : 0,
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
      
      // DEBUG: Data quality counters (split as requested)
      dataQuality: {
        totalRows: allViews.length,
        reliableRows: reliableViews.length,
        reliableTrackingSince: RELIABLE_TRACKING_DATE,
        // Missing session_id = tracking failed to fire
        rowsMissingSessionId,
        sessionIdMissingPct: allViews.length > 0 ? Math.round((rowsMissingSessionId / allViews.length) * 100) : 0,
        // Missing viewer_id = older tracking before viewer_id column
        rowsMissingViewerId,
        viewerIdMissingPct: allViews.length > 0 ? Math.round((rowsMissingViewerId / allViews.length) * 100) : 0,
        // Watch duration NULL = tracking failed to send metrics
        rowsWatchDurationNull,
        watchDurationNullPct: allViews.length > 0 ? Math.round((rowsWatchDurationNull / allViews.length) * 100) : 0,
        // Watch duration 0 = real bounce (user scrolled away before 1s)
        rowsWatchDurationZero,
        watchDurationZeroPct: allViews.length > 0 ? Math.round((rowsWatchDurationZero / allViews.length) * 100) : 0,
        // With watch duration > 0 = actual watched content
        rowsWithWatchDuration,
        watchDurationPresentPct: allViews.length > 0 ? Math.round((rowsWithWatchDuration / allViews.length) * 100) : 0,
      },
      
      // Trends
      trends: trendData,
      
      // Time-based breakdown (hourly or daily)
      daily,
      isHourlyBreakdown,
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
