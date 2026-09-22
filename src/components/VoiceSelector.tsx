import { VoiceOption } from '../types';
import { Volume2, Sparkles, Check } from 'lucide-react';

interface VoiceSelectorProps {
  voices: VoiceOption[];
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  onPreviewSample?: (sampleText: string, voiceId: string) => void;
}

export function VoiceSelector({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onPreviewSample,
}: VoiceSelectorProps) {
  return (
    <div id="voice-selector-root" className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Select AI Voice Actor
        </label>
        <span className="text-xs text-slate-500">
          5 Studio Timbre Profiles
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {voices.map((voice) => {
          const isSelected = voice.id === selectedVoiceId;
          return (
            <div
              key={voice.id}
              id={`voice-card-${voice.id.toLowerCase()}`}
              onClick={() => onSelectVoice(voice.id)}
              className={`group relative text-left p-3.5 rounded-xl border transition-all cursor-pointer select-none flex flex-col justify-between ${
                isSelected
                  ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/20 shadow-sm ring-1 ring-sky-500/30'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900"
                      style={{ backgroundColor: voice.color }}
                    />
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {voice.name}
                    </h4>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                      {voice.gender}
                    </span>
                  </div>

                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[2.5]" />
                    </span>
                  )}
                </div>

                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500 inline" />
                  {voice.personality}
                </p>

                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                  {voice.description}
                </p>
              </div>

              {onPreviewSample && (
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 italic truncate max-w-[170px]">
                    "{voice.samplePhrase}"
                  </span>
                  <button
                    type="button"
                    id={`preview-voice-btn-${voice.id.toLowerCase()}`}
                    title="Preview voice"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreviewSample(voice.samplePhrase, voice.id);
                    }}
                    className="p-1 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
