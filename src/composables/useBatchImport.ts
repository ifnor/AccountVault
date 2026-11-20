import { ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord } from "../types/vault";
import { parseCsvImport, parseJsonImport } from "../utils/importParsers";
import { useToast } from "./useToast";

export function useBatchImport(
  records: Ref<AccountRecord[]>,
  selectedId: Ref<string | null>,
  autoSelectFirst: Ref<boolean>,
  updateAllTotp: () => void,
  triggerDebouncedSync: () => void,
  handleImportVaultBlob: (blob: string, fileName: string) => Promise<void>
) {
  const { notify } = useToast();

  const showBatchImportModal = ref(false);
  const batchRawText = ref("");
  const batchAssignPlatform = ref("");
  const batchAssignGroup = ref("");
  const batchImportSourceLabel = ref("");
  const batchBaseRecords = ref<AccountRecord[]>([]);
  const batchParsedRecords = ref<AccountRecord[]>([]);

  function openBatchImportModal() {
    batchRawText.value = "";
    batchAssignPlatform.value = "";
    batchAssignGroup.value = "";
    batchImportSourceLabel.value = "";
    batchBaseRecords.value = [];
    batchParsedRecords.value = [];
    showBatchImportModal.value = true;
  }

  function applyBatchOverrides() {
    const p = batchAssignPlatform.value.trim();
    const g = batchAssignGroup.value.trim();
    batchParsedRecords.value = batchBaseRecords.value.map((item) => ({
      ...item,
      title: p || item.title,
      group: g || item.group || ""
    }));
  }

  function parseSmartLine(line: string): AccountRecord | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;

    let parts: string[] = [];
    if (trimmed.includes("----")) {
      parts = trimmed.split("----");
    } else if (trimmed.includes("\t")) {
      parts = trimmed.split("\t");
    } else if (trimmed.includes("|")) {
      parts = trimmed.split("|");
    } else if (trimmed.includes(",")) {
      parts = trimmed.split(",");
    } else {
      parts = trimmed.split(/\s+/);
    }
    parts = parts.map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    let title = batchAssignPlatform.value.trim();
    let username = "";
    let email = "";
    let password = "";
    let totp = "";
    let login_url = "";
    const notes: string[] = [];

    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const base32Regex = /^[A-Z2-7]{16,32}$/i;

    for (const part of parts) {
      if (part.startsWith("otpauth://")) {
        totp = part;
        continue;
      }
      if (part.startsWith("http://") || part.startsWith("https://")) {
        if (!login_url) login_url = part;
        continue;
      }
      if (base32Regex.test(part) && part.length >= 16 && !totp) {
        totp = part;
        continue;
      }
      if (emailRegex.test(part)) {
        if (!email) email = part;
        if (!username) username = part;
        continue;
      }
      if (!title && parts.length >= 3) {
        title = part;
        continue;
      }
      if (!username) {
        username = part;
        continue;
      }
      if (!password) {
        password = part;
        continue;
      }
      notes.push(part);
    }

    if (!username && !email) return null;

    return {
      id: "",
      title: title || "通用账号",
      login_url,
      username: username || email,
      email,
      password,
      group: batchAssignGroup.value.trim(),
      status: "正常",
      plan: "",
      recovery_email: "",
      phone: "",
      totp,
      backup_codes: "",
      used_backup_codes: "[]",
      notes: notes.join(" ")
    };
  }

  function handleBatchParse() {
    if (!batchRawText.value.trim() && batchBaseRecords.value.length > 0) {
      applyBatchOverrides();
      return;
    }
    const lines = batchRawText.value.split(/\r?\n/);
    const result: AccountRecord[] = [];
    for (const line of lines) {
      const parsed = parseSmartLine(line);
      if (parsed) {
        result.push(parsed);
      }
    }
    batchImportSourceLabel.value = result.length > 0 ? "智能文本解析" : "";
    batchBaseRecords.value = result;
    applyBatchOverrides();
  }

  function triggerImportExternalFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.json,.txt,.avault,.gvault";
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const nameLower = file.name.toLowerCase();
        const trimmed = text.replace(/^\uFEFF/, "").trim();

        if (nameLower.endsWith(".avault") || nameLower.endsWith(".gvault")) {
          showBatchImportModal.value = false;
          await handleImportVaultBlob(text, file.name);
          return;
        }

        if (nameLower.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj === "object" && !Array.isArray(obj) && obj.salt && obj.nonce && obj.data) {
              showBatchImportModal.value = false;
              await handleImportVaultBlob(text, file.name);
              return;
            }
          } catch (_) {}
          const res = parseJsonImport(trimmed);
          batchImportSourceLabel.value = `${res.formatLabel} (${file.name})`;
          batchBaseRecords.value = res.records as AccountRecord[];
          applyBatchOverrides();
          notify(`✅ 已从 ${res.formatLabel} 解析出 ${res.records.length} 条账号`, "success", 3000);
          return;
        }

        if (nameLower.endsWith(".csv") || trimmed.split(/\r?\n/)[0]?.includes(",")) {
          const res = parseCsvImport(text);
          if (res.records.length > 0) {
            batchImportSourceLabel.value = `${res.formatLabel} (${file.name})`;
            batchBaseRecords.value = res.records as AccountRecord[];
            applyBatchOverrides();
            notify(`✅ 已从 ${res.formatLabel} 解析出 ${res.records.length} 条账号`, "success", 3000);
            return;
          }
        }

        batchRawText.value = text;
        handleBatchParse();
      } catch (err: any) {
        notify("解析导入文件失败: " + (err?.message || err), "error", 5000);
      }
    };
    input.click();
  }

  async function confirmBatchImport() {
    if (batchParsedRecords.value.length === 0) return;
    try {
      const count = await invoke<number>("batch_import_records", {
        newRecords: batchParsedRecords.value
      });
      records.value = await invoke<AccountRecord[]>("get_records");
      showBatchImportModal.value = false;
      notify(`🎉 成功批量导入/合并了 ${count} 个账号记录！`, "success", 4000);
      if (autoSelectFirst.value && !selectedId.value && records.value.length > 0) {
        selectedId.value = records.value[0].id;
      }
      updateAllTotp();
      triggerDebouncedSync();
    } catch (err: any) {
      notify("批量导入失败: " + err, "error");
    }
  }

  return {
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
  };
}
