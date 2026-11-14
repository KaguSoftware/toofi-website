import Link from "next/link";
import type { Editables } from "@/lib/content/editables";
import { Container } from "@/components/ui";
import { NavDisclosure } from "./NavDisclosure";

/**
 * Sticky translucent header. Global keys: site.name, nav (list; item field `link`).
 * In edit mode editables render client islands, so we never wrap them in <a>/<button>
 * (that would swallow clicks/focus) — the brand only becomes a link for visitors.
 */
export function SiteHeader({ g }: { g: Editables }) {
  const brand = <g.Text k="site.name" fallback="Toofi" className="site-brand" />;
  return (
    <header className="site-header">
      <Container className="site-header__inner">
        {g.editing ? (
          brand
        ) : (
          <Link href="/" className="site-brand" aria-label={`${g.text("site.name", "Toofi")} — home`}>
            <g.Text k="site.name" fallback="Toofi" />
          </Link>
        )}
        <nav aria-label="Primary">
          <NavDisclosure>
            <g.List
              k="nav"
              as="ul"
              itemAs="li"
              className="nav-list"
              fallbackItems={["home", "about", "contact"]}
              addLabel="Add menu link"
              max={8}
              render={(item) => <item.Link k="link" fallback={{ text: "Link", href: "/" }} />}
            />
          </NavDisclosure>
        </nav>
      </Container>
    </header>
  );
}
