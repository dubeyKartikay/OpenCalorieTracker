package org.opencalorietracker.oauth

import java.io.IOException
import java.net.InetAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class LoopbackHttpServerTest {
  private val executor = Executors.newCachedThreadPool()
  private val servers = mutableListOf<LoopbackHttpServer>()

  @After
  fun tearDown() {
    servers.forEach { it.close() }
    executor.shutdownNow()
    assertTrue(executor.awaitTermination(3, TimeUnit.SECONDS))
  }

  private fun server() = LoopbackHttpServer("xyz").also { servers.add(it) }

  private fun await(server: LoopbackHttpServer, timeoutMs: Long = 3_000): Future<CallbackResult> =
    executor.submit<CallbackResult> { server.awaitCallback(timeoutMs) }

  private fun request(server: LoopbackHttpServer, target: String): String =
    Socket(InetAddress.getByName("127.0.0.1"), server.port).use { socket ->
      socket.soTimeout = 3_000
      socket.getOutputStream().apply {
        write("GET $target HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\n\r\n".toByteArray(Charsets.US_ASCII))
        flush()
      }
      socket.getInputStream().readBytes().toString(Charsets.UTF_8)
    }

  private fun failure(future: Future<CallbackResult>): Throwable {
    try {
      future.get(4, TimeUnit.SECONDS)
      throw AssertionError("Expected callback failure")
    } catch (error: ExecutionException) {
      return error.cause!!
    }
  }

  private fun assertClosed(server: LoopbackHttpServer) {
    try {
      Socket(InetAddress.getByName("127.0.0.1"), server.port).use {
        fail("Closed listener accepted a connection")
      }
    } catch (_: IOException) {
      // The listening socket has been released.
    }
  }

  @Test
  fun bindsAnEphemeralIpv4LoopbackPortAndAcceptsCallback() {
    val server = server()
    assertTrue(server.port in 1..65535)
    // Verify the actual bound interface, rather than just the client destination.
    val field = LoopbackHttpServer::class.java.getDeclaredField("server").apply { isAccessible = true }
    val bound = field.get(server) as java.net.ServerSocket
    assertEquals("127.0.0.1", bound.inetAddress.hostAddress)
    assertFalse(bound.inetAddress.isAnyLocalAddress)
    val callback = await(server)
    val response = request(server, "/callback?code=abc&state=xyz")
    assertTrue(response.startsWith("HTTP/1.1 200 OK\r\n"))
    assertTrue(response.contains("Content-Type: text/html; charset=utf-8"))
    assertTrue(response.contains("Connection: close"))
    assertTrue(response.contains("#1a1b26"))
    assertTrue(response.contains("Sign-in complete — you can return to OpenCalorieTracker."))
    assertEquals(CallbackResult("abc", "xyz"), callback.get(3, TimeUnit.SECONDS))
    assertClosed(server)
  }

  @Test
  fun ignoresFaviconAndOtherPathsThenAcceptsCallback() {
    val server = server()
    val callback = await(server)
    assertTrue(request(server, "/favicon.ico").startsWith("HTTP/1.1 404 Not Found"))
    assertTrue(request(server, "/callback/other?code=no&state=xyz").startsWith("HTTP/1.1 404 Not Found"))
    assertFalse(callback.isDone)
    assertTrue(request(server, "/callback?code=abc&state=xyz").startsWith("HTTP/1.1 200 OK"))
    assertEquals(CallbackResult("abc", "xyz"), callback.get(3, TimeUnit.SECONDS))
  }

  @Test
  fun urlDecodesCallbackParameters() {
    val server = server()
    val callback = await(server)
    assertTrue(request(server, "/callback?code=a%2Bb%2Fc+%E2%9C%93&state=%78yz")
      .startsWith("HTTP/1.1 200 OK"))
    assertEquals(CallbackResult("a+b/c ✓", "xyz"), callback.get(3, TimeUnit.SECONDS))
  }

  @Test
  fun rejectsMismatchedStateAndCloses() {
    val server = server()
    val callback = await(server)
    val response = request(server, "/callback?code=abc&state=wrong")
    assertTrue(response.startsWith("HTTP/1.1 400 Bad Request"))
    assertEquals("OAuth callback state mismatch", failure(callback).message)
    assertClosed(server)
  }

  @Test
  fun rejectsOAuthErrorWithoutReflectingProviderText() {
    val server = server()
    val callback = await(server)
    val response = request(server, "/callback?error=access_denied&error_description=%3Cscript%3Esecret%3C%2Fscript%3E&state=xyz")
    assertTrue(response.startsWith("HTTP/1.1 400 Bad Request"))
    assertTrue(response.contains("#1a1b26"))
    assertFalse(response.contains("secret"))
    assertEquals("OAuth authorization failed", failure(callback).message)
    assertClosed(server)
  }

  @Test
  fun rejectsMissingCodeAndDuplicateState() {
    for (target in listOf("/callback?state=xyz", "/callback?code=abc&state=wrong&state=xyz")) {
      val server = server()
      val callback = await(server)
      assertTrue(request(server, target).startsWith("HTTP/1.1 400 Bad Request"))
      assertTrue(failure(callback) is IOException)
      assertClosed(server)
    }
  }

  @Test
  fun closeCancelsPendingAcceptAndIsIdempotent() {
    val server = server()
    val callback = await(server)
    server.close()
    server.close()
    assertTrue(failure(callback) is IOException)
    assertClosed(server)
  }

  @Test
  fun closeCancelsAnIncompleteHttpRequest() {
    val server = server()
    val callback = await(server)
    Socket("127.0.0.1", server.port).use { socket ->
      socket.soTimeout = 2_000
      socket.getOutputStream().write("GET /callback".toByteArray())
      server.close()
      assertTrue(failure(callback) is IOException)
      // A peer reset and an EOF both mean the accepted socket was closed.
      try { assertEquals(-1, socket.getInputStream().read()) } catch (_: java.net.SocketException) { }
    }
    assertClosed(server)
  }

  @Test
  fun timeoutClosesPendingAccept() {
    val server = server()
    assertTrue(failure(await(server, 50)) is SocketTimeoutException)
    assertClosed(server)
  }

  @Test
  fun timeoutClosesAnIncompleteHttpRequest() {
    val server = server()
    val callback = await(server, 250)
    Socket("127.0.0.1", server.port).use { socket ->
      socket.soTimeout = 2_000
      socket.getOutputStream().write("GET /callback".toByteArray())
      assertTrue(failure(callback) is SocketTimeoutException)
      assertEquals(-1, socket.getInputStream().read())
    }
    assertClosed(server)
  }
}
