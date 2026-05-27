import { productSurfaces } from "@/content/site";

export function ProductSurfaceGrid() {
  return (
    <div className="surface-grid">
      {productSurfaces.map((surface, index) => (
        <article className={`surface-card glass surface-card--${index + 1}`} key={surface.name}>
          <span className="chip">{surface.name}</span>
          <h3>{surface.description}</h3>
          <p>{surface.proof}</p>
        </article>
      ))}
    </div>
  );
}
