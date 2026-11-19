# AccountVault Privacy Policy / 隐私政策

**Effective Date / 生效日期**: 2026-11-19  
**Applies to / 适用范围**: AccountVault Desktop (Windows), AccountVault Mobile (Android), and AccountVault Browser Extension (Chrome / Microsoft Edge).

---

## 1. Overview / 概述

**English**:  
AccountVault ("we", "our", or "the Application / Extension") is an open-source, local-first password manager, 2FA (TOTP/HOTP) authenticator, and WebAuthn/Passkey manager. We are built on a strict **Zero-Knowledge, Local-First, and Zero-Telemetry** architecture. We do **not** operate any centralized backend servers, analytics services, or telemetry trackers.

**中文**：  
AccountVault（以下简称“本应用”或“本扩展”）是一款开源、本地优先的密码管理器、2FA（TOTP/HOTP）动态验证码生成器及 WebAuthn/Passkey 通行密钥管理工具。我们严格遵循**零知识加密、本地优先、零遥测收集**的安全架构。开发者**不运营**任何中心化后台服务器、统计分析服务或遥测追踪器。

---

## 2. Data Collection & Usage / 数据收集与使用

**English**:  
- **Zero Data Collection by Developer**: We do **not** collect, transmit, store, rent, or sell any of your personal information, passwords, 2FA secrets, Passkey private keys, browsing history, or usage data to the developer or any third party.
- **Local Processing Only**: All sensitive authentication data (usernames, passwords, TOTP/HOTP secrets, and Passkey private keys) is encrypted and processed exclusively on your local device:
  - **Windows & Android App**: Stored locally in an encrypted SQLite database (`vault.db`) protected by `AES-256-GCM` and hardware/system keystore encryption (Windows DPAPI / Android hardware storage).
  - **Browser Extension**: Configurations, session tokens, and encrypted vault caches are stored strictly in your browser's local storage (`chrome.storage.local`).

**中文**：  
- **开发者零数据收集**：我们**不会**收集、传输、存储、出租或向任何第三方出售您的个人信息、账号密码、2FA 密钥、Passkey 私钥、浏览历史记录或使用行为数据。
- **仅限本地处理**：所有敏感身份认证数据（用户名、密码、TOTP/HOTP 密钥、Passkey 私钥）均仅在您的本地设备上加密与处理：
  - **Windows 与 Android 客户端**：加密保存在本地 SQLite 数据库（`vault.db`）中，采用 `AES-256-GCM` 算法及系统级密钥保护（Windows DPAPI）。
  - **浏览器扩展**：扩展配置、会话令牌及加密保险库缓存仅保存在您本地浏览器的 `chrome.storage.local` 存储中。

---

## 3. Data Transmission & Sync / 数据传输与同步

**English**:  
Depending on the features you explicitly enable, network requests are made **only** to the following destinations under your direct control:
1. **Desktop Local Bridge (`http://127.0.0.1:47291`)**: When the Browser Extension operates in Desktop Bridge Mode, it communicates strictly over the local loopback interface (`127.0.0.1`) with the AccountVault desktop client running on your own computer. No traffic leaves your device.
2. **Self-Configured WebDAV Server**: When you explicitly enable WebDAV Cloud Sync or Browser Extension WebDAV Direct Connect Mode, your data is synchronized directly with the WebDAV server URL configured by you. All data uploaded to WebDAV is end-to-end encrypted (`AES-256-GCM` with `PBKDF2-HMAC-SHA256`, 100,000 iterations) on your device prior to transmission.

**中文**：  
根据您主动开启的功能模式，网络通信**仅**发往以下完全由您自己控制的目标地址：
1. **桌面端本地桥接 (`http://127.0.0.1:47291`)**：当浏览器扩展处于“桌面端桥接模式”时，仅通过本机回环地址（`127.0.0.1`）与您电脑本机运行的 AccountVault 桌面客户端通信，没有任何流量离开您的设备。
2. **用户自建/自配的 WebDAV 服务器**：当您主动开启 WebDAV 云同步或浏览器扩展“WebDAV 云端直连模式”时，数据仅与您自己填写的 WebDAV 服务器地址直接通信。所有上传至 WebDAV 的备份数据均在本地完成 `AES-256-GCM` + `PBKDF2-HMAC-SHA256`（100,000 次迭代）端到端加密后才进行传输。

---

## 4. Browser Extension Permissions / 浏览器扩展权限声明

**English**:  
The AccountVault Browser Extension requests the following permissions solely to provide its core autofill and Passkey functionality:
- **`activeTab` / `scripting` / `content_scripts`**: Used only to detect login and 2FA input fields on the current web page, autofill credentials at the user's request, and handle WebAuthn/Passkey (`navigator.credentials`) creation and assertion calls.
- **`storage`**: Used only to store user preferences, local bridge session tokens, and encrypted vault cache locally in `chrome.storage.local`.
- **`alarms`**: Used only to run periodic background sync checks (every 1 minute) for encrypted vault updates when WebDAV Direct Connect mode is enabled.
- **`host_permissions` (`http://127.0.0.1/*`)**: Used only to connect to the local AccountVault desktop companion application.
- **`optional_host_permissions` (`http://*/*`, `https://*/*`)**: Requested at runtime **only** when the user configures a custom WebDAV server URL in WebDAV Direct Connect mode.
- **No Remote Code**: All executable JavaScript, HTML, and CSS code is packaged locally within the extension bundle. No remote code or external scripts are loaded or executed.

**中文**：  
AccountVault 浏览器扩展申请的以下权限仅用于实现核心的自动填充与 Passkey 功能：
- **`activeTab` / `scripting` / `content_scripts`**：仅用于识别当前网页的登录与 2FA 验证码输入框、在用户触发时填入凭据，以及拦截处理网页的 WebAuthn/Passkey（`navigator.credentials`）注册与登录请求。
- **`storage`**：仅用于在本地 `chrome.storage.local` 保存扩展设置、本地桥接会话令牌和加密的保险库缓存。
- **`alarms`**：仅用于在开启 WebDAV 直连模式时，定期（每 1 分钟）检查远端加密备份是否有更新。
- **`host_permissions` (`http://127.0.0.1/*`)**：仅用于连接用户本机运行的 AccountVault 桌面客户端。
- **`optional_host_permissions` (`http://*/*`, `https://*/*`)**：仅当用户在 WebDAV 直连模式下主动配置自定义 WebDAV 服务器地址时，按需在运行时请求对应域名的访问权限。
- **无远程代码**：所有可执行的 JavaScript、HTML 与 CSS 代码均静态打包在扩展程序包内，不会加载或执行任何外部远程代码。

---

## 5. Third-Party Services & Data Sharing / 第三方服务与数据共享

**English**:  
We do **not** share, sell, disclose, or transfer any user data to third parties, advertisers, data brokers, or credit agencies.

**中文**：  
我们**绝不会**向任何第三方、广告商、数据经纪商或信用机构共享、出售、披露或转移任何用户数据。

---

## 6. Contact Us / 联系方式

**English**:  
If you have any questions or concerns regarding this Privacy Policy or our security practices, please open an issue on our official GitHub repository:  
https://github.com/ifnor/AccountVault/issues

**中文**：  
如果您对本隐私政策或安全机制有任何疑问，欢迎在我们的 GitHub 官方仓库提交 Issue：  
https://github.com/ifnor/AccountVault/issues
