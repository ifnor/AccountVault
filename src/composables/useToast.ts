import { ref } from "vue";
import type { ToastItem } from "../types/vault";

const toasts = ref<ToastItem[]>([]);
let toastCounter = 0;

export function useToast() {
  function notify(
    message: string,
    type: "success" | "error" | "warning" | "info" = "info",
    duration = 3200
  ) {
    const id = ++toastCounter;
    toasts.value.push({ id, message, type });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, duration);
  }

  return {
    toasts,
    notify
  };
}
