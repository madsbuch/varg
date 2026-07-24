/** Scroll the app's content container back to the top. All scrolling
 * happens inside #content (the page itself never scrolls). */
export function scrollContentTop(): void {
  document.getElementById("content")?.scrollTo(0, 0);
}
