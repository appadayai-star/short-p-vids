import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";

interface ReprocessResult {
  id: string;
  status: string;
  error?: string;
}

export function AdminReprocess() {
  const [isLoading, setIsLoading] = useState(false);
  const [videosMissing, setVideosMissing] = useState<number | null>(null);
  const [results, setResults] = useState<ReprocessResult[]>([]);
  const [isChecking, setIsChecking] = useState(true);

  // Check how many videos need reprocessing
  useEffect(() => {
    checkMissingVideos();
  }, []);

  const checkMissingVideos = async () => {
    setIsChecking(true);
    try {
      const { count, error } = await supabase
        .from("videos")
        .select("*", { count: "exact", head: true })
        .is("cloudinary_public_id", null);

      if (error) throw error;
      setVideosMissing(count || 0);
    } catch (error) {
      console.error("Error checking videos:", error);
      setVideosMissing(null);
    } finally {
      setIsChecking(false);
    }
  };

  const handleReprocess = async () => {
    setIsLoading(true);
    setResults([]);

    try {
      const { data, error } = await supabase.functions.invoke('batch-reprocess-videos');

      if (error) {
        throw new Error(error.message);
      }

      if (data?.results) {
        setResults(data.results);
        const succeeded = data.results.filter((r: ReprocessResult) => r.status === 'completed').length;
        const failed = data.results.filter((r: ReprocessResult) => r.status === 'failed').length;
        
        if (succeeded > 0 && failed === 0) {
          toast.success(`Successfully reprocessed ${succeeded} videos`);
        } else if (succeeded > 0 && failed > 0) {
          toast.warning(`Reprocessed ${succeeded} videos, ${failed} failed`);
        } else if (failed > 0) {
          toast.error(`Failed to reprocess ${failed} videos`);
        } else {
          toast.info("No videos needed reprocessing");
        }
      }

      // Refresh the count
      await checkMissingVideos();
    } catch (error) {
      console.error("Reprocess error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to reprocess videos");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Video Reprocessing
        </CardTitle>
        <CardDescription>
          Reprocess existing videos to enable Cloudinary CDN thumbnails and optimized playback
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status banner */}
        {isChecking ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking videos...
          </div>
        ) : videosMissing !== null && videosMissing > 0 ? (
          <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-600">
            <AlertCircle className="h-5 w-5" />
            <span>{videosMissing} videos are missing Cloudinary processing</span>
          </div>
        ) : videosMissing === 0 ? (
          <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-600">
            <CheckCircle className="h-5 w-5" />
            <span>All videos have been processed</span>
          </div>
        ) : null}

        {/* Reprocess button */}
        <Button 
          onClick={handleReprocess} 
          disabled={isLoading || videosMissing === 0}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Reprocessing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reprocess Existing Videos
            </>
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
                  result.status === 'completed' 
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
