import { useState, useCallback, createContext, useContext } from "react";
import { Helmet } from "react-helmet-async";

// Context to share entry state
interface EntryGateContextType {
  hasEntered: boolean;
  triggerPlay: () => void;
}

const EntryGateContext = createContext<EntryGateContextType>({
  hasEntered: true,
  triggerPlay: () => {},
});

export const useEntryGate = () => useContext(EntryGateContext);

interface EntryGateProps {
  children: React.ReactNode;
}

export const EntryGate = ({ children }: EntryGateProps) => {
  // Always start fresh on page load - don't persist entry state
  const [hasEntered, setHasEntered] = useState<boolean>(false);
  const [isExiting, setIsExiting] = useState(false);
  const [playTrigger, setPlayTrigger] = useState(0);

  // Trigger video playback after entry
  const triggerPlay = useCallback(() => {
    setPlayTrigger(prev => prev + 1);
  }, []);

  const handleEnter = () => {
    setIsExiting(true);
    setHasEntered(true);
    
    // Trigger play after a tiny delay to ensure state propagates
    setTimeout(() => {
      triggerPlay();
    }, 50);
  };

  const handleLeave = () => {
    window.location.href = "https://google.com";
  };

  const showOverlay = !hasEntered;

  return (
    <EntryGateContext.Provider value={{ hasEntered, triggerPlay }}>
      {/* Preconnect to required domains */}
      <Helmet>
        <link rel="preconnect" href="https://res.cloudinary.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://res.cloudinary.com" />
        <link rel="preconnect" href="https://mbuajcicosojebakdtsn.supabase.co" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://mbuajcicosojebakdtsn.supabase.co" />
      </Helmet>

      {/* App content - ALWAYS rendered, blurred when overlay is shown */}
      <div 
        className={`transition-all duration-300 ${showOverlay ? 'blur-sm brightness-50' : ''}`}
        style={{ pointerEvents: showOverlay ? 'none' : 'auto' }}
      >
        {children}
      </div>

      {/* Overlay - only shown before entry */}
      {showOverlay && (
        <div 
          className={`fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4 transition-opacity duration-200 ${isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
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
