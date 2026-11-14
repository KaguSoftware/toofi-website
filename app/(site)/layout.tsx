import type { ReactNode } from "react";
import { EditPageLauncher } from "@/components/editable/EditPageLauncher";

// Site chrome (header/footer) is rendered per page by components/site/SiteShell so
// global content and page content share one editor context in edit mode.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <EditPageLauncher />
    </>
  );
}
