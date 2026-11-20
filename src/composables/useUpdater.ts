import { computed, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useToast } from "./useToast";

export interface ReleaseAsset {
  name: string;
  download_url: string;
  size: number;
  asset_type: string;
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string;
  release_notes: string;
  published_at: string;
  release_url: string;
  download_url: string | null;
  setup_url: string | null;
  portable_url: string | null;
  apk_url: string | null;
  current_install_type: string;
  assets: ReleaseAsset[];
}

export type UpdateMirror = "gh-proxy" | "ghproxy" | "official";

export interface ParsedChangelogItem {
  type: string;
  typeLabel: string;
  typeColor: string;
  scope?: string;
  scopeLabel?: string;
  text: string;
}

export interface ParsedReleaseNotes {
  title: string;
  items: ParsedChangelogItem[];
  rawText?: string;
}

export function useUpdater(isMobilePlatform: Ref<boolean>) {
  const { notify } = useToast();

  const customRepo = ref("ifnor/AccountVault");
  const updateMirror = ref<UpdateMirror>(
    (localStorage.getItem("avault_update_mirror") as UpdateMirror) || "gh-proxy"
  );
  const autoCheckUpdateOnStartup = ref<boolean>(
    localStorage.getItem("avault_auto_check_update") !== "false"
  );
  const isCheckingUpdate = ref(false);
  const updateResult = ref<UpdateInfo | null>(null);
  const updateError = ref("");
  const isDownloadingUpdate = ref(false);
  const downloadProgress = ref(0);
  const downloadStatusText = ref("");

  function toggleAutoCheckUpdate() {
    autoCheckUpdateOnStartup.value = !autoCheckUpdateOnStartup.value;
    try {
      localStorage.setItem("avault_auto_check_update", String(autoCheckUpdateOnStartup.value));
    } catch (_) {}
    notify(
      autoCheckUpdateOnStartup.value
        ? "已开启：启动应用时自动静默检查新版本"
        : "已关闭启动自动检查更新",
      "info",
      2000
    );
  }

  function setUpdateMirror(mirror: UpdateMirror) {
    updateMirror.value = mirror;
    try {
      localStorage.setItem("avault_update_mirror", mirror);
    } catch (_) {}
  }

  const currentInstallTypeName = computed(() => {
    if (isMobilePlatform.value || updateResult.value?.current_install_type === "android") {
      return "Android 手机版";
    }
    if (updateResult.value?.current_install_type === "portable") {
      return "Windows 绿色便携版";
    }
    return "Windows 安装版";
  });

  const parsedReleaseNotes = computed<ParsedReleaseNotes | null>(() => {
    const raw = updateResult.value?.release_notes?.trim();
    if (!raw) return null;

    const lines = raw.split(/\r?\n/);
    let title = "🚀 本次更新内容";
    const items: ParsedChangelogItem[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const headerMatch = trimmed.match(/^#{1,6}\s*(.*)$/);
      if (headerMatch) {
        const headerText = headerMatch[1].trim();
        if (headerText) title = headerText;
        continue;
      }

      const content = trimmed.replace(/^[\*\-\•\+]\s+/, "").trim();
      if (!content) continue;

      const commitMatch = content.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?\s*[:：]\s*(.*)$/);
      if (commitMatch) {
        const rawType = commitMatch[1].toLowerCase();
        const rawScope = commitMatch[2]?.trim() || "";
        const message = commitMatch[3].trim();

        let typeLabel = "优化";
        let typeColor = "bg-blue-50 text-blue-700 border-blue-200";

        if (rawType === "feat") {
          typeLabel = "新增";
          typeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
        } else if (rawType === "fix") {
          typeLabel = "修复";
          typeColor = "bg-amber-50 text-amber-700 border-amber-200";
        } else if (rawType === "perf") {
          typeLabel = "性能";
          typeColor = "bg-teal-50 text-teal-700 border-teal-200";
        } else if (rawType === "refactor") {
          typeLabel = "重构";
          typeColor = "bg-purple-50 text-purple-700 border-purple-200";
        }

        items.push({
          type: rawType,
          typeLabel,
          typeColor,
          scope: rawScope,
          scopeLabel: rawScope || undefined,
          text: message || content
        });
      } else {
        items.push({
          type: "other",
          typeLabel: "详情",
          typeColor: "bg-slate-50 text-slate-600 border-slate-200",
          text: content
        });
      }
    }

    if (items.length === 0) {
      return { title, items: [], rawText: raw };
    }

    return { title, items };
  });

  async function checkForUpdates(silent = false) {
    if (isCheckingUpdate.value) return;
    isCheckingUpdate.value = true;
    if (!silent) {
      updateError.value = "";
      updateResult.value = null;
    }
    try {
      const mirrorParam =
        updateMirror.value === "gh-proxy"
          ? "https://gh-proxy.com"
          : updateMirror.value === "ghproxy"
          ? "https://ghproxy.net"
          : "official";

      const res = await invoke<UpdateInfo>("check_github_update", {
        repo: customRepo.value.trim() || undefined,
        mirror: mirrorParam
      });
      updateResult.value = res;
      if (res.has_update) {
        notify(`✨ 发现新版本 ${res.latest_version}！可在「设置 -> 检查更新」中一键升级`, "info", 5500);
      } else if (!silent) {
        notify(`当前已是最新版本 (${res.current_version})`, "success", 3000);
      }
    } catch (err: any) {
      if (!silent) {
        updateError.value = typeof err === "string" ? err : err?.message || "检查更新失败";
        notify("检查更新失败: " + updateError.value, "error");
      }
    } finally {
      isCheckingUpdate.value = false;
    }
  }

  async function openExternalUrl(url?: string | null) {
    if (!url) return;
    try {
      await openUrl(url);
      return;
    } catch (_) {
      try {
        await invoke("open_external_url", { url });
        return;
      } catch (_) {
        window.open(url, "_blank");
      }
    }
  }

  async function startAutoUpdate(targetUrl?: string) {
    const url =
      targetUrl ||
      updateResult.value?.download_url ||
      (isMobilePlatform.value ? updateResult.value?.apk_url : updateResult.value?.setup_url);
    if (!url) {
      notify("未找到有效下载地址，请尝试浏览器备用下载", "error");
      return;
    }

    isDownloadingUpdate.value = true;
    downloadProgress.value = 0;
    downloadStatusText.value = "正在连接下载服务器...";

    try {
      await invoke("start_auto_update", { url });
    } catch (err: any) {
      isDownloadingUpdate.value = false;
      const msg = typeof err === "string" ? err : err?.message || "自动更新失败";
      notify("自动更新异常: " + msg, "error", 6000);
      downloadStatusText.value = "更新异常: " + msg;
    }
  }

  return {
    customRepo,
    updateMirror,
    autoCheckUpdateOnStartup,
    isCheckingUpdate,
    updateResult,
    updateError,
    isDownloadingUpdate,
    downloadProgress,
    downloadStatusText,
    currentInstallTypeName,
    parsedReleaseNotes,
    toggleAutoCheckUpdate,
    setUpdateMirror,
    checkForUpdates,
    openExternalUrl,
    startAutoUpdate
  };
}
