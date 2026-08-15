import { HomeCornerLink, LegalLinks } from "@/components/legal/LegalLinks";

/** Fixed bottom-right cluster: legal links left of home icon (desktop only). */
export function AppCornerLinks() {
  return (
    <div
      className="fixed bottom-4 right-4 z-[51] hidden items-center gap-2 md:flex"
      aria-label="App links"
    >
      <LegalLinks />
      <HomeCornerLink />
    </div>
  );
}
