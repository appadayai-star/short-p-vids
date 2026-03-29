/**
 * Performance-based ad rotation.
 *
 * - Ranks ads by CTR (clicks / views).
 * - Splits into top-performing (top 50% by CTR) and test/lower ads.
 * - Picks a top ad ~70% of the time, test ad ~30%.
 * - Never shows the same ad twice in a row.
 */

interface AdWithStats {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  external_link: string;
  views_count?: number;
  clicks_count?: number;
  ctr?: number;
}

export interface Ad {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  external_link: string;
  cloudflare_video_id?: string | null;
}

const TOP_AD_PROBABILITY = 0.7;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Given ads with their stats, build a picker that returns the next ad
 * respecting performance weighting and no-repeat constraint.
 */
export function createAdPicker(ads: Ad[], adStats: Map<string, { views: number; clicks: number }>) {
  if (ads.length === 0) return () => null;
  if (ads.length === 1) return () => ads[0];

  // Calculate CTR for each ad
  const adsWithCtr: AdWithStats[] = ads.map(ad => {
    const stats = adStats.get(ad.id) || { views: 0, clicks: 0 };
    const ctr = stats.views > 0 ? stats.clicks / stats.views : 0;
    return { ...ad, views_count: stats.views, clicks_count: stats.clicks, ctr };
  });

  // Sort by CTR descending
  adsWithCtr.sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0));

  // Split: top half = top performers, bottom half = test ads
  // Ads with 0 views are always "test" so they get exposure
  const splitIndex = Math.max(1, Math.ceil(adsWithCtr.length / 2));

  const topAds: Ad[] = [];
  const testAds: Ad[] = [];

  adsWithCtr.forEach((ad, i) => {
    // Ads with fewer than 10 views go to test pool regardless of position
    if ((ad.views_count ?? 0) < 10) {
      testAds.push(ad);
    } else if (i < splitIndex) {
      topAds.push(ad);
    } else {
      testAds.push(ad);
    }
  });

  // If one pool is empty, everything goes to the other
  if (topAds.length === 0) {
    topAds.push(...testAds);
    testAds.length = 0;
  }
  if (testAds.length === 0) {
    testAds.push(...topAds);
  }

  let lastAdId: string | null = null;

  return (): Ad => {
    const useTop = Math.random() < TOP_AD_PROBABILITY;
    const pool = useTop ? topAds : testAds;

    let candidate = pickRandom(pool);

    // Avoid same ad twice in a row
    if (candidate.id === lastAdId && ads.length > 1) {
      // Try from the other pool first
      const otherPool = useTop ? testAds : topAds;
      const alternatives = otherPool.filter(a => a.id !== lastAdId);
      if (alternatives.length > 0) {
        candidate = pickRandom(alternatives);
      } else {
        // Pick a different one from same pool
        const sameDiff = pool.filter(a => a.id !== lastAdId);
        if (sameDiff.length > 0) candidate = pickRandom(sameDiff);
      }
    }

    lastAdId = candidate.id;
    return candidate;
  };
}
