const statusBadge = document.getElementById("status-badge");
const extVerChip = document.getElementById("ext-ver-chip");
const settingsPanel = document.getElementById("settings-panel");
const aboutPanel = document.getElementById("about-panel");
const toggleSettingsBtn = document.getElementById("toggle-settings");
const toggleAboutBtn = document.getElementById("toggle-about");
const updateDot = document.getElementById("update-dot");
const syncBtn = document.getElementById("sync-btn");
const lockBtn = document.getElementById("lock-btn");

const aboutVersionEl = document.getElementById("about-version");
const updateStatusText = document.getElementById("update-status-text");
const updateNotesEl = document.getElementById("update-notes");
const checkUpdateBtn = document.getElementById("check-update-btn");
const openReleaseBtn = document.getElementById("open-release-btn");
const linkGithubBtn = document.getElementById("link-github");
const linkPrivacyBtn = document.getElementById("link-privacy");
const linkIssuesBtn = document.getElementById("link-issues");

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
const keepUnlockedInput = document.getElementById("keep-unlocked-input");
const pinInput = document.getElementById("pin-input");
const savePinBtn = document.getElementById("save-pin-btn");
const clearPinBtn = document.getElementById("clear-pin-btn");
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
    if (st.hasPin) {
      masterPwdInput.placeholder = "输入快捷 PIN 码或主密码...";
      pinInput.placeholder = "已启用快捷 PIN（输入新 PIN 可覆盖）";
      clearPinBtn.classList.remove("hidden");
    } else {
      masterPwdInput.placeholder = "输入主密码...";
      pinInput.placeholder = "输入 4~8 位快捷 PIN 码";
      clearPinBtn.classList.add("hidden");
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

toggleSettingsBtn.onclick = () => {
  const willOpen = settingsPanel.classList.contains("hidden");
  aboutPanel.classList.add("hidden");
  toggleAboutBtn.classList.remove("active");
  settingsPanel.classList.toggle("hidden", !willOpen);
  toggleSettingsBtn.classList.toggle("active", willOpen);
};
toggleAboutBtn.onclick = () => {
  const willOpen = aboutPanel.classList.contains("hidden");
  settingsPanel.classList.add("hidden");
  toggleSettingsBtn.classList.remove("active");
  aboutPanel.classList.toggle("hidden", !willOpen);
  toggleAboutBtn.classList.toggle("active", willOpen);
};
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
    keepUnlocked: keepUnlockedInput.checked,
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

savePinBtn.onclick = async () => {
  const pin = (pinInput.value || "").trim();
  if (pin.length < 4) {
    davTestMsg.textContent = "快捷 PIN 码至少需要 4 位";
    davTestMsg.className = "hint-msg err";
    return;
  }
  const res = await sendBg({ type: "SET_WEBDAV_PIN", pin });
  if (!res.ok) {
    davTestMsg.textContent = res.error || "设置 PIN 失败";
    davTestMsg.className = "hint-msg err";
    return;
  }
  pinInput.value = "";
  davTestMsg.textContent = "快捷 PIN 码已设置（下次可直接用 PIN 秒解）";
  davTestMsg.className = "hint-msg ok";
  await refresh();
};

clearPinBtn.onclick = async () => {
  await sendBg({ type: "SET_WEBDAV_PIN", pin: "" });
  davTestMsg.textContent = "已清除快捷 PIN 码";
  davTestMsg.className = "hint-msg ok";
  await refresh();
};

syncBtn.onclick = async () => {
  syncBtn.disabled = true;
  syncBtn.style.opacity = "0.5";
  await sendBg({ type: "SYNC_WEBDAV" });
  syncBtn.style.opacity = "";
  syncBtn.disabled = false;
  await refresh();
};

lockBtn.onclick = async () => {
  await sendBg({ type: "LOCK_WEBDAV" });
  await refresh();
};

let latestReleaseUrl = "https://github.com/ifnor/AccountVault/releases/latest";

function compareSemver(a, b) {
  const pa = String(a || "0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

checkUpdateBtn.onclick = async () => {
  const currentVer = chrome.runtime.getManifest().version || "1.0.0";
  checkUpdateBtn.disabled = true;
  checkUpdateBtn.textContent = "检查中...";
  updateStatusText.className = "update-text";
  updateStatusText.textContent = "正在连接 GitHub Releases...";
  updateNotesEl.classList.add("hidden");
  openReleaseBtn.classList.add("hidden");

  try {
    const granted = await chrome.permissions.request({ origins: ["https://api.github.com/*"] });
    if (!granted) {
      updateStatusText.className = "update-text err";
      updateStatusText.textContent = "未授予 GitHub API 访问权限，无法在线检查";
      return;
    }
    const resp = await fetch("https://api.github.com/repos/ifnor/AccountVault/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const latestTag = data.tag_name || data.name || "";
    latestReleaseUrl = data.html_url || latestReleaseUrl;

    if (latestTag && compareSemver(latestTag, currentVer) > 0) {
      updateStatusText.className = "update-text new";
      updateStatusText.textContent = `发现新版本：${latestTag}（当前 v${currentVer}）`;
      updateDot.classList.remove("hidden");
      openReleaseBtn.classList.remove("hidden");
      if (data.body) {
        updateNotesEl.textContent = data.body.trim().slice(0, 600);
        updateNotesEl.classList.remove("hidden");
      }
    } else {
      updateStatusText.className = "update-text new";
      updateStatusText.textContent = `当前已是最新版本 (v${currentVer})`;
      updateDot.classList.add("hidden");
    }
  } catch (e) {
    updateStatusText.className = "update-text err";
    updateStatusText.textContent = `检查更新失败: ${e?.message || e}`;
  } finally {
    checkUpdateBtn.disabled = false;
    checkUpdateBtn.textContent = "检查更新";
  }
};

openReleaseBtn.onclick = () => chrome.tabs.create({ url: latestReleaseUrl });
linkGithubBtn.onclick = () => chrome.tabs.create({ url: "https://github.com/ifnor/AccountVault" });
linkPrivacyBtn.onclick = () => chrome.tabs.create({ url: "https://github.com/ifnor/AccountVault/blob/main/PRIVACY.md" });
linkIssuesBtn.onclick = () => chrome.tabs.create({ url: "https://github.com/ifnor/AccountVault/issues" });

searchInput.addEventListener("input", () => refresh());

(async () => {
  const ver = chrome.runtime.getManifest().version || "1.1.5";
  extVerChip.textContent = `v${ver}`;
  aboutVersionEl.textContent = `当前版本：v${ver}`;
  const cfg = await sendBg({ type: "GET_CONFIG" });
  setModeUI(cfg.mode || "bridge");
  setPromptStyleUI(cfg.promptStyle || "window");
  portInput.value = cfg.port || 47291;
  tokenInput.value = cfg.token || "";
  davUrlInput.value = cfg.webdavUrl || "";
  davUserInput.value = cfg.webdavUser || "";
  davPassInput.value = cfg.webdavPass || "";
  idleInput.value = cfg.idleMinutes !== undefined ? cfg.idleMinutes : 30;
  keepUnlockedInput.checked = Boolean(cfg.keepUnlocked);
  await refresh();
})();
