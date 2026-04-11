const DEFAULT_ANDROID_DOWNLOAD_URL = "https://kjorebok.nguyenchu.com/download/android.apk";
const DEFAULT_API_URL = "https://kjorebok.nguyenchu.com/api";
const LOCAL_API_URL = "http://localhost:3020";

export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  return process.env.NODE_ENV === "production" ? DEFAULT_API_URL : LOCAL_API_URL;
}

export function getAndroidDownloadUrl(): string | null {
  return process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL ?? DEFAULT_ANDROID_DOWNLOAD_URL;
}

export function getAndroidMetadataUrl(): string | null {
  const downloadUrl = getAndroidDownloadUrl();
  if (!downloadUrl) return null;

  return downloadUrl.replace(/\/android\.apk(?:\?.*)?$/, "/android-latest.json");
}
