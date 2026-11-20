<script setup lang="ts">
import { X, FileText, Upload } from "lucide-vue-next";
import type { AccountRecord } from "../types/vault";

defineProps<{
  visible: boolean;
  rawText: string;
  assignPlatform: string;
  assignGroup: string;
  sourceLabel: string;
  parsedRecords: Partial<AccountRecord>[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "trigger-file"): void;
  (e: "update:rawText", value: string): void;
  (e: "parse-raw"): void;
  (e: "update:assignPlatform", value: string): void;
  (e: "update:assignGroup", value: string): void;
  (e: "apply-overrides"): void;
  (e: "confirm"): void;
}>();
</script>

<template>
  <div v-if="visible" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="w-full max-w-2xl bg-white rounded-3xl p-6 shadow-xl border border-[#dadce0] flex flex-col max-h-[90vh]">
      <div class="flex items-center justify-between pb-3 border-b border-[#f1f3f4] mb-3">
        <div>
          <h2 class="text-base font-bold text-[#202124]">批量导入账号</h2>
          <p class="text-xs text-[#5f6368] mt-0.5">支持智能自动识别多格式（----、Tab制表符、竖线、逗号、空格分隔等）</p>
        </div>
        <button @click="emit('close')" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="space-y-4 flex-1 overflow-y-auto pr-1">
        <div class="p-3.5 bg-[#f8fafd] border border-[#d2e3fc] rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="space-y-1 min-w-0">
            <div class="text-xs font-bold text-[#202124] flex items-center gap-1.5">
              <FileText class="w-3.5 h-3.5 text-[#1a73e8] flex-shrink-0" />
              <span>从浏览器或密码管理器导出文件导入</span>
            </div>
            <p class="text-[11px] text-[#5f6368] leading-relaxed">
              支持 <b>Chrome</b>、<b>Edge</b>、<b>Firefox</b>、<b>Safari</b>、<b>Bitwarden</b>、<b>1Password</b>、<b>KeePass</b> 导出的 CSV / JSON 文件
            </p>
          </div>
          <button
            type="button"
            @click="emit('trigger-file')"
            class="px-3.5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs flex-shrink-0 cursor-pointer whitespace-nowrap"
          >
            <Upload class="w-3.5 h-3.5" />
            <span>选择 CSV / JSON 文件</span>
          </button>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-xs font-semibold text-[#5f6368]">或直接粘贴多行文本数据</label>
            <span class="text-[11px] text-[#80868b]">例: 平台----账号----密码----TOTP密钥</span>
          </div>
          <textarea
            :value="rawText"
            @input="emit('update:rawText', ($event.target as HTMLTextAreaElement).value); emit('parse-raw')"
            rows="4"
            placeholder="GitHub----alice----Password123----JBSWY3DPEHPK3PXP&#10;OpenAI----user@example.com----Pass456"
            class="w-full p-3 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] font-mono text-xs outline-none resize-none leading-relaxed"
          ></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">统一覆盖平台（可选）</label>
            <input
              type="text"
              :value="assignPlatform"
              @input="emit('update:assignPlatform', ($event.target as HTMLInputElement).value); emit('apply-overrides')"
              placeholder="留空则保留原平台名..."
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#5f6368] mb-1">统一覆盖分组（可选）</label>
            <input
              type="text"
              :value="assignGroup"
              @input="emit('update:assignGroup', ($event.target as HTMLInputElement).value); emit('apply-overrides')"
              placeholder="留空则保留原分组..."
              class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
            />
          </div>
          <div class="text-right pt-3 text-xs font-medium text-[#1a73e8] flex flex-col justify-center">
            <span v-if="sourceLabel" class="text-[10px] text-emerald-700 font-semibold truncate">{{ sourceLabel }}</span>
            <span>已识别：<span class="text-base font-bold">{{ parsedRecords.length }}</span> 个账号</span>
          </div>
        </div>

        <div v-if="parsedRecords.length > 0" class="border border-[#dadce0] rounded-2xl overflow-hidden max-h-56 overflow-y-auto">
          <table class="w-full text-left text-xs divide-y divide-[#f1f3f4]">
            <thead class="bg-[#f8fafd] text-[#5f6368] sticky top-0">
              <tr>
                <th class="px-3 py-2 font-medium">#</th>
                <th class="px-3 py-2 font-medium">平台</th>
                <th class="px-3 py-2 font-medium">账号</th>
                <th class="px-3 py-2 font-medium">分组</th>
                <th class="px-3 py-2 font-medium">密码</th>
                <th class="px-3 py-2 font-medium">TOTP</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#f1f3f4] bg-white font-mono">
              <tr v-for="(r, idx) in parsedRecords" :key="idx" class="hover:bg-[#f8fafd]">
                <td class="px-3 py-1.5 text-[#80868b]">{{ idx + 1 }}</td>
                <td class="px-3 py-1.5 font-sans font-medium text-[#1a73e8] max-w-[120px] truncate">{{ r.title }}</td>
                <td class="px-3 py-1.5 font-sans font-medium text-[#202124] max-w-[140px] truncate">{{ r.username }}</td>
                <td class="px-3 py-1.5 font-sans text-[#5f6368] max-w-[90px] truncate">{{ r.group || '—' }}</td>
                <td class="px-3 py-1.5 text-[#5f6368]">{{ r.password ? '••••••••' : '—' }}</td>
                <td class="px-3 py-1.5 text-[#1a73e8]">{{ r.totp ? '有' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-3 border-t border-[#f1f3f4] mt-3">
        <button type="button" @click="emit('close')" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">
          取消
        </button>
        <button
          type="button"
          :disabled="parsedRecords.length === 0"
          @click="emit('confirm')"
          class="px-5 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium shadow-sm disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
        >
          <Upload class="w-3.5 h-3.5" />
          <span>确认导入 {{ parsedRecords.length }} 个账号至保险库</span>
        </button>
      </div>
    </div>
  </div>
</template>
