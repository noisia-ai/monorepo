"use client";

import Image from "next/image";
import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import {
  siAppstore,
  siDiscourse,
  siFacebook,
  siGoogle,
  siInstagram,
  siReddit,
  siTiktok,
  siTrustpilot,
  siX,
  siYoutube
} from "simple-icons";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Button } from "@/components/ui/Button";
import { MethodologyChip } from "@/components/ui/MethodologyIcon";
import {
  heroMethodologyMetrics,
  heroPipelineSteps,
  heroRecommendations,
  heroSignature,
  heroStateRead,
  heroVoiceCards
} from "@/components/home/heroScrollyData";
import styles from "@/components/home/HeroScrollytelling.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const desktopDrift = [
  { x: 52, y: 90, r: 3 },
  { x: -54, y: 76, r: -4 },
  { x: 36, y: -28, r: 2 },
  { x: -48, y: -22, r: -3 },
  { x: 22, y: -72, r: 2 },
  { x: -24, y: -88, r: -2 },
  { x: 58, y: -64, r: 5 },
  { x: -62, y: 48, r: -5 }
];

const mobilePositions = [
  { x: "-29vw", y: "-30vh", r: "-7deg" },
  { x: "28vw", y: "-24vh", r: "7deg" },
  { x: "-30vw", y: "-5vh", r: "-6deg" },
  { x: "30vw", y: "1vh", r: "6deg" }
];

const channelStyles = {
  "App Store": { icon: siAppstore, accent: "#0d96f6", accent2: "#7cc4ff" },
  Facebook: { icon: siFacebook, accent: "#1877f2", accent2: "#8cc7ff" },
  Foro: { icon: siDiscourse, accent: "#00abb5", accent2: "#67d7de" },
  "Google Reviews": { icon: siGoogle, accent: "#4285f4", accent2: "#34a853" },
  Instagram: { icon: siInstagram, accent: "#e4405f", accent2: "#f77737" },
  Reddit: { icon: siReddit, accent: "#ff4500", accent2: "#ff9a64" },
  TikTok: { icon: siTiktok, accent: "#111111", accent2: "#00f2ea" },
  Trustpilot: { icon: siTrustpilot, accent: "#00b67a", accent2: "#73dfbd" },
  X: { icon: siX, accent: "#111111", accent2: "#777777" },
  YouTube: { icon: siYoutube, accent: "#ff0033", accent2: "#ff8a8a" }
};

function getChannelStyle(platform: string) {
  return channelStyles[platform as keyof typeof channelStyles] ?? channelStyles.Foro;
}

export function HeroScrollytelling() {
  const rootRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const minimumFrame = window.setTimeout(() => {
      if (isMounted) {
        setIsLoaded(true);
      }
    }, 920);

    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready
      ?.then(() => {
        window.setTimeout(() => {
          if (isMounted) {
            setIsLoaded(true);
          }
        }, 720);
      })
      .catch(() => {
        if (isMounted) {
          setIsLoaded(true);
        }
      });

    return () => {
      isMounted = false;
      window.clearTimeout(minimumFrame);
    };
  }, []);

  useGSAP(
    () => {
      const root = rootRef.current;
      const stage = stageRef.current;

      if (!root || !stage) {
        return undefined;
      }

      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (prefersReducedMotion) {
        gsap.set(".scrollyScene", { clearProps: "all" });
        gsap.set(".scrollyScene:not(.scrollyIntro)", { position: "relative", opacity: 1 });
        return undefined;
      }

      const mm = gsap.matchMedia();

      // Universal: hero behaves like the rest of the site.
      // - Intro noise cards: slow theatrical idle reveal on page load, then scroll-coupled drift outward.
      // - Acts 02, 03, 04: one-shot onEnter timelines. Reveal forward, stay revealed (like data-reveal sections).
      mm.add("all", () => {
        // Initial states
        gsap.set(".scrollyScene", { clearProps: "opacity,y,scale,filter,position,transform" });
        gsap.set(".scrollyNoiseCard", { autoAlpha: 0, scale: 0.94, filter: "blur(5px)" });
        gsap.set(".scrollyScene:not(.scrollyIntro)", { opacity: 0, y: 32, filter: "blur(4px)" });
        gsap.set(".scrollyFill", { scaleX: 0, transformOrigin: "left center" });
        gsap.set(".scrollyPipelineRailFill", { scaleY: 0, transformOrigin: "top center" });
        gsap.set(".scrollyPipelineRow, .scrollyMetricCard, .scrollyStateRow, .scrollyRecommendation, .scrollyStat", {
          opacity: 0,
          y: 18
        });
        gsap.set(".scrollySignalChip", { opacity: 0, y: 22, scale: 0.94 });
        gsap.set(".scrollyPipelineOutcome", { opacity: 0, y: 20 });

        // 1) Theatrical idle reveal of noise cards — one by one from center outward.
        // Total reveal time ≈ 1.0s delay + (12 cards × 0.5s stagger) ≈ 6.5s
        const idleReveal = gsap.to(".scrollyNoiseCard", {
          autoAlpha: 1,
          scale: 1,
          filter: "blur(0px)",
          duration: 0.85,
          delay: 1.0,
          stagger: { each: 0.5, from: "center" },
          ease: "power2.out"
        });

        const triggers: ScrollTrigger[] = [];

        // 2) Scroll-coupled drift — cards fly OUTWARD from origin on scroll down,
        //    return INWARD on scroll up. Bidirectional scrub. Amplified ~4x for visibility.
        triggers.push(
          ScrollTrigger.create({
            trigger: ".scrollyIntro",
            start: "top top",
            end: "bottom 30%",
            scrub: 1.0,
            animation: gsap.to(".scrollyNoiseCard", {
              x: (index) => desktopDrift[index % desktopDrift.length].x * 4.5,
              y: (index) => desktopDrift[index % desktopDrift.length].y * 4.5,
              rotate: (index) => desktopDrift[index % desktopDrift.length].r * 2,
              autoAlpha: 0,
              filter: "blur(8px)",
              scale: 0.82,
              stagger: { each: 0.012, from: "center" },
              ease: "none"
            })
          })
        );

        // 3) Acts 02, 03, 04: one-shot onEnter reveals. Plays forward at fixed pace,
        //    no scrub, no reverse. Mirrors how `[data-reveal]` sections enter.
        const buildSceneTimeline = (sceneSel: string) => {
          const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
          tl.to(sceneSel, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.65 });

          const child = (s: string) => `${sceneSel} ${s}`;

          if (sceneSel === ".scrollyPipeline") {
            tl.to(child(".scrollySignalChip"), { opacity: 1, y: 0, scale: 1, stagger: 0.035, duration: 0.42 }, "-=0.42");
            tl.to(child(".scrollyPipelineRailFill"), { scaleY: 1, duration: 0.55, ease: "none" }, "-=0.32");
            tl.to(child(".scrollyPipelineRow"), { opacity: 1, y: 0, stagger: 0.05, duration: 0.4 }, "-=0.42");
            tl.to(child(".scrollyFill"), { scaleX: 1, stagger: 0.04, duration: 0.5, ease: "none" }, "-=0.3");
            tl.to(child(".scrollyPipelineOutcome"), { opacity: 1, y: 0, duration: 0.42 }, "-=0.32");
          } else if (sceneSel === ".scrollyMethod") {
            tl.to(child(".scrollyMetricCard"), { opacity: 1, y: 0, stagger: 0.06, duration: 0.42 }, "-=0.42");
            tl.to(child(".scrollyFill"), { scaleX: 1, stagger: 0.04, duration: 0.5, ease: "none" }, "-=0.3");
            tl.to(child(".scrollyStateRow"), { opacity: 1, y: 0, stagger: 0.06, duration: 0.4 }, "-=0.35");
          } else {
            tl.to(child(".scrollyRecommendation"), { opacity: 1, y: 0, stagger: 0.06, duration: 0.45 }, "-=0.42");
            tl.to(child(".scrollyStat"), { opacity: 1, y: 0, stagger: 0.05, duration: 0.35 }, "-=0.3");
          }
          return tl;
        };

        [".scrollyPipeline", ".scrollyMethod", ".scrollyDecision"].forEach((sceneSel) => {
          triggers.push(
            ScrollTrigger.create({
              trigger: sceneSel,
              start: "top 82%",
              once: true,
              onEnter: () => {
                buildSceneTimeline(sceneSel);
              }
            })
          );
        });

        return () => {
          idleReveal.kill();
          triggers.forEach((t) => t.kill());
        };
      });

      const refreshId = window.setTimeout(() => {
        ScrollTrigger.refresh();
      }, 120);

      return () => {
        window.clearTimeout(refreshId);
        mm.revert();
      };
    },
    { scope: rootRef }
  );

  return (
    <section className={styles.heroSection} ref={rootRef}>
      <div className={`${styles.loader} ${isLoaded ? styles.loaderHidden : ""}`} aria-hidden={isLoaded ? true : undefined}>
        <div className={styles.loaderMark}>
          <Image
            className={styles.loaderBlue}
            src="/assets/logos/noisia-blue.svg"
            alt=""
            width={169}
            height={47}
            priority
            unoptimized
          />
          <Image
            className={styles.loaderRed}
            src="/assets/logos/noisia-red.svg"
            alt=""
            width={169}
            height={47}
            priority
            unoptimized
          />
          <span className={styles.loaderBar} />
        </div>
      </div>
      <div className={styles.stage} ref={stageRef}>
        <div className={`${styles.scene} ${styles.introScene} scrollyScene scrollyIntro`}>
          <div className={styles.noiseField} aria-hidden="true">
            {heroVoiceCards.map((voice, index) => {
              const mobile = mobilePositions[index % mobilePositions.length];
              const channel = getChannelStyle(voice.platform);

              return (
                <article
                  className={`${styles.noiseCard} scrollyNoiseCard glass`}
                  key={`${voice.platform}-${voice.quote}`}
                  style={
                    {
                      "--card-x": voice.position.x,
                      "--card-y": voice.position.y,
                      "--card-r": voice.position.rotate,
                      "--mobile-card-x": mobile.x,
                      "--mobile-card-y": mobile.y,
                      "--mobile-card-r": mobile.r,
                      "--channel-accent": channel.accent,
                      "--channel-accent-2": channel.accent2
                    } as CSSProperties
                  }
                >
                  <div className={styles.noiseCardInner}>
                    <div className={styles.voiceMeta}>
                      <span className={styles.voicePlatform}>
                        <svg className={styles.voiceIcon} viewBox="0 0 24 24" aria-hidden="true">
                          <path d={channel.icon.path} />
                        </svg>
                        {voice.platform}
                      </span>
                      <span>
                        {voice.market} · {voice.age}
                      </span>
                    </div>
                    <p>{voice.quote}</p>
                  </div>
                </article>
              );
            })}
          </div>

          <div className={styles.introContent}>
            <span className={`${styles.eyebrow} scrollyIntroCopy`}>ACTO 01 · INTELIGENCIA SOCIAL APLICADA</span>
            <h1 className={`display-xl ${styles.heroTitle} scrollyIntroCopy`}>
              Convertimos ruido social en decisiones que defiendes con evidencia.
            </h1>
            <p className={`body-lg ${styles.heroLead} scrollyIntroCopy`}>
              Diseñamos un protocolo a la medida de tu pregunta. Construimos el corpus, codificamos con seis metodologías propietarias y entregamos trazabilidad de cada hallazgo hasta la fuente. Foundation, Intelligence o Strategy — el tier lo define la decisión.
            </p>
            <div className={`${styles.heroActions} scrollyIntroActions`}>
              <Button href="/diagnostico" icon={<ArrowRight size={17} strokeWidth={1.8} />}>
                Iniciar diagnóstico
              </Button>
              <Button href="/metodologias" variant="secondary">
                Ver metodologías
              </Button>
            </div>
            <span className={`${styles.scrollPrompt} scrollyIntroPrompt`}>Scroll para ordenar la conversación</span>
          </div>
        </div>

        <div className={`${styles.scene} ${styles.pipelineScene} scrollyScene scrollyPipeline`}>
          <div className={styles.storyHeading}>
            <span className={styles.eyebrow}>ACTO 02 · EL SISTEMA</span>
            <h2 className="display-lg">Tu equipo no necesita más datos. Necesita un sistema.</h2>
            <p className="body-lg">
              Cada señal entra con contexto, se compacta en un corpus comparable y avanza por seis pasos que dejan rastro.
            </p>
          </div>

          <div className={`${styles.pipelinePanel} glass`}>
            <div className={styles.pipelinePanelHeader}>
              <span>Pipeline Noisia</span>
              <strong>Procesando 2,847 señales · México</strong>
            </div>

            <div className={styles.pipelineNarrative}>
              <div className={styles.signalStack}>
                <div className={styles.signalStackHeader}>
                  <span>Señales compactadas</span>
                  <strong>Corpus vivo</strong>
                </div>
                <div className={styles.signalCloud} aria-hidden="true">
                  {heroVoiceCards.slice(0, 16).map((voice, index) => {
                    const channel = getChannelStyle(voice.platform);

                    return (
                      <span
                        className={`${styles.signalChip} scrollySignalChip`}
                        key={`pipeline-${voice.platform}-${index}`}
                        style={
                          {
                            "--channel-accent": channel.accent,
                            "--channel-accent-2": channel.accent2
                          } as CSSProperties
                        }
                      >
                        <svg className={styles.signalIcon} viewBox="0 0 24 24" aria-hidden="true">
                          <path d={channel.icon.path} />
                        </svg>
                        <span>{voice.platform}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className={styles.pipelineFlow}>
                <div className={styles.pipelineRail} aria-hidden="true">
                  <span className={`${styles.pipelineRailFill} scrollyPipelineRailFill`} />
                </div>
                <div className={styles.pipelineList}>
                  {heroPipelineSteps.map((step, index) => (
                    <div className={`${styles.pipelineRow} scrollyPipelineRow`} key={step.label}>
                      <div className={styles.pipelineIndex}>{String(index + 1).padStart(2, "0")}</div>
                      <div className={styles.pipelineBody}>
                        <div className={styles.pipelineLabels}>
                          <strong>{step.label}</strong>
                          <span>{step.detail}</span>
                        </div>
                        <div className={styles.pipelineMetric}>
                          <em>{step.metric}</em>
                          <div className={styles.pipelineBarTrack}>
                            <span className={`${styles.pipelineFill} scrollyFill`} style={{ width: step.fill }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`${styles.pipelineOutcome} scrollyPipelineOutcome`}>
                <span>Decisión lista</span>
                <strong>Insight trazable</strong>
                <p>La conversación deja de ser volumen y se vuelve una base defendible para aplicar método.</p>
              </div>
            </div>
          </div>
        </div>

        <div className={`${styles.scene} ${styles.methodScene} scrollyScene scrollyMethod`}>
          <div className={styles.methodologyHead}>
            <span className={styles.eyebrow}>ACTO 03 · LA METODOLOGÍA EN ACCIÓN</span>
            <span className={styles.methodologyKicker}>
              Triggers &amp; Barriers · Banca digital LATAM
            </span>
            <h2 className={`display-lg ${styles.methodologyTitle}`}>
              Lo que mueve la decisión y lo que la frena no es lo mismo en cada mercado.
            </h2>
            <p className={`body-lg ${styles.methodologyLead}`}>
              Aplicamos Triggers &amp; Barriers sobre un caso ilustrativo. Cada cifra apunta a evidencia codificable; cada lectura territorial revela dónde la fricción se organiza primero — y por tanto dónde conviene mover el mensaje, el producto o el precio.
            </p>
            <div className={styles.methodologyChips}>
              <MethodologyChip identifier="Triggers & Barriers" />
              <MethodologyChip identifier="Decision Velocity" />
            </div>
          </div>

          <div className={styles.methodologyGrid}>
            <div className={styles.matrixGrid}>
              {heroMethodologyMetrics.map((metric) => (
                <article className={`${styles.matrixCard} scrollyMetricCard`} key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <div className={styles.metricTrack}>
                    <span
                      className={`${styles.metricFill} scrollyFill ${
                        metric.tone === "tension" ? styles.metricFillTension : styles.metricFillSignal
                      }`}
                      style={{ width: metric.value }}
                    />
                  </div>
                </article>
              ))}
            </div>

            <div className={styles.statePanel}>
              <div className={styles.stateHeader}>
                <strong>Lectura territorial</strong>
                <span>Dónde la fricción se organiza más rápido</span>
              </div>
              <div className={styles.stateList}>
                {heroStateRead.map((item) => (
                  <div className={`${styles.stateRow} scrollyStateRow`} key={item.state}>
                    <div>
                      <strong>{item.state}</strong>
                      <span>{item.label}</span>
                    </div>
                    <div className={styles.stateBarTrack}>
                      <span className={`${styles.stateBar} scrollyFill`} style={{ width: `${item.share}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={`${styles.scene} ${styles.decisionScene} scrollyScene scrollyDecision`}>
          <div className={styles.decisionTop}>
            <span className={styles.eyebrow}>ACTO 04 · LA DECISIÓN</span>
            <h2 className="display-lg">Vemos lo que tu marca dice. Lo organizamos. Lo convertimos en decisión.</h2>
            <p className={`body-lg ${styles.decisionCopy}`}>
              Lo que empieza como ruido termina como tres movimientos que un comité puede ejecutar con evidencia.
            </p>
          </div>

          <div className={styles.recommendationGrid}>
            {heroRecommendations.map((recommendation) => (
              <article className={`${styles.recommendationCard} scrollyRecommendation glass`} key={recommendation.title}>
                <span className={styles.recommendationMove}>{recommendation.move}</span>
                <h3>{recommendation.title}</h3>
                <p>{recommendation.body}</p>
              </article>
            ))}
          </div>

          <div className={styles.decisionFooter}>
            <div className={styles.signatureStrip}>
              {heroSignature.map((item) => (
                <div className={`${styles.decisionStat} scrollyStat glass`} key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <div className={styles.decisionActions}>
              <Button href="/diagnostico" icon={<ArrowRight size={17} strokeWidth={1.8} />}>
                Iniciar diagnóstico
              </Button>
              <Button href="/casos-de-uso" variant="secondary">
                Ver casos
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
