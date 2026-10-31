// Spoken navigation prompts with the system's offline voices. Why not expo-speech: it leaves the
// audio session alone, so a prompt neither ducks the music nor plays with the screen locked, and
// CarPlay expects a navigation app's prompts in the voice-prompt mode (the car lowers its audio and
// routes ours to the speakers). Here the session is set for each prompt and released after it,
// telling the other app to come back (`.notifyOthersOnDeactivation`). The chimes (a reroute, going
// over the speed limit) play in the same session: soft notes made here, no sound file.
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
  private var chimeSounds: [String: Data] = [:]
  private var player: AVAudioPlayer?
  private lazy var playerListener = PlayerListener { [weak self] in
    self?.queue.async {
      self?.player = nil
      self?.release()
    }
  }

  public func definition() -> ModuleDefinition {
    Name("NomadVoice")

    AsyncFunction("speak") { (text: String, language: String) in
      guard let voice = self.voice(for: language), self.activate() else { return }
      let utterance = AVSpeechUtterance(string: text)
      utterance.voice = voice
      self.synth.speak(utterance)
    }.runOnQueue(queue)

    AsyncFunction("chime") { (kind: String) in
      let sound = self.chimeSounds[kind] ?? Chime.wav(Chime.notes(kind))
      self.chimeSounds[kind] = sound
      guard self.player == nil, self.activate(), let player = try? AVAudioPlayer(data: sound) else { return }
      player.delegate = self.playerListener
      player.play()
      self.player = player
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

  /// The voice-prompt session, ducking other audio. False when another app holds it (a call): the
  /// sound is skipped, guidance goes on.
  private func activate() -> Bool {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
      try session.setActive(true)
      return true
    } catch {
      return false
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
    // Between two queued prompts (or a chime and a prompt) the session stays.
    guard !synth.isSpeaking, player == nil else { return }
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

private final class PlayerListener: NSObject, AVAudioPlayerDelegate {
  let done: () -> Void
  init(done: @escaping () -> Void) { self.done = done }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    done()
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    done()
  }
}

/// The chimes, WAVs made in memory. Keep in step with Android's.
enum Chime {
  static let rate = 22050

  /// "reroute": two soft rising notes (G5, C6). "speed": a short double beep (D6), a pause between.
  /// A note of 0 Hz is silence.
  static func notes(_ kind: String) -> [(hz: Double, seconds: Double)] {
    kind == "speed" ? [(1175, 0.09), (0, 0.07), (1175, 0.09)] : [(784, 0.11), (1047, 0.2)]
  }

  static func samples(_ notes: [(hz: Double, seconds: Double)]) -> [Int16] {
    var out: [Int16] = []
    for note in notes {
      let n = Int(Double(rate) * note.seconds)
      if note.hz == 0 {
        out.append(contentsOf: repeatElement(0, count: n))
        continue
      }
      for i in 0..<n {
        let t = Double(i) / Double(rate)
        // A quick attack and an exponential fade: a bell, not a beep.
        let envelope = min(1, t / 0.008) * exp(-t * 9)
        out.append(Int16(0.45 * envelope * sin(2 * .pi * note.hz * t) * Double(Int16.max)))
      }
    }
    return out
  }

  static func wav(_ notes: [(hz: Double, seconds: Double)]) -> Data {
    let pcm = samples(notes)
    var data = Data()
    func put<T>(_ value: T) { withUnsafeBytes(of: value) { data.append(contentsOf: $0) } }
    let bytes = UInt32(pcm.count * 2)
    data.append(contentsOf: Array("RIFF".utf8)); put(UInt32(36 + bytes).littleEndian)
    data.append(contentsOf: Array("WAVEfmt ".utf8)); put(UInt32(16).littleEndian)
    put(UInt16(1).littleEndian); put(UInt16(1).littleEndian) // PCM, mono
    put(UInt32(rate).littleEndian); put(UInt32(rate * 2).littleEndian)
    put(UInt16(2).littleEndian); put(UInt16(16).littleEndian)
    data.append(contentsOf: Array("data".utf8)); put(bytes.littleEndian)
    for s in pcm { put(s.littleEndian) }
    return data
  }
}
