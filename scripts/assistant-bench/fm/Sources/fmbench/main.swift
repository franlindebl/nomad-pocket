// Apple Foundation Models bench, mirroring modules/nomad-llm (router + generate).
//   fmbench route <in.jsonl {id, instructions, prompt}> <out.jsonl>
//   fmbench generate <in.jsonl {id, system, prompt}> <out.jsonl> [default|permissive]
import Foundation
import FoundationModels

@Generable
struct SearchDecision {
  @Guide(description: "true if answering needs facts or information (people, places, history, science, health, techniques, how to do something), including follow-up questions; false for greetings, thanks, jokes, small talk, questions about the assistant, or requests to rephrase, simplify, summarize or translate the previous answer")
  var search: Bool
  @Guide(description: "If search is true: self-contained search keywords in the user's language, including the conversation topic when the message omits it (e.g. \"tratamiento hipotermia\"). Otherwise empty.")
  var query: String
  // Same as the app's (modules/nomad-llm SearchDecision): the map fields of phase 1b.
  @Guide(description: "true only if the message asks to find a kind of place near somewhere, directions or travel time to a place, or where the user is; otherwise false")
  var map: Bool
  @Guide(description: "If map is true: nearby, go_nearest, route or where_am_i. Otherwise empty.")
  var mapAction: String
  @Guide(description: "If map is true and a kind of place is asked: that kind in the user's words (e.g. \"farmacia\"). Otherwise empty.")
  var mapCategory: String
  @Guide(description: "If map is true: the town, address or landmark named as the place or the origin of a route; empty for the user's own position.")
  var mapPlace: String
  @Guide(description: "If map is true and mapAction is route: the destination. Otherwise empty.")
  var mapDestination: String
}

let args = CommandLine.arguments
let lines = try String(contentsOfFile: args[2], encoding: .utf8).split(separator: "\n")
let out = FileHandle(forWritingAtPath: args[3]) ?? {
  FileManager.default.createFile(atPath: args[3], contents: nil)
  return FileHandle(forWritingAtPath: args[3])!
}()
out.seekToEndOfFile()

func write(_ obj: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: obj)
  out.write(data)
  out.write("\n".data(using: .utf8)!)
}

func describe(_ error: Error) -> String {
  if let e = error as? LanguageModelSession.GenerationError {
    switch e {
    case .guardrailViolation: return "GUARDRAIL"
    case .exceededContextWindowSize: return "CONTEXT"
    case .unsupportedLanguageOrLocale: return "LANGUAGE"
    default: return "OTHER: \(e)"
    }
  }
  return "ERR: \(error)"
}

let mode = args.count > 4 ? args[4] : "default"
let model = mode == "permissive" ? SystemLanguageModel(guardrails: .permissiveContentTransformations) : SystemLanguageModel.default

for line in lines {
  let item = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
  let id = item["id"]!
  let started = Date()
  if args[1] == "route" {
    do {
      let session = LanguageModelSession(model: SystemLanguageModel.default, instructions: item["instructions"] as! String)
      let r = try await session.respond(to: item["prompt"] as! String, generating: SearchDecision.self, options: GenerationOptions(samplingMode: .greedy))
      let d = r.content
      write([
        "id": id, "search": d.search, "query": d.query, "map": d.map, "mapAction": d.mapAction, "mapCategory": d.mapCategory,
        "mapPlace": d.mapPlace, "mapDestination": d.mapDestination, "ms": Int(Date().timeIntervalSince(started) * 1000),
      ])
    } catch {
      write(["id": id, "error": describe(error)])
    }
  } else {
    do {
      let session = LanguageModelSession(model: model, tools: [], instructions: item["system"] as! String)
      var text = ""
      do {
        // Streamed, as the app does (modules/nomad-llm): guardrails also judge the partial output.
        for try await snapshot in session.streamResponse(to: item["prompt"] as! String, options: GenerationOptions(temperature: 0.5, maximumResponseTokens: 600)) {
          text = snapshot.content
        }
      } catch {
        write(["id": id, "error": describe(error), "partial": text, "ms": Int(Date().timeIntervalSince(started) * 1000)])
        print("#\(id) \(describe(error))")
        continue
      }
      write(["id": id, "answer": text, "ms": Int(Date().timeIntervalSince(started) * 1000)])
      print("#\(id) ok")
    } catch {
      write(["id": id, "error": describe(error), "ms": Int(Date().timeIntervalSince(started) * 1000)])
      print("#\(id) \(describe(error))")
    }
  }
}
