import { ArrowRight, CalendarDays, Clock3, Video } from "lucide-react";

const bookingUrl =
  "https://calendar.app.google/Zhpsy2vNq7jWdHgs8";

const scheduleDetails = [
  {
    icon: Clock3,
    label: "Duración",
    value: "30 minutos"
  },
  {
    icon: CalendarDays,
    label: "Horario",
    value: "Lun a vie · 9:00am a 5:00pm CDMX"
  },
  {
    icon: Video,
    label: "Lugar",
    value: "Google Meet"
  }
];

export function LandingScheduler() {
  return (
    <div className="landing-scheduler solid-panel">
      <div className="landing-scheduler__head">
        <span className="eyebrow">Agenda</span>
        <h3>30 min con Noisia</h3>
        <p>Elige un horario en Google Calendar. Ahí dejas tu nombre, correo y el contexto mínimo de la llamada.</p>
      </div>

      <div className="landing-scheduler__details" aria-label="Detalles de la llamada">
        {scheduleDetails.map((detail) => {
          const Icon = detail.icon;

          return (
            <div className="landing-scheduler__detail" key={detail.label}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{detail.label}</span>
              <strong>{detail.value}</strong>
            </div>
          );
        })}
      </div>

      <a className="button button--primary landing-scheduler__button" href={bookingUrl} rel="noreferrer" target="_blank">
        Elegir horario <ArrowRight size={17} strokeWidth={1.8} />
      </a>
    </div>
  );
}
