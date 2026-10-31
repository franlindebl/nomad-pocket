// JS API of the spoken navigation prompts. Only src/features/maps/voice.ts imports it; the native
// sides say why it isn't expo-speech.
import { NativeModule, requireNativeModule } from 'expo-modules-core';

declare class NomadVoiceNative extends NativeModule {
  /**
   * Speaks `text` in `language` (BCP 47, 'es-ES') after any prompt still playing. Resolves at once.
   * Without a voice for the language (or any speech engine on Android): silent, no error.
   */
  speak(text: string, language: string): Promise<void>;
  /** Silences the prompt playing and drops the queued ones. */
  stop(): Promise<void>;
}

export default requireNativeModule<NomadVoiceNative>('NomadVoice');
