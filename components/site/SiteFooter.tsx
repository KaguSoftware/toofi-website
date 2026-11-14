import type { Editables } from "@/lib/content/editables";
import { Container } from "@/components/ui";

/** Global keys: site.name, footer.tagline, social (list; item field `link`), footer.note. */
export function SiteFooter({ g }: { g: Editables }) {
  return (
    <footer className="site-footer">
      <Container>
        <div className="site-footer__top">
          <div style={{ maxWidth: "22rem" }}>
            <g.Text k="site.name" as="p" fallback="Toofi" className="t-headline" />
            <g.Text
              k="footer.tagline"
              as="p"
              fallback="Thoughtfully made, simply put."
              className="t-small"
              multiline
            />
          </div>
          <g.List
            k="social"
            as="ul"
            itemAs="li"
            className="site-footer__social"
            fallbackItems={[]}
            addLabel="Add social link"
            max={8}
            render={(item) => (
              <item.Link k="link" className="link-subtle" fallback={{ text: "Link", href: "https://example.com" }} />
            )}
          />
        </div>
        <div className="site-footer__bottom">
          <g.Text k="footer.note" as="p" fallback="© Toofi" className="t-small" />
        </div>
      </Container>
    </footer>
  );
}
