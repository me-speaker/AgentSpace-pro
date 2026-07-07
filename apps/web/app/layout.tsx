// L4.3 — root layout (Next.js convention).
//
// In a real Next.js deploy this would be:
//
//   export default function RootLayout({ children }: { children: React.ReactNode }) {
//     return <html lang="en"><body>{children}</body></html>;
//   }
//
// In the L4.3 scaffold (test repo, no react/next installed), we
// represent the same structure with the h() helper so layout.tsx
// can be unit-tested as a plain function.

import { h, type HNode } from "./html.ts";

export interface RootLayoutProps {
  children: HNode | string;
}

export function RootLayout(props: RootLayoutProps): HNode {
  return h("html", { lang: "en" }, [
    h("body", {}, [props.children]),
  ]);
}

export default RootLayout;