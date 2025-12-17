import { X, Link2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ShareDrawerProps {
  videoTitle: string;
  videoId: string;
  username: string;
  isOpen: boolean;
  onClose: () => void;
}

// Get or create session ID for anonymous tracking
const getSessionId = (): string => {
  const key = 'share_session_id';
  let sessionId = sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = `share_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
};

export const ShareDrawer = ({ videoTitle, videoId, username, isOpen, onClose }: ShareDrawerProps) => {
  const { user } = useAuth();
  const shareUrl = window.location.href;
  const shareText = `Check out this video by @${username}`;

  const trackShare = async (shareType: string) => {
    try {
      await supabase.from("shares").insert({
        video_id: videoId,
        user_id: user?.id || null,
        session_id: user?.id ? null : getSessionId(),
        share_type: shareType,
      });
    } catch (error) {
      console.error("Error tracking share:", error);
    }
  };

  const handleCopyLink = async () => {
    navigator.clipboard.writeText(shareUrl);
    await trackShare("copy_link");
    toast.success("Link copied to clipboard!");
    onClose();
  };

  const handleShareToWhatsApp = async () => {
    await trackShare("whatsapp");
    const url = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
    window.open(url, "_blank");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-background w-full md:max-w-lg md:rounded-t-2xl rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Share</h2>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-14"
            onClick={handleCopyLink}
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Link2 className="h-5 w-5 text-primary" />
            </div>
            <span>Copy link</span>
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-14"
            onClick={handleShareToWhatsApp}
          >
            <div className="w-10 h-10 rounded-full bg-[#25D366]/10 flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-[#25D366]" />
            </div>
            <span>Share to WhatsApp</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
