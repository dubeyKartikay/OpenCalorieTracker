package org.opencalorietracker.oauth

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicBoolean

data class CallbackResult(val code: String, val state: String, val clientId: String? = null)

/** A single-use, IPv4-loopback-only listener with no Android dependencies. */
class LoopbackHttpServer(
  private val expectedState: String,
  private val path: String = "/callback"
) : Closeable {
  init {
    require(expectedState.isNotBlank()) { "Expected OAuth state is required" }
    require(path == "/callback") { "Only /callback is supported" }
  }

  private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
  val port: Int = server.localPort
  private val lock = Any()
  private val awaiting = AtomicBoolean(false)
  private var closed = false
  private var activeSocket: Socket? = null

  fun awaitCallback(timeoutMs: Long): CallbackResult {
    check(awaiting.compareAndSet(false, true)) { "Callback is already being awaited" }
    try {
      require(timeoutMs in 1..Int.MAX_VALUE.toLong()) { "Invalid callback timeout" }
      val deadline = System.nanoTime() + timeoutMs * 1_000_000
      while (true) {
        server.soTimeout = remainingMillis(deadline)
        val socket = server.accept()
        synchronized(lock) {
          if (closed) {
            socket.close()
            throw SocketException("Loopback session is closed")
          }
          activeSocket = socket
        }
        try {
          socket.use {
            val requestLine = readRequest(it, deadline)
            val parts = requestLine.split(' ')
            if (parts.size != 3 || parts[0] != "GET" ||
              parts[2] !in listOf("HTTP/1.0", "HTTP/1.1") || !parts[1].startsWith("/")) {
              respond(it, "400 Bad Request", "Invalid sign-in request.")
              return@use
            }
            val uri = try { URI(parts[1]) } catch (_: Exception) {
              respond(it, "400 Bad Request", "Invalid sign-in request.")
              return@use
            }
            if (uri.rawPath != path || uri.rawAuthority != null) {
              respond(it, "404 Not Found", "This page was not found.")
              return@use
            }
            val query = try { parseQuery(uri.rawQuery.orEmpty()) } catch (_: Exception) {
              respond(it, "400 Bad Request", "Invalid sign-in response.")
              throw IOException("Invalid OAuth callback query")
            }
            val state = query["state"]
            if (state != expectedState) {
              respond(it, "400 Bad Request", "Sign-in could not be verified. Please try again.")
              throw IOException("OAuth callback state mismatch")
            }
            if (query.containsKey("error")) {
              // Never reflect provider-controlled query values into HTML or logs.
              respond(it, "400 Bad Request", "Sign-in was not completed. Please return to OpenCalorieTracker and try again.")
              throw IOException("OAuth authorization failed")
            }
            val code = query["code"]
            if (code.isNullOrBlank()) {
              respond(it, "400 Bad Request", "The sign-in response is missing an authorization code.")
              throw IOException("Missing OAuth authorization code")
            }
            val issuedClientId = query["client_id"]?.trim()?.takeIf { it.isNotEmpty() }
            respond(it, "200 OK", "Finishing sign-in in the app…", returnToApp = true)
            return CallbackResult(code, expectedState, issuedClientId)
          }
        } finally {
          synchronized(lock) { if (activeSocket === socket) activeSocket = null }
        }
      }
    } finally {
      close()
    }
  }

  private fun remainingMillis(deadline: Long): Int {
    val remaining = deadline - System.nanoTime()
    if (remaining <= 0) throw SocketTimeoutException("OAuth callback timed out")
    return ((remaining + 999_999) / 1_000_000).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
  }

  private fun readRequest(socket: Socket, deadline: Long): String {
    val input = socket.getInputStream()
    val header = ByteArrayOutputStream()
    var suffix = 0
    // Bound both header size and every blocking read, including partial requests.
    while (header.size() < 16_384) {
      socket.soTimeout = remainingMillis(deadline)
      val next = input.read()
      if (next == -1) throw IOException("Incomplete HTTP request")
      header.write(next)
      suffix = (suffix shl 8) or next
      if (suffix == 0x0d0a0d0a) {
        return header.toString("US-ASCII").substringBefore("\r\n")
      }
    }
    throw IOException("HTTP request headers are too large")
  }

  private fun parseQuery(rawQuery: String): Map<String, String> {
    val result = mutableMapOf<String, String>()
    for (pair in rawQuery.split('&').filter { it.isNotEmpty() }) {
      val parts = pair.split('=', limit = 2)
      val key = URLDecoder.decode(parts[0], "UTF-8")
      val value = URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
      require(!result.containsKey(key)) { "Duplicate callback parameter" }
      result[key] = value
    }
    return result
  }

  private fun respond(socket: Socket, status: String, message: String, returnToApp: Boolean = false) {
    val refreshMeta = if (returnToApp) """<meta http-equiv="refresh" content="0;url=opencalorietracker://chatgpt">""" else ""
    val badgeColor = if (returnToApp) "#7aa2f7" else "#f7768e"
    val badgeBg = if (returnToApp) "rgba(122,162,247,0.14)" else "rgba(247,118,142,0.14)"
    val badgeBorder = if (returnToApp) "rgba(122,162,247,0.42)" else "rgba(247,118,142,0.42)"
    val glyph = if (returnToApp) """<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="$badgeColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>""" else """<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="$badgeColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 8v5"/><circle cx="12" cy="16.5" r="0.8" fill="$badgeColor"/></svg>"""
    val heading = if (returnToApp) "Returning to OpenCalorieTracker" else "Sign-in could not finish"
    val action = if (returnToApp) """<a class="cta" href="opencalorietracker://chatgpt">Open OpenCalorieTracker</a>""" else """<a class="cta ghost" href="opencalorietracker://chatgpt">Return to OpenCalorieTracker</a>"""
    val footnote = if (returnToApp) "Secure local callback · You can close this tab if the app does not open" else "No account data was stored · Return to the app to retry"
    val body = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">$refreshMeta<title>OpenCalorieTracker</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#1a1b26;color:#c0caf5;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}.card{width:100%;max-width:360px;background:#24283b;border:1px solid #2e3348;border-radius:20px;padding:32px 24px 26px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.45)}.badge{width:56px;height:56px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:$badgeBg;border:1.5px solid $badgeBorder}.brand{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7aa2f7;margin:0 0 8px}h1{margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-.02em;color:#e4e8fb}p{margin:0;font-size:14px;color:#9aa5ce}.cta{display:block;margin-top:24px;padding:13px 18px;border-radius:12px;background:#7aa2f7;color:#1a1b26;text-decoration:none;font-weight:700;font-size:14px}.cta.ghost{background:#2e3348;color:#c0caf5}.foot{margin-top:16px;font-size:11px;color:#565f89}</style></head><body><main class="card"><div class="badge">$glyph</div><div class="brand">OpenCalorieTracker</div><h1>$heading</h1><p>$message</p>$action<p class="foot">$footnote</p></main></body></html>""".toByteArray(Charsets.UTF_8)
    val headers = "HTTP/1.1 $status\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'\r\n\r\n"
    socket.getOutputStream().apply {
      write(headers.toByteArray(Charsets.US_ASCII))
      write(body)
      flush()
    }
  }

  override fun close() {
    synchronized(lock) {
      if (closed) return
      closed = true
      // Cleanup must also be safe inside a coroutine cancellation handler.
      runCatching { activeSocket?.close() }
      activeSocket = null
      runCatching { server.close() }
    }
  }
}
