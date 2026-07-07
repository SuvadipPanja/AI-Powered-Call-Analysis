import { apiGet } from "../utils/apiHelpers";

export async function getPublicBranding() {
  return apiGet("/api/public/branding", { label: "public-branding" });
}
