import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { Grid3x3, Search } from "lucide-react";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";

const Categories = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const unreadCount = useUnreadNotifications(user?.id || null);

  const categories = [
    { id: "beauty", name: "Beauty" },
    { id: "real", name: "Real" },
    { id: "public", name: "Public" },
    { id: "homemade", name: "Homemade" },
    { id: "pov", name: "POV" },
    { id: "mom", name: "Mom" },
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

        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          Most Popular 🔥
        </h2>

        <div className="grid grid-cols-2 gap-4">
          {categories.map((category) => (
            <button
              key={category.id}
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
