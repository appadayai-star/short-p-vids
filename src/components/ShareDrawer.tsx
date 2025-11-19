import { X, Link2, Facebook, Twitter, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";

interface ShareDrawerProps {
  videoTitle: string;
  username: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ShareDrawer = ({ videoTitle, username, isOpen, onClose }: ShareDrawerProps) => {
  const shareUrl = window.location.href;
  const shareText = `Check out this video by @${username}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success("Link copied to clipboard!");
    onClose();
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: videoTitle,
          text: shareText,
          url: shareUrl,
        });
        onClose();
      } catch (error) {
        console.log("Share cancelled");
      }
    }
  };

  const handleShareToTwitter = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank");
    onClose();
  };

  const handleShareToFacebook = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank");
    onClose();
  };

  const handleShareToWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
    window.open(url, "_blank");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-background w-full md:max-w-lg md:rounded-t-2xl rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Share</h2>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {navigator.share && (
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 h-14"
              onClick={handleNativeShare}
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Share2 className="h-5 w-5 text-primary" />
              </div>
              <span>Share via...</span>
            </Button>
          )}

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
            onClick={handleShareToTwitter}
          >
            <div className="w-10 h-10 rounded-full bg-[#1DA1F2]/10 flex items-center justify-center">
              <Twitter className="h-5 w-5 text-[#1DA1F2]" />
            </div>
            <span>Share to Twitter</span>
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-14"
            onClick={handleShareToFacebook}
          >
            <div className="w-10 h-10 rounded-full bg-[#1877F2]/10 flex items-center justify-center">
              <Facebook className="h-5 w-5 text-[#1877F2]" />
            </div>
            <span>Share to Facebook</span>
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
