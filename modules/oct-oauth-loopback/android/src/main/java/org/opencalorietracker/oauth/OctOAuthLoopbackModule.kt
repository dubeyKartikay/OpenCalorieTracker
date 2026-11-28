package org.opencalorietracker.oauth

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

class OctOAuthLoopbackModule : Module() {
  private class Session(val server: LoopbackHttpServer) {
    val awaiting = AtomicBoolean(false)
  }

  private val sessions = ConcurrentHashMap<String, Session>()
  private val lifecycleLock = Any()
  private var destroyed = false

  override fun definition() = ModuleDefinition {
    Name("OctOAuthLoopback")

    AsyncFunction("startSessionAsync") { expectedState: String, path: String ->
      synchronized(lifecycleLock) {
        check(!destroyed) { "Loopback module is closed" }
        val server = LoopbackHttpServer(expectedState, path)
        val id = UUID.randomUUID().toString()
        sessions[id] = Session(server)
        mapOf("sessionId" to id, "port" to server.port)
      }
    }

    AsyncFunction("awaitCallbackAsync") Coroutine { sessionId: String, timeoutMs: Double ->
      val session = sessions[sessionId] ?: error("Unknown loopback session")
      check(session.awaiting.compareAndSet(false, true)) { "Callback is already being awaited" }
      try {
        require(timeoutMs.isFinite() && timeoutMs >= 1 && timeoutMs <= Int.MAX_VALUE) {
          "Invalid callback timeout"
        }
        val result = withContext(Dispatchers.IO) {
          suspendCancellableCoroutine<CallbackResult> { continuation ->
            // Interrupting a thread alone does not unblock ServerSocket.accept().
            continuation.invokeOnCancellation { session.server.close() }
            try {
              continuation.resume(session.server.awaitCallback(timeoutMs.toLong()))
            } catch (error: Exception) {
              continuation.resumeWithException(error)
            }
          }
        }
        val payload = mutableMapOf("code" to result.code, "state" to result.state)
        if (!result.clientId.isNullOrBlank()) payload["clientId"] = result.clientId
        payload
      } finally {
        sessions.remove(sessionId, session)
        session.server.close()
      }
    }

    AsyncFunction("closeSessionAsync") { sessionId: String ->
      sessions.remove(sessionId)?.server?.close()
      Unit
    }

    OnDestroy {
      synchronized(lifecycleLock) {
        destroyed = true
        sessions.values.forEach { it.server.close() }
        sessions.clear()
      }
    }
  }
}
