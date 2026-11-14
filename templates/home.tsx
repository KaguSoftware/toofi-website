import { Container, Section, buttonClass } from "@/components/ui";
import type { TemplateDefinition } from "./types";

/**
 * Home — content keys (do not rename once pages use them):
 *   hero.title (text) · hero.body (richtext) · hero.cta (link) · hero.image (image)
 *   features (list) → title (text), body (text)
 *   cta.title (text) · cta.body (text) · cta.link (link)
 */
export const homeTemplate: TemplateDefinition = {
  id: "home",
  name: "Home",
  description: "Landing page: hero, features, call to action.",
  component: ({ c }) => (
    <main id="main">
      <Container className="hero">
        <c.Text k="hero.title" as="h1" className="t-display" fallback="Welcome to Toofi" />
        <div className="hero__body">
          <c.RichText
            k="hero.body"
            className="t-lead prose"
            fallback="A short, confident introduction to what you do and who it is for."
          />
        </div>
        <div className="hero__actions">
          <c.Link k="hero.cta" className={buttonClass({ variant: "primary" })} fallback={{ text: "Get in touch", href: "/contact" }} />
        </div>
        <div className="hero__media">
          <c.Image
            k="hero.image"
            priority
            sizes="(min-width: 72rem) 1152px, 100vw"
            fallback={{ src: "/placeholders/hero.png", alt: "", width: 1280, height: 720 }}
          />
        </div>
      </Container>

      <Section tone="subtle" aria-label="Features">
        <Container>
          <c.List
            k="features"
            as="ul"
            itemAs="li"
            className="grid-cards"
            itemClassName="card"
            fallbackItems={["a", "b", "c"]}
            addLabel="Add feature"
            max={9}
            render={(item) => (
              <>
                <item.Text k="title" as="h2" className="t-headline" fallback="Feature" />
                <item.Text
                  k="body"
                  as="p"
                  className="t-body"
                  fallback="Describe this feature in a sentence or two."
                  multiline
                />
              </>
            )}
          />
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="cta-band">
            <c.Text k="cta.title" as="h2" className="t-title" fallback="Ready when you are." />
            <c.Text
              k="cta.body"
              as="p"
              className="t-lead"
              fallback="Tell us what you’re working on and we’ll take it from there."
              multiline
            />
            <div className="hero__actions">
              <c.Link
                k="cta.link"
                className={buttonClass({ variant: "inverse" })}
                fallback={{ text: "Contact us", href: "/contact" }}
              />
            </div>
          </div>
        </Container>
      </Section>
    </main>
  ),
};
