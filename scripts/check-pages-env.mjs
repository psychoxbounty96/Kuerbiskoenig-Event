const required = ["VITE_EVENT_SLUG", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.error(`Fehlende GitHub Repository Variables: ${missing.join(", ")}`);
  process.exit(1);
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(process.env.VITE_SUPABASE_URL)) {
  console.error("VITE_SUPABASE_URL ist keine gültige Supabase-Projekt-URL.");
  process.exit(1);
}

console.log("GitHub Pages configuration is complete.");
