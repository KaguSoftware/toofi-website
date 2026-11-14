import Link from "next/link";
import { Container, Section, buttonClass } from "@/components/ui";

export const metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main id="main">
      <Section>
        <Container size="narrow">
          <div style={{ textAlign: "center" }}>
            <p className="t-eyebrow">404</p>
            <h1 className="t-display" style={{ marginTop: "var(--space-4)" }}>
              Page not found
            </h1>
            <p className="t-lead" style={{ margin: "var(--space-6) auto 0", maxWidth: "30rem" }}>
              The page you’re looking for doesn’t exist, or it hasn’t been published yet.
            </p>
            <div style={{ marginTop: "var(--space-8)" }}>
              <Link href="/" className={buttonClass({ variant: "primary" })}>
                Back to home
              </Link>
            </div>
          </div>
        </Container>
      </Section>
    </main>
  );
}
