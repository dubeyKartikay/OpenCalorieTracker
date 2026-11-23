import * as ImagePicker from 'expo-image-picker';

export interface PickedMealImage {
  uri: string;
  imageDataUrl: string;
  width?: number;
  height?: number;
}

/** Permissions are requested only after the user chooses camera or library. */
export async function pickMealImage(source: 'camera' | 'library'): Promise<PickedMealImage | null> {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    const name = source === 'camera' ? 'Camera' : 'Photo library';
    throw new Error(`${name} permission was not granted. You can enter your meal manually, or enable access in OS Settings to add a photo.`);
  }

  const options: ImagePicker.ImagePickerOptions = { base64: true, quality: 0.7, mediaTypes: ['images'] };
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.base64) {
    throw new Error('This photo could not be loaded. Try another image, or enter your meal manually.');
  }
  // Expo ImagePicker returns JPEG bytes for base64 when no MIME type is supplied.
  const mimeType = asset.mimeType || 'image/jpeg';
  return {
    uri: asset.uri, imageDataUrl: `data:${mimeType};base64,${asset.base64}`,
    width: asset.width, height: asset.height,
  };
}
