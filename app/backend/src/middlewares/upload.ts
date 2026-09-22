import path from "path";
import fs from "fs";
import multer from "multer";
import { UnsupportedFileTypeError } from "../utils/ApiError";

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
    else cb(new UnsupportedFileTypeError("Arquivo deve ser uma imagem"));
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
    else cb(new UnsupportedFileTypeError("Formato de arquivo não permitido"));
  },
});

// Documentos de projeto: mantidos em memória e repassados à camada de storage
// (disco ou Supabase). Aceita PDF, imagens e documentos de escritório.
export const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || attachmentMimeTypes.has(file.mimetype)) cb(null, true);
    else cb(new UnsupportedFileTypeError("Formato de arquivo não permitido"));
  },
});

// Fotos enviadas pelo cliente (assistência) ou pela equipe — vão para a
// camada de storage (disco/Supabase), então ficam em memória.
export const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new UnsupportedFileTypeError("Envie uma imagem (JPG, PNG, HEIC, ...)"));
  },
});

// Exportação do Promob (orçamento / lista de ambientes). Filtro por extensão:
// o Promob exporta XML, e às vezes o orçamento sai como PDF.
export const uploadPromob = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xml|pdf|json|txt|promob)$/i.test(file.originalname)) cb(null, true);
    else cb(new UnsupportedFileTypeError("Envie o arquivo exportado do Promob (.xml ou .pdf)"));
  },
});

// Arquivos de dados (ex.: exportação do relógio de ponto): CSV/TXT/AFD.
// Filtro por extensão, pois relógios baratos mandam mimetypes inconsistentes.
export const uploadDataFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(csv|txt|afd|dat|xls|xlsx|tsv)$/i.test(file.originalname)) cb(null, true);
    else cb(new UnsupportedFileTypeError("Envie um arquivo .csv, .txt ou .afd exportado do aparelho"));
  },
});

// Mídia da obra (diário de montagem): foto, vídeo curto e PDF.
// Atenção: na Vercel o corpo da requisição tem limite de ~4,5MB, então vídeo
// longo não passa por aqui — a tela avisa e comprime as fotos antes de enviar.
const MEDIA_MIME = /^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime|webm|3gpp)|application\/pdf)$/;
export const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (MEDIA_MIME.test(file.mimetype)) cb(null, true);
    else cb(new UnsupportedFileTypeError("Envie foto, vídeo (mp4/mov/webm) ou PDF"));
  },
});
