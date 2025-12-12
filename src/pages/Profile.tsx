import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { UploadModal } from "@/components/UploadModal";
import { FollowersModal } from "@/components/FollowersModal";
import { VideoModal } from "@/components/VideoModal";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, ArrowLeft, UserPlus, UserMinus, Search, Camera, Loader2 } from "lucide-react";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Profile = () => {
  const navigate = useNavigate();
  const { userId } = useParams();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [myVideos, setMyVideos] = useState<any[]>([]);
  const [likedVideos, setLikedVideos] = useState<any[]>([]);
  const [savedVideos, setSavedVideos] = useState<any[]>([]);
  const [totalLikes, setTotalLikes] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [followersModalOpen, setFollowersModalOpen] = useState(false);
  const [followersModalType, setFollowersModalType] = useState<"followers" | "following">("followers");
  const unreadCount = useUnreadNotifications(currentUser?.id || null);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const isOwnProfile = !userId || userId === currentUser?.id;

  useEffect(() => {
    checkUser();
  }, [userId]);

  const checkUser = async () => {
    try {
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
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setIsLoading(false);
    }
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
        .select(`
          id,
          title,
          description,
          video_url,
          optimized_video_url,
          stream_url,
          thumbnail_url,
          views_count,
          likes_count,
          comments_count,
          user_id,
          tags,
          profiles (
            username,
            avatar_url
          )
        `)
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
            description,
            video_url,
            views_count,
            likes_count,
            comments_count,
            user_id,
            tags,
            profiles (
              username,
              avatar_url
            )
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
            description,
            video_url,
            views_count,
            likes_count,
            comments_count,
            user_id,
            tags,
            profiles (
              username,
              avatar_url
            )
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

  const handleDeleteVideo = async (videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm("Are you sure you want to delete this video?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from("videos")
        .delete()
        .eq("id", videoId);

      if (error) throw error;

      toast.success("Video deleted successfully");
      setMyVideos(myVideos.filter(v => v.id !== videoId));
    } catch (error: any) {
      toast.error(error.message || "Failed to delete video");
      console.error("Delete error:", error);
    }
  };

  const handleAvatarClick = () => {
    if (isOwnProfile && avatarInputRef.current) {
      avatarInputRef.current.click();
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setIsUploadingAvatar(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}/avatar.${fileExt}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Add cache-busting parameter
      const avatarUrl = `${publicUrl}?t=${Date.now()}`;

      // Update profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', currentUser.id);

      if (updateError) throw updateError;

      setProfile({ ...profile, avatar_url: avatarUrl });
      toast.success("Profile picture updated!");
    } catch (error: any) {
      console.error("Avatar upload error:", error);
      toast.error(error.message || "Failed to upload avatar");
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
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
      <SEO 
        title={profile?.username ? `@${profile.username}` : "Profile"}
        description={profile?.bio || `Check out ${profile?.username || 'this user'}'s videos on ShortPV`}
        type="profile"
      />
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          {userId && (
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <ArrowLeft className="h-6 w-6 text-white" />
            </button>
          )}
          <h1 className="text-white text-xl font-bold">
            {isOwnProfile ? "Profile" : profile?.username}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/search")}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <Search className="h-6 w-6 text-white" />
          </button>
          {isOwnProfile && (
            <button onClick={handleLogout} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <LogOut className="h-6 w-6 text-white" />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Hidden file input for avatar upload */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarUpload}
          className="hidden"
        />

        {/* Profile Avatar */}
        <div className="flex justify-center mb-4">
          <div 
            className={`relative w-24 h-24 rounded-full overflow-hidden border-2 border-white/20 ${isOwnProfile ? 'cursor-pointer group' : ''}`}
            onClick={handleAvatarClick}
          >
            {isUploadingAvatar ? (
              <div className="w-full h-full flex items-center justify-center bg-black/50">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : profile?.avatar_url ? (
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
            
            {/* Camera overlay for own profile */}
            {isOwnProfile && !isUploadingAvatar && (
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="h-8 w-8 text-white" />
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
          <button
            onClick={() => {
              setFollowersModalType("following");
              setFollowersModalOpen(true);
            }}
            className="text-center hover:opacity-80 transition-opacity"
          >
            <div className="text-white text-xl font-bold">{profile?.following_count || 0}</div>
            <div className="text-white/50 text-xs">Following</div>
          </button>
          <button
            onClick={() => {
              setFollowersModalType("followers");
              setFollowersModalOpen(true);
            }}
            className="text-center hover:opacity-80 transition-opacity"
          >
            <div className="text-white text-xl font-bold">{profile?.followers_count || 0}</div>
            <div className="text-white/50 text-xs">Followers</div>
          </button>
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
          <TabsList className="w-full grid bg-transparent border-b border-white/10 rounded-none h-auto p-0" style={{ gridTemplateColumns: isOwnProfile ? 'repeat(3, 1fr)' : 'repeat(1, 1fr)' }}>
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
                    onClick={() => {
                      setSelectedVideoId(video.id);
                      setVideoModalOpen(true);
                    }}
                  >
                    <video
                      src={video.video_url}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <div className="text-white text-xs font-semibold">{video.views_count} views</div>
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
                      className="aspect-[9/16] bg-white/5 rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative"
                      onClick={() => {
                        setSelectedVideoId(video.id);
                        setVideoModalOpen(true);
                      }}
                    >
                      <video
                        src={video.video_url}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <div className="text-white text-xs font-semibold">{video.views_count} views</div>
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
                      className="aspect-[9/16] bg-white/5 rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative"
                      onClick={() => {
                        setSelectedVideoId(video.id);
                        setVideoModalOpen(true);
                      }}
                    >
                      <video
                        src={video.video_url}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <div className="text-white text-xs font-semibold">{video.views_count} views</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          )}

        </Tabs>
      </div>

      <BottomNav 
        onUploadClick={currentUser ? () => setIsUploadOpen(true) : undefined}
        isAuthenticated={!!currentUser}
        onHomeRefresh={undefined}
        unreadCount={unreadCount}
      />
      
      {currentUser && (
        <UploadModal 
          open={isUploadOpen} 
          onOpenChange={setIsUploadOpen}
          userId={currentUser.id}
        />
      )}

      <FollowersModal
        isOpen={followersModalOpen}
        onClose={() => setFollowersModalOpen(false)}
        type={followersModalType}
        currentUserId={currentUser?.id || ""}
        profileId={profile?.id || ""}
        isOwnProfile={isOwnProfile}
        onCountUpdate={() => {
          if (profile?.id) {
            fetchProfile(profile.id);
          }
        }}
      />

      {selectedVideoId && (
        <VideoModal
          isOpen={videoModalOpen}
          onClose={() => {
            setVideoModalOpen(false);
            setSelectedVideoId(null);
          }}
          initialVideoId={selectedVideoId}
          userId={currentUser?.id || null}
          videos={[...myVideos, ...likedVideos, ...savedVideos].find(v => v.id === selectedVideoId) ? [[...myVideos, ...likedVideos, ...savedVideos].find(v => v.id === selectedVideoId)!] : undefined}
        />
      )}
    </div>
  );
};

export default Profile;
