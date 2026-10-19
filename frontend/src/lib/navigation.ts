/** Full-page navigation to an external flow (the server-side Google redirect). A function so tests can observe it: jsdom cannot navigate. */
export function startFullPageNavigation(url: string): void {
  window.location.assign(url);
}
