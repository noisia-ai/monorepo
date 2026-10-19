import { notFound } from "next/navigation";

// Any path that matches no page renders the localized 404 inside the site layout.
export default function CatchAll() {
  notFound();
}
