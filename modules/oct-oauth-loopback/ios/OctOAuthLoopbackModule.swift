import ExpoModulesCore
import Foundation
import Network

private struct LoopbackFailure: Error {
  let message: String
}

private struct CallbackResult {
  let code: String
  let state: String
  let clientId: String?
}

public final class OctOAuthLoopbackModule: Module {
  // All session state and Network callbacks run on this serial queue.
  private let queue = DispatchQueue(label: "org.opencalorietracker.oauth.loopback")
  private var sessions: [String: LoopbackSession] = [:]
  private var destroyed = false

  public func definition() -> ModuleDefinition {
    Name("OctOAuthLoopback")

    AsyncFunction("startSessionAsync") { (expectedState: String, path: String, promise: Promise) in
      guard !self.destroyed else {
        promise.reject("ERR_OAUTH_LOOPBACK", "Loopback module is closed")
        return
      }
      do {
        let id = UUID().uuidString
        let session = try LoopbackSession(expectedState: expectedState, path: path, queue: self.queue)
        self.sessions[id] = session
        session.start { [weak self] result in
          switch result {
          case .success(let port):
            promise.resolve(["sessionId": id, "port": port] as [String: Any])
          case .failure(let error):
            self?.sessions.removeValue(forKey: id)
            promise.reject("ERR_OAUTH_LOOPBACK", error.message)
          }
        }
      } catch {
        promise.reject("ERR_OAUTH_LOOPBACK", "Could not start the loopback listener")
      }
    }
    .runOnQueue(queue)

    AsyncFunction("awaitCallbackAsync") { (sessionId: String, timeoutMs: Double, promise: Promise) in
      guard let session = self.sessions[sessionId] else {
        promise.reject("ERR_OAUTH_LOOPBACK", "Unknown loopback session")
        return
      }
      guard !session.isAwaiting else {
        promise.reject("ERR_OAUTH_LOOPBACK", "Callback is already being awaited")
        return
      }
      session.awaitCallback(timeoutMs: timeoutMs) { [weak self] result in
        self?.sessions.removeValue(forKey: sessionId)
        switch result {
        case .success(let callback):
          var payload: [String: String] = ["code": callback.code, "state": callback.state]
          if let clientId = callback.clientId, !clientId.isEmpty {
            payload["clientId"] = clientId
          }
          promise.resolve(payload)
        case .failure(let error):
          promise.reject("ERR_OAUTH_LOOPBACK", error.message)
        }
      }
    }
    .runOnQueue(queue)

    AsyncFunction("closeSessionAsync") { (sessionId: String) -> Void in
      self.sessions.removeValue(forKey: sessionId)?.close()
    }
    .runOnQueue(queue)

    OnDestroy {
      self.queue.async {
        self.destroyed = true
        let active = Array(self.sessions.values)
        self.sessions.removeAll()
        active.forEach { $0.close() }
      }
    }
  }
}

private final class LoopbackSession {
  private let queue: DispatchQueue
  private let listener: NWListener
  private let expectedState: String
  private let path: String
  private var connections: [UUID: NWConnection] = [:]
  private var startCompletion: ((Result<Int, LoopbackFailure>) -> Void)?
  private var callbackCompletion: ((Result<CallbackResult, LoopbackFailure>) -> Void)?
  private var outcome: Result<CallbackResult, LoopbackFailure>?
  private var startTimer: DispatchWorkItem?
  private var callbackTimer: DispatchWorkItem?
  private var awaiting = false
  private var finishing = false
  private var closed = false
  var isAwaiting: Bool { awaiting }

  init(expectedState: String, path: String, queue: DispatchQueue) throws {
    guard !expectedState.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, path == "/callback" else {
      throw LoopbackFailure(message: "Invalid loopback sign-in parameters")
    }
    self.expectedState = expectedState
    self.path = path
    self.queue = queue
    let parameters = NWParameters.tcp
    // A required local endpoint prevents Network from binding a wildcard interface.
    parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(IPv4Address("127.0.0.1")!), port: .any)
    self.listener = try NWListener(using: parameters, on: .any)
  }

  func start(completion: @escaping (Result<Int, LoopbackFailure>) -> Void) {
    startCompletion = completion
    listener.stateUpdateHandler = { [weak self] state in
      guard let self, !self.closed else { return }
      switch state {
      case .ready:
        guard let port = self.listener.port, port.rawValue != 0 else {
          self.finish(.failure(LoopbackFailure(message: "Loopback port is unavailable")))
          return
        }
        self.startTimer?.cancel()
        self.startTimer = nil
        let ready = self.startCompletion
        self.startCompletion = nil
        ready?(.success(Int(port.rawValue)))
      case .failed:
        self.finish(.failure(LoopbackFailure(message: "Loopback listener failed")))
      case .cancelled:
        self.finish(.failure(LoopbackFailure(message: "Loopback listener was cancelled")))
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      guard let self, !self.closed, !self.finishing, self.connections.count < 4 else {
        connection.cancel()
        return
      }
      let id = UUID()
      self.connections[id] = connection
      connection.start(queue: self.queue)
      self.receive(connection, id: id, buffer: Data())
    }
    let timer = DispatchWorkItem { [weak self] in
      self?.finish(.failure(LoopbackFailure(message: "Loopback listener startup timed out")))
    }
    startTimer = timer
    queue.asyncAfter(deadline: .now() + .seconds(10), execute: timer)
    listener.start(queue: queue)
  }

  func awaitCallback(timeoutMs: Double, completion: @escaping (Result<CallbackResult, LoopbackFailure>) -> Void) {
    guard !awaiting else {
      // A duplicate waiter must not remove or close the original session.
      completion(.failure(LoopbackFailure(message: "Callback is already being awaited")))
      return
    }
    awaiting = true
    callbackCompletion = completion
    guard timeoutMs.isFinite, timeoutMs >= 1, timeoutMs <= Double(Int32.max) else {
      let invalid = LoopbackFailure(message: "Invalid callback timeout")
      if closed {
        callbackCompletion = nil
        completion(.failure(invalid))
      } else {
        finish(.failure(invalid))
      }
      return
    }
    if let outcome {
      callbackCompletion = nil
      completion(outcome)
      return
    }
    let timer = DispatchWorkItem { [weak self] in
      self?.finish(.failure(LoopbackFailure(message: "OAuth callback timed out")))
    }
    callbackTimer = timer
    queue.asyncAfter(deadline: .now() + .milliseconds(Int(timeoutMs)), execute: timer)
  }

  private func receive(_ connection: NWConnection, id: UUID, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, complete, error in
      guard let self, !self.closed, !self.finishing, self.connections[id] != nil else { return }
      var bytes = buffer
      if let data { bytes.append(data) }
      guard bytes.count <= 16_384 else {
        self.respond(connection, id: id, status: "400 Bad Request", message: "Invalid sign-in request.")
        return
      }
      if let end = bytes.range(of: Data("\r\n\r\n".utf8)) {
        guard let header = String(data: bytes[..<end.lowerBound], encoding: .utf8),
              let line = header.components(separatedBy: "\r\n").first else {
          self.respond(connection, id: id, status: "400 Bad Request", message: "Invalid sign-in request.")
          return
        }
        self.handle(line, connection: connection, id: id)
      } else if complete || error != nil {
        self.connections.removeValue(forKey: id)?.cancel()
      } else {
        self.receive(connection, id: id, buffer: bytes)
      }
    }
  }

  private func handle(_ line: String, connection: NWConnection, id: UUID) {
    let parts = line.components(separatedBy: " ")
    guard parts.count == 3, parts[0] == "GET", ["HTTP/1.0", "HTTP/1.1"].contains(parts[2]),
          parts[1].hasPrefix("/") else {
      respond(connection, id: id, status: "400 Bad Request", message: "Invalid sign-in request.")
      return
    }
    let target = parts[1].split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    guard target[0] == path else {
      respond(connection, id: id, status: "404 Not Found", message: "This page was not found.")
      return
    }
    do {
      let query = try parseQuery(target.count == 2 ? String(target[1]) : "")
      guard query["state"] == expectedState else {
        failResponse(connection, id: id, message: "Sign-in could not be verified. Please try again.", error: "OAuth callback state mismatch")
        return
      }
      if query["error"] != nil {
        // error_description is decoded but never reflected into HTML or logs.
        failResponse(connection, id: id, message: "Sign-in was not completed. Please return to OpenCalorieTracker and try again.", error: "OAuth authorization failed")
        return
      }
      guard let code = query["code"], !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        failResponse(connection, id: id, message: "The sign-in response is missing an authorization code.", error: "Missing OAuth authorization code")
        return
      }
      let rawClientId = query["client_id"]?.trimmingCharacters(in: .whitespacesAndNewlines)
      let issuedClientId = (rawClientId?.isEmpty == false) ? rawClientId : nil
      finishing = true
      respond(connection, id: id, status: "200 OK", message: "Finishing sign-in in the app…", result: .success(CallbackResult(code: code, state: expectedState, clientId: issuedClientId)))
    } catch {
      failResponse(connection, id: id, message: "Invalid sign-in response.", error: "Invalid OAuth callback query")
    }
  }

  private func parseQuery(_ rawQuery: String) throws -> [String: String] {
    var query: [String: String] = [:]
    for pair in rawQuery.split(separator: "&") {
      let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      guard let key = String(parts[0]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding,
            let value = (parts.count == 2 ? String(parts[1]) : "").replacingOccurrences(of: "+", with: " ").removingPercentEncoding,
            query[key] == nil else {
        throw LoopbackFailure(message: "Invalid callback parameter")
      }
      query[key] = value
    }
    return query
  }

  private func failResponse(_ connection: NWConnection, id: UUID, message: String, error: String) {
    finishing = true
    respond(connection, id: id, status: "400 Bad Request", message: message, result: .failure(LoopbackFailure(message: error)))
  }

  private func respond(_ connection: NWConnection, id: UUID, status: String, message: String,
                       result: Result<CallbackResult, LoopbackFailure>? = nil) {
    let isSuccess = status.hasPrefix("200")
    let refreshMeta = isSuccess ? "<meta http-equiv=\"refresh\" content=\"0;url=opencalorietracker://chatgpt\">" : ""
    let badgeColor = isSuccess ? "#7aa2f7" : "#f7768e"
    let badgeBg = isSuccess ? "rgba(122,162,247,0.14)" : "rgba(247,118,142,0.14)"
    let badgeBorder = isSuccess ? "rgba(122,162,247,0.42)" : "rgba(247,118,142,0.42)"
    let glyph = isSuccess
      ? "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"\(badgeColor)\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 12h14\"/><path d=\"m13 6 6 6-6 6\"/></svg>"
      : "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"\(badgeColor)\" stroke-width=\"2.2\" stroke-linecap=\"round\"><path d=\"M12 8v5\"/><circle cx=\"12\" cy=\"16.5\" r=\"0.8\" fill=\"\(badgeColor)\"/></svg>"
    let heading = isSuccess ? "Returning to OpenCalorieTracker" : "Sign-in could not finish"
    let action = isSuccess
      ? "<a class=\"cta\" href=\"opencalorietracker://chatgpt\">Open OpenCalorieTracker</a>"
      : "<a class=\"cta ghost\" href=\"opencalorietracker://chatgpt\">Return to OpenCalorieTracker</a>"
    let footnote = isSuccess
      ? "Secure local callback · You can close this tab if the app does not open"
      : "No account data was stored · Return to the app to retry"
    let body = Data("""
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\(refreshMeta)<title>OpenCalorieTracker</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#1a1b26;color:#c0caf5;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}.card{width:100%;max-width:360px;background:#24283b;border:1px solid #2e3348;border-radius:20px;padding:32px 24px 26px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.45)}.badge{width:56px;height:56px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:\(badgeBg);border:1.5px solid \(badgeBorder)}.brand{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7aa2f7;margin:0 0 8px}h1{margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-.02em;color:#e4e8fb}p{margin:0;font-size:14px;color:#9aa5ce}.cta{display:block;margin-top:24px;padding:13px 18px;border-radius:12px;background:#7aa2f7;color:#1a1b26;text-decoration:none;font-weight:700;font-size:14px}.cta.ghost{background:#2e3348;color:#c0caf5}.foot{margin-top:16px;font-size:11px;color:#565f89}</style></head><body><main class="card"><div class="badge">\(glyph)</div><div class="brand">OpenCalorieTracker</div><h1>\(heading)</h1><p>\(message)</p>\(action)<p class="foot">\(footnote)</p></main></body></html>
    """.utf8)
    let headers = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'\r\n\r\n"
    connection.send(content: Data(headers.utf8) + body, contentContext: .finalMessage, isComplete: true,
                    completion: .contentProcessed { [weak self] error in
      connection.cancel()
      guard let self else { return }
      self.connections.removeValue(forKey: id)
      if let result {
        self.finish(error == nil ? result : .failure(LoopbackFailure(message: "Could not send the sign-in response")))
      }
    })
  }

  private func finish(_ result: Result<CallbackResult, LoopbackFailure>) {
    guard !closed else { return }
    closed = true
    outcome = result
    startTimer?.cancel()
    callbackTimer?.cancel()
    startTimer = nil
    callbackTimer = nil
    listener.stateUpdateHandler = nil
    listener.newConnectionHandler = nil
    listener.cancel()
    connections.values.forEach { $0.cancel() }
    connections.removeAll()
    let starting = startCompletion
    let waiting = callbackCompletion
    startCompletion = nil
    callbackCompletion = nil
    starting?(.failure(LoopbackFailure(message: "Loopback listener closed before it became ready")))
    waiting?(result)
  }

  func close() {
    finish(.failure(LoopbackFailure(message: "Sign-in was cancelled")))
  }
}
