/**
 * Photos are shrunk in the browser before upload, so a phone picture goes up in a moment on
 * mobile data. WebP where the browser can write it; JPEG otherwise (older Safari returns PNG).
 */
export async function shrinkPhoto(f: File, { maxSide = 800, maxBytes = 400_000 } = {}): Promise<{ data: string }> {
  if (!f.type.startsWith('image/')) throw new Error('Choose a photo');
  const bitmap = await createImageBitmap(f);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // base64 is a third larger than the file it holds.
  const limit = (maxBytes * 4) / 3;
  let url = canvas.toDataURL('image/webp', 0.82);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
  for (let q = 0.75; url.length > limit && q > 0.3; q -= 0.15) url = canvas.toDataURL('image/jpeg', q);
  if (url.length > limit) throw new Error('That photo is too large even after shrinking. Try a smaller one.');
  return { data: url.slice(url.indexOf(',') + 1) };
}
