const DEFAULT_ANDROID_DOWNLOAD_URL = "https://kjorebok.nguyenchu.com/download/android.apk";
const DEFAULT_API_URL = "https://kjorebok.nguyenchu.com/api";

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function getAndroidDownloadUrl(): string | null {
  return process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL ?? DEFAULT_ANDROID_DOWNLOAD_URL;
}

export function getAndroidMetadataUrl(): string | null {
  const downloadUrl = getAndroidDownloadUrl();
  if (!downloadUrl) return null;

  return downloadUrl.replace(/\/android\.apk(?:\?.*)?$/, "/android-latest.json");
}
