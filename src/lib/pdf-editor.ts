
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

export type Markup =
  | {
      id: string;
      type: "text";
      page: number;
      x: number;
      y: number;
      text: string;
      color: string;
      fontSize: number;
    }
  | {
      id: string;
      type: "highlight" | "draw";
      page: number;
      points: { x: number; y: number }[];
      color: string;
    }
  | {
      id: string;
      type: "cover";
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      replacement: string;
      color: string;
      fontSize: number;
    };

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((v) => v + v).join("")
    : normalized;

  const number = Number.parseInt(value, 16);

  return rgb(
    ((number >> 16) & 255) / 255,
    ((number >> 8) & 255) / 255,
    (number & 255) / 255
  );
}

export async function exportEditedPdf(
  source: ArrayBuffer,
  marks: Markup[],
  deletedPages: number[],
  rotations: Record<number, number>
) {
  const pdf = await PDFDocument.load(source);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  // Remove selected pages from highest index to lowest.
  [...deletedPages]
    .sort((a, b) => b - a)
    .forEach((index) => {
      if (index >= 0 && index < pdf.getPageCount()) {
        pdf.removePage(index);
      }
    });

  // Apply rotations to surviving pages.
  const removed = new Set(deletedPages);

  pages.forEach((page, originalIndex) => {
    if (removed.has(originalIndex)) return;

    const currentIndex =
      originalIndex -
      deletedPages.filter((index) => index < originalIndex).length;

    const rotation = rotations[originalIndex] ?? 0;
    if (currentIndex < pdf.getPageCount() && rotation !== 0) {
      const target = pdf.getPage(currentIndex);
      target.setRotation(
        degrees((target.getRotation().angle + rotation + 360) % 360)
      );
    }
  });

  // Apply overlays to the remaining pages.
  for (const mark of marks) {
    if (removed.has(mark.page)) continue;

    const pageIndex =
      mark.page -
      deletedPages.filter((index) => index < mark.page).length;

    if (pageIndex < 0 || pageIndex >= pdf.getPageCount()) continue;

    const page = pdf.getPage(pageIndex);
    const { width, height } = page.getSize();

    if (mark.type === "text") {
      page.drawText(mark.text, {
        x: (mark.x / 100) * width,
        y: height - (mark.y / 100) * height,
        size: mark.fontSize,
        font,
        color: hexToRgb(mark.color),
        maxWidth: width - (mark.x / 100) * width,
      });
    }

    if (mark.type === "cover") {
      page.drawRectangle({
        x: (mark.x / 100) * width,
        y: height - ((mark.y + mark.height) / 100) * height,
        width: (mark.width / 100) * width,
        height: (mark.height / 100) * height,
        color: rgb(1, 1, 1),
      });

      page.drawText(mark.replacement, {
        x: (mark.x / 100) * width,
        y: height - ((mark.y + mark.height) / 100) * height + 2,
        size: mark.fontSize,
        font,
        color: hexToRgb(mark.color),
        maxWidth: (mark.width / 100) * width,
      });
    }

    if (
      (mark.type === "draw" || mark.type === "highlight") &&
      mark.points.length > 0
    ) {
      for (let i = 1; i < mark.points.length; i++) {
        const a = mark.points[i - 1];
        const b = mark.points[i];

        page.drawLine({
          start: {
            x: (a.x / 100) * width,
            y: height - (a.y / 100) * height,
          },
          end: {
            x: (b.x / 100) * width,
            y: height - (b.y / 100) * height,
          },
          thickness: mark.type === "highlight" ? 12 : 2,
          color: hexToRgb(mark.color),
          opacity: mark.type === "highlight" ? 0.35 : 1,
        });
      }
    }
  }

  return pdf.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename.toLowerCase().endsWith(".pdf")
    ? filename
    : `${filename}.pdf`;

  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}
