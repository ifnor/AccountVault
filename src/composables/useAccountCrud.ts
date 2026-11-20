import { ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord, TotpQrResult, TotpResult } from "../types/vault";
import { getDisplayTitle, getPrimaryIdentifier } from "../utils/accountHelpers";
import { useToast } from "./useToast";
import { useConfirm } from "./useConfirm";

export function useAccountCrud(
  records: Ref<AccountRecord[]>,
  selectedId: Ref<string | null>,
  mobileView: Ref<"list" | "detail">,
  totpMap: Ref<Record<string, TotpResult>>,
  updateAllTotp: () => void,
  triggerDebouncedSync: () => void
) {
  const { notify } = useToast();
  const { askConfirm } = useConfirm();

  const isEditing = ref(false);
  const isSavingRecord = ref(false);
  const editForm = ref<AccountRecord>({
    id: "",
    title: "",
    login_url: "",
    username: "",
    email: "",
    password: "",
    group: "",
    status: "正常",
    plan: "",
    recovery_email: "",
    phone: "",
    totp: "",
    backup_codes: "",
    used_backup_codes: "[]",
    notes: ""
  });

  const showTotpQrModal = ref(false);
  const totpQrData = ref<TotpQrResult | null>(null);

  function openAddModal() {
    editForm.value = {
      id: "",
      title: "",
      login_url: "",
      username: "",
      email: "",
      password: "",
      group: "",
      status: "正常",
      plan: "",
      is_pinned: false,
      expire_at: "",
      proxy: "",
      recovery_email: "",
      phone: "",
      totp: "",
      backup_codes: "",
      used_backup_codes: "[]",
      notes: "",
      passkeys: []
    };
    isEditing.value = true;
  }

  function openEditModal(record: AccountRecord) {
    editForm.value = JSON.parse(JSON.stringify(record));
    if (!editForm.value.status) {
      editForm.value.status = "正常";
    }
    if (editForm.value.is_pinned === undefined) {
      editForm.value.is_pinned = false;
    }
    if (!editForm.value.expire_at) editForm.value.expire_at = "";
    if (!editForm.value.proxy) editForm.value.proxy = "";
    if (!editForm.value.login_url) editForm.value.login_url = "";
    if (!editForm.value.plan) editForm.value.plan = "";
    isEditing.value = true;
  }

  async function handleSaveRecord() {
    if ((!editForm.value.title.trim() && !editForm.value.username.trim() && !(editForm.value.email || "").trim()) || isSavingRecord.value) {
      notify("请至少填写平台名称或登录账号", "warning");
      return;
    }
    isSavingRecord.value = true;
    try {
      if (editForm.value.totp && editForm.value.totp.trim().toLowerCase().startsWith("otpauth://")) {
        try {
          editForm.value.totp = await invoke<string>("parse_totp_input", { raw: editForm.value.totp });
        } catch (_) {}
      }
      const saved = await invoke<AccountRecord>("save_record", { record: editForm.value });
      const idx = records.value.findIndex((r) => r.id === saved.id);
      if (idx >= 0) {
        records.value[idx] = saved;
      } else {
        records.value.unshift(saved);
      }
      selectedId.value = saved.id;
      isEditing.value = false;
      updateAllTotp();
      notify("账号信息已成功加密保存", "success");
      triggerDebouncedSync();
    } catch (err: any) {
      notify("保存失败: " + err, "error");
    } finally {
      isSavingRecord.value = false;
    }
  }

  async function handleDeleteRecord(id: string) {
    const confirmed = await askConfirm({
      title: "彻底删除账号记录",
      message: "确定要从本地加密安全库中删除该账号吗？删除前将自动保留历史快照备份。",
      type: "danger",
      confirmText: "确认删除",
      cancelText: "取消"
    });
    if (!confirmed) return;
    try {
      await invoke("delete_record", { id });
      records.value = records.value.filter((r) => r.id !== id);
      if (selectedId.value === id) {
        selectedId.value = records.value[0]?.id || null;
        mobileView.value = "list";
      }
      notify("账号记录已安全删除", "info");
      triggerDebouncedSync();
    } catch (err: any) {
      notify("删除失败: " + err, "error");
    }
  }

  async function generatePassword() {
    try {
      const pwd = await invoke<string>("generate_pwd", { length: 24, symbols: true });
      editForm.value.password = pwd;
    } catch (_) {}
  }

  async function handleIncrementHotp(id: string) {
    try {
      const updated = await invoke<AccountRecord>("increment_hotp_counter", { id });
      const idx = records.value.findIndex((r) => r.id === id);
      if (idx >= 0) {
        records.value[idx] = updated;
      }
      if (updated.totp) {
        const res = await invoke<TotpResult>("get_totp", { secret: updated.totp });
        totpMap.value = { ...totpMap.value, [id]: res };
      }
      notify("已生成下一位 HOTP 动态码", "success", 1500);
    } catch (e: any) {
      notify(`更新 HOTP 计数失败: ${e}`, "error");
    }
  }

  async function openTotpQrModal(record: AccountRecord) {
    if (!record.totp) return;
    try {
      totpQrData.value = await invoke<TotpQrResult>("get_totp_qr", {
        secret: record.totp,
        account: getPrimaryIdentifier(record) || "account",
        issuer: getDisplayTitle(record)
      });
      showTotpQrModal.value = true;
    } catch (err: any) {
      notify("生成 2FA 二维码失败: " + err, "error");
    }
  }

  return {
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
  };
}
