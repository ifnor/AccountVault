# 账号管家 (Account Vault) v1.0.0

[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2024_Edition-black?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](#)

新一代高性能、零依赖、现代化设计的**通用型**全平台账号与二次验证（2FA）桌面端及移动端保险库。基于 `GoogleAccountVault` 核心加密与隔离沙箱底座重构，采用 **Rust + Tauri 2.0 + Vue 3 + Tailwind CSS** 原生构建，适用于 GitHub、OpenAI、Cloudflare、AWS、Steam、银行、社交媒体等任意平台账号的安全托管。

---

## ✨ 核心亮点与功能特性

### 1. 🛡️ 军工级本地端到端加密
- **AES-256-GCM + Scrypt 密钥派生**：主密码绝不落盘，全字段高强加密保护（`.avault` 格式，兼容导入 `.gvault` 密文）。
- **快照回滚与数据安全**：任何变更前自动创建防灾快照，支持历史版本一键回滚与 CSV/JSON/密文导出。

### 2. 🔑 Windows Hello / 移动端生物识别免密解锁
- **Win32 DPAPI 硬件绑定凭证保护**：主密码安全封装于当前 Windows 用户安全上下文。
- **原生焦点锚定与置顶**：接入 Windows `IUserConsentVerifierInterop` COM 互操作层，生物识别/PIN 验证弹窗前台秒级唤起；移动端支持指纹、面容与锁屏密码。

### 3. ⏱️ RFC 6238 实时 2FA TOTP 动态码 & 备用恢复码
- **精准时间戳倒计时环**：毫秒级实时计算 30 秒 TOTP 六位动态口令，支持二维码识别（选择截图或 `Ctrl+V` 粘贴）与转移二维码生成。
- **通用备用验证码管理**：支持任意格式恢复码录入、可视化核销与「一键复制下一个可用码并核销」。

### 4. 🎲 全功能独立强密码生成器
- **快捷预设模板**：一键切换「标准强密 (20位)」、「超高强度 (32位)」、「纯字母数字 (18位)」与「PIN码 (6位)」。
- **细粒度自定义规则**：6~64位无级滑块调节、字符集自由复选与防混淆字符过滤，支持一键应用至当前选中账号。

### 5. 🌐 通用多账号隔离环境独立浏览器
- **多账号独立持久存储**：为每个账号分配独立的 WebView2 / Android WebView 存储上下文与独立代理 IP，彻底防止多账号关联。
- **全站智能自动填充与悬浮胶囊**：自动识别任意登录页面的用户名/邮箱、密码与 2FA 输入框，并在页面右下角提供可拖拽的快捷凭据悬浮胶囊。
- **外部跳转临时接管 (60s)**：支持拦截外部客户端/CLI 唤起的 OAuth 登录链接，并在指定账号的独立沙箱中打开。

### 6. ☁️ WebDAV 端到端纯密文智能云同步
- **毫秒级 ETag + 时间戳增量合并**：支持坚果云、Nextcloud、Synology 等标准 WebDAV 服务，多设备同步零覆盖风险。

---

## 🚀 快速上手与运行

### 1. 安装项目依赖
```powershell
npm install
```

### 2. 开发模式（支持热重载）
```powershell
npm run tauri dev
```

### 3. 生产环境构建与打包
```powershell
npm run tauri build
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
