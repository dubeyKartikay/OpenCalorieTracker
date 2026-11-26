package org.opencalorietracker.barcode

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import zxingcpp.BarcodeReader

class OctBarcodeScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OctBarcodeScanner")

    Function("isAvailable") { true }

    AsyncFunction("requestCameraPermissionAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    AsyncFunction("getCameraPermissionAsync") {
      val reactContext = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ContextCompat.checkSelfPermission(reactContext, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction("decodeImageUriAsync") Coroutine { uriString: String ->
      val reactContext = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        val uri = Uri.parse(uriString)
        require(uri.scheme == "file" || uri.scheme == "content") { "Expected a local file:// or content:// image URI." }
        val bitmap = reactContext.contentResolver.openInputStream(uri)?.use { stream ->
          BitmapFactory.decodeStream(stream)
        } ?: throw IllegalArgumentException("Unable to open the barcode image.")
        try {
          BarcodeReader(BarcodeReader.Options(tryRotate = true, tryHarder = true)).read(bitmap)
            .firstNotNullOfOrNull { result ->
              ZxingSymbologyMapper.detection(result.text, result.format.name, result.error == null)?.asMap()
            }
        } finally {
          bitmap.recycle()
        }
      }
    }

    View(OctBarcodeScannerView::class) {
      Events("onBarcodeScanned", "onPhotoCaptured", "onScannerError")
      Prop("active") { view: OctBarcodeScannerView, value: Boolean -> view.active = value }
      Prop("torchEnabled") { view: OctBarcodeScannerView, value: Boolean -> view.torchEnabled = value }
      Prop("scanBarcodes") { view: OctBarcodeScannerView, value: Boolean -> view.scanBarcodes = value }
      Prop("captureToken") { view: OctBarcodeScannerView, value: Int -> view.captureToken = value }
    }
  }
}
