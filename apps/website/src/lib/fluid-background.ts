type FluidBlob = {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
  driftX: number;
  driftY: number;
  phase: number;
  wobble: number;
  squashX: number;
  squashY: number;
};

const colors = ["238, 11, 0", "0, 238, 238", "6, 18, 24", "42, 43, 47"];
const motionSpeed = 0.1;

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const makeNoisePattern = (ctx: CanvasRenderingContext2D) => {
  const size = 180;
  const noise = document.createElement("canvas");
  noise.width = size;
  noise.height = size;

  const noiseCtx = noise.getContext("2d");
  if (!noiseCtx) return null;

  const image = noiseCtx.createImageData(size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.random() > 0.52 ? 255 : 0;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = Math.floor(randomBetween(18, 42));
  }

  noiseCtx.putImageData(image, 0, 0);
  return ctx.createPattern(noise, "repeat");
};

const createBlobs = (width: number, height: number, isMobile: boolean): FluidBlob[] => {
  const count = isMobile ? 7 : 9;
  const sideBias = Math.random() > 0.5 ? -0.16 : 0.72;

  return Array.from({ length: count }, (_, index) => {
    const color = colors[index % colors.length];
    const radius = randomBetween(width * 0.16, width * (isMobile ? 0.32 : 0.26));

    return {
      x: width * (index < 5 ? sideBias + randomBetween(-0.08, 0.32) : randomBetween(0.08, 0.86)),
      y: height * randomBetween(-0.08, 1.08),
      radius,
      color,
      alpha:
        color === "6, 18, 24"
          ? randomBetween(0.18, 0.3)
          : color === "0, 238, 238"
            ? randomBetween(0.16, 0.28)
            : randomBetween(0.14, 0.26),
      driftX: randomBetween(-0.026, 0.026) * motionSpeed,
      driftY: randomBetween(-0.022, 0.022) * motionSpeed,
      phase: randomBetween(0, Math.PI * 2),
      wobble: randomBetween(0.002, 0.006) * motionSpeed,
      squashX: randomBetween(0.95, 1.18),
      squashY: randomBetween(0.78, 1.04)
    };
  });
};

export const initFluidBackground = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return () => undefined;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)");
  let blobs: FluidBlob[] = [];
  let pattern: CanvasPattern | null = null;
  let raf = 0;
  let lastFrame = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let width = 0;
  let height = 0;
  let isTouchViewport = false;

  const getViewport = () => {
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    const nextIsTouchViewport = coarsePointer.matches || nextWidth < 700;
    const screenHeight = window.screen ? window.screen.height : nextHeight;

    return {
      width: nextWidth,
      height: nextIsTouchViewport ? Math.max(nextHeight, viewportHeight, screenHeight) : nextHeight,
      isMobile: nextWidth < 700,
      isTouch: nextIsTouchViewport
    };
  };

  const resize = (force = false) => {
    const nextViewport = getViewport();
    const widthChanged = Math.abs(nextViewport.width - viewportWidth) > 8;
    const heightChanged = Math.abs(nextViewport.height - viewportHeight) > 8;

    if (!force && nextViewport.isTouch && !widthChanged) {
      canvas.style.width = `${nextViewport.width}px`;
      canvas.style.height = `${viewportHeight || nextViewport.height}px`;
      return false;
    }

    if (!force && !widthChanged && !heightChanged) return false;

    viewportWidth = nextViewport.width;
    viewportHeight = nextViewport.height;
    isTouchViewport = nextViewport.isTouch;

    const scale = nextViewport.isMobile ? 0.42 : 0.5;
    width = Math.max(320, Math.floor(viewportWidth * scale));
    height = Math.max(560, Math.floor(viewportHeight * scale));

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;

    blobs = createBlobs(width, height, nextViewport.isMobile);
    pattern = makeNoisePattern(ctx);
    return true;
  };

  const drawBlob = (blob: FluidBlob, time: number) => {
    const wave = Math.sin(time * blob.wobble + blob.phase);
    const x = blob.x + Math.sin(time * blob.wobble * 0.67 + blob.phase) * width * 0.09;
    const y = blob.y + Math.cos(time * blob.wobble * 0.81 + blob.phase) * height * 0.08;
    const radius = blob.radius * (1 + wave * 0.13);
    const gradient = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius);

    gradient.addColorStop(0, `rgba(${blob.color}, ${blob.alpha})`);
    gradient.addColorStop(0.56, `rgba(${blob.color}, ${blob.alpha * 0.64})`);
    gradient.addColorStop(1, `rgba(${blob.color}, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * blob.squashX, radius * blob.squashY, wave * 0.4, 0, Math.PI * 2);
    ctx.fill();

    blob.x += blob.driftX;
    blob.y += blob.driftY;

    if (blob.x < -radius) blob.x = width + radius * 0.42;
    if (blob.x > width + radius) blob.x = -radius * 0.42;
    if (blob.y < -radius) blob.y = height + radius * 0.42;
    if (blob.y > height + radius) blob.y = -radius * 0.42;
  };

  const render = (time = 0) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.filter = `blur(${Math.round(width * 0.036)}px)`;
    ctx.globalCompositeOperation = "multiply";
    blobs.forEach((blob) => drawBlob(blob, time));
    ctx.restore();

    if (pattern) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.44;
    ctx.fillStyle = "rgba(255, 255, 255, 0.48)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  };

  const animate = (time: number) => {
    if (time - lastFrame > 45) {
      render(time);
      lastFrame = time;
    }

    raf = window.requestAnimationFrame(animate);
  };

  const start = () => {
    window.cancelAnimationFrame(raf);
    if (reducedMotion.matches || isTouchViewport) {
      render(0);
      return;
    }
    raf = window.requestAnimationFrame(animate);
  };

  const handleResize = () => {
    const changed = resize();
    if (changed) start();
  };

  const handleVisibility = () => {
    if (document.hidden) window.cancelAnimationFrame(raf);
    else start();
  };

  resize(true);
  start();
  window.addEventListener("resize", handleResize);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    window.cancelAnimationFrame(raf);
    window.removeEventListener("resize", handleResize);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
};
