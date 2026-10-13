/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ByteLoader } from "./assets";

/** Thư mục `public/` của frontend (Vitest chạy với cwd là `frontend/`). */
export const PUBLIC_DIR = resolve(process.cwd(), "public");

export function readPublic(path: string): ArrayBuffer {
  const buf = readFileSync(resolve(PUBLIC_DIR, path));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** ByteLoader đọc thẳng từ `public/` thay vì gọi mạng. `BASE_URL` của Vitest là "/". */
export const diskLoader: ByteLoader = async (url) => readPublic(url.replace(/^\//, ""));
