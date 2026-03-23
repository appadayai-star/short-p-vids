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

    // Verify user
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for admin operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify admin status
    const { data: adminRole } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden - Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const search = url.searchParams.get("q") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const sortField = url.searchParams.get("sortField") || "created_at";
    const sortOrder = url.searchParams.get("sortOrder") || "desc";
    const offset = (page - 1) * limit;

    console.log(`Fetching videos: search="${search}", page=${page}, sort=${sortField}:${sortOrder}`);

    // For engagement sorting, we need to fetch all and sort in memory
    const isEngagementSort = sortField === "engagement";
    
    // Build query
    let query = serviceClient
      .from("videos")
      .select(`
        id,
        title,
        description,
        video_url,
        optimized_video_url,
        processing_status,
        thumbnail_url,
        cloudinary_public_id,
        views_count,
        likes_count,
        created_at,
        user_id,
        profiles!videos_user_id_fkey (
          id,
          username
        )
      `, { count: "exact" });

    // Apply sorting for non-engagement fields
    if (!isEngagementSort && ["created_at", "views_count", "likes_count"].includes(sortField)) {
      query = query.order(sortField, { ascending: sortOrder === "asc" });
    } else if (!isEngagementSort) {
      query = query.order("created_at", { ascending: false });
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,id.eq.${search}`);
    }

    if (startDate) {
      query = query.gte("created_at", startDate);
    }

    if (endDate) {
      query = query.lte("created_at", endDate);
    }

    // For engagement sort, fetch more data to sort properly
    if (isEngagementSort) {
      query = query.order("created_at", { ascending: false }).limit(1000);
    } else {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: videos, count, error } = await query;

    if (error) {
      console.error("Error fetching videos:", error);
      throw error;
    }

    // Get saved counts for all videos
    const videoIds = videos?.map((v) => v.id) || [];
    const { data: savedData } = await serviceClient
      .from("saved_videos")
      .select("video_id");

    const savedCountMap = new Map<string, number>();
    savedData?.forEach((s) => {
      savedCountMap.set(s.video_id, (savedCountMap.get(s.video_id) || 0) + 1);
    });

    // Startup reliability metrics (last 14 days)
    const startupMetricsMap = new Map<string, {
      avg_ttff_ms: number;
      fast_start_rate: number;
      slow_start_rate: number;
      stall_rate: number;
      retry_rate: number;
      startup_samples: number;
    }>();

    if (videoIds.length > 0) {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: startupViews } = await serviceClient
        .from("video_views")
        .select("video_id, time_to_first_frame_ms")
        .in("video_id", videoIds)
        .gte("viewed_at", fourteenDaysAgo)
        .not("time_to_first_frame_ms", "is", null);

      const grouped = new Map<string, number[]>();
      startupViews?.forEach((row) => {
        if (row.time_to_first_frame_ms == null) return;
        const values = grouped.get(row.video_id) || [];
        values.push(row.time_to_first_frame_ms);
        grouped.set(row.video_id, values);
      });

      for (const [videoId, ttffValues] of grouped.entries()) {
        const sampleCount = ttffValues.length;
        const avg = sampleCount > 0
          ? Math.round(ttffValues.reduce((sum, n) => sum + n, 0) / sampleCount)
          : -1;
        const fast = sampleCount > 0 ? ttffValues.filter((n) => n <= 2000).length / sampleCount : 0;
        const slow = sampleCount > 0 ? ttffValues.filter((n) => n > 2000).length / sampleCount : 0;
        const stall = sampleCount > 0 ? ttffValues.filter((n) => n > 8000).length / sampleCount : 0;
        const retryProxy = sampleCount > 0 ? ttffValues.filter((n) => n > 3500).length / sampleCount : 0;

        startupMetricsMap.set(videoId, {
          avg_ttff_ms: avg,
          fast_start_rate: fast,
          slow_start_rate: slow,
          stall_rate: stall,
          retry_rate: retryProxy,
          startup_samples: sampleCount,
        });
      }
    }

    // Get uploader emails from auth
    const { data: authUsers } = await serviceClient.auth.admin.listUsers();
    
    const emailMap = new Map<string, string>();
    authUsers?.users?.forEach((u) => {
      emailMap.set(u.id, u.email || "");
    });

    let videosWithEmail = videos?.map((v) => {
      const profileData = v.profiles as unknown;
      const profile = profileData as { id: string; username: string } | null;
      const savedCount = savedCountMap.get(v.id) || 0;
      const engagement = v.views_count > 0 ? (v.likes_count / v.views_count) * 100 : 0;
      const startup = startupMetricsMap.get(v.id);
      const sourceType = v.optimized_video_url
        ? "optimized"
        : v.cloudinary_public_id
          ? "cloudinary"
          : "original";

      return {
        ...v,
        saved_count: savedCount,
        engagement,
        uploader_email: emailMap.get(v.user_id) || "",
        uploader_username: profile?.username || `user_${v.user_id.slice(0, 8)}`,
        source_type: sourceType,
        startup_avg_ttff_ms: startup?.avg_ttff_ms ?? -1,
        startup_fast_start_rate: startup?.fast_start_rate ?? -1,
        startup_slow_start_rate: startup?.slow_start_rate ?? -1,
        startup_stall_rate: startup?.stall_rate ?? -1,
        startup_retry_rate: startup?.retry_rate ?? -1,
        startup_samples: startup?.startup_samples ?? 0,
      };
    }) || [];

    // Handle engagement sorting in memory
    if (isEngagementSort) {
      videosWithEmail.sort((a, b) => {
        return sortOrder === "desc" ? b.engagement - a.engagement : a.engagement - b.engagement;
      });
      // Apply pagination after sorting
      videosWithEmail = videosWithEmail.slice(offset, offset + limit);
    }

    console.log(`Returning ${videosWithEmail.length} videos out of ${count} total`);

    return new Response(
      JSON.stringify({
        videos: videosWithEmail,
        total: count || 0,
        page,
        limit,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching videos:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
