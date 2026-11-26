package org.opencalorietracker.barcode

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.SystemClock
import android.util.Base64
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import zxingcpp.BarcodeReader

class OctBarcodeScannerView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), DefaultLifecycleObserver {
  override val shouldUseAndroidLayout = true
  val onBarcodeScanned by EventDispatcher()
  val onPhotoCaptured by EventDispatcher()
  val onScannerError by EventDispatcher()

  private val previewView = PreviewView(context)
  private val mainExecutor = ContextCompat.getMainExecutor(context)
  private val debounce = BarcodeDetectionDebouncer()
  private var observedOwner: LifecycleOwner? = null
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var preview: Preview? = null
  private var imageCapture: ImageCapture? = null
  private var analysis: ImageAnalysis? = null
  private var analysisExecutor: ExecutorService? = null
  private var captureExecutor: ExecutorService? = null
  private var generation = 0
  private var starting = false
  private var hostResumed = false
  private var lastHandledCaptureToken = 0
  private var captureInFlight = false
  private var boundScanMode: Boolean? = null

  var scanBarcodes: Boolean = true
    set(value) {
      val changed = field != value
      field = value
      if (changed && (camera != null || starting) && boundScanMode != value) {
        stopCamera()
        reconcileCamera()
      }
    }

  var active: Boolean = true
    set(value) { field = value; reconcileCamera() }
  var torchEnabled: Boolean = false
    set(value) { field = value; applyTorch() }
  var captureToken: Int = 0
    set(value) {
      field = value
      if (value > 0 && value != lastHandledCaptureToken) {
        lastHandledCaptureToken = value
        triggerPhotoCapture(value)
      }
    }

  init {
    previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    previewView.scaleType = PreviewView.ScaleType.FILL_CENTER
    addView(previewView, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    val owner = findViewTreeLifecycleOwner() ?: (appContext.currentActivity as? LifecycleOwner)
    observedOwner = owner
    owner?.lifecycle?.addObserver(this)
    hostResumed = owner == null || owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
    reconcileCamera()
  }

  override fun onDetachedFromWindow() {
    observedOwner?.lifecycle?.removeObserver(this)
    observedOwner = null
    stopCamera()
    super.onDetachedFromWindow()
  }

  override fun onResume(owner: LifecycleOwner) { hostResumed = true; reconcileCamera() }
  override fun onPause(owner: LifecycleOwner) { hostResumed = false; stopCamera() }
  override fun onDestroy(owner: LifecycleOwner) { hostResumed = false; stopCamera() }

  private fun reconcileCamera() {
    if (!active || !isAttachedToWindow || !hostResumed) {
      stopCamera()
    } else if (camera == null && !starting) {
      startCamera()
    }
  }

  private fun startCamera() {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      reportError("Camera permission is required to use the camera.")
      return
    }
    val owner = findViewTreeLifecycleOwner() ?: (appContext.currentActivity as? LifecycleOwner)
    if (owner == null) {
      reportError("A foreground camera lifecycle is unavailable.")
      return
    }
    val modeScanBarcodes = scanBarcodes
    boundScanMode = modeScanBarcodes
    starting = true
    val token = ++generation
    val future = try {
      ProcessCameraProvider.getInstance(context)
    } catch (error: Exception) {
      stopCamera()
      reportError(error.message ?: "Unable to initialize the camera.")
      return
    }
    future.addListener({
      if (token != generation || !active || !isAttachedToWindow || !hostResumed) return@addListener
      try {
        val cameraProvider = future.get()
        provider = cameraProvider
        if (!cameraProvider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) {
          throw IllegalStateException("No rear camera is available on this device.")
        }
        val cameraPreview = Preview.Builder().build()
        cameraPreview.setSurfaceProvider(previewView.surfaceProvider)
        preview = cameraPreview

        // Bind only 2 concurrent streams (Preview + ImageAnalysis OR Preview + ImageCapture)
        // for universal Camera2 HAL compatibility across all Android phones and emulators.
        if (modeScanBarcodes) {
          val imageAnalysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
          analysis = imageAnalysis
          val executor = Executors.newSingleThreadExecutor()
          analysisExecutor = executor
          val errorReported = AtomicBoolean(false)
          // JNI initialization happens inside the analyzer try block, never on the UI thread.
          var reader: BarcodeReader? = null
          imageAnalysis.setAnalyzer(executor) { imageProxy ->
            try {
              val detection = imageProxy.use { image ->
                val decoder = reader ?: BarcodeReader(BarcodeReader.Options(tryRotate = true)).also { reader = it }
                decoder.read(image).firstNotNullOfOrNull { result ->
                  ZxingSymbologyMapper.detection(result.text, result.format.name, result.error == null)
                }
              }
              if (detection != null) {
                mainExecutor.execute {
                  if (token == generation && active && scanBarcodes && hostResumed && isAttachedToWindow &&
                    debounce.accept(detection, SystemClock.elapsedRealtime())) {
                    onBarcodeScanned(detection.asMap())
                  }
                }
              }
            } catch (error: Exception) {
              if (errorReported.compareAndSet(false, true)) postAnalysisError(token, error.message)
            } catch (error: LinkageError) {
              if (errorReported.compareAndSet(false, true)) postAnalysisError(token, error.message)
            }
          }
          camera = cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, cameraPreview, imageAnalysis)
        } else {
          val photoCapture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()
          imageCapture = photoCapture
          captureExecutor = Executors.newSingleThreadExecutor()
          camera = cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, cameraPreview, photoCapture)
        }
        starting = false
        applyTorch()
      } catch (error: Exception) {
        stopCamera()
        reportError(error.message ?: "Unable to start the camera.")
      }
    }, mainExecutor)
  }

  private fun triggerPhotoCapture(requestToken: Int) {
    val capture = imageCapture
    val executor = captureExecutor
    if (capture == null || executor == null || !active || camera == null) {
      reportError("Camera is still starting. Tap shutter again in a moment.")
      return
    }
    if (captureInFlight) return
    captureInFlight = true
    val sessionToken = generation
    capture.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
      override fun onCaptureSuccess(image: ImageProxy) {
        try {
          val jpegPayload = image.use { proxy -> encodeProxyToJpegPayload(proxy) }
          mainExecutor.execute {
            captureInFlight = false
            if (sessionToken == generation && isAttachedToWindow) {
              onPhotoCaptured(
                mapOf(
                  "uri" to jpegPayload.uri,
                  "imageDataUrl" to jpegPayload.dataUrl,
                  "width" to jpegPayload.width,
                  "height" to jpegPayload.height,
                  "token" to requestToken,
                ),
              )
            }
          }
        } catch (error: Exception) {
          mainExecutor.execute {
            captureInFlight = false
            if (sessionToken == generation) {
              reportError(error.message ?: "Could not save captured photo.")
            }
          }
        }
      }

      override fun onError(exception: ImageCaptureException) {
        mainExecutor.execute {
          captureInFlight = false
          if (sessionToken == generation) {
            reportError(exception.message ?: "Could not capture photo.")
          }
        }
      }
    })
  }

  private data class CapturedPayload(val uri: String, val dataUrl: String, val width: Int, val height: Int)

  private fun encodeProxyToJpegPayload(proxy: ImageProxy): CapturedPayload {
    val buffer = proxy.planes[0].buffer
    val bytes = ByteArray(buffer.remaining())
    buffer.get(bytes)
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      ?: throw IllegalStateException("Captured frame could not be decoded.")
    var working: Bitmap = decoded
    try {
      val rotation = proxy.imageInfo.rotationDegrees
      if (rotation != 0) {
        val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
        val rotated = Bitmap.createBitmap(working, 0, 0, working.width, working.height, matrix, true)
        if (rotated != working) {
          working.recycle()
          working = rotated
        }
      }
      val (targetW, targetH) = PhotoCaptureSizer.computeScaledSize(working.width, working.height, 1600)
      if (targetW > 0 && targetH > 0 && (targetW != working.width || targetH != working.height)) {
        val scaled = Bitmap.createScaledBitmap(working, targetW, targetH, true)
        if (scaled != working) {
          working.recycle()
          working = scaled
        }
      }
      val outStream = ByteArrayOutputStream()
      working.compress(Bitmap.CompressFormat.JPEG, 78, outStream)
      val jpegBytes = outStream.toByteArray()
      val file = File(context.cacheDir, "oct_meal_${System.currentTimeMillis()}.jpg")
      file.writeBytes(jpegBytes)
      val base64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
      return CapturedPayload(
        uri = Uri.fromFile(file).toString(),
        dataUrl = "data:image/jpeg;base64,$base64",
        width = working.width,
        height = working.height,
      )
    } finally {
      if (!working.isRecycled) working.recycle()
    }
  }

  private fun postAnalysisError(token: Int, message: String?) {
    mainExecutor.execute {
      if (token == generation) {
        stopCamera()
        reportError(message ?: "Unable to decode camera frames.")
      }
    }
  }

  private fun applyTorch() {
    val currentCamera = camera ?: return
    if (!currentCamera.cameraInfo.hasFlashUnit()) {
      if (torchEnabled) reportError("This camera does not have a torch.")
      return
    }
    val token = generation
    val result = currentCamera.cameraControl.enableTorch(torchEnabled)
    result.addListener({
      try { result.get() } catch (error: Exception) {
        if (token == generation) reportError(error.message ?: "Unable to change the camera torch.")
      }
    }, mainExecutor)
  }

  private fun stopCamera() {
    ++generation // Discard asynchronous binds and frame events from the previous session.
    starting = false
    captureInFlight = false
    boundScanMode = null
    analysis?.clearAnalyzer()
    val ownedUseCases = listOfNotNull(preview, imageCapture, analysis).toTypedArray()
    try {
      if (ownedUseCases.isNotEmpty()) provider?.unbind(*ownedUseCases)
    } finally {
      camera = null
      preview = null
      imageCapture = null
      analysis = null
      provider = null
      // Let an in-flight image.use finish and close its ImageProxy before the worker exits.
      analysisExecutor?.shutdown()
      analysisExecutor = null
      captureExecutor?.shutdown()
      captureExecutor = null
      debounce.reset()
    }
  }

  private fun reportError(message: String) { onScannerError(mapOf("message" to message)) }
}
