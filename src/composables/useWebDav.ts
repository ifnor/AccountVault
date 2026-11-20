import { computed, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord } from "../types/vault";
import { useToast } from "./useToast";
import { useConfirm } from "./useConfirm";

export interface SmartSyncResult {
  synced: boolean;
  message: string;
  records_updated: boolean;
  records_count: number;
  last_sync_time: number;
}

export type SyncState = "idle" | "syncing" | "success" | "error";

export function useWebDav(
  records: Ref<AccountRecord[]>,
  selectedId: Ref<string | null>,
  autoSelectFirst: Ref<boolean>,
  updateAllTotp: () => void
) {
  const { notify } = useToast();
  const { askConfirm } = useConfirm();

  const webdavForm = ref({
    url: "",
    username: "",
    password: "",
    auto_sync: true,
    last_sync_time: null as number | null,
    last_etag: null as string | null
  });
  const webdavStatus = ref("");
  const isWebDavSyncing = ref(false);
  const syncState = ref<SyncState>("idle");
  const syncTooltip = ref<string>("WebDAV 云端同步就绪");

  let isSyncingSmart = false;
  let debouncedSyncTimer: ReturnType<typeof setTimeout> | null = null;

  const lastSyncTimeFormatted = computed(() => {
    if (!webdavForm.value.last_sync_time) return "从未同步";
    const d = new Date(webdavForm.value.last_sync_time);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 60) return "刚刚";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${mins}`;
  });

  async function loadWebDavConfig() {
    try {
      const saved = await invoke<any>("load_webdav_config");
      if (saved && (saved.url || saved.username || saved.password)) {
        webdavForm.value = {
          url: saved.url || "",
          username: saved.username || "",
          password: saved.password || "",
          auto_sync: saved.auto_sync !== false,
          last_sync_time: saved.last_sync_time || null,
          last_etag: saved.last_etag || null
        };
        try {
          localStorage.setItem("avault_webdav_config", JSON.stringify(webdavForm.value));
        } catch (_) {}
        return;
      }
    } catch (_) {}

    try {
      const localStr = localStorage.getItem("avault_webdav_config");
      if (localStr) {
        const parsed = JSON.parse(localStr);
        if (parsed && (parsed.url || parsed.username || parsed.password)) {
          webdavForm.value = {
            url: parsed.url || "",
            username: parsed.username || "",
            password: parsed.password || "",
            auto_sync: parsed.auto_sync !== false,
            last_sync_time: parsed.last_sync_time || null,
            last_etag: parsed.last_etag || null
          };
        }
      }
    } catch (_) {}
  }

  async function handleSaveWebDavConfig(notifyUser = true) {
    try {
      await invoke("save_webdav_config", { config: webdavForm.value });
      try {
        localStorage.setItem("avault_webdav_config", JSON.stringify(webdavForm.value));
      } catch (_) {}
      if (notifyUser) {
        webdavStatus.value = "✅ 配置已成功保存到本地安全存储";
        notify("WebDAV 配置已保存", "success", 2500);
      }
    } catch (err: any) {
      webdavStatus.value = "❌ 保存失败: " + err;
      if (notifyUser) notify("保存 WebDAV 配置失败: " + err, "error");
    }
  }

  async function triggerSmartSync(silent = false) {
    if (isSyncingSmart) return;
    if (!webdavForm.value.url.trim() || !webdavForm.value.username.trim() || !webdavForm.value.password.trim()) {
      syncState.value = "idle";
      syncTooltip.value = "未配置 WebDAV 云端同步";
      if (!silent) {
        notify("请先在「设置 -> 云端同步」中配置服务器地址与密码", "warning");
      }
      return;
    }
    if (silent && !webdavForm.value.auto_sync) {
      return;
    }

    isSyncingSmart = true;
    isWebDavSyncing.value = true;
    syncState.value = "syncing";
    syncTooltip.value = "正在智能检测并同步云端数据...";

    try {
      const res = await invoke<SmartSyncResult>("sync_webdav_smart");
      if (res.synced) {
        syncState.value = "success";
        webdavForm.value.last_sync_time = res.last_sync_time;
        syncTooltip.value = res.message;
        if (res.records_updated) {
          records.value = await invoke<AccountRecord[]>("get_records");
          updateAllTotp();
          if (!silent) {
            notify(`🎉 ${res.message} (当前共 ${res.records_count} 个有效账号)`, "success", 3000);
          }
        } else if (!silent) {
          notify(res.message, "success", 2500);
        }
      } else {
        syncState.value = "idle";
        syncTooltip.value = res.message;
        if (!silent) {
          notify(res.message, "info", 2500);
        }
      }
    } catch (err: any) {
      syncState.value = "error";
      const errStr = typeof err === "string" ? err : err?.message || "网络请求异常";
      syncTooltip.value = `同步失败: ${errStr}`;
      if (!silent) {
        notify(`云同步失败: ${errStr}`, "error", 4000);
      }
    } finally {
      isSyncingSmart = false;
      isWebDavSyncing.value = false;
      if (syncState.value === "success") {
        setTimeout(() => {
          if (syncState.value === "success") {
            syncState.value = "idle";
            syncTooltip.value = `云端同步正常 (上次: ${lastSyncTimeFormatted.value})`;
          }
        }, 3500);
      }
    }
  }

  function triggerDebouncedSync() {
    if (!webdavForm.value.auto_sync || !webdavForm.value.url.trim()) return;
    if (debouncedSyncTimer) clearTimeout(debouncedSyncTimer);
    debouncedSyncTimer = setTimeout(() => {
      triggerSmartSync(true);
    }, 1500);
  }

  async function handleTestWebDav() {
    if (!webdavForm.value.url.trim()) return;
    await handleSaveWebDavConfig(false);
    isWebDavSyncing.value = true;
    webdavStatus.value = "正在连接 WebDAV 服务器...";
    try {
      const msg = await invoke<string>("test_webdav_connection", { config: webdavForm.value });
      webdavStatus.value = "✅ " + msg;
    } catch (err: any) {
      webdavStatus.value = "❌ " + err;
    } finally {
      isWebDavSyncing.value = false;
    }
  }

  async function handleUploadWebDav() {
    isWebDavSyncing.value = true;
    webdavStatus.value = "正在上传加密保险库至云端...";
    try {
      await handleSaveWebDavConfig(false);
      await invoke("upload_webdav_vault", { config: webdavForm.value });
      webdavStatus.value = "✅ 本地保险库已成功同步上传至云端（端到端强加密密文）！";
    } catch (err: any) {
      webdavStatus.value = "❌ 上传失败: " + err;
    } finally {
      isWebDavSyncing.value = false;
    }
  }

  async function handleDownloadWebDav() {
    const confirmed = await askConfirm({
      title: "云端恢复确认",
      message: "从云端下载将覆盖本地现有保险库（系统会自动先为当前本地数据创建安全快照备份）。确定继续吗？",
      type: "warning",
      confirmText: "确认恢复覆盖",
      cancelText: "取消"
    });
    if (!confirmed) return;
    isWebDavSyncing.value = true;
    webdavStatus.value = "正在下载并解密验证云端保险库...";
    try {
      await handleSaveWebDavConfig(false);
      const remote = await invoke<AccountRecord[]>("download_webdav_vault", { config: webdavForm.value });
      records.value = remote;
      selectedId.value = autoSelectFirst.value && remote.length > 0 ? remote[0].id : null;
      updateAllTotp();
      webdavStatus.value = `✅ 云端恢复成功！共同步载入 ${remote.length} 个账号。`;
      notify(`云端恢复成功！已同步载入 ${remote.length} 个账号`, "success");
    } catch (err: any) {
      webdavStatus.value = "❌ 恢复失败: " + err;
      notify("云端恢复失败: " + err, "error");
    } finally {
      isWebDavSyncing.value = false;
    }
  }

  return {
    webdavForm,
    webdavStatus,
    isWebDavSyncing,
    syncState,
    syncTooltip,
    lastSyncTimeFormatted,
    loadWebDavConfig,
    handleSaveWebDavConfig,
    triggerSmartSync,
    triggerDebouncedSync,
    handleTestWebDav,
    handleUploadWebDav,
    handleDownloadWebDav
  };
}
