<script setup lang="ts">
import {
  Settings,
  X,
  Fingerprint,
  Cloud,
  History,
  RefreshCw,
  Info,
  KeyRound,
  FileText,
  CheckCircle2,
  Globe
} from "lucide-vue-next";

defineProps<{
  visible: boolean;
  appVersion: string;
  settingsTab: "security" | "webdav" | "backups" | "updates" | "about";
  backupTab: "backups" | "export";
  isMobilePlatform: boolean;
  helloStatus: { available: boolean; enrolled: boolean };
  autoSelectFirst: boolean;
  showListAvatar: boolean;
  defaultHomeTab: "totp" | "passwords" | "passkeys";
  autoLockMinutes: number;
  clipboardClearSeconds: number;
  androidAutofillEnabled: boolean;
  browserBridgeStatus: { enabled: boolean; port: number; token: string; running: boolean };
  closeToTray: boolean;
  webdavForm: { url: string; username: string; password: string; auto_sync: boolean };
  webdavStatus: string;
  isWebDavSyncing: boolean;
  syncState: "idle" | "syncing" | "success" | "error";
  lastSyncTimeFormatted: string;
  backupList: Array<{ filename: string; timestamp: string; size_bytes: number }>;
  isCheckingUpdate: boolean;
  isDownloadingUpdate: boolean;
  downloadProgress: number;
  downloadStatusText: string;
  autoCheckUpdateOnStartup: boolean;
  updateMirror: "gh-proxy" | "ghproxy" | "official";
  updateResult: any;
  updateError: string;
  currentInstallTypeName: string;
  parsedReleaseNotes: { title: string; items: Array<{ typeLabel: string; text: string }>; rawText?: string } | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:settingsTab", tab: "security" | "webdav" | "backups" | "updates" | "about"): void;
  (e: "update:backupTab", tab: "backups" | "export"): void;
  (e: "load-webdav"): void;
  (e: "load-backups"): void;
  (e: "toggle-hello"): void;
  (e: "toggle-auto-select"): void;
  (e: "toggle-list-avatar"): void;
  (e: "set-home-tab", tab: "totp" | "passwords" | "passkeys"): void;
  (e: "set-auto-lock", minutes: number): void;
  (e: "set-clipboard-clear", seconds: number): void;
  (e: "open-change-pwd"): void;
  (e: "open-android-autofill"): void;
  (e: "refresh-bridge"): void;
  (e: "toggle-bridge"): void;
  (e: "toggle-close-to-tray"): void;
  (e: "copy-bridge-token"): void;
  (e: "regenerate-bridge-token"): void;
  (e: "save-webdav", showToast: boolean): void;
  (e: "smart-sync"): void;
  (e: "test-webdav"): void;
  (e: "upload-webdav"): void;
  (e: "download-webdav"): void;
  (e: "create-backup"): void;
  (e: "restore-backup", filename: string): void;
  (e: "import-vault"): void;
  (e: "export-avault"): void;
  (e: "export-csv"): void;
  (e: "export-json"): void;
  (e: "check-updates"): void;
  (e: "toggle-auto-update"): void;
  (e: "set-mirror", mirror: "gh-proxy" | "ghproxy" | "official"): void;
  (e: "start-auto-update"): void;
  (e: "open-external", url?: string | null): void;
}>();
</script>

<template>
  <div v-if="visible" class="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
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
        <button @click="emit('close')" class="p-1.5 hover:bg-[#e8eaed] rounded-full text-[#5f6368] cursor-pointer">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-2.5 border-b border-[#f1f3f4] bg-white flex-shrink-0 text-xs font-medium overflow-x-auto no-scrollbar whitespace-nowrap">
        <button @click="emit('update:settingsTab', 'security')" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'security' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
          <Fingerprint class="w-3.5 h-3.5" />
          <span>安全与解锁</span>
        </button>
        <button @click="emit('update:settingsTab', 'webdav'); emit('load-webdav')" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'webdav' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
          <Cloud class="w-3.5 h-3.5" />
          <span>云端同步</span>
        </button>
        <button @click="emit('update:settingsTab', 'backups'); emit('load-backups')" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'backups' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
          <History class="w-3.5 h-3.5" />
          <span>备份与导出</span>
        </button>
        <button @click="emit('update:settingsTab', 'updates')" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'updates' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
          <RefreshCw class="w-3.5 h-3.5" />
          <span>检查更新</span>
        </button>
        <button @click="emit('update:settingsTab', 'about')" :class="['px-3.5 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer', settingsTab === 'about' ? 'bg-[#1a73e8] text-white font-semibold' : 'text-[#5f6368] hover:bg-[#f1f3f4]']">
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
                  @click="emit('toggle-hello')"
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
              <button type="button" @click="emit('toggle-auto-select')" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', autoSelectFirst ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', autoSelectFirst ? 'translate-x-5' : 'translate-x-0']" />
              </button>
            </div>
            <div class="pt-3 border-t border-[#dadce0]/60 flex items-center justify-between gap-3">
              <div>
                <h3 class="text-xs font-bold text-[#202124]">显示账号列表圆形头像</h3>
                <p class="text-[11px] text-[#5f6368] mt-0.5">{{ showListAvatar ? '显示首字母头像' : '极简紧凑模式' }}</p>
              </div>
              <button type="button" @click="emit('toggle-list-avatar')" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', showListAvatar ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', showListAvatar ? 'translate-x-5' : 'translate-x-0']" />
              </button>
            </div>

            <div class="pt-3 border-t border-[#dadce0]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h3 class="text-xs font-bold text-[#202124]">默认启动页（首页）</h3>
                <p class="text-[11px] text-[#5f6368] mt-0.5">设置解锁后默认进入的底部标签页（默认为 OTP）。</p>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                <button
                  v-for="item in ([
                    { key: 'totp', label: 'OTP' },
                    { key: 'passwords', label: '密码' },
                    { key: 'passkeys', label: 'PassKey' }
                  ] as const)"
                  :key="item.key"
                  type="button"
                  @click="emit('set-home-tab', item.key)"
                  :class="[
                    'px-3 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors',
                    defaultHomeTab === item.key
                      ? 'bg-[#1a73e8] text-white border-[#1a73e8]'
                      : 'bg-white text-[#5f6368] border-[#dadce0] hover:bg-[#f1f3f4]'
                  ]"
                >
                  {{ item.label }}
                </button>
              </div>
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
                  <button v-for="m in [0, 5, 15, 30, 60]" :key="m" type="button" @click="emit('set-auto-lock', m)" :class="['px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer', autoLockMinutes === m ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-[#f8fafd] text-[#5f6368] border-[#dadce0]']">
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
                  <button v-for="s in [0, 15, 30, 60]" :key="s" type="button" @click="emit('set-clipboard-clear', s)" :class="['px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer', clipboardClearSeconds === s ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-[#f8fafd] text-[#5f6368] border-[#dadce0]']">
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
            <button type="button" @click="emit('open-change-pwd')" class="px-4 py-2 bg-white hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#1a73e8]/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <KeyRound class="w-3.5 h-3.5" />
              <span>修改主密码</span>
            </button>
          </div>

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
                <button type="button" @click="emit('open-android-autofill')" class="px-3.5 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium cursor-pointer">
                  {{ androidAutofillEnabled ? '管理自动填充' : '去系统设置开启' }}
                </button>
                <button type="button" @click="emit('refresh-bridge')" class="px-2.5 py-1.5 bg-white hover:bg-[#f1f3f4] text-[#5f6368] border border-[#dadce0] rounded-xl text-xs cursor-pointer">
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
              <button type="button" @click="emit('toggle-bridge')" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', browserBridgeStatus.enabled ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', browserBridgeStatus.enabled ? 'translate-x-5' : 'translate-x-0']" />
              </button>
            </div>
            <div class="p-2.5 bg-white rounded-xl border border-[#dadce0]/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-[10px] text-[#80868b]">扩展配对密钥 (仅限本机 127.0.0.1 通信)</div>
                <div class="text-xs font-mono text-[#202124] truncate">{{ browserBridgeStatus.token ? '••••••••••••••••' + browserBridgeStatus.token.slice(-6) : '未生成' }}</div>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                <button type="button" @click="emit('copy-bridge-token')" class="px-3 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-[11px] font-medium cursor-pointer">
                  复制密钥
                </button>
                <button type="button" @click="emit('regenerate-bridge-token')" class="px-2.5 py-1.5 bg-[#f8fafd] hover:bg-[#f1f3f4] text-[#5f6368] border border-[#dadce0] rounded-lg text-[11px] cursor-pointer">
                  重置
                </button>
              </div>
            </div>
            <div class="pt-3 border-t border-[#dadce0]/60 flex items-center justify-between gap-3">
              <div>
                <h4 class="text-xs font-bold text-[#202124]">关闭主窗口时最小化到系统托盘</h4>
                <p class="text-[11px] text-[#5f6368] mt-0.5">关闭窗口后保持托盘驻留与浏览器扩展桥接在线，可在托盘右键菜单彻底退出。</p>
              </div>
              <button type="button" @click="emit('toggle-close-to-tray')" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', closeToTray ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', closeToTray ? 'translate-x-5' : 'translate-x-0']" />
              </button>
            </div>
          </div>
        </div>

        <!-- TAB 2: WEBDAV -->
        <div v-else-if="settingsTab === 'webdav'" class="space-y-4">
          <div class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
            <div class="flex items-center justify-between gap-2 pb-2 border-b border-[#dadce0]/60">
              <span class="text-xs font-bold text-[#202124]">全自动增量智能同步 (Smart Merge)</span>
              <button type="button" @click="webdavForm.auto_sync = !webdavForm.auto_sync; emit('save-webdav', false)" :class="['relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', webdavForm.auto_sync ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
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
            <button type="button" @click="emit('smart-sync')" :disabled="isWebDavSyncing" class="w-full py-2.5 px-3 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-2 cursor-pointer">
              <RefreshCw :class="['w-3.5 h-3.5', isWebDavSyncing ? 'animate-spin' : '']" />
              <span>⚡ 立即执行增量智能合并</span>
            </button>
          </div>

          <div class="p-3.5 sm:p-4 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-3">
            <div class="text-xs font-bold text-[#202124]">WebDAV 服务器配置</div>
            <input type="text" v-model="webdavForm.url" @change="emit('save-webdav', false)" placeholder="https://dav.jianguoyun.com/dav/AccountVault/" class="w-full px-3 py-2 bg-white rounded-xl border border-[#dadce0] text-xs outline-none font-mono" />
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="text" v-model="webdavForm.username" @change="emit('save-webdav', false)" placeholder="账号 / 邮箱" class="w-full px-3 py-2 bg-white rounded-xl border border-[#dadce0] text-xs outline-none" />
              <input type="password" v-model="webdavForm.password" @change="emit('save-webdav', false)" placeholder="应用密码 / Token" class="w-full px-3 py-2 bg-white rounded-xl border border-[#dadce0] text-xs outline-none font-mono" />
            </div>
            <div v-if="webdavStatus" class="p-2.5 bg-white rounded-xl border border-[#dadce0] text-xs text-[#3c4043]">{{ webdavStatus }}</div>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" @click="emit('test-webdav')" :disabled="isWebDavSyncing" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">测试连接</button>
              <button type="button" @click="emit('save-webdav', true)" class="px-4 py-2 bg-white hover:bg-[#f1f3f4] text-[#3c4043] border border-[#dadce0] rounded-xl text-xs font-medium cursor-pointer">保存配置</button>
              <button type="button" @click="emit('upload-webdav')" :disabled="isWebDavSyncing" class="px-3 py-2 bg-white hover:bg-[#f1f3f4] text-[#3c4043] border border-[#dadce0] rounded-xl text-xs font-medium cursor-pointer">强制上传</button>
              <button type="button" @click="emit('download-webdav')" :disabled="isWebDavSyncing" class="px-3 py-2 bg-white hover:bg-[#f1f3f4] text-[#3c4043] border border-[#dadce0] rounded-xl text-xs font-medium cursor-pointer">强制下载</button>
            </div>
          </div>
        </div>

        <!-- TAB 3: BACKUPS & EXPORT -->
        <div v-else-if="settingsTab === 'backups'" class="space-y-4">
          <div class="flex gap-2 p-1 bg-[#f1f3f4] rounded-xl text-xs font-medium">
            <button @click="emit('update:backupTab', 'backups')" :class="['flex-1 py-1.5 px-2 rounded-lg cursor-pointer', backupTab === 'backups' ? 'bg-white text-[#1a73e8] shadow-sm font-semibold' : 'text-[#5f6368]']">历史快照 ({{ backupList.length }})</button>
            <button @click="emit('update:backupTab', 'export')" :class="['flex-1 py-1.5 px-2 rounded-lg cursor-pointer', backupTab === 'export' ? 'bg-white text-[#1a73e8] shadow-sm font-semibold' : 'text-[#5f6368]']">导入与导出</button>
          </div>

          <div v-if="backupTab === 'backups'" class="space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-[#5f6368]">自动保留最近 30 份加密快照</span>
              <button type="button" @click="emit('create-backup')" class="px-3 py-1.5 bg-[#1a73e8] text-white rounded-xl text-xs font-medium cursor-pointer">立即创建快照</button>
            </div>
            <div class="space-y-2 max-h-64 overflow-y-auto">
              <div v-if="backupList.length === 0" class="py-8 text-center text-xs text-[#80868b]">暂无历史快照</div>
              <div v-for="b in backupList" :key="b.filename" class="p-3 bg-[#f8fafd] border border-[#dadce0]/70 rounded-xl flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-mono text-xs font-semibold text-[#202124]">{{ b.timestamp }}</div>
                  <div class="text-[11px] text-[#80868b] font-mono truncate">{{ b.filename }} ({{ (b.size_bytes / 1024).toFixed(1) }} KB)</div>
                </div>
                <button @click="emit('restore-backup', b.filename)" class="px-3 py-1.5 bg-[#e8f0fe] text-[#1a73e8] rounded-lg text-xs font-medium cursor-pointer">回滚</button>
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
                <button @click="emit('import-vault')" class="px-3 py-2 bg-white text-emerald-900 border border-emerald-300 rounded-xl text-xs font-medium cursor-pointer">导入密文</button>
                <button @click="emit('export-avault')" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold cursor-pointer">导出 .avault</button>
              </div>
            </div>

            <div class="p-3.5 bg-[#f8fafd] rounded-2xl border border-[#dadce0] flex items-center justify-between gap-3">
              <div>
                <h3 class="text-xs font-bold text-[#202124]">导出为标准 CSV 表格</h3>
                <p class="text-[11px] text-[#5f6368]">明文表格备份，支持 Excel 打开。</p>
              </div>
              <button @click="emit('export-csv')" class="px-4 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                <FileText class="w-3.5 h-3.5" />
                <span>导出 CSV</span>
              </button>
            </div>

            <div class="p-3.5 bg-[#f8fafd] rounded-2xl border border-[#dadce0] flex items-center justify-between gap-3">
              <div>
                <h3 class="text-xs font-bold text-[#202124]">导出为 JSON 数据</h3>
                <p class="text-[11px] text-[#5f6368]">结构化明文数据备份。</p>
              </div>
              <button @click="emit('export-json')" class="px-4 py-2 bg-white text-[#3c4043] border border-[#dadce0] rounded-xl text-xs font-medium cursor-pointer">导出 JSON</button>
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
              <button @click="emit('check-updates')" :disabled="isCheckingUpdate || isDownloadingUpdate" class="px-4 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium cursor-pointer">
                {{ isCheckingUpdate ? "正在检查..." : "立即检查更新" }}
              </button>
            </div>
            <div class="pt-2 border-t border-[#dadce0]/60 flex items-center justify-between">
              <span class="text-xs font-bold text-[#202124]">启动时自动检查更新</span>
              <button type="button" @click="emit('toggle-auto-update')" :class="['relative inline-flex h-6 w-11 cursor-pointer rounded-full border-2 border-transparent', autoCheckUpdateOnStartup ? 'bg-[#1a73e8]' : 'bg-[#dadce0]']">
                <span :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow transition', autoCheckUpdateOnStartup ? 'translate-x-5' : 'translate-x-0']" />
              </button>
            </div>
            <div class="pt-2 border-t border-[#dadce0]/60 flex flex-wrap gap-1.5">
              <button type="button" @click="emit('set-mirror', 'gh-proxy')" :class="['px-2.5 py-1 rounded-lg text-xs border cursor-pointer', updateMirror === 'gh-proxy' ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']">gh-proxy (推荐)</button>
              <button type="button" @click="emit('set-mirror', 'ghproxy')" :class="['px-2.5 py-1 rounded-lg text-xs border cursor-pointer', updateMirror === 'ghproxy' ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']">ghproxy.net</button>
              <button type="button" @click="emit('set-mirror', 'official')" :class="['px-2.5 py-1 rounded-lg text-xs border cursor-pointer', updateMirror === 'official' ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']">官方直连</button>
            </div>
          </div>

          <div v-if="updateResult" class="p-4 bg-white border border-[#dadce0] rounded-2xl space-y-2 text-xs">
            <div v-if="updateResult.has_update" class="space-y-3">
              <div class="font-bold text-emerald-900">发现新版本：{{ updateResult.latest_version }} ({{ currentInstallTypeName }})</div>
              <div class="flex gap-2">
                <button v-if="!isDownloadingUpdate" @click="emit('start-auto-update')" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold cursor-pointer">一键自动更新</button>
                <button v-if="!isDownloadingUpdate" @click="emit('open-external', updateResult.download_url || updateResult.release_url)" class="px-3 py-2 bg-white border border-emerald-300 text-emerald-800 rounded-xl text-xs cursor-pointer">浏览器下载</button>
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
            <button @click="emit('open-external', 'https://github.com/ifnor/AccountVault')" class="px-3.5 py-1.5 bg-white hover:bg-[#f1f3f4] text-[#202124] border border-[#dadce0] rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
              <Globe class="w-3.5 h-3.5 text-[#1a73e8]" />
              <span>GitHub 项目主页</span>
            </button>
          </div>
        </div>
      </div>

      <div class="px-4 sm:px-6 py-3 border-t border-[#f1f3f4] bg-[#f8fafd] flex justify-end flex-shrink-0">
        <button @click="emit('close')" class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium cursor-pointer">
          完成
        </button>
      </div>
    </div>
  </div>
</template>
