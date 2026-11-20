(() => {
  if (window.__accountVaultExtInjected) return;
  window.__accountVaultExtInjected = true;

  let activeDropdown = null;
  let lastSavedKey = "";
  let totpWidget = null;
  let totpTimer = null;
  let totpDismissed = false;

  function isVisible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 8 && rect.height > 8;
  }

  function isRegisterPage() {
    const path = (location.pathname + location.search).toLowerCase();
    if (/(\/register|\/signup|\/sign-up|\/create[-_]?account|\/join)/.test(path)) return true;
    const visiblePwds = Array.from(document.querySelectorAll('input[type="password"]')).filter(isVisible);
    if (visiblePwds.length >= 2) return true;
    if (visiblePwds.some((el) => (el.getAttribute("autocomplete") || "").toLowerCase() === "new-password")) return true;
    return false;
  }

  function inputHintText(el) {
    return (
      (el.name || "") +
      " " +
      (el.id || "") +
      " " +
      (el.placeholder || "") +
      " " +
      (el.getAttribute("aria-label") || "") +
      " " +
      (el.getAttribute("autocomplete") || "")
    ).toLowerCase();
  }

  function findOtpTargets(root = document) {
    const allInputs = Array.from(
      root.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])')
    ).filter(isVisible);

    // Check 6-box split OTP inputs
    const oneCharBoxes = allInputs.filter((el) => el.maxLength === 1);
    if (oneCharBoxes.length === 6) {
      return { singleOtp: null, splitBoxes: oneCharBoxes };
    }

    const singleOtp =
      allInputs.find((el) => {
        const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
        if (ac === "one-time-code") return true;
        const hint = inputHintText(el);
        if (/(otp|totp|2fa|mfa|two[-_]?factor|auth[-_]?code|verify[-_]?code|验证码|动态码|安全码|口令)/.test(hint)) {
          return true;
        }
        return (el.getAttribute("inputmode") || "").toLowerCase() === "numeric" && (el.maxLength === 6 || el.maxLength === 8);
      }) || null;

    return { singleOtp, splitBoxes: oneCharBoxes.length >= 4 && oneCharBoxes.length <= 8 ? oneCharBoxes : [] };
  }

  function findLoginInputs(root = document) {
    const pwds = Array.from(root.querySelectorAll('input[type="password"]')).filter(isVisible);
    const pwdInput = pwds[0] || null;

    const userCandidates = Array.from(
      root.querySelectorAll('input[type="email"], input[type="text"], input[type="tel"], input:not([type])')
    ).filter((el) => {
      if (!isVisible(el)) return false;
      const hint = inputHintText(el);
      if (/captcha|verify|code|search|otp|totp|2fa|验证码|动态码|搜索/.test(hint)) return false;
      return true;
    });

    let userInput = null;
    if (pwdInput) {
      const form = pwdInput.closest("form");
      if (form) {
        userInput = userCandidates.find((el) => form.contains(el)) || null;
      }
      if (!userInput) {
        const pwdRect = pwdInput.getBoundingClientRect();
        userInput =
          userCandidates.find((el) => {
            const r = el.getBoundingClientRect();
            return r.top <= pwdRect.bottom + 20 && Math.abs(r.left - pwdRect.left) < 220;
          }) ||
          userCandidates[0] ||
          null;
      }
    } else {
      userInput =
        userCandidates.find((el) => {
          const hint = inputHintText(el);
          return /user|email|account|login|phone|账号|邮箱|手机/.test(hint);
        }) || null;
    }

    return { userInput, pwdInput };
  }

  function setNativeValue(el, value) {
    if (!el) return;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillCredential(account, password) {
    const { userInput, pwdInput } = findLoginInputs();
    if (userInput && account) setNativeValue(userInput, account);
    if (pwdInput && password) setNativeValue(pwdInput, password);
  }

  function fillTotpCode(code) {
    if (!code) return false;
    const { singleOtp, splitBoxes } = findOtpTargets();
    if (splitBoxes.length >= code.length) {
      for (let i = 0; i < code.length; i++) {
        setNativeValue(splitBoxes[i], code[i]);
      }
      return true;
    }
    if (singleOtp) {
      setNativeValue(singleOtp, code);
      return true;
    }
    const active = document.activeElement;
    if (active && active.tagName === "INPUT" && isVisible(active)) {
      setNativeValue(active, code);
      return true;
    }
    return false;
  }

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
  }

  function showInlineUnlockDropdown(anchorEl, mode, lockInfo) {
    closeDropdown();
    const rect = anchorEl.getBoundingClientRect();
    const box = document.createElement("div");
    box.style.cssText = `
      position: fixed;
      top: ${Math.min(window.innerHeight - 250, rect.bottom + 6)}px;
      left: ${Math.max(8, Math.min(window.innerWidth - 300, rect.left))}px;
      width: 290px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
      padding: 10px;
    `;

    const header = document.createElement("div");
    header.textContent =
      lockInfo?.mode === "webdav"
        ? "AccountVault 已锁定 (WebDAV)"
        : "AccountVault 桌面端已锁定";
    header.style.cssText =
      "font-size:12px;font-weight:700;color:#0f172a;padding-bottom:6px;border-bottom:1px solid #f1f5f9;margin-bottom:8px;";
    box.appendChild(header);

    const retryFetch = () => {
      chrome.runtime.sendMessage(
        { type: "MATCH_CREDENTIALS", url: location.href, domain: location.hostname },
        (mRes) => {
          if (mRes && mRes.ok) {
            showDropdown(anchorEl, mRes.items || [], null, mode);
            if (typeof maybeShowTotpMiniWindow === "function") maybeShowTotpMiniWindow(true);
          } else if (mRes && mRes.locked) {
            showInlineUnlockDropdown(anchorEl, mode, mRes);
          } else {
            showDropdown(anchorEl, [], mRes?.error || "获取账号失败", mode);
          }
        }
      );
    };

    if (lockInfo?.mode === "webdav") {
      const tip = document.createElement("div");
      tip.textContent = lockInfo.hasPin
        ? "输入快捷 PIN 码或主密码，解锁后立即显示账号："
        : "输入同步主密码，解锁后立即显示账号：";
      tip.style.cssText = "font-size:11px;color:#64748b;margin-bottom:6px;line-height:1.4;";
      box.appendChild(tip);

      const pwdInput = document.createElement("input");
      pwdInput.type = "password";
      pwdInput.placeholder = lockInfo.hasPin ? "PIN 码或主密码" : "输入同步主密码";
      pwdInput.style.cssText = `
        width:100%;box-sizing:border-box;height:32px;padding:0 9px;
        border:1px solid #cbd5e1;border-radius:7px;font-size:12px;
        outline:none;background:#f8fafc;color:#0f172a;margin-bottom:6px;
      `;
      box.appendChild(pwdInput);

      const errEl = document.createElement("div");
      errEl.style.cssText = "font-size:11px;color:#dc2626;min-height:14px;margin-bottom:6px;display:none;";
      box.appendChild(errEl);

      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.textContent = "解锁并显示账号";
      submitBtn.style.cssText = `
        width:100%;height:32px;border:none;border-radius:7px;
        background:linear-gradient(135deg,#1b7ef5,#4d3fe4);color:#fff;
        font-size:12px;font-weight:600;cursor:pointer;
      `;
      const doUnlock = () => {
        const val = pwdInput.value;
        if (!val) {
          errEl.textContent = "请输入密码或 PIN 码";
          errEl.style.display = "block";
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = "解密中...";
        errEl.style.display = "none";
        chrome.runtime.sendMessage({ type: "UNLOCK_WEBDAV", masterPassword: val }, (uRes) => {
          submitBtn.disabled = false;
          submitBtn.textContent = "解锁并显示账号";
          if (!uRes || !uRes.ok) {
            errEl.textContent = uRes?.error || "解锁失败，请检查密码或 PIN";
            errEl.style.display = "block";
            return;
          }
          retryFetch();
        });
      };
      submitBtn.onclick = doUnlock;
      pwdInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          doUnlock();
        }
      });
      box.appendChild(submitBtn);
      setTimeout(() => pwdInput.focus(), 30);
    } else {
      const tip = document.createElement("div");
      tip.textContent = "请先在桌面端 AccountVault 解锁保险库，完成后点击下方重试。";
      tip.style.cssText = "font-size:11px;color:#64748b;margin-bottom:8px;line-height:1.4;";
      box.appendChild(tip);

      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;";

      const wakeBtn = document.createElement("button");
      wakeBtn.type = "button";
      wakeBtn.textContent = "唤醒桌面端";
      wakeBtn.style.cssText = `
        flex:1;height:30px;border:none;border-radius:7px;
        background:linear-gradient(135deg,#1b7ef5,#4d3fe4);color:#fff;
        font-size:11px;font-weight:600;cursor:pointer;
      `;
      wakeBtn.onclick = () => {
        chrome.runtime.sendMessage({ type: "FOCUS_BRIDGE" }, () => {});
        wakeBtn.textContent = "已发送唤醒";
      };

      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.textContent = "已解锁，重试";
      retryBtn.style.cssText = `
        flex:1;height:30px;border:1px solid #cbd5e1;border-radius:7px;
        background:#ffffff;color:#0f172a;font-size:11px;font-weight:600;cursor:pointer;
      `;
      retryBtn.onclick = retryFetch;

      row.appendChild(wakeBtn);
      row.appendChild(retryBtn);
      box.appendChild(row);
    }

    document.body.appendChild(box);
    activeDropdown = box;
    setTimeout(() => {
      const onOutside = (ev) => {
        if (activeDropdown && !activeDropdown.contains(ev.target) && ev.target !== anchorEl) {
          closeDropdown();
          document.removeEventListener("mousedown", onOutside, true);
        }
      };
      document.addEventListener("mousedown", onOutside, true);
    }, 0);
  }

  function showDropdown(anchorEl, items, message, mode = "login") {
    closeDropdown();
    const rect = anchorEl.getBoundingClientRect();
    const box = document.createElement("div");
    box.style.cssText = `
      position: fixed;
      top: ${Math.min(window.innerHeight - 250, rect.bottom + 6)}px;
      left: ${Math.max(8, Math.min(window.innerWidth - 300, rect.left))}px;
      width: 290px;
      max-height: 250px;
      overflow-y: auto;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
      padding: 6px;
    `;

    const header = document.createElement("div");
    header.textContent = mode === "otp" ? "AccountVault 2FA 动态码" : "AccountVault 快速填充";
    header.style.cssText =
      "font-size:11px;font-weight:700;color:#64748b;padding:4px 8px 6px;border-bottom:1px solid #f1f5f9;margin-bottom:4px;";
    box.appendChild(header);

    if (message) {
      const msgDiv = document.createElement("div");
      msgDiv.textContent = message;
      msgDiv.style.cssText = "font-size:12px;color:#64748b;padding:10px 8px;";
      box.appendChild(msgDiv);
    } else if (!items || items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "当前域名及子域名暂无匹配账号。";
      empty.style.cssText = "font-size:12px;color:#64748b;padding:10px 8px;";
      box.appendChild(empty);
    } else {
      for (const item of items) {
        if (mode === "otp" && !item.totp_code) continue;
        const row = document.createElement("button");
        row.type = "button";
        row.style.cssText = `
          display:flex;flex-direction:column;align-items:flex-start;width:100%;
          border:none;background:transparent;padding:7px 8px;border-radius:7px;
          cursor:pointer;text-align:left;
        `;
        row.onmouseenter = () => (row.style.background = "#eff6ff");
        row.onmouseleave = () => (row.style.background = "transparent");

        const t = document.createElement("div");
        t.textContent = item.title || location.hostname;
        t.style.cssText = "font-size:13px;font-weight:600;color:#0f172a;";
        const s = document.createElement("div");
        s.textContent =
          mode === "otp"
            ? `${item.account} · 2FA: ${item.totp_code}`
            : item.account + (item.totp_code ? ` · 2FA: ${item.totp_code}` : "");
        s.style.cssText = "font-size:11px;color:#64748b;margin-top:2px;";

        row.appendChild(t);
        row.appendChild(s);
        row.onclick = () => {
          if (mode === "otp") {
            fillTotpCode(item.totp_code);
          } else {
            fillCredential(item.account, item.password);
          }
          closeDropdown();
        };
        box.appendChild(row);
      }
    }

    document.body.appendChild(box);
    activeDropdown = box;
  }

  function attachBadgeToInput(input, mode = "login") {
    if (!input || input.dataset.avBadgeAttached === "1") return;
    input.dataset.avBadgeAttached = "1";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = mode === "otp" ? "AccountVault 填入 2FA 验证码" : "AccountVault 自动填充";
    btn.style.cssText = `
      position: fixed;
      z-index: 2147483646;
      width: 24px;
      height: 24px;
      padding: 0;
      border-radius: 6px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.28);
      overflow: hidden;
    `;
    const iconImg = document.createElement("img");
    iconImg.src = chrome.runtime.getURL("icons/icon128.png");
    iconImg.alt = mode === "otp" ? "2FA" : "AccountVault";
    iconImg.style.cssText = "width:24px;height:24px;display:block;border-radius:6px;object-fit:cover;pointer-events:none;";
    btn.appendChild(iconImg);
    document.body.appendChild(btn);

    const positionBtn = () => {
      if (!isVisible(input)) {
        btn.style.display = "none";
        return;
      }
      const r = input.getBoundingClientRect();
      btn.style.top = `${r.top + (r.height - 24) / 2}px`;
      btn.style.left = `${r.right - 34}px`;
      btn.style.display = "flex";
    };

    input.addEventListener("focus", () => {
      positionBtn();
      if (mode === "otp") maybeShowTotpMiniWindow(true);
    });
    input.addEventListener("mouseenter", positionBtn);
    window.addEventListener(
      "scroll",
      () => {
        if (btn.style.display === "flex") positionBtn();
      },
      true
    );

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage(
        { type: "MATCH_CREDENTIALS", url: location.href, domain: location.hostname },
        (res) => {
          if (!res || res.offline) {
            showDropdown(input, [], "未连接到桌面端 AccountVault，或请在扩展图标中切换为 WebDAV 模式。", mode);
          } else if (res.locked) {
            showInlineUnlockDropdown(input, mode, res);
          } else if (res.error) {
            showDropdown(input, [], res.error, mode);
          } else {
            showDropdown(input, res.items || [], null, mode);
          }
        }
      );
    });
  }

  function closeTotpMiniWindow(dismiss = false) {
    if (dismiss) totpDismissed = true;
    if (totpTimer) {
      clearInterval(totpTimer);
      totpTimer = null;
    }
    if (totpWidget) {
      totpWidget.remove();
      totpWidget = null;
    }
  }

  function renderTotpMiniWindow(totpItems) {
    if (!totpItems || totpItems.length === 0) return;
    if (!totpWidget) {
      totpWidget = document.createElement("div");
      totpWidget.id = "av-totp-mini";
      totpWidget.style.cssText = `
        position: fixed;
        bottom: 18px;
        right: 18px;
        z-index: 2147483647;
        width: 286px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.22);
        padding: 12px 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
      `;
      document.body.appendChild(totpWidget);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = 30 - (nowSec % 30);

    totpWidget.innerHTML = "";
    const topBar = document.createElement("div");
    topBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";
    const titleEl = document.createElement("div");
    titleEl.textContent = `AccountVault 2FA (${remaining}s)`;
    titleEl.style.cssText = "font-size:11px;font-weight:700;color:#2563eb;";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.style.cssText =
      "border:none;background:transparent;font-size:16px;line-height:1;color:#64748b;cursor:pointer;padding:0 2px;";
    closeBtn.onclick = () => closeTotpMiniWindow(true);
    topBar.appendChild(titleEl);
    topBar.appendChild(closeBtn);
    totpWidget.appendChild(topBar);

    for (const item of totpItems.slice(0, 3)) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border-radius:9px;background:#f8fafc;border:1px solid #e2e8f0;margin-top:6px;";

      const info = document.createElement("div");
      info.style.cssText = "min-width:0;flex:1;";
      const name = document.createElement("div");
      name.textContent = item.title || location.hostname;
      name.style.cssText = "font-size:11px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      const code = document.createElement("div");
      code.textContent = item.totp_code;
      code.style.cssText = "font-size:17px;font-weight:800;letter-spacing:2px;color:#0f172a;font-family:monospace;";
      info.appendChild(name);
      info.appendChild(code);

      const btns = document.createElement("div");
      btns.style.cssText = "display:flex;gap:4px;flex-shrink:0;";

      const fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.textContent = "填入";
      fillBtn.style.cssText =
        "padding:5px 9px;border-radius:7px;border:none;background:#2563eb;color:#fff;font-size:11px;font-weight:600;cursor:pointer;";
      fillBtn.onclick = () => {
        if (fillTotpCode(item.totp_code)) {
          closeTotpMiniWindow(false);
        }
      };

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.textContent = "复制";
      copyBtn.style.cssText =
        "padding:5px 8px;border-radius:7px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:11px;cursor:pointer;";
      copyBtn.onclick = async () => {
        await navigator.clipboard.writeText(item.totp_code);
        copyBtn.textContent = "已复制";
        setTimeout(() => (copyBtn.textContent = "复制"), 1000);
      };

      btns.appendChild(fillBtn);
      btns.appendChild(copyBtn);
      row.appendChild(info);
      row.appendChild(btns);
      totpWidget.appendChild(row);
    }

    if (!totpTimer) {
      let lastStep = Math.floor(Date.now() / 1000 / 30);
      totpTimer = setInterval(() => {
        if (!totpWidget) {
          clearInterval(totpTimer);
          totpTimer = null;
          return;
        }
        const curStep = Math.floor(Date.now() / 1000 / 30);
        if (curStep !== lastStep) {
          lastStep = curStep;
          maybeShowTotpMiniWindow(true);
        } else {
          const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
          if (totpWidget.firstChild && totpWidget.firstChild.firstChild) {
            totpWidget.firstChild.firstChild.textContent = `AccountVault 2FA (${rem}s)`;
          }
        }
      }, 1000);
    }
  }

  let totpQueryPending = false;
  function maybeShowTotpMiniWindow(force = false) {
    if ((totpDismissed && !force) || totpQueryPending) return;
    totpQueryPending = true;
    chrome.runtime.sendMessage(
      { type: "MATCH_CREDENTIALS", url: location.href, domain: location.hostname },
      (res) => {
        totpQueryPending = false;
        if (!res || !res.ok) return;
        const withTotp = (res.items || []).filter((it) => Boolean(it.totp_code));
        if (withTotp.length > 0) {
          renderTotpMiniWindow(withTotp);
        }
      }
    );
  }

  function showSaveBanner(account, password) {
    const key = `${location.hostname}|${account}|${password}`;
    if (lastSavedKey === key) return;
    lastSavedKey = key;

    const existing = document.getElementById("av-save-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "av-save-banner";
    banner.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
      padding: 12px 14px;
      width: 290px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
    `;
    banner.innerHTML = `
      <div style="font-size:13px;font-weight:700;margin-bottom:4px;">保存到 AccountVault？</div>
      <div style="font-size:12px;color:#475569;margin-bottom:10px;word-break:break-all;">${location.hostname} · ${account.replace(/[<>&]/g, "")}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="av-save-no" style="padding:5px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-size:12px;">暂不</button>
        <button id="av-save-yes" style="padding:5px 12px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">保存</button>
      </div>
    `;
    document.body.appendChild(banner);

    banner.querySelector("#av-save-no").onclick = () => banner.remove();
    banner.querySelector("#av-save-yes").onclick = () => {
      chrome.runtime.sendMessage(
        {
          type: "SAVE_CREDENTIAL",
          title: document.title || location.hostname,
          url: location.href,
          account,
          password
        },
        () => banner.remove()
      );
    };
    setTimeout(() => banner.remove(), 15000);
  }

  // ==================== Passkey (WebAuthn) UI Modal Bridge ====================
  function showPasskeyModal({ title, subtitle, items, confirmLabel }) {
    return new Promise((resolve) => {
      const old = document.getElementById("av-passkey-host");
      if (old) old.remove();

      const host = document.createElement("div");
      host.id = "av-passkey-host";
      host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647;";
      const shadow = host.attachShadow({ mode: "closed" });

      const style = document.createElement("style");
      style.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
        .overlay {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .card {
          width: 400px; max-width: 100%;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          box-shadow: 0 24px 54px rgba(15, 23, 42, 0.32);
          padding: 18px 20px;
          color: #0f172a;
        }
        .head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .logo { width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0; }
        .head-text { min-width: 0; flex: 1; }
        .title { font-size: 15px; font-weight: 700; color: #0f172a; line-height: 1.3; }
        .sub { font-size: 12px; color: #64748b; margin-top: 3px; word-break: break-all; line-height: 1.4; }
        .list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; max-height: 200px; overflow-y: auto; }
        .pk-item {
          width: 100%; text-align: left; padding: 10px 12px;
          border-radius: 10px; border: 1px solid #cbd5e1; background: #f8fafc;
          cursor: pointer; transition: background 0.15s, border-color 0.15s;
        }
        .pk-item:hover { background: #eff6ff; border-color: #2563eb; }
        .pk-t { font-size: 13px; font-weight: 600; color: #0f172a; }
        .pk-s { font-size: 11px; color: #64748b; margin-top: 2px; }
        .actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 6px; }
        .btn {
          height: 36px; padding: 0 14px; border-radius: 9px;
          font-size: 12px; font-weight: 600; cursor: pointer;
          white-space: nowrap; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .btn-sec { background: #ffffff; border: 1px solid #cbd5e1; color: #475569; }
        .btn-sec:hover { background: #f1f5f9; }
        .btn-pri { background: linear-gradient(135deg, #1b7ef5, #4d3fe4); border: none; color: #ffffff; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.28); }
        .btn-pri:hover { filter: brightness(1.06); }
      `;
      shadow.appendChild(style);

      const overlay = document.createElement("div");
      overlay.className = "overlay";

      const card = document.createElement("div");
      card.className = "card";

      const head = document.createElement("div");
      head.className = "head";
      const logo = document.createElement("img");
      logo.className = "logo";
      logo.src = chrome.runtime.getURL("icons/icon128.png");
      const headText = document.createElement("div");
      headText.className = "head-text";
      const h = document.createElement("div");
      h.className = "title";
      h.textContent = title;
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = subtitle;
      headText.appendChild(h);
      headText.appendChild(sub);
      head.appendChild(logo);
      head.appendChild(headText);
      card.appendChild(head);

      if (items && items.length > 0) {
        const list = document.createElement("div");
        list.className = "list";
        for (const pk of items) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pk-item";
          const t = document.createElement("div");
          t.className = "pk-t";
          t.textContent = pk.title || pk.rp_id;
          const s = document.createElement("div");
          s.className = "pk-s";
          s.textContent = pk.user_name || pk.user_display_name || "Passkey 通行密钥";
          btn.appendChild(t);
          btn.appendChild(s);
          btn.onclick = () => {
            host.remove();
            resolve({ chosen: pk });
          };
          list.appendChild(btn);
        }
        card.appendChild(list);
      }

      const actions = document.createElement("div");
      actions.className = "actions";

      const fallbackBtn = document.createElement("button");
      fallbackBtn.type = "button";
      fallbackBtn.className = "btn btn-sec";
      fallbackBtn.textContent = "改用系统原生";
      fallbackBtn.onclick = () => {
        host.remove();
        resolve({ fallback: true });
      };
      actions.appendChild(fallbackBtn);

      if (confirmLabel) {
        const okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.className = "btn btn-pri";
        okBtn.textContent = confirmLabel;
        okBtn.onclick = () => {
          host.remove();
          resolve({ confirmed: true });
        };
        actions.appendChild(okBtn);
      }

      card.appendChild(actions);
      overlay.appendChild(card);
      shadow.appendChild(overlay);
      document.body.appendChild(host);
    });
  }

  function showWebDavUnlockModal(hasPin) {
    return new Promise((resolve) => {
      const existing = document.getElementById("av-passkey-host");
      if (existing) existing.remove();

      const host = document.createElement("div");
      host.id = "av-passkey-host";
      const shadow = host.attachShadow({ mode: "closed" });

      const style = document.createElement("style");
      style.textContent = `
        :host { all: initial; }
        .overlay {
          position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .card {
          width: 370px; max-width: calc(100vw - 32px);
          background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;
          box-shadow: 0 24px 54px rgba(15, 23, 42, 0.32); padding: 18px 20px; color: #0f172a;
        }
        .head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .logo { width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0; }
        .title { font-size: 15px; font-weight: 700; color: #0f172a; }
        .sub { font-size: 12px; color: #64748b; margin-top: 2px; }
        .inp {
          width: 100%; box-sizing: border-box; height: 38px; padding: 0 11px;
          border: 1px solid #cbd5e1; border-radius: 9px; font-size: 13px;
          outline: none; background: #f8fafc; color: #0f172a; margin-bottom: 6px;
        }
        .inp:focus { border-color: #2563eb; background: #ffffff; }
        .err { font-size: 12px; color: #dc2626; min-height: 16px; margin-bottom: 6px; }
        .actions { display: flex; justify-content: flex-end; gap: 10px; }
        .btn { height: 36px; padding: 0 14px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .btn-sec { background: #ffffff; border: 1px solid #cbd5e1; color: #475569; }
        .btn-pri { background: linear-gradient(135deg, #1b7ef5, #4d3fe4); border: none; color: #ffffff; }
      `;
      shadow.appendChild(style);

      const overlay = document.createElement("div");
      overlay.className = "overlay";
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="head">
          <img class="logo" src="${chrome.runtime.getURL("icons/icon128.png")}" />
          <div>
            <div class="title">解锁 AccountVault</div>
            <div class="sub">${hasPin ? "输入快捷 PIN 码或主密码以继续操作" : "输入同步主密码以继续操作"}</div>
          </div>
        </div>
      `;
      const inp = document.createElement("input");
      inp.type = "password";
      inp.className = "inp";
      inp.placeholder = hasPin ? "PIN 码或主密码" : "输入同步主密码";
      const err = document.createElement("div");
      err.className = "err";
      const actions = document.createElement("div");
      actions.className = "actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-sec";
      cancelBtn.textContent = "改用系统原生";
      cancelBtn.onclick = () => {
        host.remove();
        resolve(false);
      };
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "btn btn-pri";
      okBtn.textContent = "解锁并继续";
      const doUnlock = () => {
        if (!inp.value) {
          err.textContent = "请输入密码或 PIN 码";
          return;
        }
        okBtn.disabled = true;
        okBtn.textContent = "解密中...";
        err.textContent = "";
        chrome.runtime.sendMessage({ type: "UNLOCK_WEBDAV", masterPassword: inp.value }, (res) => {
          okBtn.disabled = false;
          okBtn.textContent = "解锁并继续";
          if (!res || !res.ok) {
            err.textContent = res?.error || "解锁失败";
            return;
          }
          host.remove();
          resolve(true);
        });
      };
      okBtn.onclick = doUnlock;
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doUnlock();
        }
      });
      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      card.appendChild(inp);
      card.appendChild(err);
      card.appendChild(actions);
      overlay.appendChild(card);
      shadow.appendChild(overlay);
      document.documentElement.appendChild(host);
      setTimeout(() => inp.focus(), 40);
    });
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.type !== "AV_WEBAUTHN_REQ") return;
    const { reqId, action, payload } = ev.data;
    const reply = (result) => {
      window.postMessage({ type: "AV_WEBAUTHN_RESP", reqId, result }, "*");
    };

    if (action === "CREATE_PROMPT") {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, async (st) => {
        if (!st || !st.ok || st.offline || st.needToken || st.needWebDavConfig) {
          reply({ fallback: true });
          return;
        }
        if (st.locked) {
          if (st.mode === "webdav") {
            const unlockedNow = await showWebDavUnlockModal(Boolean(st.hasPin));
            if (!unlockedNow) {
              reply({ fallback: true });
              return;
            }
          } else {
            reply({ fallback: true });
            return;
          }
        }
        const proceedPrompt = () => {
          chrome.runtime.sendMessage({ type: "GET_CONFIG" }, async (cfg) => {
            if (!cfg || cfg.promptStyle !== "overlay") {
              chrome.runtime.sendMessage(
                {
                  type: "OPEN_PASSKEY_PROMPT",
                  kind: "create",
                  rpId: payload.rpId,
                  rpName: payload.rpName,
                  userName: payload.userName,
                  userDisplayName: payload.userDisplayName,
                  isCrossPlatform: !!payload.isCrossPlatform
                },
                (res) => reply(res?.confirmed ? { ok: true } : { fallback: true })
              );
              return;
            }
            const res = await showPasskeyModal({
              title: payload.isCrossPlatform
                ? "使用 AccountVault 模拟外接安全密钥？"
                : "使用 AccountVault 创建通行密钥？",
              subtitle: `${payload.rpName || payload.rpId} · ${payload.userName || payload.userDisplayName || (payload.isCrossPlatform ? "模拟 USB 安全密钥" : "新通行密钥")}`,
              confirmLabel: payload.isCrossPlatform ? "模拟安全密钥保存" : "使用 AccountVault 保存"
            });
            reply(res.confirmed ? { ok: true } : { fallback: true });
          });
        };
        if (Array.isArray(payload.excludeIds) && payload.excludeIds.length > 0) {
          chrome.runtime.sendMessage(
            { type: "MATCH_PASSKEYS", rpId: payload.rpId, allowIds: payload.excludeIds },
            (matchRes) => {
              if (matchRes && matchRes.ok && Array.isArray(matchRes.items) && matchRes.items.length > 0) {
                reply({ excluded: true });
                return;
              }
              proceedPrompt();
            }
          );
          return;
        }
        proceedPrompt();
      });
      return;
    }

    if (action === "SAVE_PASSKEY") {
      chrome.runtime.sendMessage({ type: "SAVE_PASSKEY", ...payload }, (res) => {
        reply(res || { ok: false });
      });
      return;
    }

    if (action === "GET_PASSKEY") {
      chrome.runtime.sendMessage({ type: "MATCH_PASSKEYS", ...payload }, (res) => {
        const items = res && res.ok ? res.items || [] : [];
        if (items.length === 0) {
          reply({ fallback: true });
          return;
        }
        chrome.runtime.sendMessage({ type: "GET_CONFIG" }, async (cfg) => {
          if (!cfg || cfg.promptStyle !== "overlay") {
            chrome.runtime.sendMessage(
              {
                type: "OPEN_PASSKEY_PROMPT",
                kind: "get",
                rpId: payload.rpId,
                items
              },
              (picked) => {
                if (picked?.chosen) {
                  reply({ passkey: picked.chosen });
                } else {
                  reply({ fallback: true });
                }
              }
            );
            return;
          }
          const picked = await showPasskeyModal({
            title: "使用 AccountVault 通行密钥登录",
            subtitle: `网站：${payload.rpId}`,
            items
          });
          if (picked.chosen) {
            reply({ passkey: picked.chosen });
          } else {
            reply({ fallback: true });
          }
        });
      });
      return;
    }

    if (action === "BUMP_PASSKEY") {
      chrome.runtime.sendMessage({ type: "BUMP_PASSKEY", ...payload }, () => reply({ ok: true }));
    }
  });

  function scanAndHook() {
    // 1. Check OTP / 2FA fields (same-domain / subdomain popup prompt)
    const { singleOtp, splitBoxes } = findOtpTargets();
    if (singleOtp) {
      attachBadgeToInput(singleOtp, "otp");
      maybeShowTotpMiniWindow(false);
    } else if (splitBoxes.length >= 4) {
      attachBadgeToInput(splitBoxes[0], "otp");
      maybeShowTotpMiniWindow(false);
    } else if (/(2fa|mfa|totp|otp|two[-_]?factor|verify)/i.test(location.pathname + location.search)) {
      maybeShowTotpMiniWindow(false);
    }

    if (isRegisterPage()) return;
    const { userInput, pwdInput } = findLoginInputs();
    if (pwdInput) {
      attachBadgeToInput(pwdInput, "login");
      if (userInput) attachBadgeToInput(userInput, "login");

      const form = pwdInput.closest("form");
      const target = form || document;
      if (!target.dataset?.avSubmitHooked) {
        if (target.dataset) target.dataset.avSubmitHooked = "1";
        target.addEventListener(
          "submit",
          () => {
            const { userInput: u, pwdInput: p } = findLoginInputs();
            const acc = u?.value?.trim() || "";
            const pwd = p?.value || "";
            if (acc && pwd) {
              chrome.runtime.sendMessage(
                { type: "MATCH_CREDENTIALS", url: location.href, domain: location.hostname },
                (res) => {
                  if (!res || !res.ok) return;
                  const exists = (res.items || []).some(
                    (it) => it.account.toLowerCase() === acc.toLowerCase() && it.password === pwd
                  );
                  if (!exists) {
                    showSaveBanner(acc, pwd);
                  }
                }
              );
            }
          },
          true
        );
      }
    }
  }

  document.addEventListener("click", (e) => {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      closeDropdown();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "FILL_FROM_POPUP") {
      fillCredential(msg.account, msg.password);
      sendResponse({ ok: true });
    } else if (msg.type === "FILL_TOTP_FROM_POPUP") {
      const ok = fillTotpCode(msg.code);
      sendResponse({ ok });
    }
  });

  scanAndHook();
  const obs = new MutationObserver(() => scanAndHook());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
