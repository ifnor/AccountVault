import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord } from "../types/vault";
import { getRecordDomain } from "../utils/accountHelpers";

const faviconDataCache = ref<Record<string, string>>({});
const faviconFetchingSet = new Set<string>();
const faviconFailedSet = new Set<string>();

export function useFaviconCache() {
  async function loadCachedFavicons() {
    try {
      const map = await invoke<Record<string, string>>("get_cached_favicons");
      if (map && typeof map === "object") {
        faviconDataCache.value = map;
      }
    } catch (_) {}
  }

  function queueFaviconFetch(domain: string) {
    if (!domain || faviconFetchingSet.has(domain) || faviconFailedSet.has(domain)) return;
    faviconFetchingSet.add(domain);
    invoke<string | null>("fetch_and_cache_favicon", { domain })
      .then((dataUrl) => {
        if (dataUrl) {
          faviconDataCache.value = {
            ...faviconDataCache.value,
            [domain]: dataUrl
          };
        } else {
          faviconFailedSet.add(domain);
        }
      })
      .catch(() => {
        faviconFailedSet.add(domain);
      })
      .finally(() => {
        faviconFetchingSet.delete(domain);
      });
  }

  function getFaviconUrl(r: AccountRecord): string | null {
    const domain = getRecordDomain(r);
    if (!domain) return null;
    const cached = faviconDataCache.value[domain];
    if (cached) return cached;
    queueFaviconFetch(domain);
    return null;
  }

  function handleFaviconError(r: AccountRecord) {
    const domain = getRecordDomain(r);
    if (!domain) return;
    faviconFailedSet.add(domain);
    const next = { ...faviconDataCache.value };
    delete next[domain];
    faviconDataCache.value = next;
  }

  return {
    faviconDataCache,
    loadCachedFavicons,
    queueFaviconFetch,
    getFaviconUrl,
    handleFaviconError
  };
}
