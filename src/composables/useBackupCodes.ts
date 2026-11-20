import { computed, ref, type ComputedRef, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord } from "../types/vault";
import { useToast } from "./useToast";
import { useConfirm } from "./useConfirm";

export function useBackupCodes(
  selectedRecord: ComputedRef<AccountRecord | null>,
  copiedField: Ref<string | null>,
  triggerDebouncedSync: () => void
) {
  const { notify } = useToast();
  const { askConfirm } = useConfirm();

  const showBackupCodesModal = ref(false);
  const backupCodesRawInput = ref("");
  const isEditingBackupCodesRaw = ref(false);

  const parsedBackupCodesList = computed(() => {
    if (!selectedRecord.value?.backup_codes) return [];
    const raw = selectedRecord.value.backup_codes.trim();
    return raw
      .split(/[\r\n,;\t]+/)
      .map((s) => s.replace(/\s+/g, "").trim())
      .filter(Boolean);
  });

  const usedBackupCodesSet = computed(() => {
    try {
      const arr = JSON.parse(selectedRecord.value?.used_backup_codes || "[]");
      return new Set<string>(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set<string>();
    }
  });

  const unusedBackupCodesCount = computed(() => {
    const all = parsedBackupCodesList.value;
    const used = usedBackupCodesSet.value;
    return all.filter((c) => !used.has(c)).length;
  });

  async function toggleBackupCode(code: string) {
    if (!selectedRecord.value) return;
    const currentSet = new Set(usedBackupCodesSet.value);
    if (currentSet.has(code)) {
      currentSet.delete(code);
    } else {
      currentSet.add(code);
    }
    selectedRecord.value.used_backup_codes = JSON.stringify(Array.from(currentSet));
    await invoke("save_record", { record: selectedRecord.value });
    triggerDebouncedSync();
  }

  async function copyAndConsumeNextBackupCode() {
    if (!selectedRecord.value) return;
    const all = parsedBackupCodesList.value;
    const used = new Set(usedBackupCodesSet.value);
    const next = all.find((c) => !used.has(c));
    if (!next) {
      notify("当前账号所有备用验证码已全部标记为已使用！", "warning");
      return;
    }
    await navigator.clipboard.writeText(next);
    used.add(next);
    selectedRecord.value.used_backup_codes = JSON.stringify(Array.from(used));
    await invoke("save_record", { record: selectedRecord.value });
    copiedField.value = "backup_code_consumed";
    notify(`⚡ 已复制未用码 [${next}] 并自动完成核销`, "success", 3000);
    triggerDebouncedSync();
    setTimeout(() => {
      if (copiedField.value === "backup_code_consumed") copiedField.value = null;
    }, 2500);
  }

  function openBackupCodesModal() {
    if (!selectedRecord.value) return;
    backupCodesRawInput.value = parsedBackupCodesList.value.join("\n");
    isEditingBackupCodesRaw.value = false;
    showBackupCodesModal.value = true;
  }

  async function saveRawBackupCodes() {
    if (!selectedRecord.value) return;
    const codes = backupCodesRawInput.value
      .split(/[\r\n,;\t]+/)
      .map((s) => s.replace(/\s+/g, "").trim())
      .filter(Boolean);
    selectedRecord.value.backup_codes = codes.join("\n");
    const codeSet = new Set(codes);
    const currentUsed = Array.from(usedBackupCodesSet.value).filter((c) => codeSet.has(c));
    selectedRecord.value.used_backup_codes = JSON.stringify(currentUsed);
    await invoke("save_record", { record: selectedRecord.value });
    isEditingBackupCodesRaw.value = false;
    notify(`成功更新 ${codes.length} 个备用验证码`, "success");
    triggerDebouncedSync();
  }

  async function resetAllUsedCodes() {
    if (!selectedRecord.value) return;
    const confirmed = await askConfirm({
      title: "重置备用验证码状态",
      message: "确定要将所有备用验证码恢复为「未使用」吗？",
      type: "warning",
      confirmText: "确认重置",
      cancelText: "取消"
    });
    if (!confirmed) return;
    selectedRecord.value.used_backup_codes = "[]";
    await invoke("save_record", { record: selectedRecord.value });
    notify("所有备用验证码状态已全部重置为未用", "info");
    triggerDebouncedSync();
  }

  return {
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
  };
}
