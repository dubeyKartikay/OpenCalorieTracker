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

data class CallbackResult(val code: String, val state: String)

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
            respond(it, "200 OK", "Sign-in complete — you can return to OpenCalorieTracker.")
            return CallbackResult(code, expectedState)
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

  private fun respond(socket: Socket, status: String, message: String) {
    val body = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenCalorieTracker sign-in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1a1b26;color:#c0caf5;font:18px system-ui,sans-serif}main{max-width:32rem;padding:2rem;text-align:center}h1{color:#7aa2f7;font-size:1.4rem}</style></head><body><main><h1>OpenCalorieTracker</h1><p>$message</p></main></body></html>""".toByteArray(Charsets.UTF_8)
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
