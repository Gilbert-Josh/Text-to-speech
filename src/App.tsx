import { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Play,
  Pause,
  Square,
  RotateCcw,
  Sparkles,
  Volume2,
  AlertCircle,
  Loader2,
  Wand2,
  Sliders,
  History,
  CheckCircle2,
  Radio,
  FileText,
  FileUp,
} from 'lucide-react';
import { KOKORO_VOICES, SPEAKING_STYLES, SAMPLE_TEXTS } from './data/voices';
import { GeneratedClip, SpeakingStyle, PdfDocumentData } from './types';
import { VoiceSelector } from './components/VoiceSelector';
import { AudioVisualizer } from './components/AudioVisualizer';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { HistoryPanel } from './components/HistoryPanel';
import { PdfUploader } from './components/PdfUploader';
import { processBase64Audio } from './utils/audio';
import { encodeKokoroWavBase64ToMp3, finishMp3Encoding, downloadMp3 } from './utils/mp3';
import * as lamejs from '@breezystack/lamejs';

// Helper to chunk text into sentence-safe units so speech synthesis can be controlled, tracked, and cancelled smoothly
function chunkTextForSpeech(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // Match sentence fragments or paragraphs
  const sentences = clean.match(/[^.!?\n]+[.!?\n]+/g) || [clean];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if ((currentChunk + ' ' + trimmed).length < 220) {
      currentChunk = currentChunk ? `${currentChunk} ${trimmed}` : trimmed;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = trimmed;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks.length > 0 ? chunks : [clean];
}

export default function App() {
  const [text, setText] = useState(
    'Welcome to Text to Speech Studio. You can synthesize realistic, expressive spoken audio with fine-tuned styles and distinct voice profiles.'
  );
  const [inputMode, setInputMode] = useState<'text' | 'pdf'>('text');
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentData | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('alloy');
  const [selectedStyle, setSelectedStyle] = useState<SpeakingStyle>('natural');
  const [engine, setEngine] = useState<'local' | 'browser'>('local');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeClip, setActiveClip] = useState<GeneratedClip | null>(null);
  const [history, setHistory] = useState<GeneratedClip[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [readingSectionTitle, setReadingSectionTitle] = useState<'full' | 'page' | null>(null);
  const [readingPageNumber, setReadingPageNumber] = useState<number | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [isPdfConverting, setIsPdfConverting] = useState(false);
  const [pdfConversionProgress, setPdfConversionProgress] = useState(0);
  const [pdfConversionStatus, setPdfConversionStatus] = useState<string | null>(null);
  const [pdfConversionComplete, setPdfConversionComplete] = useState(false);
  const [pdfDownloadName, setPdfDownloadName] = useState<string | null>(null);

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const speechChunksRef = useRef<string[]>([]);
  const currentChunkIndexRef = useRef<number>(0);
  const isSpeechCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const documentQueueRef = useRef<{
    pages: { pageNumber: number; text: string }[];
    currentIndex: number;
    isReading: boolean;
  }>({
    pages: [],
    currentIndex: 0,
    isReading: false,
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  const selectedVoice = KOKORO_VOICES.find((v) => v.id === selectedVoiceId) || KOKORO_VOICES[0];

  // Synthesize speech handler with optional direct text override
  const handleGenerate = async (
    overrideText?: string,
    meta?: { sourceDoc?: string; pageNumber?: number }
  ) => {
    const targetText = (overrideText !== undefined ? overrideText : text).trim();

    if (!targetText) {
      setErrorMessage('Please enter or select some text to speak.');
      return;
    }

    // Keep state synced
    setText(targetText);
    setErrorMessage(null);
    setIsLoading(true);

    if (engine === 'browser') {
      handleBrowserSynthesis(targetText, selectedVoiceId, selectedStyle, meta);
      return;
    }

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: targetText,
          voice: selectedVoiceId,
          speakingStyle: selectedStyle,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to synthesize speech');
      }

      if (!data.audioBase64) {
        throw new Error('No audio payload received from voice model.');
      }

      const { blobUrl } = processBase64Audio(data.audioBase64, data.mimeType);

      const newClip: GeneratedClip = {
        id: Math.random().toString(36).substring(2, 9),
        text: targetText,
        voice: selectedVoiceId,
        style: selectedStyle,
        engine: 'local',
        audioUrl: blobUrl,
        createdAt: Date.now(),
        sourceDoc: meta?.sourceDoc,
        pageNumber: meta?.pageNumber,
      };

      setActiveClip(newClip);
      setHistory((prev) => [newClip, ...prev.slice(0, 19)]);
    } catch (err: any) {
      const msg = err?.message || 'Speech generation encountered an error.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Stop any active speech synthesis and audio playback immediately
  const handleStopPlayback = () => {
    documentQueueRef.current = {
      pages: [],
      currentIndex: 0,
      isReading: false,
    };
    isSpeechCancelledRef.current = true;
    isPausedRef.current = false;
    speechChunksRef.current = [];
    currentChunkIndexRef.current = 0;

    if (synthRef.current) {
      synthRef.current.cancel();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }

    setIsPlaying(false);
    setIsPaused(false);
    setIsLoading(false);
    setReadingSectionTitle(null);
    setReadingPageNumber(null);
  };

  const handlePausePlayback = () => {
    isPausedRef.current = true;
    if (synthRef.current) {
      synthRef.current.pause();
    }
    if (audioElement) {
      audioElement.pause();
    }
    setIsPaused(true);
    setIsPlaying(false);
  };

  const handleResumePlayback = () => {
    isPausedRef.current = false;
    isSpeechCancelledRef.current = false;

    if (synthRef.current) {
      if (synthRef.current.paused) {
        synthRef.current.resume();
      } else if (speechChunksRef.current.length > 0) {
        speakChunk(currentChunkIndexRef.current);
      }
    }
    if (audioElement) {
      audioElement.play().catch(console.error);
    }
    setIsPaused(false);
    setIsPlaying(true);
  };

  // Keyboard shortcut: Escape immediately stops speech or audio playback
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (isPlaying || isPaused)) {
        handleStopPlayback();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isPlaying, isPaused]);

  const speakChunk = (index: number) => {
    if (isSpeechCancelledRef.current || !synthRef.current) {
      setIsPlaying(false);
      setIsPaused(false);
      setReadingSectionTitle(null);
      setReadingPageNumber(null);
      return;
    }

    const chunks = speechChunksRef.current;
    if (index >= chunks.length) {
      setIsPlaying(false);
      setIsPaused(false);
      setReadingSectionTitle(null);
      setReadingPageNumber(null);
      return;
    }

    currentChunkIndexRef.current = index;
    const chunkText = chunks[index];
    const utterance = new SpeechSynthesisUtterance(chunkText);
    const voices = synthRef.current.getVoices();

    // Map style to pitch and rate
    if (selectedStyle === 'cheerfully' || selectedStyle === 'energetic') {
      utterance.pitch = 1.25;
      utterance.rate = 1.1;
    } else if (selectedStyle === 'calm' || selectedStyle === 'whisper') {
      utterance.pitch = 0.9;
      utterance.rate = 0.85;
    } else if (selectedStyle === 'authoritative' || selectedStyle === 'news-anchor') {
      utterance.pitch = 0.95;
      utterance.rate = 1.0;
    } else {
      utterance.pitch = 1.0;
      utterance.rate = 1.0;
    }

    // Try matching voice gender/tone
    if (voices.length > 0) {
      const match = voices.find((v) =>
        v.name.toLowerCase().includes(selectedVoiceId.toLowerCase())
      ) || voices.find((v) => v.lang.startsWith('en')) || voices[0];
      if (match) utterance.voice = match;
    }

    utterance.onstart = () => {
      setIsPlaying(true);
      setIsPaused(false);
      setIsLoading(false);
    };

    utterance.onend = () => {
      if (!isSpeechCancelledRef.current && !isPausedRef.current) {
        if (index + 1 < speechChunksRef.current.length) {
          speakChunk(index + 1);
        } else {
          // If browser speech was reading a page in a document queue, advance to next page
          if (documentQueueRef.current.isReading) {
            const nextIndex = documentQueueRef.current.currentIndex + 1;
            if (nextIndex < documentQueueRef.current.pages.length) {
              documentQueueRef.current.currentIndex = nextIndex;
              playQueuePage(nextIndex);
              return;
            }
          }
          setIsPlaying(false);
          setIsPaused(false);
          setReadingSectionTitle(null);
          setReadingPageNumber(null);
        }
      }
    };

    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted' || isSpeechCancelledRef.current) {
        setIsPlaying(false);
        setIsPaused(false);
        return;
      }
      setIsPlaying(false);
      setIsPaused(false);
      setReadingSectionTitle(null);
      setReadingPageNumber(null);
      setErrorMessage(`Speech error: ${e.error}`);
    };

    synthRef.current.speak(utterance);
  };

  // Browser speech synthesis fallback / direct player
  const handleBrowserSynthesis = (
    textToSpeak: string,
    voiceName: string,
    style: SpeakingStyle,
    meta?: { sourceDoc?: string; pageNumber?: number }
  ) => {
    if (!synthRef.current) {
      setErrorMessage('Browser speech synthesis is not supported on this device.');
      setIsLoading(false);
      return;
    }

    // Stop any ongoing speech or audio
    handleStopPlayback();

    isSpeechCancelledRef.current = false;
    isPausedRef.current = false;

    const chunks = chunkTextForSpeech(textToSpeak);
    speechChunksRef.current = chunks;
    currentChunkIndexRef.current = 0;

    // Create entry in history
    const fallbackClip: GeneratedClip = {
      id: Math.random().toString(36).substring(2, 9),
      text: textToSpeak,
      voice: voiceName,
      style,
      engine: 'browser',
      audioUrl: '', // Browser direct utterance
      createdAt: Date.now(),
      sourceDoc: meta?.sourceDoc,
      pageNumber: meta?.pageNumber,
    };

    setActiveClip(fallbackClip);
    setHistory((prev) => [fallbackClip, ...prev.slice(0, 19)]);

    speakChunk(0);
  };

  // Plays the next PDF page using local Kokoro.
  const playQueuePage = async (index: number) => {
    if (!documentQueueRef.current.isReading) return;

    const pages = documentQueueRef.current.pages;
    if (index >= pages.length) {
      documentQueueRef.current.isReading = false;
      setIsPlaying(false);
      setIsPaused(false);
      setReadingSectionTitle(null);
      setReadingPageNumber(null);
      return;
    }

    const page = pages[index];
    documentQueueRef.current.currentIndex = index;
    setReadingSectionTitle('full');
    setReadingPageNumber(page.pageNumber);
    setText(page.text);

    if (engine === 'browser') {
      handleBrowserSynthesis(page.text, selectedVoiceId, selectedStyle, {
        sourceDoc: pdfDoc?.filename,
        pageNumber: page.pageNumber,
      });
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      let pageText = page.text.trim();
      if (pageText.length > 3800) {
        pageText = pageText.substring(0, 3800);
      }

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: pageText,
          voice: selectedVoiceId,
          speakingStyle: selectedStyle,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to synthesize page audio.');
      }

      if (!data.audioBase64) {
        throw new Error('No audio payload received from Kokoro.');
      }

      if (!documentQueueRef.current.isReading) return;

      const { blobUrl } = processBase64Audio(data.audioBase64, data.mimeType);
      const newClip: GeneratedClip = {
        id: Math.random().toString(36).substring(2, 9),
        text: pageText,
        voice: selectedVoiceId,
        style: selectedStyle,
        engine: 'local',
        audioUrl: blobUrl,
        createdAt: Date.now(),
        sourceDoc: pdfDoc?.filename,
        pageNumber: page.pageNumber,
      };

      setActiveClip(newClip);
      setHistory((prev) => [newClip, ...prev.slice(0, 19)]);
      setIsPlaying(true);
      setIsPaused(false);
    } catch (err: any) {
      console.error('Error generating page audio:', err);
      const msg = err?.message || 'Failed to synthesize audio';
      setErrorMessage(`Kokoro error on Page ${page.pageNumber}: ${msg}. Reading with Browser Speech.`);
      handleBrowserSynthesis(page.text, selectedVoiceId, selectedStyle, {
        sourceDoc: pdfDoc?.filename,
        pageNumber: page.pageNumber,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAudioEnded = () => {
    if (documentQueueRef.current.isReading) {
      const nextIndex = documentQueueRef.current.currentIndex + 1;
      if (nextIndex < documentQueueRef.current.pages.length) {
        documentQueueRef.current.currentIndex = nextIndex;
        playQueuePage(nextIndex);
      } else {
        documentQueueRef.current.isReading = false;
        setIsPlaying(false);
        setIsPaused(false);
        setReadingSectionTitle(null);
        setReadingPageNumber(null);
      }
    }
  };

  // Keyboard shortcut Ctrl/Cmd + Enter
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handlePreviewSample = (phrase: string, voiceId: string) => {
    setSelectedVoiceId(voiceId);
    setText(phrase);

    if (engine === 'browser') {
      handleBrowserSynthesis(phrase, voiceId, selectedStyle);
    } else {
      handleGenerate(phrase);
    }
  };

  const handleConvertPdfToMp3 = async () => {
    if (!pdfDoc?.fullText?.trim() || engine !== 'local' || isPdfConverting) return;

    const outputName = pdfDoc.filename.replace(/\\.pdf$/i, '.mp3');
    const chunks = chunkTextForSpeech(pdfDoc.fullText);
    if (!chunks.length) {
      setErrorMessage('No readable text was found in this PDF.');
      return;
    }

    setIsPdfConverting(true);
    setPdfConversionComplete(false);
    setPdfDownloadName(outputName);
    setPdfConversionProgress(1);
    setPdfConversionStatus('Preparing PDF text...');

    const encoder = new lamejs.Mp3Encoder(1, 24000, 128);
    const mp3Frames: Int8Array[] = [];

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: chunk,
            voice: selectedVoiceId,
            speakingStyle: selectedStyle,
          }),
        });

        const data = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data.error || `Speech generation failed at section ${index + 1}.`);
        }
        if (!data.audioBase64) {
          throw new Error(`No audio returned for section ${index + 1}.`);
        }

        const frames = encodeKokoroWavBase64ToMp3(data.audioBase64, encoder);
        mp3Frames.push(...frames);

        const percent = Math.round(((index + 1) / chunks.length) * 94);
        setPdfConversionProgress(percent);
        setPdfConversionStatus(`Generating speech: section ${index + 1} of ${chunks.length}`);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      setPdfConversionProgress(97);
      setPdfConversionStatus('Finalising MP3...');
      const finalFrame = finishMp3Encoding(encoder);
      if (finalFrame) mp3Frames.push(finalFrame);

      setPdfConversionProgress(100);
      setPdfConversionStatus('Download ready.');
      downloadMp3(mp3Frames, outputName);
      setPdfConversionComplete(true);
    } catch (error: any) {
      console.error('PDF MP3 conversion failed:', error);
      setErrorMessage(error?.message || 'Failed to convert the PDF to MP3.');
    } finally {
      setIsPdfConverting(false);
    }
  };

  const handleDocumentExtracted = (doc: PdfDocumentData) => {
    setPdfDoc(doc);
    setPdfConversionComplete(false);
    setPdfConversionProgress(0);
    setPdfConversionStatus(null);
    setPdfDownloadName(doc.filename.replace(/\\.pdf$/i, '.mp3'));
    setText(doc.fullText);
  };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estimatedSeconds = Math.max(1, Math.round(wordCount / 2.5));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col antialiased">
      {/* Top Navigation / App Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shadow-xs">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                Text to Speech Studio
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                AI Voice Synthesis & PDF Document Speech Reader
              </p>
            </div>
          </div>

          {/* Engine Selector / Status & Active Stop Button */}
          <div className="flex items-center gap-2">
            {(isPlaying || isPaused) && (
              <button
                type="button"
                id="header-stop-audio-btn"
                onClick={handleStopPlayback}
                title="Stop playback (Esc)"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-xs transition-colors shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Audio</span>
              </button>
            )}

            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                id="engine-select-online-btn"
                onClick={() => setEngine('local')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                  engine === 'local'
                    ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-2xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                <span>Online</span>
              </button>

              <button
                type="button"
                id="engine-select-browser-btn"
                onClick={() => setEngine('browser')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                  engine === 'browser'
                    ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-2xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Radio className="w-3.5 h-3.5 text-emerald-500" />
                <span>Offline Speech</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Studio Body */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Error notification banner if any */}
        {errorMessage && (
          <div
            id="error-banner"
            className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/80 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5 shadow-xs"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
            <div className="flex-1">
              <span className="font-semibold">Notice: </span>
              {errorMessage}
            </div>
            <button
              type="button"
              id="dismiss-error-btn"
              onClick={() => setErrorMessage(null)}
              className="text-rose-500 hover:text-rose-700 font-medium ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Input Mode Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="tab-type-text-btn"
              onClick={() => setInputMode('text')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                inputMode === 'text'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-2xs border border-slate-200 dark:border-slate-700'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Type / Edit Script</span>
            </button>

            <button
              type="button"
              id="tab-upload-pdf-btn"
              onClick={() => setInputMode('pdf')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                inputMode === 'pdf'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-2xs border border-slate-200 dark:border-slate-700'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>Upload PDF Document</span>
              {pdfDoc && (
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
              )}
            </button>
          </div>

          {pdfDoc && inputMode === 'text' && (
            <button
              type="button"
              id="view-current-pdf-btn"
              onClick={() => setInputMode('pdf')}
              className="text-xs text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 font-medium"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="truncate max-w-[150px]">{pdfDoc.filename}</span>
            </button>
          )}
        </div>

        {/* Input Panel Card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 space-y-4">
          {inputMode === 'pdf' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-sky-600" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    PDF Document Text-to-Speech
                  </h2>
                </div>

                {pdfDoc && (
                  <button
                    type="button"
                    id="switch-to-editor-btn"
                    onClick={() => setInputMode('text')}
                    className="text-xs text-sky-600 hover:text-sky-700 font-medium"
                  >
                    Edit Extracted Text in Script Editor →
                  </button>
                )}
              </div>

              {/* PDF Uploader Component */}
              <PdfUploader
                onDocumentExtracted={handleDocumentExtracted}
                currentDocument={pdfDoc}
                onClearDocument={() => {
                  handleStopPlayback();
                  setPdfDoc(null);
                  setPdfConversionComplete(false);
                  setPdfConversionProgress(0);
                  setPdfConversionStatus(null);
                }}
                onConvertToMp3={handleConvertPdfToMp3}
                isConverting={isPdfConverting}
                conversionProgress={pdfConversionProgress}
                conversionStatus={pdfConversionStatus}
                conversionComplete={pdfConversionComplete}
                downloadName={pdfDownloadName}
                engine={engine}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-sky-600" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Script & Narration Input
                  </h2>
                </div>

                {/* Presets Chips */}
                <div className="hidden sm:flex items-center gap-1.5 text-xs">
                  <span className="text-slate-400 mr-1">Presets:</span>
                  {SAMPLE_TEXTS.map((sample) => (
                    <button
                      key={sample.title}
                      type="button"
                      id={`preset-${sample.title.toLowerCase().replace(/\s+/g, '-')}`}
                      onClick={() => setText(sample.text)}
                      className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-700 hover:text-sky-600 transition-colors"
                    >
                      {sample.title}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <textarea
                  id="tts-text-input"
                  ref={textareaRef}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type or paste the text you want to synthesize into speech..."
                  className="w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-sky-500 text-sm leading-relaxed resize-y transition-all"
                />
                <div className="flex items-center justify-between px-1 text-[11px] text-slate-400 font-medium">
                  <span>
                    {wordCount} words • ~{estimatedSeconds}s estimated speech
                  </span>
                  <span>{text.length} characters</span>
                </div>
              </div>
            </div>
          )}

          {/* Speaking Style / Delivery Tone */}
          <div className="space-y-2 pt-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Expression & Delivery Tone
            </label>
            <div className="flex flex-wrap gap-2">
              {SPEAKING_STYLES.map((style) => {
                const isSelected = selectedStyle === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    id={`style-chip-${style.id}`}
                    onClick={() => setSelectedStyle(style.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all font-medium flex items-center gap-1.5 ${
                      isSelected
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/20'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <span>{style.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Voice Actor Selector */}
          <VoiceSelector
            voices={KOKORO_VOICES}
            selectedVoiceId={selectedVoiceId}
            onSelectVoice={(id) => setSelectedVoiceId(id)}
            onPreviewSample={handlePreviewSample}
          />

          {/* Generate Button Row */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                Engine: {engine === 'local' ? 'Kokoro Local TTS (24 kHz)' : 'Browser Speech'}
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                id="reset-text-btn"
                onClick={() => setText('')}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors"
              >
                Clear
              </button>

              <button
                type="button"
                id="synthesize-speech-btn"
                disabled={isLoading || !text.trim()}
                onClick={() => handleGenerate()}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold shadow-xs transition-all active:scale-98"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Synthesizing Voice...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    <span>Generate Speech (Cmd + Enter)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Real-time Audio Visualizer & Player Section */}
        <div className="space-y-4">
          <AudioVisualizer
            audioElement={audioElement}
            isPlaying={isPlaying}
            accentColor={selectedVoice.color}
          />

          {activeClip && (
            <AudioPlayerBar
              clip={activeClip}
              isPlaying={isPlaying}
              isPaused={isPaused}
              onAudioElementChange={(el) => setAudioElement(el)}
              onPlayStateChange={(state) => setIsPlaying(state)}
              onStop={handleStopPlayback}
              onEnded={handleAudioEnded}
            />
          )}
        </div>

        {/* Generation History Panel */}
        <HistoryPanel
          clips={history}
          activeClipId={activeClip?.id || null}
          onSelectClip={(clip) => {
            setActiveClip(clip);
            setText(clip.text);
            setSelectedVoiceId(clip.voice);
            setSelectedStyle(clip.style);
          }}
          onDeleteClip={(id) => {
            setHistory((prev) => prev.filter((c) => c.id !== id));
            if (activeClip?.id === id) {
              setActiveClip(null);
            }
          }}
          onClearHistory={() => {
            setHistory([]);
            setActiveClip(null);
          }}
        />
      </main>

      {/* Subtle Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-4 text-center text-xs text-slate-400">
        Text to Speech Studio • High fidelity audio synthesis powered by kokoro and peanuts
      </footer>
    </div>
  );
}
