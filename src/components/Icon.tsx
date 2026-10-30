export type IconName = "home" | "sale" | "catalog" | "inventory" | "history" | "report" | "backup" | "settings" | "panel" | "arrow" | "check";

const paths: Record<IconName, string> = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  sale: "M3 3h2l3 12h10l3-9H6 M10 20h.01 M18 20h.01",
  catalog: "M4 4h6v6H4Z M14 4h6v6h-6Z M4 14h6v6H4Z M14 14h6v6h-6Z",
  inventory: "m3 7 9-4 9 4-9 4Z M3 7v10l9 4 9-4V7 M12 11v10 M7.5 5l9 4",
  history: "M3 11a9 9 0 1 1 2.5 7 M3 4v7h7 M12 7v5l3 2",
  report: "M4 3v18h17 M8 16v-5 M13 16V7 M18 16v-8",
  backup: "M5 3h12l3 3v15H4V3Z M8 3v6h8V3 M8 21v-7h8v7",
  settings: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  panel: "M3 4h18v16H3Z M9 4v16",
  arrow: "M5 12h14 m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
};

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>;
}
