import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: false,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
});

export async function presignPut(key: string, contentType: string) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType }), {
    expiresIn: 600,
  });
}

const urlCache = new Map<string, { day: number; url: string }>();

/**
 * URL de leitura para uma foto. A assinatura usa o início do dia (UTC) como data,
 * por isso o URL é estável durante o dia e o browser pode guardar a imagem em cache.
 */
export async function photoUrl(key: string | null | undefined) {
  if (!key) return null;
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = urlCache.get(key);
  if (hit && hit.day === day) return hit.url;
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), {
    expiresIn: 2 * 86_400,
    signingDate: new Date(day * 86_400_000),
  });
  urlCache.set(key, { day, url });
  return url;
}

/** Junta `photoUrl` a cada linha que tenha `photoKey`. */
export async function withPhotos<T extends { photoKey?: string | null }>(rows: T[]) {
  return Promise.all(rows.map(async (r) => ({ ...r, photoUrl: await photoUrl(r.photoKey) })));
}

/** URL de leitura (1 h) para um ficheiro, aberto no browser com o nome original. */
export async function fileUrl(key: string | null | undefined, filename?: string | null) {
  if (!key) return null;
  const name = (filename || "documento.pdf").replace(/["\\\r\n]/g, "");
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    }),
    { expiresIn: 3600 },
  );
}

/** Apaga um ficheiro do armazenamento (erros são ignorados: o registo já foi atualizado). */
export async function deleteObject(key: string | null | undefined) {
  if (!key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  } catch (e) {
    console.error("Falha ao apagar", key, e);
  }
}
