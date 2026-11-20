import { ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "./useToast";

export function useSecurityAndLock(
  masterPassword: Ref<string>,
  isMobilePlatform: Ref<boolean>,
  helloStatus: Ref<{ available: boolean; enrolled: boolean }>,
  getWebdavForm: () => { url: string; username: string; password: string; auto_sync: boolean }
) {
  const { notify } = useToast();

  const autoLockMinutes = ref<number>(
    localStorage.getItem("avault_auto_lock_minutes") !== null
      ? Number(localStorage.getItem("avault_auto_lock_minutes"))
      : 15
  );
  const clipboardClearSeconds = ref<number>(
    localStorage.getItem("avault_clipboard_clear_seconds") !== null
      ? Number(localStorage.getItem("avault_clipboard_clear_seconds"))
      : 30
  );

  let lastActivityTime = Date.now();
  let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null;

  function recordUserActivity() {
    lastActivityTime = Date.now();
  }

  function getLastActivityTime() {
    return lastActivityTime;
  }

  function setAutoLockMinutes(mins: number) {
    autoLockMinutes.value = mins;
    try {
      localStorage.setItem("avault_auto_lock_minutes", String(mins));
    } catch (_) {}
    lastActivityTime = Date.now();
    notify(mins > 0 ? `已开启：无操作 ${mins} 分钟后自动锁定保险库` : "已关闭空闲自动锁定", "info", 2000);
  }

  function setClipboardClearSeconds(secs: number) {
    clipboardClearSeconds.value = secs;
    try {
      localStorage.setItem("avault_clipboard_clear_seconds", String(secs));
    } catch (_) {}
    notify(secs > 0 ? `已开启：复制敏感信息 ${secs} 秒后自动清空剪贴板` : "已关闭剪贴板自动清理", "info", 2000);
  }

  function scheduleClipboardClear() {
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
    if (clipboardClearSeconds.value <= 0) return;
    const delayMs = clipboardClearSeconds.value * 1000;
    clipboardClearTimer = setTimeout(async () => {
      try {
        await navigator.clipboard.writeText("");
      } catch (_) {}
    }, delayMs);
  }

  const showChangePwdModal = ref(false);
  const changePwdForm = ref({
    oldPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const isChangingPwd = ref(false);

  function openChangePwdModal() {
    changePwdForm.value = { oldPassword: "", newPassword: "", confirmPassword: "" };
    showChangePwdModal.value = true;
  }

  async function handleChangeMasterPassword() {
    if (!changePwdForm.value.oldPassword || !changePwdForm.value.newPassword) {
      notify("请完整填写原主密码与新主密码", "warning");
      return;
    }
    if (changePwdForm.value.newPassword !== changePwdForm.value.confirmPassword) {
      notify("两次输入的新主密码不一致，请核对", "error");
      return;
    }
    if (changePwdForm.value.newPassword.length < 4) {
      notify("新主密码长度至少需要 4 位", "warning");
      return;
    }

    isChangingPwd.value = true;
    try {
      await invoke("change_master_password", {
        oldPassword: changePwdForm.value.oldPassword,
        newPassword: changePwdForm.value.newPassword
      });
      masterPassword.value = changePwdForm.value.newPassword;

      if (isMobilePlatform.value && helloStatus.value.enrolled) {
        localStorage.removeItem("avault_mobile_biometric_token");
        helloStatus.value.enrolled = false;
      }

      showChangePwdModal.value = false;
      notify("🔐 主密码修改成功！本地保险库已使用新密钥重新加密保存", "success", 4000);

      const webdavForm = getWebdavForm();
      if (webdavForm.auto_sync && webdavForm.url.trim()) {
        try {
          await invoke("upload_webdav_vault", { config: webdavForm });
        } catch (_) {}
      }
    } catch (err: any) {
      notify("修改主密码失败: " + err, "error");
    } finally {
      isChangingPwd.value = false;
    }
  }

  function clearSecurityTimers() {
    if (clipboardClearTimer) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = null;
    }
  }

  return {
    autoLockMinutes,
    clipboardClearSeconds,
    recordUserActivity,
    getLastActivityTime,
    setAutoLockMinutes,
    setClipboardClearSeconds,
    scheduleClipboardClear,
    showChangePwdModal,
    changePwdForm,
    isChangingPwd,
    openChangePwdModal,
    handleChangeMasterPassword,
    clearSecurityTimers
  };
}
