/**
 * Saving a figure to disk.
 *
 * The SVG is serialised from the element that is actually on screen, so what
 * gets exported is what was seen — including whichever theme was active. The
 * PNG is rendered at 2× onto an opaque background, because a transparent PNG
 * dropped into a document turns invisible the moment the document is light and
 * the chart was drawn dark.
 */

export function download(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type ExportTheme = "light" | "dark";

/**
 * Resolve the figure's colours against a chosen palette.
 *
 * The chart reads every colour from a custom property on the document root, and
 * those do not travel with a cloned element — unresolved, an exported figure
 * arrives black on black.
 *
 * Resolving them against a palette that is not the one on screen is done by
 * flipping the root attribute, reading, and putting it back. It looks like a
 * hack and is the opposite: the token file stays the single source of truth,
 * where a hard-coded copy of the light palette in here would drift from it the
 * first time a colour changed. Nothing repaints in between, because the whole
 * sequence runs inside one task and the browser has no chance to.
 */
function serialize(svg: SVGSVGElement, theme: ExportTheme): { markup: string; background: string } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const root = document.documentElement;
  const previous = root.getAttribute("data-qkd");
  root.setAttribute("data-qkd", theme);
  const computed = getComputedStyle(root);
  const value = (token: string) => computed.getPropertyValue(token).trim();

  const markup = clone.outerHTML.replace(
    /var\((--[a-z0-9-]+)\)/gi,
    (_, token: string) => value(token) || "#888",
  );
  const background = value("--plot") || (theme === "dark" ? "#0b0b0e" : "#ffffff");

  if (previous === null) root.removeAttribute("data-qkd");
  else root.setAttribute("data-qkd", previous);

  return { markup, background };
}

export function downloadSvg(svg: SVGSVGElement, name: string, theme: ExportTheme): void {
  download(name, "image/svg+xml", serialize(svg, theme).markup);
}

export function downloadPng(svg: SVGSVGElement, name: string, theme: ExportTheme): void {
  const width = svg.width.baseVal.value;
  const height = svg.height.baseVal.value;
  const scale = 2;
  const { markup, background } = serialize(svg, theme);
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  };
  image.src = source;
}
