/**
 * Applies the system color scheme to the `dark` class before hydration so
 * shadcn CSS variables and Tailwind `dark:` variants stay in sync.
 */
export function ThemeScript() {
  const script = `
(() => {
  try {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
  } catch (_) {}
})();
`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
