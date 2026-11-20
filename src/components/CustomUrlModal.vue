<script setup lang="ts">
import { X, Zap, ExternalLink, Trash2, RotateCcw } from "lucide-vue-next";

defineProps<{
  visible: boolean;
  accountSubtitle: string;
  isTakeoverForCurrent: boolean;
  takeoverRemainingSec: number;
  servicePresets: Array<{ name: string; url: string }>;
  isManagingPresets: boolean;
  newPresetName: string;
  newPresetUrl: string;
  customUrlInput: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "toggle-takeover"): void;
  (e: "reset-presets"): void;
  (e: "update:isManagingPresets", value: boolean): void;
  (e: "open-preset", url: string): void;
  (e: "remove-preset", idx: number): void;
  (e: "update:newPresetName", value: string): void;
  (e: "update:newPresetUrl", value: string): void;
  (e: "add-preset"): void;
  (e: "update:customUrlInput", value: string): void;
  (e: "open-custom-url"): void;
  (e: "clear-session"): void;
}>();
</script>

<template>
  <div v-if="visible" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl border border-[#dadce0] flex flex-col max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between pb-3 border-b border-[#f1f3f4] mb-4">
        <div>
          <h2 class="text-base font-bold text-[#202124]">独立会话浏览器</h2>
          <p class="text-xs text-[#5f6368] mt-0.5">当前账号：<span class="font-medium text-[#1a73e8]">{{ accountSubtitle }}</span></p>
        </div>
        <button @click="emit('close')" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="mb-4 p-3 bg-[#f8fafd] border border-[#d2e3fc] rounded-2xl flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-xs font-bold text-[#202124] flex items-center gap-1.5">
            <Zap class="w-3.5 h-3.5 text-[#1a73e8] flex-shrink-0" />
            <span>临时接管外部浏览器跳转 (60s)</span>
          </div>
          <p class="text-[11px] text-[#5f6368] mt-0.5 leading-relaxed">
            开启后在外部软件/CLI 点击登录或复制授权链接，将自动拦截并在当前账号独立会话中打开
          </p>
        </div>
        <button
          type="button"
          @click="emit('toggle-takeover')"
          :class="[
            'px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0 transition-all cursor-pointer',
            isTakeoverForCurrent
              ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs'
              : 'bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-xs'
          ]"
        >
          {{ isTakeoverForCurrent ? `停止接管 (${takeoverRemainingSec}s)` : '开启接管' }}
        </button>
      </div>

      <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <label class="block text-xs font-semibold text-[#5f6368] uppercase tracking-wider">常用网站直达</label>
          <div class="flex items-center gap-2">
            <button v-if="isManagingPresets" type="button" @click="emit('reset-presets')" class="text-[11px] text-[#5f6368] hover:text-[#1a73e8] cursor-pointer">
              恢复默认
            </button>
            <button type="button" @click="emit('update:isManagingPresets', !isManagingPresets)" class="text-[11px] text-[#1a73e8] hover:underline font-medium cursor-pointer">
              {{ isManagingPresets ? "完成管理" : "自定义管理" }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div v-for="(p, idx) in servicePresets" :key="p.url + idx" class="relative flex items-center">
            <button
              type="button"
              @click="!isManagingPresets && emit('open-preset', p.url)"
              class="w-full px-3 py-2 bg-[#f8fafd] hover:bg-[#e8f0fe] hover:text-[#1a73e8] border border-[#dadce0]/60 rounded-xl text-xs font-medium text-[#3c4043] flex items-center justify-between transition-colors text-left truncate cursor-pointer"
              :title="p.url"
            >
              <span class="truncate pr-2">{{ p.name }}</span>
              <ExternalLink v-if="!isManagingPresets" class="w-3 h-3 text-[#5f6368] flex-shrink-0" />
            </button>
            <button
              v-if="isManagingPresets"
              type="button"
              @click.stop="emit('remove-preset', idx)"
              class="absolute right-1.5 p-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg cursor-pointer"
            >
              <Trash2 class="w-3 h-3" />
            </button>
          </div>
        </div>

        <div v-if="isManagingPresets" class="mt-3 p-3 bg-[#f8fafd] rounded-2xl border border-[#dadce0] space-y-2">
          <div class="text-[11px] font-semibold text-[#202124]">新增自定义常用网址</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              :value="newPresetName"
              @input="emit('update:newPresetName', ($event.target as HTMLInputElement).value)"
              placeholder="名称 (如 GitHub)"
              class="px-2.5 py-1.5 bg-white rounded-lg border border-[#dadce0] text-xs outline-none focus:border-[#1a73e8]"
            />
            <input
              type="text"
              :value="newPresetUrl"
              @input="emit('update:newPresetUrl', ($event.target as HTMLInputElement).value)"
              placeholder="https://..."
              class="px-2.5 py-1.5 bg-white rounded-lg border border-[#dadce0] text-xs outline-none font-mono focus:border-[#1a73e8]"
            />
          </div>
          <button type="button" @click="emit('add-preset')" class="w-full py-1.5 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] rounded-lg text-xs font-semibold cursor-pointer">
            + 添加到常用网站列表
          </button>
        </div>
      </div>

      <form @submit.prevent="emit('open-custom-url')" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-[#5f6368] mb-1">输入任意网址</label>
          <input
            type="text"
            :value="customUrlInput"
            @input="emit('update:customUrlInput', ($event.target as HTMLInputElement).value)"
            placeholder="https://..."
            class="w-full px-3 py-2.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none font-mono"
          />
        </div>

        <div class="flex items-center justify-between gap-2 pt-2 border-t border-[#f1f3f4]">
          <button
            type="button"
            @click="emit('clear-session')"
            class="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            <span>清理此账号会话缓存</span>
          </button>
          <div class="flex items-center gap-2">
            <button type="button" @click="emit('close')" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">
              取消
            </button>
            <button type="submit" class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium shadow-sm flex items-center gap-1.5 cursor-pointer">
              <ExternalLink class="w-3.5 h-3.5" />
              <span>在独立窗口打开</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
