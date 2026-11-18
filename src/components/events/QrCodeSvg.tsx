import { useMemo } from "react";
import QRCode from "qrcode";
import { QR_BADGE_COLORS } from "@/constants/colors";
import { cn } from "@/lib/utils";

export interface QrCodeSvgProps {
  value: string;
  size?: number;
  margin?: number;
  className?: string;
  title?: string;
}

/**
 * Renderiza um QR Code vetorial síncrono com contraste máximo (21:1)
 * adequado tanto para leitura por câmera em tela quanto impressão A4.
 */
export function QrCodeSvg({
  value,
  size = 128,
  margin = 2,
  className,
  title = "QR Code de credenciamento",
}: QrCodeSvgProps) {
  const { totalSize, pathData } = useMemo(() => {
    const safeValue = value.trim() || "invalid";
    const qr = QRCode.create(safeValue, { errorCorrectionLevel: "M" });
    const moduleCount = qr.modules.size;
    const fullSize = moduleCount + margin * 2;
    const segments: string[] = [];

    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        if (qr.modules.get(row, col)) {
          segments.push(`M${col + margin},${row + margin}h1v1h-1z`);
        }
      }
    }

    return {
      totalSize: fullSize,
      pathData: segments.join(""),
    };
  }, [value, margin]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${totalSize} ${totalSize}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
      className={cn("block shrink-0 select-none", className)}
    >
      <title>{title}</title>
      <rect
        width={totalSize}
        height={totalSize}
        fill={QR_BADGE_COLORS.qrLight}
      />
      <path d={pathData} fill={QR_BADGE_COLORS.qrDark} />
    </svg>
  );
}
