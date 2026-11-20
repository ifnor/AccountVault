import type { AccountRecord } from "../types/vault";

export const ACCOUNT_STATUS_OPTIONS = [
  "正常",
  "待录入",
  "异常",
  "封禁",
  "停用"
];

export const KNOWN_PLATFORM_DOMAINS: Record<string, string> = {
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

export function getPrimaryIdentifier(r: AccountRecord): string {
  return (r.username || "").trim() || (r.email || "").trim();
}

export function getDisplayTitle(r: AccountRecord): string {
  return (r.title || "").trim() || (r.group || "").trim() || "未命名平台";
}

export function getSessionKey(r: AccountRecord): string {
  return r.id || `${getDisplayTitle(r)}::${getPrimaryIdentifier(r)}`;
}

export function getRecordDomain(r: AccountRecord): string {
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

export function getStatusBadgeClass(status?: string): string {
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

export function getExpireDaysLeft(expireAt?: string): number | null {
  if (!expireAt || !expireAt.trim()) return null;
  const parts = expireAt.trim().split("-");
  if (parts.length !== 3) return null;
  const target = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  return Math.floor((target.getTime() - todayStart.getTime()) / (1000 * 3600 * 24));
}

export function isExpiringSoon(expireAt?: string): boolean {
  const days = getExpireDaysLeft(expireAt);
  return days !== null && days <= 7;
}

export function getExpireBadge(expireAt?: string): { label: string; class: string; urgent: boolean } | null {
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
