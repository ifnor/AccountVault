<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Lock,
  Unlock,
  Search,
  Plus,
  Copy,
  Check,
  ExternalLink,
  Globe,
  Trash2,
  Edit3,
  Eye,
  EyeOff,
  Folder,
  Sparkles,
  Clock,
  Info,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Compass,
  Upload,
  Cloud,
  History,
  Download,
  KeyRound,
  RefreshCw,
  FileText,
  Fingerprint,
  Settings,
  ChevronLeft,
  MoreVertical,
  Zap,
  Shield,
  ArrowUpDown,
  Star,
  CheckSquare,
  Square,
  QrCode,
  Calendar,
  Network,
  Filter,
  RotateCcw,
  X
} from "lucide-vue-next";
import jsQR from "jsqr";
import pkg from "../package.json";
import { parseCsvImport, parseJsonImport } from "./utils/importParsers";

const appVersion = ref(pkg.version || "1.0.0");

interface AccountRecord {
  id: string;
  title: string;
  login_url?: string;
  username: string;
  email?: string;
  password?: string;
  group?: string;
  status?: string;
  plan?: string;
  is_pinned?: boolean;
  expire_at?: string;
  proxy?: string;
  recovery_email?: string;
  phone?: string;
  totp?: string;
  backup_codes?: string;
  used_backup_codes?: string;
  notes?: string;
  passkeys?: Array<{
    credential_id: string;
    rp_id: string;
    rp_name?: string;
    user_name?: string;
    user_display_name?: string;
    sign_count?: number;
    created_at?: number;
  }>;
  updated_at?: number;
  created_at?: number;
  deleted_at?: number | null;
  [key: string]: any;
}

interface TotpResult {
  code: string;
  remaining_seconds: number;
}

interface TotpQrResult {
  qr_base64: string;
  otpauth_url: string;
  secret: string;
}

function getPrimaryIdentifier(r: AccountRecord): string {
  return (r.username || "").trim() || (r.email || "").trim();
}

function getDisplayTitle(r: AccountRecord): string {
  return (r.title || "").trim() || (r.group || "").trim() || "未命名平台";
}

function getSessionKey(r: AccountRecord): string {
  return r.id || `${getDisplayTitle(r)}::${getPrimaryIdentifier(r)}`;
}

const KNOWN_PLATFORM_DOMAINS: Record<string, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
  google: "google.com",
  gmail: "gmail.com",
  openai: "chatgpt.com",
  chatgpt: "chatgpt.com",
  cloudflare: "cloudflare.com",
  microsoft: "microsoft.com",
  outlook: "outlook.com",
  aws: "aws.amazon.com",
  amazon: "amazon.com",
  steam: "steampowered.com",
  notion: "notion.so",
  discord: "discord.com",
  apple: "apple.com",
  icloud: "icloud.com",
  docker: "docker.com",
  vercel: "vercel.com",
  bilibili: "bilibili.com",
  taobao: "taobao.com",
  jd: "jd.com",
  aliyun: "aliyun.com",
  tencent: "qq.com",
  qq: "qq.com",
  weibo: "weibo.com",
  zhihu: "zhihu.com",
  baidu: "baidu.com",
  twitter: "x.com",
  x: "x.com",
  netflix: "netflix.com",
  spotify: "spotify.com"
};

function getRecordDomain(r: AccountRecord): string {
  const rawUrl = (r.login_url || "").trim();
  if (rawUrl) {
    try {
      const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const host = new URL(normalized).hostname.replace(/^www\./i, "");
      if (host && host.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        return host;
      }
    } catch {}
  }
  const title = (r.title || "").trim().toLowerCase();
  if (title) {
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(title)) {
      return title.replace(/^www\./i, "");
    }
    for (const [kw, domain] of Object.entries(KNOWN_PLATFORM_DOMAINS)) {
      if (title.includes(kw)) return domain;
    }
  }
  return "";
}

const faviconFallbackStage = ref<Record<string, number>>({});

function getFaviconUrl(r: AccountRecord): string | null {
  const domain = getRecordDomain(r);
  if (!domain) return null;
  const stage = faviconFallbackStage.value[domain] || 0;
  if (stage === 0) {
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
  }
  if (stage === 1) {
    return `https://${domain}/favicon.ico`;
  }
  return null;
}

function handleFaviconError(r: AccountRecord) {
  const domain = getRecordDomain(r);
  if (!domain) return;
  const cur = faviconFallbackStage.value[domain] || 0;
  faviconFallbackStage.value = {
    ...faviconFallbackStage.value,
    [domain]: cur + 1
  };
}

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
const detailWidth = ref<number>(
  Math.max(280, Math.min(520, Number(localStorage.getItem("avault_detail_panel_width") || 350)))
);
const isResizingDetail = ref(false);
const isDesktopWindow = ref(typeof window !== "undefined" ? window.innerWidth >= 768 : true);

function updateWindowWidth() {
  if (typeof window !== "undefined") {
    isDesktopWindow.value = window.innerWidth >= 768;
  }
}

function startResizeDetail(e: MouseEvent) {
  e.preventDefault();
  isResizingDetail.value = true;
  const startX = e.clientX;
  const startWidth = detailWidth.value;

  function onMouseMove(moveEvent: MouseEvent) {
    const delta = startX - moveEvent.clientX;
    const newWidth = Math.max(280, Math.min(520, startWidth + delta));
    detailWidth.value = newWidth;
  }

  function onMouseUp() {
    isResizingDetail.value = false;
    localStorage.setItem("avault_detail_panel_width", String(detailWidth.value));
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

function resetDetailWidth() {
  detailWidth.value = 350;
  localStorage.setItem("avault_detail_panel_width", "350");
}

// TOTP Cache & Timer
const totpMap = ref<Record<string, TotpResult>>({});
let totpTimer: number | null = null;

// Custom In-App Toast & Confirmation Dialog System
interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "warning" | "info";
}
const toasts = ref<ToastItem[]>([]);
let toastCounter = 0;

function notify(message: string, type: "success" | "error" | "warning" | "info" = "info", duration = 3200) {
  const id = ++toastCounter;
  toasts.value.push({ id, message, type });
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }, duration);
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "warning" | "info";
}
const confirmState = ref<{
  visible: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  type: "danger" | "warning" | "info";
  resolve: (value: boolean) => void;
}>({
  visible: false,
  title: "操作确认",
  message: "",
  confirmText: "确定",
  cancelText: "取消",
  type: "info",
  resolve: () => {}
});

function askConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
  return new Promise((resolve) => {
    confirmState.value = {
      visible: true,
      title: opts.title || (opts.type === "danger" ? "高危操作确认" : "操作确认"),
      message: opts.message,
      confirmText: opts.confirmText || "确定",
      cancelText: opts.cancelText || "取消",
      type: opts.type || "info",
      resolve: (val: boolean) => {
        confirmState.value.visible = false;
        resolve(val);
      }
    };
  });
}

// UI Helpers
const showPassword = ref(false);
const copiedField = ref<string | null>(null);
const isEditing = ref(false);
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

const accountStatusOptions = [
  "正常",
  "待录入",
  "异常",
  "封禁",
  "停用"
];

function getStatusBadgeClass(status?: string) {
  const s = status || "正常";
  switch (s) {
    case "正常":
      return "px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80";
    case "停用":
      return "px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80";
    case "异常":
      return "px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80";
    case "封禁":
      return "px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300";
    case "待录入":
    default:
      return "px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200/80";
  }
}

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

// Expiration Date Helper
function getExpireDaysLeft(expireAt?: string): number | null {
  if (!expireAt || !expireAt.trim()) return null;
  const parts = expireAt.trim().split("-");
  if (parts.length !== 3) return null;
  const target = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  return Math.floor((target.getTime() - todayStart.getTime()) / (1000 * 3600 * 24));
}

function isExpiringSoon(expireAt?: string): boolean {
  const days = getExpireDaysLeft(expireAt);
  return days !== null && days <= 7;
}

function getExpireBadge(expireAt?: string): { label: string; class: string; urgent: boolean } | null {
  const days = getExpireDaysLeft(expireAt);
  if (days === null) return null;
  if (days < 0) {
    return {
      label: `已过期 ${Math.abs(days)} 天`,
      class: "px-1.5 py-0.2 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-300",
      urgent: true
    };
  }
  if (days === 0) {
    return {
      label: "今日到期",
      class: "px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300",
      urgent: true
    };
  }
  if (days <= 7) {
    return {
      label: `${days}天后到期`,
      class: "px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200",
      urgent: true
    };
  }
  if (days <= 30) {
    return {
      label: `${days}天后到期`,
      class: "px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200",
      urgent: false
    };
  }
  return {
    label: `到期: ${expireAt}`,
    class: "px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#f1f3f4] text-[#5f6368]",
    urgent: false
  };
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

type SortRule = "alphabetical" | "updated_desc" | "created_desc";

const sortRule = ref<SortRule>((localStorage.getItem("avault_sort_rule") as SortRule) || "alphabetical");

function setSortRule(rule: SortRule) {
  sortRule.value = rule;
  try {
    localStorage.setItem("avault_sort_rule", rule);
  } catch (e) {}
}

const sortRuleLabel = computed(() => {
  switch (sortRule.value) {
    case "alphabetical":
      return "按名称 (A-Z)";
    case "updated_desc":
      return "按更新时间";
    case "created_desc":
      return "按添加时间";
    default:
      return "按名称 (A-Z)";
  }
});

function cycleSortRule() {
  if (sortRule.value === "alphabetical") {
    setSortRule("updated_desc");
    notify("已切换为：按更新时间排序 (最近修改优先)", "info", 1800);
  } else if (sortRule.value === "updated_desc") {
    setSortRule("created_desc");
    notify("已切换为：按添加时间排序 (最新录入优先)", "info", 1800);
  } else {
    setSortRule("alphabetical");
    notify("已切换为：按平台/账号名称排序 (A-Z，固定不跳动)", "info", 1800);
  }
}

// ==================== MULTI-ATTRIBUTE FILTERING ====================
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

function hasUnusedBackupCodes(r: AccountRecord): boolean {
  const raw = (r.backup_codes || "").trim();
  if (!raw) return false;
  const codes = raw.split(/[\r\n,;\t]+/).map((s) => s.replace(/\s+/g, "").trim()).filter((s) => s.length >= 4);
  if (codes.length === 0) return false;
  let used: string[] = [];
  try {
    used = JSON.parse(r.used_backup_codes || "[]");
  } catch (_) {}
  const usedSet = new Set(used);
  return codes.some((c) => !usedSet.has(c));
}

const homeTab = ref<"totp" | "passwords" | "passkeys">("passwords");

const homeTabCounts = computed(() => {
  const all = records.value;
  return {
    totp: all.filter((r) => Boolean((r.totp || "").trim())).length,
    passwords: all.length,
    passkeys: all.filter((r) => Array.isArray(r.passkeys) && r.passkeys.length > 0).length,
  };
});

function switchHomeTab(tab: "totp" | "passwords" | "passkeys") {
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
      ].join(" ").toLowerCase();
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

// ==================== PIN & BATCH MANAGEMENT ====================
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

function toggleBatchSelectMode() {
  isBatchSelectMode.value = !isBatchSelectMode.value;
  selectedBatchIds.value = [];
}

function toggleSelectBatchItem(id: string) {
  const idx = selectedBatchIds.value.indexOf(id);
  if (idx >= 0) {
    selectedBatchIds.value.splice(idx, 1);
  } else {
    selectedBatchIds.value.push(id);
  }
}

const isAllFilteredSelected = computed(() => {
  if (filteredRecords.value.length === 0) return false;
  const set = new Set(selectedBatchIds.value);
  return filteredRecords.value.every((r) => set.has(r.id));
});

function toggleSelectAllFiltered() {
  if (isAllFilteredSelected.value) {
    selectedBatchIds.value = [];
  } else {
    selectedBatchIds.value = filteredRecords.value.map((r) => r.id);
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

// ==================== AUTO-LOCK, CLIPBOARD CLEAR & MASTER PASSWORD ====================
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

function setAutoLockMinutes(mins: number) {
  autoLockMinutes.value = mins;
  try {
    localStorage.setItem("avault_auto_lock_minutes", String(mins));
  } catch (e) {}
  lastActivityTime = Date.now();
  notify(mins > 0 ? `已开启：无操作 ${mins} 分钟后自动锁定保险库` : "已关闭空闲自动锁定", "info", 2000);
}

function setClipboardClearSeconds(secs: number) {
  clipboardClearSeconds.value = secs;
  try {
    localStorage.setItem("avault_clipboard_clear_seconds", String(secs));
  } catch (e) {}
  notify(secs > 0 ? `已开启：复制敏感信息 ${secs} 秒后自动清空剪贴板` : "已关闭剪贴板自动清理", "info", 2000);
}

let lastActivityTime = Date.now();
let idleLockCheckTimer: any = null;
let clipboardClearTimer: any = null;

function recordUserActivity() {
  lastActivityTime = Date.now();
}

function scheduleClipboardClear() {
  if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
  if (clipboardClearSeconds.value <= 0) return;
  const delayMs = clipboardClearSeconds.value * 1000;
  clipboardClearTimer = setTimeout(async () => {
    try {
      await navigator.clipboard.writeText("");
    } catch (e) {}
  }, delayMs);
}

// Change Master Password Modal State
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

    if (webdavForm.value.auto_sync && webdavForm.value.url.trim()) {
      try {
        await invoke("upload_webdav_vault", { config: webdavForm.value });
      } catch (e) {}
    }
  } catch (err: any) {
    notify("修改主密码失败: " + err, "error");
  } finally {
    isChangingPwd.value = false;
  }
}

// 2FA QR Code Display & Image / URI Recognition
const showTotpQrModal = ref(false);
const totpQrData = ref<TotpQrResult | null>(null);

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

async function normalizeEditTotpSecret(rawText: string, sourceDesc = "2FA 密钥") {
  try {
    const cleanSecret = await invoke<string>("parse_totp_input", { raw: rawText });
    editForm.value.totp = cleanSecret;
    notify(`✅ 已成功解析并填入 ${sourceDesc} (${cleanSecret.slice(0, 4)}****)`, "success", 2800);
  } catch (err: any) {
    notify(`解析 ${sourceDesc} 失败: ` + err, "error");
  }
}

function decodeQrFromImageFile(file: File) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        notify("浏览器 Canvas 初始化失败", "error");
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        await normalizeEditTotpSecret(code.data, "二维码中的 2FA 密钥");
      } else {
        notify("未能在图片中识别到有效的二维码，请确保二维码清晰完整", "warning");
      }
    };
    img.src = String(ev.target?.result || "");
  };
  reader.readAsDataURL(file);
}

function triggerScanQrImage() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = (e: any) => {
    const file = e.target?.files?.[0];
    if (file) {
      decodeQrFromImageFile(file);
    }
  };
  input.click();
}

function handleTotpPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) {
      const file = items[i].getAsFile();
      if (file) {
        e.preventDefault();
        decodeQrFromImageFile(file);
        return;
      }
    }
  }
}

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

// Edit / Add Actions
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
    notes: ""
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

const isSavingRecord = ref(false);

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
  } catch (e) {}
}

// In-App Isolated Browser & Custom Service Presets
const isOpeningBrowser = ref(false);
const showCustomUrlModal = ref(false);
const customUrlInput = ref("https://");
const isManagingPresets = ref(false);
const newPresetName = ref("");
const newPresetUrl = ref("https://");

const defaultServicePresets = [
  { name: "GitHub", url: "https://github.com/login" },
  { name: "OpenAI / ChatGPT", url: "https://chatgpt.com/" },
  { name: "Cloudflare", url: "https://dash.cloudflare.com/login" },
  { name: "Google 账号", url: "https://myaccount.google.com" },
  { name: "Microsoft 账号", url: "https://account.microsoft.com" },
  { name: "AWS 控制台", url: "https://console.aws.amazon.com" },
  { name: "Steam", url: "https://store.steampowered.com/login/" },
  { name: "Notion", url: "https://www.notion.so/login" },
];

function loadSavedServicePresets(): Array<{ name: string; url: string }> {
  try {
    const raw = localStorage.getItem("avault_custom_service_presets");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {}
  return [...defaultServicePresets];
}

const servicePresets = ref<Array<{ name: string; url: string }>>(loadSavedServicePresets());

function saveServicePresets() {
  try {
    localStorage.setItem("avault_custom_service_presets", JSON.stringify(servicePresets.value));
  } catch (e) {}
}

function addCustomServicePreset() {
  const name = newPresetName.value.trim();
  let url = newPresetUrl.value.trim();
  if (!name || !url || url === "https://") {
    notify("请输入快捷网站名称与完整网址", "warning");
    return;
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  servicePresets.value.push({ name, url });
  saveServicePresets();
  newPresetName.value = "";
  newPresetUrl.value = "https://";
  notify(`已添加快捷网址：${name}`, "success", 1800);
}

function removeServicePreset(idx: number) {
  servicePresets.value.splice(idx, 1);
  saveServicePresets();
}

function resetDefaultServicePresets() {
  servicePresets.value = [...defaultServicePresets];
  saveServicePresets();
  notify("已恢复默认常用网站列表", "info", 1800);
}

async function openInApp(url: string) {
  if (!selectedRecord.value) return;
  let finalUrl = url.trim();
  if (!finalUrl) {
    openCustomUrlModal();
    return;
  }
  if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
    finalUrl = "https://" + finalUrl;
  }
  isOpeningBrowser.value = true;
  try {
    await invoke("open_in_app_browser", {
      sessionKey: getSessionKey(selectedRecord.value),
      title: getDisplayTitle(selectedRecord.value),
      username: getPrimaryIdentifier(selectedRecord.value),
      email: selectedRecord.value.email || "",
      password: selectedRecord.value.password || "",
      totpSecret: selectedRecord.value.totp || "",
      recoveryEmail: selectedRecord.value.recovery_email || "",
      proxy: selectedRecord.value.proxy || "",
      url: finalUrl
    });
  } catch (err: any) {
    notify("应用内浏览器启动异常，正在通过系统浏览器打开", "warning");
    try {
      await invoke("open_external_url", { url: finalUrl });
    } catch (_) {}
  } finally {
    isOpeningBrowser.value = false;
  }
}

function openCustomUrlModal() {
  customUrlInput.value = selectedRecord.value?.login_url?.trim() || "https://";
  isManagingPresets.value = false;
  showCustomUrlModal.value = true;
}

function handleOpenCustomUrl() {
  let url = customUrlInput.value.trim();
  if (!url || url === "https://") return;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  showCustomUrlModal.value = false;
  openInApp(url);
}

async function clearCurrentAccountSession() {
  if (!selectedRecord.value) return;
  const label = `${getDisplayTitle(selectedRecord.value)} (${getPrimaryIdentifier(selectedRecord.value)})`;
  const confirmed = await askConfirm({
    title: "清理独立会话沙箱",
    message: `确定要清除账号【${label}】独立会话窗口下的所有 Cookie 与本地缓存吗？`,
    type: "warning",
    confirmText: "确定清理",
    cancelText: "取消"
  });
  if (!confirmed) return;
  try {
    const msg = await invoke<string>("clear_account_browser_session", {
      sessionKey: getSessionKey(selectedRecord.value),
      labelHint: label
    });
    notify("✓ " + msg, "success", 2800);
  } catch (err: any) {
    notify("清理独立会话失败: " + err, "error");
  }
}

// ==================== EXTERNAL BROWSER LAUNCH TAKEOVER (60s) ====================
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

// ==================== BACKUP CODES MANAGEMENT ====================
const showBackupCodesModal = ref(false);
const backupCodesRawInput = ref("");
const isEditingBackupCodesRaw = ref(false);

const parsedBackupCodesList = computed(() => {
  if (!selectedRecord.value?.backup_codes) return [];
  const raw = selectedRecord.value.backup_codes.trim();
  const lines = raw.split(/[\r\n,;\t]+/).map(s => s.replace(/\s+/g, "").trim()).filter(Boolean);
  return lines;
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
  return all.filter(c => !used.has(c)).length;
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
  const next = all.find(c => !used.has(c));
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
  const codes = backupCodesRawInput.value.split(/[\r\n,;\t]+/).map(s => s.replace(/\s+/g, "").trim()).filter(Boolean);
  selectedRecord.value.backup_codes = codes.join("\n");
  const codeSet = new Set(codes);
  const currentUsed = Array.from(usedBackupCodesSet.value).filter(c => codeSet.has(c));
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

// ==================== BATCH IMPORT & SMART PARSER ====================
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
        } catch {}
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
  parts = parts.map(p => p.trim()).filter(Boolean);
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

// ==================== WEBDAV CLOUD SYNC ====================
interface SmartSyncResult {
  synced: boolean;
  message: string;
  records_updated: boolean;
  records_count: number;
  last_sync_time: number;
}

type SyncState = "idle" | "syncing" | "success" | "error";

const webdavForm = ref({
  url: "",
  username: "",
  password: "",
  auto_sync: true,
  last_sync_time: null as number | null,
  last_etag: null as string | null
});
const webdavStatus = ref("");
const isWebDavSyncing = ref(false);
const syncState = ref<SyncState>("idle");
const syncTooltip = ref<string>("WebDAV 云端同步就绪");

const lastSyncTimeFormatted = computed(() => {
  if (!webdavForm.value.last_sync_time) return "从未同步";
  const d = new Date(webdavForm.value.last_sync_time);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${mins}`;
});

async function loadWebDavConfig() {
  try {
    const saved = await invoke<any>("load_webdav_config");
    if (saved && (saved.url || saved.username || saved.password)) {
      webdavForm.value = {
        url: saved.url || "",
        username: saved.username || "",
        password: saved.password || "",
        auto_sync: saved.auto_sync !== false,
        last_sync_time: saved.last_sync_time || null,
        last_etag: saved.last_etag || null
      };
      try {
        localStorage.setItem("avault_webdav_config", JSON.stringify(webdavForm.value));
      } catch (e) {}
      return;
    }
  } catch (e) {}

  try {
    const localStr = localStorage.getItem("avault_webdav_config");
    if (localStr) {
      const parsed = JSON.parse(localStr);
      if (parsed && (parsed.url || parsed.username || parsed.password)) {
        webdavForm.value = {
          url: parsed.url || "",
          username: parsed.username || "",
          password: parsed.password || "",
          auto_sync: parsed.auto_sync !== false,
          last_sync_time: parsed.last_sync_time || null,
          last_etag: parsed.last_etag || null
        };
      }
    }
  } catch (e) {}
}

async function handleSaveWebDavConfig(notifyUser = true) {
  try {
    await invoke("save_webdav_config", { config: webdavForm.value });
    try {
      localStorage.setItem("avault_webdav_config", JSON.stringify(webdavForm.value));
    } catch (e) {}
    if (notifyUser) {
      webdavStatus.value = "✅ 配置已成功保存到本地安全存储";
      notify("WebDAV 配置已保存", "success", 2500);
    }
  } catch (err: any) {
    webdavStatus.value = "❌ 保存失败: " + err;
    if (notifyUser) notify("保存 WebDAV 配置失败: " + err, "error");
  }
}

let isSyncingSmart = false;
let debouncedSyncTimer: any = null;

async function triggerSmartSync(silent = false) {
  if (isSyncingSmart) return;
  if (!webdavForm.value.url.trim() || !webdavForm.value.username.trim() || !webdavForm.value.password.trim()) {
    syncState.value = "idle";
    syncTooltip.value = "未配置 WebDAV 云端同步";
    if (!silent) {
      notify("请先在「设置 -> 云端同步」中配置服务器地址与密码", "warning");
    }
    return;
  }
  if (silent && !webdavForm.value.auto_sync) {
    return;
  }

  isSyncingSmart = true;
  isWebDavSyncing.value = true;
  syncState.value = "syncing";
  syncTooltip.value = "正在智能检测并同步云端数据...";

  try {
    const res = await invoke<SmartSyncResult>("sync_webdav_smart");
    if (res.synced) {
      syncState.value = "success";
      webdavForm.value.last_sync_time = res.last_sync_time;
      syncTooltip.value = res.message;
      if (res.records_updated) {
        records.value = await invoke<AccountRecord[]>("get_records");
        updateAllTotp();
        if (!silent) {
          notify(`🎉 ${res.message} (当前共 ${res.records_count} 个有效账号)`, "success", 3000);
        }
      } else if (!silent) {
        notify(res.message, "success", 2500);
      }
    } else {
      syncState.value = "idle";
      syncTooltip.value = res.message;
      if (!silent) {
        notify(res.message, "info", 2500);
      }
    }
  } catch (err: any) {
    syncState.value = "error";
    const errStr = typeof err === "string" ? err : (err?.message || "网络请求异常");
    syncTooltip.value = `同步失败: ${errStr}`;
    if (!silent) {
      notify(`云同步失败: ${errStr}`, "error", 4000);
    }
  } finally {
    isSyncingSmart = false;
    isWebDavSyncing.value = false;
    if (syncState.value === "success") {
      setTimeout(() => {
        if (syncState.value === "success") {
          syncState.value = "idle";
          syncTooltip.value = `云端同步正常 (上次: ${lastSyncTimeFormatted.value})`;
        }
      }, 3500);
    }
  }
}

function triggerDebouncedSync() {
  if (!webdavForm.value.auto_sync || !webdavForm.value.url.trim()) return;
  if (debouncedSyncTimer) clearTimeout(debouncedSyncTimer);
  debouncedSyncTimer = setTimeout(() => {
    triggerSmartSync(true);
  }, 1500);
}

// ==================== SETTINGS & GITHUB UPDATE ====================
const showSettingsModal = ref(false);
const settingsTab = ref<"security" | "webdav" | "backups" | "updates" | "about">("security");

interface ReleaseAsset {
  name: string;
  download_url: string;
  size: number;
  asset_type: string;
}

interface UpdateInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string;
  release_notes: string;
  published_at: string;
  release_url: string;
  download_url: string | null;
  setup_url: string | null;
  portable_url: string | null;
  apk_url: string | null;
  current_install_type: string;
  assets: ReleaseAsset[];
}
type UpdateMirror = "gh-proxy" | "ghproxy" | "official";

const customRepo = ref("ifnor/AccountVault");
const updateMirror = ref<UpdateMirror>(
  (localStorage.getItem("avault_update_mirror") as UpdateMirror) || "gh-proxy"
);
const autoCheckUpdateOnStartup = ref<boolean>(
  localStorage.getItem("avault_auto_check_update") !== "false"
);

function toggleAutoCheckUpdate() {
  autoCheckUpdateOnStartup.value = !autoCheckUpdateOnStartup.value;
  try {
    localStorage.setItem("avault_auto_check_update", String(autoCheckUpdateOnStartup.value));
  } catch (e) {}
  notify(
    autoCheckUpdateOnStartup.value
      ? "已开启：启动应用时自动静默检查新版本"
      : "已关闭启动自动检查更新",
    "info",
    2000
  );
}

function setUpdateMirror(mirror: UpdateMirror) {
  updateMirror.value = mirror;
  try {
    localStorage.setItem("avault_update_mirror", mirror);
  } catch (e) {}
}
const isCheckingUpdate = ref(false);
const updateResult = ref<UpdateInfo | null>(null);
const updateError = ref("");

const currentInstallTypeName = computed(() => {
  if (isMobilePlatform.value || updateResult.value?.current_install_type === "android") {
    return "Android 手机版";
  }
  if (updateResult.value?.current_install_type === "portable") {
    return "Windows 绿色便携版";
  }
  return "Windows 安装版";
});

interface ParsedChangelogItem {
  type: string;
  typeLabel: string;
  typeColor: string;
  scope?: string;
  scopeLabel?: string;
  text: string;
}

interface ParsedReleaseNotes {
  title: string;
  items: ParsedChangelogItem[];
  rawText?: string;
}

const parsedReleaseNotes = computed<ParsedReleaseNotes | null>(() => {
  const raw = updateResult.value?.release_notes?.trim();
  if (!raw) return null;

  const lines = raw.split(/\r?\n/);
  let title = "🚀 本次更新内容";
  const items: ParsedChangelogItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(/^#{1,6}\s*(.*)$/);
    if (headerMatch) {
      const headerText = headerMatch[1].trim();
      if (headerText) title = headerText;
      continue;
    }

    const content = trimmed.replace(/^[\*\-\•\+]\s+/, "").trim();
    if (!content) continue;

    const commitMatch = content.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?\s*[:：]\s*(.*)$/);

    if (commitMatch) {
      const rawType = commitMatch[1].toLowerCase();
      const rawScope = commitMatch[2]?.trim() || "";
      const message = commitMatch[3].trim();

      let typeLabel = "优化";
      let typeColor = "bg-blue-50 text-blue-700 border-blue-200";

      if (rawType === "feat") {
        typeLabel = "新增";
        typeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
      } else if (rawType === "fix") {
        typeLabel = "修复";
        typeColor = "bg-amber-50 text-amber-700 border-amber-200";
      } else if (rawType === "perf") {
        typeLabel = "性能";
        typeColor = "bg-teal-50 text-teal-700 border-teal-200";
      } else if (rawType === "refactor") {
        typeLabel = "重构";
        typeColor = "bg-purple-50 text-purple-700 border-purple-200";
      }

      items.push({
        type: rawType,
        typeLabel,
        typeColor,
        scope: rawScope,
        scopeLabel: rawScope || undefined,
        text: message || content
      });
    } else {
      items.push({
        type: "other",
        typeLabel: "详情",
        typeColor: "bg-slate-50 text-slate-600 border-slate-200",
        text: content
      });
    }
  }

  if (items.length === 0) {
    return { title, items: [], rawText: raw };
  }

  return { title, items };
});
const isDownloadingUpdate = ref(false);
const downloadProgress = ref(0);
const downloadStatusText = ref("");
let unlistenUpdateProgress: UnlistenFn | null = null;
let unlistenRecordsUpdated: UnlistenFn | null = null;

const androidAutofillEnabled = ref(false);
const browserBridgeStatus = ref<{ enabled: boolean; port: number; token: string; running: boolean }>({
  enabled: true,
  port: 47291,
  token: "",
  running: false,
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
      enabled: !browserBridgeStatus.value.enabled,
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

async function checkForUpdates(silent = false) {
  if (isCheckingUpdate.value) return;
  isCheckingUpdate.value = true;
  if (!silent) {
    updateError.value = "";
    updateResult.value = null;
  }
  try {
    const mirrorParam =
      updateMirror.value === "gh-proxy"
        ? "https://gh-proxy.com"
        : updateMirror.value === "ghproxy"
        ? "https://ghproxy.net"
        : "official";

    const res = await invoke<UpdateInfo>("check_github_update", {
      repo: customRepo.value.trim() || undefined,
      mirror: mirrorParam
    });
    updateResult.value = res;
    if (res.has_update) {
      notify(`✨ 发现新版本 ${res.latest_version}！可在「设置 -> 检查更新」中一键升级`, "info", 5500);
    } else if (!silent) {
      notify(`当前已是最新版本 (${res.current_version})`, "success", 3000);
    }
  } catch (err: any) {
    if (!silent) {
      updateError.value = typeof err === "string" ? err : (err?.message || "检查更新失败");
      notify("检查更新失败: " + updateError.value, "error");
    }
  } finally {
    isCheckingUpdate.value = false;
  }
}

async function openExternalUrl(url?: string | null) {
  if (!url) return;
  try {
    await openUrl(url);
    return;
  } catch (e1) {
    try {
      await invoke("open_external_url", { url });
      return;
    } catch (e2) {
      window.open(url, "_blank");
    }
  }
}

async function startAutoUpdate(targetUrl?: string) {
  const url =
    targetUrl ||
    updateResult.value?.download_url ||
    (isMobilePlatform.value ? updateResult.value?.apk_url : updateResult.value?.setup_url);
  if (!url) {
    notify("未找到有效下载地址，请尝试浏览器备用下载", "error");
    return;
  }

  isDownloadingUpdate.value = true;
  downloadProgress.value = 0;
  downloadStatusText.value = "正在连接下载服务器...";

  try {
    await invoke("start_auto_update", { url });
  } catch (err: any) {
    isDownloadingUpdate.value = false;
    const msg = typeof err === "string" ? err : (err?.message || "自动更新失败");
    notify("自动更新异常: " + msg, "error", 6000);
    downloadStatusText.value = "更新异常: " + msg;
  }
}

async function handleTestWebDav() {
  if (!webdavForm.value.url.trim()) return;
  await handleSaveWebDavConfig(false);
  isWebDavSyncing.value = true;
  webdavStatus.value = "正在连接 WebDAV 服务器...";
  try {
    const msg = await invoke<string>("test_webdav_connection", { config: webdavForm.value });
    webdavStatus.value = "✅ " + msg;
  } catch (err: any) {
    webdavStatus.value = "❌ " + err;
  } finally {
    isWebDavSyncing.value = false;
  }
}

async function handleUploadWebDav() {
  isWebDavSyncing.value = true;
  webdavStatus.value = "正在上传加密保险库至云端...";
  try {
    await handleSaveWebDavConfig(false);
    await invoke("upload_webdav_vault", { config: webdavForm.value });
    webdavStatus.value = "✅ 本地保险库已成功同步上传至云端（端到端强加密密文）！";
  } catch (err: any) {
    webdavStatus.value = "❌ 上传失败: " + err;
  } finally {
    isWebDavSyncing.value = false;
  }
}

async function handleDownloadWebDav() {
  const confirmed = await askConfirm({
    title: "云端恢复确认",
    message: "从云端下载将覆盖本地现有保险库（系统会自动先为当前本地数据创建安全快照备份）。确定继续吗？",
    type: "warning",
    confirmText: "确认恢复覆盖",
    cancelText: "取消"
  });
  if (!confirmed) return;
  isWebDavSyncing.value = true;
  webdavStatus.value = "正在下载并解密验证云端保险库...";
  try {
    await handleSaveWebDavConfig(false);
    const remote = await invoke<AccountRecord[]>("download_webdav_vault", { config: webdavForm.value });
    records.value = remote;
    if (autoSelectFirst.value && remote.length > 0) selectedId.value = remote[0].id; else selectedId.value = null;
    updateAllTotp();
    webdavStatus.value = `✅ 云端恢复成功！共同步载入 ${remote.length} 个账号。`;
    notify(`云端恢复成功！已同步载入 ${remote.length} 个账号`, "success");
  } catch (err: any) {
    webdavStatus.value = "❌ 恢复失败: " + err;
    notify("云端恢复失败: " + err, "error");
  } finally {
    isWebDavSyncing.value = false;
  }
}

// ==================== BACKUPS & EXPORT ====================
const backupTab = ref<"backups" | "export">("backups");
const backupList = ref<Array<{ filename: string; timestamp: string; size_bytes: number }>>([]);
const isLoadingBackups = ref(false);

async function loadBackupsList() {
  isLoadingBackups.value = true;
  try {
    backupList.value = await invoke("list_vault_backups");
  } catch (e) {
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
    if (autoSelectFirst.value && restored.length > 0) selectedId.value = restored[0].id; else selectedId.value = null;
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
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    link.download = `AccountVault_${dateStr}.avault`;
    link.click();
    URL.revokeObjectURL(url);
    notify("🛡️ 密文保险库文件 (.avault) 已成功导出并保存", "success", 3000);
  } catch (err: any) {
    notify("导出密文保险库失败: " + err, "error");
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

// ==================== PASSWORD GENERATOR ====================
const showPasswordGenModal = ref(false);
const pwdGenForm = ref({
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  exclude_ambiguous: false
});
const generatedPassword = ref("");

async function generateNewPassword() {
  try {
    generatedPassword.value = await invoke<string>("generate_custom_pwd", {
      options: pwdGenForm.value
    });
  } catch (err: any) {
    notify("生成密码失败: " + err, "error");
  }
}

function openPasswordGenModal() {
  showPasswordGenModal.value = true;
  generateNewPassword();
}

function applyPwdPreset(preset: "strong" | "alphanumeric" | "pin" | "max") {
  if (preset === "strong") {
    pwdGenForm.value = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, exclude_ambiguous: false };
  } else if (preset === "alphanumeric") {
    pwdGenForm.value = { length: 18, uppercase: true, lowercase: true, numbers: true, symbols: false, exclude_ambiguous: false };
  } else if (preset === "pin") {
    pwdGenForm.value = { length: 6, uppercase: false, lowercase: false, numbers: true, symbols: false, exclude_ambiguous: false };
  } else if (preset === "max") {
    pwdGenForm.value = { length: 32, uppercase: true, lowercase: true, numbers: true, symbols: true, exclude_ambiguous: true };
  }
  generateNewPassword();
}

function copyGeneratedPassword() {
  if (!generatedPassword.value) return;
  navigator.clipboard.writeText(generatedPassword.value);
  scheduleClipboardClear();
  const suffix = clipboardClearSeconds.value > 0 ? ` (${clipboardClearSeconds.value}s 后自动清理)` : "";
  notify("已成功复制新密码到剪贴板！" + suffix, "success");
}

function applyPasswordToCurrentRecord() {
  if (!selectedRecord.value || !generatedPassword.value) return;
  selectedRecord.value.password = generatedPassword.value;
  invoke("save_record", { record: selectedRecord.value });
  showPasswordGenModal.value = false;
  notify(`已将生成的新密码更新至账号 [${getDisplayTitle(selectedRecord.value)}]`, "success", 3000);
  triggerDebouncedSync();
}

const passwordStrength = computed(() => {
  const p = generatedPassword.value;
  if (!p) return { score: 0, text: "无", color: "bg-gray-300", textCol: "text-gray-500", percent: "0%" };
  let score = 0;
  if (p.length >= 8) score += 1;
  if (p.length >= 16) score += 1;
  if (p.length >= 24) score += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
  if (/\d/.test(p)) score += 1;
  if (/[!@#$%&*+\-=?_]/.test(p)) score += 1;

  if (score <= 2) return { score: 1, text: "较弱", color: "bg-red-500", textCol: "text-red-600", percent: "25%" };
  if (score <= 4) return { score: 2, text: "中等", color: "bg-amber-500", textCol: "text-amber-600", percent: "50%" };
  if (score <= 5) return { score: 3, text: "高强度", color: "bg-blue-500", textCol: "text-blue-600", percent: "75%" };
  return { score: 4, text: "极强 (军工级强随机)", color: "bg-emerald-500", textCol: "text-emerald-600", percent: "100%" };
});

// Hardware & Gesture Back Navigation
let lastBackPressTime = 0;
let backButtonListener: { unregister: () => Promise<void> } | null = null;

function handleBackAction(): boolean {
  if (confirmState.value.visible) {
    confirmState.value.resolve(false);
    return true;
  }
  if (showChangePwdModal.value) {
    showChangePwdModal.value = false;
    return true;
  }
  if (showTotpQrModal.value) {
    showTotpQrModal.value = false;
    return true;
  }
  if (showBatchActionModal.value) {
    showBatchActionModal.value = false;
    return true;
  }
  if (showSettingsModal.value) {
    showSettingsModal.value = false;
    return true;
  }
  if (showPasswordGenModal.value) {
    showPasswordGenModal.value = false;
    return true;
  }
  if (showBatchImportModal.value) {
    showBatchImportModal.value = false;
    return true;
  }
  if (showCustomUrlModal.value) {
    showCustomUrlModal.value = false;
    return true;
  }
  if (showBackupCodesModal.value) {
    if (isEditingBackupCodesRaw.value) {
      isEditingBackupCodesRaw.value = false;
    } else {
      showBackupCodesModal.value = false;
    }
    return true;
  }
  if (isEditing.value) {
    isEditing.value = false;
    return true;
  }
  if (isBatchSelectMode.value) {
    isBatchSelectMode.value = false;
    selectedBatchIds.value = [];
    return true;
  }
  if (showMobileMoreMenu.value) {
    showMobileMoreMenu.value = false;
    return true;
  }
  if (showMobileSearch.value || searchQuery.value) {
    showMobileSearch.value = false;
    searchQuery.value = "";
    return true;
  }
  if (mobileView.value === "detail") {
    mobileView.value = "list";
    selectedId.value = null;
    return true;
  }
  if (selectedId.value !== null) {
    selectedId.value = null;
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
          } catch (e) {}
        } else {
          lastBackPressTime = now;
          notify("再按一次退出应用", "info", 2000);
        }
      }
    });
  } catch (err) {}
}

function handleWindowFocus() {
  if (isUnlocked.value && webdavForm.value.auto_sync) {
    triggerSmartSync(true);
  }
}

let syncIntervalTimer: any = null;

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
      const idleMs = Date.now() - lastActivityTime;
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
  if (debouncedSyncTimer) clearTimeout(debouncedSyncTimer);
  if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("resize", updateWindowWidth);
    window.removeEventListener("focus", handleWindowFocus);
    window.removeEventListener("mousemove", recordUserActivity);
    window.removeEventListener("mousedown", recordUserActivity);
    window.removeEventListener("keydown", recordUserActivity);
    window.removeEventListener("touchstart", recordUserActivity);
  }
  if (backButtonListener) {
    backButtonListener.unregister().catch(() => {});
  }
  if (unlistenUpdateProgress) {
    unlistenUpdateProgress();
  }
  if (unlistenRecordsUpdated) {
    unlistenRecordsUpdated();
  }
});
</script>

<template>
  <div class="h-screen w-screen flex flex-col bg-[#f8fafd] select-none text-[#1f1f1f] font-sans antialiased overflow-hidden pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
    
    <!-- 1. LOCK / UNLOCK SCREEN -->
    <div v-if="!isUnlocked" class="flex-1 flex items-center justify-center p-6 relative">
      <div class="w-full max-w-md bg-white rounded-3xl p-8 shadow-sm border border-[#dadce0]/70 flex flex-col items-center">
        <div class="w-16 h-16 rounded-2xl bg-white shadow-sm border border-[#dadce0]/70 flex items-center justify-center mb-5 p-1.5 overflow-hidden">
          <img src="/logo.png" alt="账号管家 Logo" class="w-full h-full object-contain" />
        </div>
        <h1 class="text-2xl font-bold tracking-tight text-[#202124] mb-1">账号管家</h1>
        <p class="text-xs text-[#5f6368] mb-6">Account Vault · 通用多平台加密安全库</p>

        <form @submit.prevent="handleAuth" class="w-full flex flex-col gap-4">
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] uppercase tracking-wider mb-2">
              {{ vaultExists ? "输入主密码解锁" : "设置主密码初始化安全库" }}
            </label>
            <div class="relative">
              <input
                type="password"
                v-model="masterPassword"
                autofocus
                placeholder="请输入主解锁密码..."
                class="w-full px-4 py-3 bg-[#f1f3f4] hover:bg-[#e8eaed] focus:bg-white rounded-xl border-2 border-transparent focus:border-[#1a73e8] outline-none text-[#202124] transition-all text-sm"
              />
            </div>
          </div>

          <div v-if="unlockError" class="p-3 bg-red-50 text-red-600 rounded-xl text-xs flex items-center gap-2 border border-red-200">
            <AlertCircle class="w-4 h-4 flex-shrink-0" />
            <span>{{ unlockError }}</span>
          </div>

          <button
            type="submit"
            :disabled="isSubmitting"
            class="w-full mt-2 py-3.5 bg-[#1a73e8] hover:bg-[#1557b0] active:bg-[#174ea6] text-white font-medium rounded-xl shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
          >
            <Unlock class="w-4 h-4" />
            <span>{{ isSubmitting ? "正在验证..." : (vaultExists ? "解锁保险库" : "创建并开启保险库") }}</span>
          </button>
        </form>

        <!-- Fast Biometric / Windows Hello Fast Unlock Button -->
        <div v-if="helloStatus.enrolled && vaultExists" class="w-full flex flex-col items-center mt-3">
          <div class="w-full flex items-center my-2 text-xs text-[#80868b]">
            <div class="flex-1 border-t border-[#dadce0]"></div>
            <span class="px-3">或</span>
            <div class="flex-1 border-t border-[#dadce0]"></div>
          </div>

          <button
            type="button"
            @click="handleHelloUnlock"
            :disabled="isHelloVerifying || isSubmitting"
            class="w-full py-3 bg-[#e8f0fe] hover:bg-[#d2e3fc] active:bg-[#c2dcff] text-[#1a73e8] font-medium rounded-xl transition-all flex items-center justify-center gap-2.5 text-sm border border-[#1a73e8]/30 shadow-sm cursor-pointer"
          >
            <Fingerprint class="w-5 h-5 text-[#1a73e8]" />
            <span>{{ isHelloVerifying ? (isMobilePlatform ? "请在手机弹窗中完成验证..." : "请在 Windows 弹窗中完成验证...") : (isMobilePlatform ? "快速解锁" : "使用 Windows Hello / PIN 快速解锁") }}</span>
          </button>
        </div>

        <div v-else-if="helloStatus.available && vaultExists" class="w-full mt-4 px-3.5 py-2.5 bg-[#f8fafd] border border-[#dadce0] rounded-xl text-xs text-[#5f6368] flex items-center gap-2">
          <Fingerprint class="w-4 h-4 text-[#1a73e8] flex-shrink-0" />
          <span>{{ isMobilePlatform ? "手机支持生物识别与锁屏密码，首次主密码解锁后可在设置中一键绑定快速登录。" : "本机支持 Windows Hello，首次主密码解锁后可在设置中一键绑定指纹/PIN快速登录。" }}</span>
        </div>
      </div>
    </div>

    <!-- 2. MAIN APPLICATION WORKSPACE -->
    <template v-else>
      <!-- 2.1 DESKTOP HEADER (md and above) -->
      <header class="hidden md:flex h-14 bg-white border-b border-[#dadce0] px-4 items-center justify-between gap-4 flex-shrink-0 z-10">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-white border border-[#dadce0]/60 flex items-center justify-center p-0.5 overflow-hidden shadow-xs">
            <img src="/logo.png" alt="Logo" class="w-full h-full object-contain" />
          </div>
          <div class="flex items-baseline gap-2">
            <span class="font-bold text-base text-[#202124] tracking-tight">账号管家</span>
            <span class="text-[11px] font-semibold uppercase px-2 py-0.5 bg-[#e8f0fe] text-[#1a73e8] rounded-full">v{{ appVersion }}</span>
            <button
              v-if="updateResult?.has_update"
              @click="openSettingsModal('updates')"
              class="text-[11px] font-semibold px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-full flex items-center gap-1 transition-colors cursor-pointer"
              title="点击前往检查更新并一键升级"
            >
              <Sparkles class="w-3 h-3 text-emerald-600" />
              <span>新版本 {{ updateResult.latest_version }}</span>
            </button>
          </div>
        </div>

        <!-- Search Bar -->
        <div class="flex-1 max-w-md relative">
          <Search class="w-4 h-4 text-[#5f6368] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            v-model="searchQuery"
            placeholder="搜索平台、账号、邮箱、分组或备注..."
            class="w-full pl-9 pr-8 py-1.5 bg-[#f1f3f4] hover:bg-[#e8eaed] focus:bg-white rounded-full border border-transparent focus:border-[#1a73e8] outline-none text-xs text-[#202124] transition-all"
          />
          <button
            v-if="searchQuery"
            @click="searchQuery = ''"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-[#5f6368] hover:text-[#202124] cursor-pointer"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Right Toolbar Actions -->
        <div class="flex items-center gap-2">
          <button
            @click="openAddModal"
            class="h-9 px-3.5 bg-[#1a73e8] hover:bg-[#1557b0] active:bg-[#174ea6] text-white rounded-full text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
          >
            <Plus class="w-4 h-4" />
            <span>添加账号</span>
          </button>

          <button
            @click="openPasswordGenModal"
            class="h-9 px-3 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
            title="强随机密码生成器"
          >
            <KeyRound class="w-3.5 h-3.5 text-[#1a73e8]" />
            <span>密码生成器</span>
          </button>

          <button
            @click="openBatchImportModal"
            class="h-9 px-3 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
            title="批量导入多条账号"
          >
            <Upload class="w-3.5 h-3.5 text-[#1a73e8]" />
            <span>批量导入</span>
          </button>

          <button
            @click="triggerSmartSync(false)"
            :disabled="syncState === 'syncing'"
            class="h-9 px-3 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-full text-xs font-medium flex items-center gap-1.5 transition-all relative cursor-pointer disabled:opacity-75"
            :title="`WebDAV 增量智能同步: ${syncTooltip} (点击立即执行同步)`"
          >
            <RefreshCw v-if="syncState === 'syncing'" class="w-3.5 h-3.5 text-[#1a73e8] animate-spin" />
            <Cloud
              v-else
              :class="[
                'w-3.5 h-3.5',
                syncState === 'error' ? 'text-rose-500' :
                syncState === 'success' ? 'text-emerald-500' :
                webdavForm.url ? 'text-[#1a73e8]' : 'text-[#80868b]'
              ]"
            />
            <span>{{ syncState === 'syncing' ? '同步中' : syncState === 'error' ? '同步失败' : '云同步' }}</span>
            <span
              v-if="webdavForm.url && webdavForm.auto_sync"
              :class="[
                'w-1.5 h-1.5 rounded-full absolute top-2 right-2',
                syncState === 'syncing' ? 'bg-[#1a73e8] animate-ping' :
                syncState === 'error' ? 'bg-rose-500' :
                'bg-emerald-500'
              ]"
            ></span>
          </button>

          <button
            @click="openSettingsModal('security')"
            class="h-9 px-3.5 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-full text-xs font-medium flex items-center gap-1.5 transition-all relative cursor-pointer"
            title="设置与偏好"
          >
            <Settings class="w-3.5 h-3.5 text-[#1a73e8]" />
            <span>设置</span>
            <span v-if="helloStatus.enrolled" class="w-1.5 h-1.5 rounded-full bg-emerald-500 absolute top-2 right-2"></span>
          </button>

          <button
            @click="lockVault"
            class="h-9 px-3 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
            title="锁定保险库"
          >
            <Lock class="w-3.5 h-3.5" />
            <span>锁定</span>
          </button>
        </div>
      </header>

      <!-- 2.2 MOBILE HEADER (< md) -->
      <header class="md:hidden bg-white border-b border-[#dadce0] flex flex-col flex-shrink-0 z-20">
        <div class="h-13 px-3.5 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
            <div class="w-7 h-7 rounded-lg bg-white border border-[#dadce0]/60 flex items-center justify-center p-0.5 overflow-hidden shadow-2xs flex-shrink-0">
              <img src="/logo.png" alt="Logo" class="w-full h-full object-contain" />
            </div>
            <span class="font-bold text-sm text-[#202124] tracking-tight truncate">账号管家</span>
          </div>

          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              @click="showMobileSearch = !showMobileSearch"
              class="w-8 h-8 rounded-full flex items-center justify-center text-[#5f6368] hover:bg-[#f1f3f4] transition-colors cursor-pointer"
              :class="{ 'bg-[#e8f0fe] text-[#1a73e8]': showMobileSearch || searchQuery }"
              title="搜索"
            >
              <Search class="w-4 h-4" />
            </button>

            <button
              @click="triggerSmartSync(false)"
              :disabled="syncState === 'syncing'"
              class="w-8 h-8 rounded-full flex items-center justify-center text-[#5f6368] hover:bg-[#f1f3f4] transition-colors relative cursor-pointer disabled:opacity-75"
            >
              <RefreshCw v-if="syncState === 'syncing'" class="w-4 h-4 text-[#1a73e8] animate-spin" />
              <Cloud
                v-else
                :class="[
                  'w-4 h-4',
                  syncState === 'error' ? 'text-rose-500' :
                  syncState === 'success' ? 'text-emerald-500' :
                  webdavForm.url ? 'text-[#1a73e8]' : 'text-[#80868b]'
                ]"
              />
            </button>

            <div class="relative">
              <button
                @click="showMobileMoreMenu = !showMobileMoreMenu"
                class="w-8 h-8 rounded-full flex items-center justify-center text-[#5f6368] hover:bg-[#f1f3f4] transition-colors cursor-pointer"
              >
                <MoreVertical class="w-4 h-4" />
              </button>

              <div
                v-if="showMobileMoreMenu"
                class="absolute right-0 top-10 w-46 bg-white rounded-2xl shadow-xl border border-[#dadce0] p-1.5 z-50 text-xs font-medium space-y-0.5"
              >
                <button
                  @click="showMobileMoreMenu = false; openAddModal()"
                  class="w-full px-3 py-2 text-left bg-[#e8f0fe]/70 hover:bg-[#e8f0fe] text-[#1a73e8] font-semibold rounded-xl flex items-center gap-2 cursor-pointer"
                >
                  <Plus class="w-3.5 h-3.5 text-[#1a73e8]" />
                  <span>添加新账号</span>
                </button>
                <button
                  @click="showMobileMoreMenu = false; openBatchImportModal()"
                  class="w-full px-3 py-2 text-left hover:bg-[#f1f3f4] rounded-xl flex items-center gap-2 text-[#3c4043] cursor-pointer"
                >
                  <Upload class="w-3.5 h-3.5 text-[#1a73e8]" />
                  <span>批量导入</span>
                </button>
                <button
                  @click="showMobileMoreMenu = false; openPasswordGenModal()"
                  class="w-full px-3 py-2 text-left hover:bg-[#f1f3f4] rounded-xl flex items-center gap-2 text-[#3c4043] cursor-pointer"
                >
                  <KeyRound class="w-3.5 h-3.5 text-[#1a73e8]" />
                  <span>密码生成器</span>
                </button>
                <button
                  @click="showMobileMoreMenu = false; openSettingsModal('security')"
                  class="w-full px-3 py-2 text-left hover:bg-[#f1f3f4] rounded-xl flex items-center justify-between text-[#3c4043] cursor-pointer"
                >
                  <div class="flex items-center gap-2">
                    <Settings class="w-3.5 h-3.5 text-[#1a73e8]" />
                    <span>设置与偏好</span>
                  </div>
                </button>
                <div class="border-t border-[#f1f3f4] my-1"></div>
                <button
                  @click="showMobileMoreMenu = false; lockVault()"
                  class="w-full px-3 py-2 text-left hover:bg-rose-50 text-rose-600 rounded-xl flex items-center gap-2 cursor-pointer"
                >
                  <Lock class="w-3.5 h-3.5" />
                  <span>锁定保险库</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showMobileSearch || searchQuery" class="px-3 pb-2 pt-0 flex items-center gap-2">
          <div class="flex-1 relative">
            <Search class="w-3.5 h-3.5 text-[#5f6368] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              v-model="searchQuery"
              placeholder="搜索平台、账号、分组或备注..."
              class="w-full pl-8 pr-7 py-1.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] outline-none text-xs text-[#202124]"
            />
            <button v-if="searchQuery" @click="searchQuery = ''" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#5f6368] cursor-pointer">
              <X class="w-3 h-3" />
            </button>
          </div>
        </div>

        <div class="flex items-center gap-1.5 px-3 py-1.5 bg-[#f8fafd] border-t border-[#dadce0]/60 overflow-x-auto no-scrollbar flex-shrink-0">
          <button
            v-for="g in groups"
            :key="g.label"
            @click="currentGroup = g.key; mobileView = 'list'"
            :class="[
              'px-2.5 py-1 rounded-full text-xs whitespace-nowrap flex items-center gap-1 transition-all flex-shrink-0 font-medium cursor-pointer',
              currentGroup === g.key
                ? 'bg-[#1a73e8] text-white font-semibold shadow-2xs'
                : 'bg-white text-[#5f6368] border border-[#dadce0] hover:bg-[#f1f3f4]'
            ]"
          >
            <span>{{ g.label }}</span>
            <span class="text-[10px] opacity-80 font-mono">({{ g.count }})</span>
          </button>
        </div>
      </header>

      <!-- THREE-COLUMN MAIN BODY -->
      <div class="flex-1 flex overflow-hidden relative">
        
        <!-- COLUMN 1: SIDEBAR (Desktop only) -->
        <aside class="hidden md:flex w-56 bg-white border-r border-[#dadce0] flex-col flex-shrink-0">
          <div class="px-4 py-3 border-b border-[#f1f3f4]">
            <h2 class="text-[11px] font-bold text-[#5f6368] uppercase tracking-wider">账号分组</h2>
          </div>

          <div class="flex-1 overflow-y-auto p-2 space-y-0.5">
            <button
              v-for="g in groups"
              :key="g.label"
              @click="currentGroup = g.key"
              :class="[
                'w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer',
                currentGroup === g.key
                  ? 'bg-[#e8f0fe] text-[#1a73e8] font-semibold'
                  : 'text-[#444746] hover:bg-[#f1f3f4]'
              ]"
            >
              <div class="flex items-center gap-2 truncate">
                <Folder class="w-3.5 h-3.5 flex-shrink-0 text-[#5f6368]" />
                <span class="truncate">{{ g.label }}</span>
              </div>
              <span class="text-[11px] text-[#5f6368] bg-black/5 px-2 py-0.5 rounded-full font-mono">{{ g.count }}</span>
            </button>
          </div>
        </aside>

        <!-- COLUMN 2: MIDDLE ACCOUNT LIST -->
        <main
          class="bg-white border-r border-[#dadce0] flex flex-col overflow-hidden"
          :class="[
            mobileView === 'detail' ? 'hidden md:flex' : 'flex flex-1 w-full',
            'md:flex md:flex-1'
          ]"
        >
          <div class="px-3.5 py-1.5 bg-[#f8fafd] border-b border-[#dadce0] flex items-center justify-between text-xs text-[#5f6368] gap-2">
            <div class="flex items-center gap-2 min-w-0 overflow-hidden">
              <button
                v-if="isBatchSelectMode"
                type="button"
                @click="toggleSelectAllFiltered"
                class="px-2 py-0.5 bg-white hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#1a73e8]/40 rounded-md text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors flex-shrink-0"
              >
                <CheckSquare v-if="isAllFilteredSelected" class="w-3 h-3" />
                <Square v-else class="w-3 h-3" />
                <span>{{ isAllFilteredSelected ? '取消全选' : '全选' }}</span>
              </button>
              <span class="truncate">
                {{
                  isBatchSelectMode
                    ? `已选 ${selectedBatchIds.length}/${filteredRecords.length}`
                    : homeTab === 'totp'
                    ? `TOTP 验证器 · ${filteredRecords.length} 项`
                    : homeTab === 'passkeys'
                    ? `PassKey 通行密钥 · ${filteredRecords.length} 项`
                    : `全部密码 · ${filteredRecords.length} 个账号`
                }}
              </span>
              <span v-if="!isBatchSelectMode" class="text-[11px] text-[#80868b] hidden lg:inline flex-shrink-0">· 双击编辑</span>
            </div>

            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                @click="showFilterPanel = !showFilterPanel"
                :class="[
                  'px-2 py-0.5 border rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-2xs',
                  showFilterPanel || activeFilterCount > 0
                    ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]/60 font-semibold'
                    : 'bg-white hover:bg-[#e8eaed] text-[#3c4043] border-[#dadce0]/80'
                ]"
              >
                <Filter class="w-3 h-3 text-[#1a73e8]" />
                <span>筛选</span>
                <span v-if="activeFilterCount > 0" class="px-1.2 py-0.2 bg-[#1a73e8] text-white rounded-full text-[9px] font-bold leading-none">
                  {{ activeFilterCount }}
                </span>
              </button>

              <button
                type="button"
                @click="toggleBatchSelectMode"
                :class="[
                  'px-2 py-0.5 border rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-2xs',
                  isBatchSelectMode
                    ? 'bg-[#1a73e8] text-white border-[#1a73e8]'
                    : 'bg-white hover:bg-[#e8eaed] text-[#3c4043] border-[#dadce0]/80'
                ]"
              >
                <CheckSquare class="w-3 h-3" :class="isBatchSelectMode ? 'text-white' : 'text-[#1a73e8]'" />
                <span>{{ isBatchSelectMode ? '退出批量' : '批量管理' }}</span>
              </button>

              <button
                type="button"
                @click="cycleSortRule"
                class="px-2 py-0.5 bg-white hover:bg-[#e8eaed] text-[#3c4043] border border-[#dadce0]/80 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
              >
                <ArrowUpDown class="w-3 h-3 text-[#1a73e8]" />
                <span>{{ sortRuleLabel }}</span>
              </button>
            </div>
          </div>

          <!-- Multi-Attribute Filter Collapsible Panel -->
          <div
            v-if="showFilterPanel"
            class="px-3.5 py-2.5 bg-[#f8fafd] border-b border-[#dadce0] space-y-2.5 text-[11px] select-none flex-shrink-0 max-h-[55vh] overflow-y-auto"
          >
            <div class="flex items-center justify-between">
              <div class="font-semibold text-[#202124] flex items-center gap-1.5">
                <Filter class="w-3.5 h-3.5 text-[#1a73e8]" />
                <span>多维属性组合筛选</span>
              </div>
              <div class="flex items-center gap-2">
                <button
                  v-if="activeFilterCount > 0"
                  type="button"
                  @click="resetAttrFilter"
                  class="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-md text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw class="w-2.5 h-2.5" />
                  <span>重置筛选</span>
                </button>
                <button type="button" @click="showFilterPanel = false" class="p-0.5 text-[#5f6368] hover:text-[#202124] rounded cursor-pointer">
                  <X class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-[#5f6368] w-16 flex-shrink-0">账号状态：</span>
              <button
                type="button"
                @click="attrFilter.statuses = []"
                :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.statuses.length === 0 ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
              >
                不限
              </button>
              <button
                v-for="st in accountStatusOptions"
                :key="st"
                type="button"
                @click="toggleAttrStatus(st)"
                :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.statuses.includes(st) ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8] font-semibold' : 'bg-white text-[#5f6368] border-[#dadce0]']"
              >
                {{ st }}
              </button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div class="flex flex-wrap items-center gap-1">
                <span class="text-[#5f6368] w-16 flex-shrink-0">2FA 密钥：</span>
                <button
                  v-for="opt in [{ k: 'all', l: '不限' }, { k: 'yes', l: '已绑 2FA' }, { k: 'no', l: '未绑 2FA' }]"
                  :key="opt.k"
                  type="button"
                  @click="attrFilter.totp = opt.k as any"
                  :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.totp === opt.k ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
                >
                  {{ opt.l }}
                </button>
              </div>

              <div class="flex flex-wrap items-center gap-1">
                <span class="text-[#5f6368] w-16 flex-shrink-0">备用恢复码：</span>
                <button
                  v-for="opt in [{ k: 'all', l: '不限' }, { k: 'yes', l: '有可用码' }, { k: 'no', l: '无/已耗尽' }]"
                  :key="opt.k"
                  type="button"
                  @click="attrFilter.backupCodes = opt.k as any"
                  :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.backupCodes === opt.k ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
                >
                  {{ opt.l }}
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div class="flex flex-wrap items-center gap-1">
                <span class="text-[#5f6368] w-16 flex-shrink-0">独立代理：</span>
                <button
                  v-for="opt in [{ k: 'all', l: '不限' }, { k: 'yes', l: '已配代理' }, { k: 'no', l: '直连(未配)' }]"
                  :key="opt.k"
                  type="button"
                  @click="attrFilter.proxy = opt.k as any"
                  :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.proxy === opt.k ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
                >
                  {{ opt.l }}
                </button>
              </div>

              <div class="flex flex-wrap items-center gap-1">
                <span class="text-[#5f6368] w-16 flex-shrink-0">到期状态：</span>
                <button
                  v-for="opt in [{ k: 'all', l: '不限' }, { k: 'expired', l: '已过期' }, { k: 'soon7', l: '7天内' }, { k: 'soon30', l: '30天内' }]"
                  :key="opt.k"
                  type="button"
                  @click="attrFilter.expire = opt.k as any"
                  :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.expire === opt.k ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
                >
                  {{ opt.l }}
                </button>
              </div>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto divide-y divide-[#f1f3f4] pb-24" @click.self="selectedId = null">
            <div
              v-for="r in filteredRecords"
              :key="r.id"
              @click="isBatchSelectMode ? toggleSelectBatchItem(r.id) : selectAccount(r.id)"
              @dblclick="openEditModal(r)"
              :class="[
                'px-3 py-2.5 md:px-4 md:py-3 flex items-center justify-between gap-2 cursor-pointer transition-colors',
                isBatchSelectMode && selectedBatchIds.includes(r.id)
                  ? 'bg-[#e8f0fe]/70'
                  : selectedId === r.id
                  ? 'bg-[#edf2fa]'
                  : r.is_pinned
                  ? 'bg-amber-50/25 hover:bg-amber-50/50'
                  : 'hover:bg-[#f8fafd]'
              ]"
            >
              <div class="flex items-center gap-2 md:gap-2.5 min-w-0 flex-1">
                <button
                  v-if="isBatchSelectMode"
                  type="button"
                  @click.stop="toggleSelectBatchItem(r.id)"
                  class="text-[#1a73e8] flex-shrink-0 cursor-pointer"
                >
                  <CheckSquare v-if="selectedBatchIds.includes(r.id)" class="w-4 h-4 text-[#1a73e8]" />
                  <Square v-else class="w-4 h-4 text-[#80868b]" />
                </button>

                <div
                  v-if="showListAvatar"
                  :class="[
                    'w-8 h-8 md:w-9 md:h-9 rounded-full font-bold text-xs md:text-sm flex items-center justify-center flex-shrink-0 relative',
                    getFaviconUrl(r) ? 'bg-white border border-[#dadce0]/80' : 'bg-[#e8f0fe] text-[#1a73e8]'
                  ]"
                >
                  <img
                    v-if="getFaviconUrl(r)"
                    :src="getFaviconUrl(r)!"
                    @error="handleFaviconError(r)"
                    alt=""
                    class="w-5 h-5 rounded-full object-contain"
                    loading="lazy"
                  />
                  <span v-else>{{ (getDisplayTitle(r)[0] || getPrimaryIdentifier(r)[0] || 'A').toUpperCase() }}</span>
                  <button
                    type="button"
                    @click.stop="togglePinRecord(r)"
                    :class="[
                      'w-4 h-4 rounded-full flex items-center justify-center absolute -bottom-0.5 -right-0.5 transition-all cursor-pointer shadow-2xs ring-1 ring-white',
                      r.is_pinned
                        ? 'bg-amber-50 text-amber-400 hover:scale-110'
                        : 'bg-white text-[#dadce0] hover:text-amber-400 hover:scale-110'
                    ]"
                    :title="r.is_pinned ? '取消星标置顶' : '设为星标置顶'"
                  >
                    <Star class="w-2.5 h-2.5" :class="r.is_pinned ? 'text-amber-400 fill-amber-400' : 'text-[#dadce0]'" />
                  </button>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="text-xs font-bold text-[#202124] flex items-center gap-1.5 min-w-0">
                    <button
                      v-if="!showListAvatar"
                      type="button"
                      @click.stop="togglePinRecord(r)"
                      class="p-0.5 -ml-0.5 rounded-full hover:bg-black/5 transition-colors flex-shrink-0 cursor-pointer"
                    >
                      <Star class="w-3.5 h-3.5" :class="r.is_pinned ? 'text-amber-400 fill-amber-400' : 'text-[#dadce0]'" />
                    </button>
                    <span class="truncate">{{ getDisplayTitle(r) }}</span>
                    <span :class="[getStatusBadgeClass(r.status), 'hidden md:inline-flex flex-shrink-0']">{{ r.status || '正常' }}</span>
                    <span v-if="r.plan" class="hidden md:inline-block px-1.5 py-0.2 bg-[#e8f0fe] text-[#1a73e8] rounded text-[10px] font-mono flex-shrink-0">{{ r.plan }}</span>
                    <span v-if="r.expire_at && getExpireBadge(r.expire_at)" :class="[getExpireBadge(r.expire_at)?.class, 'hidden md:inline-flex flex-shrink-0']">
                      {{ getExpireBadge(r.expire_at)?.label }}
                    </span>
                  </div>

                  <div class="text-[11px] text-[#5f6368] flex items-center gap-1.5 mt-0.5 min-w-0">
                    <span class="truncate font-medium text-[#3c4043]">{{ getPrimaryIdentifier(r) || r.email || '未填账号' }}</span>
                    <span v-if="r.group" class="px-1.5 py-0.2 bg-[#f1f3f4] text-[#444746] rounded text-[10px] flex-shrink-0">{{ r.group }}</span>
                    <span v-if="r.proxy" class="px-1.5 py-0.2 bg-purple-50 text-purple-700 border border-purple-200 rounded text-[10px] font-mono flex-shrink-0">独立IP</span>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 md:gap-3 flex-shrink-0">
                <!-- PassKey Tab trailing info -->
                <div v-if="homeTab === 'passkeys'" class="flex items-center gap-1.5">
                  <span class="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 text-[11px] font-semibold flex items-center gap-1">
                    <Fingerprint class="w-3.5 h-3.5" />
                    <span>{{ r.passkeys?.length || 0 }} 个通行密钥</span>
                  </span>
                </div>

                <!-- TOTP Tab trailing info -->
                <div v-else-if="homeTab === 'totp'" class="flex flex-col items-end">
                  <div class="flex items-center gap-1.5 font-mono text-base font-extrabold tracking-wider text-[#1a73e8]">
                    <span>{{ totpMap[r.id]?.code || "••••••" }}</span>
                    <button
                      @click.stop="copyText(totpMap[r.id]?.code || '', r.id + '-totp')"
                      class="p-1 rounded-lg hover:bg-[#e8f0fe] text-[#5f6368] hover:text-[#1a73e8] cursor-pointer"
                      title="复制动态验证码"
                    >
                      <Check v-if="copiedField === r.id + '-totp'" class="w-3.5 h-3.5 text-emerald-600" />
                      <Copy v-else class="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <span class="text-[10px] text-[#80868b] font-mono">{{ totpMap[r.id]?.remaining_seconds || 30 }}s 剩余</span>
                </div>

                <!-- Passwords Tab trailing info -->
                <template v-else>
                  <button
                    v-if="r.password"
                    type="button"
                    @click.stop="copyText(r.password || '', r.id + '-pwd-quick')"
                    class="px-2 py-1 rounded-lg bg-[#f1f3f4] hover:bg-[#e8f0fe] text-[#3c4043] hover:text-[#1a73e8] text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                    title="一键复制密码"
                  >
                    <Check v-if="copiedField === r.id + '-pwd-quick'" class="w-3 h-3 text-emerald-600" />
                    <KeyRound v-else class="w-3 h-3" />
                    <span class="hidden sm:inline">{{ copiedField === r.id + '-pwd-quick' ? '已复制' : '复制密码' }}</span>
                  </button>
                  <div v-if="r.totp" class="flex flex-col items-end">
                    <div class="flex items-center gap-1 font-mono text-xs font-bold text-[#1a73e8]">
                      <span>{{ totpMap[r.id]?.code || "••••••" }}</span>
                      <button
                        @click.stop="copyText(totpMap[r.id]?.code || '', r.id + '-totp')"
                        class="text-[#5f6368] hover:text-[#1a73e8] cursor-pointer"
                        title="复制动态验证码"
                      >
                        <Check v-if="copiedField === r.id + '-totp'" class="w-3 h-3 text-emerald-600" />
                        <Copy v-else class="w-3 h-3" />
                      </button>
                    </div>
                    <span class="text-[10px] text-[#80868b] font-mono">{{ totpMap[r.id]?.remaining_seconds || 30 }}s</span>
                  </div>
                  <span v-if="r.passkeys && r.passkeys.length > 0" class="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-semibold hidden sm:inline-flex items-center gap-0.5">
                    <Fingerprint class="w-3 h-3" />
                    <span>{{ r.passkeys.length }}</span>
                  </span>
                </template>
              </div>
            </div>

            <div v-if="filteredRecords.length === 0" class="p-8 text-center text-xs text-[#80868b] space-y-2">
              <div>
                {{
                  homeTab === 'totp'
                    ? '暂无已配置 TOTP 动态口令的账号'
                    : homeTab === 'passkeys'
                    ? '暂无已保存 PassKey 的账号（可在浏览器扩展创建通行密钥后自动同步）'
                    : '暂无匹配的账号记录'
                }}
              </div>
              <button
                v-if="activeFilterCount > 0 || searchQuery"
                type="button"
                @click="resetAttrFilter(); searchQuery = ''"
                class="px-3 py-1 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] rounded-lg text-[11px] font-medium cursor-pointer"
              >
                清除全部筛选与搜索条件
              </button>
            </div>
          </div>

          <!-- Batch Action Bottom Toolbar -->
          <div
            v-if="isBatchSelectMode"
            class="px-3 py-2 bg-[#edf2fa] border-t border-[#1a73e8]/30 flex flex-wrap items-center justify-between gap-2 flex-shrink-0"
          >
            <span class="text-xs font-semibold text-[#1a73e8]">已选 {{ selectedBatchIds.length }} 项</span>
            <div class="flex flex-wrap items-center gap-1.5">
              <button type="button" @click="executeBatchPin(true)" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-amber-50 text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                <Star class="w-3 h-3 text-amber-500 fill-amber-400" />
                <span>置顶</span>
              </button>
              <button type="button" @click="openBatchUpdateDialog('group')" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                <Folder class="w-3 h-3 text-[#1a73e8]" />
                <span>改分组</span>
              </button>
              <button type="button" @click="openBatchUpdateDialog('status')" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                <Edit3 class="w-3 h-3 text-[#1a73e8]" />
                <span>改状态</span>
              </button>
              <button type="button" @click="openBatchUpdateDialog('plan')" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                <Sparkles class="w-3 h-3 text-[#1a73e8]" />
                <span>改套餐</span>
              </button>
              <button type="button" @click="executeBatchExportSelected" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                <Download class="w-3 h-3 text-[#1a73e8]" />
                <span>导出选中</span>
              </button>
              <button type="button" @click="executeBatchDelete" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                <Trash2 class="w-3 h-3" />
                <span>批量删除</span>
              </button>
            </div>
          </div>
        </main>

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

        <!-- COLUMN 3: RIGHT DETAIL CARD -->
        <aside
          class="bg-[#f8fafd] flex flex-col overflow-y-auto p-3 gap-2.5 border-l border-[#dadce0]/70 flex-shrink-0"
          :class="[
            mobileView === 'detail' ? 'flex flex-1 w-full' : 'hidden md:flex',
            'md:flex md:flex-none'
          ]"
          :style="isDesktopWindow && !isMobilePlatform ? { width: `${detailWidth}px` } : {}"
        >
          <template v-if="selectedRecord">
            <!-- Mobile Back Navigation Header -->
            <div class="md:hidden flex items-center justify-between pb-2 border-b border-[#dadce0]/70 flex-shrink-0">
              <button
                @click="mobileView = 'list'"
                class="px-3 py-1.5 bg-white text-[#1a73e8] border border-[#dadce0] rounded-xl text-xs font-semibold flex items-center gap-1 shadow-2xs cursor-pointer"
              >
                <ChevronLeft class="w-4 h-4" />
                <span>返回账号列表</span>
              </button>
              <div class="flex items-center gap-1.5">
                <button @click="openEditModal(selectedRecord)" class="px-2.5 py-1.5 bg-white text-[#5f6368] border border-[#dadce0] rounded-xl text-xs font-medium flex items-center gap-1 cursor-pointer">
                  <Edit3 class="w-3.5 h-3.5 text-[#1a73e8]" />
                  <span>编辑</span>
                </button>
                <button @click="handleDeleteRecord(selectedRecord.id)" class="px-2.5 py-1.5 bg-white text-rose-600 border border-[#dadce0] rounded-xl text-xs font-medium flex items-center gap-1 cursor-pointer">
                  <Trash2 class="w-3.5 h-3.5" />
                  <span>删除</span>
                </button>
              </div>
            </div>

            <!-- Account Header Card -->
            <div class="bg-white rounded-2xl p-3 border border-[#dadce0]/80 shadow-2xs">
              <div class="flex items-center gap-2.5 mb-2.5">
                <div
                  :class="[
                    'w-9 h-9 rounded-full font-bold text-base flex items-center justify-center flex-shrink-0',
                    getFaviconUrl(selectedRecord) ? 'bg-white border border-[#dadce0]/80' : 'bg-[#e8f0fe] text-[#1a73e8]'
                  ]"
                >
                  <img
                    v-if="getFaviconUrl(selectedRecord)"
                    :src="getFaviconUrl(selectedRecord)!"
                    @error="handleFaviconError(selectedRecord)"
                    alt=""
                    class="w-5 h-5 rounded-full object-contain"
                  />
                  <span v-else>{{ (getDisplayTitle(selectedRecord)[0] || getPrimaryIdentifier(selectedRecord)[0] || 'A').toUpperCase() }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-1.5">
                    <div class="text-[11px] font-semibold text-[#1a73e8] truncate">{{ getDisplayTitle(selectedRecord) }}</div>
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                      <button type="button" @click="togglePinRecord(selectedRecord)" class="p-0.5 rounded hover:bg-[#f1f3f4] cursor-pointer">
                        <Star class="w-3.5 h-3.5" :class="selectedRecord.is_pinned ? 'text-amber-400 fill-amber-400' : 'text-[#80868b]'" />
                      </button>
                      <span :class="getStatusBadgeClass(selectedRecord.status)">{{ selectedRecord.status || '正常' }}</span>
                      <button
                        @click="selectedId = null"
                        class="hidden md:flex p-0.5 hover:bg-[#f1f3f4] text-[#80868b] hover:text-[#202124] rounded-md cursor-pointer"
                        title="取消选中 (Esc)"
                      >
                        <X class="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div class="text-xs font-bold text-[#202124] truncate">{{ getPrimaryIdentifier(selectedRecord) || selectedRecord.email || '未填账号' }}</div>
                </div>
              </div>

              <!-- Quick Launch Buttons -->
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  @click="selectedRecord.login_url ? openInApp(selectedRecord.login_url) : openCustomUrlModal()"
                  :disabled="isOpeningBrowser"
                  class="h-7 px-1.5 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all disabled:opacity-50 cursor-pointer"
                  :title="selectedRecord.login_url ? `在独立会话窗口打开 ${selectedRecord.login_url}` : '输入或选择网站在独立会话中打开'"
                >
                  <ExternalLink class="w-3 h-3 text-[#1a73e8]" />
                  <span>打开网页</span>
                </button>
                <button
                  @click="toggleBrowserTakeover(selectedRecord)"
                  :class="[
                    'h-7 px-1.5 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer',
                    isTakeoverActive && takeoverTargetRecord?.id === selectedRecord.id
                      ? 'bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-xs animate-pulse'
                      : 'bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8]'
                  ]"
                >
                  <Zap class="w-3 h-3 flex-shrink-0" />
                  <span class="truncate">
                    {{ isTakeoverActive && takeoverTargetRecord?.id === selectedRecord.id ? `接管中 ${takeoverRemainingSec}s` : '接管登录' }}
                  </span>
                </button>
                <button
                  @click="openCustomUrlModal"
                  class="h-7 px-1.5 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer"
                >
                  <Compass class="w-3 h-3 text-[#1a73e8]" />
                  <span>更多网址</span>
                </button>

                <div
                  v-if="isTakeoverActive"
                  class="col-span-3 px-2.5 py-1.5 bg-[#e8f0fe]/90 border border-[#1a73e8]/30 rounded-xl flex items-center justify-between gap-2 text-[11px] text-[#174ea6]"
                >
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-2 h-2 rounded-full bg-[#1a73e8] animate-ping flex-shrink-0"></span>
                    <span class="truncate font-medium">正在接管外部跳转 ({{ takeoverRemainingSec }}s)</span>
                  </div>
                  <button type="button" @click="stopBrowserTakeover(true)" class="px-2 py-0.5 bg-white text-[#1a73e8] rounded-md font-semibold cursor-pointer border border-[#1a73e8]/20">
                    停止
                  </button>
                </div>
              </div>
            </div>

            <!-- Credentials & Structured Info -->
            <div class="bg-white rounded-2xl p-3 border border-[#dadce0]/80 shadow-2xs space-y-2.5">
              <!-- Username Row -->
              <div class="flex items-start justify-between gap-2.5 pb-2 border-b border-[#f1f3f4]">
                <div class="min-w-0 flex-1">
                  <div class="text-[10px] text-[#5f6368]">登录账号 / 用户名</div>
                  <div class="font-mono text-xs font-semibold text-[#202124] mt-0.5 select-all break-all">
                    {{ getPrimaryIdentifier(selectedRecord) || "未记录" }}
                  </div>
                </div>
                <button
                  @click="copyText(getPrimaryIdentifier(selectedRecord), 'username', '已复制登录账号')"
                  class="p-1.5 hover:bg-[#f1f3f4] rounded-lg text-[#5f6368] transition-colors cursor-pointer"
                  title="复制账号"
                >
                  <Check v-if="copiedField === 'username'" class="w-3.5 h-3.5 text-emerald-600" />
                  <Copy v-else class="w-3.5 h-3.5" />
                </button>
              </div>

              <!-- Password Row -->
              <div class="flex items-start justify-between gap-2.5 pb-2 border-b border-[#f1f3f4]">
                <div class="min-w-0 flex-1">
                  <div class="text-[10px] text-[#5f6368]">登录密码</div>
                  <div class="font-mono text-xs font-semibold text-[#202124] tracking-wide mt-0.5 select-all break-all leading-relaxed">
                    {{ showPassword ? (selectedRecord.password || "未记录") : "••••••••••••" }}
                  </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0 pt-0.5">
                  <button @click="showPassword = !showPassword" class="p-1.5 hover:bg-[#f1f3f4] rounded-lg text-[#5f6368] cursor-pointer" title="显示 / 隐藏">
                    <EyeOff v-if="showPassword" class="w-3.5 h-3.5" />
                    <Eye v-else class="w-3.5 h-3.5" />
                  </button>
                  <button @click="copyText(selectedRecord.password || '', 'pwd', '已复制密码')" class="p-1.5 hover:bg-[#f1f3f4] rounded-lg text-[#5f6368] cursor-pointer" title="复制密码">
                    <Check v-if="copiedField === 'pwd'" class="w-3.5 h-3.5 text-emerald-600" />
                    <Copy v-else class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <!-- Information Grid -->
              <div class="grid grid-cols-2 gap-y-1.5 text-xs">
                <div class="text-[#5f6368]">平台名称</div>
                <div class="text-[#202124] font-medium truncate">{{ selectedRecord.title || "—" }}</div>

                <div class="text-[#5f6368]">所属分组</div>
                <div class="text-[#202124] font-medium truncate">{{ selectedRecord.group || "未分组" }}</div>

                <div class="text-[#5f6368]">账号状态</div>
                <div><span :class="getStatusBadgeClass(selectedRecord.status)">{{ selectedRecord.status || '正常' }}</span></div>

                <template v-if="selectedRecord.email">
                  <div class="text-[#5f6368]">绑定邮箱</div>
                  <div class="text-[#1a73e8] font-medium truncate select-all" :title="selectedRecord.email">{{ selectedRecord.email }}</div>
                </template>

                <template v-if="selectedRecord.phone">
                  <div class="text-[#5f6368]">绑定手机</div>
                  <div class="text-[#202124] font-medium truncate select-all">{{ selectedRecord.phone }}</div>
                </template>

                <template v-if="selectedRecord.recovery_email">
                  <div class="text-[#5f6368]">恢复信息/密保</div>
                  <div class="text-[#202124] font-medium truncate select-all" :title="selectedRecord.recovery_email">{{ selectedRecord.recovery_email }}</div>
                </template>

                <template v-if="selectedRecord.plan">
                  <div class="text-[#5f6368]">会员/套餐</div>
                  <div class="text-[#202124] font-medium truncate">{{ selectedRecord.plan }}</div>
                </template>

                <template v-if="selectedRecord.expire_at">
                  <div class="text-[#5f6368]">到期时间</div>
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-mono text-[#202124]">{{ selectedRecord.expire_at }}</span>
                    <span v-if="getExpireBadge(selectedRecord.expire_at)" :class="getExpireBadge(selectedRecord.expire_at)?.class">
                      {{ getExpireBadge(selectedRecord.expire_at)?.label }}
                    </span>
                  </div>
                </template>

                <template v-if="selectedRecord.proxy">
                  <div class="text-[#5f6368]">独立代理</div>
                  <div class="font-mono text-[11px] text-purple-700 truncate" :title="selectedRecord.proxy">{{ selectedRecord.proxy }}</div>
                </template>

                <template v-if="selectedRecord.login_url">
                  <div class="text-[#5f6368]">网站地址</div>
                  <button
                    type="button"
                    @click="openInApp(selectedRecord.login_url!)"
                    class="text-left text-[#1a73e8] hover:underline truncate font-mono text-[11px] cursor-pointer"
                    :title="selectedRecord.login_url"
                  >
                    {{ selectedRecord.login_url }}
                  </button>
                </template>
              </div>

              <div v-if="selectedRecord.notes" class="pt-2 border-t border-[#f1f3f4] text-xs text-[#5f6368]">
                <div class="font-medium text-[11px] mb-1">备注信息：</div>
                <div class="p-2 bg-[#f8fafd] rounded-xl text-[#202124] text-[11px] leading-relaxed whitespace-pre-wrap select-text">{{ selectedRecord.notes }}</div>
              </div>
            </div>

            <!-- TOTP Card -->
            <div class="bg-[#edf2fa] rounded-2xl p-3 border border-[#d3e3fd]/80">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-bold text-[#444746] flex items-center gap-1.5">
                  <Clock class="w-3.5 h-3.5 text-[#1a73e8]" />
                  2FA 动态安全码 (TOTP)
                </span>
                <span class="text-[11px] font-mono text-[#5f6368]">{{ totpMap[selectedRecord.id]?.remaining_seconds || 30 }}s 后刷新</span>
              </div>

              <div class="flex items-center justify-between my-1">
                <div class="font-mono text-2xl font-black tracking-widest text-[#1a73e8]">
                  {{ totpMap[selectedRecord.id]?.code || "未配置" }}
                </div>
                <div v-if="selectedRecord.totp" class="flex items-center gap-1.5">
                  <button
                    type="button"
                    @click="openTotpQrModal(selectedRecord)"
                    class="px-2 py-1 bg-white hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#1a73e8]/30 rounded-xl text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
                  >
                    <QrCode class="w-3.5 h-3.5" />
                    <span>二维码</span>
                  </button>
                  <button
                    type="button"
                    @click="copyText(totpMap[selectedRecord.id]?.code || '', 'totp_large')"
                    class="px-2.5 py-1 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
                  >
                    <Check v-if="copiedField === 'totp_large'" class="w-3.5 h-3.5" />
                    <Copy v-else class="w-3.5 h-3.5" />
                    <span>{{ copiedField === 'totp_large' ? '已复制' : '复制' }}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- PassKey Card -->
            <div v-if="selectedRecord.passkeys && selectedRecord.passkeys.length > 0" class="bg-indigo-50/70 rounded-2xl p-3 border border-indigo-200/80 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                  <Fingerprint class="w-3.5 h-3.5 text-indigo-600" />
                  PassKey 通行密钥
                </span>
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white text-indigo-700 border border-indigo-200">
                  {{ selectedRecord.passkeys.length }} 枚
                </span>
              </div>
              <div class="space-y-1.5">
                <div
                  v-for="pk in selectedRecord.passkeys"
                  :key="pk.credential_id"
                  class="px-2.5 py-2 bg-white rounded-xl border border-indigo-100 flex items-center justify-between gap-2 text-xs"
                >
                  <div class="min-w-0">
                    <div class="font-semibold text-[#202124] truncate">{{ pk.rp_name || pk.rp_id }}</div>
                    <div class="text-[11px] text-[#5f6368] truncate">{{ pk.user_name || pk.user_display_name || pk.rp_id }}</div>
                  </div>
                  <span class="text-[10px] font-mono text-[#80868b] flex-shrink-0">使用 {{ pk.sign_count || 0 }} 次</span>
                </div>
              </div>
            </div>

            <!-- BACKUP CODES CARD -->
            <div class="bg-white rounded-2xl p-3 border border-[#dadce0]/80 shadow-2xs space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-[#202124] flex items-center gap-1.5">
                  <KeyRound class="w-3.5 h-3.5 text-[#1a73e8]" />
                  备用恢复码 / 验证码
                </span>
                <span
                  v-if="parsedBackupCodesList.length > 0"
                  :class="[
                    'text-[10px] font-semibold px-2 py-0.5 rounded-full font-mono',
                    unusedBackupCodesCount > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                  ]"
                >
                  剩余 {{ unusedBackupCodesCount }} / {{ parsedBackupCodesList.length }}
                </span>
              </div>

              <div v-if="parsedBackupCodesList.length > 0" class="space-y-1.5">
                <button
                  @click="copyAndConsumeNextBackupCode"
                  :disabled="unusedBackupCodesCount === 0"
                  class="w-full py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Check v-if="copiedField === 'backup_code_consumed'" class="w-3.5 h-3.5" />
                  <Copy v-else class="w-3.5 h-3.5" />
                  <span>{{ copiedField === 'backup_code_consumed' ? '已复制并自动核销！' : '⚡ 复制下一个可用码并核销' }}</span>
                </button>
                <button @click="openBackupCodesModal" class="w-full py-1 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">
                  查看全部备用码与核销状态
                </button>
              </div>
              <div v-else class="text-center py-1.5">
                <p class="text-[11px] text-[#80868b] mb-1.5">尚未配置备用恢复码</p>
                <button @click="openBackupCodesModal" class="px-2.5 py-1 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] rounded-lg text-xs font-medium cursor-pointer">
                  + 批量粘贴备用码
                </button>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="space-y-1.5 pt-1">
              <button @click="openEditModal(selectedRecord)" class="w-full py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer">
                <Edit3 class="w-3.5 h-3.5" />
                <span>编辑该账号资料</span>
              </button>
              <button @click="handleDeleteRecord(selectedRecord.id)" class="w-full py-1.5 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                <Trash2 class="w-3 h-3" />
                <span>删除此本地记录</span>
              </button>
            </div>
          </template>

          <div v-else class="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#80868b] select-none">
            <div class="w-14 h-14 rounded-2xl bg-[#e8f0fe] flex items-center justify-center mb-3 text-[#1a73e8] shadow-2xs">
              <Shield class="w-7 h-7" />
            </div>
            <h4 class="text-sm font-bold text-[#202124] mb-1">隐私防窥模式已就绪</h4>
            <p class="text-xs text-[#5f6368] max-w-xs leading-relaxed mb-4">
              当前未选中任何账号，密码与 2FA 动态码处于防窥保护中。请在左侧列表中点击选择查看。
            </p>
            <div class="inline-flex items-center gap-1.5 text-[11px] text-[#5f6368] bg-white px-3 py-1.5 rounded-xl border border-[#dadce0]/80 shadow-2xs">
              <span>快捷提示:</span>
              <kbd class="px-1.5 py-0.5 bg-[#f1f3f4] text-[#3c4043] rounded border border-[#dadce0] text-[10px] font-mono font-medium">再次点击</kbd>
              <span>或</span>
              <kbd class="px-1.5 py-0.5 bg-[#f1f3f4] text-[#3c4043] rounded border border-[#dadce0] text-[10px] font-mono font-medium">Esc</kbd>
              <span>可随时取消选中</span>
            </div>
          </div>
        </aside>

      </div>

      <!-- FLOATING BOTTOM PILL TAB BAR (Windows & Android) -->
      <div
        v-if="mobileView !== 'detail'"
        class="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none"
      >
        <nav
          class="pointer-events-auto bg-white/92 backdrop-blur-xl border border-[#dadce0]/90 shadow-xl rounded-full p-1.5 flex items-center gap-1"
          aria-label="主导航"
        >
          <button
            type="button"
            @click="switchHomeTab('totp')"
            :class="[
              'h-9 px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap',
              homeTab === 'totp'
                ? 'bg-gradient-to-r from-[#1a73e8] to-[#4f46e5] text-white shadow-sm'
                : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'
            ]"
          >
            <Clock class="w-3.5 h-3.5" />
            <span>TOTP</span>
            <span
              :class="[
                'text-[10px] px-1.5 py-0.2 rounded-full font-mono',
                homeTab === 'totp' ? 'bg-white/20 text-white' : 'bg-[#f1f3f4] text-[#5f6368]'
              ]"
            >{{ homeTabCounts.totp }}</span>
          </button>

          <button
            type="button"
            @click="switchHomeTab('passwords')"
            :class="[
              'h-9 px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap',
              homeTab === 'passwords'
                ? 'bg-gradient-to-r from-[#1a73e8] to-[#4f46e5] text-white shadow-sm'
                : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'
            ]"
          >
            <KeyRound class="w-3.5 h-3.5" />
            <span>密码</span>
            <span
              :class="[
                'text-[10px] px-1.5 py-0.2 rounded-full font-mono',
                homeTab === 'passwords' ? 'bg-white/20 text-white' : 'bg-[#f1f3f4] text-[#5f6368]'
              ]"
            >{{ homeTabCounts.passwords }}</span>
          </button>

          <button
            type="button"
            @click="switchHomeTab('passkeys')"
            :class="[
              'h-9 px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap',
              homeTab === 'passkeys'
                ? 'bg-gradient-to-r from-[#1a73e8] to-[#4f46e5] text-white shadow-sm'
                : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'
            ]"
          >
            <Fingerprint class="w-3.5 h-3.5" />
            <span>PassKey</span>
            <span
              :class="[
                'text-[10px] px-1.5 py-0.2 rounded-full font-mono',
                homeTab === 'passkeys' ? 'bg-white/20 text-white' : 'bg-[#f1f3f4] text-[#5f6368]'
              ]"
            >{{ homeTabCounts.passkeys }}</span>
          </button>
        </nav>
      </div>
    </template>

    <!-- 3. ADD / EDIT MODAL -->
    <div v-if="isEditing" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="w-full max-w-lg bg-white rounded-3xl p-6 shadow-xl border border-[#dadce0] flex flex-col max-h-[90vh]">
        <div class="flex items-center justify-between pb-3 border-b border-[#f1f3f4] mb-4">
          <h2 class="text-base font-bold text-[#202124]">{{ editForm.id ? "编辑账号资料" : "添加新账号" }}</h2>
          <button @click="isEditing = false" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]">
            <X class="w-4 h-4" />
          </button>
        </div>

        <form @submit.prevent="handleSaveRecord" class="flex-1 overflow-y-auto space-y-4 pr-1">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="block text-xs font-semibold text-[#5f6368]">平台 / 服务名称 *</label>
                <label class="flex items-center gap-1 text-xs font-medium text-[#3c4043] cursor-pointer">
                  <input type="checkbox" v-model="editForm.is_pinned" class="rounded text-amber-500 focus:ring-0 cursor-pointer" />
                  <Star class="w-3.5 h-3.5" :class="editForm.is_pinned ? 'text-amber-400 fill-amber-400' : 'text-[#80868b]'" />
                  <span>置顶</span>
                </label>
              </div>
              <input
                type="text"
                v-model="editForm.title"
                placeholder="GitHub / OpenAI / Steam..."
                class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">网站地址 (可选)</label>
              <input
                type="text"
                v-model="editForm.login_url"
                placeholder="https://github.com/login"
                class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">登录账号 / 用户名 *</label>
              <input
                type="text"
                v-model="editForm.username"
                placeholder="用户名、邮箱或手机号"
                class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">绑定邮箱 (可选)</label>
              <input
                type="text"
                v-model="editForm.email"
                placeholder="name@example.com"
                class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
              />
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-semibold text-[#5f6368]">登录密码</label>
              <button type="button" @click="generatePassword" class="text-[11px] text-[#1a73e8] hover:underline flex items-center gap-1 cursor-pointer">
                <Sparkles class="w-3 h-3" />
                随机强密码
              </button>
            </div>
            <input
              type="text"
              v-model="editForm.password"
              placeholder="请输入密码..."
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono"
            />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">所属分组</label>
              <input
                type="text"
                v-model="editForm.group"
                placeholder="工作 / 开发 / 金融..."
                class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">账号状态</label>
              <select v-model="editForm.status" class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-medium text-[#202124]">
                <option v-for="st in accountStatusOptions" :key="st" :value="st">{{ st }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">会员/套餐 (可选)</label>
              <input
                type="text"
                v-model="editForm.plan"
                placeholder="Pro / Plus / VIP..."
                class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">恢复邮箱 / 密保</label>
              <input
                type="text"
                v-model="editForm.recovery_email"
                placeholder="备用邮箱或密保提示"
                class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">绑定手机号</label>
              <input
                type="text"
                v-model="editForm.phone"
                placeholder="+86 13800..."
                class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
              />
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-semibold text-[#5f6368]">2FA 密钥 (Base32 / otpauth:// / 粘贴二维码截图)</label>
              <button type="button" @click="triggerScanQrImage" class="text-[11px] text-[#1a73e8] hover:underline flex items-center gap-1 cursor-pointer">
                <QrCode class="w-3 h-3" />
                <span>识别二维码图片</span>
              </button>
            </div>
            <input
              type="text"
              v-model="editForm.totp"
              @paste="handleTotpPaste"
              placeholder="JBSWY3DPEHPK3PXP 或直接 Ctrl+V 粘贴二维码图片..."
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono"
            />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1 flex items-center gap-1">
                <Calendar class="w-3 h-3 text-[#1a73e8]" />
                <span>订阅/权益到期日 (可选)</span>
              </label>
              <input type="date" v-model="editForm.expire_at" class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1 flex items-center gap-1">
                <Network class="w-3 h-3 text-[#1a73e8]" />
                <span>独立代理 IP (可选，防关联)</span>
              </label>
              <input type="text" v-model="editForm.proxy" placeholder="http://127.0.0.1:7890" class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono" />
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">备注</label>
            <textarea v-model="editForm.notes" rows="2" placeholder="添加任何重要记录、API Key 或安全提示..." class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none resize-none"></textarea>
          </div>

          <div class="flex items-center justify-end gap-2 pt-3 border-t border-[#f1f3f4]">
            <button type="button" @click="isEditing = false" :disabled="isSavingRecord" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">
              取消
            </button>
            <button type="submit" :disabled="isSavingRecord" class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium shadow-sm flex items-center gap-1.5 cursor-pointer">
              <RefreshCw v-if="isSavingRecord" class="w-3.5 h-3.5 animate-spin" />
              <span>{{ isSavingRecord ? "正在加密保存..." : "保存至安全库" }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 4. CUSTOM URL & PRESET SERVICES MODAL -->
    <div v-if="showCustomUrlModal && selectedRecord" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl border border-[#dadce0] flex flex-col max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-3 border-b border-[#f1f3f4] mb-4">
          <div>
            <h2 class="text-base font-bold text-[#202124]">独立会话浏览器</h2>
            <p class="text-xs text-[#5f6368] mt-0.5">当前账号：<span class="font-medium text-[#1a73e8]">{{ getDisplayTitle(selectedRecord) }} · {{ getPrimaryIdentifier(selectedRecord) }}</span></p>
          </div>
          <button @click="showCustomUrlModal = false" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="mb-4 p-3 bg-[#f8fafd] border border-[#d2e3fc] rounded-2xl flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs font-bold text-[#202124] flex items-center gap-1.5">
              <Zap class="w-3.5 h-3.5 text-[#1a73e8] flex-shrink-0" />
              <span>临时接管外部浏览器跳转 (60s)</span>
            </div>
            <p class="text-[11px] text-[#5f6368] mt-0.5 leading-relaxed">
              开启后在外部软件/CLI 点击登录或复制授权链接，将自动拦截并在当前账号独立会话中打开
            </p>
          </div>
          <button
            type="button"
            @click="toggleBrowserTakeover(selectedRecord)"
            :class="[
              'px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0 transition-all cursor-pointer',
              isTakeoverActive && takeoverTargetRecord?.id === selectedRecord.id
                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs'
                : 'bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-xs'
            ]"
          >
            {{ isTakeoverActive && takeoverTargetRecord?.id === selectedRecord.id ? `停止接管 (${takeoverRemainingSec}s)` : '开启接管' }}
          </button>
        </div>

        <div class="mb-4">
          <div class="flex items-center justify-between mb-2">
            <label class="block text-xs font-semibold text-[#5f6368] uppercase tracking-wider">常用网站直达</label>
            <div class="flex items-center gap-2">
              <button v-if="isManagingPresets" type="button" @click="resetDefaultServicePresets" class="text-[11px] text-[#5f6368] hover:text-[#1a73e8] cursor-pointer">
                恢复默认
              </button>
              <button type="button" @click="isManagingPresets = !isManagingPresets" class="text-[11px] text-[#1a73e8] hover:underline font-medium cursor-pointer">
                {{ isManagingPresets ? "完成管理" : "自定义管理" }}
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div v-for="(p, idx) in servicePresets" :key="p.url + idx" class="relative flex items-center">
              <button
                type="button"
                @click="!isManagingPresets && (showCustomUrlModal = false, openInApp(p.url))"
                class="w-full px-3 py-2 bg-[#f8fafd] hover:bg-[#e8f0fe] hover:text-[#1a73e8] border border-[#dadce0]/60 rounded-xl text-xs font-medium text-[#3c4043] flex items-center justify-between transition-colors text-left truncate cursor-pointer"
                :title="p.url"
              >
                <span class="truncate pr-2">{{ p.name }}</span>
                <ExternalLink v-if="!isManagingPresets" class="w-3 h-3 text-[#5f6368] flex-shrink-0" />
              </button>
              <button
                v-if="isManagingPresets"
                type="button"
                @click.stop="removeServicePreset(idx)"
                class="absolute right-1.5 p-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg cursor-pointer"
              >
                <Trash2 class="w-3 h-3" />
              </button>
            </div>
          </div>

          <div v-if="isManagingPresets" class="mt-3 p-3 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-2">
            <div class="text-[11px] font-semibold text-[#202124]">新增自定义常用网址</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" v-model="newPresetName" placeholder="名称 (如 GitHub)" class="px-2.5 py-1.5 bg-white rounded-lg border border-[#dadce0] text-xs outline-none focus:border-[#1a73e8]" />
              <input type="text" v-model="newPresetUrl" placeholder="https://..." class="px-2.5 py-1.5 bg-white rounded-lg border border-[#dadce0] text-xs outline-none font-mono focus:border-[#1a73e8]" />
            </div>
            <button type="button" @click="addCustomServicePreset" class="w-full py-1.5 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] rounded-lg text-xs font-semibold cursor-pointer">
              + 添加到常用网站列表
            </button>
          </div>
        </div>

        <form @submit.prevent="handleOpenCustomUrl" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">输入任意网址</label>
            <input type="text" v-model="customUrlInput" placeholder="https://..." class="w-full px-3 py-2.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono" />
          </div>

          <div class="flex items-center justify-between gap-2 pt-2 border-t border-[#f1f3f4]">
            <button
              type="button"
              @click="clearCurrentAccountSession"
              class="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw class="w-3.5 h-3.5" />
              <span>清理此账号会话缓存</span>
            </button>
            <div class="flex items-center gap-2">
              <button type="button" @click="showCustomUrlModal = false" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">
                取消
              </button>
              <button type="submit" class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium shadow-sm flex items-center gap-1.5 cursor-pointer">
                <ExternalLink class="w-3.5 h-3.5" />
                <span>在独立窗口打开</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <!-- 5. BACKUP CODES MANAGEMENT MODAL -->
    <div v-if="showBackupCodesModal && selectedRecord" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="w-full max-w-lg bg-white rounded-3xl p-6 shadow-xl border border-[#dadce0] flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between pb-3 border-b border-[#f1f3f4] mb-3">
          <div>
            <h2 class="text-base font-bold text-[#202124]">备用恢复码管理</h2>
            <p class="text-xs text-[#5f6368] mt-0.5">账号：<span class="font-medium text-[#1a73e8]">{{ getDisplayTitle(selectedRecord) }} · {{ getPrimaryIdentifier(selectedRecord) }}</span></p>
          </div>
          <button @click="showBackupCodesModal = false" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="flex items-center justify-between mb-4">
          <div class="text-xs text-[#5f6368]">
            共 <span class="font-bold text-[#202124]">{{ parsedBackupCodesList.length }}</span> 个代码，
            剩余 <span class="font-bold text-emerald-600">{{ unusedBackupCodesCount }}</span> 个可用
          </div>
          <div class="flex items-center gap-2">
            <button v-if="!isEditingBackupCodesRaw" @click="isEditingBackupCodesRaw = true" class="px-2.5 py-1 text-xs bg-[#f1f3f4] hover:bg-[#e8eaed] rounded-lg text-[#3c4043] cursor-pointer">
              编辑 / 批量替换
            </button>
            <button v-else @click="isEditingBackupCodesRaw = false" class="px-2.5 py-1 text-xs bg-[#f1f3f4] hover:bg-[#e8eaed] rounded-lg text-[#3c4043] cursor-pointer">
              返回卡片视图
            </button>
            <button @click="resetAllUsedCodes" class="px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
              重置全部未用
            </button>
          </div>
        </div>

        <div v-if="isEditingBackupCodesRaw" class="space-y-3 flex-1 overflow-y-auto">
          <p class="text-xs text-[#80868b]">请粘贴各平台给出的备用验证码 / 恢复码（每行一个或逗号分隔）：</p>
          <textarea
            v-model="backupCodesRawInput"
            rows="8"
            placeholder="12345678&#10;abcd-efgh-ijkl..."
            class="w-full p-3 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] font-mono text-xs outline-none resize-none leading-relaxed"
          ></textarea>
          <div class="flex justify-end gap-2">
            <button @click="isEditingBackupCodesRaw = false" class="px-4 py-2 bg-[#f1f3f4] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">取消</button>
            <button @click="saveRawBackupCodes" class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium shadow-sm cursor-pointer">保存备用码</button>
          </div>
        </div>

        <div v-else class="flex-1 overflow-y-auto pr-1 space-y-4">
          <button
            @click="copyAndConsumeNextBackupCode"
            :disabled="unusedBackupCodesCount === 0"
            class="w-full py-3 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            <Check v-if="copiedField === 'backup_code_consumed'" class="w-4 h-4" />
            <Copy v-else class="w-4 h-4" />
            <span>{{ copiedField === 'backup_code_consumed' ? '已复制下一个可用码并核销！' : '⚡ 复制下一个未用码并自动核销' }}</span>
          </button>

          <div v-if="parsedBackupCodesList.length > 0" class="grid grid-cols-2 gap-2">
            <div
              v-for="code in parsedBackupCodesList"
              :key="code"
              :class="[
                'p-3 rounded-xl border flex items-center justify-between transition-all select-text',
                usedBackupCodesSet.has(code)
                  ? 'bg-[#f1f3f4]/70 border-[#dadce0]/50 text-[#80868b]'
                  : 'bg-white border-[#dadce0] hover:border-[#1a73e8] text-[#202124]'
              ]"
            >
              <div class="flex items-center gap-2 min-w-0">
                <input type="checkbox" :checked="usedBackupCodesSet.has(code)" @change="toggleBackupCode(code)" class="rounded text-[#1a73e8] focus:ring-0 cursor-pointer" />
                <span :class="['font-mono text-xs font-semibold truncate', usedBackupCodesSet.has(code) ? 'line-through opacity-60' : '']">{{ code }}</span>
              </div>
              <button @click="copyText(code, 'bc_' + code)" class="p-1 hover:bg-[#f1f3f4] rounded text-[#5f6368] cursor-pointer flex-shrink-0">
                <Check v-if="copiedField === 'bc_' + code" class="w-3.5 h-3.5 text-emerald-600" />
                <Copy v-else class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div v-else class="py-8 text-center text-xs text-[#80868b]">
            暂无备用码，请点击右上角「编辑 / 批量替换」进行粘贴录入
          </div>
        </div>
      </div>
    </div>

    <!-- 6. BATCH IMPORT MODAL -->
    <div v-if="showBatchImportModal" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="w-full max-w-2xl bg-white rounded-3xl p-6 shadow-xl border border-[#dadce0] flex flex-col max-h-[90vh]">
        <div class="flex items-center justify-between pb-3 border-b border-[#f1f3f4] mb-3">
          <div>
            <h2 class="text-base font-bold text-[#202124]">批量导入账号</h2>
            <p class="text-xs text-[#5f6368] mt-0.5">支持智能自动识别多格式（----、Tab制表符、竖线、逗号、空格分隔等）</p>
          </div>
          <button @click="showBatchImportModal = false" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="space-y-4 flex-1 overflow-y-auto pr-1">
          <!-- Browser / Password Manager File Import Card -->
          <div class="p-3.5 bg-[#f8fafd] border border-[#d2e3fc] rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="space-y-1 min-w-0">
              <div class="text-xs font-bold text-[#202124] flex items-center gap-1.5">
                <FileText class="w-3.5 h-3.5 text-[#1a73e8] flex-shrink-0" />
                <span>从浏览器或密码管理器导出文件导入</span>
              </div>
              <p class="text-[11px] text-[#5f6368] leading-relaxed">
                支持 <b>Chrome</b>、<b>Edge</b>、<b>Firefox</b>、<b>Safari</b>、<b>Bitwarden</b>、<b>1Password</b>、<b>KeePass</b> 导出的 CSV / JSON 文件
              </p>
            </div>
            <button
              type="button"
              @click="triggerImportExternalFile"
              class="px-3.5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs flex-shrink-0 cursor-pointer whitespace-nowrap"
            >
              <Upload class="w-3.5 h-3.5" />
              <span>选择 CSV / JSON 文件</span>
            </button>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-semibold text-[#5f6368]">或直接粘贴多行文本数据</label>
              <span class="text-[11px] text-[#80868b]">例: 平台----账号----密码----TOTP密钥</span>
            </div>
            <textarea
              v-model="batchRawText"
              @input="handleBatchParse"
              rows="4"
              placeholder="GitHub----alice----Password123----JBSWY3DPEHPK3PXP&#10;OpenAI----user@example.com----Pass456"
              class="w-full p-3 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] font-mono text-xs outline-none resize-none leading-relaxed"
            ></textarea>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">统一覆盖平台（可选）</label>
              <input type="text" v-model="batchAssignPlatform" @input="applyBatchOverrides" placeholder="留空则保留原平台名..." class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#5f6368] mb-1">统一覆盖分组（可选）</label>
              <input type="text" v-model="batchAssignGroup" @input="applyBatchOverrides" placeholder="留空则保留原分组..." class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
            </div>
            <div class="text-right pt-3 text-xs font-medium text-[#1a73e8] flex flex-col justify-center">
              <span v-if="batchImportSourceLabel" class="text-[10px] text-emerald-700 font-semibold truncate">{{ batchImportSourceLabel }}</span>
              <span>已识别：<span class="text-base font-bold">{{ batchParsedRecords.length }}</span> 个账号</span>
            </div>
          </div>

          <div v-if="batchParsedRecords.length > 0" class="border border-[#dadce0] rounded-2xl overflow-hidden max-h-56 overflow-y-auto">
            <table class="w-full text-left text-xs divide-y divide-[#f1f3f4]">
              <thead class="bg-[#f8fafd] text-[#5f6368] sticky top-0">
                <tr>
                  <th class="px-3 py-2 font-medium">#</th>
                  <th class="px-3 py-2 font-medium">平台</th>
                  <th class="px-3 py-2 font-medium">账号</th>
                  <th class="px-3 py-2 font-medium">分组</th>
                  <th class="px-3 py-2 font-medium">密码</th>
                  <th class="px-3 py-2 font-medium">TOTP</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#f1f3f4] bg-white font-mono">
                <tr v-for="(r, idx) in batchParsedRecords" :key="idx" class="hover:bg-[#f8fafd]">
                  <td class="px-3 py-1.5 text-[#80868b]">{{ idx + 1 }}</td>
                  <td class="px-3 py-1.5 font-sans font-medium text-[#1a73e8] max-w-[120px] truncate">{{ r.title }}</td>
                  <td class="px-3 py-1.5 font-sans font-medium text-[#202124] max-w-[140px] truncate">{{ r.username }}</td>
                  <td class="px-3 py-1.5 font-sans text-[#5f6368] max-w-[90px] truncate">{{ r.group || '—' }}</td>
                  <td class="px-3 py-1.5 text-[#5f6368]">{{ r.password ? '••••••••' : '—' }}</td>
                  <td class="px-3 py-1.5 text-[#1a73e8]">{{ r.totp ? '有' : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-[#f1f3f4] mt-3">
          <button type="button" @click="showBatchImportModal = false" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">
            取消
          </button>
          <button
            type="button"
            :disabled="batchParsedRecords.length === 0"
            @click="confirmBatchImport"
            class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium shadow-sm disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Upload class="w-3.5 h-3.5" />
            <span>确认导入 {{ batchParsedRecords.length }} 个账号至保险库</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 7. UNIFIED SETTINGS MODAL -->
    <div v-if="showSettingsModal" class="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
      <div class="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-[#dadce0] flex flex-col max-h-[92vh] sm:max-h-[88vh] overflow-hidden my-auto">
        <div class="px-4 sm:px-6 py-3 sm:py-4 border-b border-[#f1f3f4] flex items-center justify-between flex-shrink-0 bg-[#f8fafd]">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-xl bg-[#e8f0fe] text-[#1a73e8] flex items-center justify-center flex-shrink-0">
              <Settings class="w-4 h-4" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-bold text-[#202124] truncate">设置与偏好</h2>
              <p class="text-[11px] text-[#5f6368] truncate">设备安全解锁 · 云端端到端同步 · 备份导出 · 检查更新</p>
            </div>
          </div>
          <button @click="showSettingsModal = false" class="p-1.5 hover:bg-[#e8eaed] rounded-full text-[#5f6368] cursor-pointer">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-2.5 border-b border-[#f1f3f4] bg-white flex-shrink-0 text-xs font-medium overflow-x-auto no-scrollbar whitespace-nowrap">
          <button @click="settingsTab = 'security'" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'security' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
            <Fingerprint class="w-3.5 h-3.5" />
            <span>安全与解锁</span>
          </button>
          <button @click="settingsTab = 'webdav'; loadWebDavConfig()" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'webdav' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
            <Cloud class="w-3.5 h-3.5" />
            <span>云端同步</span>
          </button>
          <button @click="settingsTab = 'backups'; loadBackupsList()" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'backups' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
            <History class="w-3.5 h-3.5" />
            <span>备份与导出</span>
          </button>
          <button @click="settingsTab = 'updates'" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'updates' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
            <RefreshCw class="w-3.5 h-3.5" />
            <span>检查更新</span>
          </button>
          <button @click="settingsTab = 'about'" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'about' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
            <Info class="w-3.5 h-3.5" />
            <span>关于</span>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-3.5 sm:p-5 md:p-6 space-y-4">
          <!-- TAB 1: SECURITY -->
          <div v-if="settingsTab === 'security'" class="space-y-4">
            <div class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-10 h-10 rounded-xl bg-white border border-[#dadce0]/70 flex items-center justify-center text-[#1a73e8] flex-shrink-0">
                    <Fingerprint class="w-5 h-5" />
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-xs font-bold text-[#202124] flex items-center gap-2 flex-wrap">
                      <span>{{ isMobilePlatform ? '手机生物识别 / 屏幕锁快速解锁' : 'Windows Hello / PIN 生物识别解锁' }}</span>
                      <span v-if="helloStatus.enrolled" class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold">已启用</span>
                    </h3>
                    <p class="text-[11px] text-[#5f6368] mt-0.5">开启后可使用指纹、面容或 PIN 码一键快速解锁保险库。</p>
                  </div>
                </div>
                <div v-if="helloStatus.available" class="flex-shrink-0">
                  <button
                    @click="toggleWindowsHello"
                    :class="helloStatus.enrolled ? 'px-3.5 py-1.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs font-medium cursor-pointer' : 'px-4 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium cursor-pointer'"
                  >
                    {{ helloStatus.enrolled ? '停用免密解锁' : '立即绑定设备' }}
                  </button>
                </div>
              </div>
            </div>

            <div class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-xs font-bold text-[#202124]">解锁后自动选中首个账号</h3>
                  <p class="text-[11px] text-[#5f6368] mt-0.5">{{ autoSelectFirst ? '已开启自动选中' : '已开启防窥留白保护' }}</p>
                </div>
                <button type="button" @click="toggleAutoSelectFirst" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', autoSelectFirst ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                  <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', autoSelectFirst ? 'translate-x-5' : 'translate-x-0']" />
                </button>
              </div>
              <div class="pt-3 border-t border-[#dadce0]/60 flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-xs font-bold text-[#202124]">显示账号列表圆形头像</h3>
                  <p class="text-[11px] text-[#5f6368] mt-0.5">{{ showListAvatar ? '显示首字母头像' : '极简紧凑模式' }}</p>
                </div>
                <button type="button" @click="toggleShowListAvatar" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', showListAvatar ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                  <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', showListAvatar ? 'translate-x-5' : 'translate-x-0']" />
                </button>
              </div>
            </div>

            <div class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
              <h3 class="text-xs font-bold text-[#202124]">空闲自动锁定 & 剪贴板自动清理</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="p-3 bg-white rounded-xl border border-[#dadce0]/80 space-y-2">
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-bold text-[#202124]">无操作自动锁定</span>
                    <span class="text-[11px] font-semibold text-[#1a73e8]">{{ autoLockMinutes > 0 ? `${autoLockMinutes} 分钟` : '关闭' }}</span>
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    <button v-for="m in [0, 5, 15, 30, 60]" :key="m" type="button" @click="setAutoLockMinutes(m)" :class="['px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer', autoLockMinutes === m ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-[#f8fafd] text-[#5f6368] border-[#dadce0]']">
                      {{ m === 0 ? '关闭' : `${m}分` }}
                    </button>
                  </div>
                </div>
                <div class="p-3 bg-white rounded-xl border border-[#dadce0]/80 space-y-2">
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-bold text-[#202124]">剪贴板自动清空</span>
                    <span class="text-[11px] font-semibold text-[#1a73e8]">{{ clipboardClearSeconds > 0 ? `${clipboardClearSeconds} 秒` : '关闭' }}</span>
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    <button v-for="s in [0, 15, 30, 60]" :key="s" type="button" @click="setClipboardClearSeconds(s)" :class="['px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer', clipboardClearSeconds === s ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-[#f8fafd] text-[#5f6368] border-[#dadce0]']">
                      {{ s === 0 ? '关闭' : `${s}秒` }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 class="text-xs font-bold text-[#202124]">主密码与本地加密体系</h3>
                <p class="text-[11px] text-[#5f6368] mt-0.5">AES-256-GCM + Scrypt (N=32768) 端到端加密。</p>
              </div>
              <button type="button" @click="openChangePwdModal" class="px-4 py-2 bg-white hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#1a73e8]/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                <KeyRound class="w-3.5 h-3.5" />
                <span>修改主密码</span>
              </button>
            </div>

            <!-- Android System Autofill OR Desktop Browser Extension Bridge -->
            <div v-if="isMobilePlatform" class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 class="text-xs font-bold text-[#202124] flex items-center gap-2 flex-wrap">
                    <span>系统自动填充服务 (Autofill)</span>
                    <span :class="['px-2 py-0.5 rounded-full text-[10px] font-semibold', androidAutofillEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800']">
                      {{ androidAutofillEnabled ? '已设为系统默认' : '未启用' }}
                    </span>
                  </h3>
                  <p class="text-[11px] text-[#5f6368] mt-0.5">开启后可在其他 App 与系统浏览器中直接弹出 AccountVault 自动填充账号密码与 2FA。</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <button type="button" @click="openAndroidAutofillSettings" class="px-3.5 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium cursor-pointer">
                    {{ androidAutofillEnabled ? '管理自动填充' : '去系统设置开启' }}
                  </button>
                  <button type="button" @click="refreshAutofillAndBridgeStatus" class="px-2.5 py-1.5 bg-white hover:bg-[#f1f3f4] text-[#5f6368] border border-[#dadce0] rounded-xl text-xs cursor-pointer">
                    刷新
                  </button>
                </div>
              </div>
            </div>

            <div v-else class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-xs font-bold text-[#202124] flex items-center gap-2">
                    <span>Chrome / Edge 浏览器扩展联动</span>
                    <span :class="['px-2 py-0.5 rounded-full text-[10px] font-semibold', browserBridgeStatus.enabled && browserBridgeStatus.running ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700']">
                      {{ browserBridgeStatus.enabled && browserBridgeStatus.running ? `监听中 :${browserBridgeStatus.port}` : '已暂停' }}
                    </span>
                  </h3>
                  <p class="text-[11px] text-[#5f6368] mt-0.5">在 Chrome/Edge 中加载项目下的 <code class="px-1 py-0.5 bg-white border border-[#dadce0] rounded text-[10px]">browser-extension</code> 文件夹即可网页自动填充与保存密码。</p>
                </div>
                <button type="button" @click="toggleBrowserBridge" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', browserBridgeStatus.enabled ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                  <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', browserBridgeStatus.enabled ? 'translate-x-5' : 'translate-x-0']" />
                </button>
              </div>
              <div class="p-2.5 bg-white rounded-xl border border-[#dadce0]/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-[10px] text-[#80868b]">扩展配对密钥 (仅限本机 127.0.0.1 通信)</div>
                  <div class="text-xs font-mono text-[#202124] truncate">{{ browserBridgeStatus.token ? '••••••••••••••••' + browserBridgeStatus.token.slice(-6) : '未生成' }}</div>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <button type="button" @click="copyBrowserBridgeToken" class="px-3 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-[11px] font-medium cursor-pointer">
                    复制密钥
                  </button>
                  <button type="button" @click="regenerateBrowserBridgeToken" class="px-2.5 py-1.5 bg-[#f8fafd] hover:bg-[#f1f3f4] text-[#5f6368] border border-[#dadce0] rounded-lg text-[11px] cursor-pointer">
                    重置
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 2: WEBDAV -->
          <div v-else-if="settingsTab === 'webdav'" class="space-y-4">
            <div class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
              <div class="flex items-center justify-between gap-2 pb-2 border-b border-[#dadce0]/60">
                <span class="text-xs font-bold text-[#202124]">全自动增量智能同步 (Smart Merge)</span>
                <button type="button" @click="webdavForm.auto_sync = !webdavForm.auto_sync; handleSaveWebDavConfig(false)" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', webdavForm.auto_sync ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                  <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', webdavForm.auto_sync ? 'translate-x-5' : 'translate-x-0']" />
                </button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="p-2.5 bg-white rounded-xl border border-[#dadce0]/70">
                  <div class="text-[10px] text-[#80868b]">上次同步时间</div>
                  <div class="text-xs font-semibold text-[#202124]">{{ lastSyncTimeFormatted }}</div>
                </div>
                <div class="p-2.5 bg-white rounded-xl border border-[#dadce0]/70">
                  <div class="text-[10px] text-[#80868b]">同步状态</div>
                  <div class="text-xs font-semibold text-[#202124]">{{ syncState === 'syncing' ? '同步中...' : syncState === 'error' ? '同步异常' : '就绪' }}</div>
                </div>
              </div>
              <button type="button" @click="triggerSmartSync(false)" :disabled="isWebDavSyncing" class="w-full py-2.5 px-3 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-2 cursor-pointer">
                <RefreshCw :class="['w-3.5 h-3.5', isWebDavSyncing ? 'animate-spin' : '']" />
                <span>⚡ 立即执行增量智能合并</span>
              </button>
            </div>

            <div class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
              <div class="text-xs font-bold text-[#202124]">WebDAV 服务器配置</div>
              <input type="text" v-model="webdavForm.url" @change="handleSaveWebDavConfig(false)" placeholder="https://dav.jianguoyun.com/dav/AccountVault/" class="w-full px-3 py-2 bg-white rounded-xl border border-[#dadce0] text-xs outline-none font-mono" />
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="text" v-model="webdavForm.username" @change="handleSaveWebDavConfig(false)" placeholder="账号 / 邮箱" class="w-full px-3 py-2 bg-white rounded-xl border border-[#dadce0] text-xs outline-none" />
                <input type="password" v-model="webdavForm.password" @change="handleSaveWebDavConfig(false)" placeholder="应用密码 / Token" class="w-full px-3 py-2 bg-white rounded-xl border border-[#dadce0] text-xs outline-none font-mono" />
              </div>
              <div v-if="webdavStatus" class="p-2.5 bg-white rounded-xl border border-[#dadce0] text-xs text-[#3c4043]">{{ webdavStatus }}</div>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" @click="handleTestWebDav" :disabled="isWebDavSyncing" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">测试连接</button>
                <button type="button" @click="handleSaveWebDavConfig(true)" class="px-4 py-2 bg-white hover:bg-[#f1f3f4] text-[#3c4043] border border-[#dadce0] rounded-xl text-xs font-medium cursor-pointer">保存配置</button>
                <button type="button" @click="handleUploadWebDav" :disabled="isWebDavSyncing" class="px-3 py-2 bg-white hover:bg-[#f1f3f4] text-[#3c4043] border border-[#dadce0] rounded-xl text-xs font-medium cursor-pointer">强制上传</button>
                <button type="button" @click="handleDownloadWebDav" :disabled="isWebDavSyncing" class="px-3 py-2 bg-white hover:bg-[#f1f3f4] text-[#3c4043] border border-[#dadce0] rounded-xl text-xs font-medium cursor-pointer">强制下载</button>
              </div>
            </div>
          </div>

          <!-- TAB 3: BACKUPS & EXPORT -->
          <div v-else-if="settingsTab === 'backups'" class="space-y-4">
            <div class="flex gap-2 p-1 bg-[#f1f3f4] rounded-xl text-xs font-medium">
              <button @click="backupTab = 'backups'" :class="['flex-1 py-1.5 px-2 rounded-lg cursor-pointer', backupTab === 'backups' ? 'bg-white text-[#1a73e8] shadow-sm font-semibold' : 'text-[#5f6368]']">历史快照 ({{ backupList.length }})</button>
              <button @click="backupTab = 'export'" :class="['flex-1 py-1.5 px-2 rounded-lg cursor-pointer', backupTab === 'export' ? 'bg-white text-[#1a73e8] shadow-sm font-semibold' : 'text-[#5f6368]']">导入与导出</button>
            </div>

            <div v-if="backupTab === 'backups'" class="space-y-2.5">
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-[#5f6368]">自动保留最近 30 份加密快照</span>
                <button type="button" @click="handleCreateManualBackup" class="px-3 py-1.5 bg-[#1a73e8] text-white rounded-xl text-xs font-medium cursor-pointer">立即创建快照</button>
              </div>
              <div class="space-y-2 max-h-64 overflow-y-auto">
                <div v-if="backupList.length === 0" class="py-8 text-center text-xs text-[#80868b]">暂无历史快照</div>
                <div v-for="b in backupList" :key="b.filename" class="p-3 bg-[#f8fafd] border border-[#dadce0]/70 rounded-xl flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="font-mono text-xs font-semibold text-[#202124]">{{ b.timestamp }}</div>
                    <div class="text-[11px] text-[#80868b] font-mono truncate">{{ b.filename }} ({{ (b.size_bytes / 1024).toFixed(1) }} KB)</div>
                  </div>
                  <button @click="handleRestoreBackup(b.filename)" class="px-3 py-1.5 bg-[#e8f0fe] text-[#1a73e8] rounded-lg text-xs font-medium cursor-pointer">回滚</button>
                </div>
              </div>
            </div>

            <div v-else class="space-y-3">
              <div class="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 class="text-xs font-bold text-emerald-950">密文保险库文件 (.avault / 兼容导入 .gvault)</h3>
                  <p class="text-[11px] text-emerald-800/85 mt-0.5">AES-256-GCM 强加密封装，支持从 GoogleAccountVault 的 .gvault 文件直接迁移导入。</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <button @click="triggerImportVaultFile" class="px-3 py-2 bg-white text-emerald-900 border border-emerald-300 rounded-xl text-xs font-medium cursor-pointer">导入密文</button>
                  <button @click="handleExportAvault" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold cursor-pointer">导出 .avault</button>
                </div>
              </div>

              <div class="p-3.5 bg-[#f8fafd] rounded-2xl border border-[#dadce0] flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-xs font-bold text-[#202124]">导出为标准 CSV 表格</h3>
                  <p class="text-[11px] text-[#5f6368]">明文表格备份，支持 Excel 打开。</p>
                </div>
                <button @click="handleExportCsv" class="px-4 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                  <FileText class="w-3.5 h-3.5" />
                  <span>导出 CSV</span>
                </button>
              </div>

              <div class="p-3.5 bg-[#f8fafd] rounded-2xl border border-[#dadce0] flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-xs font-bold text-[#202124]">导出为 JSON 数据</h3>
                  <p class="text-[11px] text-[#5f6368]">结构化明文数据备份。</p>
                </div>
                <button @click="handleExportJson" class="px-4 py-2 bg-white text-[#3c4043] border border-[#dadce0] rounded-xl text-xs font-medium cursor-pointer">导出 JSON</button>
              </div>
            </div>
          </div>

          <!-- TAB 4: UPDATES -->
          <div v-else-if="settingsTab === 'updates'" class="space-y-4">
            <div class="p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-xs font-bold text-[#202124]">软件版本检查更新 (当前 v{{ appVersion }})</h3>
                  <p class="text-[11px] text-[#5f6368] mt-0.5">检测 GitHub Releases 官方版本更新</p>
                </div>
                <button @click="checkForUpdates(false)" :disabled="isCheckingUpdate || isDownloadingUpdate" class="px-4 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium cursor-pointer">
                  {{ isCheckingUpdate ? "正在检查..." : "立即检查更新" }}
                </button>
              </div>
              <div class="pt-2 border-t border-[#dadce0]/60 flex items-center justify-between">
                <span class="text-xs font-bold text-[#202124]">启动时自动检查更新</span>
                <button type="button" @click="toggleAutoCheckUpdate" :class="['relative inline-flex h-6 w-11 cursor-pointer rounded-full border-2 border-transparent', autoCheckUpdateOnStartup ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                  <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', autoCheckUpdateOnStartup ? 'translate-x-5' : 'translate-x-0']" />
                </button>
              </div>
              <div class="pt-2 border-t border-[#dadce0]/60 flex flex-wrap gap-1.5">
                <button type="button" @click="setUpdateMirror('gh-proxy')" :class="['px-2.5 py-1 rounded-lg text-xs border cursor-pointer', updateMirror === 'gh-proxy' ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']">gh-proxy (推荐)</button>
                <button type="button" @click="setUpdateMirror('ghproxy')" :class="['px-2.5 py-1 rounded-lg text-xs border cursor-pointer', updateMirror === 'ghproxy' ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']">ghproxy.net</button>
                <button type="button" @click="setUpdateMirror('official')" :class="['px-2.5 py-1 rounded-lg text-xs border cursor-pointer', updateMirror === 'official' ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']">官方直连</button>
              </div>
            </div>

            <div v-if="updateResult" class="p-4 bg-white border border-[#dadce0] rounded-2xl space-y-2 text-xs">
              <div v-if="updateResult.has_update" class="space-y-3">
                <div class="font-bold text-emerald-900">发现新版本：{{ updateResult.latest_version }} ({{ currentInstallTypeName }})</div>
                <div class="flex gap-2">
                  <button v-if="!isDownloadingUpdate" @click="startAutoUpdate()" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold cursor-pointer">一键自动更新</button>
                  <button v-if="!isDownloadingUpdate" @click="openExternalUrl(updateResult.download_url || updateResult.release_url)" class="px-3 py-2 bg-white border border-emerald-300 text-emerald-800 rounded-xl text-xs cursor-pointer">浏览器下载</button>
                </div>
                <div v-if="isDownloadingUpdate" class="space-y-1">
                  <div class="text-xs text-emerald-800">{{ downloadStatusText }} ({{ downloadProgress }}%)</div>
                  <div class="w-full h-2 bg-emerald-100 rounded-full overflow-hidden">
                    <div class="h-full bg-emerald-600" :style="{ width: `${downloadProgress}%` }"></div>
                  </div>
                </div>
                <div v-if="parsedReleaseNotes" class="p-3 bg-[#f8fafd] rounded-xl text-[11px] space-y-1">
                  <div class="font-bold">{{ parsedReleaseNotes.title }}</div>
                  <div v-for="(item, idx) in parsedReleaseNotes.items" :key="idx">• [{{ item.typeLabel }}] {{ item.text }}</div>
                </div>
              </div>
              <div v-else class="flex items-center gap-2 text-emerald-700 font-semibold">
                <CheckCircle2 class="w-4 h-4" />
                <span>当前已是最新版本 ({{ updateResult.current_version }})</span>
              </div>
            </div>
            <div v-else-if="updateError" class="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">{{ updateError }}</div>
          </div>

          <!-- TAB 5: ABOUT -->
          <div v-else-if="settingsTab === 'about'" class="space-y-4">
            <div class="p-5 bg-[#f8fafd] rounded-2xl border border-[#dadce0] flex flex-col items-center text-center space-y-3">
              <div class="w-16 h-16 rounded-2xl bg-white p-1.5 border border-[#dadce0] shadow-xs overflow-hidden flex items-center justify-center">
                <img src="/logo.png" alt="Logo" class="w-full h-full object-contain" />
              </div>
              <div>
                <h3 class="text-base font-bold text-[#202124]">账号管家 (Account Vault)</h3>
                <p class="text-xs text-[#1a73e8] font-mono font-medium mt-0.5">v{{ appVersion }}</p>
              </div>
              <p class="text-xs text-[#5f6368] max-w-md leading-relaxed">
                通用型多平台账号与二次验证（2FA）安全保险库，集成 RFC 6238 动态码、硬件级免密解锁、多账号隔离沙箱浏览器与 WebDAV 端到端纯密文同步。
              </p>
              <button @click="openExternalUrl('https://github.com/ifnor/AccountVault')" class="px-3.5 py-1.5 bg-white hover:bg-[#f1f3f4] text-[#202124] border border-[#dadce0] rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                <Globe class="w-3.5 h-3.5 text-[#1a73e8]" />
                <span>GitHub 项目主页</span>
              </button>
            </div>
          </div>
        </div>

        <div class="px-4 sm:px-6 py-3 border-t border-[#f1f3f4] bg-[#f8fafd] flex justify-end flex-shrink-0">
          <button @click="showSettingsModal = false" class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium cursor-pointer">
            完成
          </button>
        </div>
      </div>
    </div>

    <!-- 9. PASSWORD GENERATOR MODAL -->
    <div v-if="showPasswordGenModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col gap-5">
        <div class="flex items-center justify-between pb-3 border-b border-[#dadce0]">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-[#e8f0fe] flex items-center justify-center text-[#1a73e8]">
              <KeyRound class="w-4 h-4" />
            </div>
            <div>
              <h2 class="text-sm font-bold text-[#202124]">强随机密码生成器</h2>
              <p class="text-[11px] text-[#5f6368]">自定义长度与多字符集加密生成高熵安全凭据</p>
            </div>
          </div>
          <button @click="showPasswordGenModal = false" class="text-[#5f6368] hover:text-[#202124] p-1.5 hover:bg-[#f1f3f4] rounded-full cursor-pointer">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="bg-[#f8fafd] border border-[#dadce0] rounded-2xl p-4 flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-3">
            <span class="font-mono text-base md:text-lg font-bold text-[#1a73e8] tracking-wider break-all select-all flex-1">{{ generatedPassword || "生成中..." }}</span>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button @click="generateNewPassword" class="p-2 hover:bg-[#e8eaed] text-[#5f6368] hover:text-[#1a73e8] rounded-xl cursor-pointer">
                <RefreshCw class="w-4 h-4" />
              </button>
              <button @click="copyGeneratedPassword" class="px-3 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                <Copy class="w-3.5 h-3.5" />
                <span>复制</span>
              </button>
            </div>
          </div>
          <div class="flex flex-col gap-1 pt-1 border-t border-[#dadce0]/60">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-[#5f6368]">安全性强度</span>
              <span class="font-bold" :class="passwordStrength.textCol">{{ passwordStrength.text }}</span>
            </div>
            <div class="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div class="h-full transition-all duration-300" :class="passwordStrength.color" :style="{ width: passwordStrength.percent }"></div>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5 items-center">
          <span class="text-xs text-[#5f6368] font-medium">快速预设:</span>
          <button @click="applyPwdPreset('strong')" class="px-2.5 py-1 bg-[#f1f3f4] hover:bg-[#e8f0fe] hover:text-[#1a73e8] rounded-lg text-xs cursor-pointer">标准强密 (20位)</button>
          <button @click="applyPwdPreset('max')" class="px-2.5 py-1 bg-[#f1f3f4] hover:bg-[#e8f0fe] hover:text-[#1a73e8] rounded-lg text-xs cursor-pointer">超高强度 (32位)</button>
          <button @click="applyPwdPreset('alphanumeric')" class="px-2.5 py-1 bg-[#f1f3f4] hover:bg-[#e8f0fe] hover:text-[#1a73e8] rounded-lg text-xs cursor-pointer">纯字母数字 (18位)</button>
          <button @click="applyPwdPreset('pin')" class="px-2.5 py-1 bg-[#f1f3f4] hover:bg-[#e8f0fe] hover:text-[#1a73e8] rounded-lg text-xs cursor-pointer">PIN码 (6位)</button>
        </div>

        <div class="space-y-4">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs font-medium text-[#202124]">
              <span>密码长度 ({{ pwdGenForm.length }} 位)</span>
              <span class="text-[#5f6368] font-mono">{{ pwdGenForm.length }} / 64</span>
            </div>
            <input type="range" min="6" max="64" v-model.number="pwdGenForm.length" @input="generateNewPassword" class="w-full accent-[#1a73e8] cursor-pointer" />
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer">
              <input type="checkbox" v-model="pwdGenForm.uppercase" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
              <span>大写字母 (A-Z)</span>
            </label>
            <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer">
              <input type="checkbox" v-model="pwdGenForm.lowercase" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
              <span>小写字母 (a-z)</span>
            </label>
            <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer">
              <input type="checkbox" v-model="pwdGenForm.numbers" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
              <span>数字 (0-9)</span>
            </label>
            <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer">
              <input type="checkbox" v-model="pwdGenForm.symbols" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
              <span>特殊符号 (!@#$...)</span>
            </label>
            <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer col-span-2">
              <input type="checkbox" v-model="pwdGenForm.exclude_ambiguous" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
              <span>排除易混淆字符 (避免 1, l, I, 0, O, o)</span>
            </label>
          </div>
        </div>

        <div class="flex items-center justify-between pt-3 border-t border-[#dadce0] gap-3">
          <button
            v-if="selectedRecord"
            @click="applyPasswordToCurrentRecord"
            class="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles class="w-3.5 h-3.5 text-emerald-600" />
            <span>应用至当前账号 ({{ getDisplayTitle(selectedRecord) }})</span>
          </button>
          <div v-else></div>
          <div class="flex items-center gap-2">
            <button @click="showPasswordGenModal = false" class="px-4 py-2.5 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">关闭</button>
            <button @click="copyGeneratedPassword" class="px-5 py-2.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium cursor-pointer">复制密码</button>
          </div>
        </div>
      </div>
    </div>

    <!-- TOAST NOTIFICATIONS -->
    <div class="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none flex flex-col gap-2.5 items-center max-w-lg w-full px-4">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto px-4 py-2.5 rounded-2xl shadow-xl border text-xs font-semibold flex items-center gap-2.5 backdrop-blur-xl select-text"
        :class="{
          'bg-emerald-50/95 text-emerald-900 border-emerald-300/80': toast.type === 'success',
          'bg-red-50/95 text-red-900 border-red-300/80': toast.type === 'error',
          'bg-amber-50/95 text-amber-900 border-amber-300/80': toast.type === 'warning',
          'bg-slate-900/90 text-white border-slate-700/60': toast.type === 'info'
        }"
      >
        <CheckCircle2 v-if="toast.type === 'success'" class="w-4 h-4 text-emerald-600 flex-shrink-0" />
        <AlertCircle v-else-if="toast.type === 'error'" class="w-4 h-4 text-red-600 flex-shrink-0" />
        <AlertTriangle v-else-if="toast.type === 'warning'" class="w-4 h-4 text-amber-600 flex-shrink-0" />
        <Info v-else class="w-4 h-4 text-blue-400 flex-shrink-0" />
        <span class="leading-normal">{{ toast.message }}</span>
      </div>
    </div>

    <!-- CUSTOM CONFIRMATION MODAL -->
    <div v-if="confirmState.visible" class="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
      <div class="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col gap-4">
        <div class="flex items-start gap-3.5">
          <div class="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" :class="{ 'bg-red-100 text-red-600': confirmState.type === 'danger', 'bg-amber-100 text-amber-700': confirmState.type === 'warning', 'bg-[#e8f0fe] text-[#1a73e8]': confirmState.type === 'info' }">
            <AlertTriangle v-if="confirmState.type === 'warning'" class="w-5 h-5" />
            <Trash2 v-else-if="confirmState.type === 'danger'" class="w-5 h-5" />
            <Info v-else class="w-5 h-5" />
          </div>
          <div class="flex-1">
            <h3 class="text-sm font-bold text-[#202124]">{{ confirmState.title }}</h3>
            <p class="text-xs text-[#5f6368] mt-1.5 leading-relaxed whitespace-pre-wrap">{{ confirmState.message }}</p>
          </div>
        </div>
        <div class="flex items-center justify-end gap-2.5 mt-2 pt-2 border-t border-[#f1f3f4]">
          <button @click="confirmState.resolve(false)" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">{{ confirmState.cancelText }}</button>
          <button @click="confirmState.resolve(true)" class="px-4 py-2 text-white rounded-xl text-xs font-medium cursor-pointer" :class="{ 'bg-red-600 hover:bg-red-700': confirmState.type === 'danger', 'bg-amber-600 hover:bg-amber-700': confirmState.type === 'warning', 'bg-[#1a73e8] hover:bg-[#1557b0]': confirmState.type === 'info' }">{{ confirmState.confirmText }}</button>
        </div>
      </div>
    </div>

    <!-- BATCH UPDATE ACTION MODAL -->
    <div v-if="showBatchActionModal" class="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
      <div class="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col gap-4">
        <div class="flex items-center justify-between pb-2 border-b border-[#f1f3f4]">
          <h3 class="text-sm font-bold text-[#202124]">
            {{
              batchActionType === 'group' ? `批量修改分组 (${selectedBatchIds.length} 个)` :
              batchActionType === 'status' ? `批量修改账号状态 (${selectedBatchIds.length} 个)` :
              `批量修改会员/套餐 (${selectedBatchIds.length} 个)`
            }}
          </h3>
          <button @click="showBatchActionModal = false" class="p-1 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]"><X class="w-4 h-4" /></button>
        </div>

        <div v-if="batchActionType === 'group'" class="space-y-2">
          <label class="block text-xs font-semibold text-[#5f6368]">目标分组名称（留空则设为未分组）</label>
          <input type="text" v-model="batchTargetGroup" placeholder="例如：工作 / 开发 / 金融..." class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
        </div>
        <div v-else-if="batchActionType === 'status'" class="space-y-2">
          <label class="block text-xs font-semibold text-[#5f6368]">选择账号状态</label>
          <select v-model="batchTargetStatus" class="w-full px-3 py-2 bg-[#f1f3f4] rounded-xl text-xs outline-none font-medium">
            <option v-for="st in accountStatusOptions" :key="st" :value="st">{{ st }}</option>
          </select>
        </div>
        <div v-else class="space-y-2">
          <label class="block text-xs font-semibold text-[#5f6368]">目标套餐 / 会员等级</label>
          <input type="text" v-model="batchTargetPlan" placeholder="例如：Pro / VIP / Free..." class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#f1f3f4]">
          <button type="button" @click="showBatchActionModal = false" class="px-4 py-2 bg-[#f1f3f4] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">取消</button>
          <button type="button" @click="executeBatchUpdate" class="px-5 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium cursor-pointer">确认批量修改</button>
        </div>
      </div>
    </div>

    <!-- 2FA QR CODE TRANSFER MODAL -->
    <div v-if="showTotpQrModal && totpQrData" class="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
      <div class="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col items-center gap-4 text-center">
        <div class="w-full flex items-center justify-between pb-2 border-b border-[#f1f3f4]">
          <div class="text-left">
            <h3 class="text-sm font-bold text-[#202124]">2FA 转移二维码</h3>
            <p class="text-[11px] text-[#5f6368] truncate max-w-[220px]">{{ selectedRecord ? `${getDisplayTitle(selectedRecord)} · ${getPrimaryIdentifier(selectedRecord)}` : '' }}</p>
          </div>
          <button @click="showTotpQrModal = false" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]"><X class="w-4 h-4" /></button>
        </div>
        <div class="p-3 bg-white border-2 border-[#dadce0] rounded-2xl shadow-xs">
          <img :src="totpQrData.qr_base64" alt="2FA TOTP QR Code" class="w-48 h-48 object-contain" />
        </div>
        <div class="w-full bg-[#f8fafd] p-2.5 rounded-xl border border-[#dadce0]/80 flex items-center justify-between gap-2 text-xs">
          <span class="font-mono text-[11px] text-[#202124] truncate select-all">{{ totpQrData.secret }}</span>
          <button type="button" @click="copyText(totpQrData.secret, 'qr_secret', '已复制 Base32 密钥')" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#dadce0] rounded-lg text-[11px] font-medium cursor-pointer">复制密钥</button>
        </div>
        <div class="w-full flex items-center justify-end gap-2 pt-1">
          <button type="button" @click="copyText(totpQrData.otpauth_url, 'qr_uri', '已复制 otpauth:// 链接')" class="px-3.5 py-2 bg-[#f1f3f4] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">复制 otpauth 链接</button>
          <button type="button" @click="showTotpQrModal = false" class="px-5 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium cursor-pointer">完成</button>
        </div>
      </div>
    </div>

    <!-- CHANGE MASTER PASSWORD MODAL -->
    <div v-if="showChangePwdModal" class="fixed inset-0 z-[9995] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
      <div class="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col gap-4">
        <div class="flex items-center justify-between pb-2 border-b border-[#f1f3f4]">
          <div class="flex items-center gap-2">
            <KeyRound class="w-4 h-4 text-[#1a73e8]" />
            <h3 class="text-sm font-bold text-[#202124]">修改安全库主密码</h3>
          </div>
          <button @click="showChangePwdModal = false" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]"><X class="w-4 h-4" /></button>
        </div>

        <form @submit.prevent="handleChangeMasterPassword" class="space-y-3.5">
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">当前原主密码 *</label>
            <input type="password" required v-model="changePwdForm.oldPassword" placeholder="请输入当前正在使用的主密码..." class="w-full px-3 py-2.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">新主密码 *</label>
            <input type="password" required v-model="changePwdForm.newPassword" placeholder="请输入新的主密码..." class="w-full px-3 py-2.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">确认新主密码 *</label>
            <input type="password" required v-model="changePwdForm.confirmPassword" placeholder="请再次输入新主密码..." class="w-full px-3 py-2.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
          </div>
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#f1f3f4]">
            <button type="button" @click="showChangePwdModal = false" :disabled="isChangingPwd" class="px-4 py-2 bg-[#f1f3f4] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">取消</button>
            <button type="submit" :disabled="isChangingPwd" class="px-5 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
              <RefreshCw v-if="isChangingPwd" class="w-3.5 h-3.5 animate-spin" />
              <span>{{ isChangingPwd ? "正在重新加密..." : "确认修改并重新加密" }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>

  </div>
</template>
