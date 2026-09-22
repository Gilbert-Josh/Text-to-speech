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
      
      const textItems: string[] = [];
      let lastY: number | null = null;

      for (const item of textContent.items) {
        if ('str' in item) {
          const str = item.str;
          if (!str && !item.hasEOL) continue;
          
          // Add line break if Y coordinate shifted significantly or hasEOL
          const currentY = 'transform' in item && Array.isArray(item.transform) ? item.transform[5] : null;
          if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 6) {
            textItems.push('\n');
          }
          lastY = currentY;

          textItems.push(str);
          if (item.hasEOL) {
            textItems.push('\n');
          } else {
            textItems.push(' ');
          }
        }
      }

      // Clean up text spacing and formatting
      const rawText = textItems.join('');
      const cleanText = rawText
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

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
