import {
  decryptVaultEnvelope,
  encryptVaultEnvelope,
  generateTotp,
  smartMergeRecords
} from "./crypto_vault.js";

const DEFAULT_PORT = 47291;
const DEFAULT_IDLE_MIN = 30;

const KNOWN_PLATFORM_DOMAINS = [
  [["google", "gmail", "谷歌"], "google.com"],
  [["github"], "github.com"],
  [["microsoft", "outlook", "微软"], "microsoft.com"],
  [["apple", "icloud", "苹果"], "apple.com"],
  [["openai", "chatgpt"], "openai.com"],
  [["claude", "anthropic"], "claude.ai"],
  [["steam"], "steampowered.com"],
  [["discord"], "discord.com"],
  [["twitter"], "x.com"],
  [["bilibili", "b站"], "bilibili.com"],
  [["zhihu", "知乎"], "zhihu.com"],
  [["taobao", "淘宝"], "taobao.com"],
  [["aliyun", "阿里云"], "aliyun.com"],
  [["tencent", "qq", "微信"], "qq.com"]
];

async function getConfig() {
  const data = await chrome.storage.local.get([
    "av_mode",
    "av_port",
    "av_token",
    "av_webdav_url",
    "av_webdav_user",
    "av_webdav_pass",
    "av_idle_minutes",
    "av_keep_unlocked",
    "av_prompt_style"
  ]);
  return {
    mode: data.av_mode === "webdav" ? "webdav" : "bridge",
    port: Number(data.av_port) || DEFAULT_PORT,
    token: (data.av_token || "").trim(),
    webdavUrl: (data.av_webdav_url || "").trim(),
    webdavUser: (data.av_webdav_user || "").trim(),
    webdavPass: data.av_webdav_pass || "",
    idleMinutes: data.av_idle_minutes !== undefined ? Number(data.av_idle_minutes) : DEFAULT_IDLE_MIN,
    keepUnlocked: Boolean(data.av_keep_unlocked),
    promptStyle: data.av_prompt_style === "overlay" ? "overlay" : "window"
  };
}

const pendingPasskeyPrompts = new Map();

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [pid, entry] of pendingPasskeyPrompts.entries()) {
    if (entry.windowId === windowId) {
      pendingPasskeyPrompts.delete(pid);
      entry.resolve({ fallback: true });
      break;
    }
  }
});

function normalizeWebDavFileUrl(baseUrl) {
  const trimmed = (baseUrl || "").trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    throw new Error("WebDAV 地址必须以 http:// 或 https:// 开头");
  }
  const base = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  return `${base}accounts.avault`;
}

function webdavHeaders(cfg) {
  const token = btoa(unescape(encodeURIComponent(`${cfg.webdavUser}:${cfg.webdavPass}`)));
  return {
    Authorization: `Basic ${token}`
  };
}

async function clearPersistedSession() {
  await chrome.storage.local.remove(["av_persisted_session", "av_wrap_jwk"]);
}

async function persistSessionEncrypted(sessObj) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(sessObj))
    )
  );
  await chrome.storage.local.set({
    av_wrap_jwk: jwk,
    av_persisted_session: {
      ivHex: bytesToHex(iv),
      cipherHex: bytesToHex(cipher)
    }
  });
}

async function loadPersistedSessionEncrypted() {
  const data = await chrome.storage.local.get(["av_wrap_jwk", "av_persisted_session"]);
  const jwk = data.av_wrap_jwk;
  const ps = data.av_persisted_session;
  if (!jwk || !ps?.ivHex || !ps?.cipherHex) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(ps.ivHex) },
      key,
      hexToBytes(ps.cipherHex)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

async function saveWebDavSession(sessObj) {
  await chrome.storage.session.set({ av_session: sessObj });
  const data = await chrome.storage.local.get(["av_keep_unlocked"]);
  if (data.av_keep_unlocked) {
    await persistSessionEncrypted(sessObj);
  }
}

async function getWebDavSession(idleMinutes) {
  const sess = await chrome.storage.session.get(["av_session"]);
  let s = sess.av_session;
  if (!s) {
    const data = await chrome.storage.local.get(["av_keep_unlocked"]);
    if (data.av_keep_unlocked) {
      s = await loadPersistedSessionEncrypted();
    }
  }
  if (!s) return null;
  if (idleMinutes > 0 && Date.now() - (s.lastActiveAt || 0) > idleMinutes * 60 * 1000) {
    await chrome.storage.session.remove(["av_session"]);
    await clearPersistedSession();
    return null;
  }
  s.lastActiveAt = Date.now();
  await chrome.storage.session.set({ av_session: s });
  return s;
}

function bytesToHex(u8) {
  return Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derivePinKey(pin, saltBytes) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function savePinVault(pin, masterPassword) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePinKey(pin, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(masterPassword)
    )
  );
  await chrome.storage.local.set({
    av_pin_vault: {
      saltHex: bytesToHex(salt),
      ivHex: bytesToHex(iv),
      cipherHex: bytesToHex(cipher)
    }
  });
}

async function hasPinVault() {
  const data = await chrome.storage.local.get(["av_pin_vault"]);
  return Boolean(data.av_pin_vault?.cipherHex);
}

async function tryDecryptMasterWithPin(pin) {
  const data = await chrome.storage.local.get(["av_pin_vault"]);
  const pv = data.av_pin_vault;
  if (!pv?.saltHex || !pv?.ivHex || !pv?.cipherHex) return null;
  try {
    const key = await derivePinKey(pin, hexToBytes(pv.saltHex));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(pv.ivHex) },
      key,
      hexToBytes(pv.cipherHex)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

async function callBridge(path, options = {}) {
  const { port, token } = await getConfig();
  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const json = await resp.json().catch(() => ({}));
    return { status: resp.status, ok: resp.ok, ...json };
  } catch {
    return { status: 0, ok: false, offline: true, error: "无法连接到桌面端 AccountVault" };
  }
}

function extractHost(rawUrl) {
  const t = (rawUrl || "").trim().toLowerCase();
  if (!t) return "";
  const noScheme = t.replace(/^https?:\/\//, "");
  const hostPort = noScheme.split("/")[0] || "";
  const host = hostPort.split(":")[0] || "";
  return host.replace(/^www\./, "");
}

function registrableDomain(host) {
  const parts = (host || "").split(".").filter(Boolean);
  if (parts.length <= 2) return host || "";
  const last2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  const multiTlds = new Set([
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.uk", "org.uk",
    "co.jp", "ne.jp", "com.hk", "com.tw", "com.au", "co.kr"
  ]);
  if (multiTlds.has(last2) && parts.length >= 3) {
    return `${parts[parts.length - 3]}.${last2}`;
  }
  return last2;
}

function hostsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)) return true;
  const ra = registrableDomain(a);
  const rb = registrableDomain(b);
  return Boolean(ra && ra === rb);
}

function domainMatches(rec, targetHost) {
  if (!targetHost) return false;
  const recHost = extractHost(rec.login_url);
  if (hostsMatch(recHost, targetHost)) {
    return true;
  }
  for (const pk of rec.passkeys || []) {
    if (hostsMatch(extractHost(pk.rp_id), targetHost)) return true;
  }
  const titleLower = (rec.title || "").trim().toLowerCase();
  for (const [keys, domain] of KNOWN_PLATFORM_DOMAINS) {
    if (keys.some((k) => titleLower.includes(k))) {
      if (hostsMatch(domain, targetHost)) return true;
    }
  }
  const baseLabel = targetHost.split(".")[0] || "";
  if (baseLabel.length >= 3 && titleLower.length >= 3) {
    if (titleLower.includes(baseLabel) || baseLabel.includes(titleLower)) return true;
  }
  return false;
}

async function toDto(rec) {
  let totp_code = "";
  let totp_remaining = 0;
  const has_totp = Boolean(rec.totp && rec.totp.trim());
  if (has_totp) {
    const res = await generateTotp(rec.totp);
    totp_code = res.code;
    totp_remaining = res.remaining;
  }
  const account = (rec.username || "").trim() || (rec.email || "").trim();
  const title = (rec.title || "").trim() || extractHost(rec.login_url) || "未命名";
  return {
    id: rec.id,
    title,
    account,
    password: rec.password || "",
    login_url: rec.login_url || "",
    has_totp,
    totp_code,
    totp_remaining,
    passkeys_count: (rec.passkeys || []).length
  };
}

async function fetchWebDavRecords(cfg, masterPassword) {
  const fileUrl = normalizeWebDavFileUrl(cfg.webdavUrl);
  const resp = await fetch(fileUrl, {
    method: "GET",
    headers: webdavHeaders(cfg)
  });
  if (resp.status === 401) {
    throw new Error("WebDAV 认证失败 (401)，请检查账号与密码");
  }
  if (resp.status === 404) {
    throw new Error("云端未找到 accounts.avault，请先从桌面端或手机端上传一次");
  }
  if (!resp.ok) {
    throw new Error(`WebDAV 读取失败 (HTTP ${resp.status})`);
  }
  const blobText = await resp.text();
  const decrypted = await decryptVaultEnvelope(blobText, masterPassword);
  const etag = resp.headers.get("etag") || "";
  const lastMod = resp.headers.get("last-modified") || "";
  const contentLen = resp.headers.get("content-length") || "";
  return { ...decrypted, etag, versionTag: `${etag}|${lastMod}|${contentLen}` };
}

let syncInFlight = null;

async function syncWebDavSessionIfChanged(cfg, sess, force = false) {
  if (!sess || !sess.masterPassword) return sess;
  const now = Date.now();
  if (!force && now - (sess.lastSyncedAt || 0) < 15000) {
    return sess;
  }
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      const fileUrl = normalizeWebDavFileUrl(cfg.webdavUrl);
      if (!force && sess.versionTag) {
        const headResp = await fetch(fileUrl, { method: "HEAD", headers: webdavHeaders(cfg) });
        if (headResp.ok) {
          const etag = headResp.headers.get("etag") || "";
          const lastMod = headResp.headers.get("last-modified") || "";
          const contentLen = headResp.headers.get("content-length") || "";
          const curTag = `${etag}|${lastMod}|${contentLen}`;
          if (curTag && curTag !== "||" && curTag === sess.versionTag) {
            sess.lastSyncedAt = Date.now();
            await saveWebDavSession(sess);
            return sess;
          }
        }
      }

      const remote = await fetchWebDavRecords(cfg, sess.masterPassword);
      const merged = smartMergeRecords(sess.records, remote.records);
      sess.records = merged;
      sess.keyHex = remote.keyHex;
      sess.saltHex = remote.saltHex;
      sess.versionTag = remote.versionTag;
      sess.lastSyncedAt = Date.now();
      await saveWebDavSession(sess);
      return sess;
    } catch {
      return sess;
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

if (chrome.alarms) {
  chrome.alarms.create("av_webdav_sync", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== "av_webdav_sync") return;
    const cfg = await getConfig();
    if (cfg.mode !== "webdav") return;
    const sess = await getWebDavSession(cfg.idleMinutes);
    if (sess) {
      await syncWebDavSessionIfChanged(cfg, sess, false);
    }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const cfg = await getConfig();

    if (msg.type === "GET_CONFIG") {
      sendResponse(cfg);
      return;
    }

    if (msg.type === "SET_CONFIG") {
      const keepUnlocked = Boolean(msg.keepUnlocked);
      await chrome.storage.local.set({
        av_mode: msg.mode === "webdav" ? "webdav" : "bridge",
        av_port: Number(msg.port) || DEFAULT_PORT,
        av_token: (msg.token || "").trim(),
        av_webdav_url: (msg.webdavUrl || "").trim(),
        av_webdav_user: (msg.webdavUser || "").trim(),
        av_webdav_pass: msg.webdavPass !== undefined ? msg.webdavPass : cfg.webdavPass,
        av_idle_minutes: msg.idleMinutes !== undefined ? Number(msg.idleMinutes) : cfg.idleMinutes,
        av_keep_unlocked: keepUnlocked,
        av_prompt_style: msg.promptStyle === "overlay" ? "overlay" : "window"
      });
      if (!keepUnlocked) {
        await clearPersistedSession();
      } else {
        const cur = await chrome.storage.session.get(["av_session"]);
        if (cur.av_session) {
          await persistSessionEncrypted(cur.av_session);
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "OPEN_PASSKEY_PROMPT") {
      const promptId = crypto.randomUUID();
      const width = 420;
      const height = msg.kind === "get" ? Math.min(440, 220 + (msg.items?.length || 1) * 62) : 290;
      let left;
      let top;
      try {
        const win = await chrome.windows.getLastFocused();
        if (win && win.left !== undefined && win.top !== undefined && win.width && win.height) {
          left = Math.max(0, Math.round(win.left + (win.width - width) / 2));
          top = Math.max(0, Math.round(win.top + (win.height - height) / 2));
        }
      } catch {}

      const result = await new Promise(async (resolve) => {
        const entry = {
          prompt: {
            kind: msg.kind,
            rpId: msg.rpId || "",
            rpName: msg.rpName || "",
            userName: msg.userName || "",
            userDisplayName: msg.userDisplayName || "",
            isCrossPlatform: !!msg.isCrossPlatform,
            items: msg.items || []
          },
          windowId: null,
          resolve
        };
        pendingPasskeyPrompts.set(promptId, entry);
        try {
          const created = await chrome.windows.create({
            url: chrome.runtime.getURL(`passkey_prompt.html?id=${encodeURIComponent(promptId)}`),
            type: "popup",
            width,
            height,
            left,
            top,
            focused: true
          });
          entry.windowId = created?.id ?? null;
        } catch {
          pendingPasskeyPrompts.delete(promptId);
          resolve({ fallback: true });
        }
      });
      sendResponse(result);
      return;
    }

    if (msg.type === "GET_PASSKEY_PROMPT") {
      const entry = pendingPasskeyPrompts.get(msg.promptId);
      sendResponse(entry ? { ok: true, prompt: entry.prompt } : { ok: false });
      return;
    }

    if (msg.type === "PASSKEY_PROMPT_RESULT") {
      const entry = pendingPasskeyPrompts.get(msg.promptId);
      if (entry) {
        pendingPasskeyPrompts.delete(msg.promptId);
        entry.resolve(msg.result || { fallback: true });
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "TEST_WEBDAV") {
      try {
        const testCfg = {
          webdavUrl: msg.webdavUrl || cfg.webdavUrl,
          webdavUser: msg.webdavUser || cfg.webdavUser,
          webdavPass: msg.webdavPass !== undefined ? msg.webdavPass : cfg.webdavPass
        };
        const fileUrl = normalizeWebDavFileUrl(testCfg.webdavUrl);
        const resp = await fetch(fileUrl, { method: "HEAD", headers: webdavHeaders(testCfg) });
        if (resp.status === 401) {
          sendResponse({ ok: false, error: "身份验证失败 (HTTP 401)" });
        } else if (resp.ok || resp.status === 404) {
          sendResponse({
            ok: true,
            message: resp.status === 404 ? "连接成功（云端暂无备份文件）" : "WebDAV 连接正常"
          });
        } else {
          sendResponse({ ok: false, error: `WebDAV 返回状态 HTTP ${resp.status}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: `连接失败: ${e?.message || e}` });
      }
      return;
    }

    if (msg.type === "UNLOCK_WEBDAV") {
      try {
        const rawInput = msg.masterPassword || "";
        const decryptedFromPin = await tryDecryptMasterWithPin(rawInput);
        const realMaster = decryptedFromPin !== null ? decryptedFromPin : rawInput;
        const res = await fetchWebDavRecords(cfg, realMaster);
        await saveWebDavSession({
          records: res.records,
          keyHex: res.keyHex,
          saltHex: res.saltHex,
          masterPassword: realMaster,
          versionTag: res.versionTag || "",
          lastSyncedAt: Date.now(),
          lastActiveAt: Date.now()
        });
        sendResponse({ ok: true, count: res.records.filter((r) => !r.deleted_at).length });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
      return;
    }

    if (msg.type === "SET_WEBDAV_PIN") {
      const pin = (msg.pin || "").trim();
      if (!pin) {
        await chrome.storage.local.remove(["av_pin_vault"]);
        sendResponse({ ok: true, hasPin: false });
        return;
      }
      const sess = await getWebDavSession(cfg.idleMinutes);
      if (!sess || !sess.masterPassword) {
        sendResponse({ ok: false, error: "请先解锁保险库后再设置快捷 PIN 码" });
        return;
      }
      await savePinVault(pin, sess.masterPassword);
      sendResponse({ ok: true, hasPin: true });
      return;
    }

    if (msg.type === "FOCUS_BRIDGE") {
      const res = await callBridge("/api/focus", { method: "POST" });
      sendResponse(res);
      return;
    }

    if (msg.type === "LOCK_WEBDAV") {
      await chrome.storage.session.remove(["av_session"]);
      await clearPersistedSession();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SYNC_WEBDAV") {
      const sess = await getWebDavSession(cfg.idleMinutes);
      if (!sess) {
        sendResponse({ ok: false, locked: true, error: "请先输入主密码解锁" });
        return;
      }
      try {
        const updated = await syncWebDavSessionIfChanged(cfg, sess, true);
        sendResponse({ ok: true, count: updated.records.filter((r) => !r.deleted_at).length });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
      return;
    }

    if (msg.type === "GET_STATUS") {
      if (cfg.mode === "webdav") {
        if (!cfg.webdavUrl || !cfg.webdavUser || !cfg.webdavPass) {
          sendResponse({ ok: true, mode: "webdav", needWebDavConfig: true });
          return;
        }
        let sess = await getWebDavSession(cfg.idleMinutes);
        if (sess) {
          sess = await syncWebDavSessionIfChanged(cfg, sess, false);
        }
        sendResponse({
          ok: true,
          mode: "webdav",
          unlocked: Boolean(sess),
          locked: !sess,
          hasPin: await hasPinVault(),
          count: sess ? sess.records.filter((r) => !r.deleted_at).length : 0
        });
        return;
      }

      const ping = await callBridge("/api/ping");
      if (!ping.ok) {
        sendResponse({ ...ping, mode: "bridge" });
        return;
      }
      if (!cfg.token) {
        sendResponse({ ...ping, mode: "bridge", needToken: true });
        return;
      }
      const authTest = await callBridge("/api/accounts?q=__ping__");
      sendResponse({
        ...ping,
        mode: "bridge",
        authorized: authTest.status !== 401,
        locked: authTest.status === 423 || !ping.unlocked
      });
      return;
    }

    if (msg.type === "MATCH_CREDENTIALS") {
      if (cfg.mode === "webdav") {
        let sess = await getWebDavSession(cfg.idleMinutes);
        if (!sess) {
          sendResponse({
            ok: false,
            mode: "webdav",
            locked: true,
            hasPin: await hasPinVault(),
            error: "WebDAV 保险库已锁定，请解锁后填充"
          });
          return;
        }
        sess = await syncWebDavSessionIfChanged(cfg, sess, false);
        const targetHost = extractHost(msg.domain || msg.url || "");
        const matched = sess.records.filter((r) => !r.deleted_at && domainMatches(r, targetHost));
        const items = await Promise.all(matched.map(toDto));
        sendResponse({ ok: true, mode: "webdav", domain: targetHost, items });
        return;
      }

      const res = await callBridge("/api/match", {
        method: "POST",
        body: { url: msg.url || "", domain: msg.domain || "" }
      });
      sendResponse({ mode: "bridge", ...res });
      return;
    }

    if (msg.type === "SEARCH_ACCOUNTS") {
      if (cfg.mode === "webdav") {
        const sess = await getWebDavSession(cfg.idleMinutes);
        if (!sess) {
          sendResponse({ ok: false, mode: "webdav", locked: true });
          return;
        }
        const q = (msg.query || "").trim().toLowerCase();
        const filtered = sess.records
          .filter((r) => {
            if (r.deleted_at) return false;
            if (!q) return true;
            return (
              (r.title || "").toLowerCase().includes(q) ||
              (r.username || "").toLowerCase().includes(q) ||
              (r.email || "").toLowerCase().includes(q) ||
              (r.login_url || "").toLowerCase().includes(q)
            );
          })
          .slice(0, 50);
        const items = await Promise.all(filtered.map(toDto));
        sendResponse({ ok: true, mode: "webdav", items });
        return;
      }

      const q = encodeURIComponent(msg.query || "");
      const res = await callBridge(`/api/accounts?q=${q}`);
      sendResponse(res);
      return;
    }

    if (msg.type === "SAVE_CREDENTIAL") {
      if (cfg.mode === "webdav") {
        const sess = await getWebDavSession(cfg.idleMinutes);
        if (!sess) {
          sendResponse({ ok: false, locked: true, error: "WebDAV 保险库已锁定，请先解锁后再保存" });
          return;
        }
        try {
          // Pull latest remote first to avoid overwriting mobile/desktop edits
          let baseRecords = sess.records;
          let keyHex = sess.keyHex;
          let saltHex = sess.saltHex;
          try {
            const remote = await fetchWebDavRecords(cfg, sess.masterPassword);
            baseRecords = smartMergeRecords(sess.records, remote.records);
            keyHex = remote.keyHex;
            saltHex = remote.saltHex;
          } catch {
            // If remote 404 or temporary offline, merge against session copy
          }

          const account = (msg.account || "").trim();
          const password = msg.password || "";
          const host = extractHost(msg.url || "");
          const now = Math.floor(Date.now() / 1000);

          const existingIdx = baseRecords.findIndex((r) => {
            if (r.deleted_at) return false;
            const idf = ((r.username || "").trim() || (r.email || "").trim()).toLowerCase();
            return idf === account.toLowerCase() && (!host || domainMatches(r, host));
          });

          if (existingIdx >= 0) {
            baseRecords[existingIdx].password = password;
            baseRecords[existingIdx].updated_at = now;
            if (!baseRecords[existingIdx].login_url && msg.url) {
              baseRecords[existingIdx].login_url = msg.url;
            }
          } else {
            const isEmail = account.includes("@");
            baseRecords.push({
              id: crypto.randomUUID(),
              title: (msg.title || "").trim() || host || "网页账号",
              login_url: (msg.url || "").trim(),
              username: isEmail ? "" : account,
              email: isEmail ? account : "",
              password,
              group: "浏览器保存",
              recovery_email: "",
              phone: "",
              totp: "",
              backup_codes: "",
              used_backup_codes: "",
              notes: "",
              plan: "",
              status: "",
              is_pinned: false,
              expire_at: "",
              proxy: "",
              created_at: now,
              updated_at: now,
              deleted_at: null
            });
          }

          const encryptedBlob = await encryptVaultEnvelope(baseRecords, keyHex, saltHex);
          const fileUrl = normalizeWebDavFileUrl(cfg.webdavUrl);
          const putResp = await fetch(fileUrl, {
            method: "PUT",
            headers: {
              ...webdavHeaders(cfg),
              "Content-Type": "application/octet-stream"
            },
            body: encryptedBlob
          });
          if (!putResp.ok) {
            throw new Error(`上传 WebDAV 失败 (HTTP ${putResp.status})`);
          }

          sess.records = baseRecords;
          sess.keyHex = keyHex;
          sess.saltHex = saltHex;
          sess.lastActiveAt = Date.now();
          await saveWebDavSession(sess);

          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        return;
      }

      const res = await callBridge("/api/save", {
        method: "POST",
        body: {
          title: msg.title || "",
          url: msg.url || "",
          account: msg.account || "",
          password: msg.password || ""
        }
      });
      sendResponse(res);
      return;
    }

    if (msg.type === "MATCH_PASSKEYS") {
      if (cfg.mode === "webdav") {
        let sess = await getWebDavSession(cfg.idleMinutes);
        if (!sess) {
          sendResponse({ ok: false, locked: true, items: [] });
          return;
        }
        sess = await syncWebDavSessionIfChanged(cfg, sess, false);
        const rpHost = extractHost(msg.rpId || "");
        const allowIds = msg.allowIds || [];
        const items = [];
        for (const rec of sess.records.filter((r) => !r.deleted_at)) {
          for (const pk of rec.passkeys || []) {
            const pkHost = extractHost(pk.rp_id);
            const domainOk = rpHost && hostsMatch(pkHost, rpHost);
            const allowOk = allowIds.length === 0 || allowIds.includes(pk.credential_id);
            if (domainOk && allowOk) {
              items.push({
                record_id: rec.id,
                title: (rec.title || "").trim() || pk.rp_name || pk.rp_id,
                ...pk
              });
            }
          }
        }
        sendResponse({ ok: true, items });
        return;
      }

      const res = await callBridge("/api/passkeys/match", {
        method: "POST",
        body: { rp_id: msg.rpId || "", allow_ids: msg.allowIds || [] }
      });
      sendResponse(res);
      return;
    }

    if (msg.type === "SAVE_PASSKEY") {
      if (cfg.mode === "webdav") {
        const sess = await getWebDavSession(cfg.idleMinutes);
        if (!sess) {
          sendResponse({ ok: false, locked: true });
          return;
        }
        try {
          let baseRecords = sess.records;
          let keyHex = sess.keyHex;
          let saltHex = sess.saltHex;
          try {
            const remote = await fetchWebDavRecords(cfg, sess.masterPassword);
            baseRecords = smartMergeRecords(sess.records, remote.records);
            keyHex = remote.keyHex;
            saltHex = remote.saltHex;
          } catch {}

          const now = Math.floor(Date.now() / 1000);
          const rpHost = extractHost(msg.rpId || "");
          const newPk = {
            credential_id: msg.credentialId,
            rp_id: msg.rpId,
            rp_name: msg.rpName || "",
            user_id: msg.userId || "",
            user_name: msg.userName || "",
            user_display_name: msg.userDisplayName || "",
            private_key_jwk: msg.privateKeyJwk,
            public_key_spki: msg.publicKeySpki || "",
            sign_count: 0,
            created_at: now
          };

          const existingIdx = baseRecords.findIndex((r) => {
            if (r.deleted_at) return false;
            const idf = ((r.username || "").trim() || (r.email || "").trim()).toLowerCase();
            return domainMatches(r, rpHost) && (!msg.userName || idf === msg.userName.trim().toLowerCase());
          });

          if (existingIdx >= 0) {
            const list = (baseRecords[existingIdx].passkeys || []).filter(
              (p) => p.credential_id !== newPk.credential_id
            );
            list.push(newPk);
            baseRecords[existingIdx].passkeys = list;
            baseRecords[existingIdx].updated_at = now;
          } else {
            const uname = (msg.userName || "").trim();
            const isEmail = uname.includes("@");
            baseRecords.push({
              id: crypto.randomUUID(),
              title: (msg.rpName || "").trim() || rpHost,
              login_url: (msg.url || "").trim() || `https://${rpHost}`,
              username: isEmail ? "" : uname,
              email: isEmail ? uname : "",
              password: "",
              group: "Passkey 通行密钥",
              recovery_email: "",
              phone: "",
              totp: "",
              backup_codes: "",
              used_backup_codes: "",
              notes: "",
              plan: "",
              status: "",
              is_pinned: false,
              expire_at: "",
              proxy: "",
              passkeys: [newPk],
              created_at: now,
              updated_at: now,
              deleted_at: null
            });
          }

          const encryptedBlob = await encryptVaultEnvelope(baseRecords, keyHex, saltHex);
          const putResp = await fetch(normalizeWebDavFileUrl(cfg.webdavUrl), {
            method: "PUT",
            headers: {
              ...webdavHeaders(cfg),
              "Content-Type": "application/octet-stream"
            },
            body: encryptedBlob
          });
          if (!putResp.ok) throw new Error(`HTTP ${putResp.status}`);

          sess.records = baseRecords;
          sess.keyHex = keyHex;
          sess.saltHex = saltHex;
          sess.lastActiveAt = Date.now();
          await saveWebDavSession(sess);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        return;
      }

      const res = await callBridge("/api/passkeys/save", {
        method: "POST",
        body: {
          rp_id: msg.rpId || "",
          rp_name: msg.rpName || "",
          user_id: msg.userId || "",
          user_name: msg.userName || "",
          user_display_name: msg.userDisplayName || "",
          credential_id: msg.credentialId || "",
          private_key_jwk: msg.privateKeyJwk || "",
          public_key_spki: msg.publicKeySpki || "",
          url: msg.url || ""
        }
      });
      sendResponse(res);
      return;
    }

    if (msg.type === "BUMP_PASSKEY") {
      if (cfg.mode === "webdav") {
        const sess = await getWebDavSession(cfg.idleMinutes);
        if (sess) {
          for (const rec of sess.records) {
            const pk = (rec.passkeys || []).find((p) => p.credential_id === msg.credentialId);
            if (pk) {
              pk.sign_count = msg.signCount || (pk.sign_count || 0) + 1;
              rec.updated_at = Math.floor(Date.now() / 1000);
              break;
            }
          }
          await saveWebDavSession(sess);
        }
        sendResponse({ ok: true });
        return;
      }

      await callBridge("/api/passkeys/bump", {
        method: "POST",
        body: { credential_id: msg.credentialId || "", sign_count: msg.signCount || 1 }
      });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })();
  return true;
});
