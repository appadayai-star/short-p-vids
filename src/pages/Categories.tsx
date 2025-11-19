import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { Grid3x3, Search } from "lucide-react";

const Categories = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // Placeholder categories - these will be customizable
  const categories = [
    { id: "comedy", name: "Comedy", emoji: "😂" },
    { id: "dance", name: "Dance", emoji: "💃" },
    { id: "music", name: "Music", emoji: "🎵" },
    { id: "food", name: "Food", emoji: "🍔" },
    { id: "sports", name: "Sports", emoji: "⚽" },
    { id: "gaming", name: "Gaming", emoji: "🎮" },
    { id: "fashion", name: "Fashion", emoji: "👗" },
    { id: "beauty", name: "Beauty", emoji: "💄" },
    { id: "travel", name: "Travel", emoji: "✈️" },
    { id: "fitness", name: "Fitness", emoji: "💪" },
    { id: "education", name: "Education", emoji: "📚" },
    { id: "art", name: "Art", emoji: "🎨" },
  ];

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

  return (
    <div className="min-h-screen bg-black pb-20">
      <div className="container max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-8">
          <Grid3x3 className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-white">Categories</h1>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {categories.map((category) => (
            <button
              key={category.id}
              className="aspect-square bg-white/5 rounded-2xl border-2 border-white/10 hover:border-primary transition-colors flex flex-col items-center justify-center gap-4 group"
            >
              <span className="text-6xl group-hover:scale-110 transition-transform">
                {category.emoji}
              </span>
              <span className="text-lg font-semibold text-white group-hover:text-primary transition-colors">
                {category.name}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-12 p-6 bg-white/5 rounded-xl border border-white/10">
          <h2 className="text-xl font-semibold text-primary mb-3">Coming Soon</h2>
          <p className="text-white/50">
            Custom categories will be available soon. Each category will have its own curated feed of videos!
          </p>
        </div>
      </div>

      <BottomNav 
        onUploadClick={user ? () => setIsUploadOpen(true) : undefined} 
        isAuthenticated={!!user}
        onHomeRefresh={undefined}
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
