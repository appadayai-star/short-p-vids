// HLS manifest prefetch — network cache warming only
import { getCloudflareStreamUrl } from "@/lib/cloudinary";

const prefetchedManifests = new Set<string>();

export function prefetchHlsManifest(cloudflareVideoId: string | null | undefined): void {
  if (!cloudflareVideoId) return;
  if (prefetchedManifests.has(cloudflareVideoId)) return;
  prefetchedManifests.add(cloudflareVideoId);

  const url = getCloudflareStreamUrl(cloudflareVideoId);
  fetch(url, { priority: 'low' as any, mode: 'cors' })
    .then(res => {
      if (!res.ok) return;
      return res.text();
    })
    .then(manifest => {
      if (!manifest) return;
      const lines = manifest.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const variantUrl = trimmed.startsWith('http')
            ? trimmed
            : new URL(trimmed, url).href;
          fetch(variantUrl, { priority: 'low' as any, mode: 'cors' }).catch(() => {});
          break;
        }
      }
    })
    .catch(() => {});
}

export function resetPrefetchCache(): void {
  prefetchedManifests.clear();
}
