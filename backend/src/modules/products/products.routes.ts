import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadImage } from "../../middlewares/upload";
import * as productsController from "./products.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("products.read"), productsController.listProducts);
router.get("/by-code/:code", requirePermission("products.read"), productsController.getProductByCode);
router.get("/:id", requirePermission("products.read"), productsController.getProduct);
router.post("/", requirePermission("products.create"), productsController.createProduct);
router.put("/:id", requirePermission("products.update"), productsController.updateProduct);
router.post("/:id/image", requirePermission("products.update"), uploadImage.single("image"), productsController.updateProductImage);
router.delete("/:id", requirePermission("products.delete"), productsController.deleteProduct);

export default router;
