import { ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord } from "../types/vault";
import { useToast } from "./useToast";
import { useConfirm } from "./useConfirm";

export function useBackups(
  records: Ref<AccountRecord[]>,
  selectedId: Ref<string | null>,
  autoSelectFirst: Ref<boolean>,
  updateAllTotp: () => void,
  triggerDebouncedSync: () => void
) {
  const { notify } = useToast();
  const { askConfirm } = useConfirm();

  const backupTab = ref<"backups" | "export">("backups");
  const backupList = ref<Array<{ filename: string; timestamp: string; size_bytes: number }>>([]);
  const isLoadingBackups = ref(false);

  async function loadBackupsList() {
    isLoadingBackups.value = true;
    try {
      backupList.value = await invoke("list_vault_backups");
    } catch (_) {
      backupList.value = [];
    } finally {
      isLoadingBackups.value = false;
    }
  }

  async function handleCreateManualBackup() {
    try {
      const info = await invoke<{ filename: string; timestamp: string; size_bytes: number }>("create_manual_vault_backup");
      await loadBackupsList();
      notify(`📸 已成功创建本地加密快照：${info.filename}`, "success", 3000);
    } catch (err: any) {
      notify("创建手动快照失败: " + err, "error");
    }
  }

  async function handleRestoreBackup(filename: string) {
    const confirmed = await askConfirm({
      title: "回滚历史快照",
      message: `确定要回滚到历史版本 [${filename}] 吗？当前最新数据将自动创建新的安全快照备份。`,
      type: "warning",
      confirmText: "确认回滚",
      cancelText: "取消"
    });
    if (!confirmed) return;
    try {
      const restored = await invoke<AccountRecord[]>("restore_vault_backup", { filename });
      records.value = restored;
      selectedId.value = autoSelectFirst.value && restored.length > 0 ? restored[0].id : null;
      updateAllTotp();
      await loadBackupsList();
      notify(`🎉 成功回滚到历史版本！已载入 ${restored.length} 个账号记录。`, "success", 4000);
    } catch (err: any) {
      notify("回滚失败: " + err, "error");
    }
  }

  async function handleExportAvault() {
    try {
      const encryptedContent = await invoke<string>("export_encrypted_vault_string");
      const blob = new Blob([encryptedContent], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      link.download = `AccountVault_${dateStr}.avault`;
      link.click();
      URL.revokeObjectURL(url);
      notify("🛡️ 密文保险库文件 (.avault) 已成功导出并保存", "success", 3000);
    } catch (err: any) {
      notify("导出密文保险库失败: " + err, "error");
    }
  }

  async function handleImportVaultBlob(blob: string, fileName: string) {
    const confirmed = await askConfirm({
      title: "确认导入密文保险库？",
      message: `确定要从密文文件 [${fileName}] 导入并合并账号吗？\n支持 .avault 与 .gvault 格式，将使用当前主密码解密合并。`,
      type: "info",
      confirmText: "确认导入",
      cancelText: "取消"
    });
    if (!confirmed) return;

    try {
      const count = await invoke<number>("import_encrypted_vault_blob", { blob });
      records.value = await invoke<AccountRecord[]>("get_records");
      updateAllTotp();
      notify(`🎉 成功从密文文件导入并更新了 ${count} 条账号记录！`, "success", 4000);
      triggerDebouncedSync();
    } catch (err: any) {
      notify("导入密文保险库失败（请核对主密码是否一致）: " + err, "error", 6000);
    }
  }

  function triggerImportVaultFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".avault,.gvault,.json";
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await handleImportVaultBlob(text, file.name);
      } catch (err: any) {
        notify("读取文件失败: " + err, "error");
      }
    };
    input.click();
  }

  async function handleExportCsv() {
    try {
      const csvContent = await invoke<string>("export_records_csv_string");
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `AccountVault_Export_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      notify("CSV 表格已成功导出并保存", "success");
    } catch (err: any) {
      notify("导出失败: " + err, "error");
    }
  }

  function handleExportJson() {
    try {
      const jsonStr = JSON.stringify(records.value, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `AccountVault_Export_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify("JSON 数据已成功导出并保存", "success");
    } catch (err: any) {
      notify("导出失败: " + err, "error");
    }
  }

  return {
    backupTab,
    backupList,
    isLoadingBackups,
    loadBackupsList,
    handleCreateManualBackup,
    handleRestoreBackup,
    handleExportAvault,
    triggerImportVaultFile,
    handleImportVaultBlob,
    handleExportCsv,
    handleExportJson
  };
}
