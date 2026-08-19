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

function serialize(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // The chart reads its colours from custom properties on the document root,
  // which do not travel with the element. Resolving them here is what keeps an
  // exported figure from arriving black on black.
  const computed = getComputedStyle(document.documentElement);
  const resolved = clone.outerHTML.replace(/var\((--[a-z0-9-]+)\)/gi, (_, token: string) =>
    computed.getPropertyValue(token).trim() || "#888",
  );
  return resolved;
}

export function downloadSvg(svg: SVGSVGElement, name: string): void {
  download(name, "image/svg+xml", serialize(svg));
}

export function downloadPng(svg: SVGSVGElement, name: string, background: string): void {
  const width = svg.width.baseVal.value;
  const height = svg.height.baseVal.value;
  const scale = 2;
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialize(svg))}`;

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
