import { ref, type ComputedRef, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord } from "../types/vault";
import { getDisplayTitle, getPrimaryIdentifier, getSessionKey } from "../utils/accountHelpers";
import { useToast } from "./useToast";

export function useTakeover(
  selectedRecord: ComputedRef<AccountRecord | null>,
  showCustomUrlModal: Ref<boolean>
) {
  const { notify } = useToast();

  const isTakeoverActive = ref(false);
  const takeoverRemainingSec = ref(60);
  const takeoverTargetRecord = ref<AccountRecord | null>(null);
  let takeoverPollTimer: ReturnType<typeof setInterval> | null = null;
  let takeoverCountdownTimer: ReturnType<typeof setInterval> | null = null;
  let isHandlingTakeoverUrl = false;

  async function stopBrowserTakeover(showManualToast = false) {
    if (takeoverPollTimer) {
      clearInterval(takeoverPollTimer);
      takeoverPollTimer = null;
    }
    if (takeoverCountdownTimer) {
      clearInterval(takeoverCountdownTimer);
      takeoverCountdownTimer = null;
    }
    isTakeoverActive.value = false;
    takeoverTargetRecord.value = null;
    try {
      await invoke("stop_browser_takeover");
    } catch (_) {}
    if (showManualToast) {
      notify("已停止外部跳转临时接管", "info", 1800);
    }
  }

  async function toggleBrowserTakeover(record?: AccountRecord | null) {
    const target = record || selectedRecord.value;
    if (!target) return;

    if (isTakeoverActive.value && takeoverTargetRecord.value?.id === target.id) {
      await stopBrowserTakeover(true);
      return;
    }

    await stopBrowserTakeover(false);
    takeoverTargetRecord.value = target;
    takeoverRemainingSec.value = 60;
    isTakeoverActive.value = true;
    isHandlingTakeoverUrl = false;

    try {
      await invoke("start_browser_takeover", { durationSecs: 60 });
    } catch (err: any) {
      isTakeoverActive.value = false;
      notify("启动外部跳转接管失败: " + err, "error");
      return;
    }

    notify(
      `🎯 已开启 60s 临时接管（${getDisplayTitle(target)}）：请在外部软件点击登录或复制授权链接`,
      "info",
      4200
    );

    takeoverCountdownTimer = setInterval(() => {
      if (!isTakeoverActive.value) return;
      takeoverRemainingSec.value -= 1;
      if (takeoverRemainingSec.value <= 0) {
        stopBrowserTakeover(false);
        notify("外部跳转临时接管已超时自动结束", "info", 2200);
      }
    }, 1000);

    takeoverPollTimer = setInterval(async () => {
      if (!isTakeoverActive.value || isHandlingTakeoverUrl) return;
      try {
        const capturedUrl = await invoke<string | null>("poll_browser_takeover", {
          clipboardText: null
        });
        if (capturedUrl && isTakeoverActive.value) {
          isHandlingTakeoverUrl = true;
          const acc = takeoverTargetRecord.value || selectedRecord.value;
          await stopBrowserTakeover(false);
          showCustomUrlModal.value = false;
          if (acc) {
            notify(
              `✓ 已成功接管外部跳转，正在用 ${getDisplayTitle(acc)} 独立会话打开...`,
              "success",
              3600
            );
            await invoke("open_in_app_browser", {
              sessionKey: getSessionKey(acc),
              title: getDisplayTitle(acc),
              username: getPrimaryIdentifier(acc),
              email: acc.email || "",
              password: acc.password || "",
              totpSecret: acc.totp || "",
              recoveryEmail: acc.recovery_email || "",
              proxy: acc.proxy || "",
              url: capturedUrl
            });
          }
        }
      } catch (_) {}
    }, 220);
  }

  return {
    isTakeoverActive,
    takeoverRemainingSec,
    takeoverTargetRecord,
    stopBrowserTakeover,
    toggleBrowserTakeover
  };
}
