import type { Editables } from "@/lib/content/editables";
import { Container } from "@/components/ui";

/** Inner-page opening: editable h1 + lead in a two-column head. */
export function PageHead({ c, title, lead }: { c: Editables; title: string; lead: string }) {
  return (
    <header className="page-head">
      <Container className="page-head__grid">
        <c.Text k="head.title" as="h1" className="t-display" fallback={title} />
        <c.Text k="head.lead" as="p" className="t-lead" fallback={lead} multiline />
      </Container>
    </header>
  );
}
