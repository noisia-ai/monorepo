"use client";

import { useEffect, useRef } from "react";
import { initFluidBackground } from "@/lib/fluid-background";

export function FluidBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    return initFluidBackground(canvasRef.current);
  }, []);

  return <canvas ref={canvasRef} className="fluid-background" aria-hidden="true" />;
}
