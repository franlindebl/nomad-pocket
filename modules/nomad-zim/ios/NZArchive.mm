// libzim bridge. See NZArchive.h.
#import "NZArchive.h"

#include <memory>
#include <mutex>
#include <string>

#include <zim/archive.h>
#include <zim/entry.h>
#include <zim/error.h>
#include <zim/item.h>
#include <zim/search.h>
#include <zim/suggestion.h>

static NSString *const NZErrorDomain = @"NomadZim";

static inline NSString *NZString(const std::string &s) {
  NSString *str = [[NSString alloc] initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];
  // Invalid UTF-8 (shouldn't happen in ZIM metadata): fall back to Latin-1 so we never return nil.
  return str ?: [[NSString alloc] initWithBytes:s.data() length:s.size() encoding:NSISOLatin1StringEncoding] ?: @"";
}

static inline std::string NZStd(NSString *s) {
  const char *c = s.UTF8String;
  return c ? std::string(c) : std::string();
}

#pragma mark - Value objects

@interface NZEntryInfo ()
- (instancetype)initWithPath:(NSString *)path title:(NSString *)title mime:(NSString *)mime size:(uint64_t)size redirect:(BOOL)redirect;
@end

@implementation NZEntryInfo
- (instancetype)initWithPath:(NSString *)path title:(NSString *)title mime:(NSString *)mime size:(uint64_t)size redirect:(BOOL)redirect {
  if ((self = [super init])) {
    _path = [path copy];
    _title = [title copy];
    _mimeType = [mime copy];
    _size = size;
    _wasRedirect = redirect;
  }
  return self;
}
@end

@interface NZSearchHit ()
- (instancetype)initWithPath:(NSString *)path title:(NSString *)title snippet:(nullable NSString *)snippet wordCount:(NSInteger)wordCount;
@end

@implementation NZSearchHit
- (instancetype)initWithPath:(NSString *)path title:(NSString *)title snippet:(NSString *)snippet wordCount:(NSInteger)wordCount {
  if ((self = [super init])) {
    _path = [path copy];
    _title = [title copy];
    _snippet = [snippet copy];
    _wordCount = wordCount;
  }
  return self;
}
@end

#pragma mark - Archive

@implementation NZArchive {
  std::shared_ptr<zim::Archive> _archive;
  // Searchers are not thread safe: created lazily and used under the lock.
  std::unique_ptr<zim::SuggestionSearcher> _suggester;
  std::unique_ptr<zim::Searcher> _searcher;
  std::mutex _suggestLock;
  std::mutex _searchLock;
}

- (nullable instancetype)initWithPath:(NSString *)path error:(NSError **)error {
  if ((self = [super init])) {
    _filePath = [path copy];
    try {
      _archive = std::make_shared<zim::Archive>(NZStd(path));
    } catch (const std::exception &e) {
      if (error) {
        *error = [NSError errorWithDomain:NZErrorDomain
                                     code:1
                                 userInfo:@{NSLocalizedDescriptionKey : [NSString stringWithFormat:@"Cannot open ZIM file: %s", e.what()]}];
      }
      return nil;
    }
    try {
      _uuid = [NZString(std::string(_archive->getUuid())) lowercaseString];
    } catch (...) {
      _uuid = [[NSUUID UUID].UUIDString lowercaseString];
    }
  }
  return self;
}

- (NSUInteger)articleCount {
  try { return _archive->getArticleCount(); } catch (...) { return 0; }
}

- (NSUInteger)mediaCount {
  try { return _archive->getMediaCount(); } catch (...) { return 0; }
}

- (BOOL)hasFulltextIndex {
  try { return _archive->hasFulltextIndex(); } catch (...) { return NO; }
}

- (BOOL)hasTitleIndex {
  try { return _archive->hasTitleIndex(); } catch (...) { return NO; }
}

- (nullable NSString *)mainPath {
  try {
    if (!_archive->hasMainEntry()) return nil;
    zim::Entry entry = _archive->getMainEntry();
    zim::Item item = entry.getItem(true);
    return NZString(item.getPath());
  } catch (...) {
    return nil;
  }
}

- (nullable NSString *)metadata:(NSString *)name {
  try {
    return NZString(_archive->getMetadata(NZStd(name)));
  } catch (...) {
    return nil;
  }
}

- (nullable NSData *)illustrationPNGWithSize:(NSUInteger)size {
  try {
    zim::Item item = _archive->getIllustrationItem((unsigned int)size);
    zim::Blob blob = item.getData();
    return [NSData dataWithBytes:blob.data() length:blob.size()];
  } catch (...) {
    return nil;
  }
}

- (nullable NZEntryInfo *)entryInfoAtPath:(NSString *)path {
  try {
    zim::Entry entry = _archive->getEntryByPath(NZStd(path));
    BOOL redirect = entry.isRedirect();
    zim::Item item = entry.getItem(true);
    return [[NZEntryInfo alloc] initWithPath:NZString(item.getPath())
                                       title:NZString(item.getTitle())
                                        mime:NZString(item.getMimetype())
                                        size:item.getSize()
                                    redirect:redirect];
  } catch (...) {
    return nil;
  }
}

- (nullable NSData *)dataAtPath:(NSString *)path {
  try {
    zim::Item item = _archive->getEntryByPath(NZStd(path)).getItem(true);
    zim::Blob blob = item.getData();
    return [NSData dataWithBytes:blob.data() length:blob.size()];
  } catch (...) {
    return nil;
  }
}

- (nullable NSData *)dataAtPath:(NSString *)path offset:(uint64_t)offset length:(uint64_t)length {
  try {
    zim::Item item = _archive->getEntryByPath(NZStd(path)).getItem(true);
    uint64_t size = item.getSize();
    if (offset >= size) return [NSData data];
    uint64_t len = MIN(length, size - offset);
    zim::Blob blob = item.getData((zim::offset_type)offset, (zim::size_type)len);
    return [NSData dataWithBytes:blob.data() length:blob.size()];
  } catch (...) {
    return nil;
  }
}

- (nullable NSString *)randomPath {
  try {
    zim::Entry entry = _archive->getRandomEntry();
    return NZString(entry.getItem(true).getPath());
  } catch (...) {
    return nil;
  }
}

- (NSArray<NZSearchHit *> *)suggest:(NSString *)query limit:(NSInteger)limit {
  NSMutableArray<NZSearchHit *> *out = [NSMutableArray array];
  if (query.length == 0 || limit <= 0) return out;
  std::lock_guard<std::mutex> guard(_suggestLock);
  try {
    if (!_suggester) _suggester = std::make_unique<zim::SuggestionSearcher>(*_archive);
    zim::SuggestionSearch search = _suggester->suggest(NZStd(query));
    zim::SuggestionResultSet results = search.getResults(0, (int)limit);
    for (auto it = results.begin(); it != results.end(); ++it) {
      const zim::SuggestionItem &hit = *it;
      NSString *snippet = hit.hasSnippet() ? NZString(hit.getSnippet()) : nil;
      [out addObject:[[NZSearchHit alloc] initWithPath:NZString(hit.getPath()) title:NZString(hit.getTitle()) snippet:snippet wordCount:-1]];
    }
  } catch (...) {
    // Corrupt index or odd query: no suggestions rather than a crash.
  }
  return out;
}

- (NSArray<NZSearchHit *> *)search:(NSString *)query limit:(NSInteger)limit {
  NSMutableArray<NZSearchHit *> *out = [NSMutableArray array];
  if (query.length == 0 || limit <= 0 || !self.hasFulltextIndex) return out;
  std::lock_guard<std::mutex> guard(_searchLock);
  try {
    if (!_searcher) _searcher = std::make_unique<zim::Searcher>(*_archive);
    zim::Query q(NZStd(query));
    zim::Search search = _searcher->search(q);
    zim::SearchResultSet results = search.getResults(0, (int)limit);
    for (auto it = results.begin(); it != results.end(); ++it) {
      NSString *snippet = nil;
      try { snippet = NZString(it.getSnippet()); } catch (...) {}
      NSInteger words = -1;
      try { words = it.getWordCount(); } catch (...) {}
      [out addObject:[[NZSearchHit alloc] initWithPath:NZString(it.getPath()) title:NZString(it.getTitle()) snippet:snippet wordCount:words]];
    }
  } catch (...) {
    // Xapian query parse errors etc.
  }
  return out;
}

@end
