import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const desktopNodeModules = path.join(__dirname, "node_modules");

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

const appJobs = [
  { src: path.join(root, "backend", "dist"), dest: path.join(__dirname, "backend", "dist") },
  { src: path.join(root, "frontend", "dist"), dest: path.join(__dirname, "frontend", "dist") },
];

for (const job of appJobs) {
  if (!fs.existsSync(job.src)) {
    console.error(`[desktop] AVISO: origem não encontrada em ${job.src}. Rode 'npm run build:backend' e 'npm run build:frontend' antes.`);
    continue;
  }
  copyDir(job.src, job.dest);
  console.log(`[desktop] copiado ${job.src} -> ${job.dest}`);
}

// Copia as dependências de produção reais (do root do monorepo) para dentro do app,
// evitando que o electron-builder resolva a árvore e perca transitivas.
const rootNodeModules = path.join(root, "node_modules");
const productionPackages = new Set();
const extraPackages = [".prisma"];
const workspaceLinks = new Set(["backend", "frontend", "mobieer-desktop"]);
const devOnlyNames = new Set(["typescript", "prisma", "tsx", "vite", "tailwindcss", "postcss", "autoprefixer"]);

function isDevOnly(pkgPath) {
  const rel = path.relative(rootNodeModules, pkgPath);
  const parts = rel.split(path.sep).filter(Boolean);
  const top = parts[0] ?? "";
  if (top === "@types") return true;
  if (top.startsWith("@") && parts.length > 1) {
    const scoped = `${top}/${parts[1]}`;
    if (scoped.includes("vite") || scoped.includes("electron")) return true;
    return false;
  }
  return devOnlyNames.has(top);
}

let tree;
try {
  const raw = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true, stdio: ["ignore", "pipe", "ignore"] });
  tree = raw;
} catch (err) {
  try {
    tree = (err.stdout ?? "").toString();
  } catch {
    tree = "";
  }
}

if (tree) {
  for (const line of String(tree).split(/\r?\n/)) {
    const p = line.trim();
    if (!p) continue;
    const rel = path.relative(rootNodeModules, p);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const top = rel.split(path.sep)[0] ?? "";
    if (workspaceLinks.has(top)) continue;
    if (isDevOnly(p)) continue;
    productionPackages.add(path.normalize(p));
  }
}

console.log(`[desktop] ${productionPackages.size} pacotes de produção detectados`);

let copied = 0;
for (const pkgPath of productionPackages) {
  const rel = path.relative(rootNodeModules, pkgPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
  const dest = path.join(desktopNodeModules, rel);
  if (fs.existsSync(dest)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(pkgPath, dest, { recursive: true });
  copied += 1;
}

for (const extra of extraPackages) {
  const src = path.join(rootNodeModules, extra);
  if (fs.existsSync(src)) {
    const dest = path.join(desktopNodeModules, extra);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    copied += 1;
  }
}

console.log(`[desktop] ${copied} pacotes copiados para node_modules do app`);
