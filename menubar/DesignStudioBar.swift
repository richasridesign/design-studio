import AppKit
import IOKit.pwr_mgt
import ServiceManagement

let repo = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().path
let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".designstudio/logs")
let token = UUID().uuidString

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

final class Bar: NSObject, NSApplicationDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  let awakeItem = NSMenuItem(title: "Keep Mac awake", action: #selector(toggleAwake), keyEquivalent: "")
  let loginItem = NSMenuItem(title: "Open at login", action: #selector(toggleLogin), keyEquivalent: "")
  var assertion: IOPMAssertionID = 0
  let relay = Child("relay", "node_modules/.bin/tsx server/src/relay.ts", env: ["DESIGN_STUDIO_RELAY_TOKEN": token])
  let server = Child("server", "npm run serve -w server", env: ["CHROME_CDP": "ws://127.0.0.1:7780/\(token)"])
  let web = Child("web", "npm run dev -w web")

  func applicationDidFinishLaunching(_ n: Notification) {
    try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    let menu = NSMenu()
    menu.addItem(withTitle: "Open Design Studio", action: #selector(openApp), keyEquivalent: "o").target = self
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
  @objc func openApp() { NSWorkspace.shared.open(URL(string: "http://localhost:5174")!) }
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

let app = NSApplication.shared
let bar = Bar()
app.delegate = bar
app.setActivationPolicy(.accessory)
app.run()
