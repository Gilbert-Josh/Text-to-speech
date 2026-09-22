export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Female' | 'Male' | 'Neutral';
  description: string;
  samplePhrase: string;
  personality: string;
  color: string;
}

export type SpeakingStyle = 
  | 'natural'
  | 'cheerfully'
  | 'authoritative'
  | 'calm'
  | 'whisper'
  | 'storyteller'
  | 'energetic'
  | 'news-anchor';

export interface TTSRequest {
  text: string;
  voice: string;
  speakingStyle?: SpeakingStyle;
  engine?: 'gemini' | 'browser';
}

export interface TTSResponse {
  audioBase64?: string;
  mimeType?: string;
  error?: string;
  durationEstimate?: number;
  engine: 'gemini' | 'browser';
}

export interface GeneratedClip {
  id: string;
  text: string;
  voice: string;
  style: SpeakingStyle;
  engine: 'gemini' | 'browser';
  audioUrl: string;
  createdAt: number;
  duration?: number;
  sourceDoc?: string;
  pageNumber?: number;
}

export interface PdfPageItem {
  pageNumber: number;
  text: string;
  wordCount: number;
}

export interface PdfDocumentData {
  filename: string;
  sizeBytes: number;
  numPages: number;
  fullText: string;
  pages: PdfPageItem[];
  info?: {
    Title?: string;
    Author?: string;
  };
}
