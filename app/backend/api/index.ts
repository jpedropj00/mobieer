import { createApp } from "../src/app";

// O Express é exportado sem abrir uma porta; o Vercel gerencia o ciclo HTTP.
export default createApp();
