import { Container, Section, buttonClass } from "@/components/ui";
import type { TemplateDefinition } from "./types";

/**
 * Contact — content keys:
 *   heading (text) · intro (richtext)
 *   details (list) → label (text), value (text)
 *   cta (link)
 */
export const contactTemplate: TemplateDefinition = {
  id: "contact",
  name: "Contact",
  description: "Heading, intro, a list of contact details and a call to action.",
  component: ({ c }) => (
    <main id="main">
      <Section>
        <Container size="narrow">
          <c.Text k="heading" as="h1" className="t-display" fallback="Get in touch" />
          <div style={{ marginTop: "var(--space-6)" }}>
            <c.RichText k="intro" className="t-lead prose" fallback="We’d love to hear from you." />
          </div>
          <c.List
            k="details"
            as="ul"
            itemAs="li"
            className="details"
            fallbackItems={["email", "phone", "address"]}
            addLabel="Add detail"
            max={12}
            render={(item) => (
              <div className="detail">
                <item.Text k="label" as="span" className="detail__label" fallback="Label" />
                <item.Text k="value" as="span" className="t-body" fallback="Value" multiline />
              </div>
            )}
          />
          <div style={{ marginTop: "var(--space-8)" }}>
            <c.Link k="cta" className={buttonClass({ variant: "primary" })} fallback={{ text: "Send an email", href: "mailto:hello@example.com" }} />
          </div>
        </Container>
      </Section>
    </main>
  ),
};
