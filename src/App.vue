<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import pkg from "../package.json";
import type {
  AccountRecord,
  TotpResult,
  SortRule
} from "./types/vault";
import {
  getPrimaryIdentifier,
  getDisplayTitle,
  isExpiringSoon
} from "./utils/accountHelpers";
import { useToast } from "./composables/useToast";
import { useConfirm } from "./composables/useConfirm";
import { useFaviconCache } from "./composables/useFaviconCache";
import { useAccountFilterAndBatch } from "./composables/useAccountFilterAndBatch";
import { useUpdater } from "./composables/useUpdater";
import { useTakeover } from "./composables/useTakeover";
import { useBackupCodes } from "./composables/useBackupCodes";
import { useWebDav } from "./composables/useWebDav";
import { useBackups } from "./composables/useBackups";
import { useQrScanner } from "./composables/useQrScanner";
import { useBrowserPresets } from "./composables/useBrowserPresets";
import { useBatchImport } from "./composables/useBatchImport";
import { useSecurityAndLock } from "./composables/useSecurityAndLock";
import { useBridgeAndBiometrics } from "./composables/useBridgeAndBiometrics";
import { usePullToRefresh } from "./composables/usePullToRefresh";
import { useDetailResizer } from "./composables/useDetailResizer";
import { useBackNavigation } from "./composables/useBackNavigation";
import { useAccountCrud } from "./composables/useAccountCrud";
import LockScreen from "./components/LockScreen.vue";
import ToastContainer from "./components/ToastContainer.vue";
import ConfirmModal from "./components/ConfirmModal.vue";
import BatchActionModal from "./components/BatchActionModal.vue";
import TotpQrModal from "./components/TotpQrModal.vue";
import ChangeMasterPwdModal from "./components/ChangeMasterPwdModal.vue";
import PasswordGenModal from "./components/PasswordGenModal.vue";
import AddEditAccountModal from "./components/AddEditAccountModal.vue";
import CustomUrlModal from "./components/CustomUrlModal.vue";
import BackupCodesModal from "./components/BackupCodesModal.vue";
import BatchImportModal from "./components/BatchImportModal.vue";
import QuickScanModal from "./components/QuickScanModal.vue";
import SettingsModal from "./components/SettingsModal.vue";
import AppHeader from "./components/AppHeader.vue";
import SidebarNav from "./components/SidebarNav.vue";
import AccountListPane from "./components/AccountListPane.vue";
import AccountDetailPane from "./components/AccountDetailPane.vue";
import MobileTabBar from "./components/MobileTabBar.vue";

const appVersion = ref(pkg.version || "1.1.5");
const { toasts, notify } = useToast();
const { confirmState } = useConfirm();
const {
  loadCachedFavicons
} = useFaviconCache();

// App State
const isUnlocked = ref(false);
const vaultExists = ref(true);
const masterPassword = ref("");
const unlockError = ref("");
const isSubmitting = ref(false);

const records = ref<AccountRecord[]>([]);
const selectedId = ref<string | null>(null);
const searchQuery = ref("");
const currentGroup = ref<string | null>(null);

// Responsive Mobile View States
const mobileView = ref<"list" | "detail">("list");
const showMobileSearch = ref(false);
const showMobileMoreMenu = ref(false);

const autoSelectFirst = ref(localStorage.getItem("avault_auto_select_first") === "true");
function toggleAutoSelectFirst() {
  autoSelectFirst.value = !autoSelectFirst.value;
  localStorage.setItem("avault_auto_select_first", autoSelectFirst.value ? "true" : "false");
}

const showListAvatar = ref(localStorage.getItem("avault_show_list_avatar") !== "false");
function toggleShowListAvatar() {
  showListAvatar.value = !showListAvatar.value;
  localStorage.setItem("avault_show_list_avatar", showListAvatar.value ? "true" : "false");
  notify(
    showListAvatar.value ? "已开启：显示账号列表圆形头像" : "已隐藏列表圆形头像（极简紧凑模式）",
    "info",
    1800
  );
}

function selectAccount(id: string) {
  if (selectedId.value === id) {
    selectedId.value = null;
    mobileView.value = "list";
  } else {
    selectedId.value = id;
    mobileView.value = "detail";
  }
}

// Detail Panel Width & Resizing (Desktop)
const {
  detailWidth,
  isResizingDetail,
  isDesktopWindow,
  updateWindowWidth,
  startResizeDetail,
  resetDetailWidth
} = useDetailResizer();

// TOTP Cache & Timer
const totpMap = ref<Record<string, TotpResult>>({});
let totpTimer: number | null = null;

// UI Helpers
const showPassword = ref(false);
const copiedField = ref<string | null>(null);

// Windows Hello / Mobile Biometrics state
const helloStatus = ref<{ available: boolean; enrolled: boolean }>({ available: false, enrolled: false });
const isHelloVerifying = ref(false);

const isMobilePlatform = computed(() => {
  if (typeof navigator !== "undefined") {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }
  return false;
});

async function refreshSecurityStatus() {
  if (isMobilePlatform.value) {
    try {
      const { checkStatus } = await import("@tauri-apps/plugin-biometric");
      const s = await checkStatus();
      const enrolled = !!localStorage.getItem("avault_mobile_biometric_token");
      helloStatus.value = {
        available: s.isAvailable,
        enrolled
      };
    } catch (e) {
      const enrolled = !!localStorage.getItem("avault_mobile_biometric_token");
      helloStatus.value = {
        available: true,
        enrolled
      };
    }
  } else {
    try {
      helloStatus.value = await invoke<{ available: boolean; enrolled: boolean }>("check_windows_hello_status");
    } catch (e) {
      console.warn("Check Windows Hello error:", e);
    }
  }
}

// Unlock / Create Vault
async function handleAuth() {
  if (!masterPassword.value) return;
  isSubmitting.value = true;
  unlockError.value = "";
  try {
    if (vaultExists.value) {
      records.value = await invoke<AccountRecord[]>("unlock_vault", { password: masterPassword.value });
    } else {
      await invoke("create_vault", { password: masterPassword.value });
      records.value = [];
      vaultExists.value = true;
    }
    isUnlocked.value = true;
    if (autoSelectFirst.value && records.value.length > 0) {
      selectedId.value = records.value[0].id;
    } else {
      selectedId.value = null;
    }
    startTotpTicker();
    await loadWebDavConfig();
    if (webdavForm.value.auto_sync) {
      triggerSmartSync(true);
    }
  } catch (err: any) {
    unlockError.value = typeof err === "string" ? err : (err?.message || "解锁失败");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleHelloUnlock() {
  isHelloVerifying.value = true;
  unlockError.value = "";
  try {
    if (isMobilePlatform.value) {
      const cred = localStorage.getItem("avault_mobile_biometric_token");
      if (!cred) {
        throw new Error("手机端尚未绑定生物识别，请使用主密码登录");
      }
      const { biometricCipher } = await import("@tauri-apps/plugin-biometric");
      const res = await biometricCipher("验证指纹、面容或锁屏密码以解锁保险库", {
        dataToDecrypt: cred,
        title: "安全验证解锁",
        subtitle: "请验证指纹、面容或锁屏密码",
        allowDeviceCredential: true
      });
      if (!res || !res.data) {
        throw new Error("生物识别解密失败");
      }
      const pwd = res.data;
      records.value = await invoke<AccountRecord[]>("unlock_vault", { password: pwd });
      masterPassword.value = pwd;
    } else {
      records.value = await invoke<AccountRecord[]>("unlock_vault_with_hello");
    }
    isUnlocked.value = true;
    if (autoSelectFirst.value && records.value.length > 0) {
      selectedId.value = records.value[0].id;
    } else {
      selectedId.value = null;
    }
    startTotpTicker();
    await loadWebDavConfig();
    if (webdavForm.value.auto_sync) {
      triggerSmartSync(true);
    }
  } catch (err: any) {
    const defaultMsg = isMobilePlatform.value ? "手机安全验证未通过" : "Windows Hello 验证未通过";
    unlockError.value = typeof err === "string" ? err : (err?.message || defaultMsg);
  } finally {
    isHelloVerifying.value = false;
  }
}

async function toggleWindowsHello() {
  try {
    if (isMobilePlatform.value) {
      if (helloStatus.value.enrolled) {
        localStorage.removeItem("avault_mobile_biometric_token");
        helloStatus.value.enrolled = false;
        notify("已停用手机生物识别 / 屏幕锁免密解锁", "info");
      } else {
        if (!masterPassword.value) {
          notify("未获取到当前主密码，请重新使用主密码解锁后再绑定", "warning");
          return;
        }
        const { biometricCipher } = await import("@tauri-apps/plugin-biometric");
        const res = await biometricCipher("验证手机指纹、面容或屏幕锁以绑定快速解锁", {
          dataToEncrypt: masterPassword.value,
          title: "绑定安全验证",
          subtitle: "验证指纹、面容或锁屏密码以绑定快速登录",
          allowDeviceCredential: true
        });
        if (res && res.data) {
          localStorage.setItem("avault_mobile_biometric_token", res.data);
          helloStatus.value.enrolled = true;
          notify("手机安全验证已成功绑定！下次可直接通过指纹/面容/屏幕锁一键解锁", "success", 4000);
        }
      }
    } else {
      if (helloStatus.value.enrolled) {
        await invoke("disable_windows_hello");
        helloStatus.value.enrolled = false;
        notify("已停用 Windows Hello / PIN 快速免密解锁", "info");
      } else {
        await invoke("enable_windows_hello");
        helloStatus.value.enrolled = true;
        notify("Windows Hello / PIN 快速解锁已成功绑定！下次可直接指纹/面容/PIN一键解锁", "success", 4000);
      }
    }
  } catch (err: any) {
    const errorMsg = typeof err === "string" ? err : (err?.message || "操作取消或验证未通过");
    notify((isMobilePlatform.value ? "绑定安全验证失败: " : "设置 Windows Hello 失败: ") + errorMsg, "error");
  }
}

async function lockVault() {
  await invoke("lock_vault");
  isUnlocked.value = false;
  masterPassword.value = "";
  records.value = [];
  selectedId.value = null;
  mobileView.value = "list";
  showMobileMoreMenu.value = false;
  showMobileSearch.value = false;
  if (totpTimer) clearInterval(totpTimer);
  await refreshSecurityStatus();
}

// TOTP Periodic Updates
function startTotpTicker() {
  updateAllTotp();
  if (totpTimer) clearInterval(totpTimer);
  totpTimer = window.setInterval(updateAllTotp, 1000);
}

async function updateAllTotp() {
  for (const r of records.value) {
    if (r.totp && r.totp.trim()) {
      try {
        const res = await invoke<TotpResult>("get_totp", { secret: r.totp });
        totpMap.value[r.id] = res;
      } catch (e) {
        // invalid secret
      }
    }
  }
}

// Computed Filtering
const selectedRecord = computed(() => {
  return records.value.find((r) => r.id === selectedId.value) || null;
});

const groups = computed(() => {
  const custom = Array.from(new Set(records.value.map((r) => (r.group || "").trim()).filter(Boolean))).sort();
  const pinnedCount = records.value.filter((r) => r.is_pinned).length;
  const expiringCount = records.value.filter((r) => isExpiringSoon(r.expire_at)).length;
  const baseGroups: Array<{ key: string | null; label: string; count: number }> = [
    { key: null, label: "全部账号", count: records.value.length },
    { key: "pinned", label: "⭐ 星标置顶", count: pinnedCount },
  ];
  if (expiringCount > 0 || currentGroup.value === "expiring") {
    baseGroups.push({ key: "expiring", label: "⏰ 即将到期", count: expiringCount });
  }
  return [
    ...baseGroups,
    { key: "", label: "未分组", count: records.value.filter((r) => !(r.group || "").trim()).length },
    ...custom.map((name) => ({
      key: name,
      label: name,
      count: records.value.filter((r) => (r.group || "").trim() === name).length
    }))
  ];
});

const sortRule = ref<SortRule>((localStorage.getItem("avault_sort_rule") as SortRule) || "alphabetical");
let triggerDebouncedSyncRef = () => {};

// ==================== MULTI-ATTRIBUTE FILTERING & BATCH MANAGEMENT ====================
const {
  showFilterPanel,
  attrFilter,
  toggleAttrStatus,
  resetAttrFilter,
  activeFilterCount,
  defaultHomeTab,
  homeTab,
  setDefaultHomeTab,
  switchHomeTab,
  filteredRecords,
  togglePinRecord,
  isBatchSelectMode,
  selectedBatchIds,
  showBatchActionModal,
  batchActionType,
  batchTargetGroup,
  batchTargetStatus,
  batchTargetPlan,
  toggleSelectBatchItem,
  openBatchUpdateDialog,
  executeBatchUpdate,
  executeBatchPin,
  executeBatchExportSelected,
  executeBatchDelete
} = useAccountFilterAndBatch(
  records,
  selectedId,
  searchQuery,
  currentGroup,
  sortRule,
  mobileView,
  () => triggerDebouncedSyncRef()
);

// ==================== AUTO-LOCK, CLIPBOARD CLEAR & MASTER PASSWORD ====================
let idleLockCheckTimer: ReturnType<typeof setInterval> | null = null;
const {
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
} = useSecurityAndLock(masterPassword, isMobilePlatform, helloStatus, () => webdavForm.value);

const {
  isEditing,
  isSavingRecord,
  editForm,
  showTotpQrModal,
  totpQrData,
  openAddModal,
  openEditModal,
  handleSaveRecord,
  handleDeleteRecord,
  generatePassword,
  handleIncrementHotp,
  openTotpQrModal
} = useAccountCrud(
  records,
  selectedId,
  mobileView,
  totpMap,
  updateAllTotp,
  () => triggerDebouncedSyncRef()
);

// ==================== TOP BAR QUICK SCAN (TOTP / PASSKEY) ====================
const {
  showQuickScanModal,
  quickScanVideoRef,
  quickScanCameraActive,
  quickScanCameraError,
  closeQuickScanModal,
  openQuickScanModal,
  triggerQuickScanImage,
  handleQuickScanPaste,
  triggerScanQrImage,
  handleTotpPaste
} = useQrScanner(editForm, homeTab, openAddModal);

// Copy Helper
async function copyText(text: string, fieldKey: string, toastMsg = "已成功复制到剪贴板") {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  copiedField.value = fieldKey;
  const suffix = clipboardClearSeconds.value > 0 ? ` (${clipboardClearSeconds.value}s 后自动清理)` : "";
  notify(toastMsg + suffix, "success", 1800);
  scheduleClipboardClear();
  setTimeout(() => {
    if (copiedField.value === fieldKey) copiedField.value = null;
  }, 2000);
}

// In-App Isolated Browser & Custom Service Presets
const {
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
} = useBrowserPresets(selectedRecord);

// ==================== EXTERNAL BROWSER LAUNCH TAKEOVER, BACKUP CODES, WEBDAV, UPDATER & BACKUPS ====================
const {
  isTakeoverActive,
  takeoverRemainingSec,
  takeoverTargetRecord,
  stopBrowserTakeover,
  toggleBrowserTakeover
} = useTakeover(selectedRecord, showCustomUrlModal);

const {
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
} = useWebDav(records, selectedId, autoSelectFirst, updateAllTotp);
triggerDebouncedSyncRef = triggerDebouncedSync;

const {
  showBackupCodesModal,
  backupCodesRawInput,
  isEditingBackupCodesRaw,
  parsedBackupCodesList,
  usedBackupCodesSet,
  unusedBackupCodesCount,
  toggleBackupCode,
  copyAndConsumeNextBackupCode,
  openBackupCodesModal,
  saveRawBackupCodes,
  resetAllUsedCodes
} = useBackupCodes(selectedRecord, copiedField, triggerDebouncedSync);

const {
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
} = useUpdater(isMobilePlatform);

const {
  backupTab,
  backupList,
  loadBackupsList,
  handleCreateManualBackup,
  handleRestoreBackup,
  handleExportAvault,
  triggerImportVaultFile,
  handleImportVaultBlob,
  handleExportCsv,
  handleExportJson
} = useBackups(records, selectedId, autoSelectFirst, updateAllTotp, triggerDebouncedSync);

// ==================== BATCH IMPORT & SMART PARSER ====================
const {
  showBatchImportModal,
  batchRawText,
  batchAssignPlatform,
  batchAssignGroup,
  batchImportSourceLabel,
  batchParsedRecords,
  openBatchImportModal,
  applyBatchOverrides,
  triggerImportExternalFile,
  handleBatchParse,
  confirmBatchImport
} = useBatchImport(
  records,
  selectedId,
  autoSelectFirst,
  updateAllTotp,
  triggerDebouncedSync,
  handleImportVaultBlob
);

// ==================== SETTINGS, BRIDGE & AUTOFILL ====================
const showSettingsModal = ref(false);
const settingsTab = ref<"security" | "webdav" | "backups" | "updates" | "about">("security");
let unlistenUpdateProgress: UnlistenFn | null = null;
let unlistenRecordsUpdated: UnlistenFn | null = null;

const {
  androidAutofillEnabled,
  browserBridgeStatus,
  refreshAutofillAndBridgeStatus,
  openAndroidAutofillSettings,
  toggleBrowserBridge,
  regenerateBrowserBridgeToken,
  copyBrowserBridgeToken
} = useBridgeAndBiometrics(isMobilePlatform, copyText);

async function openSettingsModal(tab: "security" | "webdav" | "backups" | "updates" | "about" = "security") {
  settingsTab.value = tab;
  showSettingsModal.value = true;
  webdavStatus.value = "";
  await loadWebDavConfig();
  await refreshAutofillAndBridgeStatus();
  if (tab === "backups") {
    await loadBackupsList();
  }
}

// ==================== PASSWORD GENERATOR ====================
const showPasswordGenModal = ref(false);

function openPasswordGenModal() {
  showPasswordGenModal.value = true;
}

function copyGeneratedPassword(pwd: string) {
  if (!pwd) return;
  navigator.clipboard.writeText(pwd);
  scheduleClipboardClear();
  const suffix = clipboardClearSeconds.value > 0 ? ` (${clipboardClearSeconds.value}s 后自动清理)` : "";
  notify("已成功复制新密码到剪贴板！" + suffix, "success");
}

function applyPasswordToCurrentRecord(pwd: string) {
  if (!selectedRecord.value || !pwd) return;
  selectedRecord.value.password = pwd;
  invoke("save_record", { record: selectedRecord.value });
  showPasswordGenModal.value = false;
  notify(`已将生成的新密码更新至账号 [${getDisplayTitle(selectedRecord.value)}]`, "success", 3000);
  triggerDebouncedSync();
}

// Hardware & Gesture Back Navigation
const { setupBackNavigation, cleanupBackNavigation } = useBackNavigation({
  confirmState,
  showChangePwdModal,
  showTotpQrModal,
  showBatchActionModal,
  showSettingsModal,
  showPasswordGenModal,
  showBatchImportModal,
  showCustomUrlModal,
  showBackupCodesModal,
  isEditingBackupCodesRaw,
  isEditing,
  isBatchSelectMode,
  selectedBatchIds,
  showMobileMoreMenu,
  showMobileSearch,
  searchQuery,
  mobileView,
  selectedId
});

function handleWindowFocus() {
  if (isUnlocked.value && webdavForm.value.auto_sync) {
    triggerSmartSync(true);
  }
}

let syncIntervalTimer: any = null;

// ==================== PULL TO REFRESH ====================
const {
  listScrollRef,
  pullDistance,
  isPullRefreshing,
  onListTouchStart,
  onListTouchMove,
  onListTouchEnd
} = usePullToRefresh(
  records,
  computed(() => webdavForm.value.url),
  triggerSmartSync,
  loadCachedFavicons
);

onMounted(async () => {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const v = await getVersion();
    if (v) appVersion.value = v;
  } catch (_) {}
  try {
    vaultExists.value = await invoke<boolean>("check_vault_exists");
  } catch (e) {
    vaultExists.value = false;
  }
  await refreshSecurityStatus();
  await refreshAutofillAndBridgeStatus();
  await loadCachedFavicons();
  await setupBackNavigation();
  try {
    unlistenRecordsUpdated = await listen("vault-records-updated", async () => {
      if (isUnlocked.value) {
        records.value = await invoke<AccountRecord[]>("get_records");
      }
    });
  } catch (_) {}
  await loadWebDavConfig();
  if (autoCheckUpdateOnStartup.value) {
    setTimeout(() => {
      checkForUpdates(true);
    }, 1200);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("resize", updateWindowWidth);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("mousemove", recordUserActivity, { passive: true });
    window.addEventListener("mousedown", recordUserActivity, { passive: true });
    window.addEventListener("keydown", recordUserActivity, { passive: true });
    window.addEventListener("touchstart", recordUserActivity, { passive: true });
    updateWindowWidth();
  }

  idleLockCheckTimer = setInterval(() => {
    if (isUnlocked.value && autoLockMinutes.value > 0) {
      const idleMs = Date.now() - getLastActivityTime();
      if (idleMs >= autoLockMinutes.value * 60 * 1000) {
        lockVault();
        notify(`🔒 已超过 ${autoLockMinutes.value} 分钟无操作，保险库已自动安全锁定`, "info", 4000);
      }
    }
  }, 5000);

  syncIntervalTimer = setInterval(() => {
    if (isUnlocked.value && webdavForm.value.auto_sync) {
      triggerSmartSync(true);
    }
  }, 10 * 60 * 1000);

  try {
    unlistenUpdateProgress = await listen<{ downloaded: number; total: number; percent: number }>(
      "update-download-progress",
      (event) => {
        downloadProgress.value = event.payload.percent;
        if (event.payload.percent >= 100) {
          downloadStatusText.value = "下载完成！正在启动升级安装向导...";
        } else {
          const mb = (event.payload.downloaded / (1024 * 1024)).toFixed(1);
          const totalMb = (event.payload.total / (1024 * 1024)).toFixed(1);
          downloadStatusText.value = `正在下载更新包：${mb} MB / ${totalMb} MB (${event.payload.percent}%)`;
        }
      }
    );
  } catch (e) {}
});

onUnmounted(() => {
  stopBrowserTakeover(false);
  if (totpTimer) clearInterval(totpTimer);
  if (syncIntervalTimer) clearInterval(syncIntervalTimer);
  if (idleLockCheckTimer) clearInterval(idleLockCheckTimer);
  clearSecurityTimers();
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", updateWindowWidth);
    window.removeEventListener("focus", handleWindowFocus);
    window.removeEventListener("mousemove", recordUserActivity);
    window.removeEventListener("mousedown", recordUserActivity);
    window.removeEventListener("keydown", recordUserActivity);
    window.removeEventListener("touchstart", recordUserActivity);
  }
  cleanupBackNavigation();
  if (unlistenUpdateProgress) {
    unlistenUpdateProgress();
  }
  if (unlistenRecordsUpdated) {
    unlistenRecordsUpdated();
  }
});
</script>

<template>
  <div @contextmenu.prevent class="h-screen w-screen flex flex-col bg-white select-none text-[#1f1f1f] font-sans antialiased overflow-hidden pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
    
    <!-- 1. LOCK / UNLOCK SCREEN -->
    <LockScreen
      v-if="!isUnlocked"
      :vault-exists="vaultExists"
      v-model:master-password="masterPassword"
      :unlock-error="unlockError"
      :is-submitting="isSubmitting"
      :hello-status="helloStatus"
      :is-hello-verifying="isHelloVerifying"
      :is-mobile-platform="isMobilePlatform"
      @submit="handleAuth"
      @hello-unlock="handleHelloUnlock"
    />

    <!-- 2. MAIN APPLICATION WORKSPACE -->
    <template v-else>
      <AppHeader
        v-model:search-query="searchQuery"
        v-model:show-mobile-search="showMobileSearch"
        v-model:show-mobile-more-menu="showMobileMoreMenu"
        :sync-state="syncState"
        :sync-tooltip="syncTooltip"
        :webdav-url="webdavForm.url"
        :webdav-auto-sync="webdavForm.auto_sync"
        :hello-enrolled="helloStatus.enrolled"
        :has-update="Boolean(updateResult?.has_update)"
        :latest-version="updateResult?.latest_version"
        :groups="groups"
        :current-group="currentGroup"
        @select-group="(key) => { currentGroup = key; mobileView = 'list'; }"
        @open-add="openAddModal()"
        @open-quick-scan="openQuickScanModal()"
        @open-password-gen="openPasswordGenModal()"
        @open-batch-import="openBatchImportModal()"
        @smart-sync="triggerSmartSync(false)"
        @open-settings="(tab) => openSettingsModal(tab)"
        @lock="lockVault()"
      />

      <!-- THREE-COLUMN MAIN BODY -->
      <div class="flex-1 flex overflow-hidden relative">
        <SidebarNav
          :groups="groups"
          :current-group="currentGroup"
          @select-group="(key) => { currentGroup = key; }"
        />

        <AccountListPane
          :mobile-view="mobileView"
          v-model:show-filter-panel="showFilterPanel"
          :active-filter-count="activeFilterCount"
          :attr-filter="attrFilter"
          :pull-distance="pullDistance"
          :is-pull-refreshing="isPullRefreshing"
          :filtered-records="filteredRecords"
          :is-batch-select-mode="isBatchSelectMode"
          :selected-batch-ids="selectedBatchIds"
          :selected-id="selectedId"
          :show-list-avatar="showListAvatar"
          :home-tab="homeTab"
          :totp-map="totpMap"
          :copied-field="copiedField"
          :search-query="searchQuery"
          @reset-filter="resetAttrFilter"
          @toggle-status="toggleAttrStatus"
          @clear-selection="selectedId = null"
          @touch-start="onListTouchStart"
          @touch-move="onListTouchMove"
          @touch-end="onListTouchEnd"
          @select-account="selectAccount"
          @toggle-batch-item="toggleSelectBatchItem"
          @edit-account="openEditModal"
          @toggle-pin="togglePinRecord"
          @increment-hotp="handleIncrementHotp"
          @copy="(text, fieldKey) => copyText(text, fieldKey)"
          @clear-search="searchQuery = ''"
          @batch-pin="executeBatchPin"
          @batch-update="openBatchUpdateDialog"
          @batch-export="executeBatchExportSelected"
          @batch-delete="executeBatchDelete"
          @scroll-el="(el) => { listScrollRef = el; }"
        />

        <!-- Resizer Divider (Desktop only) -->
        <div
          class="hidden md:flex items-center justify-center w-1 hover:w-1.5 bg-[#dadce0]/40 hover:bg-[#1a73e8]/40 active:bg-[#1a73e8] cursor-col-resize transition-all select-none z-10 -ml-0.5"
          :class="{ 'bg-[#1a73e8] w-1.5': isResizingDetail }"
          @mousedown="startResizeDetail"
          @dblclick="resetDetailWidth"
          title="按住鼠标左右拖拽调整详情栏宽度，双击恢复默认宽度"
        >
          <div class="w-0.5 h-6 bg-[#dadce0] rounded-full"></div>
        </div>

        <AccountDetailPane
          :mobile-view="mobileView"
          :is-desktop-window="isDesktopWindow"
          :is-mobile-platform="isMobilePlatform"
          :detail-width="detailWidth"
          :selected-record="selectedRecord"
          :is-opening-browser="isOpeningBrowser"
          :is-takeover-active="isTakeoverActive"
          :is-takeover-for-current="Boolean(isTakeoverActive && takeoverTargetRecord?.id === selectedRecord?.id)"
          :takeover-remaining-sec="takeoverRemainingSec"
          :show-password="showPassword"
          :copied-field="copiedField"
          :totp-result="selectedRecord ? totpMap[selectedRecord.id] : undefined"
          :parsed-backup-codes-count="parsedBackupCodesList.length"
          :unused-backup-codes-count="unusedBackupCodesCount"
          @back-to-list="mobileView = 'list'"
          @clear-selection="selectedId = null"
          @edit="openEditModal"
          @delete="handleDeleteRecord"
          @toggle-pin="togglePinRecord"
          @open-in-app="openInApp"
          @open-custom-url="openCustomUrlModal"
          @toggle-takeover="toggleBrowserTakeover"
          @stop-takeover="stopBrowserTakeover(true)"
          @toggle-password="showPassword = !showPassword"
          @copy="copyText"
          @increment-hotp="handleIncrementHotp"
          @open-totp-qr="openTotpQrModal"
          @consume-backup-code="copyAndConsumeNextBackupCode"
          @open-backup-codes="openBackupCodesModal"
        />
      </div>

      <MobileTabBar
        :home-tab="homeTab"
        :hidden-on-mobile="mobileView === 'detail'"
        @switch-tab="switchHomeTab"
      />
    </template>

    <!-- 3. ADD / EDIT MODAL -->
    <AddEditAccountModal
      :visible="isEditing"
      :form="editForm"
      :is-saving="isSavingRecord"
      @close="isEditing = false"
      @save="handleSaveRecord"
      @generate-password="generatePassword"
      @scan-qr="triggerScanQrImage"
      @paste-totp="handleTotpPaste"
    />

    <!-- 4. CUSTOM URL & PRESET SERVICES MODAL -->
    <CustomUrlModal
      :visible="Boolean(showCustomUrlModal && selectedRecord)"
      :account-subtitle="selectedRecord ? `${getDisplayTitle(selectedRecord)} · ${getPrimaryIdentifier(selectedRecord)}` : ''"
      :is-takeover-for-current="Boolean(isTakeoverActive && takeoverTargetRecord?.id === selectedRecord?.id)"
      :takeover-remaining-sec="takeoverRemainingSec"
      :service-presets="servicePresets"
      v-model:is-managing-presets="isManagingPresets"
      v-model:new-preset-name="newPresetName"
      v-model:new-preset-url="newPresetUrl"
      v-model:custom-url-input="customUrlInput"
      @close="showCustomUrlModal = false"
      @toggle-takeover="selectedRecord && toggleBrowserTakeover(selectedRecord)"
      @reset-presets="resetDefaultServicePresets"
      @open-preset="(url) => { showCustomUrlModal = false; openInApp(url); }"
      @remove-preset="removeServicePreset"
      @add-preset="addCustomServicePreset"
      @open-custom-url="handleOpenCustomUrl"
      @clear-session="clearCurrentAccountSession"
    />

    <!-- 5. BACKUP CODES MANAGEMENT MODAL -->
    <BackupCodesModal
      :visible="Boolean(showBackupCodesModal && selectedRecord)"
      :account-subtitle="selectedRecord ? `${getDisplayTitle(selectedRecord)} · ${getPrimaryIdentifier(selectedRecord)}` : ''"
      :codes-list="parsedBackupCodesList"
      :used-codes-set="usedBackupCodesSet"
      :unused-count="unusedBackupCodesCount"
      v-model:is-editing-raw="isEditingBackupCodesRaw"
      v-model:raw-input="backupCodesRawInput"
      :copied-field="copiedField"
      @close="showBackupCodesModal = false"
      @reset-all="resetAllUsedCodes"
      @save-raw="saveRawBackupCodes"
      @copy-and-consume="copyAndConsumeNextBackupCode"
      @toggle-code="toggleBackupCode"
      @copy-code="(code) => copyText(code, 'bc_' + code)"
    />

    <!-- 6. BATCH IMPORT MODAL -->
    <BatchImportModal
      :visible="showBatchImportModal"
      v-model:raw-text="batchRawText"
      v-model:assign-platform="batchAssignPlatform"
      v-model:assign-group="batchAssignGroup"
      :source-label="batchImportSourceLabel"
      :parsed-records="batchParsedRecords"
      @close="showBatchImportModal = false"
      @trigger-file="triggerImportExternalFile"
      @parse-raw="handleBatchParse"
      @apply-overrides="applyBatchOverrides"
      @confirm="confirmBatchImport"
    />

    <!-- 7. UNIFIED SETTINGS MODAL -->
    <SettingsModal
      :visible="showSettingsModal"
      :app-version="appVersion"
      v-model:settings-tab="settingsTab"
      v-model:backup-tab="backupTab"
      :is-mobile-platform="isMobilePlatform"
      :hello-status="helloStatus"
      :auto-select-first="autoSelectFirst"
      :show-list-avatar="showListAvatar"
      :default-home-tab="defaultHomeTab"
      :auto-lock-minutes="autoLockMinutes"
      :clipboard-clear-seconds="clipboardClearSeconds"
      :android-autofill-enabled="androidAutofillEnabled"
      :browser-bridge-status="browserBridgeStatus"
      :webdav-form="webdavForm"
      :webdav-status="webdavStatus"
      :is-web-dav-syncing="isWebDavSyncing"
      :sync-state="syncState"
      :last-sync-time-formatted="lastSyncTimeFormatted"
      :backup-list="backupList"
      :is-checking-update="isCheckingUpdate"
      :is-downloading-update="isDownloadingUpdate"
      :download-progress="downloadProgress"
      :download-status-text="downloadStatusText"
      :auto-check-update-on-startup="autoCheckUpdateOnStartup"
      :update-mirror="updateMirror"
      :update-result="updateResult"
      :update-error="updateError"
      :current-install-type-name="currentInstallTypeName"
      :parsed-release-notes="parsedReleaseNotes"
      @close="showSettingsModal = false"
      @load-webdav="loadWebDavConfig"
      @load-backups="loadBackupsList"
      @toggle-hello="toggleWindowsHello"
      @toggle-auto-select="toggleAutoSelectFirst"
      @toggle-list-avatar="toggleShowListAvatar"
      @set-home-tab="setDefaultHomeTab"
      @set-auto-lock="setAutoLockMinutes"
      @set-clipboard-clear="setClipboardClearSeconds"
      @open-change-pwd="openChangePwdModal"
      @open-android-autofill="openAndroidAutofillSettings"
      @refresh-bridge="refreshAutofillAndBridgeStatus"
      @toggle-bridge="toggleBrowserBridge"
      @copy-bridge-token="copyBrowserBridgeToken"
      @regenerate-bridge-token="regenerateBrowserBridgeToken"
      @save-webdav="handleSaveWebDavConfig"
      @smart-sync="triggerSmartSync(false)"
      @test-webdav="handleTestWebDav"
      @upload-webdav="handleUploadWebDav"
      @download-webdav="handleDownloadWebDav"
      @create-backup="handleCreateManualBackup"
      @restore-backup="handleRestoreBackup"
      @import-vault="triggerImportVaultFile"
      @export-avault="handleExportAvault"
      @export-csv="handleExportCsv"
      @export-json="handleExportJson"
      @check-updates="checkForUpdates(false)"
      @toggle-auto-update="toggleAutoCheckUpdate"
      @set-mirror="setUpdateMirror"
      @start-auto-update="startAutoUpdate()"
      @open-external="openExternalUrl"
    />

    <!-- 9. PASSWORD GENERATOR MODAL -->
    <PasswordGenModal
      :visible="showPasswordGenModal"
      :current-account-title="selectedRecord ? getDisplayTitle(selectedRecord) : undefined"
      @close="showPasswordGenModal = false"
      @copy="copyGeneratedPassword"
      @apply="applyPasswordToCurrentRecord"
    />

    <!-- TOAST NOTIFICATIONS -->
    <ToastContainer :toasts="toasts" />

    <!-- CUSTOM CONFIRMATION MODAL -->
    <ConfirmModal :state="confirmState" />

    <!-- BATCH UPDATE ACTION MODAL -->
    <BatchActionModal
      :visible="showBatchActionModal"
      :action-type="batchActionType"
      :selected-count="selectedBatchIds.length"
      v-model:target-group="batchTargetGroup"
      v-model:target-status="batchTargetStatus"
      v-model:target-plan="batchTargetPlan"
      @close="showBatchActionModal = false"
      @execute="executeBatchUpdate"
    />

    <!-- 2FA QR CODE TRANSFER MODAL -->
    <TotpQrModal
      :visible="showTotpQrModal"
      :data="totpQrData"
      :subtitle="selectedRecord ? `${getDisplayTitle(selectedRecord)} · ${getPrimaryIdentifier(selectedRecord)}` : ''"
      @close="showTotpQrModal = false"
      @copy="copyText"
    />

    <!-- QUICK SCAN MODAL (TOTP / PASSKEY) -->
    <QuickScanModal
      :visible="showQuickScanModal"
      :camera-active="quickScanCameraActive"
      :camera-error="quickScanCameraError"
      @close="closeQuickScanModal"
      @paste="handleQuickScanPaste"
      @pick-image="triggerQuickScanImage"
      @video-el="(el) => { quickScanVideoRef = el }"
    />

    <!-- CHANGE MASTER PASSWORD MODAL -->
    <ChangeMasterPwdModal
      :visible="showChangePwdModal"
      :is-changing="isChangingPwd"
      :form="changePwdForm"
      @close="showChangePwdModal = false"
      @submit="handleChangeMasterPassword"
    />

  </div>
</template>
