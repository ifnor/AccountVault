const params = new URLSearchParams(location.search);
const promptId = params.get("id") || "";

const titleEl = document.getElementById("prompt-title");
const subtitleEl = document.getElementById("prompt-subtitle");
const infoCardEl = document.getElementById("info-card");
const listEl = document.getElementById("passkey-list");
const fallbackBtn = document.getElementById("fallback-btn");
const confirmBtn = document.getElementById("confirm-btn");

function sendBg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function submitResult(result) {
  sendBg({ type: "PASSKEY_PROMPT_RESULT", promptId, result }).then(() => {
    window.close();
  });
}

fallbackBtn.onclick = () => submitResult({ fallback: true });

(async () => {
  const res = await sendBg({ type: "GET_PASSKEY_PROMPT", promptId });
  if (!res || !res.ok || !res.prompt) {
    window.close();
    return;
  }

  const p = res.prompt;
  if (p.kind === "create") {
    titleEl.textContent = p.isCrossPlatform
      ? "使用 AccountVault 模拟外接安全密钥？"
      : "使用 AccountVault 创建通行密钥？";
    subtitleEl.textContent = p.isCrossPlatform
      ? "将以 USB 安全密钥 (cross-platform) 模式保存；如需插物理密钥请点取消"
      : "通行密钥将加密保存在你的保险库中";
    infoCardEl.innerHTML = "";

    const r1 = document.createElement("div");
    r1.className = "info-row";
    r1.innerHTML = `<span class="info-label">网站 / 服务</span><span class="info-val"></span>`;
    r1.querySelector(".info-val").textContent = p.rpName ? `${p.rpName} (${p.rpId})` : p.rpId;

    const r2 = document.createElement("div");
    r2.className = "info-row";
    r2.innerHTML = `<span class="info-label">账号标识</span><span class="info-val"></span>`;
    r2.querySelector(".info-val").textContent = p.userName || p.userDisplayName || "默认用户";

    infoCardEl.appendChild(r1);
    infoCardEl.appendChild(r2);

    confirmBtn.textContent = p.isCrossPlatform ? "模拟安全密钥保存" : "使用 AccountVault 保存";
    confirmBtn.classList.remove("hidden");
    confirmBtn.onclick = () => submitResult({ confirmed: true });
  } else {
    titleEl.textContent = "选择 AccountVault 通行密钥登录";
    subtitleEl.textContent = `网站：${p.rpId}`;
    infoCardEl.classList.add("hidden");
    listEl.classList.remove("hidden");

    for (const pk of p.items || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pk-item";
      const name = document.createElement("div");
      name.className = "pk-name";
      name.textContent = pk.title || pk.rp_id;
      const user = document.createElement("div");
      user.className = "pk-user";
      user.textContent = pk.user_name || pk.user_display_name || "Passkey 通行密钥";
      btn.appendChild(name);
      btn.appendChild(user);
      btn.onclick = () => submitResult({ chosen: pk });
      listEl.appendChild(btn);
    }
  }
})();
