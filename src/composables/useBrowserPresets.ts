import { ref, type ComputedRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord } from "../types/vault";
import { getDisplayTitle, getPrimaryIdentifier, getSessionKey } from "../utils/accountHelpers";
import { useToast } from "./useToast";
import { useConfirm } from "./useConfirm";

const DEFAULT_SERVICE_PRESETS = [
  { name: "GitHub", url: "https://github.com/login" },
  { name: "OpenAI / ChatGPT", url: "https://chatgpt.com/" },
  { name: "Cloudflare", url: "https://dash.cloudflare.com/login" },
  { name: "Google 账号", url: "https://myaccount.google.com" },
  { name: "Microsoft 账号", url: "https://account.microsoft.com" },
  { name: "AWS 控制台", url: "https://console.aws.amazon.com" },
  { name: "Steam", url: "https://store.steampowered.com/login/" },
  { name: "Notion", url: "https://www.notion.so/login" }
];

function loadSavedServicePresets(): Array<{ name: string; url: string }> {
  try {
    const raw = localStorage.getItem("avault_custom_service_presets");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (_) {}
  return [...DEFAULT_SERVICE_PRESETS];
}

export function useBrowserPresets(selectedRecord: ComputedRef<AccountRecord | null>) {
  const { notify } = useToast();
  const { askConfirm } = useConfirm();

  const isOpeningBrowser = ref(false);
  const showCustomUrlModal = ref(false);
  const customUrlInput = ref("https://");
  const isManagingPresets = ref(false);
  const newPresetName = ref("");
  const newPresetUrl = ref("https://");
  const servicePresets = ref<Array<{ name: string; url: string }>>(loadSavedServicePresets());

  function saveServicePresets() {
    try {
      localStorage.setItem("avault_custom_service_presets", JSON.stringify(servicePresets.value));
    } catch (_) {}
  }

  function addCustomServicePreset() {
    const name = newPresetName.value.trim();
    let url = newPresetUrl.value.trim();
    if (!name || !url || url === "https://") {
      notify("请输入快捷网站名称与完整网址", "warning");
      return;
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    servicePresets.value.push({ name, url });
    saveServicePresets();
    newPresetName.value = "";
    newPresetUrl.value = "https://";
    notify(`已添加快捷网址：${name}`, "success", 1800);
  }

  function removeServicePreset(idx: number) {
    servicePresets.value.splice(idx, 1);
    saveServicePresets();
  }

  function resetDefaultServicePresets() {
    servicePresets.value = [...DEFAULT_SERVICE_PRESETS];
    saveServicePresets();
    notify("已恢复默认常用网站列表", "info", 1800);
  }

  function openCustomUrlModal() {
    customUrlInput.value = selectedRecord.value?.login_url?.trim() || "https://";
    isManagingPresets.value = false;
    showCustomUrlModal.value = true;
  }

  async function openInApp(url: string) {
    if (!selectedRecord.value) return;
    let finalUrl = url.trim();
    if (!finalUrl) {
      openCustomUrlModal();
      return;
    }
    if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
      finalUrl = "https://" + finalUrl;
    }
    isOpeningBrowser.value = true;
    try {
      await invoke("open_in_app_browser", {
        sessionKey: getSessionKey(selectedRecord.value),
        title: getDisplayTitle(selectedRecord.value),
        username: getPrimaryIdentifier(selectedRecord.value),
        email: selectedRecord.value.email || "",
        password: selectedRecord.value.password || "",
        totpSecret: selectedRecord.value.totp || "",
        recoveryEmail: selectedRecord.value.recovery_email || "",
        proxy: selectedRecord.value.proxy || "",
        url: finalUrl
      });
    } catch (_) {
      notify("应用内浏览器启动异常，正在通过系统浏览器打开", "warning");
      try {
        await invoke("open_external_url", { url: finalUrl });
      } catch (_) {}
    } finally {
      isOpeningBrowser.value = false;
    }
  }

  function handleOpenCustomUrl() {
    let url = customUrlInput.value.trim();
    if (!url || url === "https://") return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    showCustomUrlModal.value = false;
    openInApp(url);
  }

  async function clearCurrentAccountSession() {
    if (!selectedRecord.value) return;
    const label = `${getDisplayTitle(selectedRecord.value)} (${getPrimaryIdentifier(selectedRecord.value)})`;
    const confirmed = await askConfirm({
      title: "清理独立会话沙箱",
      message: `确定要清除账号【${label}】独立会话窗口下的所有 Cookie 与本地缓存吗？`,
      type: "warning",
      confirmText: "确定清理",
      cancelText: "取消"
    });
    if (!confirmed) return;
    try {
      const msg = await invoke<string>("clear_account_browser_session", {
        sessionKey: getSessionKey(selectedRecord.value),
        labelHint: label
      });
      notify("✓ " + msg, "success", 2800);
    } catch (err: any) {
      notify("清理独立会话失败: " + err, "error");
    }
  }

  return {
    isOpeningBrowser,
    showCustomUrlModal,
    customUrlInput,
    isManagingPresets,
    newPresetName,
    newPresetUrl,
    servicePresets,
    addCustomServicePreset,
    removeServicePreset,
    resetDefaultServicePresets,
    openCustomUrlModal,
    openInApp,
    handleOpenCustomUrl,
    clearCurrentAccountSession
  };
}
