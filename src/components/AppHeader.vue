<script setup lang="ts">
import {
  Sparkles,
  Search,
  X,
  Plus,
  QrCode,
  KeyRound,
  Upload,
  RefreshCw,
  Cloud,
  Settings,
  Lock,
  MoreVertical
} from "lucide-vue-next";

defineProps<{
  searchQuery: string;
  showMobileSearch: boolean;
  showMobileMoreMenu: boolean;
  syncState: "idle" | "syncing" | "success" | "error";
  syncTooltip: string;
  webdavUrl: string;
  webdavAutoSync: boolean;
  helloEnrolled: boolean;
  hasUpdate: boolean;
  latestVersion?: string;
  groups: Array<{ key: string | null; label: string; count: number }>;
  currentGroup: string | null;
}>();

const emit = defineEmits<{
  (e: "update:searchQuery", value: string): void;
  (e: "update:showMobileSearch", value: boolean): void;
  (e: "update:showMobileMoreMenu", value: boolean): void;
  (e: "select-group", key: string | null): void;
  (e: "open-add"): void;
  (e: "open-quick-scan"): void;
  (e: "open-password-gen"): void;
  (e: "open-batch-import"): void;
  (e: "smart-sync"): void;
  (e: "open-settings", tab: "security" | "updates"): void;
  (e: "lock"): void;
}>();
</script>

<template>
  <!-- 2.1 DESKTOP HEADER (md and above) -->
  <header class="hidden md:flex h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-5 items-center justify-between gap-4 flex-shrink-0 z-10">
    <div class="flex items-center gap-2.5 min-w-0">
      <div class="w-8 h-8 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center p-0.5 overflow-hidden shadow-2xs flex-shrink-0">
        <img src="/logo.png" alt="Logo" class="w-full h-full object-contain" />
      </div>
      <div class="flex items-center gap-2">
        <span class="font-bold text-[15px] text-slate-900 tracking-tight">账号管家</span>
        <button
          v-if="hasUpdate"
          @click="emit('open-settings', 'updates')"
          class="text-[11px] font-semibold px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full flex items-center gap-1 transition-colors cursor-pointer"
          title="点击前往检查更新并一键升级"
        >
          <Sparkles class="w-3 h-3 text-emerald-600" />
          <span>{{ latestVersion }}</span>
        </button>
      </div>
    </div>

    <!-- Search Bar -->
    <div class="flex-1 max-w-lg relative">
      <Search class="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        :value="searchQuery"
        @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
        placeholder="搜索平台、账号、邮箱或备注..."
        class="w-full h-9 pl-9 pr-8 bg-slate-100/90 hover:bg-slate-100 focus:bg-white rounded-xl border border-transparent focus:border-blue-500/60 focus:ring-4 focus:ring-blue-500/10 outline-none text-xs text-slate-900 placeholder:text-slate-400 transition-all"
      />
      <button
        v-if="searchQuery"
        @click="emit('update:searchQuery', '')"
        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
      >
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Right Toolbar Actions -->
    <div class="flex items-center gap-1.5">
      <button
        @click="emit('open-add')"
        class="h-9 px-3.5 bg-gradient-to-r from-[#1a73e8] to-[#4f46e5] hover:brightness-105 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
      >
        <Plus class="w-4 h-4" />
        <span>新建</span>
      </button>

      <button
        @click="emit('open-quick-scan')"
        class="h-9 px-3 bg-slate-100/90 hover:bg-blue-50 text-slate-700 hover:text-[#1a73e8] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
        title="扫码添加 TOTP / PassKey"
      >
        <QrCode class="w-4 h-4 text-[#1a73e8]" />
        <span>扫码</span>
      </button>

      <button
        @click="emit('open-password-gen')"
        class="w-9 h-9 bg-slate-100/80 hover:bg-slate-200/70 text-slate-700 rounded-xl flex items-center justify-center transition-all cursor-pointer"
        title="强随机密码生成器"
      >
        <KeyRound class="w-4 h-4 text-[#1a73e8]" />
      </button>

      <button
        @click="emit('open-batch-import')"
        class="w-9 h-9 bg-slate-100/80 hover:bg-slate-200/70 text-slate-700 rounded-xl flex items-center justify-center transition-all cursor-pointer"
        title="批量导入账号 (Chrome/Edge/密码管理器)"
      >
        <Upload class="w-4 h-4 text-[#1a73e8]" />
      </button>

      <button
        @click="emit('smart-sync')"
        :disabled="syncState === 'syncing'"
        class="w-9 h-9 bg-slate-100/80 hover:bg-slate-200/70 text-slate-700 rounded-xl flex items-center justify-center transition-all relative cursor-pointer disabled:opacity-75"
        :title="`WebDAV 云同步: ${syncTooltip}`"
      >
        <RefreshCw v-if="syncState === 'syncing'" class="w-4 h-4 text-[#1a73e8] animate-spin" />
        <Cloud
          v-else
          :class="[
            'w-4 h-4',
            syncState === 'error' ? 'text-rose-500' :
            syncState === 'success' ? 'text-emerald-500' :
            webdavUrl ? 'text-[#1a73e8]' : 'text-slate-400'
          ]"
        />
        <span
          v-if="webdavUrl && webdavAutoSync"
          :class="[
            'w-1.5 h-1.5 rounded-full absolute top-2 right-2',
            syncState === 'syncing' ? 'bg-[#1a73e8] animate-ping' :
            syncState === 'error' ? 'bg-rose-500' :
            'bg-emerald-500'
          ]"
        ></span>
      </button>

      <button
        @click="emit('open-settings', 'security')"
        class="w-9 h-9 bg-slate-100/80 hover:bg-slate-200/70 text-slate-700 rounded-xl flex items-center justify-center transition-all relative cursor-pointer"
        title="设置与偏好"
      >
        <Settings class="w-4 h-4 text-slate-600" />
        <span v-if="helloEnrolled" class="w-1.5 h-1.5 rounded-full bg-emerald-500 absolute top-2 right-2"></span>
      </button>

      <button
        @click="emit('lock')"
        class="w-9 h-9 bg-slate-100/80 hover:bg-rose-50 text-slate-600 hover:text-rose-600 rounded-xl flex items-center justify-center transition-all cursor-pointer"
        title="锁定保险库"
      >
        <Lock class="w-4 h-4" />
      </button>
    </div>
  </header>

  <!-- 2.2 MOBILE HEADER (< md) -->
  <header class="md:hidden bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex flex-col flex-shrink-0 z-20">
    <div class="h-14 px-4 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden">
        <div class="w-8 h-8 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center p-0.5 overflow-hidden shadow-2xs flex-shrink-0">
          <img src="/logo.png" alt="Logo" class="w-full h-full object-contain" />
        </div>
        <span class="font-bold text-[15px] text-slate-900 tracking-tight truncate">账号管家</span>
      </div>

      <div class="flex items-center gap-1.5 flex-shrink-0">
        <button
          @click="emit('update:showMobileSearch', !showMobileSearch)"
          class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          :class="{ 'bg-blue-50 text-[#1a73e8]': showMobileSearch || searchQuery }"
          title="搜索"
        >
          <Search class="w-4 h-4" />
        </button>

        <button
          @click="emit('smart-sync')"
          :disabled="syncState === 'syncing'"
          class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors relative cursor-pointer disabled:opacity-75"
        >
          <RefreshCw v-if="syncState === 'syncing'" class="w-4 h-4 text-[#1a73e8] animate-spin" />
          <Cloud
            v-else
            :class="[
              'w-4 h-4',
              syncState === 'error' ? 'text-rose-500' :
              syncState === 'success' ? 'text-emerald-500' :
              webdavUrl ? 'text-[#1a73e8]' : 'text-slate-400'
            ]"
          />
        </button>

        <button
          @click="emit('open-add')"
          class="w-9 h-9 rounded-xl bg-gradient-to-r from-[#1a73e8] to-[#4f46e5] text-white flex items-center justify-center shadow-xs cursor-pointer"
          title="添加新账号"
        >
          <Plus class="w-4 h-4" />
        </button>

        <button
          @click="emit('open-quick-scan')"
          class="w-9 h-9 rounded-xl bg-slate-100 text-[#1a73e8] flex items-center justify-center cursor-pointer"
          title="扫码添加 TOTP / PassKey"
        >
          <QrCode class="w-4 h-4" />
        </button>

        <div class="relative">
          <button
            @click="emit('update:showMobileMoreMenu', !showMobileMoreMenu)"
            class="w-8 h-8 rounded-full flex items-center justify-center text-[#5f6368] hover:bg-[#f1f3f4] transition-colors cursor-pointer"
          >
            <MoreVertical class="w-4 h-4" />
          </button>

          <div
            v-if="showMobileMoreMenu"
            class="absolute right-0 top-10 w-46 bg-white rounded-2xl shadow-xl border border-[#dadce0] p-1.5 z-50 text-xs font-medium space-y-0.5"
          >
            <button
              @click="emit('update:showMobileMoreMenu', false); emit('open-add')"
              class="w-full px-3 py-2 text-left bg-[#e8f0fe]/70 hover:bg-[#e8f0fe] text-[#1a73e8] font-semibold rounded-xl flex items-center gap-2 cursor-pointer"
            >
              <Plus class="w-3.5 h-3.5 text-[#1a73e8]" />
              <span>添加新账号</span>
            </button>
            <button
              @click="emit('update:showMobileMoreMenu', false); emit('open-batch-import')"
              class="w-full px-3 py-2 text-left hover:bg-[#f1f3f4] rounded-xl flex items-center gap-2 text-[#3c4043] cursor-pointer"
            >
              <Upload class="w-3.5 h-3.5 text-[#1a73e8]" />
              <span>批量导入</span>
            </button>
            <button
              @click="emit('update:showMobileMoreMenu', false); emit('open-password-gen')"
              class="w-full px-3 py-2 text-left hover:bg-[#f1f3f4] rounded-xl flex items-center gap-2 text-[#3c4043] cursor-pointer"
            >
              <KeyRound class="w-3.5 h-3.5 text-[#1a73e8]" />
              <span>密码生成器</span>
            </button>
            <button
              @click="emit('update:showMobileMoreMenu', false); emit('open-settings', 'security')"
              class="w-full px-3 py-2 text-left hover:bg-[#f1f3f4] rounded-xl flex items-center justify-between text-[#3c4043] cursor-pointer"
            >
              <div class="flex items-center gap-2">
                <Settings class="w-3.5 h-3.5 text-[#1a73e8]" />
                <span>设置与偏好</span>
              </div>
            </button>
            <div class="border-t border-[#f1f3f4] my-1"></div>
            <button
              @click="emit('update:showMobileMoreMenu', false); emit('lock')"
              class="w-full px-3 py-2 text-left hover:bg-rose-50 text-rose-600 rounded-xl flex items-center gap-2 cursor-pointer"
            >
              <Lock class="w-3.5 h-3.5" />
              <span>锁定保险库</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showMobileSearch || searchQuery" class="px-3 pb-2 pt-0 flex items-center gap-2">
      <div class="flex-1 relative">
        <Search class="w-3.5 h-3.5 text-[#5f6368] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          :value="searchQuery"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          placeholder="搜索平台、账号、分组或备注..."
          class="w-full pl-8 pr-7 py-1.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] outline-none text-xs text-[#202124]"
        />
        <button v-if="searchQuery" @click="emit('update:searchQuery', '')" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#5f6368] cursor-pointer">
          <X class="w-3 h-3" />
        </button>
      </div>
    </div>

    <div class="flex items-center gap-1.5 px-3 py-1.5 bg-[#f8fafd] border-t border-[#dadce0]/60 overflow-x-auto no-scrollbar flex-shrink-0">
      <button
        v-for="g in groups"
        :key="g.label"
        @click="emit('select-group', g.key)"
        :class="[
          'px-2.5 py-1 rounded-full text-xs whitespace-nowrap flex items-center gap-1 transition-all flex-shrink-0 font-medium cursor-pointer',
          currentGroup === g.key
            ? 'bg-[#1a73e8] text-white font-semibold shadow-2xs'
            : 'bg-white text-[#5f6368] border border-[#dadce0] hover:bg-[#f1f3f4]'
        ]"
      >
        <span>{{ g.label }}</span>
        <span class="text-[10px] opacity-80 font-mono">({{ g.count }})</span>
      </button>
    </div>
  </header>
</template>
