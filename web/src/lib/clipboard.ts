/**
 * Copying text, including where the modern way is not available.
 *
 * `navigator.clipboard` only exists in a secure context: https, or localhost.
 * Served over plain http at a LAN address — which is exactly how this gets
 * demonstrated, from a projector laptop or a phone — the object is simply
 * absent, and a button built on it does nothing at all with no error to show
 * for it.
 *
 * So there are two attempts and an honest failure. The old `execCommand` path
 * is deprecated but carries no such requirement and still works in every
 * browser this will meet; when even that is refused, the caller is told so and
 * can put the text somewhere the reader can select it by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused, or no clipboard after all. Try the other way.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // Off-screen but focusable: a hidden element cannot be selected, and a
    // visible one would make the page jump.
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
