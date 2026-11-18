const statusBadge = document.getElementById("status-badge");
const settingsPanel = document.getElementById("settings-panel");
const toggleSettingsBtn = document.getElementById("toggle-settings");
const syncBtn = document.getElementById("sync-btn");
const lockBtn = document.getElementById("lock-btn");

const modeBridgeBtn = document.getElementById("mode-bridge-btn");
const modeWebDavBtn = document.getElementById("mode-webdav-btn");
const styleWindowBtn = document.getElementById("style-window-btn");
const styleOverlayBtn = document.getElementById("style-overlay-btn");
const bridgeFields = document.getElementById("bridge-fields");
const webdavFields = document.getElementById("webdav-fields");

const portInput = document.getElementById("port-input");
const tokenInput = document.getElementById("token-input");
const davUrlInput = document.getElementById("dav-url-input");
const davUserInput = document.getElementById("dav-user-input");
const davPassInput = document.getElementById("dav-pass-input");
const idleInput = document.getElementById("idle-input");
const davTestMsg = document.getElementById("dav-test-msg");
const testDavBtn = document.getElementById("test-dav-btn");
const saveConfigBtn = document.getElementById("save-config");

const unlockPanel = document.getElementById("unlock-panel");
const masterPwdInput = document.getElementById("master-pwd-input");
const unlockErr = document.getElementById("unlock-err");
const unlockBtn = document.getElementById("unlock-btn");

const mainPanel = document.getElementById("main-panel");
const searchInput = document.getElementById("search-input");
const sectionLabel = document.getElementById("section-label");
const listEl = document.getElementById("list");

let currentTab = null;
let editingMode = "bridge";
let editingPromptStyle = "window";

function sendBg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function setPromptStyleUI(style) {
  editingPromptStyle = style === "overlay" ? "overlay" : "window";
  styleWindowBtn.classList.toggle("active", editingPromptStyle === "window");
  styleOverlayBtn.classList.toggle("active", editingPromptStyle === "overlay");
}

function setModeUI(mode) {
  editingMode = mode === "webdav" ? "webdav" : "bridge";
  modeBridgeBtn.classList.toggle("active", editingMode === "bridge");
  modeWebDavBtn.classList.toggle("active", editingMode === "webdav");
  bridgeFields.classList.toggle("hidden", editingMode !== "bridge");
  webdavFields.classList.toggle("hidden", editingMode !== "webdav");
  testDavBtn.classList.toggle("hidden", editingMode !== "webdav");
}

async function ensureHostPermission(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    const originPattern = `${u.protocol}//${u.host}/*`;
    const granted = await chrome.permissions.contains({ origins: [originPattern] });
    if (granted) return true;
    return await chrome.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}

function renderItems(items, emptyText) {
  listEl.innerHTML = "";
  if (!items || items.length === 0) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = emptyText;
    listEl.appendChild(d);
    return;
  }

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = item.title || "未命名";

    const sub = document.createElement("div");
    sub.className = "card-sub";
    sub.textContent = item.account || "";

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const fillBtn = document.createElement("button");
    fillBtn.className = "btn primary";
    fillBtn.textContent = "填充";
    fillBtn.onclick = async () => {
      if (currentTab?.id) {
        chrome.tabs.sendMessage(currentTab.id, {
          type: "FILL_FROM_POPUP",
          account: item.account,
          password: item.password
        });
        window.close();
      }
    };
    actions.appendChild(fillBtn);

    const copyPwdBtn = document.createElement("button");
    copyPwdBtn.className = "btn";
    copyPwdBtn.textContent = "复制密码";
    copyPwdBtn.onclick = async () => {
      await navigator.clipboard.writeText(item.password || "");
      copyPwdBtn.textContent = "已复制";
      setTimeout(() => (copyPwdBtn.textContent = "复制密码"), 1200);
    };
    actions.appendChild(copyPwdBtn);

    if (item.passkeys_count > 0) {
      const pkBadge = document.createElement("span");
      pkBadge.className = "btn";
      pkBadge.style.cursor = "default";
      pkBadge.textContent = `🔑 Passkey (${item.passkeys_count})`;
      actions.appendChild(pkBadge);
    }

    if (item.totp_code) {
      const fillTotpBtn = document.createElement("button");
      fillTotpBtn.className = "btn";
      fillTotpBtn.textContent = `填入 2FA: ${item.totp_code}`;
      fillTotpBtn.onclick = async () => {
        if (currentTab?.id) {
          chrome.tabs.sendMessage(currentTab.id, {
            type: "FILL_TOTP_FROM_POPUP",
            code: item.totp_code
          });
        }
        await navigator.clipboard.writeText(item.totp_code);
        fillTotpBtn.textContent = "已填入/复制";
        setTimeout(() => (fillTotpBtn.textContent = `填入 2FA: ${item.totp_code}`), 1200);
      };
      actions.appendChild(fillTotpBtn);
    }

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(actions);
    listEl.appendChild(card);
  }
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;

  const st = await sendBg({ type: "GET_STATUS" });

  syncBtn.classList.add("hidden");
  lockBtn.classList.add("hidden");
  unlockPanel.classList.add("hidden");
  mainPanel.classList.remove("hidden");

  if (st.mode === "webdav") {
    if (st.needWebDavConfig) {
      statusBadge.textContent = "WebDAV 未配置";
      statusBadge.className = "status err";
      settingsPanel.classList.remove("hidden");
      mainPanel.classList.add("hidden");
      return;
    }
    if (st.locked || !st.unlocked) {
      statusBadge.textContent = "WebDAV 云端模式 · 已锁定";
      statusBadge.className = "status err";
      unlockPanel.classList.remove("hidden");
      mainPanel.classList.add("hidden");
      return;
    }
    statusBadge.textContent = `WebDAV 云端已解锁 (${st.count || 0})`;
    statusBadge.className = "status ok";
    syncBtn.classList.remove("hidden");
    lockBtn.classList.remove("hidden");
  } else {
    if (st.offline) {
      statusBadge.textContent = "本地桥接 · 未连接桌面端";
      statusBadge.className = "status err";
      renderItems([], "请先打开桌面端 AccountVault，或在右上角 ⚙ 切换为「WebDAV 云端直连」。");
      return;
    }
    if (st.needToken || st.authorized === false) {
      statusBadge.textContent = "本地桥接 · 需要配对密钥";
      statusBadge.className = "status err";
      settingsPanel.classList.remove("hidden");
      renderItems([], "请点击右上角 ⚙ 粘贴桌面端配对密钥，或切换为 WebDAV 模式。");
      return;
    }
    if (st.locked) {
      statusBadge.textContent = "本地桥接 · 桌面端已锁定";
      statusBadge.className = "status err";
      renderItems([], "请先在桌面端解锁 AccountVault。");
      return;
    }
    statusBadge.textContent = "本地桥接 · 已连接桌面端";
    statusBadge.className = "status ok";
  }

  const q = searchInput.value.trim();
  if (q) {
    sectionLabel.textContent = "搜索结果";
    const res = await sendBg({ type: "SEARCH_ACCOUNTS", query: q });
    renderItems(res.items || [], "没有匹配的账号");
  } else {
    let domain = "";
    try {
      domain = currentTab?.url ? new URL(currentTab.url).hostname : "";
    } catch {}
    sectionLabel.textContent = domain ? `匹配网站：${domain}` : "当前网站匹配";
    const res = await sendBg({
      type: "MATCH_CREDENTIALS",
      url: currentTab?.url || "",
      domain
    });
    renderItems(res.items || [], "当前网站暂无匹配账号，可在上方搜索全部账号。");
  }
}

toggleSettingsBtn.onclick = () => settingsPanel.classList.toggle("hidden");
modeBridgeBtn.onclick = () => setModeUI("bridge");
modeWebDavBtn.onclick = () => setModeUI("webdav");
styleWindowBtn.onclick = () => setPromptStyleUI("window");
styleOverlayBtn.onclick = () => setPromptStyleUI("overlay");

testDavBtn.onclick = async () => {
  davTestMsg.textContent = "正在测试连接...";
  davTestMsg.className = "hint-msg";
  const okPerm = await ensureHostPermission(davUrlInput.value);
  if (!okPerm) {
    davTestMsg.textContent = "未授予该 WebDAV 域名的访问权限";
    davTestMsg.className = "hint-msg err";
    return;
  }
  const res = await sendBg({
    type: "TEST_WEBDAV",
    webdavUrl: davUrlInput.value,
    webdavUser: davUserInput.value,
    webdavPass: davPassInput.value
  });
  davTestMsg.textContent = res.ok ? res.message : res.error;
  davTestMsg.className = res.ok ? "hint-msg ok" : "hint-msg err";
};

saveConfigBtn.onclick = async () => {
  if (editingMode === "webdav" && davUrlInput.value.trim()) {
    await ensureHostPermission(davUrlInput.value);
  }
  await sendBg({
    type: "SET_CONFIG",
    mode: editingMode,
    port: portInput.value,
    token: tokenInput.value,
    webdavUrl: davUrlInput.value,
    webdavUser: davUserInput.value,
    webdavPass: davPassInput.value,
    idleMinutes: idleInput.value,
    promptStyle: editingPromptStyle
  });
  settingsPanel.classList.add("hidden");
  await refresh();
};

unlockBtn.onclick = async () => {
  const pwd = masterPwdInput.value;
  if (!pwd) return;
  unlockBtn.disabled = true;
  unlockBtn.textContent = "解密中...";
  unlockErr.textContent = "";
  const okPerm = await ensureHostPermission(davUrlInput.value);
  if (!okPerm) {
    unlockErr.textContent = "请授予 WebDAV 域名访问权限";
    unlockBtn.disabled = false;
    unlockBtn.textContent = "解锁并同步";
    return;
  }
  const res = await sendBg({ type: "UNLOCK_WEBDAV", masterPassword: pwd });
  unlockBtn.disabled = false;
  unlockBtn.textContent = "解锁并同步";
  if (!res.ok) {
    unlockErr.textContent = res.error || "解锁失败";
    return;
  }
  masterPwdInput.value = "";
  await refresh();
};

masterPwdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlockBtn.click();
});

syncBtn.onclick = async () => {
  syncBtn.textContent = "…";
  await sendBg({ type: "SYNC_WEBDAV" });
  syncBtn.textContent = "↻";
  await refresh();
};

lockBtn.onclick = async () => {
  await sendBg({ type: "LOCK_WEBDAV" });
  await refresh();
};

searchInput.addEventListener("input", () => refresh());

(async () => {
  const cfg = await sendBg({ type: "GET_CONFIG" });
  setModeUI(cfg.mode || "bridge");
  setPromptStyleUI(cfg.promptStyle || "window");
  portInput.value = cfg.port || 47291;
  tokenInput.value = cfg.token || "";
  davUrlInput.value = cfg.webdavUrl || "";
  davUserInput.value = cfg.webdavUser || "";
  davPassInput.value = cfg.webdavPass || "";
  idleInput.value = cfg.idleMinutes !== undefined ? cfg.idleMinutes : 30;
  await refresh();
})();
