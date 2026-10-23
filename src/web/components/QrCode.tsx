import qrcode from 'qrcode-generator';

/** QR code rendered as a single SVG path (crisp at any print size). */
export function QrCode({ value, size, label }: { value: string; size: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
    }
  }
  const box = count + 8; // four-module quiet zone, as the standard requires
  return (
    <svg viewBox={`0 0 ${box} ${box}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
