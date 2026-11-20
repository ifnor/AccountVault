import { ref } from "vue";

export function useDetailResizer() {
  const detailWidth = ref<number>(
    Math.max(280, Math.min(520, Number(localStorage.getItem("avault_detail_panel_width") || 350)))
  );
  const isResizingDetail = ref(false);
  const isDesktopWindow = ref(typeof window !== "undefined" ? window.innerWidth >= 768 : true);

  function updateWindowWidth() {
    if (typeof window !== "undefined") {
      isDesktopWindow.value = window.innerWidth >= 768;
    }
  }

  function startResizeDetail(e: MouseEvent) {
    e.preventDefault();
    isResizingDetail.value = true;
    const startX = e.clientX;
    const startWidth = detailWidth.value;

    function onMouseMove(moveEvent: MouseEvent) {
      const delta = startX - moveEvent.clientX;
      detailWidth.value = Math.max(280, Math.min(520, startWidth + delta));
    }

    function onMouseUp() {
      isResizingDetail.value = false;
      localStorage.setItem("avault_detail_panel_width", String(detailWidth.value));
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function resetDetailWidth() {
    detailWidth.value = 350;
    localStorage.setItem("avault_detail_panel_width", "350");
  }

  return {
    detailWidth,
    isResizingDetail,
    isDesktopWindow,
    updateWindowWidth,
    startResizeDetail,
    resetDetailWidth
  };
}
