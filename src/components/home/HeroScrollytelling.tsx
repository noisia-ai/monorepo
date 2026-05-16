"use client";

import Image from "next/image";
import { ArrowRight, Cloud, Headphones, Mail, ShoppingBag } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  siAppstore,
  siDiscourse,
  siFacebook,
  siGoogle,
  siInstagram,
  siMercadopago,
  siReddit,
  siShopify,
  siTiktok,
  siTrustpilot,
  siWhatsapp,
  siX,
  siYoutube
} from "simple-icons";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Button } from "@/components/ui/Button";
import {
  heroIndustryMetrics,
  heroPipelineSteps,
  heroRoleRead,
  heroVoiceCards
} from "@/components/home/heroScrollyData";
import styles from "@/components/home/HeroScrollytelling.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

type ChannelStyle = {
  accent: string;
  accent2: string;
  glyph?: string;
  icon?: { path: string };
  iconNode?: ReactNode;
};

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
  { x: "-82px", y: "-72px", r: "-6deg" },
  { x: "82px", y: "-54px", r: "6deg" },
  { x: "-82px", y: "54px", r: "-5deg" },
  { x: "82px", y: "72px", r: "5deg" }
];

const mobileDrift = [
  { x: -18, y: -26, r: -4 },
  { x: 18, y: -24, r: 4 },
  { x: -14, y: -18, r: -3 },
  { x: 14, y: -16, r: 3 }
];

const channelStyles: Record<string, ChannelStyle> = {
  Amazon: { iconNode: <ShoppingBag size={14} strokeWidth={2} />, accent: "#ff9900", accent2: "#232f3e" },
  "App Store": { icon: siAppstore, accent: "#0d96f6", accent2: "#7cc4ff" },
  Facebook: { icon: siFacebook, accent: "#1877f2", accent2: "#8cc7ff" },
  Foro: { icon: siDiscourse, accent: "#00abb5", accent2: "#67d7de" },
  "Google Reviews": { icon: siGoogle, accent: "#4285f4", accent2: "#34a853" },
  Instagram: { icon: siInstagram, accent: "#e4405f", accent2: "#f77737" },
  Klaviyo: { iconNode: <Mail size={14} strokeWidth={2} />, accent: "#111111", accent2: "#ff6f61" },
  "Mercado Libre": { icon: siMercadopago, accent: "#00b1ea", accent2: "#ffe600" },
  Reddit: { icon: siReddit, accent: "#ff4500", accent2: "#ff9a64" },
  Salesforce: { iconNode: <Cloud size={14} strokeWidth={2} />, accent: "#00a1e0", accent2: "#77d4ff" },
  Shopify: { icon: siShopify, accent: "#7ab55c", accent2: "#95bf47" },
  TikTok: { icon: siTiktok, accent: "#111111", accent2: "#00f2ea" },
  Trustpilot: { icon: siTrustpilot, accent: "#00b67a", accent2: "#73dfbd" },
  WhatsApp: { icon: siWhatsapp, accent: "#25d366", accent2: "#7ee6a6" },
  X: { icon: siX, accent: "#111111", accent2: "#777777" },
  YouTube: { icon: siYoutube, accent: "#ff0033", accent2: "#ff8a8a" },
  Zendesk: { iconNode: <Headphones size={14} strokeWidth={2} />, accent: "#03363d", accent2: "#78a300" }
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

      mm.add("all", () => {
        const isMobileIntro = window.matchMedia("(max-width: 760px)").matches;
        const activeNoiseSelector = isMobileIntro
          ? ".scrollyNoiseCard[data-mobile-noise='true']"
          : ".scrollyNoiseCard[data-intro-noise='true']";
        const inactiveNoiseSelector = isMobileIntro
          ? ".scrollyNoiseCard:not([data-mobile-noise='true'])"
          : ".scrollyNoiseCard:not([data-intro-noise='true'])";
        const drift = isMobileIntro ? mobileDrift : desktopDrift;

        gsap.set(".scrollyScene", { clearProps: "opacity,y,scale,filter,position,transform" });
        gsap.set(inactiveNoiseSelector, { autoAlpha: 0 });
        gsap.set(activeNoiseSelector, { autoAlpha: 0, scale: isMobileIntro ? 0.98 : 0.94, filter: "blur(5px)" });
        gsap.set(".scrollyScene:not(.scrollyIntro)", { opacity: 0, y: 32, filter: "blur(4px)" });
        gsap.set(".scrollyFill", { scaleX: 0, transformOrigin: "left center" });
        gsap.set(".scrollyPipelineRailFill", { scaleY: 0, transformOrigin: "top center" });
        gsap.set(".scrollyPipelineRow, .scrollyMetricCard, .scrollyStateRow", {
          opacity: 0,
          y: 18
        });
        gsap.set(".scrollySignalChip", { opacity: 0, y: 22, scale: 0.94 });
        gsap.set(".scrollyPipelineOutcome", { opacity: 0, y: 20 });

        const idleReveal = gsap.to(activeNoiseSelector, {
          autoAlpha: 1,
          scale: 1,
          filter: "blur(0px)",
          duration: isMobileIntro ? 0.58 : 0.78,
          delay: isMobileIntro ? 0.46 : 0.76,
          stagger: { each: isMobileIntro ? 0.14 : 0.18, from: isMobileIntro ? "start" : "center" },
          ease: "power2.out"
        });

        const triggers: ScrollTrigger[] = [];

        triggers.push(
          ScrollTrigger.create({
            trigger: ".scrollyIntro",
            start: "top top",
            end: isMobileIntro ? "bottom 55%" : "bottom 30%",
            scrub: 1.0,
            animation: gsap.to(activeNoiseSelector, {
              x: (index) => drift[index % drift.length].x * (isMobileIntro ? 1 : 4.5),
              y: (index) => drift[index % drift.length].y * (isMobileIntro ? 1 : 4.5),
              rotate: (index) => drift[index % drift.length].r * (isMobileIntro ? 1 : 2),
              autoAlpha: 0,
              filter: isMobileIntro ? "blur(5px)" : "blur(8px)",
              scale: isMobileIntro ? 0.92 : 0.82,
              stagger: { each: isMobileIntro ? 0.018 : 0.012, from: "center" },
              ease: "none"
            })
          })
        );

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
          }
          return tl;
        };

        [".scrollyPipeline", ".scrollyMethod"].forEach((sceneSel) => {
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
                  data-intro-noise={index < 8 ? "true" : "false"}
                  data-mobile-noise={index < 4 ? "true" : "false"}
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
                        {channel.iconNode ? (
                          <span className={styles.voiceIconWrap} aria-hidden="true">
                            {channel.iconNode}
                          </span>
                        ) : channel.icon ? (
                          <svg className={styles.voiceIcon} viewBox="0 0 24 24" aria-hidden="true">
                            <path d={channel.icon.path} />
                          </svg>
                        ) : (
                          <span className={styles.voiceGlyph} aria-hidden="true">
                            {channel.glyph}
                          </span>
                        )}
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
            <span className={`${styles.eyebrow} scrollyIntroCopy`}>Inteligencia social para decidir</span>
            <h1 className={`display-xl ${styles.heroTitle} scrollyIntroCopy`}>
              Decide qué hacer con lo que México ya está diciendo.
            </h1>
            <p className={`body-lg ${styles.heroLead} scrollyIntroCopy`}>
              Noisia convierte conversación pública y voz del cliente en México en lectura estratégica: qué mueve la decisión, qué la frena y qué acción conviene defender con evidencia.
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
            <span className={styles.eyebrow}>De ruido a respuesta</span>
            <h2 className="display-lg">Ordenamos conversaciones dispersas hasta que aparece la decisión.</h2>
            <p className="body-lg">
              En México la voz del cliente vive en TikTok, Instagram, Amazon, Klaviyo, Salesforce, Zendesk, marketplaces, reviews y comunidades. La leemos completa para mostrar qué importa, por qué importa y qué mover primero.
            </p>
          </div>

          <div className={`${styles.pipelinePanel} glass`}>
            <div className={styles.pipelinePanelHeader}>
              <span>Toolstack Noisia</span>
              <strong>Escucha en México · +214M señales ordenadas</strong>
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
                        {channel.iconNode ? (
                          <span className={styles.signalIconWrap} aria-hidden="true">
                            {channel.iconNode}
                          </span>
                        ) : channel.icon ? (
                          <svg className={styles.signalIcon} viewBox="0 0 24 24" aria-hidden="true">
                            <path d={channel.icon.path} />
                          </svg>
                        ) : (
                          <span className={styles.signalGlyph} aria-hidden="true">
                            {channel.glyph}
                          </span>
                        )}
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
                <strong>Lectura defendible</strong>
                <p>La conversación deja de ser volumen y se vuelve una respuesta que negocio puede usar.</p>
              </div>
            </div>
          </div>
        </div>

        <div className={`${styles.scene} ${styles.methodScene} scrollyScene scrollyMethod`}>
          <div className={styles.methodologyHead}>
            <span className={styles.eyebrow}>Conversaciones negativas por industria</span>
            <h2 className={`display-lg ${styles.methodologyTitle}`}>
              Casi todas las industrias tienen conversaciones que pueden mejorar.
            </h2>
            <div className={styles.methodologyChips}>
              <span className="chip">Últimos 24 meses</span>
              <span className="chip">México</span>
              <span className="chip">234M menciones analizadas</span>
              <span className="chip">Quejas + fricción + riesgo</span>
            </div>
          </div>

          <div className={styles.methodologyGrid}>
            <div className={styles.matrixStack}>
              <div className={styles.matrixGrid}>
                {heroIndustryMetrics.map((metric) => (
                  <article
                    className={`${styles.matrixCard} ${
                      metric.tone === "tension" ? styles.matrixCardAlert : styles.matrixCardStable
                    } scrollyMetricCard`}
                    key={metric.label}
                  >
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <em>conversaciones negativas</em>
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
            </div>

            <div className={styles.statePanel}>
              <div className={styles.stateHeader}>
                <strong>Qué dicen las quejas</strong>
                <span>Lectura breve de los patrones que más se repiten en México</span>
              </div>
              <div className={styles.stateList}>
                {heroRoleRead.map((item) => (
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

      </div>
    </section>
  );
}
