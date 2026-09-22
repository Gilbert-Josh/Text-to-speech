import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  audioElement: HTMLAudioElement | null;
  isPlaying: boolean;
  accentColor?: string;
}

export function AudioVisualizer({
  audioElement,
  isPlaying,
  accentColor = '#0284c7',
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioElement) return;

    try {
      if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioContextClass();
      }

      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended' && isPlaying) {
        ctx.resume();
      }

      if (!sourceRef.current) {
        try {
          sourceRef.current = ctx.createMediaElementSource(audioElement);
          analyserRef.current = ctx.createAnalyser();
          analyserRef.current.fftSize = 128;
          sourceRef.current.connect(analyserRef.current);
          analyserRef.current.connect(ctx.destination);
        } catch {
          // MediaElementSource might already be attached or restricted
        }
      }
    } catch {
      // AudioContext fallback
    }
  }, [audioElement, isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      let dataArray: Uint8Array | null = null;
      if (analyserRef.current && isPlaying) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        dataArray = new Uint8Array(new ArrayBuffer(bufferLength));
        analyserRef.current.getByteFrequencyData(dataArray as any);
      }

      const barCount = 48;
      const barWidth = (width / barCount) * 0.7;
      const barGap = (width / barCount) * 0.3;

      for (let i = 0; i < barCount; i++) {
        let value = 0;
        if (dataArray && isPlaying) {
          const sampleIndex = Math.floor((i / barCount) * dataArray.length);
          value = dataArray[sampleIndex] / 255;
        } else if (isPlaying) {
          // Simulated waveform if Web Audio graph isn't tapped yet
          value = (Math.sin(phase + i * 0.25) * 0.5 + 0.5) * 0.6 + 0.2;
        } else {
          // Idle resting bars
          value = 0.08 + Math.sin(i * 0.2) * 0.04;
        }

        const barHeight = Math.max(4, value * (height - 8));
        const x = i * (barWidth + barGap) + barGap / 2;
        const y = (height - barHeight) / 2;

        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, accentColor);
        gradient.addColorStop(1, accentColor + '66');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 3);
        ctx.fill();
      }

      phase += 0.08;
      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, accentColor]);

  return (
    <div id="audio-visualizer-container" className="w-full h-20 bg-slate-900 rounded-xl px-4 py-2 flex items-center justify-center border border-slate-800 shadow-inner overflow-hidden">
      <canvas
        ref={canvasRef}
        width={600}
        height={70}
        className="w-full h-full block"
      />
    </div>
  );
}
