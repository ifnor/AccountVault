export interface ImportedAccountRecord {
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
}

export interface ImportParseResult {
  formatLabel: string;
  records: ImportedAccountRecord[];
}

/**
 * RFC 4180 compliant CSV parser supporting quoted fields, escaped quotes (""),
 * embedded newlines inside quotes, and UTF-8 BOM.
 */
export function parseCsvMatrix(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\r") {
        if (i + 1 < text.length && text[i + 1] === "\n") {
          i++;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function extractDomainTitle(rawUrl: string): string {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return "";
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(normalized).hostname.replace(/^www\./i, "");
    return host;
  } catch {
    return "";
  }
}

function parseBoolFlag(val: string): boolean {
  const v = (val || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "是";
}

function detectCsvFormat(headersLower: string[]): string {
  const set = new Set(headersLower);
  if (set.has("login_uri") && set.has("login_username")) return "Bitwarden CSV";
  if (set.has("formactionorigin") && set.has("httprealm")) return "Firefox CSV";
  if (set.has("otpauth") && set.has("title") && set.has("url")) return "Safari / 1Password CSV";
  if (set.has("平台名称") && set.has("登录账号")) return "AccountVault CSV";
  if (set.has("邮箱") && set.has("登录密码") && set.has("totp密钥")) return "GoogleAccountVault CSV";
  if (set.has("name") && set.has("url") && set.has("username") && set.has("password")) {
    return "Chrome / Edge CSV";
  }
  if (set.has("group") && set.has("title") && set.has("username")) return "KeePass CSV";
  return "通用 CSV 表格";
}

function findColumnIndex(headersLower: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headersLower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseCsvImport(rawText: string): ImportParseResult {
  const matrix = parseCsvMatrix(rawText);
  if (matrix.length < 2) {
    return { formatLabel: "CSV", records: [] };
  }

  const headersLower = matrix[0].map((h) => h.trim().toLowerCase());
  const formatLabel = detectCsvFormat(headersLower);

  const idxTitle = findColumnIndex(headersLower, [
    "平台名称", "平台", "名称", "网站名称", "name", "title", "service", "platform"
  ]);
  const idxUrl = findColumnIndex(headersLower, [
    "登录网址", "网址", "链接", "url", "login_uri", "uri", "website", "web site", "formactionorigin"
  ]);
  const idxUser = findColumnIndex(headersLower, [
    "登录账号", "账号", "用户名", "username", "login_username", "login name", "user", "login", "account"
  ]);
  const idxEmail = findColumnIndex(headersLower, [
    "绑定邮箱", "邮箱", "email", "e-mail"
  ]);
  const idxPwd = findColumnIndex(headersLower, [
    "登录密码", "密码", "password", "login_password", "pass", "pwd"
  ]);
  const idxTotp = findColumnIndex(headersLower, [
    "totp密钥", "totp", "login_totp", "otpauth", "otp", "2fa"
  ]);
  const idxGroup = findColumnIndex(headersLower, [
    "分组", "folder", "group", "category"
  ]);
  const idxNotes = findColumnIndex(headersLower, [
    "备注", "notes", "note", "comments", "comment"
  ]);
  const idxPinned = findColumnIndex(headersLower, [
    "置顶", "favorite", "pinned", "is_pinned"
  ]);
  const idxStatus = findColumnIndex(headersLower, [
    "账号状态", "status"
  ]);
  const idxPlan = findColumnIndex(headersLower, [
    "会员/套餐", "套餐", "plan", "google one方案"
  ]);
  const idxPhone = findColumnIndex(headersLower, [
    "绑定手机", "恢复手机", "phone"
  ]);
  const idxRecovery = findColumnIndex(headersLower, [
    "恢复邮箱/密保", "恢复邮箱", "recovery_email"
  ]);
  const idxExpire = findColumnIndex(headersLower, [
    "到期日期", "expire_at"
  ]);
  const idxProxy = findColumnIndex(headersLower, [
    "独立代理", "proxy"
  ]);
  const idxBackup = findColumnIndex(headersLower, [
    "备用验证码", "backup_codes"
  ]);
  const idxUsedBackup = findColumnIndex(headersLower, [
    "已用备用码", "used_backup_codes"
  ]);

  const records: ImportedAccountRecord[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const get = (idx: number) => (idx >= 0 && idx < row.length ? row[idx].trim() : "");

    // Skip Firefox internal sync/empty rows if both user & pwd are empty
    const rawUrl = get(idxUrl);
    const rawUser = get(idxUser);
    const rawEmail = get(idxEmail);
    const rawPwd = get(idxPwd);
    const rawTitle = get(idxTitle);

    if (!rawUser && !rawEmail && !rawPwd && !rawTitle && !rawUrl) {
      continue;
    }

    const derivedTitle = rawTitle || extractDomainTitle(rawUrl) || "导入账号";
    const username = rawUser || rawEmail;

    records.push({
      id: "",
      title: derivedTitle,
      login_url: rawUrl,
      username,
      email: rawEmail,
      password: rawPwd,
      group: get(idxGroup),
      status: get(idxStatus) || "正常",
      plan: get(idxPlan),
      is_pinned: idxPinned >= 0 ? parseBoolFlag(get(idxPinned)) : false,
      expire_at: get(idxExpire),
      proxy: get(idxProxy),
      recovery_email: get(idxRecovery),
      phone: get(idxPhone),
      totp: get(idxTotp),
      backup_codes: get(idxBackup),
      used_backup_codes: get(idxUsedBackup) || "[]",
      notes: get(idxNotes)
    });
  }

  return { formatLabel, records };
}

export function parseJsonImport(rawText: string): ImportParseResult {
  const parsed = JSON.parse(rawText);

  // 1. Bitwarden JSON format: { items: [...], folders?: [...] }
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.items)) {
    if (parsed.encrypted === true) {
      throw new Error("检测到加密的 Bitwarden JSON，请先在 Bitwarden 中导出未加密的 JSON 或 CSV 文件");
    }
    const folderMap = new Map<string, string>();
    if (Array.isArray(parsed.folders)) {
      for (const f of parsed.folders) {
        if (f && f.id && f.name) {
          folderMap.set(String(f.id), String(f.name));
        }
      }
    }

    const records: ImportedAccountRecord[] = [];
    for (const item of parsed.items) {
      if (!item || (item.type !== undefined && item.type !== 1 && !item.login)) {
        continue;
      }
      const login = item.login || {};
      const firstUri =
        Array.isArray(login.uris) && login.uris.length > 0
          ? String(login.uris[0]?.uri || "")
          : "";
      const username = String(login.username || "").trim();
      const password = String(login.password || "");
      const totp = String(login.totp || "").trim();
      const title = String(item.name || "").trim() || extractDomainTitle(firstUri) || "Bitwarden 账号";
      const group = item.folderId ? folderMap.get(String(item.folderId)) || "" : "";

      if (!username && !password && !firstUri) continue;

      records.push({
        id: "",
        title,
        login_url: firstUri,
        username,
        email: username.includes("@") ? username : "",
        password,
        group,
        status: "正常",
        is_pinned: Boolean(item.favorite),
        totp,
        notes: String(item.notes || "")
      });
    }
    return { formatLabel: "Bitwarden JSON", records };
  }

  // 2. Array of AccountVault / GoogleAccountVault / generic objects
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.records)
    ? parsed.records
    : Array.isArray(parsed?.accounts)
    ? parsed.accounts
    : null;

  if (!list) {
    throw new Error("无法识别的 JSON 文件结构");
  }

  const isLegacyGvault = list.some(
    (item: any) => item && ("google_one_plan" in item || "antigravity_status" in item)
  );

  const records: ImportedAccountRecord[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const loginUrl = String(item.login_url || item.url || item.website || "").trim();
    const email = String(item.email || "").trim();
    const username = String(item.username || email || "").trim();
    const title =
      String(item.title || item.name || "").trim() ||
      (isLegacyGvault ? "Google" : extractDomainTitle(loginUrl)) ||
      "导入账号";

    if (!username && !email && !item.password) continue;

    records.push({
      id: "",
      title,
      login_url: loginUrl || (isLegacyGvault ? "https://accounts.google.com" : ""),
      username,
      email,
      password: String(item.password || ""),
      group: String(item.group || item.folder || ""),
      status: String(item.status || "正常"),
      plan: String(item.plan || (item.google_one_plan && item.google_one_plan !== "Free" ? item.google_one_plan : "") || ""),
      is_pinned: Boolean(item.is_pinned || item.favorite),
      expire_at: String(item.expire_at || ""),
      proxy: String(item.proxy || ""),
      recovery_email: String(item.recovery_email || ""),
      phone: String(item.phone || ""),
      totp: String(item.totp || ""),
      backup_codes: String(item.backup_codes || ""),
      used_backup_codes: String(item.used_backup_codes || "[]"),
      notes: String(item.notes || "")
    });
  }

  return {
    formatLabel: isLegacyGvault ? "GoogleAccountVault JSON" : "AccountVault / 通用 JSON",
    records
  };
}
