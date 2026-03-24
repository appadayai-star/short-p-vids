import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Eye, UserPlus, Heart, Bookmark, CalendarIcon, Loader2, Video, 
  Users, Play, Clock, TrendingUp, TrendingDown, Percent, 
  RefreshCw, ArrowRight, Upload, Share2, UserCheck, Zap, Timer,
  Bug, Grid3x3, Search
} from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";

interface DailyStats {
  date: string;
  views: number;
  uniqueViewers: number;
  profilesCreated: number;
  likes: number;
  saves: number;
  uploads: number;
  shares: number;
  avgWatchTime: number;
  avgSessionWatchTime: number;
  videosPerSession: number;
  engagementRate: number;
  adClicks: number;
}

interface Stats {
  // Core usage
  views: number;
  uniqueViewers: number;
  avgSessionWatchTime: string;  // SUM(watch_duration_seconds) per session
  avgSessionWatchTimeSeconds: number;
  
  // Session behavior
  videosPerSession?: {
    avg: number;
    median: number;
    p90: number;
  };
  
  // Watch time
  totalWatchTimeSeconds: number;
  totalWatchTimeFormatted: string;
  avgWatchTimeSeconds: number;
  avgWatchTimeFormatted: string;
  watchCompletion: {
    views25: number;
    views50: number;
    views75: number;
    views95: number;
    rate25: number;
    rate50: number;
    rate75: number;
    rate95: number;
  };
  
  // Playback performance
  ttff: {
    median: number;
    p95: number;
    sampleSize: number;
  };
  
  // Engagement
  engagementRate: number;
  likeRate: number;
  saveRate: number;
  likes: number;
  saves: number;
  shares: number;
  profileViews: number;
  follows: number;
  
  // Retention
  scrollContinuationRate: number;
  returnRate24h: number;
  returnRate7d: number;
  
  // Repeat Views (not impressions - see docs)
  repeatViews?: {
    rate7d: number;
    perSessionRate: number;
    totalViews: number;
    repeatCount: number;
    perSessionRepeatCount: number;
  };
  
  // Growth
  profilesCreated: number;
  
  // Signup Health Check (admin diagnostic)
  signupHealth?: {
    authUsers7d: number;
    profiles7d: number;
    delta: number;
    healthy: boolean;
  };
  
  dau: number;
  mau: number;
  dauMauRatio: number;
  
  // Creator supply
  uploads: number;
  activeCreators: number;
  
  // Sessions
  totalSessions?: number;
  
  // DEBUG: Data quality counters
  dataQuality?: {
    totalRows: number;
    reliableRows: number;
    reliableTrackingSince: string;
    // Missing session_id = tracking failed
    rowsMissingSessionId: number;
    sessionIdMissingPct: number;
    // Missing viewer_id = older tracking
    rowsMissingViewerId: number;
    viewerIdMissingPct: number;
    // Watch duration NULL = tracking failed to send
    rowsWatchDurationNull: number;
    watchDurationNullPct: number;
    // Watch duration 0 = real bounce
    rowsWatchDurationZero: number;
    watchDurationZeroPct: number;
    // With watch duration > 0 = actual watched
    rowsWithWatchDuration: number;
    watchDurationPresentPct: number;
  };
  
  // Trends
  trends: {
    views: number;
    likes: number;
    saves: number;
    profilesCreated: number;
    uploads: number;
    shares: number;
  } | null;
  
  daily: DailyStats[];
  isHourlyBreakdown?: boolean;
}

const SUPABASE_URL = "https://mbuajcicosojebakdtsn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1idWFqY2ljb3NvamViYWtkdHNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1NDcxMTYsImV4cCI6MjA3OTEyMzExNn0.Kl3CuR1f3sGm5UAfh3xz1979SUt9Uf9aN_03ns2Qr98";

const TrendIndicator = ({ value, suffix = "%" }: { value: number | undefined; suffix?: string }) => {
  if (value === undefined || value === null) return null;
  const isPositive = value >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  return (
    <span className={cn(
      "flex items-center gap-0.5 text-xs font-medium",
      isPositive ? "text-green-500" : "text-red-500"
    )}>
      <Icon className="h-3 w-3" />
      {isPositive ? "+" : ""}{value.toFixed(1)}{suffix}
    </span>
  );
};

const StatCard = ({ 
  title, 
  value, 
  subtitle,
  icon: Icon, 
  color, 
  bgColor,
  trend,
  loading 
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  icon: any; 
  color: string; 
  bgColor: string;
  trend?: number;
  loading: boolean;
}) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <div className={cn("p-2 rounded-full", bgColor)}>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
    </CardHeader>
    <CardContent>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold">
              {typeof value === "number" ? value.toLocaleString() : value}
            </div>
            <TrendIndicator value={trend} />
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      )}
    </CardContent>
  </Card>
);

const MetricSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  </div>
);

export const AdminStats = () => {
  const { session } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState("7d");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });
  const [fetchKey, setFetchKey] = useState(0);
  const [categoryClicks, setCategoryClicks] = useState<{ category: string; clicks: number }[]>([]);
  const [categoryClicksTotal, setCategoryClicksTotal] = useState(0);
  const [categoryClicksLoading, setCategoryClicksLoading] = useState(true);
  
  // Ad analytics state
  const [adStats, setAdStats] = useState<{
    totalViews: number;
    totalClicks: number;
    ctr: number;
    perAd: { id: string; title: string; link: string; views: number; clicks: number; ctr: number }[];
  } | null>(null);
  const [adStatsLoading, setAdStatsLoading] = useState(true);

  // Search analytics state
  const [searchStats, setSearchStats] = useState<{
    totalSearches: number;
    topQueries: { query: string; count: number; avgResults: number }[];
  } | null>(null);
  const [searchStatsLoading, setSearchStatsLoading] = useState(true);

  const toUTCStartOfDay = (date: Date) => {
    const d = new Date(date);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
  };

  const toUTCEndOfDay = (date: Date) => {
    const d = new Date(date);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999));
  };

  // For time-based presets, we need exact timestamps, not day boundaries
  const getDateRangeForPreset = (preset: string): { startDate: string; endDate: string } | null => {
    const now = new Date();
    
    switch (preset) {
      case "24h":
        // Exact 24 hours ago to now
        return {
          startDate: subDays(now, 1).toISOString(),
          endDate: now.toISOString(),
        };
      case "7d":
        // Exact 7 days ago to now
        return {
          startDate: subDays(now, 7).toISOString(),
          endDate: now.toISOString(),
        };
      case "30d":
        // Exact 30 days ago to now
        return {
          startDate: subDays(now, 30).toISOString(),
          endDate: now.toISOString(),
        };
      default:
        return null;
    }
  };

  const handlePresetChange = (preset: string) => {
    const now = new Date();
    let newRange: DateRange | undefined;
    
    switch (preset) {
      case "24h":
        newRange = { from: subDays(now, 1), to: now };
        break;
      case "7d":
        newRange = { from: subDays(now, 7), to: now };
        break;
      case "30d":
        newRange = { from: subDays(now, 30), to: now };
        break;
      case "lifetime":
      case "custom":
        newRange = dateRange;
        break;
      default:
        newRange = dateRange;
    }
    
    // Batch the state updates and trigger a single fetch
    setDatePreset(preset);
    setDateRange(newRange);
    setFetchKey(prev => prev + 1);
  };

  useEffect(() => {
    let isCancelled = false;
    const abortController = new AbortController();
    
    const fetchStats = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!session) throw new Error("Not authenticated");

        let url: string;
        if (datePreset === "lifetime") {
          url = `${SUPABASE_URL}/functions/v1/admin-stats?lifetime=true`;
        } else {
          // For time-based presets (24h, 7d, 30d), use exact timestamps
          // For custom date ranges, use day boundaries
          const presetDates = getDateRangeForPreset(datePreset);
          
          let startDate: string;
          let endDate: string;
          
          if (presetDates) {
            // Use exact timestamps for presets
            startDate = presetDates.startDate;
            endDate = presetDates.endDate;
          } else if (dateRange?.from && dateRange?.to) {
            // Use day boundaries for custom ranges
            startDate = toUTCStartOfDay(dateRange.from).toISOString();
            endDate = toUTCEndOfDay(dateRange.to).toISOString();
          } else {
            return;
          }
          
          url = `${SUPABASE_URL}/functions/v1/admin-stats?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
        }

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
          },
          signal: abortController.signal,
        });

        if (isCancelled) return;

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to fetch stats");
        }

        const data = await res.json();
        if (!isCancelled) {
          setStats(data);
        }
      } catch (err) {
        if (isCancelled || (err instanceof Error && err.name === 'AbortError')) return;
        console.error("Error fetching stats:", err);
        setError(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    fetchStats();
    
    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [fetchKey, session]);

  // Fetch category clicks
  useEffect(() => {
    const fetchCategoryClicks = async () => {
      setCategoryClicksLoading(true);
      try {
        let query = supabase.from("category_clicks").select("category, created_at");
        
        if (datePreset !== "lifetime") {
          const presetDates = getDateRangeForPreset(datePreset);
          if (presetDates) {
            query = query.gte("created_at", presetDates.startDate).lte("created_at", presetDates.endDate);
          } else if (dateRange?.from && dateRange?.to) {
            query = query.gte("created_at", toUTCStartOfDay(dateRange.from).toISOString())
                         .lte("created_at", toUTCEndOfDay(dateRange.to).toISOString());
          }
        }

        const { data, error } = await query;
        if (error) throw error;

        const counts: Record<string, number> = {};
        (data || []).forEach((row: any) => {
          counts[row.category] = (counts[row.category] || 0) + 1;
        });

        const sorted = Object.entries(counts)
          .map(([category, clicks]) => ({ category, clicks }))
          .sort((a, b) => b.clicks - a.clicks);

        setCategoryClicks(sorted);
        setCategoryClicksTotal(sorted.reduce((sum, c) => sum + c.clicks, 0));
      } catch (err) {
        console.error("Error fetching category clicks:", err);
      } finally {
        setCategoryClicksLoading(false);
      }
    };

    fetchCategoryClicks();
  }, [fetchKey]);

  // Fetch ad analytics
  useEffect(() => {
    const fetchAdStats = async () => {
      setAdStatsLoading(true);
      try {
        const { data: adsData } = await supabase.from("ads").select("id, title, external_link");
        if (!adsData || adsData.length === 0) {
          setAdStats({ totalViews: 0, totalClicks: 0, ctr: 0, perAd: [] });
          setAdStatsLoading(false);
          return;
        }

        const perAd = await Promise.all(
          adsData.map(async (ad: any) => {
            let viewsQuery = supabase.from("ad_views").select("id", { count: "exact", head: true }).eq("ad_id", ad.id);
            let clicksQuery = supabase.from("ad_clicks").select("id", { count: "exact", head: true }).eq("ad_id", ad.id);

            if (datePreset !== "lifetime") {
              const presetDates = getDateRangeForPreset(datePreset);
              if (presetDates) {
                viewsQuery = viewsQuery.gte("viewed_at", presetDates.startDate).lte("viewed_at", presetDates.endDate);
                clicksQuery = clicksQuery.gte("clicked_at", presetDates.startDate).lte("clicked_at", presetDates.endDate);
              } else if (dateRange?.from && dateRange?.to) {
                viewsQuery = viewsQuery.gte("viewed_at", toUTCStartOfDay(dateRange.from).toISOString()).lte("viewed_at", toUTCEndOfDay(dateRange.to).toISOString());
                clicksQuery = clicksQuery.gte("clicked_at", toUTCStartOfDay(dateRange.from).toISOString()).lte("clicked_at", toUTCEndOfDay(dateRange.to).toISOString());
              }
            }

            const [viewsRes, clicksRes] = await Promise.all([viewsQuery, clicksQuery]);
            const views = viewsRes.count || 0;
            const clicks = clicksRes.count || 0;

            return {
              id: ad.id,
              title: ad.title,
              link: ad.external_link,
              views,
              clicks,
              ctr: views > 0 ? Math.round((clicks / views) * 10000) / 100 : 0,
            };
          })
        );

        const totalViews = perAd.reduce((s, a) => s + a.views, 0);
        const totalClicks = perAd.reduce((s, a) => s + a.clicks, 0);

        setAdStats({
          totalViews,
          totalClicks,
          ctr: totalViews > 0 ? Math.round((totalClicks / totalViews) * 10000) / 100 : 0,
          perAd: perAd.sort((a, b) => b.views - a.views),
        });
      } catch (err) {
        console.error("Error fetching ad stats:", err);
      } finally {
        setAdStatsLoading(false);
      }
    };

    fetchAdStats();
  }, [fetchKey]);

  const chartData = stats?.daily?.map(d => ({
    ...d,
    date: stats?.isHourlyBreakdown 
      ? format(new Date(d.date), "ha") // e.g., "3PM", "4PM"
      : format(new Date(d.date), "MMM d"),
  })) || [];

  return (
    <div className="space-y-8">
      {/* Time Range Selector */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <Select value={datePreset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select time range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="lifetime">Lifetime</SelectItem>
            <SelectItem value="custom">Custom range</SelectItem>
          </SelectContent>
        </Select>

        {datePreset === "custom" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar 
                initialFocus 
                mode="range" 
                defaultMonth={dateRange?.from} 
                selected={dateRange} 
                onSelect={(range) => {
                  setDateRange(range);
                  if (range?.from && range?.to) {
                    setFetchKey(prev => prev + 1);
                  }
                }} 
                numberOfMonths={2} 
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {error && <div className="p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>}

      {/* Key KPIs (Top Row) */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatCard
          title="Total Views"
          value={stats?.views ?? 0}
          icon={Eye}
          color="text-blue-500"
          bgColor="bg-blue-500/10"
          trend={stats?.trends?.views}
          loading={loading}
        />
        <StatCard
          title="Avg Watch Time"
          value={stats?.avgWatchTimeFormatted ?? "0s"}
          subtitle="per view"
          icon={Timer}
          color="text-emerald-500"
          bgColor="bg-emerald-500/10"
          loading={loading}
        />
        <StatCard
          title="Videos / Session"
          value={stats?.videosPerSession?.avg ?? 0}
          icon={Play}
          color="text-purple-500"
          bgColor="bg-purple-500/10"
          loading={loading}
        />
        <StatCard
          title="Engagement Rate"
          value={`${stats?.engagementRate ?? 0}%`}
          subtitle="(likes + saves) / views"
          icon={TrendingUp}
          color="text-orange-500"
          bgColor="bg-orange-500/10"
          loading={loading}
        />
      </div>

      {/* Watch Time Metrics */}
      <MetricSection title="Watch Time (Feed Quality Signal)">
        <StatCard
          title="Total Watch Time"
          value={stats?.totalWatchTimeFormatted ?? "0s"}
          icon={Clock}
          color="text-blue-500"
          bgColor="bg-blue-500/10"
          loading={loading}
        />
        <StatCard
          title="Avg Watch Time"
          value={stats?.avgWatchTimeFormatted ?? "0s"}
          subtitle="per view"
          icon={Timer}
          color="text-cyan-500"
          bgColor="bg-cyan-500/10"
          loading={loading}
        />
        <StatCard
          title="≥25% Completion"
          value={`${stats?.watchCompletion?.rate25 ?? 0}%`}
          subtitle={`${stats?.watchCompletion?.views25 ?? 0} views`}
          icon={Play}
          color="text-yellow-500"
          bgColor="bg-yellow-500/10"
          loading={loading}
        />
        <StatCard
          title="≥50% Completion"
          value={`${stats?.watchCompletion?.rate50 ?? 0}%`}
          subtitle={`${stats?.watchCompletion?.views50 ?? 0} views`}
          icon={Play}
          color="text-amber-500"
          bgColor="bg-amber-500/10"
          loading={loading}
        />
        <StatCard
          title="≥75% Completion"
          value={`${stats?.watchCompletion?.rate75 ?? 0}%`}
          subtitle={`${stats?.watchCompletion?.views75 ?? 0} views`}
          icon={Play}
          color="text-orange-500"
          bgColor="bg-orange-500/10"
          loading={loading}
        />
        <StatCard
          title="≥95% Completion"
          value={`${stats?.watchCompletion?.rate95 ?? 0}%`}
          subtitle={`${stats?.watchCompletion?.views95 ?? 0} views`}
          icon={Play}
          color="text-green-500"
          bgColor="bg-green-500/10"
          loading={loading}
        />
      </MetricSection>

      {/* Playback Performance */}
      <MetricSection title="Playback Performance (TTFF)">
        <StatCard
          title="Median TTFF"
          value={`${stats?.ttff?.median ?? 0}ms`}
          subtitle="Time to First Frame"
          icon={Zap}
          color="text-yellow-500"
          bgColor="bg-yellow-500/10"
          loading={loading}
        />
        <StatCard
          title="P95 TTFF"
          value={`${stats?.ttff?.p95 ?? 0}ms`}
          subtitle="95th percentile"
          icon={Zap}
          color="text-orange-500"
          bgColor="bg-orange-500/10"
          loading={loading}
        />
        <StatCard
          title="Sample Size"
          value={stats?.ttff?.sampleSize ?? 0}
          subtitle="videos with TTFF data"
          icon={Video}
          color="text-gray-500"
          bgColor="bg-gray-500/10"
          loading={loading}
        />
      </MetricSection>

      {/* Session Behavior */}
      <MetricSection title="Session Behavior">
        <StatCard
          title="Videos / Session (Median)"
          value={stats?.videosPerSession?.median ?? 0}
          subtitle="50th percentile"
          icon={Play}
          color="text-purple-500"
          bgColor="bg-purple-500/10"
          loading={loading}
        />
        <StatCard
          title="Videos / Session (P90)"
          value={stats?.videosPerSession?.p90 ?? 0}
          subtitle="90th percentile"
          icon={Play}
          color="text-violet-500"
          bgColor="bg-violet-500/10"
          loading={loading}
        />
        <StatCard
          title="Scroll Continuation"
          value={`${stats?.scrollContinuationRate ?? 0}%`}
          subtitle="users watching 2+ videos"
          icon={RefreshCw}
          color="text-green-500"
          bgColor="bg-green-500/10"
          loading={loading}
        />
      </MetricSection>

      {/* Core Usage Metrics */}
      <MetricSection title="Core Usage">
        <StatCard
          title="Unique Viewers"
          value={stats?.uniqueViewers ?? 0}
          subtitle="anon + logged-in"
          icon={Users}
          color="text-cyan-500"
          bgColor="bg-cyan-500/10"
          loading={loading}
        />
        <StatCard
          title="Avg Session Watch Time"
          value={stats?.avgSessionWatchTime ?? "0m 0s"}
          subtitle="SUM(watch_duration) per session"
          icon={Clock}
          color="text-emerald-500"
          bgColor="bg-emerald-500/10"
          loading={loading}
        />
        <StatCard
          title="DAU"
          value={stats?.dau ?? 0}
          subtitle="Daily Active Users"
          icon={Users}
          color="text-blue-500"
          bgColor="bg-blue-500/10"
          loading={loading}
        />
        <StatCard
          title="MAU"
          value={stats?.mau ?? 0}
          subtitle="Monthly Active Users"
          icon={Users}
          color="text-indigo-500"
          bgColor="bg-indigo-500/10"
          loading={loading}
        />
        <StatCard
          title="DAU/MAU Ratio"
          value={`${stats?.dauMauRatio ?? 0}%`}
          subtitle="Stickiness indicator"
          icon={Percent}
          color="text-violet-500"
          bgColor="bg-violet-500/10"
          loading={loading}
        />
      </MetricSection>

      {/* Engagement Metrics */}
      <MetricSection title="Engagement">
        <StatCard
          title="Total Likes"
          value={stats?.likes ?? 0}
          icon={Heart}
          color="text-red-500"
          bgColor="bg-red-500/10"
          trend={stats?.trends?.likes}
          loading={loading}
        />
        <StatCard
          title="Total Saves"
          value={stats?.saves ?? 0}
          icon={Bookmark}
          color="text-purple-500"
          bgColor="bg-purple-500/10"
          trend={stats?.trends?.saves}
          loading={loading}
        />
        <StatCard
          title="Total Shares"
          value={stats?.shares ?? 0}
          icon={Share2}
          color="text-blue-500"
          bgColor="bg-blue-500/10"
          trend={stats?.trends?.shares}
          loading={loading}
        />
        <StatCard
          title="Profile Views"
          value={stats?.profileViews ?? 0}
          icon={UserCheck}
          color="text-teal-500"
          bgColor="bg-teal-500/10"
          loading={loading}
        />
        <StatCard
          title="Follows"
          value={stats?.follows ?? 0}
          icon={UserPlus}
          color="text-green-500"
          bgColor="bg-green-500/10"
          loading={loading}
        />
        <StatCard
          title="Like Rate"
          value={`${stats?.likeRate ?? 0}%`}
          subtitle="likes / views"
          icon={Heart}
          color="text-pink-500"
          bgColor="bg-pink-500/10"
          loading={loading}
        />
        <StatCard
          title="Save Rate"
          value={`${stats?.saveRate ?? 0}%`}
          subtitle="saves / views"
          icon={Bookmark}
          color="text-fuchsia-500"
          bgColor="bg-fuchsia-500/10"
          loading={loading}
        />
      </MetricSection>

      {/* Retention & Stickiness */}
      <MetricSection title="Retention & Stickiness">
        <StatCard
          title="Scroll Continuation"
          value={`${stats?.scrollContinuationRate ?? 0}%`}
          subtitle="Users who watch 2+ videos"
          icon={ArrowRight}
          color="text-teal-500"
          bgColor="bg-teal-500/10"
          loading={loading}
        />
        <StatCard
          title="24h Return Rate"
          value={`${stats?.returnRate24h ?? 0}%`}
          subtitle="Users returning within 24h"
          icon={RefreshCw}
          color="text-green-500"
          bgColor="bg-green-500/10"
          loading={loading}
        />
        <StatCard
          title="7-Day Return Rate"
          value={`${stats?.returnRate7d ?? 0}%`}
          subtitle="Users returning within 7 days"
          icon={RefreshCw}
          color="text-lime-500"
          bgColor="bg-lime-500/10"
          loading={loading}
        />
      </MetricSection>

      {/* Repeat Views (Feed Quality) */}
      <MetricSection title="Repeat Views (Feed Quality)">
        <StatCard
          title="7-Day Repeat Rate"
          value={`${stats?.repeatViews?.rate7d ?? 0}%`}
          subtitle="% views of already-seen videos (7d)"
          icon={RefreshCw}
          color="text-amber-500"
          bgColor="bg-amber-500/10"
          loading={loading}
        />
        <StatCard
          title="Per-Session Repeat Rate"
          value={`${stats?.repeatViews?.perSessionRate ?? 0}%`}
          subtitle="% views repeated in same session"
          icon={RefreshCw}
          color="text-orange-500"
          bgColor="bg-orange-500/10"
          loading={loading}
        />
        <StatCard
          title="Repeat Views"
          value={stats?.repeatViews?.repeatCount ?? 0}
          subtitle={`of ${stats?.repeatViews?.totalViews ?? 0} total`}
          icon={Eye}
          color="text-red-500"
          bgColor="bg-red-500/10"
          loading={loading}
        />
      </MetricSection>

      {/* Growth Metrics */}
      <MetricSection title="Growth">
        <StatCard
          title="Profiles Created"
          value={stats?.profilesCreated ?? 0}
          icon={UserPlus}
          color="text-green-500"
          bgColor="bg-green-500/10"
          trend={stats?.trends?.profilesCreated}
          loading={loading}
        />
        <StatCard
          title="Signup Health (7d)"
          value={stats?.signupHealth?.healthy ? "✓ Healthy" : `⚠ Delta: ${stats?.signupHealth?.delta ?? 0}`}
          subtitle={`Auth: ${stats?.signupHealth?.authUsers7d ?? 0} | Profiles: ${stats?.signupHealth?.profiles7d ?? 0}`}
          icon={UserCheck}
          color={stats?.signupHealth?.healthy ? "text-green-500" : "text-amber-500"}
          bgColor={stats?.signupHealth?.healthy ? "bg-green-500/10" : "bg-amber-500/10"}
          loading={loading}
        />
      </MetricSection>

      {/* Creator Supply */}
      <MetricSection title="Creator Supply">
        <StatCard
          title="Videos Uploaded"
          value={stats?.uploads ?? 0}
          icon={Upload}
          color="text-orange-500"
          bgColor="bg-orange-500/10"
          trend={stats?.trends?.uploads}
          loading={loading}
        />
        <StatCard
          title="Active Creators"
          value={stats?.activeCreators ?? 0}
          subtitle="Uploaded in last 7 days"
          icon={Video}
          color="text-amber-500"
          bgColor="bg-amber-500/10"
          loading={loading}
        />
      </MetricSection>

      {/* Category Clicks */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Category Clicks</h3>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Grid3x3 className="h-4 w-4" />
                Clicks by Category
              </CardTitle>
            </CardHeader>
            <CardContent>
              {categoryClicksLoading ? (
                <div className="flex items-center justify-center h-[200px]">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : categoryClicks.length > 0 ? (
                <div className="space-y-3">
                  {categoryClicks.map((c) => (
                    <div key={c.category} className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{c.category}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${categoryClicksTotal > 0 ? (c.clicks / categoryClicksTotal) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold w-12 text-right">{c.clicks}</span>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="text-sm font-bold">{categoryClicksTotal}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No category clicks recorded yet</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Category Click Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {categoryClicksLoading ? (
                <div className="flex items-center justify-center h-[200px]">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : categoryClicks.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={categoryClicks}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="category" className="text-xs capitalize" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Bar dataKey="clicks" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Ad Analytics */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Ad Performance</h3>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
          <StatCard
            title="Total Ad Views"
            value={adStats?.totalViews ?? 0}
            icon={Eye}
            color="text-blue-500"
            bgColor="bg-blue-500/10"
            loading={adStatsLoading}
          />
          <StatCard
            title="Total Ad Clicks"
            value={adStats?.totalClicks ?? 0}
            icon={UserCheck}
            color="text-green-500"
            bgColor="bg-green-500/10"
            loading={adStatsLoading}
          />
          <StatCard
            title="Overall CTR"
            value={`${adStats?.ctr ?? 0}%`}
            subtitle="clicks / views"
            icon={TrendingUp}
            color="text-orange-500"
            bgColor="bg-orange-500/10"
            loading={adStatsLoading}
          />
        </div>
        {adStats && adStats.perAd.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Per-Ad Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {adStats.perAd.map((ad) => (
                  <div key={ad.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{ad.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{ad.link}</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm flex-shrink-0 ml-4">
                      <span className="text-muted-foreground">{ad.views.toLocaleString()} views</span>
                      <span className="text-muted-foreground">{ad.clicks.toLocaleString()} clicks</span>
                      <span className="font-semibold">{ad.ctr}% CTR</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Trend Chart */}
      {datePreset !== "lifetime" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{stats?.isHourlyBreakdown ? "Hourly Trends" : "Daily Trends"}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-[300px]">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis yAxisId="left" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis yAxisId="right" orientation="right" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    formatter={(value: number, name: string) => {
                      if (name === 'Avg Watch Time' || name === 'Avg Session Watch Time') return [`${value}s`, name];
                      if (name === 'Engagement Rate') return [`${value}%`, name];
                      return [value, name];
                    }}
                  />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="views" stroke="#3b82f6" strokeWidth={2} dot={false} name="Views" />
                  <Line yAxisId="left" type="monotone" dataKey="uniqueViewers" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Unique Viewers" />
                  <Line yAxisId="left" type="monotone" dataKey="likes" stroke="#ef4444" strokeWidth={2} dot={false} name="Likes" />
                  <Line yAxisId="left" type="monotone" dataKey="saves" stroke="#a855f7" strokeWidth={2} dot={false} name="Saves" />
                  <Line yAxisId="left" type="monotone" dataKey="shares" stroke="#06b6d4" strokeWidth={2} dot={false} name="Shares" />
                  <Line yAxisId="left" type="monotone" dataKey="adClicks" stroke="#f59e0b" strokeWidth={2} dot={false} name="Ad Clicks" />
                  <Line yAxisId="left" type="monotone" dataKey="uploads" stroke="#f97316" strokeWidth={2} dot={false} name="Uploads" />
                  <Line yAxisId="left" type="monotone" dataKey="profilesCreated" stroke="#22c55e" strokeWidth={2} dot={false} name="Profiles Created" />
                  <Line yAxisId="right" type="monotone" dataKey="avgWatchTime" stroke="#14b8a6" strokeWidth={2} dot={false} name="Avg Watch Time" strokeDasharray="5 5" />
                  <Line yAxisId="right" type="monotone" dataKey="avgSessionWatchTime" stroke="#06b6d4" strokeWidth={2} dot={false} name="Avg Session Watch Time" strokeDasharray="5 5" />
                  <Line yAxisId="right" type="monotone" dataKey="videosPerSession" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Videos / Session" strokeDasharray="5 5" />
                  <Line yAxisId="right" type="monotone" dataKey="engagementRate" stroke="#ec4899" strokeWidth={2} dot={false} name="Engagement Rate" strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No data available for the selected period
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
