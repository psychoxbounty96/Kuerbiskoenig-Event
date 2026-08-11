import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const projectRoot = resolve(process.cwd());
const outputRoot = resolve(projectRoot, "..", "KUERBISKOENIG_DEPLOYMENT_KIT");
const allowedParent = `${resolve(projectRoot, "..")}${sep}`;

if (!`${outputRoot}${sep}`.startsWith(allowedParent) || basename(outputRoot) !== "KUERBISKOENIG_DEPLOYMENT_KIT") {
  throw new Error("Unsicheres Deployment-Kit-Ziel abgelehnt.");
}

const sourceFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: projectRoot,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.includes("~lock.") && !file.startsWith("github-pages-dist/"))
  .filter((file) => file !== "docs/SUPABASE_SETUP.md");

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const githubRoot = join(outputRoot, "01_GITHUB_REPOSITORY");
for (const file of sourceFiles) {
  const source = join(projectRoot, file);
  if (!existsSync(source)) continue;
  const destination = join(githubRoot, file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

const supabaseRoot = join(outputRoot, "02_SUPABASE_BACKEND");
mkdirSync(supabaseRoot, { recursive: true });
cpSync(join(projectRoot, "supabase"), join(supabaseRoot, "supabase"), { recursive: true });
cpSync(join(projectRoot, ".env.example"), join(supabaseRoot, ".env.example"));
cpSync(join(projectRoot, "deployment/supabase/README.md"), join(supabaseRoot, "README.md"));

const widgetRoot = join(outputRoot, "03_STREAMELEMENTS_WIDGET");
cpSync(join(projectRoot, "streamelements-widget"), widgetRoot, { recursive: true });
cpSync(join(projectRoot, "deployment/START_HIER.md"), join(outputRoot, "START_HIER.md"));

const manifest = {
  createdAt: new Date().toISOString(),
  source: relative(resolve(projectRoot, ".."), projectRoot),
  folders: {
    github: "01_GITHUB_REPOSITORY",
    supabase: "02_SUPABASE_BACKEND",
    streamelements: "03_STREAMELEMENTS_WIDGET",
  },
};
writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(outputRoot);
