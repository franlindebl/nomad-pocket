import Foundation
import PDFKit

/// Text of a PDF stored in a ZIM archive (document collections: zimgit-*, military medicine),
/// for the library's document index. PDFKit wants a file or the whole document in memory:
/// the entry is copied to a temporary file a few MB at a time and opened from there, so a
/// 60 MB scan never sits in memory twice.
enum PdfText {
  /// Low priority: indexing runs in the background while the user reads or chats.
  static let queue = DispatchQueue(label: "nomad.zim.pdf", qos: .utility)

  /// Page texts (empty strings for pages without a text layer, e.g. scans), the document's
  /// own title, and whether it was locked. Nil when the entry can't be read as a PDF.
  static func extract(archive: NZArchive, path: String, maxPages: Int) -> [String: Any?]? {
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("zim-pdf-\(UUID().uuidString).pdf")
    defer { try? FileManager.default.removeItem(at: tmp) }
    guard archive.writeEntry(atPath: path, toFile: tmp.path), let doc = PDFDocument(url: tmp) else { return nil }
    if doc.isLocked && !doc.unlock(withPassword: "") {
      return ["pages": [String](), "title": nil, "locked": true]
    }
    var pages: [String] = []
    let count = min(doc.pageCount, maxPages)
    pages.reserveCapacity(count)
    for i in 0..<count {
      autoreleasepool {
        pages.append(doc.page(at: i)?.string ?? "")
      }
    }
    let title = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return ["pages": pages, "title": title?.isEmpty == false ? title : nil, "locked": false, "pageCount": doc.pageCount]
  }
}
