export function getAndroidDownloadUrl(): string | null {
  return process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL ?? null;
}

export function getAndroidMetadataUrl(): string | null {
  const downloadUrl = getAndroidDownloadUrl();
  if (!downloadUrl) return null;

  return downloadUrl.replace(/\/android\.apk(?:\?.*)?$/, "/android-latest.json");
}
