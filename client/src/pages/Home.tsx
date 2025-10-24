import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useState, useRef, useEffect } from "react";

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [translation, setTranslation] = useState("");
  const [summaryType, setSummaryType] = useState("medium");
  const [summaryLanguage, setSummaryLanguage] = useState("en");
  const [translationLanguage, setTranslationLanguage] = useState("ja");
  const [isLoading, setIsLoading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startSessionMutation = trpc.audio.startSession.useMutation();
  const uploadChunkMutation = trpc.audio.uploadChunk.useMutation();
  const stopSessionMutation = trpc.audio.stopSession.useMutation();
  const generateSummaryMutation = trpc.audio.generateSummary.useMutation();
  const translateMutation = trpc.audio.translate.useMutation();

  const startRecording = async () => {
    try {
      // Start a new session
      const session = await startSessionMutation.mutateAsync();
      setSessionId(session.sessionId);
      setTranscript("");
      setSummary("");
      setTranslation("");

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);

          // Upload chunk
          const blob = event.data;
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");

          if (session.sessionId) {
            const result = await uploadChunkMutation.mutateAsync({
              sessionId: session.sessionId,
              chunkNumber: audioChunksRef.current.length.toString(),
              audioData: base64,
            });

            if (result.completeText) {
              setTranscript(result.completeText);
            }
          }
        }
      };

      mediaRecorder.start(1000); // Record in 1-second chunks
      setIsRecording(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      alert("Failed to start recording. Please check microphone permissions.");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);

      if (sessionId) {
        await stopSessionMutation.mutateAsync({ sessionId });
      }
    }
  };

  const handleGenerateSummary = async () => {
    if (!sessionId) return;

    setIsLoading(true);
    try {
      const result = await generateSummaryMutation.mutateAsync({
        sessionId,
        summaryType,
        summaryLanguage,
      });
      setSummary(result.summary);
    } catch (error) {
      console.error("Failed to generate summary:", error);
      alert("Failed to generate summary");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTranslate = async () => {
    if (!sessionId) return;

    setIsLoading(true);
    try {
      const result = await translateMutation.mutateAsync({
        sessionId,
        targetLanguage: translationLanguage,
      });
      setTranslation(result.translation);
    } catch (error) {
      console.error("Failed to translate:", error);
      alert("Failed to translate");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">{APP_TITLE}</CardTitle>
            <CardDescription>
              Transcribe, translate, and summarize your speech with AI
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => (window.location.href = getLoginUrl())}
              className="w-full"
              size="lg"
            >
              Sign in to get started
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">{APP_TITLE}</h1>
          <p className="text-gray-600">
            Welcome, {user?.name}! Record your speech and get instant transcription, translation,
            and summaries.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recording Section */}
          <Card>
            <CardHeader>
              <CardTitle>Record Audio</CardTitle>
              <CardDescription>Click to start/stop recording</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={isRecording ? stopRecording : startRecording}
                size="lg"
                className="w-full"
                variant={isRecording ? "destructive" : "default"}
              >
                {isRecording ? "Stop Recording" : "Start Recording"}
              </Button>

              {isRecording && (
                <div className="flex items-center gap-2 text-red-600">
                  <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></div>
                  <span>Recording in progress...</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Transcript Section */}
          <Card>
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
              <CardDescription>Your speech converted to text</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={transcript}
                readOnly
                placeholder="Your transcript will appear here..."
                className="min-h-[200px]"
              />
            </CardContent>
          </Card>

          {/* Summary Section */}
          <Card>
            <CardHeader>
              <CardTitle>Generate Summary</CardTitle>
              <CardDescription>Create a concise summary of your recording</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Summary Type</label>
                <Select value={summaryType} onValueChange={setSummaryType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short (4-5 lines)</SelectItem>
                    <SelectItem value="medium">Medium (3-4 paragraphs)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Summary Language</label>
                <Select value={summaryLanguage} onValueChange={setSummaryLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ja">Japanese</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                    <SelectItem value="zh">Chinese</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleGenerateSummary}
                disabled={!transcript || isLoading}
                className="w-full"
              >
                {isLoading ? "Generating..." : "Generate Summary"}
              </Button>

              {summary && (
                <Textarea
                  value={summary}
                  readOnly
                  placeholder="Summary will appear here..."
                  className="min-h-[150px]"
                />
              )}
            </CardContent>
          </Card>

          {/* Translation Section */}
          <Card>
            <CardHeader>
              <CardTitle>Translate</CardTitle>
              <CardDescription>Translate your transcript to another language</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Target Language</label>
                <Select value={translationLanguage} onValueChange={setTranslationLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">Japanese</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                    <SelectItem value="zh">Chinese</SelectItem>
                    <SelectItem value="ko">Korean</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleTranslate}
                disabled={!transcript || isLoading}
                className="w-full"
              >
                {isLoading ? "Translating..." : "Translate"}
              </Button>

              {translation && (
                <Textarea
                  value={translation}
                  readOnly
                  placeholder="Translation will appear here..."
                  className="min-h-[150px]"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

