import { computed, ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AccountRecord, SortRule } from "../types/vault";
import {
  getDisplayTitle,
  getExpireDaysLeft,
  getPrimaryIdentifier,
  isExpiringSoon
} from "../utils/accountHelpers";
import { useToast } from "./useToast";
import { useConfirm } from "./useConfirm";

export type HomeTabType = "totp" | "passwords" | "passkeys";

function loadDefaultHomeTab(): HomeTabType {
  try {
    const saved = localStorage.getItem("avault_default_home_tab");
    if (saved === "totp" || saved === "passwords" || saved === "passkeys") {
      return saved;
    }
  } catch (_) {}
  return "totp";
}

function hasUnusedBackupCodes(r: AccountRecord): boolean {
  const raw = (r.backup_codes || "").trim();
  if (!raw) return false;
  const codes = raw
    .split(/[\r\n,;\t]+/)
    .map((s) => s.replace(/\s+/g, "").trim())
    .filter((s) => s.length >= 4);
  if (codes.length === 0) return false;
  let used: string[] = [];
  try {
    used = JSON.parse(r.used_backup_codes || "[]");
  } catch (_) {}
  const usedSet = new Set(used);
  return codes.some((c) => !usedSet.has(c));
}

export function useAccountFilterAndBatch(
  records: Ref<AccountRecord[]>,
  selectedId: Ref<string | null>,
  searchQuery: Ref<string>,
  currentGroup: Ref<string | null>,
  sortRule: Ref<SortRule>,
  mobileView: Ref<"list" | "detail">,
  triggerDebouncedSync: () => void
) {
  const { notify } = useToast();
  const { askConfirm } = useConfirm();

  const showFilterPanel = ref(false);
  const attrFilter = ref({
    statuses: [] as string[],
    totp: "all" as "all" | "yes" | "no",
    backupCodes: "all" as "all" | "yes" | "no",
    email: "all" as "all" | "yes" | "no",
    phone: "all" as "all" | "yes" | "no",
    proxy: "all" as "all" | "yes" | "no",
    expire: "all" as "all" | "expired" | "soon7" | "soon30" | "has_date" | "no_date"
  });

  function toggleAttrStatus(s: string) {
    const idx = attrFilter.value.statuses.indexOf(s);
    if (idx >= 0) {
      attrFilter.value.statuses.splice(idx, 1);
    } else {
      attrFilter.value.statuses.push(s);
    }
  }

  function resetAttrFilter() {
    attrFilter.value = {
      statuses: [],
      totp: "all",
      backupCodes: "all",
      email: "all",
      phone: "all",
      proxy: "all",
      expire: "all"
    };
  }

  const activeFilterCount = computed(() => {
    let c = 0;
    if (attrFilter.value.statuses.length > 0) c++;
    if (attrFilter.value.totp !== "all") c++;
    if (attrFilter.value.backupCodes !== "all") c++;
    if (attrFilter.value.email !== "all") c++;
    if (attrFilter.value.phone !== "all") c++;
    if (attrFilter.value.proxy !== "all") c++;
    if (attrFilter.value.expire !== "all") c++;
    return c;
  });

  const defaultHomeTab = ref<HomeTabType>(loadDefaultHomeTab());
  const homeTab = ref<HomeTabType>(defaultHomeTab.value);

  function setDefaultHomeTab(tab: HomeTabType) {
    defaultHomeTab.value = tab;
    try {
      localStorage.setItem("avault_default_home_tab", tab);
    } catch (_) {}
    const label = tab === "totp" ? "OTP" : tab === "passwords" ? "密码" : "PassKey";
    notify(`已将默认启动页设为：${label}`, "success");
  }

  function switchHomeTab(tab: HomeTabType) {
    homeTab.value = tab;
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      mobileView.value = "list";
    }
  }

  const filteredRecords = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    const f = attrFilter.value;
    const list = records.value.filter((r) => {
      if (homeTab.value === "totp" && !(r.totp || "").trim()) return false;
      if (homeTab.value === "passkeys" && !(Array.isArray(r.passkeys) && r.passkeys.length > 0)) return false;
      if (currentGroup.value === "pinned" && !r.is_pinned) return false;
      if (currentGroup.value === "expiring" && !isExpiringSoon(r.expire_at)) return false;
      if (currentGroup.value === "" && (r.group || "").trim() !== "") return false;
      if (
        currentGroup.value &&
        currentGroup.value !== "pinned" &&
        currentGroup.value !== "expiring" &&
        currentGroup.value !== "" &&
        (r.group || "").trim() !== currentGroup.value
      ) {
        return false;
      }

      if (f.statuses.length > 0) {
        const s = r.status || "正常";
        if (!f.statuses.includes(s)) return false;
      }
      if (f.totp !== "all") {
        const hasTotp = Boolean((r.totp || "").trim());
        if (f.totp === "yes" && !hasTotp) return false;
        if (f.totp === "no" && hasTotp) return false;
      }
      if (f.backupCodes !== "all") {
        const hasValidBc = hasUnusedBackupCodes(r);
        if (f.backupCodes === "yes" && !hasValidBc) return false;
        if (f.backupCodes === "no" && hasValidBc) return false;
      }
      if (f.email !== "all") {
        const hasEmail = Boolean((r.email || "").trim() || (r.recovery_email || "").trim());
        if (f.email === "yes" && !hasEmail) return false;
        if (f.email === "no" && hasEmail) return false;
      }
      if (f.phone !== "all") {
        const hasPh = Boolean((r.phone || "").trim());
        if (f.phone === "yes" && !hasPh) return false;
        if (f.phone === "no" && hasPh) return false;
      }
      if (f.proxy !== "all") {
        const hasPrx = Boolean((r.proxy || "").trim());
        if (f.proxy === "yes" && !hasPrx) return false;
        if (f.proxy === "no" && hasPrx) return false;
      }
      if (f.expire !== "all") {
        const days = getExpireDaysLeft(r.expire_at);
        if (f.expire === "expired" && (days === null || days >= 0)) return false;
        if (f.expire === "soon7" && (days === null || days < 0 || days > 7)) return false;
        if (f.expire === "soon30" && (days === null || days < 0 || days > 30)) return false;
        if (f.expire === "has_date" && days === null) return false;
        if (f.expire === "no_date" && days !== null) return false;
      }

      if (q) {
        const match = [
          r.title,
          r.username,
          r.email,
          r.group,
          r.login_url,
          r.notes,
          r.recovery_email,
          r.status,
          r.plan,
          r.proxy,
          r.expire_at
        ]
          .join(" ")
          .toLowerCase();
        if (!match.includes(q)) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) {
        return a.is_pinned ? -1 : 1;
      }
      if (sortRule.value === "alphabetical") {
        const ka = `${getDisplayTitle(a)} ${getPrimaryIdentifier(a)}`.toLowerCase();
        const kb = `${getDisplayTitle(b)} ${getPrimaryIdentifier(b)}`.toLowerCase();
        return ka.localeCompare(kb);
      } else if (sortRule.value === "updated_desc") {
        const ta = a.updated_at || a.created_at || 0;
        const tb = b.updated_at || b.created_at || 0;
        if (tb !== ta) return tb - ta;
        return getDisplayTitle(a).toLowerCase().localeCompare(getDisplayTitle(b).toLowerCase());
      } else if (sortRule.value === "created_desc") {
        const ta = a.created_at || a.updated_at || 0;
        const tb = b.created_at || b.updated_at || 0;
        if (tb !== ta) return tb - ta;
        return getDisplayTitle(a).toLowerCase().localeCompare(getDisplayTitle(b).toLowerCase());
      }
      return 0;
    });
  });

  async function togglePinRecord(r: AccountRecord) {
    r.is_pinned = !r.is_pinned;
    try {
      const saved = await invoke<AccountRecord>("save_record", { record: r });
      const idx = records.value.findIndex((item) => item.id === saved.id);
      if (idx >= 0) records.value[idx] = saved;
      notify(
        saved.is_pinned ? `⭐ 已将 [${getDisplayTitle(saved)}] 设为星标置顶` : `已取消 [${getDisplayTitle(saved)}] 的星标置顶`,
        "info",
        1800
      );
      triggerDebouncedSync();
    } catch (err: any) {
      r.is_pinned = !r.is_pinned;
      notify("置顶状态更新失败: " + err, "error");
    }
  }

  const isBatchSelectMode = ref(false);
  const selectedBatchIds = ref<string[]>([]);
  const showBatchActionModal = ref(false);
  const batchActionType = ref<"group" | "status" | "plan">("group");
  const batchTargetGroup = ref("");
  const batchTargetStatus = ref("正常");
  const batchTargetPlan = ref("");

  function toggleSelectBatchItem(id: string) {
    const idx = selectedBatchIds.value.indexOf(id);
    if (idx >= 0) {
      selectedBatchIds.value.splice(idx, 1);
    } else {
      selectedBatchIds.value.push(id);
    }
  }

  function openBatchUpdateDialog(type: "group" | "status" | "plan") {
    if (selectedBatchIds.value.length === 0) {
      notify("请先勾选至少一个账号", "warning");
      return;
    }
    batchActionType.value = type;
    showBatchActionModal.value = true;
  }

  async function executeBatchUpdate() {
    if (selectedBatchIds.value.length === 0) return;
    try {
      const count = selectedBatchIds.value.length;
      const updated = await invoke<AccountRecord[]>("batch_update_records", {
        ids: selectedBatchIds.value,
        group: batchActionType.value === "group" ? batchTargetGroup.value : null,
        status: batchActionType.value === "status" ? batchTargetStatus.value : null,
        plan: batchActionType.value === "plan" ? batchTargetPlan.value : null,
        isPinned: null
      });
      records.value = updated;
      showBatchActionModal.value = false;
      notify(`✅ 已成功批量更新 ${count} 个账号`, "success");
      triggerDebouncedSync();
    } catch (err: any) {
      notify("批量更新失败: " + err, "error");
    }
  }

  async function executeBatchPin(pin: boolean) {
    if (selectedBatchIds.value.length === 0) return;
    try {
      const count = selectedBatchIds.value.length;
      const updated = await invoke<AccountRecord[]>("batch_update_records", {
        ids: selectedBatchIds.value,
        group: null,
        status: null,
        plan: null,
        isPinned: pin
      });
      records.value = updated;
      notify(pin ? `⭐ 已批量置顶 ${count} 个账号` : `已取消 ${count} 个账号的置顶`, "success");
      triggerDebouncedSync();
    } catch (err: any) {
      notify("批量操作失败: " + err, "error");
    }
  }

  function executeBatchExportSelected() {
    if (selectedBatchIds.value.length === 0) return;
    const idSet = new Set(selectedBatchIds.value);
    const selectedList = records.value.filter((r) => idSet.has(r.id));
    const header = "平台名称,登录账号,绑定邮箱,登录密码,账号状态,分组,登录网址,绑定手机,恢复邮箱/密保,TOTP密钥,会员/套餐,到期日期,独立代理,备用验证码,备注\n";
    const rows = selectedList.map((r) => {
      const fields = [
        r.title || "",
        r.username || "",
        r.email || "",
        r.password || "",
        r.status || "正常",
        r.group || "",
        r.login_url || "",
        r.phone || "",
        r.recovery_email || "",
        r.totp || "",
        r.plan || "",
        r.expire_at || "",
        r.proxy || "",
        r.backup_codes || "",
        r.notes || ""
      ];
      return fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(",");
    });
    const csvContent = "\uFEFF" + header + rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `AccountVault_Selected_${selectedList.length}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`已成功导出选中的 ${selectedList.length} 个账号为 CSV`, "success");
  }

  async function executeBatchDelete() {
    if (selectedBatchIds.value.length === 0) return;
    const count = selectedBatchIds.value.length;
    const confirmed = await askConfirm({
      title: "批量删除账号确认",
      message: `确定要删除已勾选的 ${count} 个账号记录吗？删除前系统将自动为您保留本地历史快照备份。`,
      type: "danger",
      confirmText: `确认删除 (${count})`,
      cancelText: "取消"
    });
    if (!confirmed) return;
    try {
      const remaining = await invoke<AccountRecord[]>("batch_delete_records", {
        ids: selectedBatchIds.value
      });
      records.value = remaining;
      if (selectedId.value && selectedBatchIds.value.includes(selectedId.value)) {
        selectedId.value = null;
        mobileView.value = "list";
      }
      selectedBatchIds.value = [];
      isBatchSelectMode.value = false;
      notify(`🗑️ 已安全删除 ${count} 个账号记录`, "info");
      triggerDebouncedSync();
    } catch (err: any) {
      notify("批量删除失败: " + err, "error");
    }
  }

  return {
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
  };
}
