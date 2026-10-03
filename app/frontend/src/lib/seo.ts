/**
 * Título, descrição e indexação por rota. Só as páginas públicas de entrada
 * (login da loja, portal do cliente e cadastro) podem aparecer no Google;
 * todo o resto é área interna ou link pessoal e fica com noindex.
 */
export const SITE_URL = "https://mobieerprojetos.com.br";
const SITE_NAME = "Mobieer Planejados";
const DEFAULT_DESCRIPTION =
  "Mobieer Planejados — móveis planejados sob medida. Acompanhe seu projeto, medição, produção, montagem e pagamentos pelo portal do cliente.";

type PageMeta = { title: string; description?: string };

export const PUBLIC_PAGES: Record<string, PageMeta> = {
  "/login": { title: `${SITE_NAME} — Móveis planejados sob medida` },
  "/portal/login": {
    title: `Portal do cliente — ${SITE_NAME}`,
    description: "Entre no portal do cliente Mobieer para acompanhar seu projeto de móveis planejados: medição, aprovação, produção, montagem e pagamentos.",
  },
  "/portal/cadastro": {
    title: `Comece seu projeto — ${SITE_NAME}`,
    description: "Cadastre-se e conte como é o seu espaço. A equipe da Mobieer Planejados prepara o projeto dos seus móveis sob medida.",
  },
};

export function metaFor(pathname: string): PageMeta & { index: boolean; canonical: string } {
  const path = pathname.replace(/\/+$/, "") || "/";
  const page = PUBLIC_PAGES[path];
  if (page) return { ...page, index: true, canonical: `${SITE_URL}${path === "/login" ? "/" : path}` };
  return { title: SITE_NAME, index: false, canonical: `${SITE_URL}/` };
}

function setMeta(selector: string, attr: string, value: string) {
  document.head.querySelector(selector)?.setAttribute(attr, value);
}

export function applySeo(pathname: string) {
  const m = metaFor(pathname);
  const description = m.description ?? DEFAULT_DESCRIPTION;
  document.title = m.title;
  setMeta('meta[name="description"]', "content", description);
  setMeta('meta[name="robots"]', "content", m.index ? "index, follow" : "noindex, nofollow");
  setMeta('link[rel="canonical"]', "href", m.canonical);
  setMeta('meta[property="og:title"]', "content", m.title);
  setMeta('meta[property="og:description"]', "content", description);
  setMeta('meta[property="og:url"]', "content", m.canonical);
}
