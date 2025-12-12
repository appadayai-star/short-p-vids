import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { Helmet } from "react-helmet-async";

const STORAGE_KEY = "shortpv_entered";

// Context to share entry state and trigger video warm-up
interface EntryGateContextType {
  hasEntered: boolean;
  isReady: boolean;
  triggerWarmUp: () => void;
}

const EntryGateContext = createContext<EntryGateContextType>({
  hasEntered: true,
  isReady: true,
  triggerWarmUp: () => {},
});

export const useEntryGate = () => useContext(EntryGateContext);

interface EntryGateProps {
  children: React.ReactNode;
}

export const EntryGate = ({ children }: EntryGateProps) => {
  const [hasEntered, setHasEntered] = useState<boolean>(() => {
    // Check localStorage synchronously to avoid flash
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY) === "true";
    }
    return false;
  });
  const [isReady, setIsReady] = useState(hasEntered);
  const [isExiting, setIsExiting] = useState(false);

  // Warm-up callback that VideoFeed will use
  const triggerWarmUp = useCallback(() => {
    // This signals the feed that user has entered and videos should start loading
    setIsReady(true);
  }, []);

  const handleEnter = () => {
    // Save to localStorage immediately
    localStorage.setItem(STORAGE_KEY, "true");
    
    // Start exit animation
    setIsExiting(true);
    
    // Mark as entered and ready simultaneously for instant response
    setHasEntered(true);
    setIsReady(true);
  };

  const handleLeave = () => {
    window.location.href = "https://google.com";
  };

  // If already entered, skip overlay entirely
  if (hasEntered && !isExiting) {
    return (
      <EntryGateContext.Provider value={{ hasEntered: true, isReady: true, triggerWarmUp }}>
        {children}
      </EntryGateContext.Provider>
    );
  }

  return (
    <EntryGateContext.Provider value={{ hasEntered, isReady, triggerWarmUp }}>
      {/* Preconnect to required domains */}
      <Helmet>
        <link rel="preconnect" href="https://res.cloudinary.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://res.cloudinary.com" />
        <link rel="preconnect" href="https://mbuajcicosojebakdtsn.supabase.co" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://mbuajcicosojebakdtsn.supabase.co" />
      </Helmet>

      {/* App content rendered behind overlay - visible but dimmed/blurred */}
      <div 
        className={`transition-all duration-300 ${!hasEntered ? 'blur-sm brightness-50 pointer-events-none' : ''}`}
        aria-hidden={!hasEntered}
      >
        {children}
      </div>

      {/* Overlay - only shown before entry */}
      {!hasEntered && (
        <div 
          className={`fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 ${isExiting ? 'opacity-0' : 'opacity-100'}`}
        >
          <div className="bg-card border border-border rounded-2xl p-8 max-w-md w-full text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h1 className="text-2xl font-bold text-foreground mb-4">This is an adult website</h1>

            <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
              This website contains age-restricted materials. By entering you affirm that you are at least 18 years of
              age.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleEnter}
                className="w-full py-3 px-6 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors active:scale-[0.98]"
              >
                Enter
              </button>

              <button
                onClick={handleLeave}
                className="w-full py-3 px-6 bg-muted text-muted-foreground font-medium rounded-xl hover:bg-muted/80 transition-colors"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </EntryGateContext.Provider>
  );
};
