/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** URL of the care-monitoring backend (Cloudflare Worker) used by the Live Demo, e.g. https://care-monitoring.<subdomain>.workers.dev. Unset in a production build = no backend connection; development falls back to http://127.0.0.1:8787. */
  readonly VITE_API_BASE_URL?: string;
  /** Địa chỉ email liên hệ chính thức hiện trên phần "Liên hệ với chúng tôi". Không đặt thì nút chính sao chép nội dung trao đổi (không bịa địa chỉ). */
  readonly VITE_CONTACT_EMAIL?: string;
  readonly VITE_DATA_MODE?: "demo" | "http";
}
