import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { VideoFeed } from "@/components/VideoFeed";
import { UploadModal } from "@/components/UploadModal";

const Feed = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      }
    });

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  if (!user || !session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar 
        onUploadClick={() => setIsUploadOpen(true)} 
        onSearch={setSearchQuery}
      />
      <VideoFeed searchQuery={searchQuery} userId={user.id} />
      <UploadModal 
        open={isUploadOpen} 
        onOpenChange={setIsUploadOpen}
        userId={user.id}
      />
    </div>
  );
};

export default Feed;
