let cached: boolean | undefined;

/**
 * WebGL có dùng được không, thăm dò một lần rồi nhớ kết quả. Không phụ thuộc three.js nên dùng được trong chunk chính
 * (quyết định bố cục trước khi tải cảnh 3D). Context thăm dò được huỷ ngay để không chiếm giới hạn context của trình duyệt.
 */
export function canUseWebGL(): boolean {
  if (cached !== undefined) return cached;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    cached = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}
