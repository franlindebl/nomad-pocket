// Valhalla (prebuilt by Rallista valhalla-mobile) through the wrapper's plain functions.
//
// No Valhalla header is included here on purpose: inline templates instantiated in this
// file (unordered_map<GraphId, …>, ptree, …) are weak symbols the linker may pick over
// the library's own copies, and with them the tile extract loaded but every search came
// back empty ("No suitable edges", 171) while loose tiles worked. Declaring the few
// functions we call keeps this file free of Valhalla code.
#import "NRRouter.h"

#include <string>

class ValhallaMobileHttpClient;
// From valhalla-mobile src/wrapper/main.cpp (include/main.h). They never throw: failures
// come back as {"code": <int>, "message": "<text>"}. Each action runs on its own thread
// with a 16 MB stack (Valhalla's searches recurse).
void *create_valhalla_actor(const char *config_path, ValhallaMobileHttpClient *http_client);
void delete_valhalla_actor(void *actor);
std::string route(const char *request, void *actor);
std::string matrix(const char *request, void *actor);
std::string trace_attributes(const char *request, void *actor);

namespace {

NSError *MakeError(NSInteger code, NSString *message) {
  return [NSError errorWithDomain:@"valhalla" code:code userInfo:@{NSLocalizedDescriptionKey : message ?: @"routing failed"}];
}

/// The wrapper's error envelope is exactly {"code", "message"}; a successful answer has
/// other keys (an OSRM answer also has "code", but a string one).
NSError *EnvelopeError(NSString *json) {
  if (![json hasPrefix:@"{\"code\""]) return nil;
  id obj = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![obj isKindOfClass:[NSDictionary class]]) return nil;
  NSDictionary *d = obj;
  if (d.count != 2 || ![d[@"code"] isKindOfClass:[NSNumber class]] || ![d[@"message"] isKindOfClass:[NSString class]]) return nil;
  return MakeError([d[@"code"] integerValue], d[@"message"]);
}

} // namespace

@implementation NRRouter {
  void *_actor;
}

- (nullable instancetype)initWithConfigPath:(NSString *)path error:(NSError **)error {
  self = [super init];
  if (!self) return nil;
  // Building the actor reads the config and opens the tile extract; a config that cannot
  // be read is reported by the first action instead.
  _actor = create_valhalla_actor([path fileSystemRepresentation], nullptr);
  if (!_actor) {
    if (error) *error = MakeError(-1, @"cannot create the routing engine");
    return nil;
  }
  return self;
}

- (void)dealloc {
  if (_actor) delete_valhalla_actor(_actor);
}

- (nullable NSString *)perform:(std::string (*)(const char *, void *))action request:(NSString *)request error:(NSError **)error {
  @synchronized(self) {
    std::string out = action([request UTF8String], _actor);
    NSString *json = [[NSString alloc] initWithBytes:out.data() length:out.size() encoding:NSUTF8StringEncoding];
    if (!json) {
      if (error) *error = MakeError(-1, @"response was not valid UTF-8");
      return nil;
    }
    NSError *failure = EnvelopeError(json);
    if (failure) {
      if (error) *error = failure;
      return nil;
    }
    return json;
  }
}

- (nullable NSString *)route:(NSString *)request error:(NSError **)error {
  return [self perform:&route request:request error:error];
}

- (nullable NSString *)matrix:(NSString *)request error:(NSError **)error {
  return [self perform:&matrix request:request error:error];
}

- (nullable NSString *)traceAttributes:(NSString *)request error:(NSError **)error {
  return [self perform:&trace_attributes request:request error:error];
}

@end
