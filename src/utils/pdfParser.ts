import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PdfDocumentData, PdfPageItem } from '../types';

// Set up the PDF.js web worker
try {
  if (typeof window !== 'undefined' && pdfjsWorker) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  }
} catch (e) {
  console.warn('Unable to set workerSrc for pdfjs-dist:', e);
}

export interface PdfParseProgress {
  percent: number;
  message: string;
  currentPage?: number;
  totalPages?: number;
}

interface PositionedTextItem {
  text: string;
  x: number;
  y: number;
  hasEOL: boolean;
}

/**
 * Rebuild PDF text in visual reading order.
 *
 * PDF text objects are often stored in an internal order that is not the
 * order a person sees on the page. Reading them directly can produce things
 * such as "ll concider" or unrelated header/footer fragments. We group
 * nearby items into visual lines and sort each line left-to-right before
 * joining the text.
 */
function cleanPdfText(items: PositionedTextItem[]): string {
  const positioned = items
    .filter((item) => item.text.trim() || item.hasEOL)
    .sort((a, b) => {
      const yDiff = b.y - a.y;
      return Math.abs(yDiff) > 3 ? yDiff : a.x - b.x;
    });

  const lines: Array<{ y: number; parts: PositionedTextItem[] }> = [];

  for (const item of positioned) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (line) {
      line.parts.push(item);
    } else {
      lines.push({ y: item.y, parts: [item] });
    }
  }

  lines.sort((a, b) => b.y - a.y);

  const output: string[] = [];

  for (const line of lines) {
    line.parts.sort((a, b) => a.x - b.x);

    let lineText = '';
    for (const part of line.parts) {
      const value = part.text.trim();
      if (!value) continue;

      if (lineText && !/[\s-]$/.test(lineText) && !/^[,.;:!?)]/.test(value)) {
        lineText += ' ';
      }
      lineText += value;

      if (part.hasEOL) lineText += ' ';
    }

    lineText = lineText
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim();

    if (lineText) output.push(lineText);
  }

  return output
    .join('\n')
    // Join words that were split across a visual line break.
    .replace(/([A-Za-z])-[ \t]*\n[ \t]*([a-z])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parses a PDF file directly in the browser using PDF.js.
 * This works entirely client-side without uploading large files to the server,
 * avoiding reverse-proxy payload size limits and network bandwidth bottlenecks.
 */
export async function extractPdfInBrowser(
  file: File,
  onProgress?: (progress: PdfParseProgress) => void
): Promise<PdfDocumentData> {
  onProgress?.({ percent: 5, message: 'Reading document bytes...' });
  const arrayBuffer = await file.arrayBuffer();

  onProgress?.({ percent: 15, message: 'Initializing document...' });
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages || 1;
  const pages: PdfPageItem[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const pagePercent = Math.min(95, Math.round(15 + ((pageNum - 0.5) / numPages) * 80));
    onProgress?.({
      percent: pagePercent,
      message: `Extracting page ${pageNum} of ${numPages}...`,
      currentPage: pageNum,
      totalPages: numPages,
    });

    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const textItems: PositionedTextItem[] = [];

      for (const item of textContent.items) {
        if (!('str' in item)) continue;

        const str = item.str || '';
        const transform = 'transform' in item && Array.isArray(item.transform) ? item.transform : null;
        const x = transform?.[4] ?? 0;
        const y = transform?.[5] ?? 0;

        textItems.push({
          text: str,
          x,
          y,
          hasEOL: Boolean(item.hasEOL),
        });
      }

      const cleanText = cleanPdfText(textItems);
      const wordCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;

      pages.push({
        pageNumber: pageNum,
        text: cleanText,
        wordCount,
      });

      page.cleanup();
    } catch (pageErr) {
      console.warn(`Error extracting text from PDF page ${pageNum}:`, pageErr);
      pages.push({
        pageNumber: pageNum,
        text: `(Page ${pageNum} could not be read)`,
        wordCount: 0,
      });
    }
  }

  const fullText = pages
    .map((p) => p.text)
    .filter((t) => t && !t.startsWith('(Page '))
    .join('\n\n');

  onProgress?.({ percent: 100, message: 'Processing complete!', totalPages: numPages });

  return {
    filename: file.name,
    sizeBytes: file.size,
    numPages,
    fullText: fullText || '(No readable text extracted)',
    pages,
  };
}
