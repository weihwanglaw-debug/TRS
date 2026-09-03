const NO_INDEX_PATHS = ["/admin", "/login", "/payment/result"];

export function robotsContentForPath(pathname: string): string {
  const shouldNotIndex = NO_INDEX_PATHS.some(path =>
    pathname === path || pathname.startsWith(`${path}/`),
  );

  return shouldNotIndex ? "noindex, nofollow, noarchive" : "index, follow";
}
