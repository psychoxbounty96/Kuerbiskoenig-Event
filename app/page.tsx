import type { Metadata } from "next";
import { PublicEventPage } from "./components/PublicEventPage";

export const metadata: Metadata = {
  title: "Kürbiskönig – Community Boss Event",
  description:
    "Gemeinsam gegen den Kürbiskönig: der lokale v0.1-Prototyp des streamerübergreifenden Halloween-Events.",
};

export default function Home() {
  return <PublicEventPage />;
}
