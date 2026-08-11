import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProtocol ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "Mehrere Streams. Ein globaler Boss. Ein gemeinsames Ziel bis Halloween.";

  return {
    metadataBase: new URL(origin),
    title: {
      default: "Kürbiskönig – Community Boss Event",
      template: "%s | Kürbiskönig",
    },
    description,
    openGraph: {
      title: "Kürbiskönig – Community Boss Event",
      description,
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "Kürbiskönig Community Boss Event" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Kürbiskönig – Community Boss Event",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
