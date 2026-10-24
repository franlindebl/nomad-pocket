// Objective-C facade over libzim (C++), in the spirit of kiwix-apple's
// ZimFileService. This header must stay pure Objective-C so Swift can import it;
// all C++ lives in NZArchive.mm.
//
// Thread safety: libzim's Archive is safe for concurrent reads. Searchers are not,
// so suggestion/full-text searches are serialized per archive internally.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** A resolved entry (redirects followed). */
@interface NZEntryInfo : NSObject
/** Final path after following redirects. */
@property (nonatomic, copy, readonly) NSString *path;
@property (nonatomic, copy, readonly) NSString *title;
@property (nonatomic, copy, readonly) NSString *mimeType;
@property (nonatomic, readonly) uint64_t size;
/** True when the requested path was a redirect. */
@property (nonatomic, readonly) BOOL wasRedirect;
@end

/** A search / suggestion hit. */
@interface NZSearchHit : NSObject
@property (nonatomic, copy, readonly) NSString *path;
@property (nonatomic, copy, readonly) NSString *title;
@property (nonatomic, copy, readonly, nullable) NSString *snippet;
/** -1 when unknown. */
@property (nonatomic, readonly) NSInteger wordCount;
@end

@interface NZArchive : NSObject

/** Opens the archive. Returns nil and fills `error` when the file is missing or invalid. */
- (nullable instancetype)initWithPath:(NSString *)path error:(NSError **)error NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@property (nonatomic, copy, readonly) NSString *filePath;
/** Lower-case UUID string, e.g. "8f4c…-…". */
@property (nonatomic, copy, readonly) NSString *uuid;
@property (nonatomic, readonly) NSUInteger articleCount;
@property (nonatomic, readonly) NSUInteger mediaCount;
@property (nonatomic, readonly) BOOL hasFulltextIndex;
@property (nonatomic, readonly) BOOL hasTitleIndex;
/** Resolved path of the main page, or nil. */
@property (nonatomic, copy, readonly, nullable) NSString *mainPath;

/** M/<name> metadata as a string, or nil when absent. */
- (nullable NSString *)metadata:(NSString *)name;
/** PNG bytes of the illustration closest to `size` px (48 is the standard), or nil. */
- (nullable NSData *)illustrationPNGWithSize:(NSUInteger)size;

/** Entry info with redirects followed, or nil when the path does not exist. */
- (nullable NZEntryInfo *)entryInfoAtPath:(NSString *)path;
/** Whole content of an entry (redirects followed), or nil. */
- (nullable NSData *)dataAtPath:(NSString *)path;
/** A byte range of an entry's content (redirects followed), or nil. */
- (nullable NSData *)dataAtPath:(NSString *)path offset:(uint64_t)offset length:(uint64_t)length;

/** Path of a random article, or nil. */
- (nullable NSString *)randomPath;

/** HTML articles in title order (redirects skipped), at most `limit`. `snippet` is unused. */
- (NSArray<NZSearchHit *> *)listArticles:(NSInteger)limit;

/** Title suggestions (title index, or title-ordered fallback). */
- (NSArray<NZSearchHit *> *)suggest:(NSString *)query limit:(NSInteger)limit;
/** Full-text search with snippets. Empty when the archive has no full-text index. */
- (NSArray<NZSearchHit *> *)search:(NSString *)query limit:(NSInteger)limit;

@end

NS_ASSUME_NONNULL_END
