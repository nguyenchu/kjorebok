export function getAndroidDownloadUrl(): string | null {
  return process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL ?? null;
}
