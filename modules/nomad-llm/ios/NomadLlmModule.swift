// System language model bridge for iOS: Apple Foundation Models (iOS 26+,
// Apple Intelligence). The app deploys to iOS 16.4, so the framework is
// weak-linked (see NomadLlm.podspec) and every use is gated with #available.
import ExpoModulesCore
import Speech
#if canImport(FoundationModels)
import FoundationModels
#endif

struct GenerateOptions: Record {
  @Field var prompt: String = ""
  @Field var system: String?
  @Field var temperature: Double?
  @Field var maxTokens: Int?
}

#if canImport(FoundationModels)
/// Whether a chat message needs a library search, decided by the model with guided
/// generation (the instructions and few-shot examples come from JS, rag-core.ts).
@available(iOS 26.0, *)
@Generable
struct SearchDecision {
  @Guide(description: "true if answering needs facts or information (people, places, history, science, health, techniques, how to do something), including follow-up questions; false for greetings, thanks, jokes, small talk, questions about the assistant, or requests to rephrase, simplify, summarize or translate the previous answer")
  var search: Bool
  @Guide(description: "If search is true: self-contained search keywords in the user's language, including the conversation topic when the message omits it (e.g. \"tratamiento hipotermia\"). Otherwise empty.")
  var query: String
}
#endif

public final class NomadLlmModule: Module {
  private let lock = NSLock()
  private var tasks: [String: Task<Void, Never>] = [:]

  public func definition() -> ModuleDefinition {
    Name("NomadLlm")

    Events("onDelta", "onDone", "onError")

    AsyncFunction("getSystemModelStatus") { () -> [String: Any] in
      return Self.systemStatus()
    }

    AsyncFunction("generate") { (requestId: String, options: GenerateOptions, promise: Promise) in
      self.startGeneration(requestId: requestId, options: options, promise: promise)
    }

    Function("cancel") { (requestId: String) in
      self.takeTask(requestId)?.cancel()
    }

    AsyncFunction("route") { (prompt: String, instructions: String, promise: Promise) in
      self.route(prompt: prompt, instructions: instructions, promise: promise)
    }

    // Dictation (expo-speech-recognition) asks for on-device recognition, but on a locale
    // without it iOS silently sends the audio to Apple's servers, and the library only checks
    // the phone's own locale. The composer shows the microphone only where this is true.
    Function("supportsOnDeviceDictation") { (locale: String) -> Bool in
      SFSpeechRecognizer(locale: Locale(identifier: locale))?.supportsOnDeviceRecognition ?? false
    }

    OnDestroy {
      self.lock.lock()
      let all = self.tasks.values
      self.tasks.removeAll()
      self.lock.unlock()
      all.forEach { $0.cancel() }
    }
  }

  // MARK: - Status

  static func systemStatus() -> [String: Any] {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
      case .available:
        return ["status": "available", "provider": "apple"]
      case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible:
          return ["status": "deviceNotEligible", "provider": "apple"]
        case .appleIntelligenceNotEnabled:
          return ["status": "notEnabled", "provider": "apple"]
        case .modelNotReady:
          return ["status": "modelNotReady", "provider": "apple"]
        @unknown default:
          return ["status": "unsupported", "provider": "apple", "detail": String(describing: reason)]
        }
      }
    }
    return ["status": "unsupportedOS", "provider": "apple"]
    #else
    return ["status": "unsupported", "provider": NSNull(), "detail": "built without FoundationModels"]
    #endif
  }

  // MARK: - Generation

  private func store(_ id: String, _ task: Task<Void, Never>) {
    lock.lock()
    tasks[id] = task
    lock.unlock()
  }

  @discardableResult
  private func takeTask(_ id: String) -> Task<Void, Never>? {
    lock.lock()
    defer { lock.unlock() }
    return tasks.removeValue(forKey: id)
  }

  private func startGeneration(requestId: String, options: GenerateOptions, promise: Promise) {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      guard case .available = SystemLanguageModel.default.availability else {
        promise.reject("ERR_UNAVAILABLE", "The system language model is not available on this device")
        return
      }
      let task = Task { [weak self] in
        var text = ""
        do {
          let session = LanguageModelSession(model: SystemLanguageModel.default, tools: [], instructions: options.system)
          let generation = GenerationOptions(temperature: options.temperature, maximumResponseTokens: options.maxTokens)
          // Snapshots carry the cumulative text; forward only what's new.
          for try await snapshot in session.streamResponse(to: options.prompt, options: generation) {
            if Task.isCancelled { break }
            let content: String = snapshot.content
            if content.hasPrefix(text) {
              let delta = String(content.dropFirst(text.count))
              if !delta.isEmpty {
                self?.sendEvent("onDelta", ["requestId": requestId, "delta": delta])
              }
            } else {
              self?.sendEvent("onDelta", ["requestId": requestId, "delta": content, "reset": true])
            }
            text = content
          }
          self?.takeTask(requestId)
          self?.sendEvent("onDone", ["requestId": requestId, "text": text, "cancelled": Task.isCancelled])
          promise.resolve(text)
        } catch is CancellationError {
          self?.takeTask(requestId)
          self?.sendEvent("onDone", ["requestId": requestId, "text": text, "cancelled": true])
          promise.resolve(text)
        } catch {
          self?.takeTask(requestId)
          let (code, message) = Self.describe(error)
          self?.sendEvent("onError", ["requestId": requestId, "message": message, "code": code])
          promise.reject(code, message)
        }
      }
      store(requestId, task)
      return
    }
    #endif
    promise.reject("ERR_UNSUPPORTED", "The system language model requires iOS 26 or later")
  }

  private func route(prompt: String, instructions: String, promise: Promise) {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      Task {
        do {
          let session = LanguageModelSession(model: SystemLanguageModel.default, instructions: instructions)
          let response = try await session.respond(to: prompt, generating: SearchDecision.self, options: GenerationOptions(samplingMode: .greedy))
          promise.resolve(["search": response.content.search, "query": response.content.query])
        } catch {
          let (code, message) = Self.describe(error)
          promise.reject(code, message)
        }
      }
      return
    }
    #endif
    promise.reject("ERR_UNSUPPORTED", "The system language model requires iOS 26 or later")
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  static func describe(_ error: Error) -> (String, String) {
    if let e = error as? LanguageModelSession.GenerationError {
      switch e {
      case .exceededContextWindowSize:
        return ("ERR_CONTEXT", "The conversation is too long for the system model")
      case .guardrailViolation:
        return ("ERR_GUARDRAIL", "The system model declined to answer this request")
      case .unsupportedLanguageOrLocale:
        return ("ERR_LANGUAGE", "The system model does not support this language")
      case .assetsUnavailable:
        return ("ERR_ASSETS", "The system model is not ready yet")
      case .rateLimited:
        return ("ERR_RATE_LIMITED", "The system model is busy, try again in a moment")
      case .concurrentRequests:
        return ("ERR_BUSY", "The system model is busy with another request")
      default:
        // Newer cases (refusal, decodingFailure…): keep the case name for diagnosis.
        let name = "\(e)".lowercased()
        if name.contains("guardrail") || name.hasPrefix("refusal") {
          return ("ERR_GUARDRAIL", "The system model declined to answer this request")
        }
        return ("ERR_GENERATE", "\(e)")
      }
    }
    // Not a GenerationError (iOS 27 streams other types): guardrail errors still say so in their text.
    let text = "\(error.localizedDescription) \(String(describing: error))".lowercased()
    if text.contains("guardrail") {
      return ("ERR_GUARDRAIL", "The system model declined to answer this request")
    }
    return ("ERR_GENERATE", error.localizedDescription)
  }
  #else
  static func describe(_ error: Error) -> (String, String) {
    return ("ERR_GENERATE", error.localizedDescription)
  }
  #endif
}
