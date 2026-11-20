<script setup lang="ts">
import { ref, watch } from "vue";
import {
  Filter,
  RotateCcw,
  X,
  RefreshCw,
  CheckSquare,
  Square,
  Star,
  Fingerprint,
  Check,
  Copy,
  KeyRound,
  Folder,
  Edit3,
  Sparkles,
  Download,
  Trash2
} from "lucide-vue-next";
import type { AccountRecord, TotpResult } from "../types/vault";
import {
  ACCOUNT_STATUS_OPTIONS,
  getDisplayTitle,
  getPrimaryIdentifier,
  getStatusBadgeClass,
  getExpireBadge
} from "../utils/accountHelpers";
import { useFaviconCache } from "../composables/useFaviconCache";

const props = defineProps<{
  mobileView: "list" | "detail";
  showFilterPanel: boolean;
  activeFilterCount: number;
  attrFilter: {
    statuses: string[];
    totp: "all" | "yes" | "no";
    backupCodes: "all" | "yes" | "no";
    proxy: "all" | "yes" | "no";
    expire: "all" | "expired" | "soon7" | "soon30" | "has_date" | "no_date";
  };
  pullDistance: number;
  isPullRefreshing: boolean;
  filteredRecords: AccountRecord[];
  isBatchSelectMode: boolean;
  selectedBatchIds: string[];
  selectedId: string | null;
  showListAvatar: boolean;
  homeTab: "totp" | "passwords" | "passkeys";
  totpMap: Record<string, TotpResult>;
  copiedField: string | null;
  searchQuery: string;
}>();

const emit = defineEmits<{
  (e: "update:showFilterPanel", value: boolean): void;
  (e: "reset-filter"): void;
  (e: "toggle-status", status: string): void;
  (e: "clear-selection"): void;
  (e: "touch-start", ev: TouchEvent): void;
  (e: "touch-move", ev: TouchEvent): void;
  (e: "touch-end"): void;
  (e: "select-account", id: string): void;
  (e: "toggle-batch-item", id: string): void;
  (e: "edit-account", record: AccountRecord): void;
  (e: "toggle-pin", record: AccountRecord): void;
  (e: "increment-hotp", id: string): void;
  (e: "copy", text: string, fieldKey: string): void;
  (e: "clear-search"): void;
  (e: "batch-pin", pin: boolean): void;
  (e: "batch-update", type: "group" | "status" | "plan"): void;
  (e: "batch-export"): void;
  (e: "batch-delete"): void;
  (e: "scroll-el", el: HTMLElement | null): void;
}>();

const { getFaviconUrl, handleFaviconError } = useFaviconCache();
const scrollContainerRef = ref<HTMLElement | null>(null);
watch(scrollContainerRef, (el) => {
  emit("scroll-el", el);
});
</script>

<template>
  <main
    class="bg-slate-50/40 border-r border-slate-200/80 flex flex-col overflow-hidden"
    :class="[
      mobileView === 'detail' ? 'hidden md:flex' : 'flex flex-1 w-full',
      'md:flex md:flex-1'
    ]"
  >
    <!-- Multi-Attribute Filter Collapsible Panel -->
    <div
      v-if="showFilterPanel"
      class="px-3.5 py-2.5 bg-[#f8fafd] border-b border-[#dadce0] space-y-2.5 text-[11px] select-none flex-shrink-0 max-h-[55vh] overflow-y-auto"
    >
      <div class="flex items-center justify-between">
        <div class="font-semibold text-[#202124] flex items-center gap-1.5">
          <Filter class="w-3.5 h-3.5 text-[#1a73e8]" />
          <span>多维属性组合筛选</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="activeFilterCount > 0"
            type="button"
            @click="emit('reset-filter')"
            class="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-md text-[10px] font-medium flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw class="w-2.5 h-2.5" />
            <span>重置筛选</span>
          </button>
          <button type="button" @click="emit('update:showFilterPanel', false)" class="p-0.5 text-[#5f6368] hover:text-[#202124] rounded cursor-pointer">
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-[#5f6368] w-16 flex-shrink-0">账号状态：</span>
        <button
          type="button"
          @click="props.attrFilter.statuses = []"
          :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.statuses.length === 0 ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
        >
          不限
        </button>
        <button
          v-for="st in ACCOUNT_STATUS_OPTIONS"
          :key="st"
          type="button"
          @click="emit('toggle-status', st)"
          :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.statuses.includes(st) ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8] font-semibold' : 'bg-white text-[#5f6368] border-[#dadce0]']"
        >
          {{ st }}
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div class="flex flex-wrap items-center gap-1">
          <span class="text-[#5f6368] w-16 flex-shrink-0">2FA 密钥：</span>
          <button
            v-for="opt in [{ k: 'all', l: '不限' }, { k: 'yes', l: '已绑 2FA' }, { k: 'no', l: '未绑 2FA' }]"
            :key="opt.k"
            type="button"
            @click="props.attrFilter.totp = opt.k as any"
            :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.totp === opt.k ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
          >
            {{ opt.l }}
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-1">
          <span class="text-[#5f6368] w-16 flex-shrink-0">备用恢复码：</span>
          <button
            v-for="opt in [{ k: 'all', l: '不限' }, { k: 'yes', l: '有可用码' }, { k: 'no', l: '无/已耗尽' }]"
            :key="opt.k"
            type="button"
            @click="props.attrFilter.backupCodes = opt.k as any"
            :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.backupCodes === opt.k ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
          >
            {{ opt.l }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div class="flex flex-wrap items-center gap-1">
          <span class="text-[#5f6368] w-16 flex-shrink-0">独立代理：</span>
          <button
            v-for="opt in [{ k: 'all', l: '不限' }, { k: 'yes', l: '已配代理' }, { k: 'no', l: '直连(未配)' }]"
            :key="opt.k"
            type="button"
            @click="props.attrFilter.proxy = opt.k as any"
            :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.proxy === opt.k ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
          >
            {{ opt.l }}
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-1">
          <span class="text-[#5f6368] w-16 flex-shrink-0">到期状态：</span>
          <button
            v-for="opt in [{ k: 'all', l: '不限' }, { k: 'expired', l: '已过期' }, { k: 'soon7', l: '7天内' }, { k: 'soon30', l: '30天内' }]"
            :key="opt.k"
            type="button"
            @click="props.attrFilter.expire = opt.k as any"
            :class="['px-2 py-0.5 rounded-md border text-[11px] cursor-pointer', attrFilter.expire === opt.k ? 'bg-[#1a73e8] text-white border-[#1a73e8]' : 'bg-white text-[#5f6368] border-[#dadce0]']"
          >
            {{ opt.l }}
          </button>
        </div>
      </div>
    </div>

    <div
      ref="scrollContainerRef"
      @touchstart.passive="emit('touch-start', $event)"
      @touchmove.passive="emit('touch-move', $event)"
      @touchend="emit('touch-end')"
      class="flex-1 overflow-y-auto px-2.5 py-2 space-y-1.5 pb-24"
      @click.self="emit('clear-selection')"
    >
      <!-- Pull-to-Refresh Indicator -->
      <div
        v-if="pullDistance > 0 || isPullRefreshing"
        class="flex items-center justify-center gap-2 text-xs font-medium text-[#1a73e8] overflow-hidden transition-all duration-150"
        :style="{ height: `${pullDistance}px` }"
      >
        <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': isPullRefreshing }" />
        <span>{{ isPullRefreshing ? '正在同步刷新...' : pullDistance >= 52 ? '松手立即刷新' : '下拉刷新列表' }}</span>
      </div>

      <div
        v-for="r in filteredRecords"
        :key="r.id"
        @click="isBatchSelectMode ? emit('toggle-batch-item', r.id) : emit('select-account', r.id)"
        @dblclick="emit('edit-account', r)"
        :class="[
          'px-3.5 py-3 rounded-2xl border flex items-center justify-between gap-3 cursor-pointer transition-all',
          isBatchSelectMode && selectedBatchIds.includes(r.id)
            ? 'bg-blue-50/80 border-blue-300 shadow-2xs'
            : selectedId === r.id
            ? 'bg-white border-[#1a73e8]/50 ring-2 ring-[#1a73e8]/15 shadow-xs'
            : r.is_pinned
            ? 'bg-amber-50/40 hover:bg-white border-amber-200/70 shadow-2xs'
            : 'bg-white/90 hover:bg-white border-slate-200/70 hover:border-slate-300 shadow-2xs'
        ]"
      >
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <button
            v-if="isBatchSelectMode"
            type="button"
            @click.stop="emit('toggle-batch-item', r.id)"
            class="text-[#1a73e8] flex-shrink-0 cursor-pointer"
          >
            <CheckSquare v-if="selectedBatchIds.includes(r.id)" class="w-4 h-4 text-[#1a73e8]" />
            <Square v-else class="w-4 h-4 text-slate-400" />
          </button>

          <div
            v-if="showListAvatar"
            :class="[
              'w-10 h-10 rounded-xl font-bold text-sm flex items-center justify-center flex-shrink-0 relative shadow-2xs',
              getFaviconUrl(r) ? 'bg-white border border-slate-200/80' : 'bg-blue-50 text-[#1a73e8] border border-blue-100'
            ]"
          >
            <img
              v-if="getFaviconUrl(r)"
              :src="getFaviconUrl(r)!"
              @error="handleFaviconError(r)"
              alt=""
              class="w-6 h-6 rounded-md object-contain"
              loading="lazy"
            />
            <span v-else>{{ (getDisplayTitle(r)[0] || getPrimaryIdentifier(r)[0] || 'A').toUpperCase() }}</span>
            <button
              type="button"
              @click.stop="emit('toggle-pin', r)"
              :class="[
                'w-4 h-4 rounded-full flex items-center justify-center absolute -bottom-1 -right-1 transition-all cursor-pointer shadow-2xs ring-1 ring-white',
                r.is_pinned
                  ? 'bg-amber-50 text-amber-400 hover:scale-110'
                  : 'bg-white text-slate-300 hover:text-amber-400 hover:scale-110'
              ]"
              :title="r.is_pinned ? '取消星标置顶' : '设为星标置顶'"
            >
              <Star class="w-2.5 h-2.5" :class="r.is_pinned ? 'text-amber-400 fill-amber-400' : 'text-slate-300'" />
            </button>
          </div>

          <div class="min-w-0 flex-1">
            <div class="text-[13px] font-bold text-slate-900 flex items-center gap-1.5 min-w-0">
              <button
                v-if="!showListAvatar"
                type="button"
                @click.stop="emit('toggle-pin', r)"
                class="p-0.5 -ml-0.5 rounded-full hover:bg-black/5 transition-colors flex-shrink-0 cursor-pointer"
              >
                <Star class="w-3.5 h-3.5" :class="r.is_pinned ? 'text-amber-400 fill-amber-400' : 'text-slate-300'" />
              </button>
              <span class="truncate">{{ getDisplayTitle(r) }}</span>
              <span v-if="r.status && r.status !== '正常'" :class="[getStatusBadgeClass(r.status), 'hidden md:inline-flex flex-shrink-0']">{{ r.status }}</span>
              <span v-if="r.expire_at && getExpireBadge(r.expire_at)" :class="[getExpireBadge(r.expire_at)?.class, 'hidden md:inline-flex flex-shrink-0']">
                {{ getExpireBadge(r.expire_at)?.label }}
              </span>
            </div>

            <div class="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5 min-w-0">
              <span class="truncate font-medium text-slate-600">{{ getPrimaryIdentifier(r) || r.email || '未填账号' }}</span>
              <span v-if="r.group" class="px-1.5 py-0.2 bg-slate-100 text-slate-500 rounded-md text-[10px] flex-shrink-0">{{ r.group }}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <!-- PassKey Tab trailing info -->
          <div v-if="homeTab === 'passkeys'" class="flex items-center gap-1.5">
            <span class="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 text-[11px] font-semibold flex items-center gap-1">
              <Fingerprint class="w-3.5 h-3.5" />
              <span>{{ r.passkeys?.length || 0 }} 个通行密钥</span>
            </span>
          </div>

          <!-- TOTP / HOTP Tab trailing info -->
          <div v-else-if="homeTab === 'totp'" class="flex flex-col items-end">
            <div class="flex items-center gap-1.5 font-mono text-base font-extrabold tracking-wider text-[#1a73e8]">
              <span>{{ totpMap[r.id]?.code || "••••••" }}</span>
              <button
                v-if="totpMap[r.id]?.otp_type === 'hotp'"
                @click.stop="emit('increment-hotp', r.id)"
                class="p-1 rounded-lg hover:bg-[#e8f0fe] text-[#1a73e8] cursor-pointer"
                title="生成下一位 HOTP 验证码 (+1)"
              >
                <RefreshCw class="w-3.5 h-3.5" />
              </button>
              <button
                @click.stop="emit('copy', totpMap[r.id]?.code || '', r.id + '-totp')"
                class="p-1 rounded-lg hover:bg-[#e8f0fe] text-[#5f6368] hover:text-[#1a73e8] cursor-pointer"
                title="复制动态验证码"
              >
                <Check v-if="copiedField === r.id + '-totp'" class="w-3.5 h-3.5 text-emerald-600" />
                <Copy v-else class="w-3.5 h-3.5" />
              </button>
            </div>
            <span v-if="totpMap[r.id]?.otp_type === 'hotp'" class="text-[10px] text-indigo-600 font-mono">
              HOTP · #{{ totpMap[r.id]?.counter ?? 0 }}
            </span>
            <span v-else class="text-[10px] text-[#80868b] font-mono">{{ totpMap[r.id]?.remaining_seconds || 30 }}s 剩余</span>
          </div>

          <!-- Passwords Tab trailing info -->
          <template v-else>
            <button
              v-if="r.password"
              type="button"
              @click.stop="emit('copy', r.password || '', r.id + '-pwd-quick')"
              class="px-2 py-1 rounded-lg bg-[#f1f3f4] hover:bg-[#e8f0fe] text-[#3c4043] hover:text-[#1a73e8] text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
              title="一键复制密码"
            >
              <Check v-if="copiedField === r.id + '-pwd-quick'" class="w-3 h-3 text-emerald-600" />
              <KeyRound v-else class="w-3 h-3" />
              <span class="hidden sm:inline">{{ copiedField === r.id + '-pwd-quick' ? '已复制' : '复制密码' }}</span>
            </button>
            <div v-if="r.totp" class="flex flex-col items-end">
              <div class="flex items-center gap-1 font-mono text-xs font-bold text-[#1a73e8]">
                <span>{{ totpMap[r.id]?.code || "••••••" }}</span>
                <button
                  @click.stop="emit('copy', totpMap[r.id]?.code || '', r.id + '-totp')"
                  class="text-[#5f6368] hover:text-[#1a73e8] cursor-pointer"
                  title="复制动态验证码"
                >
                  <Check v-if="copiedField === r.id + '-totp'" class="w-3 h-3 text-emerald-600" />
                  <Copy v-else class="w-3 h-3" />
                </button>
              </div>
              <span class="text-[10px] text-[#80868b] font-mono">{{ totpMap[r.id]?.remaining_seconds || 30 }}s</span>
            </div>
            <span v-if="r.passkeys && r.passkeys.length > 0" class="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-semibold hidden sm:inline-flex items-center gap-0.5">
              <Fingerprint class="w-3 h-3" />
              <span>{{ r.passkeys.length }}</span>
            </span>
          </template>
        </div>
      </div>

      <div v-if="filteredRecords.length === 0" class="p-8 text-center text-xs text-[#80868b] space-y-2">
        <div>
          {{
            homeTab === 'totp'
              ? '暂无已配置 TOTP 动态口令的账号'
              : homeTab === 'passkeys'
              ? '暂无已保存 PassKey 的账号（可在浏览器扩展创建通行密钥后自动同步）'
              : '暂无匹配的账号记录'
          }}
        </div>
        <button
          v-if="activeFilterCount > 0 || searchQuery"
          type="button"
          @click="emit('reset-filter'); emit('clear-search')"
          class="px-3 py-1 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] rounded-lg text-[11px] font-medium cursor-pointer"
        >
          清除全部筛选与搜索条件
        </button>
      </div>
    </div>

    <!-- Batch Action Bottom Toolbar -->
    <div
      v-if="isBatchSelectMode"
      class="px-3 py-2 bg-[#edf2fa] border-t border-[#1a73e8]/30 flex flex-wrap items-center justify-between gap-2 flex-shrink-0"
    >
      <span class="text-xs font-semibold text-[#1a73e8]">已选 {{ selectedBatchIds.length }} 项</span>
      <div class="flex flex-wrap items-center gap-1.5">
        <button type="button" @click="emit('batch-pin', true)" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-amber-50 text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
          <Star class="w-3 h-3 text-amber-500 fill-amber-400" />
          <span>置顶</span>
        </button>
        <button type="button" @click="emit('batch-update', 'group')" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
          <Folder class="w-3 h-3 text-[#1a73e8]" />
          <span>改分组</span>
        </button>
        <button type="button" @click="emit('batch-update', 'status')" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
          <Edit3 class="w-3 h-3 text-[#1a73e8]" />
          <span>改状态</span>
        </button>
        <button type="button" @click="emit('batch-update', 'plan')" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
          <Sparkles class="w-3 h-3 text-[#1a73e8]" />
          <span>改套餐</span>
        </button>
        <button type="button" @click="emit('batch-export')" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#3c4043] border border-[#dadce0] rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
          <Download class="w-3 h-3 text-[#1a73e8]" />
          <span>导出选中</span>
        </button>
        <button type="button" @click="emit('batch-delete')" :disabled="selectedBatchIds.length === 0" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer">
          <Trash2 class="w-3 h-3" />
          <span>批量删除</span>
        </button>
      </div>
    </div>
  </main>
</template>
