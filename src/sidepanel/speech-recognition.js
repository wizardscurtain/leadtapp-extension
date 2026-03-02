/**
 * LeadTapp - Speech Recognition Module (Side Panel)
 *
 * This runs in the side panel where Web Speech API is available.
 * Captures audio, transcribes it, and sends to service worker for processing.
 *
 * Supports two backends:
 * 1. Web Speech API - Free, real-time, browser-native
 * 2. OpenAI Whisper API - Higher accuracy, supports audio recording
 */

class SpeechRecognitionManager {
    constructor() {
        this.isListening = false;
        this.recognition = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.mode = 'coaching';
        this.backend = 'webspeech'; // 'webspeech' or 'whisper'
        this.openaiApiKey = null;
        this.onTranscript = null;
        this.onError = null;
        this.onStateChange = null;

        // Silence detection
        this.silenceTimeout = null;
        this.lastSpeechTime = 0;
        this.silenceThresholdMs = 2000;

        // Check Web Speech API support
        this.webSpeechSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

        console.log('[SpeechRecognition] Initialized, Web Speech supported:', this.webSpeechSupported);
    }

    /**
     * Configure the speech recognition
     */
    configure(options = {}) {
        if (options.openaiApiKey) {
            this.openaiApiKey = options.openaiApiKey;
        }
        if (options.backend) {
            this.backend = options.backend;
        }
        if (options.mode) {
            this.mode = options.mode;
        }
        if (options.silenceThresholdMs) {
            this.silenceThresholdMs = options.silenceThresholdMs;
        }

        console.log('[SpeechRecognition] Configured:', {
            backend: this.backend,
            mode: this.mode,
            hasApiKey: !!this.openaiApiKey
        });
    }

    /**
     * Start listening
     */
    async startListening(options = {}) {
        if (this.isListening) {
            return { success: false, error: 'Already listening' };
        }

        this.mode = options.mode || this.mode;

        try {
            if (this.backend === 'whisper' && this.openaiApiKey) {
                await this.startWhisperRecording();
            } else if (this.webSpeechSupported) {
                await this.startWebSpeech();
            } else {
                return { success: false, error: 'No speech recognition available' };
            }

            this.isListening = true;
            this.notifyStateChange('listening');

            // Notify service worker
            chrome.runtime.sendMessage({
                type: 'leadtapp/speech/start',
                mode: this.mode
            }).catch(() => {});

            return { success: true, backend: this.backend, mode: this.mode };

        } catch (error) {
            console.error('[SpeechRecognition] Start failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop listening
     */
    stopListening() {
        if (!this.isListening) {
            return { success: false, error: 'Not listening' };
        }

        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
        }

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout);
            this.silenceTimeout = null;
        }

        this.isListening = false;
        this.notifyStateChange('stopped');

        // Notify service worker
        chrome.runtime.sendMessage({
            type: 'leadtapp/speech/stop'
        }).catch(() => {});

        return { success: true };
    }

    /**
     * Start Web Speech API recognition
     */
    async startWebSpeech() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            throw new Error('Web Speech API not supported');
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
            console.log('[SpeechRecognition] Web Speech started');
            this.lastSpeechTime = Date.now();
        };

        this.recognition.onresult = (event) => {
            this.lastSpeechTime = Date.now();

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript.trim();
                const confidence = result[0].confidence;
                const isFinal = result.isFinal;

                if (transcript) {
                    this.handleTranscript({
                        text: transcript,
                        confidence: confidence || 0.9,
                        isFinal: isFinal,
                        timestamp: Date.now()
                    });
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.error('[SpeechRecognition] Error:', event.error);

            // Handle recoverable errors
            if (event.error === 'no-speech') {
                // Normal - just no speech detected
                return;
            }

            if (event.error === 'aborted') {
                // User or system stopped
                return;
            }

            if (this.onError) {
                this.onError(event.error);
            }

            // Try to restart on network errors
            if (event.error === 'network' && this.isListening) {
                setTimeout(() => {
                    if (this.isListening) {
                        this.recognition.start();
                    }
                }, 1000);
            }
        };

        this.recognition.onend = () => {
            console.log('[SpeechRecognition] Web Speech ended');

            // Auto-restart if still supposed to be listening
            if (this.isListening) {
                setTimeout(() => {
                    if (this.isListening && this.recognition) {
                        try {
                            this.recognition.start();
                        } catch (e) {
                            console.log('[SpeechRecognition] Restart failed:', e);
                        }
                    }
                }, 100);
            }
        };

        this.recognition.start();
    }

    /**
     * Start Whisper API recording
     */
    async startWhisperRecording() {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 16000
            }
        });

        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus'
        });

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = async () => {
            // Transcribe accumulated audio
            if (this.audioChunks.length > 0) {
                await this.transcribeWithWhisper();
            }

            // Cleanup stream
            stream.getTracks().forEach(track => track.stop());
        };

        // Record in 5-second chunks for real-time transcription
        this.mediaRecorder.start();

        // Periodically send chunks to Whisper
        this.whisperInterval = setInterval(async () => {
            if (this.audioChunks.length > 0 && this.isListening) {
                await this.transcribeWithWhisper();
                this.audioChunks = [];
            }
        }, 5000);

        console.log('[SpeechRecognition] Whisper recording started');
    }

    /**
     * Transcribe audio with OpenAI Whisper API
     */
    async transcribeWithWhisper() {
        if (!this.openaiApiKey || this.audioChunks.length === 0) {
            return;
        }

        try {
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });

            // Skip if audio is too short (less than 0.5 seconds estimated)
            if (audioBlob.size < 5000) {
                return;
            }

            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.webm');
            formData.append('model', 'whisper-1');
            formData.append('language', 'en');
            formData.append('response_format', 'json');

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Whisper API error: ${error}`);
            }

            const result = await response.json();

            if (result.text && result.text.trim()) {
                this.handleTranscript({
                    text: result.text.trim(),
                    confidence: 0.95, // Whisper is generally high accuracy
                    isFinal: true,
                    timestamp: Date.now()
                });
            }

        } catch (error) {
            console.error('[SpeechRecognition] Whisper transcription failed:', error);
            if (this.onError) {
                this.onError(error.message);
            }
        }
    }

    /**
     * Handle transcript result
     */
    handleTranscript(entry) {
        console.log('[SpeechRecognition] Transcript:', entry.text,
            `(${entry.isFinal ? 'final' : 'interim'}, ${(entry.confidence * 100).toFixed(0)}%)`);

        // Local callback
        if (this.onTranscript) {
            this.onTranscript(entry);
        }

        // Send to service worker for processing (only final results to reduce noise)
        if (entry.isFinal) {
            chrome.runtime.sendMessage({
                type: 'leadtapp/speech/transcript',
                transcript: entry
            }).catch(() => {});
        }
    }

    /**
     * Notify state change
     */
    notifyStateChange(state) {
        if (this.onStateChange) {
            this.onStateChange(state);
        }
    }

    /**
     * Get current state
     */
    getState() {
        return {
            isListening: this.isListening,
            backend: this.backend,
            mode: this.mode,
            webSpeechSupported: this.webSpeechSupported,
            hasApiKey: !!this.openaiApiKey
        };
    }

    /**
     * Check if microphone permission is granted
     */
    async checkMicrophonePermission() {
        try {
            const result = await navigator.permissions.query({ name: 'microphone' });
            return result.state; // 'granted', 'denied', or 'prompt'
        } catch (e) {
            // Firefox doesn't support permissions.query for microphone
            return 'unknown';
        }
    }

    /**
     * Request microphone permission
     */
    async requestMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop the stream immediately, we just wanted permission
            stream.getTracks().forEach(track => track.stop());
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Create singleton instance
const speechRecognitionManager = new SpeechRecognitionManager();

// Make available globally
window.speechRecognitionManager = speechRecognitionManager;
