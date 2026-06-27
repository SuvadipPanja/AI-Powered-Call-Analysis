import { useAppBranding } from "../../utils/appBranding";

/** Brand-panel content: app name + tagline (logo stays on login card only). */
export default function AuthHero() {
  const { appName } = useAppBranding();

  return (
    <div className="auth2-hero">
      <h2 className="auth2-hero__title">{appName}</h2>
      <p className="auth2-hero__tagline">
        Real-time transcription, sentiment analysis, and agent scoring —
        one secure workspace for every conversation.
      </p>
    </div>
  );
}
