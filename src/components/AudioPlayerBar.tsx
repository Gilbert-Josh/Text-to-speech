import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Volume2,
  VolumeX,
  Download,
  Repeat,
} from 'lucide-react';
import { GeneratedClip } from '../types';
import { downloadAudioBlob } from '../utils/audio';

interface AudioPlayerBarProps {
  clip: GeneratedClip | null;
  isPlaying?: boolean;
  isPaused?: boolean;
  onAudioElementChange?: (audio: HTMLAudioElement | null) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onStop?: () => void;
  onEnded?: () => void;
}

export function AudioPlayerBar({
  clip,
  isPlaying: propIsPlaying,
  isPaused: propIsPaused,
  onAudioElementChange,
  onPlayStateChange,
  onStop,
  onEnded,
}: AudioPlayerBarProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(propIsPlaying ?? false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLooping, setIsLooping] = useState(false);

  // Sync external playing state
  useEffect(() => {
    if (typeof propIsPlaying === 'boolean') {
      setIsPlaying(propIsPlaying);
    }
  }, [propIsPlaying]);

  useEffect(() => {
    if (onAudioElementChange) {
      onAudioElementChange(clip?.audioUrl ? audioRef.current : null);
    }
  }, [clip?.audioUrl, onAudioElementChange]);

  useEffect(() => {
    if (!clip?.audioUrl || !audioRef.current) return;
    const audio = audioRef.current;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (onPlayStateChange) onPlayStateChange(false);
      setCurrentTime(0);
      if (onEnded) {
        onEnded();
      }
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    // Auto-play newly created clip
    audio.play().then(() => {
      setIsPlaying(true);
      if (onPlayStateChange) onPlayStateChange(true);
    }).catch(() => {
      // Browser autoplay policy
      setIsPlaying(false);
      if (onPlayStateChange) onPlayStateChange(false);
    });

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [clip?.audioUrl]);

  const togglePlay = () => {
    if (!clip?.audioUrl) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (isPlaying) {
          window.speechSynthesis.pause();
          setIsPlaying(false);
          if (onPlayStateChange) onPlayStateChange(false);
        } else if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
          setIsPlaying(true);
          if (onPlayStateChange) onPlayStateChange(true);
        } else {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(clip?.text || '');
          utterance.onend = () => {
            setIsPlaying(false);
            if (onPlayStateChange) onPlayStateChange(false);
          };
          utterance.onerror = () => {
            setIsPlaying(false);
            if (onPlayStateChange) onPlayStateChange(false);
          };
          window.speechSynthesis.speak(utterance);
          setIsPlaying(true);
          if (onPlayStateChange) onPlayStateChange(true);
        }
      }
      return;
    }

    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      if (onPlayStateChange) onPlayStateChange(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
        if (onPlayStateChange) onPlayStateChange(true);
      }).catch(console.error);
    }
  };

  const handleStop = () => {
    if (onStop) {
      onStop();
      return;
    }
    if (!clip?.audioUrl) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        setIsPlaying(false);
        if (onPlayStateChange) onPlayStateChange(false);
      }
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      if (onPlayStateChange) onPlayStateChange(false);
    }
  };

  const handleRestart = () => {
    if (!clip?.audioUrl) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(clip?.text || '');
        utterance.onend = () => {
          setIsPlaying(false);
          if (onPlayStateChange) onPlayStateChange(false);
        };
        utterance.onerror = () => {
          setIsPlaying(false);
          if (onPlayStateChange) onPlayStateChange(false);
        };
        window.speechSynthesis.speak(utterance);
        setIsPlaying(true);
        if (onPlayStateChange) onPlayStateChange(true);
      }
      return;
    }

    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().then(() => {
      setIsPlaying(true);
      if (onPlayStateChange) onPlayStateChange(true);
    }).catch(console.error);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const target = parseFloat(e.target.value);
    audioRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      if (val === 0) setIsMuted(true);
      else setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackRate(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const toggleLoop = () => {
    const nextLoop = !isLooping;
    setIsLooping(nextLoop);
    if (audioRef.current) {
      audioRef.current.loop = nextLoop;
    }
  };

  const handleDownload = async () => {
    if (!clip?.audioUrl) return;
    try {
      const resp = await fetch(clip.audioUrl);
      const blob = await resp.blob();
      const filename = `speech-${clip.voice.toLowerCase()}-${Date.now()}.wav`;
      downloadAudioBlob(blob, filename);
    } catch {
      window.open(clip.audioUrl, '_blank');
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!clip) return null;

  return (
    <div
      id="audio-player-bar"
      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3"
    >
      {/* Audio element rendered only when valid URL exists to avoid empty string src warnings */}
      {clip.audioUrl ? (
        <audio ref={audioRef} src={clip.audioUrl} preload="auto" />
      ) : null}

      {/* Track Metadata & Quick Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">
              {clip.voice} Voice
            </span>
            <span className="text-xs text-slate-500 capitalize">
              {clip.style.replace('-', ' ')}
            </span>
            <span className="text-[11px] text-slate-400 border-l pl-2 border-slate-200 dark:border-slate-800">
              {clip.engine === 'gemini' ? 'Gemini 3.1 TTS' : 'Web Speech'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">
            "{clip.text}"
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Speed Selector */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 text-xs font-medium">
            {[0.75, 1, 1.25, 1.5].map((speed) => (
              <button
                key={speed}
                type="button"
                id={`playback-speed-${speed}x`}
                onClick={() => handleSpeedChange(speed)}
                className={`px-1.5 py-0.5 rounded-md transition-colors ${
                  playbackRate === speed
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>

          {/* Loop Button */}
          {clip.audioUrl && (
            <button
              type="button"
              id="audio-loop-toggle-btn"
              onClick={toggleLoop}
              title={isLooping ? 'Looping enabled' : 'Enable loop'}
              className={`p-2 rounded-lg border text-xs transition-colors ${
                isLooping
                  ? 'border-sky-500 bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400'
                  : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Download Audio */}
          {clip.audioUrl ? (
            <button
              type="button"
              id="download-audio-btn"
              onClick={handleDownload}
              title="Download speech audio (WAV)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-sky-600" />
              <span>Export WAV</span>
            </button>
          ) : (
            <button
              type="button"
              id="download-audio-btn-disabled"
              disabled
              title="Export is available for Gemini AI audio"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 text-xs font-medium opacity-50 cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Live Synth</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress Scrubber */}
      {clip.audioUrl ? (
        <div className="space-y-1">
          <div className="relative flex items-center">
            <input
              id="audio-progress-slider"
              type="range"
              min="0"
              max={duration || 1}
              step="0.01"
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-400 font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-lg">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
            {isPlaying ? 'Speaking via Web Speech API...' : 'Ready to speak via Browser Speech'}
          </span>
          <span className="text-slate-400">Live synthesis</span>
        </div>
      )}

      {/* Master Audio Controls */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="audio-play-pause-btn"
            onClick={togglePlay}
            className="w-10 h-10 rounded-xl bg-sky-600 hover:bg-sky-500 text-white flex items-center justify-center shadow-sm transition-transform active:scale-95"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-white" />
            ) : (
              <Play className="w-4 h-4 fill-white ml-0.5" />
            )}
          </button>

          <button
            type="button"
            id="audio-stop-btn"
            onClick={handleStop}
            title="Stop playback"
            className="p-2 rounded-lg text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            id="audio-restart-btn"
            onClick={handleRestart}
            title="Restart from beginning"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Volume Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="audio-mute-toggle-btn"
            onClick={toggleMute}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-rose-500" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            id="audio-volume-slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-20 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-600"
          />
        </div>
      </div>
    </div>
  );
}
