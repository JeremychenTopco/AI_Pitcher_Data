/**
 * jsPDF loaded from a CDN `<script>` tag (see index.html), not npm — so
 * there's no @types package for it. Loosely typed on purpose: just enough
 * for src/lib/reportPdf.ts's own call sites, not the whole real API.
 */
export {};

declare global {
  interface JsPDFDoc {
    setFont(name: string, style?: string): JsPDFDoc;
    setFontSize(size: number): JsPDFDoc;
    setTextColor(r: number, g?: number, b?: number): JsPDFDoc;
    setDrawColor(r: number, g?: number, b?: number): JsPDFDoc;
    setFillColor(r: number, g?: number, b?: number): JsPDFDoc;
    setLineWidth(w: number): JsPDFDoc;
    text(text: string, x: number, y: number, options?: Record<string, unknown>): JsPDFDoc;
    getTextWidth(text: string): number;
    line(x1: number, y1: number, x2: number, y2: number): JsPDFDoc;
    rect(x: number, y: number, w: number, h: number, style?: string): JsPDFDoc;
    circle(x: number, y: number, r: number, style?: string): JsPDFDoc;
    lines(
      lineSegments: number[][],
      x: number,
      y: number,
      scale?: [number, number],
      style?: string,
      closed?: boolean,
    ): JsPDFDoc;
    addImage(dataUrl: string, format: string, x: number, y: number, w: number, h: number): JsPDFDoc;
    addPage(): JsPDFDoc;
    save(filename: string): void;
    internal: { pageSize: { getWidth(): number; getHeight(): number } };
  }

  interface Window {
    jspdf?: {
      jsPDF: new (options?: { orientation?: "p" | "l"; unit?: string; format?: string }) => JsPDFDoc;
    };
  }
}
