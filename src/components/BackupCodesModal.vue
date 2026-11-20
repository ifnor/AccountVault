<script setup lang="ts">
import { X, Check, Copy } from "lucide-vue-next";

defineProps<{
  visible: boolean;
  accountSubtitle: string;
  codesList: string[];
  usedCodesSet: Set<string>;
  unusedCount: number;
  isEditingRaw: boolean;
  rawInput: string;
  copiedField: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:isEditingRaw", value: boolean): void;
  (e: "update:rawInput", value: string): void;
  (e: "reset-all"): void;
  (e: "save-raw"): void;
  (e: "copy-and-consume"): void;
  (e: "toggle-code", code: string): void;
  (e: "copy-code", code: string): void;
}>();
</script>

<template>
  <div v-if="visible" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="w-full max-w-lg bg-white rounded-3xl p-6 shadow-xl border border-[#dadce0] flex flex-col max-h-[85vh]">
      <div class="flex items-center justify-between pb-3 border-b border-[#f1f3f4] mb-3">
        <div>
          <h2 class="text-base font-bold text-[#202124]">备用恢复码管理</h2>
          <p class="text-xs text-[#5f6368] mt-0.5">
            账号：<span class="font-medium text-[#1a73e8]">{{ accountSubtitle }}</span>
          </p>
        </div>
        <button @click="emit('close')" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="flex items-center justify-between mb-4">
        <div class="text-xs text-[#5f6368]">
          共 <span class="font-bold text-[#202124]">{{ codesList.length }}</span> 个代码，
          剩余 <span class="font-bold text-emerald-600">{{ unusedCount }}</span> 个可用
        </div>
        <div class="flex items-center gap-2">
          <button v-if="!isEditingRaw" @click="emit('update:isEditingRaw', true)" class="px-2.5 py-1 text-xs bg-[#f1f3f4] hover:bg-[#e8eaed] rounded-lg text-[#3c4043] cursor-pointer">
            编辑 / 批量替换
          </button>
          <button v-else @click="emit('update:isEditingRaw', false)" class="px-2.5 py-1 text-xs bg-[#f1f3f4] hover:bg-[#e8eaed] rounded-lg text-[#3c4043] cursor-pointer">
            返回卡片视图
          </button>
          <button @click="emit('reset-all')" class="px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
            重置全部未用
          </button>
        </div>
      </div>

      <div v-if="isEditingRaw" class="space-y-3 flex-1 overflow-y-auto">
        <p class="text-xs text-[#80868b]">请粘贴各平台给出的备用验证码 / 恢复码（每行一个或逗号分隔）：</p>
        <textarea
          :value="rawInput"
          @input="emit('update:rawInput', ($event.target as HTMLTextAreaElement).value)"
          rows="8"
          placeholder="12345678&#10;abcd-efgh-ijkl..."
          class="w-full p-3 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] font-mono text-xs outline-none resize-none leading-relaxed"
        ></textarea>
        <div class="flex justify-end gap-2">
          <button @click="emit('update:isEditingRaw', false)" class="px-4 py-2 bg-[#f1f3f4] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">取消</button>
          <button @click="emit('save-raw')" class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium shadow-sm cursor-pointer">保存备用码</button>
        </div>
      </div>

      <div v-else class="flex-1 overflow-y-auto pr-1 space-y-4">
        <button
          @click="emit('copy-and-consume')"
          :disabled="unusedCount === 0"
          class="w-full py-3 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
        >
          <Check v-if="copiedField === 'backup_code_consumed'" class="w-4 h-4" />
          <Copy v-else class="w-4 h-4" />
          <span>{{ copiedField === 'backup_code_consumed' ? '已复制下一个可用码并核销！' : '⚡ 复制下一个未用码并自动核销' }}</span>
        </button>

        <div v-if="codesList.length > 0" class="grid grid-cols-2 gap-2">
          <div
            v-for="code in codesList"
            :key="code"
            :class="[
              'p-3 rounded-xl border flex items-center justify-between transition-all select-text',
              usedCodesSet.has(code)
                ? 'bg-[#f1f3f4]/70 border-[#dadce0]/50 text-[#80868b]'
                : 'bg-white border-[#dadce0] hover:border-[#1a73e8] text-[#202124]'
            ]"
          >
            <div class="flex items-center gap-2 min-w-0">
              <input type="checkbox" :checked="usedCodesSet.has(code)" @change="emit('toggle-code', code)" class="rounded text-[#1a73e8] focus:ring-0 cursor-pointer" />
              <span :class="['font-mono text-xs font-semibold truncate', usedCodesSet.has(code) ? 'line-through opacity-60' : '']">{{ code }}</span>
            </div>
            <button @click="emit('copy-code', code)" class="p-1 hover:bg-[#f1f3f4] rounded text-[#5f6368] cursor-pointer flex-shrink-0">
              <Check v-if="copiedField === 'bc_' + code" class="w-3.5 h-3.5 text-emerald-600" />
              <Copy v-else class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div v-else class="py-8 text-center text-xs text-[#80868b]">
          暂无备用码，请点击右上角「编辑 / 批量替换」进行粘贴录入
        </div>
      </div>
    </div>
  </div>
</template>
