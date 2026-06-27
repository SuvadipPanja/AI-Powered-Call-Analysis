/**
 * Decorative layer for the auth brand panel: a soft dot grid and a few
 * drifting teal/amber color blobs. Purely visual — sits behind the content.
 */
export default function AuthDecor() {
  return (
    <div className="auth2-decor" aria-hidden="true">
      <div className="auth2-decor__grid" />
      <span className="auth2-blob auth2-blob--1" />
      <span className="auth2-blob auth2-blob--2" />
      <span className="auth2-blob auth2-blob--3" />
    </div>
  );
}
