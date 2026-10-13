import { useSyncExternalStore } from "react";
import { canUseWebGL } from "../../lib/webglSupport";

export type SceneMode = "full" | "lite" | "reduced";
export type SceneLayout = "wide" | "narrow";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Môi trường của các cảnh 3D chạy theo cuộn trên landing: giảm chuyển động → ảnh tĩnh; màn hẹp hoặc máy yếu → chế độ nhẹ;
 * khung dọc → bố cục hẹp; không có WebGL → chỉ còn nội dung chữ.
 */
export function useSceneEnvironment(): { mode: SceneMode; layout: SceneLayout; webgl: boolean } {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const narrowViewport = useMedia("(max-width: 767px)");
  const portrait = useMedia("(orientation: portrait)");
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const weak = (nav?.deviceMemory !== undefined && nav.deviceMemory <= 2) || (nav?.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2);
  const webgl = useSyncExternalStore(
    () => () => {},
    () => canUseWebGL(),
    () => false,
  );
  const mode: SceneMode = reduced ? "reduced" : narrowViewport || weak ? "lite" : "full";
  const layout: SceneLayout = narrowViewport || portrait ? "narrow" : "wide";
  return { mode, layout, webgl };
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
