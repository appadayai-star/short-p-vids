import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, CheckCircle, AlertCircle, Cloud } from "lucide-react";

interface MigrationResult {
  id: string;
  status: string;
  cloudflareVideoId?: string;
  error?: string;
}

export function AdminReprocess() {
  const [isLoading, setIsLoading] = useState(false);
  const [autoMigrate, setAutoMigrate] = useState(false);
  const [stats, setStats] = useState<{ total: number; migrated: number; remaining: number } | null>(null);
  const [results, setResults] = useState<MigrationResult[]>([]);
  const [isChecking, setIsChecking] = useState(true);
  const [batchCount, setBatchCount] = useState(0);

  useEffect(() => {
    checkMigrationStatus();
  }, []);

  // Auto-migrate: trigger next batch when current one finishes
  useEffect(() => {
    if (autoMigrate && !isLoading && stats && stats.remaining > 0) {
      const timer = setTimeout(() => {
        handleMigrate();
      }, 2000); // 2s pause between batches
      return () => clearTimeout(timer);
    }
    if (autoMigrate && stats?.remaining === 0) {
      setAutoMigrate(false);
      toast.success("All videos migrated!");
    }
  }, [autoMigrate, isLoading, stats]);

  const checkMigrationStatus = async () => {
    setIsChecking(true);
    try {
      const [{ count: total }, { count: migrated }, { count: remaining }] = await Promise.all([
        supabase.from("videos").select("*", { count: "exact", head: true }),
        supabase.from("videos").select("*", { count: "exact", head: true }).not("cloudflare_video_id", "is", null),
        supabase.from("videos").select("*", { count: "exact", head: true }).is("cloudflare_video_id", null),
      ]);
      setStats({ total: total || 0, migrated: migrated || 0, remaining: remaining || 0 });
    } catch (error) {
      console.error("Error checking migration status:", error);
    } finally {
      setIsChecking(false);
    }
  };

  const handleMigrate = async () => {
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('migrate-videos-cloudflare', {
        body: { limit: 3 }
      });

      if (error) throw new Error(error.message);

      if (data?.results) {
        setResults(prev => [...data.results, ...prev].slice(0, 50));
        setBatchCount(c => c + 1);
        const succeeded = data.results.filter((r: MigrationResult) => r.status === 'migrated').length;
        const failed = data.results.filter((r: MigrationResult) => r.status === 'failed').length;

        if (failed > 0 && autoMigrate) {
          setAutoMigrate(false);
          toast.error(`Auto-migration paused: ${failed} failures in batch`);
        } else if (succeeded > 0 && failed === 0) {
          toast.success(`Batch done: migrated ${succeeded} videos`);
        } else if (succeeded === 0 && failed === 0) {
          toast.info("No videos needed migration");
        }
      }

      await checkMigrationStatus();
    } catch (error) {
      console.error("Migration error:", error);
      toast.error(error instanceof Error ? error.message : "Migration failed");
      setAutoMigrate(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          Cloudflare Stream Migration
        </CardTitle>
        <CardDescription>
          Migrate videos from Cloudinary to Cloudflare Stream for improved performance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isChecking ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking migration status...
          </div>
        ) : stats ? (
          <div className="space-y-3">
            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Migration Progress</span>
                <span className="font-medium">{progressPercent}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-green-500/10">
                <p className="text-lg font-bold text-green-600">{stats.migrated}</p>
                <p className="text-xs text-muted-foreground">Migrated</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-yellow-500/10">
                <p className="text-lg font-bold text-yellow-600">{stats.remaining}</p>
                <p className="text-xs text-muted-foreground">Remaining</p>
              </div>
            </div>

            {stats.remaining === 0 ? (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span>All videos have been migrated to Cloudflare Stream!</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-600">
                <AlertCircle className="h-5 w-5" />
                <span>{stats.remaining} videos still need migration</span>
              </div>
            )}
          </div>
        ) : null}

        {/* Migrate button */}
        <Button
          onClick={handleMigrate}
          disabled={isLoading || stats?.remaining === 0}
          className="w-full"
        >
          {isLoading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Migrating (batch of 10)...</>
          ) : (
            <><RefreshCw className="h-4 w-4 mr-2" />Migrate Next Batch (10 videos)</>
          )}
        </Button>

        {/* Results */}
        {results.length > 0 && (
          <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
            <p className="text-sm font-medium">Results:</p>
            {results.map((result) => (
              <div
                key={result.id}
                className={`text-xs p-2 rounded ${
                  result.status === 'migrated'
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-red-500/10 text-red-600'
                }`}
              >
                <span className="font-mono">{result.id.substring(0, 8)}...</span>
                <span className="ml-2">{result.status}</span>
                {result.error && <span className="ml-2">- {result.error}</span>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
