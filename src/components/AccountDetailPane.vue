<script setup lang="ts">
import {
  ChevronLeft,
  Edit3,
  Trash2,
  Star,
  X,
  ExternalLink,
  Zap,
  Compass,
  Check,
  Copy,
  EyeOff,
  Eye,
  Clock,
  RefreshCw,
  QrCode,
  Fingerprint,
  KeyRound,
  Shield
} from "lucide-vue-next";
import type { AccountRecord, TotpResult } from "../types/vault";
import {
  getDisplayTitle,
  getPrimaryIdentifier,
  getStatusBadgeClass,
  getExpireBadge
} from "../utils/accountHelpers";
import { useFaviconCache } from "../composables/useFaviconCache";

defineProps<{
  mobileView: "list" | "detail";
  isDesktopWindow: boolean;
  isMobilePlatform: boolean;
  detailWidth: number;
  selectedRecord: AccountRecord | null;
  isOpeningBrowser: boolean;
  isTakeoverActive: boolean;
  isTakeoverForCurrent: boolean;
  takeoverRemainingSec: number;
  showPassword: boolean;
  copiedField: string | null;
  totpResult?: TotpResult;
  parsedBackupCodesCount: number;
  unusedBackupCodesCount: number;
}>();

const emit = defineEmits<{
  (e: "back-to-list"): void;
  (e: "clear-selection"): void;
  (e: "edit", record: AccountRecord): void;
  (e: "delete", id: string): void;
  (e: "toggle-pin", record: AccountRecord): void;
  (e: "open-in-app", url: string): void;
  (e: "open-custom-url"): void;
  (e: "toggle-takeover", record: AccountRecord): void;
  (e: "stop-takeover"): void;
  (e: "toggle-password"): void;
  (e: "copy", text: string, fieldKey: string, label?: string): void;
  (e: "increment-hotp", id: string): void;
  (e: "open-totp-qr", record: AccountRecord): void;
  (e: "consume-backup-code"): void;
  (e: "open-backup-codes"): void;
}>();

const { getFaviconUrl, handleFaviconError } = useFaviconCache();
</script>

<template>
  <aside
    class="bg-slate-50/70 flex flex-col overflow-y-auto p-4 pb-24 gap-3 border-l border-slate-200/80 flex-shrink-0"
    :class="[
      mobileView === 'detail' ? 'flex flex-1 w-full' : 'hidden md:flex',
      'md:flex md:flex-none'
    ]"
    :style="isDesktopWindow && !isMobilePlatform ? { width: `${detailWidth}px` } : {}"
  >
    <template v-if="selectedRecord">
      <!-- Mobile Back Navigation Header -->
      <div class="md:hidden flex items-center justify-between pb-2 border-b border-[#dadce0]/70 flex-shrink-0">
        <button
          @click="emit('back-to-list')"
          class="px-3 py-1.5 bg-white text-[#1a73e8] border border-[#dadce0] rounded-xl text-xs font-semibold flex items-center gap-1 shadow-2xs cursor-pointer"
        >
          <ChevronLeft class="w-4 h-4" />
          <span>返回账号列表</span>
        </button>
        <div class="flex items-center gap-1.5">
          <button @click="emit('edit', selectedRecord)" class="px-2.5 py-1.5 bg-white text-[#5f6368] border border-[#dadce0] rounded-xl text-xs font-medium flex items-center gap-1 cursor-pointer">
            <Edit3 class="w-3.5 h-3.5 text-[#1a73e8]" />
            <span>编辑</span>
          </button>
          <button @click="emit('delete', selectedRecord.id)" class="px-2.5 py-1.5 bg-white text-rose-600 border border-[#dadce0] rounded-xl text-xs font-medium flex items-center gap-1 cursor-pointer">
            <Trash2 class="w-3.5 h-3.5" />
            <span>删除</span>
          </button>
        </div>
      </div>

      <!-- Account Header Card -->
      <div class="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
        <div class="flex items-center gap-3 mb-3.5">
          <div
            :class="[
              'w-12 h-12 rounded-2xl font-bold text-lg flex items-center justify-center flex-shrink-0 shadow-2xs',
              getFaviconUrl(selectedRecord) ? 'bg-white border border-slate-200/80' : 'bg-blue-50 text-[#1a73e8] border border-blue-100'
            ]"
          >
            <img
              v-if="getFaviconUrl(selectedRecord)"
              :src="getFaviconUrl(selectedRecord)!"
              @error="handleFaviconError(selectedRecord)"
              alt=""
              class="w-7 h-7 rounded-lg object-contain"
            />
            <span v-else>{{ (getDisplayTitle(selectedRecord)[0] || getPrimaryIdentifier(selectedRecord)[0] || 'A').toUpperCase() }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-1.5">
              <div class="text-sm font-bold text-slate-900 truncate">{{ getDisplayTitle(selectedRecord) }}</div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                <button type="button" @click="emit('toggle-pin', selectedRecord)" class="p-1 rounded-lg hover:bg-slate-100 cursor-pointer">
                  <Star class="w-4 h-4" :class="selectedRecord.is_pinned ? 'text-amber-400 fill-amber-400' : 'text-slate-300'" />
                </button>
                <span v-if="selectedRecord.status && selectedRecord.status !== '正常'" :class="getStatusBadgeClass(selectedRecord.status)">{{ selectedRecord.status }}</span>
                <button
                  @click="emit('clear-selection')"
                  class="hidden md:flex p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                  title="取消选中 (Esc)"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div class="text-xs text-slate-500 truncate mt-0.5">{{ getPrimaryIdentifier(selectedRecord) || selectedRecord.email || '未填账号' }}</div>
          </div>
        </div>

        <!-- Quick Launch Buttons -->
        <div class="grid grid-cols-3 gap-2">
          <button
            @click="selectedRecord.login_url ? emit('open-in-app', selectedRecord.login_url) : emit('open-custom-url')"
            :disabled="isOpeningBrowser"
            class="h-8 px-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shadow-2xs cursor-pointer"
            :title="selectedRecord.login_url ? `在独立会话窗口打开 ${selectedRecord.login_url}` : '输入或选择网站在独立会话中打开'"
          >
            <ExternalLink class="w-3.5 h-3.5" />
            <span>打开网页</span>
          </button>
          <button
            @click="emit('toggle-takeover', selectedRecord)"
            :class="[
              'h-8 px-2 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer',
              isTakeoverForCurrent
                ? 'bg-indigo-600 text-white shadow-xs animate-pulse'
                : 'bg-blue-50 hover:bg-blue-100 text-[#1a73e8]'
            ]"
          >
            <Zap class="w-3.5 h-3.5 flex-shrink-0" />
            <span class="truncate">
              {{ isTakeoverForCurrent ? `接管中 ${takeoverRemainingSec}s` : '接管登录' }}
            </span>
          </button>
          <button
            @click="emit('open-custom-url')"
            class="h-8 px-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer"
          >
            <Compass class="w-3.5 h-3.5 text-[#1a73e8]" />
            <span>更多网址</span>
          </button>

          <div
            v-if="isTakeoverActive"
            class="col-span-3 px-2.5 py-1.5 bg-[#e8f0fe]/90 border border-[#1a73e8]/30 rounded-xl flex items-center justify-between gap-2 text-[11px] text-[#174ea6]"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-2 h-2 rounded-full bg-[#1a73e8] animate-ping flex-shrink-0"></span>
              <span class="truncate font-medium">正在接管外部跳转 ({{ takeoverRemainingSec }}s)</span>
            </div>
            <button type="button" @click="emit('stop-takeover')" class="px-2 py-0.5 bg-white text-[#1a73e8] rounded-md font-semibold cursor-pointer border border-[#1a73e8]/20">
              停止
            </button>
          </div>
        </div>
      </div>

      <!-- Credentials & Structured Info -->
      <div class="bg-white rounded-2xl p-3 border border-[#dadce0]/80 shadow-2xs space-y-2.5">
        <div class="flex items-start justify-between gap-2.5 pb-2 border-b border-[#f1f3f4]">
          <div class="min-w-0 flex-1">
            <div class="text-[10px] text-[#5f6368]">登录账号 / 用户名</div>
            <div class="font-mono text-xs font-semibold text-[#202124] mt-0.5 select-all break-all">
              {{ getPrimaryIdentifier(selectedRecord) || "未记录" }}
            </div>
          </div>
          <button
            @click="emit('copy', getPrimaryIdentifier(selectedRecord), 'username', '已复制登录账号')"
            class="p-1.5 hover:bg-[#f1f3f4] rounded-lg text-[#5f6368] transition-colors cursor-pointer"
            title="复制账号"
          >
            <Check v-if="copiedField === 'username'" class="w-3.5 h-3.5 text-emerald-600" />
            <Copy v-else class="w-3.5 h-3.5" />
          </button>
        </div>

        <div class="flex items-start justify-between gap-2.5 pb-2 border-b border-[#f1f3f4]">
          <div class="min-w-0 flex-1">
            <div class="text-[10px] text-[#5f6368]">登录密码</div>
            <div class="font-mono text-xs font-semibold text-[#202124] tracking-wide mt-0.5 select-all break-all leading-relaxed">
              {{ showPassword ? (selectedRecord.password || "未记录") : "••••••••••••" }}
            </div>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0 pt-0.5">
            <button @click="emit('toggle-password')" class="p-1.5 hover:bg-[#f1f3f4] rounded-lg text-[#5f6368] cursor-pointer" title="显示 / 隐藏">
              <EyeOff v-if="showPassword" class="w-3.5 h-3.5" />
              <Eye v-else class="w-3.5 h-3.5" />
            </button>
            <button @click="emit('copy', selectedRecord.password || '', 'pwd', '已复制密码')" class="p-1.5 hover:bg-[#f1f3f4] rounded-lg text-[#5f6368] cursor-pointer" title="复制密码">
              <Check v-if="copiedField === 'pwd'" class="w-3.5 h-3.5 text-emerald-600" />
              <Copy v-else class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-y-1.5 text-xs">
          <div class="text-[#5f6368]">平台名称</div>
          <div class="text-[#202124] font-medium truncate">{{ selectedRecord.title || "—" }}</div>

          <div class="text-[#5f6368]">所属分组</div>
          <div class="text-[#202124] font-medium truncate">{{ selectedRecord.group || "未分组" }}</div>

          <div class="text-[#5f6368]">账号状态</div>
          <div><span :class="getStatusBadgeClass(selectedRecord.status)">{{ selectedRecord.status || '正常' }}</span></div>

          <template v-if="selectedRecord.email">
            <div class="text-[#5f6368]">绑定邮箱</div>
            <div class="text-[#1a73e8] font-medium truncate select-all" :title="selectedRecord.email">{{ selectedRecord.email }}</div>
          </template>

          <template v-if="selectedRecord.phone">
            <div class="text-[#5f6368]">绑定手机</div>
            <div class="text-[#202124] font-medium truncate select-all">{{ selectedRecord.phone }}</div>
          </template>

          <template v-if="selectedRecord.recovery_email">
            <div class="text-[#5f6368]">恢复信息/密保</div>
            <div class="text-[#202124] font-medium truncate select-all" :title="selectedRecord.recovery_email">{{ selectedRecord.recovery_email }}</div>
          </template>

          <template v-if="selectedRecord.plan">
            <div class="text-[#5f6368]">会员/套餐</div>
            <div class="text-[#202124] font-medium truncate">{{ selectedRecord.plan }}</div>
          </template>

          <template v-if="selectedRecord.expire_at">
            <div class="text-[#5f6368]">到期时间</div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-mono text-[#202124]">{{ selectedRecord.expire_at }}</span>
              <span v-if="getExpireBadge(selectedRecord.expire_at)" :class="getExpireBadge(selectedRecord.expire_at)?.class">
                {{ getExpireBadge(selectedRecord.expire_at)?.label }}
              </span>
            </div>
          </template>

          <template v-if="selectedRecord.proxy">
            <div class="text-[#5f6368]">独立代理</div>
            <div class="font-mono text-[11px] text-purple-700 truncate" :title="selectedRecord.proxy">{{ selectedRecord.proxy }}</div>
          </template>

          <template v-if="selectedRecord.login_url">
            <div class="text-[#5f6368]">网站地址</div>
            <button
              type="button"
              @click="emit('open-in-app', selectedRecord.login_url!)"
              class="text-left text-[#1a73e8] hover:underline truncate font-mono text-[11px] cursor-pointer"
              :title="selectedRecord.login_url"
            >
              {{ selectedRecord.login_url }}
            </button>
          </template>
        </div>

        <div v-if="selectedRecord.notes" class="pt-2 border-t border-[#f1f3f4] text-xs text-[#5f6368]">
          <div class="font-medium text-[11px] mb-1">备注信息：</div>
          <div class="p-2 bg-[#f8fafd] rounded-xl text-[#202124] text-[11px] leading-relaxed whitespace-pre-wrap select-text">{{ selectedRecord.notes }}</div>
        </div>
      </div>

      <!-- TOTP / HOTP Card -->
      <div class="bg-[#edf2fa] rounded-2xl p-3 border border-[#d3e3fd]/80">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-bold text-[#444746] flex items-center gap-1.5">
            <Clock class="w-3.5 h-3.5 text-[#1a73e8]" />
            {{ totpResult?.otp_type === 'hotp' ? '2FA 动态安全码 (HOTP)' : '2FA 动态安全码 (TOTP)' }}
          </span>
          <span v-if="totpResult?.otp_type === 'hotp'" class="text-[11px] font-mono text-indigo-600 font-semibold">
            计数器 #{{ totpResult?.counter ?? 0 }}
          </span>
          <span v-else class="text-[11px] font-mono text-[#5f6368]">{{ totpResult?.remaining_seconds || 30 }}s 后刷新</span>
        </div>

        <div class="flex items-center justify-between my-1">
          <div class="font-mono text-2xl font-black tracking-widest text-[#1a73e8]">
            {{ totpResult?.code || "未配置" }}
          </div>
          <div v-if="selectedRecord.totp" class="flex items-center gap-1.5">
            <button
              v-if="totpResult?.otp_type === 'hotp'"
              type="button"
              @click="emit('increment-hotp', selectedRecord.id)"
              class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#1a73e8]/30 rounded-xl text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
            >
              <RefreshCw class="w-3.5 h-3.5" />
              <span>下一位</span>
            </button>
            <button
              v-else
              type="button"
              @click="emit('open-totp-qr', selectedRecord)"
              class="px-2 py-1 bg-white hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#1a73e8]/30 rounded-xl text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
            >
              <QrCode class="w-3.5 h-3.5" />
              <span>二维码</span>
            </button>
            <button
              type="button"
              @click="emit('copy', totpResult?.code || '', 'totp_large')"
              class="px-2.5 py-1 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
            >
              <Check v-if="copiedField === 'totp_large'" class="w-3.5 h-3.5" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedField === 'totp_large' ? '已复制' : '复制' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- PassKey Card -->
      <div v-if="selectedRecord.passkeys && selectedRecord.passkeys.length > 0" class="bg-indigo-50/70 rounded-2xl p-3 border border-indigo-200/80 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
            <Fingerprint class="w-3.5 h-3.5 text-indigo-600" />
            PassKey 通行密钥
          </span>
          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white text-indigo-700 border border-indigo-200">
            {{ selectedRecord.passkeys.length }} 枚
          </span>
        </div>
        <div class="space-y-1.5">
          <div
            v-for="pk in selectedRecord.passkeys"
            :key="pk.credential_id"
            class="px-2.5 py-2 bg-white rounded-xl border border-indigo-100 flex items-center justify-between gap-2 text-xs"
          >
            <div class="min-w-0">
              <div class="font-semibold text-[#202124] truncate">{{ pk.rp_name || pk.rp_id }}</div>
              <div class="text-[11px] text-[#5f6368] truncate">{{ pk.user_name || pk.user_display_name || pk.rp_id }}</div>
            </div>
            <span class="text-[10px] font-mono text-[#80868b] flex-shrink-0">使用 {{ pk.sign_count || 0 }} 次</span>
          </div>
        </div>
      </div>

      <!-- BACKUP CODES CARD -->
      <div class="bg-white rounded-2xl p-3 border border-[#dadce0]/80 shadow-2xs space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-[#202124] flex items-center gap-1.5">
            <KeyRound class="w-3.5 h-3.5 text-[#1a73e8]" />
            备用恢复码 / 验证码
          </span>
          <span
            v-if="parsedBackupCodesCount > 0"
            :class="[
              'text-[10px] font-semibold px-2 py-0.5 rounded-full font-mono',
              unusedBackupCodesCount > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
            ]"
          >
            剩余 {{ unusedBackupCodesCount }} / {{ parsedBackupCodesCount }}
          </span>
        </div>

        <div v-if="parsedBackupCodesCount > 0" class="space-y-1.5">
          <button
            @click="emit('consume-backup-code')"
            :disabled="unusedBackupCodesCount === 0"
            class="w-full py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
          >
            <Check v-if="copiedField === 'backup_code_consumed'" class="w-3.5 h-3.5" />
            <Copy v-else class="w-3.5 h-3.5" />
            <span>{{ copiedField === 'backup_code_consumed' ? '已复制并自动核销！' : '⚡ 复制下一个可用码并核销' }}</span>
          </button>
          <button @click="emit('open-backup-codes')" class="w-full py-1 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">
            查看全部备用码与核销状态
          </button>
        </div>
        <div v-else class="text-center py-1.5">
          <p class="text-[11px] text-[#80868b] mb-1.5">尚未配置备用恢复码</p>
          <button @click="emit('open-backup-codes')" class="px-2.5 py-1 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] rounded-lg text-xs font-medium cursor-pointer">
            + 批量粘贴备用码
          </button>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="space-y-1.5 pt-1">
        <button @click="emit('edit', selectedRecord)" class="w-full py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer">
          <Edit3 class="w-3.5 h-3.5" />
          <span>编辑该账号资料</span>
        </button>
        <button @click="emit('delete', selectedRecord.id)" class="w-full py-1.5 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer">
          <Trash2 class="w-3 h-3" />
          <span>删除此本地记录</span>
        </button>
      </div>
    </template>

    <div v-else class="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#80868b] select-none">
      <div class="w-14 h-14 rounded-2xl bg-[#e8f0fe] flex items-center justify-center mb-3 text-[#1a73e8] shadow-2xs">
        <Shield class="w-7 h-7" />
      </div>
      <h4 class="text-sm font-bold text-[#202124] mb-1">隐私防窥模式已就绪</h4>
      <p class="text-xs text-[#5f6368] max-w-xs leading-relaxed mb-4">
        当前未选中任何账号，密码与 2FA 动态码处于防窥保护中。请在左侧列表中点击选择查看。
      </p>
      <div class="inline-flex items-center gap-1.5 text-[11px] text-[#5f6368] bg-white px-3 py-1.5 rounded-xl border border-[#dadce0]/80 shadow-2xs">
        <span>快捷提示:</span>
        <kbd class="px-1.5 py-0.5 bg-[#f1f3f4] text-[#3c4043] rounded border border-[#dadce0] text-[10px] font-mono font-medium">再次点击</kbd>
        <span>或</span>
        <kbd class="px-1.5 py-0.5 bg-[#f1f3f4] text-[#3c4043] rounded border border-[#dadce0] text-[10px] font-mono font-medium">Esc</kbd>
        <span>可随时取消选中</span>
      </div>
    </div>
  </aside>
</template>
