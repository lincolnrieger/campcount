/**
 * QR decoding from a <video> element. Uses the browser's native
 * BarcodeDetector where it exists (Android Chrome) and falls back to jsQR,
 * loaded on demand, elsewhere (iOS Safari, Firefox).
 */
type Detect = (video: HTMLVideoElement) => Promise<string | null>;

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: { new (opts: { formats: string[] }): BarcodeDetectorLike; getSupportedFormats(): Promise<string[]> };
  }
}

export async function createDetector(): Promise<Detect> {
  if (window.BarcodeDetector) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue ?? null;
        };
      }
    } catch {
      // fall through to jsQR
    }
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // Decode a centred square, downscaled: faster and matches the on-screen guide.
    const side = Math.min(w, h);
    const size = Math.min(side, 640);
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    const image = ctx.getImageData(0, 0, size, size);
    return jsQR(image.data, size, size, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}
