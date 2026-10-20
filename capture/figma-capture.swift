// Captures one app window for Design Studio's Figma tab: by default the frontmost window of the Figma desktop app
// (com.figma.Desktop). It never captures another app, the desktop or the whole screen.
//
// Build: npm run capture (swiftc into capture/build, which git ignores). Not part of DesignStudio.app.
//
// Output on stdout, records of: 1 type byte, a 4-byte big-endian length, the payload.
//   type 1: state JSON {"state": "on" | "noperm" | "nofigma" | "nowindow" | "error", "detail"?: string}
//   type 2: frame: window width and height in points (4 bytes each, big-endian), then a JPEG
// Input on stdin, one command per line: "size W H" (the largest picture wanted, in pixels). Stdin closing ends it.
//
// Options: --width W --height H (start size), --fps N (default 12), --quality Q (0.1 to 1, default 0.7),
//   --bundle ID (app to capture), --pid N (tests only: a window of this process instead of an app by bundle id).
// It only checks Screen Recording permission (CGPreflightScreenCaptureAccess) and never asks for it.

import AppKit
import CoreGraphics
import CoreImage
import CoreMedia
import Foundation
import ImageIO
@preconcurrency import ScreenCaptureKit
import UniformTypeIdentifiers

setvbuf(stdout, nil, _IONBF, 0)
signal(SIGPIPE, SIG_DFL)

var bundleId = "com.figma.Desktop"
var pidArg: pid_t? = nil
var maxW = 1600
var maxH = 1200
var fps: Int32 = 12
var quality = 0.7

do {
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let a = args.next() {
    let v = args.next() ?? ""
    switch a {
    case "--bundle": bundleId = v
    case "--pid": pidArg = pid_t(v)
    case "--width": maxW = max(200, Int(v) ?? maxW)
    case "--height": maxH = max(200, Int(v) ?? maxH)
    case "--fps": fps = max(1, min(30, Int32(v) ?? fps))
    case "--quality": quality = max(0.1, min(1, Double(v) ?? quality))
    default:
      FileHandle.standardError.write("unknown option \(a)\n".data(using: .utf8)!)
      exit(2)
    }
  }
}

let outLock = NSLock()
func emit(_ type: UInt8, _ payload: Data) {
  var head = Data([type])
  var len = UInt32(payload.count).bigEndian
  head.append(Data(bytes: &len, count: 4))
  outLock.lock()
  defer { outLock.unlock() }
  for part in [head, payload] {
    part.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      var off = 0
      while off < raw.count {
        let n = write(1, raw.baseAddress! + off, raw.count - off)
        if n <= 0 { exit(0) }
        off += n
      }
    }
  }
}

var lastState = ""
func state(_ s: String, _ detail: String? = nil) {
  let key = s + (detail ?? "")
  if key == lastState { return }
  lastState = key
  var obj: [String: String] = ["state": s]
  if let d = detail { obj["detail"] = d }
  emit(1, try! JSONSerialization.data(withJSONObject: obj))
}

/// The Figma window to show: the front-most normal window on this screen, else the largest one in another space or full
/// screen (Figma in its own space is the usual setup beside Design Studio). Needs no permission.
func frontWindow(of pid: pid_t) -> (id: CGWindowID, size: CGSize)? {
  guard let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
  var best: (id: CGWindowID, size: CGSize)?
  for w in list {
    guard (w[kCGWindowOwnerPID as String] as? Int).map({ pid_t($0) }) == pid,
          (w[kCGWindowLayer as String] as? Int) == 0,
          let b = w[kCGWindowBounds as String] as? [String: Any],
          let rect = CGRect(dictionaryRepresentation: b as CFDictionary),
          rect.width >= 200, rect.height >= 150,
          (w[kCGWindowAlpha as String] as? Double ?? 1) > 0,
          let id = w[kCGWindowNumber as String] as? Int else { continue }
    if (w[kCGWindowIsOnscreen as String] as? Bool) == true { return (CGWindowID(id), rect.size) }
    if best == nil || rect.width * rect.height > best!.size.width * best!.size.height { best = (CGWindowID(id), rect.size) }
  }
  return best
}

func targetPid() -> pid_t? {
  if let p = pidArg { return kill(p, 0) == 0 ? p : nil }
  return NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first(where: { !$0.isTerminated })?.processIdentifier
}

/// The picture size: the window's own pixels, scaled down to fit the size Design Studio asked for, never up.
func pictureSize(_ window: CGSize) -> (Int, Int) {
  let scale = NSScreen.main?.backingScaleFactor ?? 2
  let px = CGSize(width: window.width * scale, height: window.height * scale)
  let k = min(1, min(CGFloat(maxW) / px.width, CGFloat(maxH) / px.height))
  return (max(2, Int(px.width * k) & ~1), max(2, Int(px.height * k) & ~1))
}

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
  let queue = DispatchQueue(label: "figma-capture.frames")
  let ci = CIContext(options: [.useSoftwareRenderer: false])
  var stream: SCStream?
  var windowId: CGWindowID = 0
  var windowSize = CGSize.zero
  var picture = (0, 0)
  var starting = false

  func config() -> SCStreamConfiguration {
    let c = SCStreamConfiguration()
    picture = pictureSize(windowSize)
    c.width = picture.0
    c.height = picture.1
    c.minimumFrameInterval = CMTime(value: 1, timescale: fps)
    c.pixelFormat = kCVPixelFormatType_32BGRA
    c.showsCursor = false
    c.queueDepth = 3
    if #available(macOS 14.0, *) { c.ignoreShadowsSingleWindow = true }
    return c
  }

  func stop() {
    if let s = stream { s.stopCapture { _ in } }
    stream = nil
    windowId = 0
  }

  /// Runs every 1.5 s: follows the frontmost Figma window, and says plainly why nothing is captured.
  func tick() async {
    guard let pid = targetPid() else { stop(); return state("nofigma") }
    guard let front = frontWindow(of: pid) else { stop(); return state("nowindow") }
    // Checked only, never asked for: macOS shows its own prompt only when she turns it on in System Settings.
    guard CGPreflightScreenCaptureAccess() else { stop(); return state("noperm") }
    if front.id == windowId, stream != nil {
      if front.size != windowSize || pictureSize(front.size) != picture {
        windowSize = front.size
        try? await stream?.updateConfiguration(config())
      }
      return
    }
    if starting { return }
    starting = true
    defer { starting = false }
    stop()
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
      guard let win = content.windows.first(where: { $0.windowID == front.id && $0.owningApplication?.processID == pid }) else {
        return state("nowindow")
      }
      windowSize = front.size
      let s = SCStream(filter: SCContentFilter(desktopIndependentWindow: win), configuration: config(), delegate: self)
      try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
      try await s.startCapture()
      stream = s
      windowId = front.id
      state("on")
    } catch {
      stop()
      state("error", error.localizedDescription)
    }
  }

  func resize() {
    guard let s = stream else { return }
    let c = config()
    s.updateConfiguration(c) { _ in }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    DispatchQueue.main.async {
      if self.stream === stream { self.stream = nil; self.windowId = 0 }
    }
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, sb.isValid,
          let infos = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
          let raw = infos.first?[.status] as? Int, raw == SCFrameStatus.complete.rawValue,
          let pixels = sb.imageBuffer else { return }
    let image = CIImage(cvPixelBuffer: pixels)
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let jpeg = ci.jpegRepresentation(of: image, colorSpace: space, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality]) else { return }
    var head = Data()
    var w = UInt32(max(0, windowSize.width)).bigEndian
    var h = UInt32(max(0, windowSize.height)).bigEndian
    head.append(Data(bytes: &w, count: 4))
    head.append(Data(bytes: &h, count: 4))
    emit(2, head + jpeg)
  }
}

let capture = Capture()

// Stdin: size commands, and the end of Design Studio's server ends the helper.
Thread.detachNewThread {
  while let line = readLine() {
    let parts = line.split(separator: " ")
    if parts.count == 3, parts[0] == "size", let w = Int(parts[1]), let h = Int(parts[2]) {
      DispatchQueue.main.async {
        maxW = max(200, min(3840, w))
        maxH = max(200, min(3840, h))
        capture.resize()
      }
    }
  }
  exit(0)
}

Task { @MainActor in
  while true {
    await capture.tick()
    try? await Task.sleep(nanoseconds: 1_500_000_000)
  }
}

dispatchMain()
