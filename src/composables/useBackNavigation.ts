import type { Ref } from "vue";
import { useToast } from "./useToast";

export interface BackNavDeps {
  confirmState: Ref<{ visible: boolean; resolve: (v: boolean) => void }>;
  showChangePwdModal: Ref<boolean>;
  showTotpQrModal: Ref<boolean>;
  showBatchActionModal: Ref<boolean>;
  showSettingsModal: Ref<boolean>;
  showPasswordGenModal: Ref<boolean>;
  showBatchImportModal: Ref<boolean>;
  showCustomUrlModal: Ref<boolean>;
  showBackupCodesModal: Ref<boolean>;
  isEditingBackupCodesRaw: Ref<boolean>;
  isEditing: Ref<boolean>;
  isBatchSelectMode: Ref<boolean>;
  selectedBatchIds: Ref<string[]>;
  showMobileMoreMenu: Ref<boolean>;
  showMobileSearch: Ref<boolean>;
  searchQuery: Ref<string>;
  mobileView: Ref<"list" | "detail">;
  selectedId: Ref<string | null>;
}

export function useBackNavigation(deps: BackNavDeps) {
  const { notify } = useToast();
  let lastBackPressTime = 0;
  let backButtonListener: { unregister: () => Promise<void> } | null = null;

  function handleBackAction(): boolean {
    if (deps.confirmState.value.visible) {
      deps.confirmState.value.resolve(false);
      return true;
    }
    if (deps.showChangePwdModal.value) {
      deps.showChangePwdModal.value = false;
      return true;
    }
    if (deps.showTotpQrModal.value) {
      deps.showTotpQrModal.value = false;
      return true;
    }
    if (deps.showBatchActionModal.value) {
      deps.showBatchActionModal.value = false;
      return true;
    }
    if (deps.showSettingsModal.value) {
      deps.showSettingsModal.value = false;
      return true;
    }
    if (deps.showPasswordGenModal.value) {
      deps.showPasswordGenModal.value = false;
      return true;
    }
    if (deps.showBatchImportModal.value) {
      deps.showBatchImportModal.value = false;
      return true;
    }
    if (deps.showCustomUrlModal.value) {
      deps.showCustomUrlModal.value = false;
      return true;
    }
    if (deps.showBackupCodesModal.value) {
      if (deps.isEditingBackupCodesRaw.value) {
        deps.isEditingBackupCodesRaw.value = false;
      } else {
        deps.showBackupCodesModal.value = false;
      }
      return true;
    }
    if (deps.isEditing.value) {
      deps.isEditing.value = false;
      return true;
    }
    if (deps.isBatchSelectMode.value) {
      deps.isBatchSelectMode.value = false;
      deps.selectedBatchIds.value = [];
      return true;
    }
    if (deps.showMobileMoreMenu.value) {
      deps.showMobileMoreMenu.value = false;
      return true;
    }
    if (deps.showMobileSearch.value || deps.searchQuery.value) {
      deps.showMobileSearch.value = false;
      deps.searchQuery.value = "";
      return true;
    }
    if (deps.mobileView.value === "detail") {
      deps.mobileView.value = "list";
      deps.selectedId.value = null;
      return true;
    }
    if (deps.selectedId.value !== null) {
      deps.selectedId.value = null;
      return true;
    }
    return false;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      handleBackAction();
    }
  }

  async function setupBackNavigation() {
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeyDown);
    }
    try {
      const { onBackButtonPress, exit } = await import("@tauri-apps/api/app");
      backButtonListener = await onBackButtonPress(async () => {
        const handled = handleBackAction();
        if (!handled) {
          const now = Date.now();
          if (now - lastBackPressTime < 2000) {
            try {
              await exit(0);
            } catch (_) {}
          } else {
            lastBackPressTime = now;
            notify("再按一次退出应用", "info", 2000);
          }
        }
      });
    } catch (_) {}
  }

  function cleanupBackNavigation() {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", handleKeyDown);
    }
    if (backButtonListener) {
      backButtonListener.unregister().catch(() => {});
      backButtonListener = null;
    }
  }

  return {
    handleBackAction,
    setupBackNavigation,
    cleanupBackNavigation
  };
}
