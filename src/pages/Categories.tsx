import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { SEO } from "@/components/SEO";
import { Grid3x3 } from "lucide-react";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";

const ALL_CATEGORIES = [
  { id: "beauty", name: "Beauty" },
  { id: "real", name: "Real" },
  { id: "public", name: "Public" },
  { id: "homemade", name: "Homemade" },
  { id: "pov", name: "POV" },
  { id: "mom", name: "Mom" },
  { id: "milf", name: "MILF" },
  { id: "amateur", name: "Amateur" },
  { id: "latina", name: "Latina" },
  { id: "asian", name: "Asian" },
  { id: "big_ass", name: "Big Ass" },
  { id: "big_tits", name: "Big Tits" },
  { id: "lesbian", name: "Lesbian" },
  { id: "blonde", name: "Blonde" },
  { id: "brunettes", name: "Brunettes" },
  { id: "red_head", name: "Red Head" },
  { id: "small", name: "Small" },
  { id: "stepsis", name: "Stepsis" },
  { id: "snowbunny", name: "Snowbunny" },
  { id: "blowjob", name: "Blowjob" },
];

const Categories = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [categories, setCategories] = useState<typeof ALL_CATEGORIES>([]);
  const [loading, setLoading] = useState(true);
  const unreadCount = useUnreadNotifications(user?.id || null);

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
    const fetchCategoryCounts = async () => {
      setLoading(true);
      // Fetch all videos' tags to count per category
      const { data: videos } = await supabase
        .from("videos")
        .select("tags");

      const counts: Record<string, number> = {};
      if (videos) {
        for (const v of videos) {
          if (v.tags) {
            for (const tag of v.tags) {
              counts[tag] = (counts[tag] || 0) + 1;
            }
          }
        }
      }

      setCategories(ALL_CATEGORIES.filter(c => (counts[c.id] || 0) >= 20));
      setLoading(false);
    };

    fetchCategoryCounts();
  }, []);

  return (
    <div className="min-h-screen bg-black pb-20">
      <SEO 
        title="Categories"
        description="Browse videos by category - Beauty, Real, Public, Homemade, POV, and more on ShortPV"
      />
      <div className="container max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-8">
          <Grid3x3 className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-white">Categories</h1>
        </div>

        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          Most Popular 🔥
        </h2>

        <div className="grid grid-cols-2 gap-4">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={async () => {
                // Track category click
                const sessionId = sessionStorage.getItem("session_id") || crypto.randomUUID();
                sessionStorage.setItem("session_id", sessionId);
                await supabase.from("category_clicks").insert({
                  category: category.id,
                  user_id: user?.id || null,
                  session_id: sessionId,
                });
                navigate(`/?category=${encodeURIComponent(category.id)}`);
              }}
              className="aspect-square bg-white/5 rounded-2xl border-2 border-white/10 hover:border-primary transition-colors flex items-center justify-center group"
            >
              <span className="text-xl font-semibold text-white group-hover:text-primary transition-colors">
                {category.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <BottomNav 
        onUploadClick={user ? () => setIsUploadOpen(true) : undefined} 
        isAuthenticated={!!user}
        onHomeRefresh={undefined}
        unreadCount={unreadCount}
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

export default Categories;
