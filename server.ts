import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Multer memory storage for PDF processing (up to 100MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Lazy initialize Gemini client to prevent crashes if key is missing on boot
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is missing.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// Text-to-Speech API endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice = 'Kore', speakingStyle = 'natural' } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text input is required' });
    }

    const ai = getGenAI();

    // Enrich prompt with stylistic nuance if requested
    let promptWithStyle = text.trim();

    // Guardrail against excessive token payloads on free tier TTS (cap prompt at ~4000 chars)
    if (promptWithStyle.length > 4000) {
      promptWithStyle = promptWithStyle.substring(0, 4000).trim();
    }

    if (speakingStyle && speakingStyle !== 'natural') {
      const stylePrompts: Record<string, string> = {
        cheerfully: 'Say cheerfully with warm enthusiasm: ',
        authoritative: 'Deliver authoritatively with confident composure: ',
        calm: 'Speak calmly and gently: ',
        whisper: 'Speak softly like an intimate whisper: ',
        storyteller: 'Narrate dramatically like a compelling audiobook storyteller: ',
        energetic: 'Deliver with high energy and excitement: ',
        'news-anchor': 'Read with clear, authoritative broadcast news delivery: ',
      };
      const modifier = stylePrompts[speakingStyle] || '';
      promptWithStyle = `${modifier}${promptWithStyle}`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text: promptWithStyle }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const base64Audio = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType || 'audio/wav';

    if (!base64Audio) {
      return res.status(502).json({
        error: 'No audio data was returned by the speech model.',
      });
    }

    return res.json({
      audioBase64: base64Audio,
      mimeType,
      engine: 'gemini',
      voice,
      style: speakingStyle,
    });
  } catch (error: any) {
    const rawMsg = error?.message || '';
    const isQuota =
      error?.status === 429 ||
      error?.code === 429 ||
      rawMsg.includes('429') ||
      rawMsg.includes('quota') ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('Quota exceeded');

    if (isQuota) {
      // Extract retry delay if present in error message (e.g. "retry in 20.637201592s" or RetryInfo)
      let retrySeconds = 20;
      const match = rawMsg.match(/retry in\s+([0-9.]+)\s*s/i);
      if (match) {
        retrySeconds = Math.ceil(parseFloat(match[1]));
      } else if (Array.isArray(error?.details)) {
        const retryInfo = error.details.find((d: any) => d?.['@type']?.includes('RetryInfo'));
        if (retryInfo?.retryDelay) {
          const secMatch = String(retryInfo.retryDelay).match(/([0-9]+)/);
          if (secMatch) retrySeconds = parseInt(secMatch[1], 10);
        }
      }

      console.warn(`[Gemini TTS] Quota limit reached (429). Cooldown: ${retrySeconds}s.`);
      return res.status(429).json({
        error: `Gemini Voice quota limit reached (Free tier rate limit: 10,000 tokens/min). Please wait ${retrySeconds}s or use Browser Speech.`,
        isQuotaExhausted: true,
        retryDelaySeconds: retrySeconds,
        fallbackAvailable: true,
      });
    }

    console.error('Error generating speech:', error);
    const message = rawMsg || 'Failed to generate speech';
    return res.status(500).json({
      error: message,
      isApiKeyMissing: message.includes('GEMINI_API_KEY'),
    });
  }
});

// PDF Text Extraction endpoint
app.post('/api/pdf-extract', (req, res, next) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size exceeds the 100MB limit.' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file was uploaded.' });
    }

    if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Uploaded file must be a PDF document.' });
    }

    let fullText = '';
    let pages: Array<{ pageNumber: number; text: string; wordCount: number }> = [];
    let numPages = 1;

    try {
      // 1. Fast local extraction via PDFParse
      const parser = new PDFParse({ data: req.file.buffer });
      const textResult = await parser.getText();
      
      numPages = textResult.total || 1;
      if (textResult.pages && Array.isArray(textResult.pages) && textResult.pages.length > 0) {
        pages = textResult.pages.map((p: any) => {
          const cleanText = (p.text || '').replace(/\r\n/g, '\n').trim();
          const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
          return {
            pageNumber: p.num || 1,
            text: cleanText,
            wordCount,
          };
        });
        fullText = pages.map((p) => p.text).filter(Boolean).join('\n\n');
      } else if (textResult.text) {
        fullText = textResult.text.replace(/\r\n/g, '\n').trim();
        pages = [
          {
            pageNumber: 1,
            text: fullText,
            wordCount: fullText ? fullText.split(/\s+/).length : 0,
          },
        ];
      }
    } catch (parseError) {
      console.warn('PDFParse local extraction warning:', parseError);
    }

    // 2. If the PDF is scanned or extracted very little text, attempt Gemini OCR extraction
    if (fullText.trim().length < 50 && process.env.GEMINI_API_KEY) {
      try {
        const ai = getGenAI();
        const ocrResponse = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    data: req.file.buffer.toString('base64'),
                    mimeType: 'application/pdf',
                  },
                },
                {
                  text: 'Extract and transcribe all the written text in this PDF document verbatim for text-to-speech reading. Do not include commentary, just the full extracted text.',
                },
              ],
            },
          ],
        });

        const ocrText = ocrResponse.text?.trim() || '';
        if (ocrText.length > fullText.trim().length) {
          fullText = ocrText;
          pages = [
            {
              pageNumber: 1,
              text: fullText,
              wordCount: fullText ? fullText.split(/\s+/).length : 0,
            },
          ];
        }
      } catch (ocrError) {
        console.warn('Gemini PDF OCR fallback error:', ocrError);
      }
    }

    if (!fullText.trim()) {
      return res.status(422).json({
        error: 'No readable text could be extracted from this PDF document. It may be empty or password-protected.',
      });
    }

    return res.json({
      filename: req.file.originalname,
      sizeBytes: req.file.size,
      numPages,
      fullText,
      pages,
    });
  } catch (error: any) {
    console.error('PDF extraction failed:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to process PDF document.',
    });
  }
});

// Global JSON error handler for /api routes to prevent HTML error responses
app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API error middleware caught:', err);
  const status = typeof err.status === 'number' ? err.status : (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({
    error: err.message || 'Internal server error occurred',
  });
});

// Vite middleware / SPA fallback
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
