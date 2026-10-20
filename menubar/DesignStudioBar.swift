import AppKit
import IOKit.pwr_mgt
import ServiceManagement
import WebKit

let repo = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().path
let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".designstudio/logs")
let token = UUID().uuidString
let home = URL(string: "http://localhost:5174")!

func log(_ line: String) {
  let path = logs.appendingPathComponent("app.log").path
  let text = "\(ISO8601DateFormatter().string(from: Date())) \(line)\n"
  if let h = FileHandle(forWritingAtPath: path) {
    h.seekToEndOfFile()
    h.write(text.data(using: .utf8)!)
    h.closeFile()
  } else {
    try? text.write(toFile: path, atomically: true, encoding: .utf8)
  }
}

func isHome(_ url: URL?) -> Bool {
  guard let url, let host = url.host else { return false }
  return ["localhost", "127.0.0.1"].contains(host) && (url.port ?? 80) == 5174
}

func openInBrowser(_ url: URL?) {
  guard let url, !["blob", "data", "about"].contains(url.scheme ?? "") else { return }
  NSWorkspace.shared.open(url)
}

final class Child {
  let name: String
  let command: String
  let env: [String: String]
  var pid: pid_t = 0
  var started = Date()
  var delay = 1.0
  var stopping = false
  var source: DispatchSourceProcess?

  init(_ name: String, _ command: String, env: [String: String] = [:]) {
    self.name = name
    self.command = command
    self.env = env
  }

  func start() {
    stopping = false
    let path = logs.appendingPathComponent("\(name).log").path
    let fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))
    posix_spawnattr_setpgroup(&attr, 0)
    var files: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&files)
    posix_spawn_file_actions_addopen(&files, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_adddup2(&files, fd, 1)
    posix_spawn_file_actions_adddup2(&files, fd, 2)
    posix_spawn_file_actions_addchdir_np(&files, repo)
    let merged = ProcessInfo.processInfo.environment.merging(env) { $1 }
    let cstr = { (s: String) -> UnsafeMutablePointer<CChar>? in s.withCString { strdup($0) } }
    let argv = ["/bin/zsh", "-ilc", "exec \(command)"].map(cstr) + [nil]
    let envp = merged.map { cstr("\($0)=\($1)") } + [nil]
    started = Date()
    let rc = posix_spawn(&pid, "/bin/zsh", &files, &attr, argv, envp)
    argv.forEach { free($0) }
    envp.forEach { free($0) }
    posix_spawn_file_actions_destroy(&files)
    posix_spawnattr_destroy(&attr)
    close(fd)
    if rc != 0 { pid = 0; return again() }
    let s = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
    s.setEventHandler { [weak self] in self?.exited() }
    s.resume()
    source = s
  }

  func exited() {
    var status: Int32 = 0
    waitpid(pid, &status, 0)
    source?.cancel()
    source = nil
    pid = 0
    if !stopping { again() }
  }

  func again() {
    delay = Date().timeIntervalSince(started) > 30 ? 1 : min(delay * 2, 30)
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
      guard let self, !self.stopping, self.pid == 0 else { return }
      self.start()
    }
  }

  func stop() {
    stopping = true
    guard pid > 0 else { return }
    kill(-pid, SIGTERM)
    let p = pid
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { if p > 0 { kill(-p, SIGKILL) } }
  }

  func restart() {
    guard pid > 0 else { return start() }
    stopping = false
    kill(-pid, SIGTERM)
  }
}

func freePorts(_ ports: [Int]) {
  for port in ports {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    p.arguments = ["-ti", "tcp:\(port)", "-sTCP:LISTEN"]
    let out = Pipe()
    p.standardOutput = out
    try? p.run()
    p.waitUntilExit()
    let pids = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    pids.split(separator: "\n").compactMap { pid_t($0) }.forEach { kill($0, SIGTERM) }
  }
}

// figma.com inside the Design Studio window, laid over the web app's Figma stage, so she can zoom, pan, click and edit
// without the Figma app. It has its own website data, kept across launches and apart from Safari and Chrome, so her
// Figma sign-in stays. The web app says where the stage is, when it shows and which file (dsFigmaStage). The page runs
// figma-plugin/embed.js, which acts as the Design Studio plugin; this class holds its socket to the server, so Follow
// Claude moves this view the way it moves the Figma app.
final class FigmaEmbed: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  static let storeId = UUID(uuidString: "6F1C9A4E-2B7D-4E0A-9C3F-D5E8A1B2C3D4")!
  let view: WKWebView
  var fileKey: String?
  var loaded = false
  var shown = false
  var socket: URLSessionWebSocketTask?
  /** The page's agent said hello, so the socket is wanted (opened again after a drop). */
  var wanted = false
  var popups: [NSWindow] = []

  override init() {
    let config = WKWebViewConfiguration()
    if #available(macOS 14.0, *) { config.websiteDataStore = WKWebsiteDataStore(forIdentifier: FigmaEmbed.storeId) } else { config.websiteDataStore = .default() }
    // Figma checks for a browser it supports: this view says it is Safari.
    config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15"
    let agentPath = "\(repo)/figma-plugin/embed.js"
    if let js = try? String(contentsOfFile: agentPath, encoding: .utf8) {
      config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    } else {
      log("figma view: no \(agentPath), Follow Claude will not reach it")
    }
    view = WKWebView(frame: .zero, configuration: config)
    super.init()
    config.userContentController.add(self, name: "dsFigma")
    view.navigationDelegate = self
    view.uiDelegate = self
    view.allowsBackForwardNavigationGestures = false
    view.allowsMagnification = false
    view.isHidden = true
    if #available(macOS 13.3, *) { view.isInspectable = true }
    watchShots()
  }

  var focused: Bool { (view.window?.firstResponder as? NSView)?.isDescendant(of: view) ?? false }

  /** The web app's stage: CSS pixels in the app view, shown or not, and the chat's file. */
  var lastStage = ""
  var filesLater: DispatchWorkItem?
  func stage(_ m: [String: Any], in web: WKWebView) {
    let show = m["show"] as? Bool ?? false
    let note = "\(show ? "show" : "hide") \(m["key"] as? String ?? "no file") \(m["why"] as? String ?? "")"
    if note != lastStage { lastStage = note; log("figma stage: \(note)") }
    if show {
      let z = web.pageZoom
      let num = { (k: String) in CGFloat((m[k] as? NSNumber)?.doubleValue ?? 0) * z }
      let x = num("x"), y = num("y"), w = num("w"), h = num("h")
      let r = NSRect(x: x, y: web.isFlipped ? y : web.bounds.height - y - h, width: w, height: h)
      if let parent = view.superview { view.frame = web.convert(r, to: parent) }
      let key = (m["key"] as? String).flatMap { $0.range(of: "^[A-Za-z0-9]{10,64}$", options: .regularExpression) != nil ? $0 : nil }
      filesLater?.cancel()
      filesLater = nil
      if let key, key != fileKey || !loaded {
        open(URL(string: "https://www.figma.com/design/\(key)")!, key)
      } else if key == nil && (fileKey != nil || !loaded) {
        // A chat without a file shows her Figma files, never the file of the chat before. The app says "no file"
        // for a moment while a chat loads, so this waits before leaving the file.
        let later = DispatchWorkItem { [weak self] in self?.open(URL(string: "https://www.figma.com/files")!, nil) }
        filesLater = later
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: later)
      }
    }
    setShown(show)
  }

  func open(_ url: URL, _ key: String?) {
    fileKey = key
    loaded = true
    log("figma view: opening \(key ?? "files")")
    view.load(URLRequest(url: url))
  }

  func setShown(_ on: Bool) {
    if view.isHidden == !on { return }
    view.isHidden = !on
    if !on && focused { view.window?.makeFirstResponder(nil) }
    shown = on
    send(["t": "shown", "on": on])
  }

  // The page's agent: its messages go to the server as they are; a hello opens the socket.
  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "www.figma.com", let text = message.body as? String else { return }
    if text.contains("\"t\":\"hello\"") {
      wanted = true
      if socket == nil { connect() }
      sendText(text)
      send(["t": "shown", "on": shown])
      return
    }
    sendText(text)
  }

  func connect() {
    var req = URLRequest(url: URL(string: "ws://localhost:7778/ws?figma-plugin")!)
    req.setValue("https://www.figma.com", forHTTPHeaderField: "Origin")
    let task = URLSession.shared.webSocketTask(with: req)
    socket = task
    task.resume()
    receive(task)
  }

  func receive(_ task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      DispatchQueue.main.async {
        guard let self, self.socket === task else { return }
        switch result {
        case .success(let msg):
          if case .string(let text) = msg {
            self.view.evaluateJavaScript("window.__dsEmbed && window.__dsEmbed.recv(\(text))", completionHandler: nil)
          }
          self.receive(task)
        case .failure:
          self.socket = nil
          guard self.wanted else { return }
          // The server restarted or went away: again in 2 s, and the agent says hello again once it is back.
          DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            guard self.wanted, self.socket == nil else { return }
            self.connect()
            self.view.evaluateJavaScript("window.__dsEmbed && window.__dsEmbed.ready()", completionHandler: nil)
          }
        }
      }
    }
  }

  func send(_ m: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: m), let text = String(data: data, encoding: .utf8) else { return }
    sendText(text)
  }

  func sendText(_ text: String) {
    socket?.send(.string(text)) { _ in }
  }

  func closeSocket() {
    wanted = false
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
  }

  // A new page in the view (another file, a reload) starts a new agent, which says hello again.
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if webView === view { closeSocket() }
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let scheme = action.request.url?.scheme ?? ""
    if scheme == "figma" {
      // "Open in the desktop app" links go to the Figma app, never to a browser.
      log("figma view: to the Figma app")
      if let url = action.request.url { NSWorkspace.shared.open(url) }
      return decisionHandler(.cancel)
    }
    if action.shouldPerformDownload || !["https", "http", "about", "blob", "data"].contains(scheme) { return decisionHandler(.cancel) }
    decisionHandler(.allow)
  }

  // Sign-in and other windows Figma opens stay in this app, in a small window that shares this view's data, so the
  // sign-in lands here. Nothing goes to her browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    let child = WKWebView(frame: NSRect(x: 0, y: 0, width: 520, height: 680), configuration: configuration)
    child.navigationDelegate = self
    child.uiDelegate = self
    let w = NSWindow(contentRect: child.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    w.isReleasedWhenClosed = false
    w.title = "Figma"
    w.contentView = child
    w.center()
    w.makeKeyAndOrderFront(nil)
    popups.append(w)
    log("figma view: window \(action.request.url?.host ?? "")")
    return child
  }

  func webViewDidClose(_ webView: WKWebView) {
    popups.removeAll { w in
      guard w.contentView === webView else { return false }
      w.close()
      return true
    }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard webView === view else { return }
    log("figma view: page ended, loading again")
    closeSocket()
    webView.reload()
  }

  @available(macOS 12.0, *)
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(.deny)
  }

  /**
   * Test aid, only with defaults DSFigmaShots set: while the view shows the scratch test file, a file named
   * figma-shot-now in the logs folder asks for a picture of this view alone, written next to it.
   */
  func watchShots() {
    guard UserDefaults.standard.bool(forKey: "DSFigmaShots") else { return }
    Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      let ask = logs.appendingPathComponent("figma-shot-now")
      guard let self, FileManager.default.fileExists(atPath: ask.path) else { return }
      try? FileManager.default.removeItem(at: ask)
      guard self.fileKey == "TvLPhIfNRDowLKbeL4R7EM", !self.view.isHidden else { return }
      let n = Int(Date().timeIntervalSince1970 * 10) % 100000
      self.view.takeSnapshot(with: nil) { image, _ in
        guard let tiff = image?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: logs.appendingPathComponent("figma-shot-\(n).png"))
      }
    }
  }

  /** Test aid (defaults DSFigmaProbe): what the page offers Follow Claude, written to the logs folder. */
  func probe() {
    let js = "return JSON.stringify({path: location.pathname.slice(0, 40), figma: typeof figma, api: typeof figma !== 'undefined' && !!figma.getNodeByIdAsync, agent: !!window.__dsEmbed, page: (typeof figma !== 'undefined' && figma.currentPage) ? figma.currentPage.name : null, zoom: (typeof figma !== 'undefined' && figma.viewport) ? figma.viewport.zoom : null})"
    view.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
      var s = ""
      switch r { case .success(let v): s = "\(v)"; case .failure(let e): s = "error \(e.localizedDescription)" }
      try? s.write(to: logs.appendingPathComponent("figma-probe.json"), atomically: true, encoding: .utf8)
      log("figma view probe: \(s)")
    }
  }
}

final class Studio: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
  let window: NSWindow
  let web: WKWebView
  /** figma.com over the Figma tab's stage, made the first time the tab shows. */
  var figma: FigmaEmbed?
  let cover = NSView()
  let label = NSTextField(labelWithString: "Starting Design Studio\u{2026}")
  let spinner = NSProgressIndicator()
  let reload = NSButton(title: "Reload", target: nil, action: nil)
  var loaded = false
  var polling = false
  var onClose: (() -> Void)?

  override init() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    web = WKWebView(frame: .zero, configuration: config)
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    super.init()
    config.userContentController.add(self, name: "dsFigmaStage")
    window.title = "Design Studio"
    window.appearance = NSAppearance(named: .aqua)
    window.isReleasedWhenClosed = false
    window.contentMinSize = NSSize(width: 960, height: 640)
    window.center()
    window.setFrameAutosaveName("DesignStudioWindow")
    window.delegate = self
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = false
    if #available(macOS 13.3, *) { web.isInspectable = true }
    let root = NSView()
    root.wantsLayer = true
    root.layer?.backgroundColor = NSColor(red: 249 / 255, green: 248 / 255, blue: 245 / 255, alpha: 1).cgColor
    window.contentView = root
    for v in [web, cover] {
      v.translatesAutoresizingMaskIntoConstraints = false
      root.addSubview(v)
      NSLayoutConstraint.activate([
        v.leadingAnchor.constraint(equalTo: root.leadingAnchor), v.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        v.topAnchor.constraint(equalTo: root.topAnchor), v.bottomAnchor.constraint(equalTo: root.bottomAnchor),
      ])
    }
    cover.wantsLayer = true
    cover.layer?.backgroundColor = root.layer?.backgroundColor
    label.font = .systemFont(ofSize: 14)
    label.textColor = .secondaryLabelColor
    label.alignment = .center
    spinner.style = .spinning
    spinner.controlSize = .small
    reload.target = self
    reload.action = #selector(reloadPage)
    reload.bezelStyle = .rounded
    let stack = NSStackView(views: [spinner, label, reload])
    stack.orientation = .vertical
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    cover.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: cover.centerXAnchor), stack.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
      label.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
    ])
    showWaiting("Starting Design Studio\u{2026}")
    if UserDefaults.standard.bool(forKey: "DSFigmaProbe") {
      let f = makeFigma()
      f.open(URL(string: "https://www.figma.com/design/TvLPhIfNRDowLKbeL4R7EM")!, "TvLPhIfNRDowLKbeL4R7EM")
      DispatchQueue.main.asyncAfter(deadline: .now() + 30) { f.probe() }
    }
  }

  func makeFigma() -> FigmaEmbed {
    if let figma { return figma }
    let f = FigmaEmbed()
    window.contentView?.addSubview(f.view, positioned: .below, relativeTo: cover)
    figma = f
    return f
  }

  // The web app's Figma stage: where it is, whether figma.com shows there, and which file. Only from the app itself.
  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "dsFigmaStage", isHome(message.frameInfo.request.url) || ["localhost", "127.0.0.1"].contains(message.frameInfo.securityOrigin.host),
      let m = message.body as? [String: Any] else { return }
    if (m["show"] as? Bool ?? false) == false && figma == nil { return }
    makeFigma().stage(m, in: web)
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    // The app reloads: its stage is gone until it says where it is again.
    figma?.setShown(false)
  }

  func show() {
    NSApp.setActivationPolicy(.regular)
    if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    window.makeKeyAndOrderFront(nil)
    log("window shown id=\(window.windowNumber)")
    if !loaded && !polling { poll() }
  }

  func windowWillClose(_ n: Notification) {
    log("window closed")
    onClose?()
  }

  func showWaiting(_ text: String) {
    label.stringValue = text
    spinner.isHidden = false
    spinner.startAnimation(nil)
    reload.isHidden = true
    cover.isHidden = false
  }

  func showError(_ text: String) {
    label.stringValue = text
    spinner.stopAnimation(nil)
    spinner.isHidden = true
    reload.isHidden = false
    cover.isHidden = false
  }

  func poll() {
    polling = true
    var req = URLRequest(url: home, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
    req.httpMethod = "HEAD"
    URLSession.shared.dataTask(with: req) { _, res, _ in
      DispatchQueue.main.async {
        if res is HTTPURLResponse {
          self.polling = false
          log("web app is up, loading")
          self.web.load(URLRequest(url: home))
        } else {
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.poll() }
        }
      }
    }.resume()
  }

  @objc func reloadPage() {
    showWaiting("Starting Design Studio\u{2026}")
    loaded = false
    if !polling { poll() }
  }

  // While she works in the Figma view, these keys belong to Figma (its own zoom, no reload of Design Studio).
  @objc func reloadOrStart() {
    if figma?.focused == true { return }
    if loaded && cover.isHidden { web.reload() } else { reloadPage() }
  }
  @objc func zoomIn() { if figma?.focused != true { web.pageZoom = min(web.pageZoom + 0.1, 3) } }
  @objc func zoomOut() { if figma?.focused != true { web.pageZoom = max(web.pageZoom - 0.1, 0.5) } }
  @objc func actualSize() { if figma?.focused != true { web.pageZoom = 1 } }

  // Navigation: the app stays in the window, everything else goes to the browser.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let url = action.request.url
    let scheme = url?.scheme ?? ""
    if action.shouldPerformDownload {
      if scheme == "blob" || scheme == "data" {
        log("download \(scheme)")
        return decisionHandler(.download)
      }
      log("browser (download) \(url?.absoluteString ?? "")")
      openInBrowser(url)
      return decisionHandler(.cancel)
    }
    if action.targetFrame == nil {
      log("browser (new window) \(url?.absoluteString ?? "")")
      openInBrowser(url)
      return decisionHandler(.cancel)
    }
    if action.targetFrame?.isMainFrame == true && !isHome(url) && !["about", "blob", "data"].contains(scheme) {
      log("browser \(url?.absoluteString ?? "")")
      openInBrowser(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let url = response.response.url
    let scheme = url?.scheme ?? ""
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    if response.isForMainFrame && (!response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment")) {
      if scheme == "blob" || scheme == "data" { return decisionHandler(.download) }
      log("browser (file) \(url?.absoluteString ?? "")")
      openInBrowser(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    log("browser (window.open) \(action.request.url?.absoluteString ?? "")")
    openInBrowser(action.request.url)
    return nil
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded = true
    cover.isHidden = true
    log("page loaded \(webView.url?.absoluteString ?? "")")
    webView.evaluateJavaScript("typeof (window.SpeechRecognition || window.webkitSpeechRecognition)") { r, _ in log("speech recognition: \(r ?? "?")") }
    if UserDefaults.standard.bool(forKey: "DSSnapshot") {
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        webView.takeSnapshot(with: nil) { image, _ in
          guard let tiff = image?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
          try? png.write(to: logs.appendingPathComponent("window.png"))
          log("snapshot written")
        }
      }
    }
    if UserDefaults.standard.bool(forKey: "DSTestLink") {
      webView.evaluateJavaScript("window.open('https://www.figma.com/', '_blank'); 1", completionHandler: nil)
    }
  }

  func failed(_ error: Error) {
    let e = error as NSError
    if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
    log("load failed: \(e.localizedDescription)")
    loaded = false
    showError("Design Studio is not answering. The server may be restarting.")
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    figma?.setShown(false)
    log("web content process ended, reloading")
    reloadPage()
  }

  // Microphone for the voice button, localhost only.
  @available(macOS 12.0, *)
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    let ok = ["localhost", "127.0.0.1"].contains(origin.host)
    log("media capture \(origin.host): \(ok ? "grant" : "deny")")
    decisionHandler(ok ? .grant : .deny)
  }

  // Blob downloads (token export) are saved to Downloads.
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension
    var url = dir.appendingPathComponent(name)
    var n = 2
    while FileManager.default.fileExists(atPath: url.path) {
      url = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
      n += 1
    }
    log("saving download to \(url.path)")
    completionHandler(url)
  }

  func downloadDidFinish(_ download: WKDownload) {
    log("download finished")
    if let url = download.progress.fileURL { NSWorkspace.shared.activateFileViewerSelecting([url]) }
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    log("download failed: \(error.localizedDescription)")
  }
}

func mainMenu(_ studio: Studio) -> NSMenu {
  let main = NSMenu()
  func sub(_ title: String, _ items: [(String, Selector, String, AnyObject?)]) -> NSMenu {
    let top = NSMenuItem()
    main.addItem(top)
    let m = NSMenu(title: title)
    top.submenu = m
    for (t, sel, key, target) in items {
      if t == "-" { m.addItem(.separator()); continue }
      let i = m.addItem(withTitle: t, action: sel, keyEquivalent: key)
      i.target = target
      if t == "Redo" { i.keyEquivalentModifierMask = [.command, .shift] }
    }
    return m
  }
  let none = Selector(("noop:"))
  _ = sub("Design Studio", [
    ("About Design Studio", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), "", NSApp),
    ("-", none, "", nil),
    ("Hide Design Studio", #selector(NSApplication.hide(_:)), "h", NSApp),
    ("-", none, "", nil),
    ("Quit Design Studio", #selector(NSApplication.terminate(_:)), "q", NSApp),
  ])
  _ = sub("Edit", [
    ("Undo", Selector(("undo:")), "z", nil),
    ("Redo", Selector(("redo:")), "z", nil),
    ("-", none, "", nil),
    ("Cut", #selector(NSText.cut(_:)), "x", nil),
    ("Copy", #selector(NSText.copy(_:)), "c", nil),
    ("Paste", #selector(NSText.paste(_:)), "v", nil),
    ("Select All", #selector(NSText.selectAll(_:)), "a", nil),
  ])
  _ = sub("View", [
    ("Reload", #selector(Studio.reloadOrStart), "r", studio),
    ("-", none, "", nil),
    ("Zoom In", #selector(Studio.zoomIn), "=", studio),
    ("Zoom Out", #selector(Studio.zoomOut), "-", studio),
    ("Actual Size", #selector(Studio.actualSize), "0", studio),
  ])
  let win = sub("Window", [
    ("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m", nil),
    ("Close", #selector(NSWindow.performClose(_:)), "w", nil),
  ])
  NSApp.windowsMenu = win
  return main
}

final class Bar: NSObject, NSApplicationDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  let awakeItem = NSMenuItem(title: "Keep Mac awake", action: #selector(toggleAwake), keyEquivalent: "")
  let loginItem = NSMenuItem(title: "Open at login", action: #selector(toggleLogin), keyEquivalent: "")
  var assertion: IOPMAssertionID = 0
  let relay = Child("relay", "node_modules/.bin/tsx server/src/relay.ts", env: ["DESIGN_STUDIO_RELAY_TOKEN": token])
  let server = Child("server", "npm run serve -w server", env: ["CHROME_CDP": "ws://127.0.0.1:7780/\(token)"])
  let web = Child("web", "npm run dev -w web")
  var studio: Studio?

  func applicationDidFinishLaunching(_ n: Notification) {
    try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    let menu = NSMenu()
    menu.addItem(withTitle: "Open Design Studio", action: #selector(openApp), keyEquivalent: "o").target = self
    menu.addItem(withTitle: "Open in browser", action: #selector(openBrowser), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Restart server", action: #selector(restartServer), keyEquivalent: "r").target = self
    menu.addItem(withTitle: "Open Chrome remote debugging", action: #selector(openChrome), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Show logs", action: #selector(showLogs), keyEquivalent: "").target = self
    menu.addItem(.separator())
    awakeItem.target = self
    menu.addItem(awakeItem)
    loginItem.target = self
    loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
    menu.addItem(loginItem)
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit Design Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    item.menu = menu
    setAwake(true)
    freePorts([7780, 7778, 5174])
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      self.relay.start()
      self.server.start()
      self.web.start()
    }
    let s = Studio()
    s.onClose = { NSApp.setActivationPolicy(.accessory) }
    studio = s
    NSApp.mainMenu = mainMenu(s)
    s.show()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    studio?.show()
    return true
  }

  func applicationWillTerminate(_ n: Notification) {
    [web, server, relay].forEach { $0.stop() }
  }

  func setAwake(_ on: Bool) {
    if on {
      IOPMAssertionCreateWithName(kIOPMAssertPreventUserIdleSystemSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn), "Design Studio" as CFString, &assertion)
    } else if assertion != 0 {
      IOPMAssertionRelease(assertion)
      assertion = 0
    }
    awakeItem.state = on ? .on : .off
    item.button?.image = NSImage(systemSymbolName: on ? "cup.and.saucer.fill" : "cup.and.saucer", accessibilityDescription: "Design Studio")
    item.button?.toolTip = on ? "Design Studio: keeping Mac awake" : "Design Studio"
  }

  @objc func toggleAwake() { setAwake(assertion == 0) }
  @objc func openApp() { studio?.show() }
  @objc func openBrowser() { NSWorkspace.shared.open(home) }
  @objc func restartServer() { server.restart() }
  @objc func showLogs() { NSWorkspace.shared.open(logs) }

  @objc func openChrome() {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    p.arguments = ["-a", "Google Chrome", "chrome://inspect/#remote-debugging"]
    try? p.run()
  }

  @objc func toggleLogin() {
    let s = SMAppService.mainApp
    do {
      if s.status == .enabled { try s.unregister() } else { try s.register() }
    } catch {
      NSAlert(error: error).runModal()
    }
    loginItem.state = s.status == .enabled ? .on : .off
  }
}

// Draws the app icon: start.sh runs the binary with --write-icon <png> while building.
func writeIcon(_ path: String) {
  let size = 1024
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let rgb = { (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) in NSColor(deviceRed: r / 255, green: g / 255, blue: b / 255, alpha: a) }
  let tile = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 184, yRadius: 184)
  NSGradient(starting: rgb(209, 234, 250, 1), ending: rgb(231, 224, 235, 1))?.draw(in: tile, angle: -45)
  rgb(0, 0, 0, 0.08).setStroke()
  tile.lineWidth = 4
  tile.stroke()
  // Teammate cursor, laid out on a 512 grid like web/public/icon.svg and scaled onto the 824 tile.
  let s: CGFloat = 824 / 512
  let p = { (x: CGFloat, y: CGFloat) in NSPoint(x: 100 + x * s, y: 924 - y * s) }
  let pointer = NSBezierPath()
  pointer.move(to: p(119, 112))
  pointer.line(to: p(119, 384))
  pointer.line(to: p(197, 308))
  pointer.line(to: p(307, 300))
  pointer.close()
  pointer.lineJoinStyle = .round
  pointer.lineWidth = 24 * s
  rgb(20, 20, 20, 1).setFill()
  rgb(20, 20, 20, 1).setStroke()
  pointer.fill()
  pointer.stroke()
  rgb(214, 92, 137, 1).setFill()
  NSBezierPath(roundedRect: NSRect(x: 100 + 259 * s, y: 924 - 420 * s, width: 150 * s, height: 76 * s), xRadius: 38 * s, yRadius: 38 * s).fill()
  NSGraphicsContext.restoreGraphicsState()
  try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
}

if CommandLine.arguments.count > 2 && CommandLine.arguments[1] == "--write-icon" {
  writeIcon(CommandLine.arguments[2])
  exit(0)
}

let app = NSApplication.shared
let bar = Bar()
app.delegate = bar
app.setActivationPolicy(.accessory)
app.run()
