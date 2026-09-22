import { VoiceOption, SpeakingStyle } from '../types';

export const GEMINI_VOICES: VoiceOption[] = [
  {
    id: 'Kore',
    name: 'Kore',
    gender: 'Female',
    personality: 'Calm & Expressive',
    description: 'Crisp, articulate tone ideal for narration, explanations, and guides.',
    samplePhrase: 'Welcome to the media synthesis studio. Today we explore speech generation.',
    color: '#0284c7', // Sky blue
  },
  {
    id: 'Puck',
    name: 'Puck',
    gender: 'Male',
    personality: 'Playful & Dynamic',
    description: 'Upbeat, high energy voice perfect for character dialogues and announcements.',
    samplePhrase: 'Hey there! Ready to bring your ideas to life with high quality speech?',
    color: '#16a34a', // Emerald green
  },
  {
    id: 'Charon',
    name: 'Charon',
    gender: 'Male',
    personality: 'Deep & Authoritative',
    description: 'Commanding baritone voice suited for documentaries, trailers, and formal reads.',
    samplePhrase: 'Across uncharted territories, sound transforms thoughts into reality.',
    color: '#7c3aed', // Purple
  },
  {
    id: 'Fenrir',
    name: 'Fenrir',
    gender: 'Male',
    personality: 'Warm & Resonant',
    description: 'Rich, comforting timbre with natural depth and engaging cadence.',
    samplePhrase: 'Settle in and let the story unfold. Every voice carries its own atmosphere.',
    color: '#ea580c', // Orange
  },
  {
    id: 'Zephyr',
    name: 'Zephyr',
    gender: 'Female',
    personality: 'Bright & Natural',
    description: 'Lively, friendly voice offering effortless clarity for conversational audio.',
    samplePhrase: 'Hello! I am ready to speak whatever you need, with natural pacing and emotion.',
    color: '#db2777', // Pink
  },
];

export const SPEAKING_STYLES: { id: SpeakingStyle; label: string; promptModifier: string; icon: string }[] = [
  { id: 'natural', label: 'Natural & Balanced', promptModifier: '', icon: 'Mic' },
  { id: 'cheerfully', label: 'Cheerful & Upbeat', promptModifier: 'Say cheerfully with an optimistic, upbeat rhythm: ', icon: 'Sparkles' },
  { id: 'authoritative', label: 'Authoritative', promptModifier: 'Say with authoritative, confident, and professional composure: ', icon: 'Shield' },
  { id: 'calm', label: 'Calm & Meditative', promptModifier: 'Speak gently, calmly, and slowly with peaceful warmth: ', icon: 'Coffee' },
  { id: 'whisper', label: 'Soft & Intimate', promptModifier: 'Speak softly and intimately like a gentle whisper: ', icon: 'Wind' },
  { id: 'storyteller', label: 'Dramatic Storyteller', promptModifier: 'Narrate dramatically like a compelling audiobook storyteller: ', icon: 'BookOpen' },
  { id: 'news-anchor', label: 'Broadcast News', promptModifier: 'Deliver crisply and authoritatively like a prime-time news broadcast: ', icon: 'Radio' },
];

export const SAMPLE_TEXTS = [
  {
    title: 'Product Launch',
    category: 'Marketing',
    text: 'Introducing the next frontier in interactive voice synthesis. Crystal-clear acoustics, expressive emotional cadence, and real-time generation designed for creators.',
  },
  {
    title: 'Documentary Narration',
    category: 'Audiobook',
    text: 'Deep within the ancient cedar forests of the Pacific Northwest, sunlight pierces through mist older than the mountains themselves.',
  },
  {
    title: 'Mindfulness & Focus',
    category: 'Wellness',
    text: 'Take a slow, deep breath in through your nose. Hold for a moment, and release all tension as you exhale smoothly.',
  },
  {
    title: 'Sci-Fi Announcement',
    category: 'Creative',
    text: 'Docking protocol confirmed. Atmospheric pressure stabilized at orbital station Delta Nine. Welcome aboard, Commander.',
  },
];
