import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createAudioSession,
  getAudioSessionBySessionId,
  updateAudioSession,
  getUserAudioSessions,
} from "../db";
import { invokeLLM } from "../_core/llm";
import { v4 as uuidv4 } from "uuid";

// Deepgram API configuration
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";
const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

async function transcribeWithDeepgram(audioData: Buffer): Promise<string | null> {
  try {
    if (!DEEPGRAM_API_KEY) {
      console.error("[DEEPGRAM ERROR] API key not found");
      return null;
    }

    if (audioData.length < 1000) {
      console.warn(`[DEEPGRAM WARNING] Audio data too small: ${audioData.length} bytes`);
      return null;
    }

    const headers = {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      "Content-Type": "audio/webm",
    };

    const params = new URLSearchParams({
      model: "nova-2",
      smart_format: "true",
      language: "en",
      punctuate: "true",
      diarize: "false",
    });

    const response = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
      method: "POST",
      headers,
      body: audioData as unknown as BodyInit,
    });

    if (response.status === 200) {
      const result = await response.json();
      const channels = result.results?.channels || [];
      if (channels.length > 0) {
        const alternatives = channels[0].alternatives || [];
        if (alternatives.length > 0) {
          const transcript = alternatives[0].transcript || "";
          if (transcript.trim()) {
            console.log(`[DEEPGRAM SUCCESS] Transcribed: ${transcript.substring(0, 50)}...`);
            return transcript.trim();
          }
        }
      }
      return null;
    } else {
      console.error(`[DEEPGRAM ERROR] Status: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`[DEEPGRAM ERROR] Exception: ${error}`);
    return null;
  }
}

function getSummaryPrompt(
  summaryType: string,
  transcript: string,
  summaryLanguage: string = "en"
): string {
  const languageInstructions: Record<string, string> = {
    ja: "日本語で要約してください。",
    es: "Summarize in Spanish.",
    zh: "用中文总结。",
    fr: "Résumez en français.",
    it: "Riassumi in italiano.",
    ko: "한국어로 요약해주세요。",
    ar: "لخص باللغة العربية。",
    hi: "हिंदी में संक्षेप करें।",
    ru: "Резюмируйте на русском языке。",
    id: "Ringkas dalam Bahasa Indonesia。",
  };

  const languageInstruction = languageInstructions[summaryLanguage] || "Summarize in English.";

  const prompts: Record<string, string> = {
    short: `You are a professional executive assistant specializing in creating concise presentation summaries for C-level executives.\n\nAnalyze the following transcript and provide a SHORT summary in exactly 4-5 lines. Focus on the most critical points, key decisions, and actionable outcomes. Write in a professional, executive-level tone suitable for busy decision-makers who need immediate insights. ${languageInstruction}\n\nRequirements:\n- Exactly 4-5 lines of text\n- No bullet points, lists, or markdown formatting\n- Focus on main conclusions, decisions, and next steps\n- Professional business language with executive tone\n- Capture the essence and business impact in minimal words\n- Prioritize actionable insights and strategic implications\n\nTranscript: ${transcript}`,

    medium: `You are a professional business analyst creating presentation summaries for corporate teams and stakeholders.\n\nAnalyze the following transcript and provide a MEDIUM-length summary that balances comprehensive coverage with readability. Structure your response to cover the main topics, key arguments, important decisions, and strategic implications. ${languageInstruction}\n\nRequirements:\n- 3-4 well-structured paragraphs (150-250 words total)\n- Cover main topics, key points, and strategic context\n- Include important details, decisions, and action items\n- Professional business writing style suitable for team sharing\n- Clear logical flow from overview to specifics to conclusions\n- Suitable for middle management and project teams\n\nStructure your response as:\n1. Opening paragraph: Main topic, purpose, and key participants\n2. Core content: Key points, arguments, and discussions\n3. Outcomes: Conclusions, decisions, and recommended next steps\n\nTranscript: ${transcript}`,
  };

  return prompts[summaryType] || prompts.medium;
}

async function generateSummaryWithLLM(
  transcript: string,
  summaryType: string = "medium",
  summaryLanguage: string = "en"
): Promise<string | null> {
  try {
    const prompt = getSummaryPrompt(summaryType, transcript, summaryLanguage);

    const response = await invokeLLM({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    if (response.choices && response.choices[0]?.message?.content) {
      const content = response.choices[0].message.content;
      if (typeof content === "string") {
        return content;
      }
    }

    return null;
  } catch (error) {
    console.error(`[LLM ERROR] Failed to generate summary: ${error}`);
    return null;
  }
}

async function translateWithLLM(
  text: string,
  targetLanguage: string,
  previousTranslation?: string
): Promise<string | null> {
  try {
    const languageNames: Record<string, string> = {
      ja: "Japanese",
      es: "Spanish",
      zh: "Chinese",
      fr: "French",
      it: "Italian",
      ko: "Korean",
      ar: "Arabic",
      hi: "Hindi",
      ru: "Russian",
      id: "Indonesian",
    };

    const targetLanguageName = languageNames[targetLanguage] || "Japanese";

    let prompt: string;
    if (previousTranslation) {
      prompt = `You are translating a live speech transcription to ${targetLanguageName}. Translate the following new text segment to continue smoothly from the previous translation. Provide only the translation.\n\nNew text to translate: ${text}\n\nPrevious translation context: ${previousTranslation}`;
    } else {
      prompt = `Translate the following English text to ${targetLanguageName}. Provide only the translation.\n\nText to translate: ${text}`;
    }

    const response = await invokeLLM({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    if (response.choices && response.choices[0]?.message?.content) {
      const content = response.choices[0].message.content;
      if (typeof content === "string") {
        return content;
      }
    }

    return null;
  } catch (error) {
    console.error(`[LLM ERROR] Failed to translate text: ${error}`);
    return null;
  }
}

export const audioRouter = router({
  startSession: protectedProcedure.mutation(async ({ ctx }) => {
    const sessionId = uuidv4();
    await createAudioSession(ctx.user.id, sessionId);
    return {
      success: true,
      sessionId,
      message: "Session started successfully",
    };
  }),

  uploadChunk: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        chunkNumber: z.string(),
        audioData: z.string(), // Base64 encoded audio data
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await getAudioSessionBySessionId(input.sessionId);
      if (!session) {
        throw new Error("Invalid session ID");
      }

      // Decode base64 audio data
      const audioBuffer = Buffer.from(input.audioData, "base64");

      // Transcribe with Deepgram
      const transcription = await transcribeWithDeepgram(audioBuffer);

      if (transcription) {
        const currentTranscript = session.transcript || "";
        const updatedTranscript = currentTranscript
          ? `${currentTranscript} ${transcription}`
          : transcription;

        await updateAudioSession(input.sessionId, {
          transcript: updatedTranscript,
          deepgramCalls: (session.deepgramCalls || 0) + 1,
          accumulatedSize: (session.accumulatedSize || 0) + audioBuffer.length,
        });

        return {
          success: true,
          chunkNumber: input.chunkNumber,
          transcription,
          completeText: updatedTranscript,
        };
      }

      return {
        success: true,
        chunkNumber: input.chunkNumber,
        transcription: "",
        completeText: session.transcript || "",
      };
    }),

  stopSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await getAudioSessionBySessionId(input.sessionId);
      if (!session) {
        throw new Error("Invalid session ID");
      }

      return {
        success: true,
        completeText: session.transcript || "",
        totalChunks: 0,
        deepgramCalls: session.deepgramCalls || 0,
        totalSize: session.accumulatedSize || 0,
      };
    }),

  generateSummary: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        summaryType: z.string().default("medium"),
        summaryLanguage: z.string().default("en"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await getAudioSessionBySessionId(input.sessionId);
      if (!session) {
        throw new Error("Invalid session ID");
      }

      const transcript = session.transcript || "";
      if (!transcript || transcript.trim().length < 50) {
        throw new Error("Transcript too short for summary generation");
      }

      const summary = await generateSummaryWithLLM(
        transcript,
        input.summaryType,
        input.summaryLanguage
      );

      if (!summary) {
        throw new Error("Failed to generate summary");
      }

      await updateAudioSession(input.sessionId, {
        summary,
        summaryType: input.summaryType,
        summaryLanguage: input.summaryLanguage,
      });

      return {
        success: true,
        summary,
        summaryType: input.summaryType,
        originalText: transcript,
      };
    }),

  translate: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        targetLanguage: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await getAudioSessionBySessionId(input.sessionId);
      if (!session) {
        throw new Error("Invalid session ID");
      }

      const transcript = session.transcript || "";
      if (!transcript || transcript.trim().length < 10) {
        throw new Error("Transcript too short for translation");
      }

      const translation = await translateWithLLM(
        transcript,
        input.targetLanguage,
        session.translation || undefined
      );

      if (!translation) {
        throw new Error("Failed to translate text");
      }

      await updateAudioSession(input.sessionId, {
        translation,
        translationLanguage: input.targetLanguage,
      });

      return {
        success: true,
        translation,
        targetLanguage: input.targetLanguage,
      };
    }),

  getSessions: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await getUserAudioSessions(ctx.user.id);
    return sessions;
  }),

  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await getAudioSessionBySessionId(input.sessionId);
      if (!session) {
        throw new Error("Session not found");
      }
      return session;
    }),
});

