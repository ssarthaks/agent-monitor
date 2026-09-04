export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <h1 className="text-4xl font-black text-ink mb-2">404</h1>
      <h2 className="text-lg font-bold text-ink mb-1">Page Not Found</h2>
      <p className="text-xs text-ink-muted">
        The requested session or page could not be found.
      </p>
    </div>
  );
}
