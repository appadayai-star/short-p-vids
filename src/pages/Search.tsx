import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { Input } from "@/components/ui/input";
import { Search as SearchIcon, TrendingUp, Clock } from "lucide-react";
import { toast } from "sonner";

interface Video {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  views_count: number;
  likes_count: number;
  profiles: {
    username: string;
    avatar_url: string | null;
  };
}

const Search = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Video[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [trendingHashtags, setTrendingHashtags] = useState<string[]>([]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    // Load recent searches from localStorage
    const saved = localStorage.getItem("recentSearches");
    if (saved) {
      setRecentSearches(JSON.parse(saved));
    }

    // Fetch trending hashtags
    fetchTrendingHashtags();
  }, []);

  const fetchTrendingHashtags = async () => {
    try {
      const { data, error } = await supabase
        .from("videos")
        .select("tags")
        .not("tags", "is", null)
        .order("likes_count", { ascending: false })
        .limit(50);

      if (error) throw error;

      // Aggregate all tags
      const allTags: string[] = [];
      data?.forEach((video) => {
        if (video.tags) {
          allTags.push(...video.tags);
        }
      });

      // Count occurrences
      const tagCounts = allTags.reduce((acc, tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Get top 10
      const trending = Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag]) => tag);

      setTrendingHashtags(trending);
    } catch (error) {
      console.error("Error fetching trending:", error);
    }
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setSearchQuery(query);

    // Save to recent searches
    const updated = [query, ...recentSearches.filter((s) => s !== query)].slice(0, 10);
    setRecentSearches(updated);
    localStorage.setItem("recentSearches", JSON.stringify(updated));

    try {
      const { data, error } = await supabase
        .from("videos")
        .select(`
          id,
          title,
          video_url,
          thumbnail_url,
          views_count,
          likes_count,
          profiles!inner(username, avatar_url)
        `)
        .or(`title.ilike.%${query}%,tags.cs.{${query}},profiles.username.ilike.%${query}%`)
        .order("likes_count", { ascending: false })
        .limit(20);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error: any) {
      toast.error("Search failed");
      console.error(error);
    } finally {
      setIsSearching(false);
    }
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem("recentSearches");
  };

  return (
    <div className="min-h-screen bg-black pb-20">
      {/* Search bar */}
      <div className="sticky top-0 z-40 bg-black border-b border-border p-4">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search videos, users, hashtags..."
            className="pl-10 bg-secondary border-border text-foreground h-12"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="container max-w-2xl mx-auto px-4 py-6">
        {/* Search Results */}
        {searchQuery && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              {isSearching ? "Searching..." : `${searchResults.length} results`}
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {searchResults.map((video) => (
                <button
                  key={video.id}
                  onClick={() => navigate("/feed")}
                  className="aspect-[9/16] bg-muted rounded-lg overflow-hidden relative group"
                >
                  <video
                    src={video.video_url}
                    className="w-full h-full object-cover"
                    preload="metadata"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                    <div className="text-white text-xs">
                      <p className="font-semibold line-clamp-2">{video.title}</p>
                      <p className="text-white/70">@{video.profiles.username}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Trending Hashtags */}
        {!searchQuery && trendingHashtags.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <TrendingUp className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Trending Hashtags</h2>
            </div>
            <div className="space-y-2">
              {trendingHashtags.map((tag, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSearch(tag)}
                  className="w-full flex items-center justify-between p-4 bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-primary font-bold text-xl">#{idx + 1}</span>
                    <span className="text-foreground font-semibold">#{tag}</span>
                  </div>
                  <TrendingUp className="h-4 w-4 text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent Searches */}
        {!searchQuery && recentSearches.length > 0 && (
          <div className="space-y-4 mt-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-foreground">
                <Clock className="h-5 w-5" />
                <h2 className="text-lg font-semibold">Recent Searches</h2>
              </div>
              <button
                onClick={clearRecentSearches}
                className="text-sm text-primary hover:underline"
              >
                Clear all
              </button>
            </div>
            <div className="space-y-2">
              {recentSearches.map((search, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSearch(search)}
                  className="w-full text-left p-4 bg-secondary rounded-lg hover:bg-secondary/80 transition-colors text-foreground"
                >
                  {search}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <BottomNav 
        onUploadClick={user ? () => setIsUploadOpen(true) : undefined} 
        isAuthenticated={!!user} 
      />
      {user && (
        <UploadModal 
          open={isUploadOpen} 
          onOpenChange={setIsUploadOpen}
          userId={user.id}
        />
      )}
    </div>
  );
};

export default Search;
