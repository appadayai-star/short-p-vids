import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, ArrowLeft, UserPlus, UserMinus } from "lucide-react";

const Profile = () => {
  const navigate = useNavigate();
  const { userId } = useParams();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [myVideos, setMyVideos] = useState<any[]>([]);
  const [likedVideos, setLikedVideos] = useState<any[]>([]);
  const [savedVideos, setSavedVideos] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [totalLikes, setTotalLikes] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const isOwnProfile = !userId || userId === currentUser?.id;

  useEffect(() => {
    checkUser();
  }, [userId]);

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUser(user);

    const profileId = userId || user?.id;
    
    if (!profileId) {
      setIsLoading(false);
      return;
    }

    await fetchProfile(profileId);
    await fetchUserVideos(profileId);
    if (userId && user) {
      await checkFollowStatus(user.id, userId);
    } else if (user) {
      await fetchLikedVideos(user.id);
      await fetchSavedVideos(user.id);
    }
    await fetchFollowing(profileId);
    setIsLoading(false);
  };

  const checkFollowStatus = async (currentUserId: string, targetUserId: string) => {
    const { data } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", currentUserId)
      .eq("following_id", targetUserId)
      .maybeSingle();

    setIsFollowing(!!data);
  };

  const fetchProfile = async (profileId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error("Error fetching profile:", error);
    }
  };

  const fetchUserVideos = async (profileId: string) => {
    try {
      const { data, error } = await supabase
        .from("videos")
        .select("id, title, video_url, views_count, likes_count")
        .eq("user_id", profileId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setMyVideos(data || []);

      const totalLikesCount = data?.reduce((sum, video) => sum + video.likes_count, 0) || 0;
      setTotalLikes(totalLikesCount);
    } catch (error) {
      console.error("Error fetching videos:", error);
    }
  };

  const fetchLikedVideos = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("likes")
        .select(`
          video_id,
          videos (
            id,
            title,
            video_url,
            views_count,
            likes_count
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      const videos = data?.map((like: any) => like.videos).filter(Boolean) || [];
      setLikedVideos(videos);
    } catch (error) {
      console.error("Error fetching liked videos:", error);
    }
  };

  const fetchSavedVideos = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("saved_videos")
        .select(`
          video_id,
          videos (
            id,
            title,
            video_url,
            views_count,
            likes_count
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      const videos = data?.map((save: any) => save.videos).filter(Boolean) || [];
      setSavedVideos(videos);
    } catch (error) {
      console.error("Error fetching saved videos:", error);
    }
  };

  const fetchFollowing = async (profileId: string) => {
    try {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          id,
          following_id,
          profiles!follows_following_id_fkey (
            username,
            avatar_url
          )
        `)
        .eq("follower_id", profileId);

      if (error) throw error;
      setFollowing(data || []);
    } catch (error) {
      console.error("Error fetching following:", error);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/feed");
  };

  const handleFollowToggle = async () => {
    if (!currentUser || !userId) return;

    setIsFollowLoading(true);
    try {
      if (isFollowing) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUser.id)
          .eq("following_id", userId);

        if (error) throw error;
        setIsFollowing(false);
        toast.success("Unfollowed");
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({
            follower_id: currentUser.id,
            following_id: userId,
          });

        if (error) throw error;
        setIsFollowing(true);
        toast.success("Following");
      }
      
      await fetchProfile(userId);
    } catch (error) {
      console.error("Error toggling follow:", error);
      toast.error("Failed to update");
    } finally {
      setIsFollowLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-lg">Profile not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black pb-20">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        {userId && (
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <ArrowLeft className="h-6 w-6 text-white" />
          </button>
        )}
        <h1 className="text-white text-xl font-bold flex-1 text-center">
          {profile?.username}
        </h1>
        {isOwnProfile && (
          <button onClick={handleLogout} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <LogOut className="h-6 w-6 text-white" />
          </button>
        )}
        {!isOwnProfile && !userId && <div className="w-10" />}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Profile Avatar */}
        <div className="flex justify-center mb-4">
          <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-white/20">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.username}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-primary text-primary-foreground text-3xl font-bold">
                {profile.username[0].toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Username */}
        <h2 className="text-white text-center text-2xl font-bold mb-2">@{profile?.username}</h2>
        
        {/* Bio */}
        {profile?.bio && (
          <p className="text-white/50 text-center text-sm mb-6">{profile.bio}</p>
        )}

        {/* Stats */}
        <div className="flex justify-center gap-8 mb-6">
          <div className="text-center">
            <div className="text-white text-xl font-bold">{profile?.following_count || 0}</div>
            <div className="text-white/50 text-xs">Following</div>
          </div>
          <div className="text-center">
            <div className="text-white text-xl font-bold">{profile?.followers_count || 0}</div>
            <div className="text-white/50 text-xs">Followers</div>
          </div>
          <div className="text-center">
            <div className="text-white text-xl font-bold">{totalLikes}</div>
            <div className="text-white/50 text-xs">Likes</div>
          </div>
        </div>

        {/* Action Button */}
        {!isOwnProfile && (
          <Button 
            variant={isFollowing ? "outline" : "default"}
            className="w-full mb-6"
            onClick={handleFollowToggle}
            disabled={isFollowLoading}
          >
            {isFollowing ? (
              <>
                <UserMinus className="h-4 w-4 mr-2" />
                Unfollow
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4 mr-2" />
                Follow
              </>
            )}
          </Button>
        )}

        {/* Tabs */}
        <Tabs defaultValue="videos" className="w-full mt-6">
          <TabsList className="w-full grid bg-transparent border-b border-white/10 rounded-none h-auto p-0" style={{ gridTemplateColumns: isOwnProfile ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)' }}>
            <TabsTrigger 
              value="videos"
              className="text-white/50 data-[state=active]:text-white data-[state=active]:shadow-none data-[state=active]:bg-transparent rounded-none pb-3 border-b-2 border-transparent data-[state=active]:border-white font-semibold transition-all"
            >
              Videos
            </TabsTrigger>
            {isOwnProfile && (
              <TabsTrigger 
                value="liked"
                className="text-white/50 data-[state=active]:text-white data-[state=active]:shadow-none data-[state=active]:bg-transparent rounded-none pb-3 border-b-2 border-transparent data-[state=active]:border-white font-semibold transition-all"
              >
                Liked
              </TabsTrigger>
            )}
            {isOwnProfile && (
              <TabsTrigger 
                value="saved"
                className="text-white/50 data-[state=active]:text-white data-[state=active]:shadow-none data-[state=active]:bg-transparent rounded-none pb-3 border-b-2 border-transparent data-[state=active]:border-white font-semibold transition-all"
              >
                Saved
              </TabsTrigger>
            )}
            <TabsTrigger 
              value="following"
              className="text-white/50 data-[state=active]:text-white data-[state=active]:shadow-none data-[state=active]:bg-transparent rounded-none pb-3 border-b-2 border-transparent data-[state=active]:border-white font-semibold transition-all"
            >
              Following
            </TabsTrigger>
          </TabsList>

          <TabsContent value="videos" className="mt-4">
            <div className="grid grid-cols-3 gap-1">
              {myVideos.length === 0 ? (
                <div className="col-span-3 text-center py-12 text-white/50">
                  No videos yet
                </div>
              ) : (
                myVideos.map((video) => (
                  <div
                    key={video.id}
                    className="aspect-[9/16] bg-white/5 rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative group"
                    onClick={() => navigate(`/video/${video.id}`)}
                  >
                    <video
                      src={video.video_url}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                      <div className="text-white text-xs">
                        <div className="font-semibold">{video.views_count} views</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {isOwnProfile && (
            <TabsContent value="liked" className="mt-4">
              <div className="grid grid-cols-3 gap-1">
                {likedVideos.length === 0 ? (
                  <div className="col-span-3 text-center py-12 text-white/50">
                    No liked videos yet
                  </div>
                ) : (
                  likedVideos.map((video) => (
                    <div
                      key={video.id}
                      className="aspect-[9/16] bg-white/5 rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative group"
                      onClick={() => navigate(`/video/${video.id}`)}
                    >
                      <video
                        src={video.video_url}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                        <div className="text-white text-xs">
                          <div className="font-semibold">{video.views_count} views</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          )}

          {isOwnProfile && (
            <TabsContent value="saved" className="mt-4">
              <div className="grid grid-cols-3 gap-1">
                {savedVideos.length === 0 ? (
                  <div className="col-span-3 text-center py-12 text-white/50">
                    No saved videos yet
                  </div>
                ) : (
                  savedVideos.map((video) => (
                    <div
                      key={video.id}
                      className="aspect-[9/16] bg-white/5 rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative group"
                      onClick={() => navigate(`/video/${video.id}`)}
                    >
                      <video
                        src={video.video_url}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                        <div className="text-white text-xs">
                          <div className="font-semibold">{video.views_count} views</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          )}

          <TabsContent value="following" className="mt-4">
            <div className="space-y-2">
              {following.length === 0 ? (
                <div className="text-center py-12 text-white/50">
                  Not following anyone yet
                </div>
              ) : (
                following.map((follow: any) => (
                  <div
                    key={follow.id}
                    className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                    onClick={() => navigate(`/profile/${follow.following_id}`)}
                  >
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10">
                      {follow.profiles.avatar_url ? (
                        <img
                          src={follow.profiles.avatar_url}
                          alt={follow.profiles.username}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white font-bold">
                          {follow.profiles.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{follow.profiles.username}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <BottomNav 
        onUploadClick={currentUser ? () => setIsUploadOpen(true) : undefined}
        isAuthenticated={!!currentUser}
      />
      
      {currentUser && (
        <UploadModal 
          open={isUploadOpen} 
          onOpenChange={setIsUploadOpen}
          userId={currentUser.id}
        />
      )}
    </div>
  );
};

export default Profile;
