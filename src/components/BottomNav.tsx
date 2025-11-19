import { Home, PlusSquare, User, LogIn, Inbox, Grid3x3 } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate, useLocation } from "react-router-dom";

interface BottomNavProps {
  onUploadClick?: () => void;
  isAuthenticated: boolean;
  onHomeRefresh?: () => void;
}

export const BottomNav = ({ onUploadClick, isAuthenticated, onHomeRefresh }: BottomNavProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleHomeClick = (e: React.MouseEvent) => {
    if (location.pathname === "/feed" || location.pathname === "/") {
      e.preventDefault();
      onHomeRefresh?.();
    }
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black border-t border-border">
      <div className="flex items-center justify-around h-16 px-2">
        <NavLink
          to="/feed"
          onClick={handleHomeClick}
          className="flex flex-col items-center justify-center gap-1 text-white/70 hover:text-white transition-colors min-w-[60px]"
          activeClassName="text-primary"
        >
          <Home className="h-6 w-6" />
          <span className="text-xs">Home</span>
        </NavLink>

        <NavLink
          to="/categories"
          className="flex flex-col items-center justify-center gap-1 text-white/70 hover:text-white transition-colors min-w-[60px]"
          activeClassName="text-primary"
        >
          <Grid3x3 className="h-6 w-6" />
          <span className="text-xs">Categories</span>
        </NavLink>

        {isAuthenticated && onUploadClick && (
          <button
            onClick={onUploadClick}
            className="relative -mt-4 mx-2"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-primary rounded-xl blur-sm"></div>
              <div className="relative bg-primary text-black p-3 rounded-xl hover:scale-105 transition-transform">
                <PlusSquare className="h-8 w-8" />
              </div>
            </div>
          </button>
        )}

        <NavLink
          to="/inbox"
          className="flex flex-col items-center justify-center gap-1 text-white/70 hover:text-white transition-colors min-w-[60px]"
          activeClassName="text-primary"
        >
          <Inbox className="h-6 w-6" />
          <span className="text-xs">Inbox</span>
        </NavLink>

        {isAuthenticated ? (
          <NavLink
            to="/profile"
            className="flex flex-col items-center justify-center gap-1 text-white/70 hover:text-white transition-colors min-w-[60px]"
            activeClassName="text-primary"
          >
            <User className="h-6 w-6" />
            <span className="text-xs">Profile</span>
          </NavLink>
        ) : (
          <button
            onClick={() => navigate("/auth")}
            className="flex flex-col items-center justify-center gap-1 text-white/70 hover:text-white transition-colors min-w-[60px]"
          >
            <LogIn className="h-6 w-6" />
            <span className="text-xs">Login</span>
          </button>
        )}
      </div>
    </nav>
  );
};
