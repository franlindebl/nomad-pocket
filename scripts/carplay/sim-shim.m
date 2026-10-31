// Simulator only, never in the app: the iOS 26.4/26.5 simulator builds of CarPlaySupport lack two
// methods CPSTemplateInstance must implement (destination sharing), so CarPlayTemplateUIHost aborts
// as soon as a CPMapTemplate loads ("-[CPSTemplateInstance vehicleSupportsDestinationSharing]:
// unrecognized selector"). This adds them, and does nothing in any other process. carplay-sim.sh
// builds it and injects it. The same fix as Organic Maps PR #13507; real cars are not affected.
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <os/log.h>

static BOOL Supports(id self, SEL cmd) { return NO; }
static void HandleShared(id self, SEL cmd, id destination, id completion) {}

__attribute__((constructor)) static void Install(void) {
  Class cls = objc_getClass("CPSTemplateInstance");
  if (cls == Nil) return;
  int added = 0;
  SEL s = sel_registerName("vehicleSupportsDestinationSharing");
  SEL h = sel_registerName("handleSharedDestination:completion:");
  if (!class_getInstanceMethod(cls, s)) added += class_addMethod(cls, s, (IMP)Supports, "B16@0:8");
  if (!class_getInstanceMethod(cls, h)) added += class_addMethod(cls, h, (IMP)HandleShared, "v32@0:8@16@?24");
  os_log(OS_LOG_DEFAULT, "carplay-sim-shim: CPSTemplateInstance patched, %d method(s) added", added);
}
