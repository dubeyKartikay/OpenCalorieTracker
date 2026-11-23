import type { AppRuntime } from './runtime';
/** Metro resolves bootstrap.native on iOS/Android. Web never loads native SQLite/WASM. */
export async function bootstrap(): Promise<AppRuntime> {
  throw new Error('Local storage is unavailable on this web build. This app requires native SQLite with FTS5. Open the iOS or Android development build to search food packs, log meals, and restore backups. No diary data has been loaded or changed.');
}
