/** Re-exported so components import domain types from one place. */
export * from "@/api/types";

export type ReportTab = "summary" | "arm" | "trunk" | "knee";

export const REPORT_TABS: ReadonlyArray<{ id: ReportTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "arm", label: "手臂運動學" },
  { id: "trunk", label: "軀幹運動學" },
  { id: "knee", label: "膝關節動力學" },
];
