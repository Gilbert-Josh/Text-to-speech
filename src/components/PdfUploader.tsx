import { useState, useEffect, useRef, DragEvent, ChangeEvent } from 'react';
import {
  FileUp,
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  X,
  Volume2,
  BookOpen,
  Layers,
  Play,
  Pause,
  Square,
} from 'lucide-react';
import { PdfDocumentData } from '../types';
import { extractPdfInBrowser } from '../utils/pdfParser';

interface PdfUploaderProps {
  onDocumentExtracted: (doc: PdfDocumentData, selectedTextToRead?: string) => void;
  onSynthesizeSection?: (text: string, title: string, pageNumber?: number) => void;
  currentDocument: PdfDocumentData | null;
  onClearDocument: () => void;
  isPlaying?: boolean;
  isPaused?: boolean;
  readingSectionTitle?: string | null;
  readingPageNumber?: number | null;
  voiceName?: string;
  engine?: 'gemini' | 'browser';
  onStopReading?: () => void;
  onPauseReading?: () => void;
  onResumeReading?: () => void;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadFileWithProgress(
  file: File,
  onProgress: (percent: number, message: string) => void
): Promise<PdfDocumentData> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/pdf-extract');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.min(80, Math.round(20 + (event.loaded / event.total) * 60));
        const loadedMb = (event.loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (event.total / (1024 * 1024)).toFixed(1);
        onProgress(percent, `Uploading file for OCR (${loadedMb}MB of ${totalMb}MB)...`);
      }
    };

    xhr.onload = () => {
      onProgress(88, 'Analyzing document and performing OCR...');
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          onProgress(100, 'Extraction complete!');
          resolve(data);
        } catch {
          reject(new Error('Failed to parse server response as JSON.'));
        }
      } else {
        if (xhr.status === 413) {
          reject(new Error('This PDF exceeds the maximum network transfer limit for server OCR. Please use a PDF with selectable text.'));
          return;
        }
        let msg = `Server error (${xhr.status})`;
        if (contentType.includes('application/json')) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.error) msg = data.error;
          } catch {}
        } else {
          const titleMatch = xhr.responseText.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) msg = titleMatch[1];
        }
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during PDF upload.'));
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}

export function PdfUploader({
  onDocumentExtracted,
  onSynthesizeSection,
  currentDocument,
  onClearDocument,
  isPlaying = false,
  isPaused = false,
  readingSectionTitle = null,
  readingPageNumber = null,
  voiceName,
  engine = 'gemini',
  onStopReading,
  onPauseReading,
  onResumeReading,
}: PdfUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadFileSize, setUploadFileSize] = useState<number | null>(null);
  const [uploadPageInfo, setUploadPageInfo] = useState<{ current?: number; total?: number } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync active view page when sequential reader transitions across document pages
  useEffect(() => {
    if (readingPageNumber && currentDocument) {
      const idx = currentDocument.pages.findIndex((p) => p.pageNumber === readingPageNumber);
      if (idx !== -1) {
        setSelectedPageIndex(idx);
      }
    }
  }, [readingPageNumber, currentDocument]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      processFile(file);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      processFile(file);
    }
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setUploadError('Please select a valid PDF file.');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setUploadError('File size exceeds the 100MB limit.');
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(5);
    setUploadFileName(file.name);
    setUploadFileSize(file.size);
    setUploadPageInfo(null);
    setUploadStatus('Reading PDF directly in browser...');

    try {
      let clientResult: PdfDocumentData | null = null;

      // 1. Primary: Instant client-side parsing via PDF.js worker with live progress updates
      try {
        clientResult = await extractPdfInBrowser(file, (prog) => {
          setUploadProgress(prog.percent);
          setUploadStatus(prog.message);
          if (prog.currentPage && prog.totalPages) {
            setUploadPageInfo({ current: prog.currentPage, total: prog.totalPages });
          }
        });
      } catch (browserErr) {
        console.warn('In-browser PDF parsing notice, will try server fallback:', browserErr);
      }

      // Check if client-side extraction found readable text
      const hasMeaningfulText =
        clientResult &&
        clientResult.fullText &&
        clientResult.fullText.trim().length >= 25 &&
        !clientResult.fullText.includes('(No readable text extracted)');

      if (hasMeaningfulText && clientResult) {
        setUploadProgress(100);
        setSelectedPageIndex(0);
        onDocumentExtracted(clientResult);
        return;
      }

      // 2. Secondary fallback: Send to server for OCR (scanned image PDFs) with network upload progress
      setUploadProgress(20);
      setUploadStatus('Document appears scanned or image-based. Uploading for OCR text extraction...');

      const data = await uploadFileWithProgress(file, (percent, msg) => {
        setUploadProgress(percent);
        setUploadStatus(msg);
      });

      setSelectedPageIndex(0);
      onDocumentExtracted(data);
    } catch (err: any) {
      console.error('PDF upload error:', err);
      setUploadError(err.message || 'Could not process PDF.');
    } finally {
      setIsUploading(false);
      setUploadStatus(null);
      setUploadProgress(0);
      setUploadFileName(null);
      setUploadFileSize(null);
      setUploadPageInfo(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // When a file is actively uploading/parsing, show the dedicated progress card with animated progress bar
  if (isUploading) {
    return (
      <div id="pdf-uploader-section" className="space-y-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="application/pdf,.pdf"
          className="hidden"
          id="pdf-file-input"
        />

        <div
          id="pdf-upload-progress-card"
          className="rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/20 p-5 sm:p-6 space-y-4 shadow-2xs transition-all"
        >
          {/* Header row with file info and percentage */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {uploadFileName || 'Processing PDF document...'}
                  </h3>
                  {uploadFileSize && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                      ({formatFileSize(uploadFileSize)})
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {uploadStatus || 'Extracting text...'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {uploadPageInfo && uploadPageInfo.total && (
                <span
                  id="pdf-upload-page-counter"
                  className="px-2 py-0.5 rounded-md text-xs font-semibold bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 whitespace-nowrap"
                >
                  Page {uploadPageInfo.current} of {uploadPageInfo.total}
                </span>
              )}
              <span
                id="pdf-upload-percentage"
                className="text-base font-bold text-sky-600 dark:text-sky-400 tabular-nums whitespace-nowrap"
              >
                {uploadProgress}%
              </span>
            </div>
          </div>

          {/* Progress Bar Track & Indicator */}
          <div
            id="pdf-upload-progress-track"
            className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden p-0.5"
            role="progressbar"
            aria-valuenow={uploadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              id="pdf-upload-progress-fill"
              className="bg-sky-600 dark:bg-sky-500 h-full rounded-full transition-all duration-300 ease-out shadow-xs"
              style={{ width: `${Math.max(3, Math.min(100, uploadProgress))}%` }}
            />
          </div>

          {/* Subtext info */}
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span>Parsing text and layout directly in browser</span>
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Files up to 100MB supported
            </span>
          </div>
        </div>
      </div>
    );
  }

  // If a document is loaded, display document navigation & reader controls
  if (currentDocument) {
    const activePage =
      currentDocument.pages[selectedPageIndex] || currentDocument.pages[0];
    const totalWords = currentDocument.pages.reduce((acc, p) => acc + p.wordCount, 0);

    const isReadingFullDoc = (isPlaying || isPaused) && readingSectionTitle === 'full';
    const isReadingThisPage =
      (isPlaying || isPaused) &&
      readingSectionTitle === 'page' &&
      readingPageNumber === (activePage?.pageNumber || 1);
    const isReadingAny = (isPlaying || isPaused) && (isReadingFullDoc || readingSectionTitle === 'page');

    return (
      <div
        id="pdf-document-viewer"
        className="rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-950/20 p-4 sm:p-5 space-y-4 transition-all"
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="application/pdf,.pdf"
          className="hidden"
          id="pdf-file-input-reupload"
        />

        {/* Document Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-sky-100 dark:border-sky-900/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {currentDocument.filename}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span>{formatFileSize(currentDocument.sizeBytes)}</span>
                <span>•</span>
                <span>{currentDocument.numPages} {currentDocument.numPages === 1 ? 'Page' : 'Pages'}</span>
                <span>•</span>
                <span>{totalWords.toLocaleString()} Words</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              id="upload-different-pdf-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Upload another PDF"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs"
            >
              <FileUp className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Replace PDF</span>
            </button>

            {onSynthesizeSection && (
              isReadingFullDoc ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    id="pause-entire-pdf-btn"
                    onClick={isPaused ? onResumeReading : onPauseReading}
                    title={isPaused ? 'Resume reading' : 'Pause reading'}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs"
                  >
                    {isPaused ? (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Resume</span>
                      </>
                    ) : (
                      <>
                        <Pause className="w-3.5 h-3.5 fill-current" />
                        <span>Pause</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    id="stop-entire-pdf-btn"
                    onClick={onStopReading}
                    title="Stop reading full document"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-2xs transition-colors"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop Reading</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  id="read-entire-pdf-btn"
                  onClick={() =>
                    onSynthesizeSection(
                      currentDocument.fullText,
                      `${currentDocument.filename} (Full Document)`
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium shadow-2xs transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-sky-200" />
                  <span>Read Full Document ({engine === 'browser' ? 'Browser' : voiceName || 'AI Voice'})</span>
                </button>
              )
            )}

            <button
              type="button"
              id="clear-pdf-doc-btn"
              onClick={onClearDocument}
              title="Close document"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Active Playback Status Banner */}
        {isReadingAny && (
          <div
            id="pdf-active-playback-banner"
            className="flex items-center justify-between p-3 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-100/70 dark:bg-sky-950/60 text-slate-900 dark:text-slate-100 shadow-2xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <Volume2 className={`w-4 h-4 ${!isPaused ? 'animate-pulse' : ''}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {isReadingFullDoc
                    ? `Reading Full Document • Page ${readingPageNumber || activePage?.pageNumber || 1} of ${currentDocument.pages.length || 1}`
                    : `Reading Page ${readingPageNumber || activePage?.pageNumber || 1}: ${currentDocument.filename}`}
                </p>
                <p className="text-[11px] text-sky-700 dark:text-sky-300 flex items-center gap-2">
                  <span>{isPaused ? 'Paused' : 'Active speech playback'}</span>
                  <span>•</span>
                  <span className="font-semibold text-sky-800 dark:text-sky-200">
                    Voice: {engine === 'browser' ? 'Browser Speech (Offline)' : `${voiceName || 'Gemini'} (Studio AI)`}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                id="banner-pause-resume-btn"
                onClick={isPaused ? onResumeReading : onPauseReading}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                type="button"
                id="banner-stop-reading-btn"
                onClick={onStopReading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-2xs transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            </div>
          </div>
        )}

        {/* Page Selector & Reader Tabs */}
        {currentDocument.pages.length > 1 && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                id="pdf-prev-page-btn"
                disabled={selectedPageIndex === 0}
                onClick={() => setSelectedPageIndex((i) => Math.max(0, i - 1))}
                className="p-1 rounded-md text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="text-xs font-medium px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                Page {selectedPageIndex + 1} of {currentDocument.pages.length}
              </span>

              <button
                type="button"
                id="pdf-next-page-btn"
                disabled={selectedPageIndex === currentDocument.pages.length - 1}
                onClick={() =>
                  setSelectedPageIndex((i) =>
                    Math.min(currentDocument.pages.length - 1, i + 1)
                  )
                }
                className="p-1 rounded-md text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Page Jump Pills */}
            <div className="flex items-center gap-1 overflow-x-auto max-w-xs sm:max-w-md py-1">
              {currentDocument.pages.map((p, idx) => (
                <button
                  key={p.pageNumber}
                  type="button"
                  id={`pdf-page-jump-${p.pageNumber}`}
                  onClick={() => setSelectedPageIndex(idx)}
                  className={`px-2 py-0.5 text-xs font-medium rounded-md transition-all ${
                    idx === selectedPageIndex
                      ? 'bg-sky-600 text-white'
                      : 'bg-white/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-sky-100 dark:hover:bg-slate-700'
                  }`}
                >
                  P.{p.pageNumber}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Page Content Preview Box */}
        <div className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-sky-500" />
              Page {activePage?.pageNumber || 1} Text ({activePage?.wordCount || 0} words)
            </span>

            {isReadingThisPage ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="pause-current-page-btn"
                  onClick={isPaused ? onResumeReading : onPauseReading}
                  className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium"
                >
                  {isPaused ? <Play className="w-3 h-3 fill-current" /> : <Pause className="w-3 h-3 fill-current" />}
                  <span>{isPaused ? 'Resume' : 'Pause'}</span>
                </button>
                <button
                  type="button"
                  id="stop-current-page-btn"
                  onClick={onStopReading}
                  className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-semibold"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                id="read-current-page-btn"
                onClick={() => {
                  if (activePage?.text) {
                    onSynthesizeSection?.(
                      activePage.text,
                      `${currentDocument.filename} (Page ${activePage.pageNumber})`,
                      activePage.pageNumber
                    );
                  }
                }}
                className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 font-medium"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Read This Page</span>
              </button>
            )}
          </div>

          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans max-h-48 overflow-y-auto whitespace-pre-wrap select-text pr-2">
            {activePage?.text || '(No readable text on this page)'}
          </p>
        </div>
      </div>
    );
  }

  // Upload Dropzone
  return (
    <div id="pdf-uploader-section" className="space-y-2">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="application/pdf,.pdf"
        className="hidden"
        id="pdf-file-input"
      />

      <div
        id="pdf-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`group relative rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-2 ring-sky-500/20'
            : 'border-slate-200 dark:border-slate-800 hover:border-sky-400 dark:hover:border-sky-600 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-sky-50/30'
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-2.5">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 ${
              isDragging
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-white dark:bg-slate-800 text-sky-600 border border-slate-200 dark:border-slate-700 shadow-2xs'
            }`}
          >
            {isUploading ? (
              <Loader2 className="w-6 h-6 animate-spin text-sky-600" />
            ) : (
              <FileUp className="w-6 h-6 text-sky-600" />
            )}
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isUploading ? (
                uploadStatus || 'Extracting text from PDF...'
              ) : (
                <>
                  <span className="text-sky-600 hover:underline">Click to upload PDF</span>{' '}
                  or drag and drop
                </>
              )}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Supports standard and scanned PDF files up to 100MB with page-by-page extraction
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1 text-[11px] text-slate-400 font-medium">
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-sky-500" /> Multi-page breakdown
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" /> Instant speech conversion
            </span>
          </div>
        </div>
      </div>

      {uploadError && (
        <p className="text-xs text-rose-500 dark:text-rose-400 pl-1 font-medium">
          {uploadError}
        </p>
      )}
    </div>
  );
}
