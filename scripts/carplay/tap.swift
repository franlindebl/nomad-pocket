// A mouse tap at a screen point (macOS points), the way the Simulator's CarPlay window takes it: it
// ignored plain down/up events, it wants a click state and a little movement while pressed (and for
// a bar button, no movement: carplay-sim.sh tap --still). Needs the Accessibility permission for the
// terminal. Usage: tap X Y [--still]
import CoreGraphics
import Foundation

let args = CommandLine.arguments
let p = CGPoint(x: Double(args[1])!, y: Double(args[2])!)
let still = args.contains("--still")
let source = CGEventSource(stateID: .combinedSessionState)

func post(_ type: CGEventType, _ at: CGPoint) {
  let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: at, mouseButton: .left)!
  e.setIntegerValueField(.mouseEventClickState, value: 1)
  e.post(tap: .cghidEventTap)
}

post(.mouseMoved, p)
usleep(150_000)
post(.leftMouseDown, p)
usleep(60_000)
if !still {
  post(.leftMouseDragged, CGPoint(x: p.x + 0.5, y: p.y))
  usleep(60_000)
  post(.leftMouseDragged, p)
  usleep(60_000)
}
post(.leftMouseUp, p)
