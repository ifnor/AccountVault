import { ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "./useToast";

export function useBridgeAndBiometrics(
  isMobilePlatform: Ref<boolean>,
  copyText: (text: string, fieldKey: string, toastMsg?: string) => Promise<void>
) {
  const { notify } = useToast();

  const androidAutofillEnabled = ref(false);
  const browserBridgeStatus = ref<{ enabled: boolean; port: number; token: string; running: boolean }>({
    enabled: true,
    port: 47291,
    token: "",
    running: false
  });

  async function refreshAutofillAndBridgeStatus() {
    if (isMobilePlatform.value) {
      try {
        androidAutofillEnabled.value = await invoke<boolean>("get_android_autofill_status");
      } catch (_) {}
    } else {
      try {
        browserBridgeStatus.value = await invoke("get_browser_bridge_status");
      } catch (_) {}
    }
  }

  async function openAndroidAutofillSettings() {
    try {
      await invoke<boolean>("open_android_autofill_settings");
      setTimeout(() => refreshAutofillAndBridgeStatus(), 1200);
    } catch (e: any) {
      notify(`打开系统自动填充设置失败: ${e}`, "error");
    }
  }

  async function toggleBrowserBridge() {
    try {
      browserBridgeStatus.value = await invoke("set_browser_bridge_enabled", {
        enabled: !browserBridgeStatus.value.enabled
      });
      notify(browserBridgeStatus.value.enabled ? "已开启浏览器扩展服务" : "已暂停浏览器扩展服务", "success");
    } catch (e: any) {
      notify(`切换失败: ${e}`, "error");
    }
  }

  async function regenerateBrowserBridgeToken() {
    try {
      browserBridgeStatus.value = await invoke("regenerate_browser_bridge_token");
      notify("已重新生成配对密钥，请在浏览器扩展中更新", "info");
    } catch (e: any) {
      notify(`重置密钥失败: ${e}`, "error");
    }
  }

  async function copyBrowserBridgeToken() {
    if (!browserBridgeStatus.value.token) return;
    await copyText(browserBridgeStatus.value.token, "配对密钥");
  }

  return {
    androidAutofillEnabled,
    browserBridgeStatus,
    refreshAutofillAndBridgeStatus,
    openAndroidAutofillSettings,
    toggleBrowserBridge,
    regenerateBrowserBridgeToken,
    copyBrowserBridgeToken
  };
}
