import { Router } from "express";
import { DISCOVERY_CHANNELS, ENVIRONMENTS } from "./briefing.service";

/**
 * Briefing do cliente.
 *
 * O envio anônimo foi substituído pelo cadastro curto no portal
 * (/api/portal/auth/signup + /api/portal/briefing): o cliente cria o acesso com
 * nome, e-mail, CPF e senha, e responde o briefing logado — assim consegue
 * voltar, completar e acompanhar. Aqui ficam só as opções do formulário.
 */
const router = Router();

// GET /api/briefing/meta
router.get("/meta", (_req, res) =>
  res.json({ success: true, data: { environments: ENVIRONMENTS, discoveryChannels: DISCOVERY_CHANNELS } })
);

export default router;
