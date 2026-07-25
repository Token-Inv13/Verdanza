import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { storage } from "../lib/firebase";
import {
  PRODUCT_IMAGE_ALLOWED_MIME_TYPES,
  PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES,
  isProductImageStoragePath,
  sanitizeImageId,
} from "../lib/productImages";
import type { ProductImageAsset } from "../types";

export type ProductImageUploadProgress = {
  fileName: string;
  progress: number;
  status: "optimizing" | "uploading" | "done" | "error";
  error?: string;
};

export async function uploadProductImageAsset({
  productId,
  file,
  alt,
  sortOrder,
  isPrimary,
  onProgress,
}: {
  productId: string;
  file: File;
  alt: string;
  sortOrder: number;
  isPrimary: boolean;
  onProgress?: (progress: ProductImageUploadProgress) => void;
}): Promise<ProductImageAsset> {
  if (!storage) throw new Error("Storage Firebase indisponible.");
  const safeProductId = sanitizeImageId(productId);
  if (!safeProductId) throw new Error("Identifiant produit requis avant l'ajout d'image.");
  await assertAcceptedImageFile(file);
  onProgress?.({ fileName: file.name, progress: 0, status: "optimizing" });
  const optimized = await optimizeImageToWebp(file);
  const imageId = `${Date.now().toString(36)}-${randomSegment()}`;
  const storagePath = `products/${safeProductId}/${imageId}.webp`;
  const imageRef = ref(storage, storagePath);
  onProgress?.({ fileName: file.name, progress: 0, status: "uploading" });
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(imageRef, optimized, {
      contentType: "image/webp",
      customMetadata: {
        productId: safeProductId,
      },
    });
    task.on(
      "state_changed",
      (snapshot) => {
        const progress = snapshot.totalBytes
          ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          : 0;
        onProgress?.({ fileName: file.name, progress, status: "uploading" });
      },
      reject,
      () => resolve(),
    );
  });
  const url = await getDownloadURL(imageRef);
  onProgress?.({ fileName: file.name, progress: 100, status: "done" });
  return {
    id: imageId,
    url,
    storagePath,
    alt: alt.trim() || file.name.replace(/\.[^.]+$/, ""),
    sortOrder,
    isPrimary,
  };
}

export async function deleteProductImageByPath(storagePath: string, productId?: string) {
  if (!storage) throw new Error("Storage Firebase indisponible.");
  if (!isProductImageStoragePath(storagePath, productId)) {
    throw new Error("Chemin Storage image invalide.");
  }
  await deleteObject(ref(storage, storagePath));
}

async function assertAcceptedImageFile(file: File) {
  if (file.size > PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES) {
    throw new Error("Image trop volumineuse (8 Mo max).");
  }
  if (!PRODUCT_IMAGE_ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error("Format image refuse. Utilisez JPEG, PNG ou WebP.");
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesDeclaredImageType(file.type, bytes)) {
    throw new Error("Le type reel du fichier ne correspond pas au format annonce.");
  }
}

function matchesDeclaredImageType(type: string, bytes: Uint8Array) {
  if (type === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/webp") {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

async function optimizeImageToWebp(file: File) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Traitement image impossible.");
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.84),
  );
  bitmap.close();
  if (!blob) throw new Error("Conversion WebP impossible avec ce navigateur.");
  return blob;
}

function randomSegment() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
