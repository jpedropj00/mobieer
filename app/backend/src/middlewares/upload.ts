import path from "path";
import fs from "fs";
import multer from "multer";

// Vercel Functions têm filesystem somente-leitura; /tmp é o espaço gravável.
const uploadDir = process.env.VERCEL ? path.join("/tmp", "uploads") : path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  },
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Arquivo deve ser uma imagem"));
  },
});

const attachmentMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

export const uploadAttachment = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || attachmentMimeTypes.has(file.mimetype)) cb(null, true);
    else cb(new Error("Formato de arquivo não permitido"));
  },
});

// Documentos de projeto: mantidos em memória e repassados à camada de storage
// (disco ou Supabase). Aceita PDF, imagens e documentos de escritório.
export const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || attachmentMimeTypes.has(file.mimetype)) cb(null, true);
    else cb(new Error("Formato de arquivo não permitido"));
  },
});

// Arquivos de dados (ex.: exportação do relógio de ponto): CSV/TXT/AFD.
// Filtro por extensão, pois relógios baratos mandam mimetypes inconsistentes.
export const uploadDataFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(csv|txt|afd|dat|xls|xlsx|tsv)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Envie um arquivo .csv, .txt ou .afd exportado do aparelho"));
  },
});
