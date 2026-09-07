export function odptKeyFrom(request: Request): string {
  return request.headers.get("x-odpt-key")?.trim() || process.env.ODPT_CONSUMER_KEY?.trim() || "";
}

export function googleKeyFrom(request: Request): string {
  return request.headers.get("x-google-key")?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
}
