import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import * as productsService from "./products.service";
import { productListQuery, productSchema } from "./products.schema";

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const q = productListQuery.parse(req.query);
  const result = await productsService.listProducts(q);
  return res.json({ success: true, data: result.items, meta: result.meta });
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProduct(req.params.id);
  return ok(res, product);
});

export const getProductByCode = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductByCode(req.params.code);
  return ok(res, product);
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const input = productSchema.parse(req.body);
  const product = await productsService.createProduct(input, req.user!.id);
  return ok(res, product, "Produto cadastrado com sucesso");
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const input = productSchema.partial().parse(req.body);
  const product = await productsService.updateProduct(req.params.id, input, req.user!.id);
  return ok(res, product, "Produto atualizado com sucesso");
});

export const updateProductImage = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ success: false, message: "Imagem obrigatória" });
  const product = await productsService.setProductImage(
    req.params.id,
    `/uploads/${file.filename}`,
    req.user!.id
  );
  return ok(res, product, "Imagem atualizada");
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  const result = await productsService.deleteProduct(req.params.id, req.user!.id);
  return ok(res, result, "Produto removido");
});
