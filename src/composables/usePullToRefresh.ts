import { ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord } from "../types/vault";
import { useToast } from "./useToast";

export function usePullToRefresh(
  records: Ref<AccountRecord[]>,
  webdavUrl: Ref<string>,
  triggerSmartSync: (silent: boolean) => Promise<void>,
  loadCachedFavicons: () => Promise<void>
) {
  const { notify } = useToast();

  const listScrollRef = ref<HTMLElement | null>(null);
  const pullDistance = ref(0);
  const isPullRefreshing = ref(false);
  let pullStartY = 0;
  let isPullTracking = false;

  function onListTouchStart(e: TouchEvent) {
    if (isPullRefreshing.value) return;
    const el = listScrollRef.value;
    if (!el || el.scrollTop > 2) return;
    pullStartY = e.touches[0]?.clientY || 0;
    isPullTracking = true;
  }

  function onListTouchMove(e: TouchEvent) {
    if (!isPullTracking || isPullRefreshing.value) return;
    const el = listScrollRef.value;
    if (!el || el.scrollTop > 2) {
      isPullTracking = false;
      pullDistance.value = 0;
      return;
    }
    const dy = (e.touches[0]?.clientY || 0) - pullStartY;
    if (dy > 0) {
      pullDistance.value = Math.min(84, Math.round(dy * 0.48));
    } else {
      pullDistance.value = 0;
    }
  }

  async function onListTouchEnd() {
    if (!isPullTracking) return;
    isPullTracking = false;
    if (pullDistance.value >= 52 && !isPullRefreshing.value) {
      isPullRefreshing.value = true;
      pullDistance.value = 44;
      try {
        if (webdavUrl.value) {
          await triggerSmartSync(false);
        } else {
          records.value = await invoke<AccountRecord[]>("get_records");
          await loadCachedFavicons();
          notify("已刷新本地账号列表", "success", 1500);
        }
      } catch (_) {
      } finally {
        isPullRefreshing.value = false;
        pullDistance.value = 0;
      }
    } else {
      pullDistance.value = 0;
    }
  }

  return {
    listScrollRef,
    pullDistance,
    isPullRefreshing,
    onListTouchStart,
    onListTouchMove,
    onListTouchEnd
  };
}
