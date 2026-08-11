import { createRoot } from "react-dom/client";
import "../../../app/globals.css";
import { PublicEventPage } from "../../../app/components/PublicEventPage";
import AdminPage from "../../../app/admin/page";
import OverlayPage from "../../../app/overlay/page";

const rootElement = document.getElementById("root");

if (!rootElement) throw new Error("GitHub Pages root element is missing.");

const page = rootElement.dataset.page;
const component = page === "admin"
  ? <AdminPage />
  : page === "overlay"
    ? <OverlayPage />
    : <PublicEventPage />;

createRoot(rootElement).render(component);
