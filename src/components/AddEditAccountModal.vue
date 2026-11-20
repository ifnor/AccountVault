<script setup lang="ts">
import { X, Star, Sparkles, QrCode, Calendar, Network, RefreshCw } from "lucide-vue-next";
import type { AccountRecord } from "../types/vault";
import { ACCOUNT_STATUS_OPTIONS } from "../utils/accountHelpers";

defineProps<{
  visible: boolean;
  form: AccountRecord;
  isSaving: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "save"): void;
  (e: "generate-password"): void;
  (e: "scan-qr"): void;
  (e: "paste-totp", ev: ClipboardEvent): void;
}>();
</script>

<template>
  <div v-if="visible" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="w-full max-w-lg bg-white rounded-3xl p-6 shadow-xl border border-[#dadce0] flex flex-col max-h-[90vh]">
      <div class="flex items-center justify-between pb-3 border-b border-[#f1f3f4] mb-4">
        <h2 class="text-base font-bold text-[#202124]">{{ form.id ? "编辑账号资料" : "添加新账号" }}</h2>
        <button @click="emit('close')" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]">
          <X class="w-4 h-4" />
        </button>
      </div>

      <form @submit.prevent="emit('save')" class="flex-1 overflow-y-auto space-y-4 pr-1">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-semibold text-[#5f6368]">平台 / 服务名称 *</label>
              <label class="flex items-center gap-1 text-xs font-medium text-[#3c4043] cursor-pointer">
                <input type="checkbox" v-model="form.is_pinned" class="rounded text-amber-500 focus:ring-0 cursor-pointer" />
                <Star class="w-3.5 h-3.5" :class="form.is_pinned ? 'text-amber-400 fill-amber-400' : 'text-[#80868b]'" />
                <span>置顶</span>
              </label>
            </div>
            <input
              type="text"
              v-model="form.title"
              placeholder="GitHub / OpenAI / Steam..."
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">网站地址 (可选)</label>
            <input
              type="text"
              v-model="form.login_url"
              placeholder="https://github.com/login"
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">登录账号 / 用户名 *</label>
            <input
              type="text"
              v-model="form.username"
              placeholder="用户名、邮箱或手机号"
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">绑定邮箱 (可选)</label>
            <input
              type="text"
              v-model="form.email"
              placeholder="name@example.com"
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-xs font-semibold text-[#5f6368]">登录密码</label>
            <button type="button" @click="emit('generate-password')" class="text-[11px] text-[#1a73e8] hover:underline flex items-center gap-1 cursor-pointer">
              <Sparkles class="w-3 h-3" />
              随机强密码
            </button>
          </div>
          <input
            type="text"
            v-model="form.password"
            placeholder="请输入密码..."
            class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">所属分组</label>
            <input
              type="text"
              v-model="form.group"
              placeholder="工作 / 开发 / 金融..."
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">账号状态</label>
            <select v-model="form.status" class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-medium text-[#202124]">
              <option v-for="st in ACCOUNT_STATUS_OPTIONS" :key="st" :value="st">{{ st }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">会员/套餐 (可选)</label>
            <input
              type="text"
              v-model="form.plan"
              placeholder="Pro / Plus / VIP..."
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">恢复邮箱 / 密保</label>
            <input
              type="text"
              v-model="form.recovery_email"
              placeholder="备用邮箱或密保提示"
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">绑定手机号</label>
            <input
              type="text"
              v-model="form.phone"
              placeholder="+86 13800..."
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-xs font-semibold text-[#5f6368]">2FA 密钥 (Base32 / otpauth:// / 粘贴二维码截图)</label>
            <button type="button" @click="emit('scan-qr')" class="text-[11px] text-[#1a73e8] hover:underline flex items-center gap-1 cursor-pointer">
              <QrCode class="w-3 h-3" />
              <span>识别二维码图片</span>
            </button>
          </div>
          <input
            type="text"
            v-model="form.totp"
            @paste="emit('paste-totp', $event)"
            placeholder="JBSWY3DPEHPK3PXP 或直接 Ctrl+V 粘贴二维码图片..."
            class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1 flex items-center gap-1">
              <Calendar class="w-3 h-3 text-[#1a73e8]" />
              <span>订阅/权益到期日 (可选)</span>
            </label>
            <input type="date" v-model="form.expire_at" class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1 flex items-center gap-1">
              <Network class="w-3 h-3 text-[#1a73e8]" />
              <span>独立代理 IP (可选，防关联)</span>
            </label>
            <input type="text" v-model="form.proxy" placeholder="http://127.0.0.1:7890" class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono" />
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#5f6368] mb-1">备注</label>
          <textarea v-model="form.notes" rows="2" placeholder="添加任何重要记录、API Key 或安全提示..." class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none resize-none"></textarea>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-[#f1f3f4]">
          <button type="button" @click="emit('close')" :disabled="isSaving" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">
            取消
          </button>
          <button type="submit" :disabled="isSaving" class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium shadow-sm flex items-center gap-1.5 cursor-pointer">
            <RefreshCw v-if="isSaving" class="w-3.5 h-3.5 animate-spin" />
            <span>{{ isSaving ? "正在加密保存..." : "保存至安全库" }}</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
