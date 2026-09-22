import { Play, Download, Trash2, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { GeneratedClip } from '../types';
import { downloadAudioBlob } from '../utils/audio';

interface HistoryPanelProps {
  clips: GeneratedClip[];
  activeClipId: string | null;
  onSelectClip: (clip: GeneratedClip) => void;
  onDeleteClip: (id: string) => void;
  onClearHistory: () => void;
}

export function HistoryPanel({
  clips,
  activeClipId,
  onSelectClip,
  onDeleteClip,
  onClearHistory,
}: HistoryPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownload = async (clip: GeneratedClip) => {
    if (!clip.audioUrl) return;
    try {
      const resp = await fetch(clip.audioUrl);
      const blob = await resp.blob();
      downloadAudioBlob(blob, `tts-${clip.voice.toLowerCase()}-${clip.id}.wav`);
    } catch {
      window.open(clip.audioUrl, '_blank');
    }
  };

  if (clips.length === 0) {
    return null;
  }

  return (
    <div id="history-panel-root" className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Generated Clips ({clips.length})
          </h3>
        </div>
        <button
          type="button"
          id="clear-all-history-btn"
          onClick={onClearHistory}
          className="text-xs text-rose-500 hover:text-rose-600 transition-colors"
        >
          Clear All
        </button>
      </div>

      <div className="space-y-2">
        {clips.map((clip) => {
          const isActive = clip.id === activeClipId;
          const dateStr = new Date(clip.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });

          return (
            <div
              key={clip.id}
              id={`history-item-${clip.id}`}
              onClick={() => onSelectClip(clip)}
              className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                isActive
                  ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/20 ring-1 ring-sky-500/30'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  id={`play-history-btn-${clip.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(clip);
                  }}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                </button>

                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                    {clip.text}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      {clip.voice}
                    </span>
                    <span>•</span>
                    <span className="capitalize">{clip.style.replace('-', ' ')}</span>
                    {clip.sourceDoc && (
                      <>
                        <span>•</span>
                        <span className="px-1.5 py-0.2 rounded bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 font-medium truncate max-w-[120px]">
                          PDF: {clip.sourceDoc}
                        </span>
                      </>
                    )}
                    <span>•</span>
                    <span>{dateStr}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  id={`copy-clip-btn-${clip.id}`}
                  title="Copy text prompt"
                  onClick={() => handleCopy(clip.id, clip.text)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {copiedId === clip.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>

                {clip.audioUrl && (
                  <button
                    type="button"
                    id={`download-clip-btn-${clip.id}`}
                    title="Export WAV"
                    onClick={() => handleDownload(clip)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  id={`delete-clip-btn-${clip.id}`}
                  title="Delete clip"
                  onClick={() => onDeleteClip(clip.id)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-slate-800"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
