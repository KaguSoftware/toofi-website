import { Container, Section } from "@/components/ui";
import type { TemplateDefinition } from "./types";

/**
 * Generic page — content keys: title (text) · body (richtext).
 * Reading-width column; good for About, Terms, Privacy…
 */
export const genericTemplate: TemplateDefinition = {
  id: "generic",
  name: "Generic page",
  description: "Title and a rich-text body. Good for About, Terms, etc.",
  component: ({ c, page }) => (
    <main id="main">
      <Section>
        <Container size="narrow">
          <c.Text k="title" as="h1" className="t-display" fallback={page.title} />
          <div style={{ marginTop: "var(--space-8)" }}>
            <c.RichText k="body" className="prose" fallback="Start writing…" />
          </div>
        </Container>
      </Section>
    </main>
  ),
};
