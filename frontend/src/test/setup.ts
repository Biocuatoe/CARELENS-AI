import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest không bật globals nên Testing Library không tự dọn DOM giữa các test.
afterEach(() => cleanup());
