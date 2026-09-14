export function focusedFrameOwnsGamepad(element: Element | null): boolean {
  return (
    element instanceof HTMLIFrameElement &&
    element.hasAttribute("data-gamepad-owner")
  );
}
