// Obj-C face of the Valhalla routing engine (C++), so Swift can call it.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface NRRouter : NSObject

/// Builds a Valhalla actor from a config file (tile extract path inside). Opening is
/// cheap: the extract is mmapped, tiles are read on demand.
- (nullable instancetype)initWithConfigPath:(NSString *)path error:(NSError **)error;

/// Valhalla actions: request JSON in, response JSON out. On failure they return nil
/// and set `error` (domain "valhalla", code = Valhalla error code, e.g. 442 no path).
- (nullable NSString *)route:(NSString *)request error:(NSError **)error;
- (nullable NSString *)matrix:(NSString *)request error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
