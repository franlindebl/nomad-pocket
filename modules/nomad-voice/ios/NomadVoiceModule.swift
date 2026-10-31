// Spoken navigation prompts with the system's offline voices. Why not expo-speech: it leaves the
// audio session alone, so a prompt neither ducks the music nor plays with the screen locked, and
// CarPlay expects a navigation app's prompts in the voice-prompt mode (the car lowers its audio and
// routes ours to the speakers). Here the session is set for each prompt and released after it,
// telling the other app to come back (`.notifyOthersOnDeactivation`).
import AVFoundation
import ExpoModulesCore

public final class NomadVoiceModule: Module {
  /// Everything here runs on it: activating an audio session can block for a while (iOS warns
  /// about hangs when it's done on the main thread).
  private let queue = DispatchQueue(label: "nomad.voice")
  private lazy var synth: AVSpeechSynthesizer = {
    let s = AVSpeechSynthesizer()
    s.delegate = listener
    return s
  }()
  private lazy var listener = Listener { [weak self] in
    self?.queue.async { self?.release() }
  }
  /// Voices per language, best quality first (the lookup reads every installed voice).
  private var voices: [String: AVSpeechSynthesisVoice?] = [:]

  public func definition() -> ModuleDefinition {
    Name("NomadVoice")

    AsyncFunction("speak") { (text: String, language: String) in
      guard let voice = self.voice(for: language) else { return }
      let session = AVAudioSession.sharedInstance()
      do {
        try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try session.setActive(true)
      } catch {
        // Another app holds the session (a call): the prompt is skipped, guidance goes on.
        return
      }
      let utterance = AVSpeechUtterance(string: text)
      utterance.voice = voice
      self.synth.speak(utterance)
    }.runOnQueue(queue)

    AsyncFunction("stop") {
      if self.synth.isSpeaking { self.synth.stopSpeaking(at: .immediate) }
    }.runOnQueue(queue)

    OnDestroy {
      self.queue.async {
        if self.synth.isSpeaking { self.synth.stopSpeaking(at: .immediate) }
      }
    }
  }

  /// 'es-ES' → that voice, else any voice of the language ('es-MX'), else nil.
  private func voice(for language: String) -> AVSpeechSynthesisVoice? {
    if let known = voices[language] { return known }
    let base = language.split(separator: "-").first.map(String.init) ?? language
    let all = AVSpeechSynthesisVoice.speechVoices()
    func rank(_ v: AVSpeechSynthesisVoice) -> Int {
      (v.language == language ? 10 : 0) + v.quality.rawValue
    }
    // Novelty voices (Bells, Bubbles…) share the language code; the default voice is never one.
    func novelty(_ v: AVSpeechSynthesisVoice) -> Bool {
      if #available(iOS 17.0, *) { return v.voiceTraits.contains(.isNoveltyVoice) }
      return v.identifier.hasPrefix("com.apple.speech.synthesis.voice.")
    }
    let picked = all
      .filter { ($0.language == language || $0.language.hasPrefix(base + "-")) && !novelty($0) }
      .max { rank($0) < rank($1) }
      ?? AVSpeechSynthesisVoice(language: language)
    voices[language] = picked
    return picked
  }

  private func release() {
    // Between two queued prompts the session stays.
    guard !synth.isSpeaking else { return }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

private final class Listener: NSObject, AVSpeechSynthesizerDelegate {
  let done: () -> Void
  init(done: @escaping () -> Void) { self.done = done }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    done()
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    done()
  }
}
