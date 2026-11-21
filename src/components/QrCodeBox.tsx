import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeBoxProps {
  value: string;
  size?: number;
  label?: string;
  className?: string;
}

export const QrCodeBox: React.FC<QrCodeBoxProps> = ({
  value,
  size = 156,
  label,
  className = "",
}) => {
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setDataUrl("");
      return;
    }
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#0e2922",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className={`rounded-xl border bg-white flex items-center justify-center text-[10px] font-bold text-slate-500 ${className}`}
        style={{ width: size, height: size, borderColor: "#cbd9cf" }}
      >
        QR
      </div>
    );
  }

  return (
    <div
      className={`inline-flex flex-col items-center gap-1.5 p-2.5 rounded-2xl border bg-white shadow-sm ${className}`}
      style={{ borderColor: "#cbd9cf" }}
    >
      <img
        src={dataUrl}
        alt={label || "QR Join Code"}
        width={size}
        height={size}
        className="rounded-lg block"
        style={{ width: size, height: size }}
      />
      {label && (
        <span className="text-[11px] font-bold text-[#153229] text-center leading-tight">
          {label}
        </span>
      )}
    </div>
  );
};
