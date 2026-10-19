/**
 * Invisible schema.org structured data. Server component: the JSON is in the HTML that search and
 * answer engines fetch, with "<" escaped so text can never close the script tag.
 */
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
