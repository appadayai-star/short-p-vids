import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Eye, UserPlus, Heart, Bookmark, CalendarIcon, Loader2, Video, 
  Users, Play, Clock, TrendingUp, TrendingDown, Percent, 
  RefreshCw, ArrowRight, Upload, Share2, UserCheck, Zap, Timer,
  Bug
} from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DailyStats {
  date: string;
  views: number;
  profilesCreated: number;
  likes: number;
  saves: number;
  uploads: number;
  shares: number;
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
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState("7d");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });

  const toUTCStartOfDay = (date: Date) => {
    const d = new Date(date);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
  };

  const toUTCEndOfDay = (date: Date) => {
    const d = new Date(date);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999));
  };

  const handlePresetChange = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    
    switch (preset) {
      case "24h":
        setDateRange({ from: subDays(now, 1), to: now });
        break;
      case "7d":
        setDateRange({ from: subDays(now, 7), to: now });
        break;
      case "30d":
        setDateRange({ from: subDays(now, 30), to: now });
        break;
      case "lifetime":
      case "custom":
        break;
    }
  };

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        let url: string;
        if (datePreset === "lifetime") {
          url = `${SUPABASE_URL}/functions/v1/admin-stats?lifetime=true`;
        } else if (dateRange?.from && dateRange?.to) {
          const startDate = toUTCStartOfDay(dateRange.from).toISOString();
          const endDate = toUTCEndOfDay(dateRange.to).toISOString();
          url = `${SUPABASE_URL}/functions/v1/admin-stats?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
        } else {
          return;
        }

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
          },
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to fetch stats");
        }

        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error("Error fetching stats:", err);
        setError(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [dateRange, datePreset]);

  const chartData = stats?.daily?.map(d => ({
    ...d,
    date: format(new Date(d.date), "MMM d"),
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
              <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
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


      {/* Trend Chart */}
      {datePreset !== "lifetime" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Daily Trends</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-[300px]">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="views" stroke="#3b82f6" strokeWidth={2} dot={false} name="Views" />
                  <Line type="monotone" dataKey="profilesCreated" stroke="#22c55e" strokeWidth={2} dot={false} name="Profiles Created" />
                  <Line type="monotone" dataKey="likes" stroke="#ef4444" strokeWidth={2} dot={false} name="Likes" />
                  <Line type="monotone" dataKey="saves" stroke="#a855f7" strokeWidth={2} dot={false} name="Saves" />
                  <Line type="monotone" dataKey="shares" stroke="#06b6d4" strokeWidth={2} dot={false} name="Shares" />
                  <Line type="monotone" dataKey="uploads" stroke="#f97316" strokeWidth={2} dot={false} name="Uploads" />
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
