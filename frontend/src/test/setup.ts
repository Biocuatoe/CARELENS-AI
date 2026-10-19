import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest không bật globals nên Testing Library không tự dọn DOM giữa các test.
afterEach(() => cleanup());

// jsdom's <dialog> has no showModal()/close(). The two methods below only toggle the `open` attribute (no focus trap, no
// top layer), which is enough for tests to see a dialog open and close; real focus behaviour is covered in the browser.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}
