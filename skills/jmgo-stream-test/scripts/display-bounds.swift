import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2 else {
    fputs("usage: display-bounds.swift ID|primary\n", stderr)
    exit(2)
}

var count: UInt32 = 0
guard CGGetActiveDisplayList(0, nil, &count) == .success else {
    fputs("unable to enumerate active displays\n", stderr)
    exit(1)
}
var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
guard CGGetActiveDisplayList(count, &displays, &count) == .success else {
    fputs("unable to read active displays\n", stderr)
    exit(1)
}

let selector = CommandLine.arguments[1]
let displayID: CGDirectDisplayID
if selector == "primary" {
    displayID = CGMainDisplayID()
} else if let numericID = UInt32(selector) {
    displayID = numericID
} else {
    fputs("display ID must be numeric or primary\n", stderr)
    exit(2)
}

guard displays.contains(displayID) else {
    let available = displays.map(String.init).joined(separator: ", ")
    fputs("display \(displayID) is not active; available IDs: \(available)\n", stderr)
    exit(1)
}

let bounds = CGDisplayBounds(displayID)
let values = [
    Int(displayID),
    Int(bounds.origin.x),
    Int(bounds.origin.y),
    Int(bounds.width),
    Int(bounds.height),
]
print(values.map(String.init).joined(separator: ","))
