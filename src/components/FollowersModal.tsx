import { useState, useEffect } from "react";
import { X, Search, UserMinus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
}

interface FollowersModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "followers" | "following";
  currentUserId: string;
  profileId: string;
  isOwnProfile: boolean;
  onCountUpdate?: () => void;
}

export const FollowersModal = ({ 
  isOpen, 
  onClose, 
  type, 
  currentUserId,
  profileId,
  isOwnProfile,
  onCountUpdate
}: FollowersModalProps) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen, type, profileId]);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      if (type === "followers") {
        const { data, error } = await supabase
          .from("follows")
          .select(`
            id,
            follower_id,
            profiles!follows_follower_id_fkey (
              id,
              username,
              avatar_url
            )
          `)
          .eq("following_id", profileId);

        if (error) throw error;
        setUsers(data || []);
      } else {
        const { data, error } = await supabase
          .from("follows")
          .select(`
            id,
            following_id,
            profiles!follows_following_id_fkey (
              id,
              username,
              avatar_url
            )
          `)
          .eq("follower_id", profileId);

        if (error) throw error;
        setUsers(data || []);
      }
    } catch (error) {
      console.error(`Error fetching ${type}:`, error);
      toast.error(`Failed to load ${type}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnfollow = async (followId: string, userId: string) => {
    try {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("id", followId);

      if (error) throw error;

      toast.success("Unfollowed successfully");
      setUsers(users.filter(u => u.id !== followId));
      onCountUpdate?.();
    } catch (error) {
      console.error("Error unfollowing:", error);
      toast.error("Failed to unfollow");
    }
  };

  const handleRemoveFollower = async (followId: string) => {
    try {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("id", followId);

      if (error) throw error;

      toast.success("Follower removed");
      setUsers(users.filter(u => u.id !== followId));
      onCountUpdate?.();
    } catch (error) {
      console.error("Error removing follower:", error);
      toast.error("Failed to remove follower");
    }
  };

  const filteredUsers = users.filter(user => {
    const profile = type === "followers" 
      ? user.profiles 
      : user.profiles;
    return profile?.username.toLowerCase().includes(searchQuery.toLowerCase());
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-black border border-white/10 w-full md:max-w-lg md:rounded-t-2xl rounded-t-2xl h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white capitalize">{type}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
            <Input
              placeholder={`Search ${type}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/50"
            />
          </div>
        </div>

        {/* Users list */}
        <ScrollArea className="flex-1 p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-white/50">Loading...</div>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-white/50">
                {searchQuery ? "No results found" : `No ${type} yet`}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => {
                const profile = type === "followers" 
                  ? user.profiles 
                  : user.profiles;
                const userId = type === "followers" 
                  ? user.follower_id 
                  : user.following_id;

                return (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <div 
                      className="flex items-center gap-3 flex-1 cursor-pointer"
                      onClick={() => {
                        navigate(`/profile/${userId}`);
                        onClose();
                      }}
                    >
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10">
                        {profile?.avatar_url ? (
                          <img
                            src={profile.avatar_url}
                            alt={profile.username}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white font-bold">
                            {profile?.username[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-white">{profile?.username}</p>
                      </div>
                    </div>

                    {isOwnProfile && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (type === "following") {
                            handleUnfollow(user.id, userId);
                          } else {
                            handleRemoveFollower(user.id);
                          }
                        }}
                        className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
};
