import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { FileUp, FileText, Loader2, Sparkles, X, Download, CheckCircle2 } from 'lucide-react';
import { PdfDocumentData } from '../types';
import { extractPdfInBrowser } from '../utils/pdfParser';

interface PdfUploaderProps {
  onDocumentExtracted: (doc: PdfDocumentData) => void;
  currentDocument: PdfDocumentData | null;
  onClearDocument: () => void;
  onConvertToMp3?: () => void;
  isConverting?: boolean;
  conversionProgress?: number;
  conversionStatus?: string | null;
  conversionComplete?: boolean;
  downloadName?: string | null;
  engine?: 'local' | 'browser';
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
        onProgress(percent, `Uploading PDF (${loadedMb}MB of ${totalMb}MB)...`);
      }
    };

    xhr.onload = () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          onProgress(100, 'PDF text extraction complete.');
          resolve(data);
        } catch {
          reject(new Error('Failed to parse the PDF extraction response.'));
        }
      } else {
        let message = `Server error (${xhr.status})`;
        if (contentType.includes('application/json')) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.error) message = data.error;
          } catch {}
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during PDF upload.'));
    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}

export function PdfUploader({
  onDocumentExtracted,
  currentDocument,
  onClearDocument,
  onConvertToMp3,
  isConverting = false,
  conversionProgress = 0,
  conversionStatus = null,
  conversionComplete = false,
  downloadName = null,
  engine = 'local',
}: PdfUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadFileSize, setUploadFileSize] = useState<number | null>(null);
  const [uploadPageInfo, setUploadPageInfo] = useState<{ current?: number; total?: number } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setUploadStatus('Reading PDF text...');

    try {
      let clientResult: PdfDocumentData | null = null;

      try {
        clientResult = await extractPdfInBrowser(file, (prog) => {
          setUploadProgress(prog.percent);
          setUploadStatus(prog.message);
          if (prog.currentPage && prog.totalPages) {
            setUploadPageInfo({ current: prog.currentPage, total: prog.totalPages });
          }
        });
      } catch (browserError) {
        console.warn('Browser PDF extraction failed; trying server fallback.', browserError);
      }

      const hasMeaningfulText =
        clientResult &&
        clientResult.fullText &&
        clientResult.fullText.trim().length >= 25 &&
        !clientResult.fullText.includes('(No readable text extracted)');

      if (hasMeaningfulText && clientResult) {
        onDocumentExtracted(clientResult);
        return;
      }

      setUploadProgress(20);
      setUploadStatus('Sending scanned PDF for text extraction...');
      const data = await uploadFileWithProgress(file, (percent, message) => {
        setUploadProgress(percent);
        setUploadStatus(message);
      });
      onDocumentExtracted(data);
    } catch (error: any) {
      console.error('PDF upload error:', error);
      setUploadError(error?.message || 'Could not process PDF.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadFileName(null);
      setUploadFileSize(null);
      setUploadPageInfo(null);
      setUploadStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
  };

  if (isUploading) {
    return (
      <div id="pdf-uploader-section" className="space-y-2">
        <div className="rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/20 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">{uploadFileName || 'Processing PDF...'}</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{uploadStatus || 'Extracting text...'}</p>
              </div>
            </div>
            <span className="text-base font-bold text-sky-600 tabular-nums">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
            <div className="bg-sky-600 h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(3, uploadProgress)}%` }} />
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>{uploadPageInfo?.total ? `Page ${uploadPageInfo.current} of ${uploadPageInfo.total}` : 'Preparing document...'}</span>
            <span>{uploadFileSize ? formatFileSize(uploadFileSize) : ''}</span>
          </div>
        </div>
      </div>
    );
  }

  if (currentDocument) {
    const totalWords = currentDocument.pages.reduce((total, page) => total + page.wordCount, 0);
    const outputName = downloadName || currentDocument.filename.replace(/\.pdf$/i, '.mp3');

    return (
      <div id="pdf-document-viewer" className="rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-950/20 p-5 space-y-5">
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="application/pdf,.pdf" className="hidden" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">{currentDocument.filename}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {currentDocument.numPages.toLocaleString()} pages • {totalWords.toLocaleString()} words • {formatFileSize(currentDocument.sizeBytes)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isConverting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium disabled:opacity-50">
              <FileUp className="w-3.5 h-3.5 text-sky-600" />
              Replace PDF
            </button>
            <button type="button" onClick={onClearDocument} disabled={isConverting} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 disabled:opacity-50" title="Close PDF">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-sky-600" />
            <div>
              <h4 className="text-sm font-semibold">Convert entire PDF to one MP3</h4>
              <p className="text-xs text-slate-500">The pages are processed internally; you receive one continuous audiobook-style file.</p>
            </div>
          </div>

          {isConverting && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>{conversionStatus || 'Converting PDF...'}</span>
                <span className="tabular-nums text-sky-600">{conversionProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 h-3 rounded-full overflow-hidden" role="progressbar" aria-valuenow={conversionProgress} aria-valuemin={0} aria-valuemax={100}>
                <div className="bg-sky-600 h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(2, conversionProgress)}%` }} />
              </div>
            </div>
          )}

          {conversionComplete && !isConverting && (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
              <span>MP3 ready: <strong>{outputName}</strong></span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="text-xs text-slate-500">
              <Sparkles className="w-3.5 h-3.5 inline mr-1 text-sky-500" />
              Engine: {engine === 'local' ? 'Kokoro Local' : 'Browser Speech'}
            </div>
            <button
              type="button"
              onClick={onConvertToMp3}
              disabled={isConverting || engine !== 'local'}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold"
            >
              {isConverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isConverting ? 'Converting...' : conversionComplete ? 'Create MP3 Again' : 'Download Full PDF as MP3'}
            </button>
          </div>

          {engine !== 'local' && (
            <p className="text-xs text-amber-600">Switch to Kokoro Local to create an MP3. Browser speech does not expose the generated audio for file export.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div id="pdf-uploader-section" className="space-y-2">
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="application/pdf,.pdf" className="hidden" />
      <div
        id="pdf-dropzone"
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`group relative rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${isDragging ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-slate-200 dark:border-slate-800 hover:border-sky-400 bg-slate-50/50 dark:bg-slate-900/50'}`}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-800 text-sky-600 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-2xs">
            <FileUp className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-semibold"><span className="text-sky-600">Click to upload PDF</span> or drag and drop</p>
            <p className="text-xs text-slate-500 mt-1">PDF files up to 100MB • text is processed locally when possible</p>
          </div>
        </div>
      </div>
      {uploadError && <p className="text-xs text-rose-500 pl-1 font-medium">{uploadError}</p>}
    </div>
  );
}
